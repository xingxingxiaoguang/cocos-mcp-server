# 04 - MCP 工具开发实战发现（马里奥 Demo 全流程）

> 通过 MCP 工具从零搭建马里奥 2D 平台跳跃游戏关卡，完整覆盖：场景清理 → 节点创建 → 组件配置 → Prefab 工作流 → 脚本挂载 → UI 搭建 → 调试验证 → 预览运行。以下是发现的工具不足与改进建议。

---

## 一、现有工具的不足（按严重程度排序）

### P0 — 影响基本可用性

#### 1. `node_create` 创建 Sprite 节点时不自动分配 SpriteFrame

**现象：** 通过 `node_create` + `components: ["cc.Sprite"]` 创建的节点，Sprite 组件的 `spriteFrame` 为空，运行时完全不渲染（黑屏）。需要额外查询内置资源 UUID 再逐个调用 `component_modify` 设置。

**影响：** 本次开发中创建了 20+ 个 Sprite 节点，全部黑屏。排查耗时极长。

**建议修复：**
- `node_create` 添加 Sprite 组件时，自动分配 `db://internal/default_ui/default_sprite` 的 SpriteFrame
- 同时将 `sizeMode` 设为 `CUSTOM(0)`，否则节点会按图片原始尺寸（2x2 像素）显示而非 UITransform 的 contentSize
- 参考引擎行为：在编辑器中手动添加 Sprite 组件会自动分配默认 SpriteFrame

#### 2. `component_modify set` 无法设置 Canvas 的 cameraComponent 引用

**现象：** Canvas 组件的 `cameraComponent` 属性引用了一个不存在的组件 UUID，导致运行时 `Camera._createCamera` 崩溃（`Cannot read properties of null (reading 'name')`）。尝试用 `component_modify` 修复时，传入组件 UUID 报 `Target node not found`。

**影响：** 只能通过 `debug_execute` 在运行时修复，但运行时修复无法可靠持久化。

**建议修复：**
- `component_modify set` 的 `propertyType: "component"` 应支持接受 **组件 UUID**（而非仅节点 UUID）
- 或增加 `propertyType: "cameraComponent"` 专用类型，接受节点 UUID 后自动查找其上的 Camera 组件

#### 3. 缺少批量属性设置能力

**现象：** 配置一个平台节点需要 4 次独立调用：UITransform.contentSize、Sprite.color、RigidBody2D.type、BoxCollider2D.size。本次开发中仅配置关卡节点就执行了 60+ 次 `component_modify`。

**影响：** 效率极低，上下文窗口消耗巨大，AI 交互轮次过多。

**建议新增：** 见下方「新增工具」部分的 `component_batch_set`。

---

### P1 — 影响开发效率

#### 4. `node_create` 不支持同时设置组件属性

**现象：** `node_create` 支持 `components` 参数指定要添加的组件，但无法在创建时一并设置组件属性。创建后必须逐个调用 `component_modify`。

**影响：** 创建一个完整的游戏对象（如敌人节点：Sprite 颜色 + UITransform 尺寸 + RigidBody2D 类型 + BoxCollider2D 尺寸 + 脚本挂载）需要 6-7 次调用。

**建议增强：**
```json
{
  "name": "Enemy_1",
  "components": [
    { "type": "cc.Sprite", "properties": { "color": {"r":180,"g":70,"b":20,"a":255} } },
    { "type": "cc.RigidBody2D", "properties": { "type": 1, "fixedRotation": true } },
    { "type": "cc.BoxCollider2D", "properties": { "size": {"width":34,"height":34} } },
    { "type": "MarioEnemy.ts" }
  ]
}
```

#### 5. `debug_execute` 的修改不被 `scene_save` 持久化

**现象：** 通过 `debug_execute` 修改场景中的组件属性（如批量设置 sizeMode），调用 `scene_save` 后这些修改并未写入场景文件。

**原因：** `debug_execute` 在场景进程的运行时修改对象，但编辑器的序列化系统从自己的内部数据模型写入，两者不同步。

**影响：** 用户误以为修改已保存，实际预览时仍然是旧值。

**建议：**
- 在 `debug_execute` 文档中明确标注：「运行时修改不会被 scene_save 持久化，持久化修改请使用 component_modify」
- 或提供 `debug_execute` 的 `persist: true` 选项，内部通过 `Editor.Message.request('scene', 'set-property', ...)` 将修改同步到编辑器数据模型

#### 6. ~~CC3.x API 兼容性问题~~ （非 MCP 工具问题）

> 注：`Node.setTag()`/`getTag()` 是游戏脚本自身使用了 CC2.x 废弃 API，与 MCP 工具无关。此处仅作为开发过程记录保留。

---

### P2 — 体验优化

#### 7. Prefab 实例化后节点名称不直观

**现象：** `prefab_create instantiate` 创建的节点直接使用 Prefab 名称（如 `Platform`、`Pipe`），而非可区分的名称（如 `Platform_6`、`Pipe_4`）。

**建议：** 实例化后自动追加序号，或支持 `name` 参数覆盖。

#### 8. `component_modify set` 对 RigidBody2D.type 设置不验证

**现象：** 每次设置 `RigidBody2D.type` 返回 `changeVerified: false`，无法确认是否生效。

**原因：** RigidBody2D.type 是枚举类型，编辑器 API 可能在设置后无法立即读回验证。

**建议：** 对已知的枚举属性（type、clearFlags 等）使用枚举名验证或跳过验证并在响应中说明原因。

#### 9. 无法通过 MCP 直接预览/运行场景

**现象：** 完成场景搭建后，只能告诉用户「请在编辑器中点击 Preview」，无法通过工具触发预览。

**建议：** `project_build` 工具的 `preview` action 应支持一键启动浏览器预览。

---

## 二、建议新增的工具

### 1. `component_batch_set` — 批量设置组件属性

**用途：** 一次调用设置一个节点上多个组件的多个属性。

```json
{
  "uuid": "nodeUuid",
  "batch": [
    { "componentType": "cc.UITransform", "properties": { "contentSize": {"width":180,"height":30} } },
    { "componentType": "cc.Sprite", "properties": { "color": {"r":60,"g":160,"b":60,"a":255} } },
    { "componentType": "cc.RigidBody2D", "properties": { "type": 0 } },
    { "componentType": "cc.BoxCollider2D", "properties": { "size": {"width":180,"height":30} } }
  ]
}
```

**收益：** 将 4-6 次调用合并为 1 次，减少 80% 的 MCP 交互轮次。

### 2. `node_batch_create` — 批量创建节点

**用途：** 一次调用创建多个同类或异类节点，每个节点可指定位置、组件和属性。

```json
{
  "parentUuid": "levelRootUuid",
  "nodes": [
    {
      "name": "Coin_1", "position": {"x":350,"y":30,"z":0},
      "components": [
        { "type": "cc.Sprite", "properties": { "color": {"r":255,"g":215,"b":0}, "spriteFrame": "auto" } },
        { "type": "cc.BoxCollider2D", "properties": { "size": {"width":22,"height":22}, "sensor": true } },
        { "type": "MarioCoin.ts" }
      ]
    },
    {
      "name": "Coin_2", "position": {"x":420,"y":30,"z":0},
      "components": "same_as_previous"
    }
  ]
}
```

**收益：** 本次创建 6 个金币节点需要 6 次 node_create + 36 次 component_modify + 6 次 component_add = **48 次调用**。批量工具可合并为 **1 次**。

### 3. `node_template` — 节点模板系统

**用途：** 定义可复用的节点模板（轻量级 Prefab 替代），创建时按模板填充。

```json
// 定义模板
{ "action": "define", "templateName": "coin",
  "components": [...], "properties": {...} }
// 使用模板
{ "action": "create", "templateName": "coin",
  "parentUuid": "...", "position": {"x":350,"y":30,"z":0} }
```

**收益：** 适合场景搭建中大量同类节点的创建，比 Prefab 更轻量。

### 4. `scene_snapshot_diff` — 场景快照对比

**用途：** 对比场景的两个状态，输出变更的节点和属性。

**场景：** 开发中频繁修改后需要了解「改了什么」，类似 git diff 但针对场景数据。

---

## 三、工具使用统计与效率分析

| 操作类型 | 调用次数 | 理想次数（有批量工具） | 效率提升 |
|---------|---------|-------------------|---------|
| 创建节点 | ~20 | ~3 (批量) | 85% |
| 设置组件属性 | ~70 | ~10 (批量) | 86% |
| 挂载脚本 | ~12 | ~0 (随节点创建) | 100% |
| 设置 SpriteFrame | ~20 | ~0 (自动) | 100% |
| 设置 sizeMode | ~25 (via debug_execute) | ~0 (自动) | 100% |
| **总计** | **~147** | **~13** | **91%** |

---

## 四、调试过程中遇到的 3 次黑屏及根因

| 次序 | 表现 | 根因 | 发现方式 | 修复方式 |
|------|------|------|---------|---------|
| 1 | 报错 `setTag is not a function` 导致连锁空引用 | 游戏脚本使用了 CC2.x 废弃 API（非 MCP 问题） | 浏览器控制台报错 | 重写碰撞识别为节点名称前缀匹配 |
| 2 | 报错 `Cannot read properties of null (reading 'name')` | Canvas.cameraComponent 引用了不存在的组件 UUID | 用 `component_query` 查到 UUID 不匹配 | `debug_execute` 运行时重新绑定 + scene_save |
| 3 | 无报错但黑屏 | 所有 Sprite 无 SpriteFrame（空白不渲染）+ Camera orthoHeight=10（视野极小） | 读取场景文件 JSON 分析 | 逐个设置 SpriteFrame + 修改 orthoHeight=360 |

---

## 五、总结优先级

| 优先级 | 改进项 | 预期收益 |
|--------|-------|---------|
| **P0** | Sprite 创建时自动分配默认 SpriteFrame + sizeMode=CUSTOM | 消除最常见的「黑屏」问题 |
| **P0** | 新增 `component_batch_set` 批量属性设置 | 减少 80%+ 的 MCP 调用 |
| **P1** | `node_create` 支持内联组件属性 | 创建完整游戏对象从 6-7 次降为 1 次 |
| **P1** | `component_modify` 支持组件 UUID 引用类型 | 修复 Canvas.cameraComponent 等引用属性 |
| **P1** | 新增 `node_batch_create` 批量节点创建 | 关卡搭建效率提升一个量级 |
| **P2** | `debug_execute` 标注运行时修改不持久化 | 避免用户踩坑 |
| **P2** | Prefab 实例化支持自定义名称 | 提升场景可读性 |
| **P2** | 新增 `node_template` 模板系统 | 复用同类节点配置 |
