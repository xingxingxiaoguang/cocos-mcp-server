# 项目架构优化技术方案

> 版本: 1.2  
> 日期: 2026-03-31  
> 目标: 解决随工具数量膨胀带来的可维护性下降问题，建立清晰的分层架构，统一 API 管理、类型体系、错误处理和工具开发规范，并优先收敛 IPC 契约、工具注册源与历史遗留依赖。

---

## 一、现状分析

### 1.1 代码规模现状

| 文件 | 行数 | 主要职责 |
|------|------|----------|
| `source/scene.ts` | 1469 | 场景侧逻辑（序列化、节点查找、动画操作）|
| `source/mcp-server.ts` | 457 | HTTP 服务 + MCP 协议处理 |
| `source/tools/v2/component-tools.ts` | 2132 | 组件工具（最大单文件）|
| `source/tools/v2/node-tools.ts` | 1541 | 节点工具 |
| `source/tools/v2/asset-tools.ts` | 1266 | 资产工具 |
| `source/tools/v2/` 全部 | 7725 | 12 个工具文件 |
| `source/types/index.ts` | 156 | 类型定义（所有类型混在一起）|

### 1.2 核心架构问题

#### 问题 1：Cocos Editor/Engine API 调用无统一管理

- `Editor.Message.request('scene', ...)` 的魔法字符串分散在 12 个工具文件中，约 100+ 处调用
- `preferences-tools.ts` 出现 `(Editor.Message.request as any)(...)` 类型逃逸
- `scene.ts` 内的 `tryEditorThenEngine<T>()` fallback 机制孤立存在，其他文件无法复用
- Cocos 版本升级导致 API 变更时，只能逐文件 grep 修改，无编译期保障

#### 问题 2：类型定义缺乏分层，业务 Model 散落各处

- `types/index.ts` 将 MCP 协议类型、业务领域 Model、工具配置类型全部混在一起
- 工具文件内部定义了大量跨工具共享的私有接口（如 `NodeCreateSpec`、`ComponentSetContext`）
- 这些接口无法被其他工具文件引用，导致相似结构在多处独立定义

#### 问题 3：序列化逻辑三份独立实现

| 文件 | 函数名 | 最大深度 | 最大数组长度 | 最大对象键数 |
|------|--------|----------|-------------|-------------|
| `scene.ts` | `safeSerialize()` | 6 | 100 | 无限制 |
| `component-tools.ts` | `serializeToolResult()` | 3 | 100 | 20 |
| `scene-script-tools.ts` | `serializeResult()` | 3 | 100 | 20 |

三份实现行为不一致，任何 bug 需要同步三处修复，且均无测试覆盖。

#### 问题 4：工具实现存在大量重复样板代码

**重复模式一：Promise 包装反模式（~200 行）**

所有工具中普遍存在将 Promise 再包装为 Promise 的写法：
```typescript
// 当前写法
return new Promise((resolve) => {
    Editor.Message.request(...).then(result => {
        resolve({ success: true, data: result });
    }).catch(err => {
        resolve({ success: false, error: err.message });
    });
});
```

**重复模式二：execute() 分发层（12 份相同结构）**

每个工具文件都有结构几乎相同的 switch 分发逻辑和相同的 default 分支。

**重复模式三：inputSchema 公共字段重复定义**

`uuid`、`uuids`、`path` 等参数在所有工具中反复定义，描述文本不完全一致。

#### 问题 5：错误体系缺乏结构化分类

所有错误统一为 `{ success: false, error: err.message }`，AI 客户端无法区分：
- 参数校验失败（可立即调整参数重试）
- 场景未打开（需先执行前置操作）
- 节点不存在（UUID 错误）
- Editor API 调用失败（可能需要重试）
- 环境/权限问题（需要用户介入）

#### 问题 6：scene.ts 职责过重，持续膨胀

`scene.ts`（1469 行）混合了四种不同职责：
1. 通用序列化工具函数
2. 节点查找与遍历工具
3. 动画消息常量定义与动画上下文管理
4. Editor API fallback 抽象层

每新增一个工具的场景侧逻辑，都会继续向这个文件追加。

#### 问题 7：缺乏请求级别的统一日志中间件

调试 AI 工具调用时，需要知道"哪个工具被调用了、参数是什么、耗时多少、是否失败"。目前 `mcp-server.ts` 中没有统一的请求日志，只能依赖各工具自行 console.log，日志格式不一致。

#### 问题 8：v1/v2 版本遗留文件并存

`source/tools/prefab-tools.ts`（v1，117 行）和 `source/tools/v2/prefab-tools.ts` 同时存在，v1 的注册状态不明确，增加认知负担。

#### 问题 9：主进程 / 面板 IPC 契约已经漂移

- `main.ts` 中 `updateToolStatus()`、`updateToolStatusBatch()` 的方法签名与 `panels/tool-manager` 实际调用不一致
- `getToolManagerState()` 的返回结构与调用方预期不一致，当前存在 `currentConfiguration` / `selectedConfigId` 的结构漂移
- `package.json` 中注册了 `open-tool-manager`，但主进程未实现 `openToolManager`
- 此类问题不会被 `tsc` 拦截，说明当前类型体系未覆盖主进程与面板边界

#### 问题 10：工具注册存在多份事实来源

- `mcp-server.ts` 维护一份工具实例化清单
- `tool-manager.ts` 再次 `require()` 一份 v2 工具集合来生成可选工具列表
- `tool-manager.ts` 还有一份硬编码 fallback 工具清单
- `PrefabToolsV2` 仍依赖 v1 `PrefabTools`，导致 prefab 能力在 v1/v2 间交叉实现

#### 问题 11：主进程职责边界不清

- `updateSettings()` 同时承担“保存配置”和“控制服务生命周期”两类职责
- `main.ts` 中既处理面板消息，又直接编排 `ToolManager` 与 `MCPServer`
- `settings.ts` 与 `tool-manager.ts` 各自包含一套读写配置逻辑，缺乏统一 repository/service 抽象

#### 问题 12：面板层缺乏治理与清理

- 默认面板存在轮询逻辑，但缺乏完整的资源释放与状态同步约束
- `panels/default` 与 `panels/tool-manager` 采用两套不同的状态管理方式
- 当前 `tool-manager` 面板更接近遗留实现，是否保留、并入或删除尚未在代码结构上体现

---

## 二、目标架构

### 2.1 分层设计

```
┌─────────────────────────────────────────────────────────┐
│                    Panel / UI 层                         │
│  panels/default  ─  ipc/client.ts  ─  单一受支持入口      │
└───────────────────────────┬─────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────┐
│                    IPC 契约层                            │
│  ipc/contracts.ts  ─  主进程消息名、参数、返回结构        │
└───────────────────────────┬─────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────┐
│                  主进程服务 / 应用层                     │
│  main.ts  ─  薄 IPC facade                               │
│  services/  ─  server-controller / tool-config-service   │
│             ─  settings-repository / tool-registry       │
└──────────────┬──────────────────────────────────────────┘
               │
┌──────────────▼──────────────────────────────────────────┐
│                 MCP / Tool 入口层                        │
│  mcp-server.ts                                           │
│  tools/v2/  ─  只做入参校验 / action 路由 / ToolResponse │
└──────────────┬──────────────────────────────────────────┘
               │
┌──────────────▼──────────────────────────────────────────┐
│                Application / Use-Case 层                 │
│  application/use-cases/                                  │
│  承载工具业务核心逻辑与跨 capability 编排                │
└──────────────┬──────────────────────────────────────────┘
               │
┌──────────────▼──────────────────────────────────────────┐
│                  Capability / Service 层                 │
│  capabilities/interfaces  ─  稳定语义能力接口            │
│  capabilities/services    ─  统一能力服务                │
└──────────────┬──────────────────────────────────────────┘
               │
┌──────────────▼──────────────────────────────────────────┐
│            Editor Bridge / Driver / Message 层           │
│  runtime-profile / capability-registry                   │
│  drivers/  ─  版本差异 / fallback / Editor 对接          │
│  messages/ ─  最薄原始 request                           │
└──────────────┬──────────────────────────────────────────┘
               │
┌──────────────▼──────────────────────────────────────────┐
│                    场景进程层（scene/）                   │
│  methods  node-registry  animation-context               │
│  serialization  editor-fallback                          │
└─────────────────────────────────────────────────────────┘
```

### 2.2 目标目录结构

```
source/
├── main.ts                          # 薄 IPC facade，不再承担业务编排
├── mcp-server.ts                    # MCP transport / 协议解析 / 统一日志
│
├── ipc/                             # ★ 新增：主进程与面板契约
│   ├── contracts.ts                 # 消息名、参数、返回结构
│   └── client.ts                    # 面板侧统一请求封装
│
├── services/                        # ★ 新增：主进程服务层
│   ├── tool-registry.ts             # 单一工具注册源
│   ├── server-controller.ts         # 服务生命周期管理
│   ├── tool-config-service.ts       # 工具配置业务
│   └── settings-repository.ts       # 设置读写
│
├── types/                           # 类型分层
│   ├── index.ts                     # 统一 re-export
│   ├── mcp.ts                       # MCP 协议类型（ToolDefinition、ToolResponse 等）
│   ├── domain.ts                    # 业务领域 Model（NodeInfo、AssetInfo 等）
│   ├── config.ts                    # 配置类型（MCPServerSettings、ToolManagerSettings 等）
│   └── editor.ts                    # Cocos Editor API 返回值类型声明
│
├── application/                     # ★ 新增：工具业务 use-case 层
│   └── use-cases/
│       ├── animation/
│       ├── preferences/
│       ├── project/
│       ├── scene/
│       ├── asset/
│       ├── node/
│       ├── component/
│       └── prefab/
│
├── capabilities/                    # ★ 新增：稳定能力接口与服务
│   ├── interfaces/
│   │   ├── animation.ts
│   │   ├── asset.ts
│   │   ├── component.ts
│   │   ├── node.ts
│   │   ├── preferences.ts
│   │   ├── project.ts
│   │   ├── prefab.ts
│   │   └── scene.ts
│   └── services/
│       ├── animation-service.ts
│       ├── preferences-service.ts
│       ├── project-service.ts
│       ├── scene-service.ts
│       ├── asset-service.ts
│       ├── node-service.ts
│       ├── component-service.ts
│       └── prefab-service.ts
│
├── editor-bridge/                   # ★ 新增：runtime profile / drivers / messages
│   ├── index.ts                     # 统一 re-export
│   ├── runtime-profile.ts           # 版本能力探测
│   ├── capability-registry.ts       # capability 与 driver 装配
│   ├── models.ts                    # bridge 层稳定模型
│   ├── messages/
│   │   ├── scene-messages.ts
│   │   ├── asset-messages.ts
│   │   ├── preferences-messages.ts
│   │   ├── builder-messages.ts
│   │   └── project-messages.ts
│   └── drivers/
│       └── cocos-3_8/
│           ├── animation-driver.ts
│           ├── asset-driver.ts
│           ├── component-driver.ts
│           ├── node-driver.ts
│           ├── preferences-driver.ts
│           ├── prefab-driver.ts
│           ├── project-driver.ts
│           └── scene-driver.ts
│
├── utils/                           # ★ 新增：跨工具公共工具函数
│   ├── serializer.ts                # 统一序列化（合并三处实现）
│   ├── error-codes.ts               # ToolErrorCode 枚举 + 错误工厂函数
│   └── schema-helpers.ts            # 公共 inputSchema 片段（uuid、path 等）
│
├── scene/                           # ★ 重构：scene.ts 拆分
│   ├── methods.ts                   # 场景进程 methods 主体
│   ├── serialization.ts             # safeSerialize（迁移自 scene.ts）
│   ├── node-registry.ts             # findNodeByUuid、节点遍历
│   ├── animation-context.ts         # 动画编辑上下文管理
│   └── editor-fallback.ts           # tryEditorThenEngine 通用逻辑
│
├── scene.ts                         # 兼容 facade，继续作为 Cocos 场景入口
│
└── tools/
    ├── base-tool.ts                 # ★ 新增：BaseToolExecutor 基类
    ├── tool-manager.ts              # 收敛为配置业务薄封装或并入 service
    ├── schemas/                     # ★ 新增：公共 schema 片段
    │   └── common.ts                # uuid/uuids/path/action 等通用字段
    └── v2/                          # 各业务工具（内部实现简化）
        ├── scene-tools.ts
        ├── node-tools.ts
        ├── component-tools.ts
        ├── asset-tools.ts
        ├── prefab-tools.ts
        ├── animation-tools.ts
        ├── project-tools.ts
        ├── debug-tools.ts
        ├── preferences-tools.ts
        ├── scene-script-tools.ts
        ├── undo-tools.ts
        └── array-property-tools.ts
```

---

## 三、各优化项详细方案

### 3.1 IPC 契约治理

**目标：** 先修复当前已经漂移的主进程 / 面板边界，避免后续重构建立在错误契约上。

**实现方案：**

- 新增 `source/ipc/contracts.ts`，集中定义主进程暴露给面板的消息名、参数与返回结构
- 为默认面板建立 `source/ipc/client.ts`，统一封装 `Editor.Message.request('cocos-mcp-server', ...)`
- 所有面板调用改为消费同一套 contract，不允许散落的字符串调用
- 修复当前已知漂移项：
  - `updateToolStatus(category, toolName, enabled)` 与调用方保持一致
  - `updateToolStatusBatch(updates)` 与调用方保持一致
  - `getToolManagerState()` 返回 `currentConfiguration`、`selectedConfigId`、`configurations` 的统一结构
  - `open-tool-manager` 要么补齐实现，要么从 `package.json` 删除

**收益：**

- 把“运行时才发现的参数错位”前移到编译期
- 为面板重构与主进程拆分提供稳定边界
- 先止血，再谈分层

---

### 3.2 单一工具注册源（Tool Registry）

**目标：** 消除 `mcp-server.ts`、`tool-manager.ts`、fallback 列表三份工具事实来源。

**实现方案：**

```typescript
// source/services/tool-registry.ts
export interface ToolRegistration {
    category: string;
    create(): ToolExecutor;
}

export const TOOL_REGISTRY: ToolRegistration[] = [
    { category: 'scene', create: () => new SceneToolsV2() },
    { category: 'node', create: () => new NodeToolsV2() },
    // ...
];
```

由此派生：

- `MCPServer` 的工具实例化
- `ToolManager` 的 `availableTools`
- 可选的工具元数据导出 / 文档生成

**约束：**

- 禁止在 `tool-manager.ts` 内再次手动 `require()` 所有工具
- 禁止保留第二份硬编码 fallback 工具清单
- 新增工具只能改 registry，一处生效

---

### 3.3 主进程服务拆分

**目标：** 将 `main.ts` 从“业务堆积点”收敛为薄 IPC facade。

**拆分建议：**

- `source/services/server-controller.ts`
  - 负责 `start / stop / restart / getStatus`
- `source/services/settings-repository.ts`
  - 负责 `mcp-server.json` 的读写
- `source/services/tool-config-service.ts`
  - 负责工具配置的创建、切换、导入导出、同步
- `source/services/tool-registry.ts`
  - 负责工具定义与实例工厂

`main.ts` 只保留：

- IPC 消息注册
- 参数转发
- 最薄的错误边界

`updateSettings()` 不再隐式执行 `stop -> new server -> start`，而是拆成：

- `saveSettings(settings)`
- `applyRuntimeSettings(settings)` 或 `restartServerIfNeeded()`

---

### 3.4 Capability / Driver / Message 分层

**目标：** 让 tools 保留工具业务入口，不再关注底层不同版本引擎和 API 变化。

#### 分层边界

- `tools`
  - 只做 MCP tool 定义、入参校验、action 路由、`ToolResponse`
- `application/use-cases`
  - 承载工具业务核心逻辑
- `capabilities/interfaces`
  - 对 use-case 暴露稳定语义能力
- `capabilities/services`
  - 调度具体 driver，对外提供统一能力实现
- `editor-bridge/drivers`
  - 处理版本差异、fallback、底层 Editor/Engine 对接
- `editor-bridge/messages`
  - 只保留最薄的 message request 封装

#### 关键原则

- 不接受只有 message wrapper 的“伪抽象”
- 不允许 tools 继续持有版本判断和 fallback 逻辑
- capability 方法必须是语义能力，而不是 request 包装

#### 示例

```typescript
interface AnimationCapability {
    resolveClip(ref: ClipRef): Promise<ResolvedClip>;
    getClipInfo(ctx: AnimationContext): Promise<AnimationClipInfo>;
    listEditableProperties(ctx: AnimationContext): Promise<EditableProperty[]>;
    addTrack(input: AddTrackInput): Promise<TrackInfo>;
    setKeyframe(input: SetKeyframeInput): Promise<KeyframeResult>;
    saveClip(ctx: AnimationContext): Promise<SaveResult>;
}
```

driver 内部再去决定：

- 用哪个 message
- 参数顺序如何
- 是否需要 scene script fallback
- 是否需要 engine API fallback

#### Runtime Profile

新增 `runtime-profile.ts` 探测当前版本和能力开关，并由 `capability-registry.ts` 选择 driver。

---

### 3.5 类型分层重构

**目标：** 区分 MCP 协议类型、业务 Model、配置类型、Editor 返回值类型与 IPC 契约类型。

**拆分方案：**

- `source/types/mcp.ts`
  - `ToolDefinition`
  - `ToolResponse`
  - `ToolExecutor`
  - `ServerStatus`
- `source/types/domain.ts`
  - `NodeInfo`
  - `NodeCreateSpec`
  - `ComponentInfo`
  - `PrefabInfo`
  - `AnimationClipInfo`
- `source/types/config.ts`
  - `MCPServerSettings`
  - `ToolConfig`
  - `ToolConfiguration`
  - `ToolManagerSettings`
- `source/types/editor.ts`
  - Editor / asset-db / scene 返回值声明
- `source/ipc/contracts.ts`
  - 面板与主进程的消息契约

`source/types/index.ts` 继续做 re-export，保持兼容。

---

### 3.6 统一序列化工具

**目标：** 合并三处序列化实现，统一行为参数。

**实现方案：**

```typescript
// source/utils/serializer.ts
export interface SerializeOptions {
    maxDepth?: number;
    maxArrayLength?: number;
    maxObjectKeys?: number;
}

export function safeSerialize(value: unknown, options?: SerializeOptions): unknown {
    const opts = { maxDepth: 4, maxArrayLength: 100, maxObjectKeys: 50, ...options };
    return serialize(value, 0, new WeakSet(), opts);
}
```

不同调用方只调参数，不再复制实现。

---

### 3.7 结构化错误码体系

**目标：** 让 AI 客户端与面板能区分“参数问题 / 状态问题 / 环境问题 / Editor API 失败”。

**实现方案：**

- `source/utils/error-codes.ts`
  - `INVALID_ARGS`
  - `MISSING_REQUIRED`
  - `NODE_NOT_FOUND`
  - `ASSET_NOT_FOUND`
  - `SCENE_NOT_OPEN`
  - `EDITOR_API_FAILED`
  - `UNSUPPORTED_VERSION`
- `ToolResponse` 增加 `errorCode`
- 补充 `makeError()` / `normalizeUnknownError()` 等工厂函数

---

### 3.8 BaseToolExecutor 基类

**目标：** 消除重复的 execute 分发、统一日志与异常包装。

**建议：** 使用显式 handler map，而不是字符串反射。

```typescript
export abstract class BaseToolExecutor implements ToolExecutor {
    protected abstract readonly handlers: Record<string, (args: any) => Promise<ToolResponse>>;
    abstract getTools(): ToolDefinition[];

    async execute(toolName: string, args: any): Promise<ToolResponse> {
        const handler = this.handlers[toolName];
        if (!handler) {
            return makeError(ToolErrorCode.INVALID_ARGS, `Unknown tool: ${toolName}`);
        }
        return handler(args);
    }
}
```

这样能减少 `(this as any)[methodName]` 带来的隐式反射和调试难度。

---

### 3.9 公共 inputSchema 片段复用

**目标：** 消除各工具中重复定义的公共参数 schema。

**实现方案：**

- `source/tools/schemas/common.ts`
  - `uuid`
  - `uuids`
  - `dbPath`
  - `action(enumValues, description)`
- 仅复用稳定字段，避免为了抽象而抽象
- 工具专属复杂 schema 仍保留在各自工具文件中

---

### 3.10 scene.ts 按职责拆分

**目标：** 将超大 `scene.ts` 拆为职责单一的模块，但降低接入风险。

**关键调整：**

- 保留一个很薄的 `source/scene.ts` 作为 Cocos 注册入口 facade
- 将实现迁移到 `source/scene/` 目录
- 不在第一步就强制把 `package.json` 入口改到 `scene/index.ts`

**拆分建议：**

- `source/scene/node-registry.ts`
- `source/scene/animation-context.ts`
- `source/scene/editor-fallback.ts`
- `source/scene/serialization.ts`
- `source/scene/methods.ts`

`source/scene.ts` 只做：

```typescript
export { methods } from './scene/methods';
```

---

### 3.11 Prefab 旧实现退役与领域化重构

**目标：** 剪除 `source/tools/prefab-tools.ts` 的残余依赖，并把 prefab 从“工具内巨型逻辑”重构为独立领域能力。

**现状：**

- `PrefabToolsV2` 仍通过 `legacyPrefabTools` 委托旧实现
- 当前至少还有 `create_prefab`、`duplicate_prefab` 两条路径依赖 v1

**迁移方案：**

- 定义 `PrefabCapability`
- 定义 `create / duplicate / instantiate / apply / revert` use-case
- 由 prefab driver 处理底层 scene / asset / prefab 对接差异
- 删除 `legacyPrefabTools` 字段与 import
- 最终删除 `source/tools/prefab-tools.ts`

**验收标准：**

- `rg "legacyPrefabTools|source/tools/prefab-tools"` 结果为 0
- `from_node / instantiate / duplicate / apply / revert` 手动验证通过

---

### 3.12 请求日志中间件与严格协议解析

**目标：** 统一记录工具调用的入参、出参、耗时，并收紧协议解析行为。

**实现方案：**

- 在 `mcp-server.ts` 的工具执行链路增加：
  - `requestId`
  - 工具名
  - 耗时
  - 成功/失败状态
  - `errorCode`
- `enableDebugLog` 开启时输出完整调试日志
- 对大参数、脚本内容、资产内容做截断与脱敏
- 逐步移除或收紧 `fixCommonJsonIssues()` 这类激进的 JSON 自动修复逻辑，优先返回明确 parse error

---

### 3.13 Promise 包装反模式清理

**目标：** 全面使用 async/await，消除不必要的 Promise 包装。

**重构原则：**

- 不再写 `return new Promise(resolve => ...)`
- 统一使用 `await + try/catch`
- `Editor.Message.request()` 的异常由 bridge / base executor / makeError 统一处理

---

### 3.14 Panel 层治理

**目标：** 明确默认面板与旧 tool-manager 面板的去留，并统一状态模型。

**方案建议：**

- 默认面板继续保留，作为唯一受支持的 UI 入口
- 旧 `panels/tool-manager` 二选一：
  - 正式接入并用同一套 IPC contract 重构
  - 明确删除，避免遗留代码继续误导维护者
- 为默认面板补齐：
  - 定时器清理
  - 生命周期统一
  - 面板状态与主进程状态的单向同步约束

---

## 四、实施计划

### 阶段划分原则

- 每个阶段独立可发布，不影响现有功能
- 先止血，再分层，再迁移
- 先收敛事实来源和契约，再建设基础设施
- 每个阶段都必须具备验证手段，而不只是“编译通过”

### 阶段 0：契约与死代码治理（优先级 P0）

**目标：** 修复已经存在的边界漂移问题，清除明显失效的注册与死代码。

| 任务 | 说明 |
|------|------|
| 梳理 `package.json` contributions.messages | 核对每个 message 是否有实现 |
| 建立 `source/ipc/contracts.ts` | 定义主进程与面板契约 |
| 对齐 `updateToolStatus*` / `getToolManagerState` | 修复当前签名与结构漂移 |
| 决策 `open-tool-manager` / `panels/tool-manager` 去留 | 补实现或删除 |
| 增加 IPC smoke test | 覆盖关键消息调用链 |

**验收标准：**

- 主进程与面板消息签名一致
- 无“注册了但未实现”的 message
- `tsc` 与契约测试同时通过

### 阶段一：单一注册源与主进程拆分（优先级 P0）

**目标：** 先解决工具事实来源分叉和主进程职责混杂。

| 任务 | 说明 |
|------|------|
| 创建 `source/services/tool-registry.ts` | 统一工具元数据与实例工厂 |
| 重构 `mcp-server.ts` 消费 registry | 去掉手写工具列表 |
| 重构 `tool-manager.ts` 消费 registry | 去掉重复 `require()` 与 fallback 清单 |
| 创建 `server-controller.ts` | 服务生命周期管理 |
| 创建 `settings-repository.ts` / `tool-config-service.ts` | 配置与业务职责拆分 |
| 精简 `main.ts` | 改为薄 IPC facade |

**验收标准：**

- 工具注册源只有 1 份
- `main.ts` 不再直接承担业务编排
- 新增工具只需改 registry 即可生效

### 阶段二：基础设施建设（优先级 P1）

**目标：** 建立后续迁移需要的基础模块。

| 任务 | 说明 |
|------|------|
| 创建 `source/utils/serializer.ts` | 合并三处序列化实现 |
| 创建 `source/utils/error-codes.ts` | 定义 `ToolErrorCode` |
| 创建 `source/tools/schemas/common.ts` | 公共 schema 片段 |
| 创建 `source/tools/base-tool.ts` | 显式 handler map 的基类 |
| 拆分 `source/types/` | 类型分层并保持兼容 |

**验收标准：**

- 基础模块编译通过
- 有最小单元测试覆盖 serializer / error-codes / registry 派生结果

### 阶段三：Capability Layer 与 scene 拆分（优先级 P1）

**目标：** 建立 `tools -> use-cases -> capabilities -> drivers -> messages` 分层骨架，并拆掉 `scene.ts` 的过重职责。

| 任务 | 说明 |
|------|------|
| 创建 `application/use-cases/` | 低风险领域业务编排试点 |
| 创建 `capabilities/interfaces` / `services` | 稳定能力接口与统一服务 |
| 创建 `editor-bridge/runtime-profile.ts` | 版本能力探测 |
| 创建 `editor-bridge/capability-registry.ts` | capability 与 driver 装配 |
| 创建 `editor-bridge/messages/` / `drivers/` | message 与版本对接分层 |
| 创建 `scene/` 目录结构并保留 facade | 降低 Cocos 接入风险 |
| 迁移 `preferences/project/animation` 试点 | 验证分层模板 |

**验收标准：**

- tools 不再直接写 Editor 魔法字符串
- 低风险工具已通过 use-case / capability 调用
- 场景入口接入方式稳定，无加载回归

### 阶段四：重型领域迁移与 Prefab 退役（优先级 P1-P2）

**目标：** 把重型工具迁入 capability / use-case 架构，并完成 prefab legacy 退役。

迁移顺序建议：

| 顺序 | 领域 | 重构内容 |
|------|------|----------|
| 1 | `scene` | `SceneCapability` + use-cases |
| 2 | `asset` | `AssetCapability` + use-cases |
| 3 | `node` | `NodeCapability` + use-cases |
| 4 | `component` | `ComponentCapability` + use-cases |
| 5 | `prefab` | `PrefabCapability` + use-cases + 删除 legacy |
| 6 | `debug` / 其他辅助工具 | 接入统一日志与错误码 |

**验收标准：**

- 重型工具通过 use-case / capability 调用
- `PrefabToolsV2` 不再依赖 v1
- 全仓无遗留 `legacyPrefabTools`

### 阶段五：Panel、日志与架构治理收尾（优先级 P2）

| 任务 | 说明 |
|------|------|
| 默认面板状态治理 | 轮询清理、生命周期收口 |
| 决定旧 `tool-manager` 面板去留 | 重构或删除 |
| 在 `mcp-server.ts` 添加统一日志 | 可定位到 tool / use-case / capability / driver |
| 收紧 JSON 解析策略 | 优先报错而不是自动修复 |
| 更新 README 与开发规范 | 同步新的分层开发流程 |

---

## 五、优化效果预估

| 指标 | 现状 | 优化后 |
|------|------|--------|
| 主进程 / 面板 IPC 契约 | 运行时漂移，`tsc` 无法发现 | `contracts.ts` 统一约束，关键调用可被测试覆盖 |
| 工具注册源数量 | 3 份以上 | 1 份（`tool-registry.ts`） |
| tools 中魔法字符串 API 调用处数 | ~100 处 | 0 |
| 序列化实现数量 | 3 份（行为不一致）| 1 份（统一参数化）|
| 重复 Promise 包装代码 | ~200 行 | 0 |
| execute() 分发样板代码 | 12 份 switch 语句 | BaseToolExecutor 统一处理 |
| prefab 核心实现来源 | v1 / v2 混用 | 全部收敛到 v2 |
| scene.ts 体积 | 1469 行（单文件）| ~200 行/模块（5 个文件）|
| 新增工具所需了解文件数 | 5-6 个 | 4-5 个（tool + use-case + capability + registry + types）|
| 错误可诊断性 | 仅有 message 字符串 | errorCode + message 分级 |

---

## 六、新工具开发规范（优化后）

优化完成后，新增工具的标准流程：

1. **定义 domain 类型**：在 `source/types/domain.ts` 补充相关接口
2. **补齐 IPC / 配置类型**：如涉及主进程与面板通信，先更新 `source/ipc/contracts.ts`
3. **定义 capability 接口**：先在 `source/capabilities/interfaces/` 建立稳定能力面
4. **实现 use-case**：在 `source/application/use-cases/` 写业务编排
5. **实现 driver / message**：在 `source/editor-bridge/` 处理版本差异与底层 request
6. **创建工具文件**：继承 `BaseToolExecutor`，只做入口层职责
7. **复用公共 schema**：用 `CommonSchemas` 中的片段组合 inputSchema
8. **使用统一错误码**：返回 `makeError(ToolErrorCode.XXX, message)` 而非裸对象
9. **注册工具**：只在 `source/services/tool-registry.ts` 中注册一次
10. **场景侧逻辑**：新增到 `source/scene/` 对应模块，而非继续堆进 `scene.ts`
11. **补最小验证**：至少补一条 registry / contract / smoke test 或手测记录

---

*文档维护：随实施进度更新各阶段完成状态*
