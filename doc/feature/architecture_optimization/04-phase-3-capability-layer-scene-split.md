# Step 3: 三层 Capability 架构建设与 `scene.ts` 拆分

> 前置依赖：Step 2  
> 预计改动量：大  
> 目标：建立 `tools -> capabilities -> contract/driver` 的稳定三层架构，并完成 `scene.ts` 的职责拆分与 facade 保留

---

## 0. 执行上下文

本文件应当被视为“可单独执行”的 Step 3 实施说明。新会话执行时，不应依赖历史对话记忆，默认只依赖仓库当前代码和以下事实：

- Step 0、Step 1、Step 2 已完成或至少其关键产物已可用：
  - `source/ipc/contracts.ts`
  - `source/services/tool-registry.ts`
  - `source/utils/serializer.ts`
  - `source/utils/error-codes.ts`
  - `source/tools/base-tool.ts`
  - `source/types/` 已完成 Step 2 的过渡性拆分，并保留兼容 re-export
- `source/scene.ts` 仍是 Cocos scene 脚本入口，执行本 Step 时必须保留 facade 形态，不允许删除
- 仓库中如果已经存在“半成品 bridge / adapter / message wrapper”，应优先重组归位，而不是继续在旧结构上叠加一层

### 0.1 本 Step 的输入

执行时默认从以下现状出发：

- `tools/v2/` 中仍有工具直接感知底层 Editor API 或散落的适配逻辑
- `scene.ts` 相关逻辑已经部分拆分或准备拆分，但边界未完全收紧
- 仓库可能已经存在：
  - `source/editor-bridge/`
  - `source/scene/`
  - 少量低风险工具试点迁移

如果这些目录已经存在，目标不是回退重做，而是重构成本文定义的最终分层：

- `editor-bridge/<domain>/contract.ts` 定义桥接契约
- `editor-bridge/<domain>/driver.ts` 处理 Editor 对接、版本差异与 fallback
- `capabilities/` 暴露稳定语义能力
- `tools/` 只保留入口层职责，不再持有复杂业务编排

### 0.2 本 Step 的输出

完成后必须能明确交付：

- `tools` 不再关心底层 message 名、版本差异、fallback
- 至少 `preferences/project/animation` 三个低风险领域完成“tool -> capability -> contract -> driver”贯通
- `source/scene.ts` 已稳定为 facade
- `scene/` 拆分后的职责边界清晰，可被 driver 复用，但不反向暴露给 tool

### 0.3 执行纪律

- 不接受只有 `Editor.Message.request(...)` 包装的“伪抽象”
- 不允许把复杂业务编排塞进 `driver`
- 不允许为了迁移方便，让 `tools` 直接调用 `capability-registry` 之外的底层实现细节
- 当前项目默认不单独引入 `use-case` 层；只有在出现明确、稳定、可复用的跨 capability 编排时，才重新评估是否需要新增该层
- 当前迁移基线只支持 Cocos Creator `3.8.x`，不为未来版本预建多套 driver、目录层级或抽象包装
- `builder` 相关能力与 `open-tool-manager` / 遗留面板入口不纳入本 Step 的试点与验收范围
- `source/types/` 垃圾桶治理是本 Step 的同步目标，不是后置清理项：新引入的 capability model、bridge model、shared type 必须按层归位，不得继续落到 `source/types/`
- `editor-bridge` 默认不单独拆 `messages/` 层，也不默认按版本建立 driver 文件夹；只有在协议复用或版本分叉达到实际复杂度阈值时，才允许升级结构

---

## 1. 背景

### 1.1 项目背景

当前的问题不是只有 Editor API 魔法字符串分散，而是“工具业务”和“底层 API 对接”仍然混在一起：

- 工具文件里直接写 `Editor.Message.request('scene' | 'asset-db' | 'preferences' | ...)`
- 参数编排、返回值适配、fallback、版本兼容逻辑散落在工具内
- `scene.ts` 同时承载 scene 注册入口、节点查询、序列化、动画上下文和 Editor/Engine fallback
- 如果只做 message wrapper，只能解决“字符串集中”，不能解决 tools 继续膨胀

因此本 Step 的核心不是“把 request 换个位置”，而是建立能力分层边界：

```text
tools
  -> capabilities
    -> contract
      -> driver
        -> Editor / Engine
```

### 1.2 目标架构

```
┌──────────────▼──────────────────────────────────────────┐
│                 MCP / Tool 入口层                        │
│  mcp-server.ts                                           │
│  tools/v2/  ─  只做入参校验 / action 路由 / ToolResponse │
└──────────────┬──────────────────────────────────────────┘
               │
┌──────────────▼──────────────────────────────────────────┐
│                  Capability / Service 层                 │
│  capabilities/interfaces  ─  稳定语义能力接口            │
│  capabilities/services    ─  统一能力服务与业务编排      │
└──────────────┬──────────────────────────────────────────┘
               │
┌──────────────▼──────────────────────────────────────────┐
│             Editor Bridge / Contract / Driver 层         │
│  runtime-profile / capability-registry                   │
│  <domain>/contract.ts ─ bridge 契约                      │
│  <domain>/driver.ts   ─ Editor 对接 / fallback / 分支    │
└──────────────┬──────────────────────────────────────────┘
               │
┌──────────────▼──────────────────────────────────────────┐
│                    场景进程层（scene/）                   │
│  methods  node-registry  animation-context               │
│  serialization  editor-fallback                          │
└─────────────────────────────────────────────────────────┘
```

---

## 2. 本 Step 交付物

### 2.1 新增文件

```text
source/shared/types/
  json.ts

source/capabilities/models/
  preferences.ts
  project.ts
  animation.ts

source/capabilities/interfaces/
  animation.ts
  preferences.ts
  project.ts
  scene.ts
  asset.ts

source/capabilities/services/
  animation-service.ts
  preferences-service.ts
  project-service.ts

source/editor-bridge/runtime/
  profile.ts
  registry.ts

source/editor-bridge/preferences/
  contract.ts
  driver.ts

source/editor-bridge/project/
  contract.ts
  driver.ts

source/editor-bridge/animation/
  contract.ts
  driver.ts
```

### 2.2 继续保留并完成拆分的文件

```text
source/scene/methods.ts
source/scene/node-registry.ts
source/scene/animation-context.ts
source/scene/editor-fallback.ts
source/scene/serialization.ts
source/scene.ts
```

### 2.3 本 Step 试点迁移范围

```text
source/tools/v2/preferences-tools.ts
source/tools/v2/project-tools.ts
source/tools/v2/animation-tools.ts
```

说明：

- 本 Step 不追求把所有工具都迁完。
- 本 Step 的目标是建立“可复制的能力分层模板”。
- 本 Step 必须同步把新三层涉及的类型从 `source/types/` 分流出去，为 Step 4 删除历史垃圾桶铺路。
- 后续重型工具迁移放到 Step 4。

---

## 3. 目标分层

### 3.1 `tools` 层职责

`tools` 层只负责：

- MCP tool 定义
- 入参校验
- action 路由
- `ToolResponse` 输出

`tools` 层禁止继续承担：

- 直接调用 `Editor.Message.request(...)`
- 直接依赖 `scene/asset-db/preferences` 等底层 message 名
- 多步 Editor API 编排
- 版本兼容判断
- Editor API / Engine API fallback

### 3.2 `capabilities` 层职责

`capabilities` 对 `tools` 暴露稳定语义能力，不泄漏底层 message 或参数差异。

能力层负责：

- 领域级能力语义定义
- 多步业务编排
- 跨多个 bridge 调用的统一收口
- 稳定结果模型输出
- 对 tool 隐藏版本差异与底层 fallback

例如：

```typescript
interface PreferencesCapability {
  query(input: QueryPreferencesInput): Promise<QueryPreferencesResult>;
  modify(input: ModifyPreferencesInput): Promise<ModifyPreferencesResult>;
}
```

要求：

- capability 方法名必须是语义能力，而不是 request 包装
- capability 只依赖稳定的 capability 输入 / 输出模型，而不是 bridge 内部契约
- capability 不向上暴露具体版本差异

### 3.3 `editor-bridge/<domain>/contract.ts` 职责

`contract.ts` 负责定义该领域在 bridge 层的最小稳定契约。

负责内容：

- driver interface
- bridge 输入输出模型
- 少量 bridge 级 ref / spec

禁止内容：

- `ToolResponse`
- MCP schema
- capability 输入 / 输出模型
- message 常量
- runtime registry 逻辑

### 3.4 `editor-bridge/<domain>/driver.ts` 职责

`driver.ts` 负责真正的 Editor 对接与兼容性收口：

- `Editor.Message.request(...)`
- 参数顺序差异
- API 是否存在
- Editor API 与 Engine API fallback
- 少量版本分支
- 文件系统 / 编辑器环境读取等桥接细节

默认规则：

- 每个领域默认只保留一个 `driver.ts`
- 少量版本差异优先内聚为局部 helper 或条件分支
- 当前只支持 `3.8.x`，默认不为未支持版本预建 `drivers/` 目录或多文件实现
- 只有当同一领域出现明显实现分叉时，才升级为 `drivers/` 目录或 `driver-3_8.ts` / `driver-3_9.ts`

### 3.5 三层架构决策说明

本项目当前采用三层而不是额外引入独立 `use-case` 层，原因如下：

- 当前工具规模下，单独 `use-case` 层会增加阅读跳转成本，但没有稳定带来新的边界价值
- 对 AI 和人工维护而言，`tools -> capabilities -> contract/driver` 的链路更短、更低歧义
- 当前仅支持 `3.8.x`，过早同时引入 `use-case` 与多版本 driver 分叉，只会继续抬高维护复杂度
- 复杂业务编排先沉到 capability service 内部；只有当某个领域出现稳定、可复用、可单测的跨 capability 业务流程时，才考虑额外抽出子模块，而不是默认新增一整层

### 3.6 类型归属治理要求

本 Step 必须同步建立新的类型归属规则，否则三层架构会被旧 `source/types/` 垃圾桶重新污染。

要求：

- `source/shared/types/` 只放跨层安全复用的基础类型，例如 `JsonValue`
- `source/capabilities/models/` 只放 capability 对外暴露的稳定输入 / 输出模型
- `source/editor-bridge/<domain>/contract.ts` 只放该领域的 bridge 契约
- `source/editor-bridge/runtime/` 只放 profile、registry 等运行时基础设施
- 自本 Step 起，新增 capability/bridge/shared 类型禁止继续加入 `source/types/`
- `source/types/` 进入冻结状态，只允许保留尚未迁移的历史类型，不允许继续扩容
- 全局 `editor-bridge/models/` 与全局 `editor-bridge/messages/` 不再作为默认模板继续扩展

---

## 4. Runtime Profile 与 Capability Registry

### 4.1 Runtime Profile

新增 `editor-bridge/runtime/profile.ts`，用于识别当前 Cocos 版本和能力开关：

```typescript
interface RuntimeProfile {
  cocosVersion: string;
  features: {
    animationQueryClip: boolean;
    animationPropertyQuery: boolean;
    projectQueryConfig: boolean;
  };
}
```

要求：

- 启动时建立一次 profile
- 不允许每个工具自行探测版本能力
- 当前只要求覆盖 `3.8.x`；profile 主要用于能力探测、日志和少量分支，不为未来版本预建 driver 分叉

### 4.2 Capability Registry

新增 `editor-bridge/runtime/registry.ts`，按 profile 选择 driver 并暴露 capability service：

```typescript
const registry = createCapabilityRegistry(profile);
registry.animation.getClipInfo(...)
```

作用：

- 统一 driver 选择入口
- 后续新版本接入时不影响 tools 和 capabilities
- 让 capability service 与 driver 解耦
- 默认模板下 registry 只负责“领域 driver 实例选择”，不承担 message 转发

---

## 5. `scene.ts` 拆分方案

### 5.1 保留 facade

`source/scene.ts` 不删除，继续作为 Cocos scene 脚本稳定入口：

```typescript
export { methods } from './scene/methods';
```

这条约束在 Step 4 完成前不能破坏。

### 5.2 模块职责

- `scene/methods.ts`
  - 场景脚本 methods 聚合入口
- `scene/node-registry.ts`
  - 节点查找、节点遍历
- `scene/animation-context.ts`
  - 动画上下文、Engine fallback、动画编辑状态
- `scene/editor-fallback.ts`
  - `tryEditorThenEngine`
- `scene/serialization.ts`
  - 场景侧序列化工具

### 5.3 拆分原则

1. 先移动实现，再收紧依赖边界。
2. facade 先稳定，再做更深层模块内聚。
3. `scene/` 可以服务于 driver，但不能反向被 tool 直接依赖。

---

## 6. 试点迁移策略

### 6.1 `preferences-tools.ts`

重构目标：

- tool 只保留 action 路由和参数校验
- 读写偏好设置的多步逻辑迁入 capability
- 不再直接依赖 `preferences` message

### 6.2 `project-tools.ts`

重构目标：

- 项目信息查询、project config 提取等逻辑下沉到 capability
- 文件读取与 Editor API fallback 统一在 driver / capability 中处理

### 6.3 `animation-tools.ts`

重构目标：

- clip 解析、asset 解析、scene script 调度、编辑上下文切换都下沉到 capability / contract / driver
- tool 本身只保留动作边界
- 为 Step 4 的 `scene/node/component/prefab` 重型迁移提供模板

---

## 7. 执行步骤

### 7.1 先落目录和接口

先补齐：

- `shared/types/`
- `capabilities/models/`
- `capabilities/interfaces/`
- `capabilities/services/`
- `editor-bridge/runtime/`
- `editor-bridge/<domain>/contract.ts`
- `editor-bridge/<domain>/driver.ts`

### 7.2 再落 capability 试点

优先实现：

- `PreferencesCapability`
- `ProjectCapability`
- `AnimationCapability`

### 7.3 最后迁 tool

迁移顺序：

1. `preferences-tools.ts`
2. `project-tools.ts`
3. `animation-tools.ts`

要求：

- 每个工具迁完后不再直接接触底层 message
- 每个工具迁完后都应明显缩小体积和职责面

### 7.4 新会话执行建议

新会话里建议按以下检查顺序开始，而不是直接写代码：

1. 先确认 `source/scene.ts` 是否仍为 facade。
2. 盘点 `source/editor-bridge/` 当前已有文件，优先把全局 `messages/`、全局 `models/` 收敛到按领域的 `contract.ts + driver.ts`。
3. 盘点 `preferences/project/animation` 三个领域中：
   - tool 里还残留多少底层对接逻辑
   - 是否已有可复用的 adapter / service / helper
4. 先落 capability interface 和 service 边界，再开始具体迁移。
5. 同步把本 Step 新增类型迁出 `source/types/`，不要留下新的 barrel 依赖。

---

## 8. 验收标准

### L1 编译验证

```bash
npm run build
```

### L2 分层边界验证

至少验证：

- `tools` 中不再出现 `Editor.Message.request(...)`
- `tools` 中不再出现 `scene/asset-db/preferences` 等底层 message 名
- `capabilities` 不向上泄漏 bridge 内部契约和版本细节
- `capabilities` 中的业务编排不再回流到 tools
- 本 Step 新增类型已归位到 `shared/types`、`capabilities/models`、`editor-bridge/<domain>/contract.ts` 或 `editor-bridge/runtime/`，不再继续写入 `source/types/`
- `editor-bridge` 默认模板下不再新增全局 `messages/` 和全局 `models/`

### L3 场景脚本稳定性验证

重点验证：

- `source/scene.ts` facade 仍可正常加载
- `package.json` 中 scene methods 正常执行
- `scene/` 拆分后无 module not found 或导出缺失

### L4 手测

至少手测以下链路：

- preferences：查询一次、修改一次
- project：查询一次项目信息、读取一次 project settings
- animation：查询一次 clip、执行一次最小编辑或保存动作

### 完成标记

- [ ] 已建立 `tools -> capabilities -> contract/driver` 分层骨架
- [ ] 已新增 `editor-bridge/runtime/profile.ts` 与 `editor-bridge/runtime/registry.ts`
- [ ] 已建立新的类型归属目录，并将本 Step 新增类型迁出 `source/types/`
- [ ] 已完成 `scene/` 拆分并保留 `source/scene.ts` facade
- [ ] 至少 3 个低风险工具已改为调用 capability
- [ ] tools 层已不再关注底层版本差异和 Editor 魔法字符串

---

## 9. 风险与回滚

### 主要风险

- capability interface 设计过于贴近当前实现，后续仍然变成 message wrapper
- capability 层承载编排后边界失控，重新变成“大而全服务”
- `editor-bridge` 继续扩张全局 `messages/` 或按版本目录过早分裂，导致桥接层重新变重
- 新架构类型继续写进 `source/types/`，导致 Step 4 迁移时再次出现层污染和重复清理
- `scene.ts` facade 调整导致 Cocos 场景脚本加载异常

### 回滚建议

- `scene.ts` facade 改动单独提交
- `editor-bridge/runtime/` 与具体工具迁移分开提交
- 每个试点工具单独提交，出问题可按领域回滚，而不是整体回滚 Step 3
