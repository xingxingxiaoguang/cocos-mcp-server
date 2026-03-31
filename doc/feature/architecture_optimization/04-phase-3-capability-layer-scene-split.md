# Step 3: Capability Layer 建设与 `scene.ts` 拆分

> 前置依赖：Step 2  
> 预计改动量：大  
> 目标：建立 `tools -> use-cases -> capabilities -> drivers -> messages` 的稳定分层，并完成 `scene.ts` 的职责拆分与 facade 保留

---

## 0. 执行上下文

本文件应当被视为“可单独执行”的 Step 3 实施说明。新会话执行时，不应依赖历史对话记忆，默认只依赖仓库当前代码和以下事实：

- Step 0、Step 1、Step 2 已完成或至少其关键产物已可用：
  - `source/ipc/contracts.ts`
  - `source/services/tool-registry.ts`
  - `source/utils/serializer.ts`
  - `source/utils/error-codes.ts`
  - `source/tools/base-tool.ts`
  - `source/types/` 分层
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

- `messages/` 只保留原始 request
- `drivers/` 处理版本差异与 fallback
- `capabilities/` 暴露稳定语义能力
- `application/use-cases/` 承载业务编排

### 0.2 本 Step 的输出

完成后必须能明确交付：

- `tools` 不再关心底层 message 名、版本差异、fallback
- 至少 `preferences/project/animation` 三个低风险领域完成“tool -> use-case -> capability -> driver -> message”贯通
- `source/scene.ts` 已稳定为 facade
- `scene/` 拆分后的职责边界清晰，可被 driver 复用，但不反向暴露给 tool

### 0.3 执行纪律

- 不接受只有 `Editor.Message.request(...)` 包装的“伪抽象”
- 不允许把复杂业务编排塞进 `messages/` 或 `drivers/`
- 不允许为了迁移方便，让 `tools` 直接调用 `capability-registry` 之外的底层实现细节

---

## 1. 背景

### 1.1 项目背景

当前的问题不是只有 Editor API 魔法字符串分散，而是“工具业务”和“底层 API 对接”仍然混在一起：

- 工具文件里直接写 `Editor.Message.request('scene' | 'asset-db' | 'preferences' | 'builder', ...)`
- 参数编排、返回值适配、fallback、版本兼容逻辑散落在工具内
- `scene.ts` 同时承载 scene 注册入口、节点查询、序列化、动画上下文和 Editor/Engine fallback
- 如果只做 message wrapper，只能解决“字符串集中”，不能解决 tools 继续膨胀

因此本 Step 的核心不是“把 request 换个位置”，而是建立能力分层边界：

```text
tools
  -> use-cases
    -> capabilities
      -> drivers
        -> messages
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

---

## 2. 本 Step 交付物

### 2.1 新增文件

```text
source/application/use-cases/
  animation/
  preferences/
  project/

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

source/editor-bridge/runtime-profile.ts
source/editor-bridge/capability-registry.ts
source/editor-bridge/models.ts

source/editor-bridge/messages/
  scene-messages.ts
  asset-messages.ts
  preferences-messages.ts
  builder-messages.ts
  project-messages.ts

source/editor-bridge/drivers/cocos-3_8/
  animation-driver.ts
  preferences-driver.ts
  project-driver.ts
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
- 直接依赖 `scene/asset-db/preferences/builder` message 名
- 多步 Editor API 编排
- 版本兼容判断
- Editor API / Engine API fallback

### 3.2 `application/use-cases` 层职责

承载工具业务核心逻辑，表达“我要完成什么”，不表达“怎么接 Editor API”。

建议试点 use-case：

- `QueryPreferencesUseCase`
- `ModifyPreferencesUseCase`
- `QueryProjectInfoUseCase`
- `QueryProjectSettingsUseCase`
- `GetAnimationClipInfoUseCase`
- `EditAnimationClipUseCase`

### 3.3 `capabilities` 层职责

`capabilities` 对 `use-cases` 暴露稳定语义能力，不泄漏底层 message 或参数差异。

例如：

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

要求：

- capability 方法名必须是语义能力，而不是 request 包装
- capability 返回统一 bridge model / domain model
- capability 不向上暴露具体版本差异

### 3.4 `drivers` 层职责

`drivers` 负责真正的版本和引擎对接逻辑：

- message 名差异
- 参数顺序差异
- API 是否存在
- Editor API 与 Engine API fallback
- 多次 Editor 调用编排

建议按版本目录组织：

```text
source/editor-bridge/drivers/cocos-3_8/
```

后续如果出现新版本，再新增 `cocos-3_9/` 或其他 driver，而不是回头污染 tools。

### 3.5 `messages` 层职责

`messages` 是最底层薄封装：

- channel 常量
- message 常量
- 原始 request

这里只做协议透传，不做业务判断。

---

## 4. Runtime Profile 与 Capability Registry

### 4.1 Runtime Profile

新增 `runtime-profile.ts`，用于识别当前 Cocos 版本和能力开关：

```typescript
interface RuntimeProfile {
  cocosVersion: string;
  features: {
    animationQueryClip: boolean;
    animationPropertyQuery: boolean;
    projectQueryConfig: boolean;
    builderWorkerReady: boolean;
  };
}
```

要求：

- 启动时建立一次 profile
- 不允许每个工具自行探测版本能力
- profile 作为 driver 选择依据

### 4.2 Capability Registry

新增 `capability-registry.ts`，按 profile 选择 driver 并暴露 capability service：

```typescript
const registry = createCapabilityRegistry(profile);
registry.animation.getClipInfo(...)
```

作用：

- 统一 driver 选择入口
- 后续新版本接入时不影响 tools 和 use-cases
- 让 capability service 与 driver 解耦

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
- 读写偏好设置的多步逻辑迁入 use-case / capability
- 不再直接依赖 `preferences` message

### 6.2 `project-tools.ts`

重构目标：

- 项目信息查询、project config 提取、builder 状态查询下沉到 capability
- 文件读取与 Editor API fallback 统一在 driver / capability 中处理

### 6.3 `animation-tools.ts`

重构目标：

- clip 解析、asset 解析、scene script 调度、编辑上下文切换都下沉到 capability / driver
- tool 本身只保留动作边界
- 为 Step 4 的 `scene/node/component/prefab` 重型迁移提供模板

---

## 7. 执行步骤

### 7.1 先落目录和接口

先补齐：

- `application/use-cases/`
- `capabilities/interfaces/`
- `capabilities/services/`
- `editor-bridge/runtime-profile.ts`
- `editor-bridge/capability-registry.ts`
- `editor-bridge/messages/`
- `editor-bridge/drivers/`

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
2. 盘点 `source/editor-bridge/` 当前已有文件，判断哪些属于 `messages`，哪些其实应迁到 `drivers`。
3. 盘点 `preferences/project/animation` 三个领域中：
   - tool 里还残留多少底层对接逻辑
   - 是否已有可复用的 adapter / service / helper
4. 先落 capability interface 和 use-case 边界，再开始具体迁移。

---

## 8. 验收标准

### L1 编译验证

```bash
npm run build
```

### L2 分层边界验证

至少验证：

- `tools` 中不再出现 `Editor.Message.request(...)`
- `tools` 中不再出现 `scene/asset-db/preferences/builder` message 名
- `use-cases` 只依赖 capability interface
- `capabilities` 不向上泄漏 message 常量和版本细节

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

- [ ] 已建立 `tools -> use-cases -> capabilities -> drivers -> messages` 分层骨架
- [ ] 已新增 `runtime-profile` 与 `capability-registry`
- [ ] 已完成 `scene/` 拆分并保留 `source/scene.ts` facade
- [ ] 至少 3 个低风险工具已改为调用 use-case / capability
- [ ] tools 层已不再关注底层版本差异和 Editor 魔法字符串

---

## 9. 风险与回滚

### 主要风险

- capability interface 设计过于贴近当前实现，后续仍然变成 message wrapper
- use-case 与 capability 边界不清，导致业务逻辑再次回流到 tools
- `scene.ts` facade 调整导致 Cocos 场景脚本加载异常

### 回滚建议

- `scene.ts` facade 改动单独提交
- `runtime-profile / capability-registry` 与具体工具迁移分开提交
- 每个试点工具单独提交，出问题可按领域回滚，而不是整体回滚 Step 3
