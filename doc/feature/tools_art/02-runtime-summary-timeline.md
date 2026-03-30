# Step 2: Runtime Summary 与 Timeline

> 前置依赖：Step 1 完成
> 预计改动量：中
> 目标：让 AI 能理解预览页是否正常启动、是否卡顿、是否有资源失败以及当前动画运行状态

---

## 1. 背景

只有日志还不够。UI 和动画调优更需要“运行态摘要”，也就是一份可被模型快速消费的结构化状态，而不是要求模型自己从几十条日志中猜系统状态。

本 Step 采用成熟的“三段式”方案：

- heartbeat snapshot
- event timeline
- marker 埋点

---

## 2. 新增工具

新增 `source/tools/v2/preview-tools.ts`：

- category key: `preview`
- MCP 工具名: `preview_runtime`

工具定义：

```ts
name: 'runtime'
inputSchema: {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      enum: ['summary', 'timeline', 'markers', 'clear']
    },
    sessionId: { type: 'string' },
    sinceTs: { type: 'string' },
    limit: { type: 'number' }
  },
  required: ['action']
}
```

---

## 3. 数据结构

### 3.1 `RuntimeHeartbeat`

```ts
interface RuntimeHeartbeat {
  sessionId: string;
  ts: string;
  fps: number | null;
  frameTimeMs: number | null;
  longFrameCount: number;
  sceneName?: string;
  nodeCount?: number;
  activeNodeCount?: number;
  componentCount?: number;
  drawCalls?: number | null;
  triangles?: number | null;
  activeAnimations?: number;
  activeTweens?: number;
  loadingAssets?: number;
  failedAssets?: number;
  errorCount?: number;
  warningCount?: number;
}
```

### 3.2 `PreviewMarker`

```ts
interface PreviewMarker {
  sessionId: string;
  ts: string;
  name: string;
  payload?: any;
}
```

### 3.3 `RuntimeSummary`

```ts
interface RuntimeSummary {
  sessionId: string;
  status: 'ok' | 'warning' | 'error';
  sceneName?: string;
  latestHeartbeatAt: string;
  metrics: {
    fps: number | null;
    frameTimeMs: number | null;
    longFrameCount: number;
    drawCalls: number | null;
    triangles: number | null;
  };
  sceneStats: {
    nodeCount: number;
    activeNodeCount: number;
    componentCount: number;
  };
  runtimeStats: {
    activeAnimations: number;
    activeTweens: number;
    loadingAssets: number;
    failedAssets: number;
  };
  errors: {
    total: number;
    warnings: number;
    lastError?: string;
  };
  markers: Array<{ name: string; ts: string; payload?: any }>;
}
```

---

## 4. 采样策略

### 4.1 Heartbeat

- 默认每 1000ms 上报一次
- 首屏启动阶段允许在前 3 秒提升到 500ms
- 只保留每 session 最近 120 条 heartbeat

### 4.2 Timeline

timeline 只记录关键事件，不记录所有细粒度日志。

推荐内置事件：

- `preview-connected`
- `boot-started`
- `first-scene-loaded`
- `first-frame-rendered`
- `assets-load-start`
- `assets-load-finished`
- `assets-load-error`
- `animation-start`
- `animation-stop`
- `fatal-error`

### 4.3 Marker API

桥接脚本暴露：

```js
window.__MCP_PREVIEW_MARK__(name, payload)
```

项目脚本或调试脚本可主动调用该方法埋点。

---

## 5. 代码改动清单

### 5.1 新增服务层

建议新增：

```text
source/services/runtime-summary-store.ts
```

职责：

- 保存 heartbeat
- 聚合为 latest summary
- 维护 marker 和 timeline

### 5.2 修改 `source/mcp-server.ts`

新增 API：

```text
POST /api/preview/runtime/ingest
POST /api/preview/marker/ingest
```

### 5.3 修改 `preview-template/mcp-preview-bridge.js`

新增：

- heartbeat 定时上报
- marker 上报
- 初始生命周期 marker

### 5.4 新增 `source/tools/v2/preview-tools.ts`

`runtime` action 路由建议：

- `summary` -> 返回 latest summary
- `timeline` -> 返回按时间排序的关键事件
- `markers` -> 返回 marker 列表
- `clear` -> 清除该 session 的运行态缓存

---

## 6. 运行态字段来源建议

优先实现的字段：

- `fps`
- `frameTimeMs`
- `nodeCount`
- `activeNodeCount`
- `componentCount`
- `errorCount`
- `warningCount`

可选字段：

- `drawCalls`
- `triangles`
- `activeAnimations`
- `activeTweens`

说明：

- `nodeCount` / `componentCount` 可参考 `source/scene.ts` 现有统计逻辑
- `drawCalls` / `triangles` 在第一阶段允许返回 `null`
- `activeTweens` 若引擎无稳定公开接口，可在 bridge 中先设为近似值或缺省

---

## 7. 验证标准

### L1: 编译验证

```bash
npm run build
```

### L2: 工具验证

验证：

- `preview_runtime action=summary`
- `preview_runtime action=timeline`
- `preview_runtime action=markers`

### L3: 运行态验证

预期：

- 进入预览后 1 秒内能看到 heartbeat
- 首次渲染后能看到 `first-frame-rendered`
- 主动调用 `window.__MCP_PREVIEW_MARK__('cta-visible')` 后能在 markers 中查询到
- 出现异常时 `status` 从 `ok` 变为 `warning` 或 `error`

---

## 8. 完成标记

- [ ] `preview_runtime` 工具注册成功
- [ ] heartbeat 能定时写入
- [ ] timeline 能记录关键生命周期事件
- [ ] marker API 可被项目脚本调用
- [ ] summary 可返回核心运行指标
