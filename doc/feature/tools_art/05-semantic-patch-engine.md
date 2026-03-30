# Step 5: Semantic Patch 编译器

> 前置依赖：Step 4 完成
> 预计改动量：中到大
> 目标：把 AI 的高层设计意图编译为现有 MCP 的节点、组件、动画、材质修改，并支持 dry-run / apply / rollback

---

## 1. 背景

`design_token` 解决的是“统一风格”，但还不够解决“具体页面怎么改”。如果仍然要求 AI 直接发很多 `node_modify` 和 `component_modify`，复杂页面会迅速失控。

因此需要一个中间层：`design_patch`。

它的职责不是取代现有写工具，而是把高层 patch 编译为现有写工具可执行的计划。

---

## 2. 新增工具

沿用 `source/tools/v2/design-tools.ts`，新增：

- category key: `design`
- MCP 工具名: `design_patch`

工具定义：

```ts
name: 'patch'
inputSchema: {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      enum: ['dry_run', 'apply', 'rollback']
    },
    sessionId: { type: 'string' },
    patch: { type: 'object' },
    rollbackId: { type: 'string' }
  },
  required: ['action']
}
```

---

## 3. Patch 数据结构

```ts
interface DesignPatch {
  summary: string;
  scope: 'scene' | 'prefab' | 'selection';
  targetIds?: string[];
  tokenChanges?: Array<{ key: string; value: any }>;
  layoutChanges?: Array<{
    uuid: string;
    intent: 'align' | 'stack' | 'distribute' | 'resize' | 'pin';
    params: Record<string, any>;
  }>;
  visualChanges?: Array<{
    uuid: string;
    componentType: string;
    property: string;
    value: any;
  }>;
  motionChanges?: Array<{
    uuid: string;
    type: 'button_feedback' | 'enter' | 'exit' | 'emphasis' | 'transition';
    duration: number;
    easing: string;
    delay?: number;
    staggerIndex?: number;
  }>;
}
```

编译输出：

```ts
interface PatchPlan {
  summary: string;
  operations: Array<{
    tool: string;
    args: Record<string, any>;
  }>;
  warnings: string[];
}
```

---

## 4. 编译规则

### 4.1 `tokenChanges`

编译为：

- `design_token action=upsert`

### 4.2 `layoutChanges`

编译为：

- `node_modify`
- `node_arrange`

### 4.3 `visualChanges`

编译为：

- `component_modify`
- 必要时 `material_property`

### 4.4 `motionChanges`

优先编译为：

- `animation_clip`
- `component_modify`

如果当前项目尚未完成 `animation_clip` 编辑能力，可先退化为：

- 写入 motion preset
- 记录 warning

---

## 5. 回滚设计

### 5.1 回滚原则

- 每次 `apply` 前先记录原始状态
- 只回滚本次 patch 改过的对象
- 回滚记录写到 `.mcp/design/patch-history/`

### 5.2 `rollbackId`

建议结构：

```text
patch-20260330-153000-abcd
```

保存内容：

- 原始 patch
- 编译后的 patch plan
- 受影响节点 / 组件原始属性快照
- token 原始值

---

## 6. 代码改动清单

### 6.1 新增服务层

建议新增：

```text
source/services/design-patch-engine.ts
```

职责：

- 校验 patch schema
- 编译 patch
- 执行 dry-run / apply / rollback
- 记录 patch history

### 6.2 修改 `source/tools/v2/design-tools.ts`

新增 `patch` 工具，并将 action 路由到 `DesignPatchEngine`。

### 6.3 依赖现有工具

内部不要直接复制节点或组件写逻辑，而是复用：

- `node_modify`
- `node_arrange`
- `component_modify`
- `animation_clip`
- `material_property`
- `design_token`

---

## 7. 行为要求

### `dry_run`

- 只返回 `PatchPlan`
- 不做任何写操作

### `apply`

- 执行 `PatchPlan`
- 返回 `rollbackId`
- 返回受影响对象摘要

### `rollback`

- 按 `rollbackId` 恢复原始状态
- 恢复失败时返回失败对象列表

---

## 8. 验证标准

### L1: 编译验证

```bash
npm run build
```

### L2: 工具验证

验证：

- `design_patch action=dry_run`
- `design_patch action=apply`
- `design_patch action=rollback`

### L3: 功能验证

建议验证：

1. 改一个按钮的颜色和字号
2. 给一组列表项加 stagger 入场
3. 对 patch 执行 rollback

预期：

- dry-run 能输出可读 plan
- apply 后页面确实变化
- rollback 后状态回到原值

---

## 9. 完成标记

- [ ] `design_patch` 工具注册成功
- [ ] `dry_run` 返回结构稳定
- [ ] `apply` 可执行并返回 `rollbackId`
- [ ] `rollback` 可恢复受影响对象
- [ ] patch history 可追溯
