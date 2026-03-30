# Step 6: Resource 绑定与工作流固化

> 前置依赖：Step 1-5 全部完成
> 预计改动量：中
> 目标：把截图、摘要、时间线和 token 变成可绑定资源，让 AI 能稳定完成“预览 -> 评审 -> patch -> 再预览”的闭环

---

## 1. 背景

前 5 个 Step 补齐了工具能力，但如果截图和摘要只能出现在一次工具调用的返回里，AI 仍然很难在多轮对话中稳定复用这些工件。

因此本 Step 的重点是资源绑定，而不是新增更多工具。

---

## 2. 资源设计

推荐实现标准 MCP Resource：

- `resources/list`
- `resources/read`

首批资源：

| Resource URI | 类型 | 说明 |
|--------------|------|------|
| `preview://sessions` | JSON | 当前所有预览会话 |
| `preview://session/{sessionId}/summary` | JSON | 最新 runtime summary |
| `preview://session/{sessionId}/timeline` | JSON | 事件时间线 |
| `preview://session/{sessionId}/snapshot/latest` | Image | 最新截图 |
| `preview://session/{sessionId}/snapshot/{snapshotId}` | Image | 指定截图 |
| `design://tokens/current` | JSON | 当前 token |
| `design://patches/latest` | JSON | 最近一次 patch 执行结果 |

---

## 3. 兼容策略

如果当前服务端来不及补齐标准 MCP Resource，可先提供 HTTP 兼容接口：

```text
GET /api/resources/preview/sessions
GET /api/resources/preview/session/:id/summary
GET /api/resources/preview/session/:id/timeline
GET /api/resources/preview/session/:id/snapshot/latest
GET /api/resources/design/tokens/current
```

但长期目标仍然是标准 resource 模型。

---

## 4. 工具返回约定

从 Step 6 开始，以下工具应返回 `resourceUris`：

- `project_build action=preview`
- `preview_runtime action=summary`
- `preview_capture action=snapshot|sequence|latest`
- `design_token action=query|export`
- `design_patch action=apply`

示例：

```json
{
  "success": true,
  "data": {
    "sessionId": "preview-123",
    "resourceUris": [
      "preview://session/preview-123/summary",
      "preview://session/preview-123/snapshot/latest"
    ]
  }
}
```

---

## 5. 代码改动清单

### 5.1 修改 `source/mcp-server.ts`

新增：

- `resources/list`
- `resources/read`
- HTTP 兼容资源接口

### 5.2 新增资源层

建议新增：

```text
source/resources/preview-resources.ts
source/resources/design-resources.ts
```

职责：

- 列举可用资源
- 按 URI 读取 JSON 或图片
- 将服务层缓存映射为 resource 内容

### 5.3 修改工具返回结构

统一补齐：

- `resourceUris`
- `sessionId`
- `snapshotId`
- `rollbackId`

---

## 6. 工作流固化

推荐对外文档化一条标准工作流：

1. `project_build action=preview`
2. `debug_logs action=browser`
3. `preview_runtime action=summary`
4. `preview_capture action=snapshot`
5. 基于 `summary + snapshot` 产出 `design_patch`
6. `design_patch action=apply`
7. 重新预览并重复

这一工作流要成为默认范式，避免模型退化为直接低层盲改。

---

## 7. 验证标准

### L1: 编译验证

```bash
npm run build
```

### L2: Resource 验证

验证：

- `resources/list`
- `resources/read`
- HTTP 兼容接口

### L3: 端到端验证

选一个真实 UI 页面，完成：

1. 启动预览
2. 读取 summary
3. 抓一张截图
4. 修改 accent 色和按钮反馈
5. 再次截图确认结果

预期：

- resource URI 可复用
- 多轮对话中能持续读取同一会话工件
- patch 结果与截图结果一致

---

## 8. 完成标记

- [ ] 标准 resource 或 HTTP 兼容资源接口可用
- [ ] 工具返回统一携带 `resourceUris`
- [ ] 预览摘要和截图可被重复读取
- [ ] 标准工作流可以跑通
- [ ] AI 不再依赖大量底层盲改
