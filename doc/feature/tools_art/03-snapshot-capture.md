# Step 3: Snapshot Capture

> 前置依赖：Step 1 完成
> 预计改动量：中
> 目标：让 AI 能看到当前预览画面，并在需要时抓取序列帧用于动画评审

---

## 1. 背景

UI 和动画都高度依赖视觉反馈。日志和 summary 只能告诉 AI “程序状态”，不能告诉 AI “画面是否拥挤”“按钮是否显得重”“入场节奏是否突兀”。

本 Step 不做视频流，只做按需截图和轻量序列帧。

---

## 2. 新增工具

沿用 `source/tools/v2/preview-tools.ts`，新增：

- category key: `preview`
- MCP 工具名: `preview_capture`

工具定义：

```ts
name: 'capture'
inputSchema: {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      enum: ['snapshot', 'sequence', 'latest']
    },
    sessionId: { type: 'string' },
    count: { type: 'number' },
    intervalMs: { type: 'number' },
    format: { type: 'string', enum: ['png'] }
  },
  required: ['action']
}
```

---

## 3. 截图策略

### 3.1 首选方案

优先抓取 Cocos 预览主 canvas：

```js
canvas.toDataURL('image/png')
```

特点：

- 依赖少
- 实现稳定
- 足够覆盖大部分 Cocos UI / 动画场景

### 3.2 第一阶段边界

第一阶段不保证完整覆盖：

- DOM overlay
- 浏览器原生 UI
- 外挂调试面板

如果后续需要混合截图，再补 DOM 层方案。

### 3.3 序列帧限制

默认限制：

- `count <= 5`
- `intervalMs >= 100`

目标是用于按钮反馈、列表 stagger、页面切换关键帧，而不是替代视频。

---

## 4. 数据结构

```ts
interface SnapshotArtifact {
  sessionId: string;
  snapshotId: string;
  ts: string;
  format: 'png';
  width: number;
  height: number;
  filePath: string;
  resourceUri?: string;
}
```

`preview_capture action=sequence` 返回：

```ts
{
  success: true,
  data: {
    sessionId: string,
    snapshots: SnapshotArtifact[]
  }
}
```

---

## 5. 代码改动清单

### 5.1 新增服务层

建议新增：

```text
source/services/snapshot-manager.ts
```

职责：

- 生成截图请求 ID
- 管理截图 artifact 元数据
- 将图片落盘到临时目录

### 5.2 修改 `source/mcp-server.ts`

新增 API：

```text
POST /api/preview/capture/request
POST /api/preview/capture/upload
GET  /api/preview/snapshot/latest
```

要求：

- `request` 返回 capture token
- `upload` 接收 base64 PNG 或二进制内容
- 图片统一落盘到 `temp/mcp-preview/snapshots/`

### 5.3 修改 `preview-template/mcp-preview-bridge.js`

新增能力：

- 监听服务端 capture 请求
- 从 canvas 导出 PNG
- 上传截图结果

### 5.4 修改 `source/tools/v2/preview-tools.ts`

实现：

- `snapshot`
- `sequence`
- `latest`

---

## 6. 结果返回要求

`snapshot` 建议返回：

```ts
{
  success: true,
  data: {
    sessionId,
    snapshotId,
    filePath,
    resourceUris: [
      `preview://session/${sessionId}/snapshot/latest`,
      `preview://session/${sessionId}/snapshot/${snapshotId}`
    ]
  }
}
```

如果 Step 6 尚未完成，可先返回：

- `filePath`
- `httpUrl`

---

## 7. 验证标准

### L1: 编译验证

```bash
npm run build
```

### L2: 工具验证

验证：

- `preview_capture action=snapshot`
- `preview_capture action=sequence`
- `preview_capture action=latest`

### L3: 浏览器预览验证

预期：

- 单帧截图可正常生成 PNG
- 连续触发 3 帧 sequence 时能返回 3 张图片
- 同一 `sessionId` 下 latest 始终指向最近一次截图

---

## 8. 完成标记

- [ ] `preview_capture` 工具注册成功
- [ ] 单帧截图可用
- [ ] 序列帧可用
- [ ] artifact 落盘和 metadata 可查询
- [ ] latest 查询行为稳定
