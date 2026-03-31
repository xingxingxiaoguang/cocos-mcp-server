# Step 4: Use-Case / Capability 扩展迁移与 Prefab 能力重构

> 前置依赖：Step 3  
> 预计改动量：大  
> 目标：把重型工具逐步迁移到 `use-cases + capabilities + drivers` 架构，并完成 prefab 能力从 v1/v2 混合实现向统一能力模型的收敛

---

## 0. 执行上下文

本文件应被视为“可单独执行”的 Step 4 实施说明。新会话执行时，不依赖历史对话，只依赖仓库代码与以下 Step 3 产物已经存在或至少具备骨架：

- `application/use-cases/`
- `capabilities/interfaces/`
- `capabilities/services/`
- `editor-bridge/runtime-profile.ts`
- `editor-bridge/capability-registry.ts`
- `editor-bridge/messages/`
- `editor-bridge/drivers/`
- `source/scene.ts` facade 与 `source/scene/` 拆分结构

如果 Step 3 只完成了部分骨架，必须先补齐最小骨架后，再进入本 Step。不要在没有 capability 边界的前提下直接迁重型工具。

### 0.1 本 Step 的输入

执行时默认面对的现状：

- `scene-tools.ts`、`asset-tools.ts`、`node-tools.ts`、`component-tools.ts`、`prefab-tools.ts` 仍然体量大、职责杂
- 某些工具可能已经接入了部分 bridge，但仍保留大量底层 API 编排
- `prefab` 领域仍可能存在 v1/v2 交叉实现、legacy helper 或兼容委托

### 0.2 本 Step 的输出

完成后必须交付：

- 重型领域已有稳定 capability interface
- tool 只负责入口层职责，不再承载大段底层编排
- `prefab` 领域已形成独立的 use-case / capability / driver 链路
- legacy prefab 依赖被剪除

### 0.3 执行纪律

- 不允许跨多个重型领域混改成一个提交
- 不允许只把旧逻辑搬文件位置，不重构边界
- 不允许在 prefab 迁移时重新把 scene / asset / node 底层细节硬编码回单个工具文件

---

## 1. 背景

Step 3 解决的是“分层骨架”和“低风险试点”。  
Step 4 要解决的是真正会拖垮维护成本的重型领域：

- `scene-tools.ts`
- `asset-tools.ts`
- `node-tools.ts`
- `component-tools.ts`
- `prefab-tools.ts`

这个阶段的重点不再是“把工具切到 bridge”，而是：

- 把工具业务编排稳定沉到 use-case
- 把统一能力沉到 capability
- 把版本/引擎差异沉到 driver
- 让 `tools` 文件不再随着领域复杂度线性膨胀

---

## 2. 本 Step 总体策略

按“领域能力”分批迁移，而不是按“文件逐个改成 async/await”推进。

| Wave | 领域 | 目标 |
|------|------|------|
| Wave A | `scene` + `asset` | 建立重型领域 capability 模板 |
| Wave B | `node` + `component` | 处理高耦合业务编排 |
| Wave C | `prefab` | 彻底收敛 v1/v2 实现并退役 legacy |
| Wave D | `debug` / 其余辅助工具 | 接入统一日志语义与错误码 |

---

## 3. 迁移模板

每个领域统一按以下顺序推进：

1. 定义 capability interface
2. 定义 use-case 输入输出
3. 抽 driver 内的版本/Editor API 对接逻辑
4. 将 tool 改为 use-case 调用方
5. 删除该领域内的散落 `Editor.Message.request(...)`
6. 补 smoke test 或手测记录

要求：

- 不允许只迁 message wrapper，不迁业务编排边界
- 不允许把 driver 逻辑伪装成 use-case
- 不允许工具文件继续保留多步 Editor API 编排

---

## 4. Wave A：`scene` 与 `asset`

### 4.1 `SceneCapability`

建议提供的稳定能力：

- `querySceneTree()`
- `queryNode(ref)`
- `createNode(input)`
- `openScene(sceneRef)`
- `saveScene()`
- `executeSceneScript(input)`

driver 负责：

- `scene` channel message 差异
- 是否需要走 scene script fallback
- 场景 ready / dirty / snapshot 等底层差异

### 4.2 `AssetCapability`

建议提供的稳定能力：

- `resolveAsset(ref)`
- `queryAssets(pattern)`
- `readAsset(ref)`
- `writeAsset(input)`
- `createAsset(input)`
- `moveAsset(input)`
- `deleteAsset(input)`

driver 负责：

- `asset-db` 不同 message 差异
- url / uuid / path 的互转细节
- meta 与 asset 的读写差异

### 4.3 首批迁移目标

优先迁：

- `scene-tools.ts`
- `asset-tools.ts`

原因：

- 这两个领域是 `node/component/prefab` 的基础依赖
- 如果先不稳定，后续高耦合领域会重复返工

---

## 5. Wave B：`node` 与 `component`

### 5.1 `NodeCapability`

建议能力：

- `queryNode(uuid)`
- `queryNodeTree()`
- `createNode(input)`
- `removeNode(uuid)`
- `duplicateNode(uuid)`
- `setParent(input)`
- `setProperty(input)`

### 5.2 `ComponentCapability`

建议能力：

- `listComponents()`
- `queryNodeComponents(nodeRef)`
- `createComponent(input)`
- `removeComponent(input)`
- `setComponentProperty(input)`
- `resetComponent(ref)`
- `executeComponentMethod(input)`

### 5.3 Use-case 边界

这一波最容易出问题的是“节点和组件的组合动作”。

建议把以下逻辑明确放进 use-case，而不是 capability：

- 创建节点后立即挂组件
- 查找目标节点后批量修改多个组件字段
- 组件 fallback 创建策略
- 组件属性 patch 的业务规则

原因：

- 这些属于业务编排，不属于单一底层能力
- 如果塞进 capability，会让 capability 重新变成“大杂烩服务”

---

## 6. Wave C：Prefab 能力统一重构

### 6.1 当前问题

`PrefabToolsV2` 仍通过 legacy v1 类或等价旧路径委托部分行为，导致：

- prefab 能力边界不清
- v1/v2 同时存在
- prefab 业务规则、scene 操作、asset 写入逻辑耦合在一起

### 6.2 迁移目标

不是简单“把旧文件删掉”，而是形成稳定的 prefab 领域能力：

- `PrefabCapability`
- `PrefabUseCases`
- `PrefabDriver`

### 6.3 建议目录

```text
source/application/use-cases/prefab/
  create-prefab.ts
  duplicate-prefab.ts
  instantiate-prefab.ts
  apply-prefab.ts
  revert-prefab.ts

source/capabilities/interfaces/prefab.ts
source/capabilities/services/prefab-service.ts

source/editor-bridge/drivers/cocos-3_8/prefab-driver.ts
```

### 6.4 PrefabCapability 建议能力

- `createFromNode(input)`
- `duplicate(input)`
- `instantiate(input)`
- `apply(input)`
- `revert(input)`
- `queryPrefab(ref)`

### 6.5 PrefabUseCase 职责

use-case 负责：

- 业务前置条件校验
- prefab 与 scene / asset / node capability 的组合编排
- 创建后结果模型组装
- duplicate / instantiate / apply / revert 的业务流程

driver 负责：

- 底层 prefab 消息或替代策略
- asset-db 与 scene 协议对接
- 不同版本下 prefab 连接方式差异

### 6.6 退役标准

完成后必须满足：

- `source/tools/prefab-tools.ts` 删除
- `legacyPrefabTools` 或等价 legacy 委托归零
- prefab 相关调用只走 capability / use-case 链路

---

## 7. Wave D：Debug 与辅助工具

目标：

- 接入统一错误码与请求日志语义
- 让 debug 工具消费 capability，而不是继续直连底层 API
- 把高噪声日志和敏感参数截断规则统一到 Step 5 的日志体系

可迁移范围：

- `debug-tools.ts`
- `undo-tools.ts`
- `array-property-tools.ts`
- `scene-script-tools.ts`

说明：

- 这些工具不一定最复杂，但适合补齐统一标准
- 如果它们仍然旁路直连，会破坏整体架构纪律

---

## 8. 执行顺序

严格按以下顺序：

1. `scene` capability + use-case
2. `asset` capability + use-case
3. `node` capability + use-case
4. `component` capability + use-case
5. `prefab` capability + use-case，退役 v1
6. `debug` / 其他辅助工具收尾

原因：

- `node/component/prefab` 都强依赖 `scene/asset`
- prefab 是最复杂、最容易返工的领域，必须在依赖能力稳定后再动

### 8.1 新会话执行建议

新会话中建议先做下面的盘点，再决定实际落刀顺序：

1. 统计 5 个重型工具里仍残留的 `Editor.Message.request(...)` 数量与分布。
2. 确认 `scene` / `asset` capability 是否已经足够支撑 `node/component/prefab`。
3. 对 `prefab-tools.ts` 做一次专门审查：
   - 是否仍有 legacy import
   - 是否仍有隐藏的 v1 helper 依赖
   - duplicate / instantiate / apply / revert 各动作目前真实走哪条路径
4. 只有在 `scene` 与 `asset` 能力稳定后，才进入 prefab 退役。

---

## 9. 验收标准

### L1 编译验证

```bash
npm run build
```

### L2 架构边界验证

至少验证：

- 重型工具中不再直接出现 `Editor.Message.request(...)`
- `scene-tools.ts`、`asset-tools.ts`、`node-tools.ts`、`component-tools.ts`、`prefab-tools.ts` 均已通过 use-case / capability 调用
- capability interface 不泄漏 message 名和底层 channel
- driver 成为版本差异唯一收口层

### L3 MCP 验证

验证 `tools/list` 与关键调用仍可用。

### L4 手测

最少覆盖：

- scene：打开 / 保存 / 查询层级
- asset：查询 / 创建 / 写入
- node：创建 / 删除 / 设父级 / 查询
- component：添加 / 删除 / 改属性
- prefab：创建 / 实例化 / apply / revert / duplicate

### 完成标记

- [ ] `scene` 与 `asset` 已迁入 capability / use-case
- [ ] `node` 与 `component` 已迁入 capability / use-case
- [ ] prefab 领域已建立独立 capability / use-case / driver
- [ ] `source/tools/prefab-tools.ts` 与 legacy 依赖已删除
- [ ] 重型工具已不再因底层 API 差异膨胀

---

## 10. 风险与回滚

### 主要风险

- use-case 设计不足，导致业务逻辑仍然回流到 tool
- capability 粒度过粗，重新形成“大而全服务”
- prefab 迁移时把 asset / scene / node 逻辑重新硬编码进一个文件

### 回滚建议

- 每个领域单独提交，不跨领域混改
- prefab 退役与其他领域迁移拆开提交
- 出现问题优先回滚某个领域的 capability/use-case 接线，不回滚底层 messages 骨架
