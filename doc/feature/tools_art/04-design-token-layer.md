# Step 4: Design Token 层

> 前置依赖：Step 1-3 推荐完成，最低依赖无
> 预计改动量：中
> 目标：给 AI 一个稳定的高层视觉入口，使其优先修改 token 而不是散乱的底层属性

---

## 1. 背景

如果没有 token 层，AI 对 UI 的修改会退化成：

- 改字号
- 改颜色
- 改间距
- 改圆角

而这些修改如果不通过统一 token 管理，就很容易变成局部可用、整体失控。Step 4 的目标是先建立一个足够小但稳定的 token 体系。

---

## 2. 新增工具

新增 `source/tools/v2/design-tools.ts`：

- category key: `design`
- MCP 工具名: `design_token`

工具定义：

```ts
name: 'token'
inputSchema: {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      enum: ['query', 'upsert', 'remove', 'export']
    },
    scope: {
      type: 'string',
      enum: ['global', 'scene', 'prefab']
    },
    tokenSet: { type: 'string' },
    key: { type: 'string' },
    value: {},
    path: { type: 'string' }
  },
  required: ['action']
}
```

---

## 3. 持久化设计

推荐持久化到：

```text
.mcp/design/tokens.json
.mcp/design/motion-presets.json
```

原因：

- 不污染 `assets/`
- 易于纳入版本控制
- 不依赖 asset-db

如果后续运行时代码需要直接消费 token，再补导出到 `db://assets/` 的同步能力。

---

## 4. Token 范围

### 4.1 首批支持的 token

颜色角色：

- `color.bg.base`
- `color.bg.panel`
- `color.text.primary`
- `color.text.secondary`
- `color.accent`
- `color.danger`

排版层级：

- `type.display`
- `type.title`
- `type.body`
- `type.caption`

间距层级：

- `space.xs`
- `space.sm`
- `space.md`
- `space.lg`
- `space.xl`

圆角层级：

- `radius.sm`
- `radius.md`
- `radius.lg`

动效层级：

- `motion.duration.fast`
- `motion.duration.normal`
- `motion.duration.slow`
- `motion.easing.snappy`
- `motion.easing.soft`

### 4.2 暂不支持

- 任意自由命名 token 批量灌入
- 复杂排版系统
- 多主题联动切换

---

## 5. 数据结构

```ts
interface DesignTokenSet {
  version: string;
  updatedAt: string;
  colors: Record<string, string>;
  typography: Record<string, { fontSize: number; lineHeight?: number; fontWeight?: number }>;
  spacing: Record<string, number>;
  radius: Record<string, number>;
  motion: {
    duration: Record<string, number>;
    easing: Record<string, string>;
  };
}
```

---

## 6. 代码改动清单

### 6.1 新增服务层

建议新增：

```text
source/services/design-token-manager.ts
```

职责：

- token 文件读写
- 默认 token 初始化
- key 路径校验
- export 输出

### 6.2 修改 `source/mcp-server.ts`

注册新的 `design` category。

### 6.3 新增 `source/tools/v2/design-tools.ts`

实现 `token` 工具的四个 action：

- `query`
- `upsert`
- `remove`
- `export`

---

## 7. 行为要求

### `query`

- 无参数返回当前 token 全量
- 带 `key` 时返回单个 token

### `upsert`

- 单次只改一个 key
- 自动更新 `updatedAt`
- 不允许写入未知根节点

### `remove`

- 仅允许删除非核心 token
- 核心 token 删除应返回错误

### `export`

- 返回规范化 JSON
- 可选导出到指定 `path`

---

## 8. 验证标准

### L1: 编译验证

```bash
npm run build
```

### L2: 工具验证

验证：

- `design_token action=query`
- `design_token action=upsert`
- `design_token action=remove`
- `design_token action=export`

### L3: 功能验证

建议验证：

1. 修改 `color.accent`
2. 修改 `type.title.fontSize`
3. 导出 token 文件

预期：

- JSON 文件格式稳定
- 非法 key 被拦截
- 更新后可被后续 patch 编译器读取

---

## 9. 完成标记

- [ ] `design_token` 工具注册成功
- [ ] token 文件可持久化
- [ ] 默认 token 可初始化
- [ ] `query/upsert/remove/export` 均可用
- [ ] 非法 key 和非法根节点被拦截
