# Step 1: 预览会话与浏览器日志桥接

> 前置依赖：无
> 预计改动量：中
> 目标：让 `project_build action=preview` 变成真实预览会话入口，并打通浏览器预览页日志采集链路

---

## 1. 背景

当前 `project_build action=preview` 只是打开 Build 面板，`debug_logs` 也只能读取 editor console 和 `project.log`。这意味着 AI 即使改了 UI 或动画，也无法确认浏览器预览页里是否报错、是否加载失败、是否触发 Promise 异常。

仓库里已经有 [07-browser-preview-log-bridge.md](/Users/weighingzhang/demo/cocos-mcp-server/doc/feature/tools_optimization/07-browser-preview-log-bridge.md) 作为桥接设计基础。本 Step 的职责是把它并入主方案，并补上 session 管理。

---

## 2. 改动目标

### 2.1 `project_build` 增强

增强 `source/tools/v2/project-tools.ts`：

| action | 当前行为 | 目标行为 |
|--------|---------|---------|
| `preview` | 打开 Build 面板 | 返回 `sessionId`、`previewUrl`、bridge 状态和资源 URI |
| `status` | 查询 builder ready | 同时返回当前预览会话状态 |
| `start_preview` / `stop_preview` | 直接报不支持 | 至少支持逻辑层 start / stop / clear |

推荐 `preview` 返回：

```ts
interface PreviewStartResult {
  sessionId: string;
  previewUrl?: string;
  bridgeInjected: boolean;
  runtimeConnected: boolean;
  resourceUris: string[];
}
```

### 2.2 `debug_logs` 增强

扩展 `source/tools/v2/debug-tools.ts` 的 `logs` action：

```text
console | project | file_info | search | clear | browser
```

`action=browser` 输入建议：

```ts
{
  action: 'browser',
  sessionId?: string,
  level?: 'log' | 'info' | 'warn' | 'error' | 'debug' | 'all',
  keyword?: string,
  sinceTs?: string,
  limit?: number
}
```

---

## 3. 桥接链路

```text
Browser Preview Page
  └── preview-template/mcp-preview-bridge.js
         ├── hook console.*
         ├── hook window.onerror
         └── hook unhandledrejection
                 │
                 ▼
         POST /api/preview/logs/ingest
                 │
                 ▼
           BrowserLogStore
                 │
                 ▼
         debug_logs action=browser
```

---

## 4. 数据结构

### 4.1 `PreviewSession`

```ts
interface PreviewSession {
  sessionId: string;
  projectPath: string;
  previewUrl?: string;
  createdAt: string;
  lastSeenAt: string;
  status: 'starting' | 'connected' | 'stale' | 'stopped';
  bridgeVersion: string;
  pageTitle?: string;
  userAgent?: string;
}
```

### 4.2 `BrowserLogEntry`

```ts
interface BrowserLogEntry {
  sessionId: string;
  ts: string;
  level: 'log' | 'info' | 'warn' | 'error' | 'debug';
  source: 'browser';
  message: string;
  args?: any[];
  stack?: string;
  url?: string;
  line?: number;
  column?: number;
  category?: 'console' | 'window.onerror' | 'unhandledrejection';
}
```

---

## 5. 代码改动清单

### 5.1 新增服务层

建议新增：

```text
source/services/preview-session-manager.ts
source/services/browser-log-store.ts
```

职责：

- `PreviewSessionManager` 负责 session 创建、过期、停止、查询
- `BrowserLogStore` 负责按 session 缓存日志并提供过滤查询

### 5.2 修改 `source/mcp-server.ts`

增加 API：

```text
POST /api/preview/logs/ingest
GET  /api/preview/sessions
POST /api/preview/session/stop
```

要求：

- `logs/ingest` 支持批量日志
- 所有日志必须带 `sessionId`
- 请求体校验失败时返回 400

### 5.3 修改 `source/tools/v2/project-tools.ts`

增强 `preview` / `status` / `stop_preview`，并接入 `PreviewSessionManager`。

### 5.4 修改 `source/tools/v2/debug-tools.ts`

- 新增 `browser` action
- 读取 `BrowserLogStore`
- 支持 session、级别、关键词、时间范围过滤

### 5.5 新增预览模板文件

```text
preview-template/index.ejs
preview-template/mcp-preview-bridge.js
```

要求：

- `index.ejs` 尽早注入 bridge 脚本
- `mcp-preview-bridge.js` 保存原始 `console` 再 hook
- 页面关闭前尽量 flush 最后一批日志

---

## 6. 浏览器脚本实现要求

### 6.1 必须采集

- `console.log`
- `console.info`
- `console.warn`
- `console.error`
- `console.debug`
- `window.onerror`
- `unhandledrejection`

### 6.2 上报策略

- 队列批量发送，默认 200ms 到 500ms flush
- 队列达到阈值立即 flush
- 优先 `navigator.sendBeacon`
- 回退到 `fetch(..., { keepalive: true })`

### 6.3 缓存与降噪

- 服务端默认每个 session 最多保留 1000 条日志
- 重复日志允许做轻量压缩，但不能丢最后一条错误

---

## 7. 验证标准

### L1: 编译验证

```bash
npm run build
```

### L2: 工具验证

验证：

- `project_build action=preview`
- `project_build action=status`
- `debug_logs action=browser`

### L3: 浏览器预览验证

在预览页中执行：

```js
console.log('mcp preview bridge ok');
Promise.reject(new Error('preview rejection'));
throw new Error('preview error');
```

预期：

- `debug_logs action=browser` 能查到三类日志
- 能按 `sessionId` 过滤
- 刷新页面后产生新的 `lastSeenAt`

---

## 8. 完成标记

- [ ] `project_build action=preview` 返回真实 `sessionId`
- [ ] `debug_logs action=browser` 可查询浏览器日志
- [ ] `window.onerror` 与 `unhandledrejection` 被采集
- [ ] `preview-template` 注入链路可用
- [ ] 每 session 日志独立隔离
