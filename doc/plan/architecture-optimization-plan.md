# 项目架构优化技术方案

> 版本: 1.0  
> 日期: 2026-03-31  
> 目标: 解决随工具数量膨胀带来的可维护性下降问题，建立清晰的分层架构，统一 API 管理、类型体系、错误处理和工具开发规范。

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

---

## 二、目标架构

### 2.1 分层设计

```
┌─────────────────────────────────────────────────────────┐
│                    MCP 协议层                            │
│  mcp-server.ts  ─  HTTP 服务 + JSON-RPC 协议 + 日志中间件 │
└───────────────────────────┬─────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────┐
│                    工具执行层                            │
│  tools/v2/  ─  BaseToolExecutor + 各业务工具类           │
│  tools/schemas/  ─  公共 inputSchema 片段               │
└──────────────┬─────────────────────────┬────────────────┘
               │                         │
┌──────────────▼──────────┐  ┌───────────▼────────────────┐
│      Editor Bridge 层    │  │        工具 Utils 层        │
│  editor-bridge/          │  │  utils/                    │
│  - scene-messages.ts     │  │  - serializer.ts           │
│  - asset-messages.ts     │  │  - error-codes.ts          │
│  - preferences-messages  │  │  - schema-helpers.ts       │
│  - types.ts              │  └────────────────────────────┘
└──────────────┬───────────┘
               │
┌──────────────▼──────────────────────────────────────────┐
│                    场景进程层（scene/）                   │
│  index.ts  serializer.ts  node-registry.ts              │
│  animation-context.ts  editor-fallback.ts               │
└─────────────────────────────────────────────────────────┘
```

### 2.2 目标目录结构

```
source/
├── main.ts                          # 不变，IPC 方法汇总
├── mcp-server.ts                    # 精简，增加日志中间件
├── settings.ts                      # 不变
│
├── types/                           # 类型分层
│   ├── index.ts                     # 统一 re-export
│   ├── mcp.ts                       # MCP 协议类型（ToolDefinition、ToolResponse 等）
│   ├── domain.ts                    # 业务领域 Model（NodeInfo、AssetInfo 等）
│   ├── config.ts                    # 配置类型（MCPServerSettings、ToolManagerSettings 等）
│   └── editor.ts                    # Cocos Editor API 返回值类型声明
│
├── editor-bridge/                   # ★ 新增：统一 Editor API 封装层
│   ├── index.ts                     # 统一 re-export
│   ├── scene-messages.ts            # 'scene' channel 类型化封装
│   ├── asset-messages.ts            # 'asset-db' channel
│   ├── preferences-messages.ts      # 'preferences' channel
│   ├── builder-messages.ts          # 'builder' channel
│   └── message-constants.ts         # 所有消息名常量
│
├── utils/                           # ★ 新增：跨工具公共工具函数
│   ├── serializer.ts                # 统一序列化（合并三处实现）
│   ├── error-codes.ts               # ToolErrorCode 枚举 + 错误工厂函数
│   └── schema-helpers.ts            # 公共 inputSchema 片段（uuid、path 等）
│
├── scene/                           # ★ 重构：scene.ts 拆分
│   ├── index.ts                     # 对外统一 export
│   ├── serializer.ts                # safeSerialize（迁移自 scene.ts）
│   ├── node-registry.ts             # findNodeByUuid、节点遍历
│   ├── animation-context.ts         # 动画编辑上下文管理
│   └── editor-fallback.ts           # tryEditorThenEngine 通用逻辑
│
└── tools/
    ├── base-tool.ts                 # ★ 新增：BaseToolExecutor 基类
    ├── tool-manager.ts              # 不变
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

### 3.1 Editor Bridge 层（统一 API 管理）

**目标：** 消除魔法字符串，提供编译期类型安全，集中管理 API 版本兼容处理。

**实现方式：**

```typescript
// source/editor-bridge/message-constants.ts
export const SCENE_MSG = {
    QUERY_NODE: 'query-node',
    SET_PROPERTY: 'set-property',
    CREATE_NODE: 'create-node',
    DELETE_NODE: 'delete-node',
    // ...
} as const;

// source/editor-bridge/scene-messages.ts
import { SCENE_MSG } from './message-constants';
import type { NodeInfo, NodeCreateSpec } from '../types/domain';

export const SceneMessages = {
    async queryNode(uuid: string): Promise<NodeInfo> {
        return Editor.Message.request('scene', SCENE_MSG.QUERY_NODE, uuid);
    },
    async createNode(spec: NodeCreateSpec): Promise<string> {
        return Editor.Message.request('scene', SCENE_MSG.CREATE_NODE, spec);
    },
    // 版本兼容处理集中在此
    async queryComponentWithFallback(uuid: string, type: string): Promise<any> {
        try {
            return await Editor.Message.request('scene', SCENE_MSG.QUERY_COMPONENT, uuid, type);
        } catch {
            // fallback to execute-scene-script
            return SceneMessages.executeSceneScript({...});
        }
    }
};
```

工具文件调用方式变为：
```typescript
import { SceneMessages } from '../../editor-bridge';

const nodeInfo = await SceneMessages.queryNode(args.uuid);
```

**收益：**
- 消除全部魔法字符串，IDE 可跳转、可重构
- Cocos 版本升级时只改 bridge 层，工具层零感知
- fallback 逻辑集中管理，不再各工具自行实现

---

### 3.2 类型分层重构

**目标：** 区分 MCP 协议类型、业务 Model、配置类型、Editor 返回值类型。

**拆分方案：**

```typescript
// source/types/mcp.ts  —— MCP 协议层类型
export interface ToolDefinition { ... }
export interface ToolResponse { ... }
export interface ToolExecutor { ... }
export interface ServerStatus { ... }

// source/types/domain.ts  —— 业务领域 Model
export interface NodeInfo { ... }
export interface NodeCreateSpec { ... }     // 从 node-tools.ts 提升
export interface ComponentInfo { ... }
export interface AssetInfo { ... }
export interface SceneInfo { ... }
export interface PrefabInfo { ... }
export interface ProjectInfo { ... }
export interface AnimationClipInfo { ... }  // 从 animation-tools.ts 提升

// source/types/config.ts  —— 配置类型
export interface MCPServerSettings { ... }
export interface ToolConfig { ... }
export interface ToolConfiguration { ... }
export interface ToolManagerSettings { ... }

// source/types/editor.ts  —— Cocos Editor API 返回值类型
// 为 Editor.Message.request 的返回值提供类型声明，减少 any 使用

// source/types/index.ts  —— 统一 re-export，保持向后兼容
export * from './mcp';
export * from './domain';
export * from './config';
export * from './editor';
```

---

### 3.3 统一序列化工具

**目标：** 合并三处序列化实现，统一行为参数。

**实现方案：**

```typescript
// source/utils/serializer.ts
export interface SerializeOptions {
    maxDepth?: number;       // 默认 4
    maxArrayLength?: number; // 默认 100
    maxObjectKeys?: number;  // 默认 50
}

export function safeSerialize(value: any, options?: SerializeOptions): any {
    const opts = { maxDepth: 4, maxArrayLength: 100, maxObjectKeys: 50, ...options };
    return _serialize(value, 0, new WeakSet(), opts);
}

function _serialize(value: any, depth: number, seen: WeakSet<object>, opts: Required<SerializeOptions>): any {
    // 统一实现，合并三处逻辑
}
```

各使用方按需传入自定义参数：
```typescript
// scene-script-tools.ts 需要浅序列化
safeSerialize(result, { maxDepth: 3, maxObjectKeys: 20 })

// scene.ts 需要深序列化
safeSerialize(nodeData, { maxDepth: 6 })
```

---

### 3.4 结构化错误码体系

**目标：** 让 AI 客户端能够根据错误类型采取不同的处理策略。

**实现方案：**

```typescript
// source/utils/error-codes.ts
export enum ToolErrorCode {
    // 参数类错误 —— AI 可调整参数后重试
    INVALID_ARGS       = 'INVALID_ARGS',
    MISSING_REQUIRED   = 'MISSING_REQUIRED',

    // 状态类错误 —— AI 需先执行前置步骤
    SCENE_NOT_OPEN     = 'SCENE_NOT_OPEN',
    ANIMATION_NOT_RECORDING = 'ANIMATION_NOT_RECORDING',

    // 资源类错误 —— 目标对象不存在
    NODE_NOT_FOUND     = 'NODE_NOT_FOUND',
    ASSET_NOT_FOUND    = 'ASSET_NOT_FOUND',
    COMPONENT_NOT_FOUND = 'COMPONENT_NOT_FOUND',

    // API 类错误 —— 可重试
    EDITOR_API_FAILED  = 'EDITOR_API_FAILED',
    TIMEOUT            = 'TIMEOUT',

    // 环境类错误 —— 需要用户介入
    PERMISSION_DENIED  = 'PERMISSION_DENIED',
    UNSUPPORTED_VERSION = 'UNSUPPORTED_VERSION',
}

// ToolResponse 增加 errorCode 字段
// source/types/mcp.ts
export interface ToolResponse {
    success: boolean;
    data?: any;
    message?: string;
    error?: string;
    errorCode?: ToolErrorCode;  // ★ 新增
    instruction?: string;
    warning?: string;
}

// 错误工厂函数
export function makeError(code: ToolErrorCode, message: string): ToolResponse {
    return { success: false, error: message, errorCode: code };
}
```

---

### 3.5 BaseToolExecutor 基类

**目标：** 消除 12 份几乎相同的 execute() 分发逻辑。

**实现方案：**

```typescript
// source/tools/base-tool.ts
import { ToolDefinition, ToolResponse, ToolExecutor } from '../types';

export abstract class BaseToolExecutor implements ToolExecutor {
    abstract getTools(): ToolDefinition[];

    async execute(toolName: string, args: any): Promise<ToolResponse> {
        const methodName = `handle${toPascalCase(toolName)}`;
        const handler = (this as any)[methodName];
        if (typeof handler !== 'function') {
            return { success: false, error: `Unknown tool: ${toolName}`, errorCode: 'INVALID_ARGS' };
        }
        return handler.call(this, args);
    }
}

function toPascalCase(s: string): string {
    return s.replace(/(^|_|-|\.)[a-z]/g, c => c.slice(-1).toUpperCase());
}
```

工具类简化为：
```typescript
// 继承基类，去掉 execute() 方法，直接实现 handle* 方法
export class NodeToolsV2 extends BaseToolExecutor {
    getTools(): ToolDefinition[] { ... }

    async handleQuery(args: any): Promise<ToolResponse> { ... }
    async handleCreate(args: any): Promise<ToolResponse> { ... }
    async handleModify(args: any): Promise<ToolResponse> { ... }
}
```

---

### 3.6 公共 inputSchema 片段复用

**目标：** 消除各工具中重复定义的公共参数 schema。

**实现方案：**

```typescript
// source/tools/schemas/common.ts
export const CommonSchemas = {
    uuid: {
        type: 'string' as const,
        description: 'Target node UUID'
    },
    uuids: {
        type: 'array' as const,
        items: { type: 'string' as const },
        description: 'Array of UUIDs for batch operations'
    },
    dbPath: {
        type: 'string' as const,
        description: 'Asset database path (db://assets/...)'
    },
    action: (values: string[], description: string) => ({
        type: 'string' as const,
        enum: values,
        description
    })
};
```

工具中使用：
```typescript
import { CommonSchemas } from '../schemas/common';

getTools(): ToolDefinition[] {
    return [{
        name: 'query',
        description: '...',
        inputSchema: {
            type: 'object',
            properties: {
                uuid: CommonSchemas.uuid,
                uuids: CommonSchemas.uuids,
                // 工具专属字段
                pattern: { type: 'string', description: '...' }
            }
        }
    }];
}
```

---

### 3.7 scene.ts 按职责拆分

**目标：** 将 1469 行的 scene.ts 拆分为职责单一的模块，阻止继续膨胀。

**拆分方案：**

```typescript
// source/scene/serializer.ts
// 迁移自 scene.ts:41-118，改为 import 自 utils/serializer.ts
export { safeSerialize } from '../utils/serializer';

// source/scene/node-registry.ts
// 迁移自 scene.ts 的 findNodeByUuid 及节点遍历逻辑
export function findNodeByUuid(root: any, uuid: string): any { ... }
export function traverseNodes(root: any, callback: (node: any) => void): void { ... }

// source/scene/animation-context.ts
// 迁移自 scene.ts 的动画消息常量 + runAnimationOperations + 上下文管理
export const SCENE_ANIM_MSG = { ... };
export async function prepareAnimationEditContext(...): Promise<void> { ... }
export async function runAnimationOperations(...): Promise<any> { ... }

// source/scene/editor-fallback.ts
// 迁移自 scene.ts 的 tryEditorThenEngine
export async function tryEditorThenEngine<T>(...): Promise<T> { ... }

// source/scene/index.ts
// 统一 export，Cocos Creator 仍注册 scene/index.ts 为场景脚本入口
export * from './serializer';
export * from './node-registry';
export * from './animation-context';
export * from './editor-fallback';
// 场景方法注册（原 scene.ts 的 methods 对象）
export const methods = { ... };
```

---

### 3.8 请求日志中间件

**目标：** 统一记录工具调用的入参、出参、耗时，受 enableDebugLog 开关控制。

**实现方案（在 mcp-server.ts 的 executeToolCall 中）：**

```typescript
private async executeToolCall(toolName: string, args: any): Promise<ToolResponse> {
    const startTime = Date.now();
    if (this.settings.enableDebugLog) {
        console.log(`[MCP] → ${toolName}`, JSON.stringify(args));
    }

    let response: ToolResponse;
    try {
        response = await this.dispatchTool(toolName, args);
    } catch (err) {
        response = { success: false, error: String(err), errorCode: ToolErrorCode.EDITOR_API_FAILED };
    }

    if (this.settings.enableDebugLog) {
        const elapsed = Date.now() - startTime;
        const status = response.success ? 'OK' : `FAIL(${response.errorCode ?? 'UNKNOWN'})`;
        console.log(`[MCP] ← ${toolName} ${status} ${elapsed}ms`);
    }

    return response;
}
```

---

### 3.9 Promise 包装反模式清理

**目标：** 全面使用 async/await，消除不必要的 Promise 包装。

**重构前：**
```typescript
private async handleQuery(args: any): Promise<ToolResponse> {
    return new Promise((resolve) => {
        Editor.Message.request('scene', 'query-node', args.uuid)
            .then((result: any) => {
                resolve({ success: true, data: result });
            })
            .catch((err: Error) => {
                resolve({ success: false, error: err.message });
            });
    });
}
```

**重构后（配合 editor-bridge）：**
```typescript
private async handleQuery(args: any): Promise<ToolResponse> {
    try {
        const data = await SceneMessages.queryNode(args.uuid);
        return { success: true, data };
    } catch (err) {
        return makeError(ToolErrorCode.NODE_NOT_FOUND, (err as Error).message);
    }
}
```

---

### 3.10 清理 v1 遗留文件

`source/tools/prefab-tools.ts`（v1 版本）已被 `source/tools/v2/prefab-tools.ts` 替代，需确认后删除。

---

## 四、实施计划

### 阶段划分原则

- 每个阶段独立可发布，不影响现有功能
- 优先处理高影响、低风险的基础设施建设
- 工具文件的重构放在基础设施稳定后进行

### 阶段一：基础设施建设（优先级 P0）

**目标：** 建立新的基础模块，不修改现有工具文件。

| 任务 | 说明 | 预估影响文件数 |
|------|------|--------------|
| 创建 `source/utils/serializer.ts` | 合并三处序列化实现 | 新增 1 |
| 创建 `source/utils/error-codes.ts` | 定义 ToolErrorCode | 新增 1 |
| 创建 `source/tools/schemas/common.ts` | 公共 schema 片段 | 新增 1 |
| 创建 `source/tools/base-tool.ts` | BaseToolExecutor 基类 | 新增 1 |
| 拆分 `source/types/` | 类型分层（向后兼容） | 修改 1，新增 4 |

**验收标准：** 编译通过，现有工具行为不变。

### 阶段二：Editor Bridge 层（优先级 P0）

**目标：** 建立统一的 Cocos Editor API 封装层。

| 任务 | 说明 | 预估影响文件数 |
|------|------|--------------|
| 创建 `source/editor-bridge/message-constants.ts` | 提取所有消息名常量 | 新增 1 |
| 创建 `source/editor-bridge/scene-messages.ts` | 封装 scene channel | 新增 1 |
| 创建 `source/editor-bridge/asset-messages.ts` | 封装 asset-db channel | 新增 1 |
| 创建 `source/editor-bridge/preferences-messages.ts` | 封装 preferences channel | 新增 1 |
| 创建 `source/editor-bridge/builder-messages.ts` | 封装 builder channel | 新增 1 |

**验收标准：** bridge 层编译通过，类型完整（无 any 残留）。

### 阶段三：scene.ts 拆分（优先级 P1）

**目标：** 将 scene.ts 重构为 scene/ 目录的多模块结构。

| 任务 | 说明 |
|------|------|
| 创建 `source/scene/` 目录结构 | index.ts + 4 个子模块 |
| 迁移序列化逻辑 → `serializer.ts` | 改用 utils/serializer |
| 迁移节点查找逻辑 → `node-registry.ts` | |
| 迁移动画上下文逻辑 → `animation-context.ts` | |
| 迁移 fallback 逻辑 → `editor-fallback.ts` | |
| 更新 `package.json` 场景脚本入口 | 指向 scene/index.ts |

**验收标准：** 场景相关操作全部正常，动画工具功能不回归。

### 阶段四：工具文件重构（优先级 P1-P2）

**目标：** 逐个工具文件接入新基础设施，消除重复代码。

按照影响范围从小到大的顺序重构：

| 顺序 | 工具文件 | 重构内容 |
|------|----------|----------|
| 1 | `undo-tools.ts`（86 行）| 继承 BaseToolExecutor，async/await |
| 2 | `array-property-tools.ts`（90 行）| 同上 |
| 3 | `scene-script-tools.ts`（142 行）| 同上，替换 serializeResult |
| 4 | `preferences-tools.ts`（207 行）| 同上，接入 editor-bridge |
| 5 | `project-tools.ts`（331 行）| 同上 |
| 6 | `prefab-tools.ts`（438 行）| 同上 |
| 7 | `animation-tools.ts`（419 行）| 同上，接入 animation-context |
| 8 | `debug-tools.ts`（578 行）| 同上 |
| 9 | `scene-tools.ts`（495 行）| 同上 |
| 10 | `asset-tools.ts`（1266 行）| 同上，接入 asset-messages |
| 11 | `node-tools.ts`（1541 行）| 同上 |
| 12 | `component-tools.ts`（2132 行）| 同上，替换 serializeToolResult |

**验收标准：** 每个工具重构后，对应功能的手动测试通过，无行为回归。

### 阶段五：日志与收尾（优先级 P2）

| 任务 | 说明 |
|------|------|
| 在 `mcp-server.ts` 添加请求日志中间件 | 受 enableDebugLog 控制 |
| ToolResponse 增加 errorCode 字段 | 结构化错误输出 |
| 删除 `source/tools/prefab-tools.ts`（v1）| 确认无引用后删除 |
| 更新 README，说明新的工具开发规范 | |

---

## 五、优化效果预估

| 指标 | 现状 | 优化后 |
|------|------|--------|
| 魔法字符串 API 调用处数 | ~100 处 | 0（全部收敛到 editor-bridge）|
| 序列化实现数量 | 3 份（行为不一致）| 1 份（统一参数化）|
| 重复 Promise 包装代码 | ~200 行 | 0 |
| execute() 分发样板代码 | 12 份 switch 语句 | BaseToolExecutor 统一处理 |
| scene.ts 体积 | 1469 行（单文件）| ~200 行/模块（5 个文件）|
| 新增工具所需了解文件数 | 5-6 个 | 2-3 个（base-tool + domain types + bridge）|
| 错误可诊断性 | 仅有 message 字符串 | errorCode + message 分级 |

---

## 六、新工具开发规范（优化后）

优化完成后，新增工具的标准流程：

1. **定义 domain 类型**：在 `source/types/domain.ts` 补充相关接口
2. **添加 Editor 消息**：在 `source/editor-bridge/` 对应文件添加类型化封装
3. **创建工具文件**：继承 `BaseToolExecutor`，实现 `getTools()` 和 `handle*()` 方法
4. **复用公共 schema**：用 `CommonSchemas` 中的片段组合 inputSchema
5. **使用统一错误码**：返回 `makeError(ToolErrorCode.XXX, message)` 而非裸对象
6. **注册工具**：在 `mcp-server.ts` 的 `initializeTools()` 中实例化
7. **场景侧逻辑**：新增到 `source/scene/` 对应模块，而非追加到 index.ts

---

*文档维护：随实施进度更新各阶段完成状态*
