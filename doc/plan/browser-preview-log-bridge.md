# Step 7: 预览页日志桥接与浏览器 Console 采集方案

> 前置依赖：MCP 服务器已具备 HTTP API；`debug_logs` 已存在基础日志查询能力
> 目标：稳定采集 Cocos Creator 浏览器预览页的 `console` 日志、异常日志和运行时上下文，并可通过 MCP 查询
> 适用范围：Cocos Creator 3.8+，Browser Preview / Preview in Editor 打开的网页预览页

---

## 1. 目标与边界

### 1.1 目标

本方案要解决的是：浏览器预览页中运行的游戏脚本、引擎脚本和页面脚本所输出的日志，当前无法通过编辑器主进程的 `console:*` 广播或 `project.log` 文件稳定获取。

最终效果应满足：

- 预览页 `console.log / info / warn / error / debug` 能被实时采集
- `window.onerror`、`unhandledrejection` 能被采集
- 日志具备会话隔离能力，能够区分不同预览页、不同刷新周期
- 日志可通过 MCP 工具按级别、关键词、会话 ID、时间范围查询
- 采集链路尽量不依赖 DevTools 协议，不依赖浏览器扩展，不依赖系统级抓包

### 1.2 边界

本方案只覆盖“浏览器预览页”。

不覆盖：

- 原生运行时日志
- Simulator 日志
- 编辑器主进程 console 日志
- 远程设备浏览器日志

这些场景可在后续单独设计不同桥接链路。

---

## 2. 现状与问题

仓库当前已有的 `debug_logs` 主要依赖两条路径：

- 编辑器进程里的 `console:log / warn / error` 广播监听
- 项目日志文件 `temp/logs/project.log`

对应实现集中在 `source/tools/v2/debug-tools.ts`。

这个实现能覆盖：

- 编辑器自身输出
- 项目日志文件中的运行痕迹

但不能稳定覆盖：

- 浏览器预览页内部的 `console.*`
- 页面 `window.onerror`
- Promise 异常

原因很直接：预览页运行在浏览器上下文，和 Cocos Creator 扩展主进程不是同一执行环境，不能直接依赖 `Editor.Message` 或编辑器广播通道。

---

## 3. 总体方案

### 3.1 设计原则

1. 采集逻辑放在预览页内执行，保证能拿到真实的浏览器 console。
2. 上报通路走本地 HTTP，避免依赖复杂的浏览器调试协议。
3. MCP 服务器只做接收、缓存和查询，不承担浏览器注入逻辑。
4. 所有日志都按“会话”组织，避免热更新、刷新、多个标签页混淆。

### 3.2 架构图

```text
Browser Preview Page
  ├── console.log / warn / error / info / debug
  ├── window.onerror
  └── unhandledrejection
          │
          ▼
  preview-template/mcp-log-bridge.js
          │  batch POST / sendBeacon
          ▼
  MCP Server HTTP API
  ├── /api/logs/ingest
  ├── /api/logs/query
  └── /api/logs/clear
          │
          ▼
  In-memory Log Store
          │
          ▼
  debug_logs 工具查询
```

### 3.3 关键点

- “注入”不是通过编辑器插件动态插入，而是通过 `preview-template` 固化在预览模板里。
- 浏览器脚本必须先保存原始 `console`，再覆盖方法，避免递归调用。
- 上报采用批量发送，降低日志风暴带来的网络开销。
- MCP 服务器缓存采用环形缓冲区，防止预览时输出太多日志导致内存无限增长。

---

## 4. 预览页注入方式

### 4.1 使用 `preview-template`

Cocos Creator 支持项目级预览模板。方案上应在项目根目录准备：

```text
preview-template/
  ├── index.ejs
  └── mcp-log-bridge.js
```

推荐做法：

- `index.ejs` 里尽早引入桥接脚本
- `mcp-log-bridge.js` 负责 hook `console` 和异常事件
- 如果要兼顾缓存问题，脚本引用加时间戳 query string

### 4.2 注入位置

推荐把桥接脚本放在引擎模板脚本之前，尽量捕获最早阶段的日志。

示意：

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <script>
    window.__MCP_LOG_ENDPOINT__ = 'http://127.0.0.1:3000/api/logs/ingest';
  </script>
  <script src="mcp-log-bridge.js?ts=<%= Date.now() %>"></script>
  <!-- 后续是 Creator 自己的预览模板脚本 -->
</head>
<body>
  ...
</body>
</html>
```

### 4.3 为什么用 query string 防缓存

浏览器预览页在反复刷新时可能会复用缓存。如果桥接脚本被缓存，改了桥接代码以后预览页不会立即生效。

因此建议：

- 使用 `?ts=<%= Date.now() %>` 或类似的动态版本号
- 或直接把桥接代码内联进 `index.ejs`

优先级上：

1. 可维护性优先时，用独立 `mcp-log-bridge.js`
2. 调试首版时，可以直接内联脚本，减少模板/缓存干扰

---

## 5. 浏览器端桥接脚本设计

### 5.1 责任划分

`mcp-log-bridge.js` 只做四件事：

- 保存原始 `console` 方法
- 采集日志并标准化
- 在合适时机批量上报
- 页面关闭/隐藏时尽量 flush

### 5.2 采集内容

建议统一成一个结构化对象：

```ts
interface BrowserLogEntry {
  ts: string;
  level: 'log' | 'info' | 'warn' | 'error' | 'debug';
  args: any[];
  message?: string;
  stack?: string;
  url?: string;
  line?: number;
  column?: number;
  sessionId: string;
  source: 'browser';
  tag?: string;
}
```

建议上报时额外携带：

- `sessionId`
- `pageUrl`
- `userAgent`
- `projectPath` 或 `projectName`，如果模板层能安全注入

### 5.3 console hook 规则

实现时应满足：

- 在脚本初始化时保存 `console.log` 等原始引用
- 覆盖 `console.log / info / warn / error / debug`
- 每次调用时都先把日志写入本地队列，再转发到原始 console
- 对 `Error` 对象做特殊序列化，保留 `name / message / stack`

伪代码：

```js
var raw = {
  log: console.log.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  info: console.info.bind(console),
  debug: console.debug.bind(console),
};

console.log = function () {
  enqueue('log', arguments);
  raw.log.apply(console, arguments);
};
```

### 5.4 异常采集

必须补两类浏览器异常：

- `window.addEventListener('error', ...)`
- `window.addEventListener('unhandledrejection', ...)`

建议采集字段：

- 错误消息
- 发生文件
- 行号、列号
- `error.stack`
- Promise reject reason

### 5.5 批量上报

不要每条日志都立刻发请求。建议采用：

- 200ms 到 1000ms 的短周期 flush
- 队列达到阈值立即 flush
- 页面隐藏或关闭时立即 flush

上报方式建议按优先级：

1. `navigator.sendBeacon`
2. `fetch(..., { keepalive: true })`

这样可以兼顾：

- 页面关闭前的最后一批日志
- 网络抖动时的容错

### 5.6 去重和降噪

为了避免日志风暴，建议加入以下策略：

- 连续相同日志可合并计数
- 单次队列上限限制，比如 500 条
- 单次请求大小限制，比如 64KB 或 128KB
- 对高频 debug 信息可按级别过滤

---

## 6. MCP 服务器接收设计

### 6.1 新增 API

建议在 `source/mcp-server.ts` 里新增一个接收接口：

- `POST /api/logs/ingest`

可选再补两个接口：

- `GET /api/logs/query`
- `POST /api/logs/clear`

如果希望只走 MCP 工具，也可以不暴露 `query/clear` HTTP 路由，只保留 `ingest`，查询完全通过 `debug_logs` 工具完成。

### 6.2 处理流程

1. 解析 JSON body
2. 校验 `sessionId` 和 `logs` 数组
3. 每条日志补充服务器接收时间
4. 写入环形缓存
5. 返回接收结果和缓存大小

### 6.3 推荐缓存结构

建议做两个层次：

#### 全局环形缓冲区

- 保存最近 N 条浏览器日志
- N 建议 2000 到 10000 之间

#### Session 索引

- 按 `sessionId` 归类
- 方便按会话查询和清理

可接受的最小实现是：

- 一个全局数组
- `sessionId` 作为过滤字段

但如果后续要做查询性能优化，建议拆分为 session map。

### 6.4 失效策略

因为当前是内存缓存，所以要明确这几个事实：

- MCP 服务器重启后日志会丢失
- 编辑器重启后日志会丢失
- 刷新页面会生成新的 `sessionId`

如果需要跨重启持久化，可以在第二阶段把日志落到：

- `temp/logs/browser-preview.log`

并在 `debug_logs` 中增加 `source=browser_file` 的查询回退。

---

## 7. `debug_logs` 工具扩展设计

### 7.1 新增能力

现有 `debug_logs` 主要覆盖：

- 编辑器 console
- 项目日志文件

建议扩展为：

- `source=editor`
- `source=project`
- `source=browser`
- `source=all`

### 7.2 推荐参数

```ts
{
  action: 'console' | 'project' | 'browser' | 'file_info' | 'search' | 'clear',
  source?: 'editor' | 'project' | 'browser' | 'all',
  sessionId?: string,
  limit?: number,
  level?: 'log' | 'info' | 'warn' | 'error' | 'debug' | 'all',
  pattern?: string,
  since?: string,
  until?: string
}
```

### 7.3 推荐查询语义

- `action=console`：默认查询当前内存中的编辑器 console 记录
- `action=project`：查询项目日志文件
- `action=browser`：查询浏览器预览页日志
- `action=search`：按正则或关键词搜索当前 source 的日志

### 7.4 返回结构建议

```ts
{
  success: true,
  data: {
    source: 'browser',
    sessionId: '...',
    total: 120,
    returned: 20,
    logs: [
      {
        ts: '2026-03-28T10:11:12.123Z',
        level: 'error',
        message: '...',
        stack: '...',
        url: 'http://127.0.0.1:7456/',
        line: 120,
        column: 18
      }
    ]
  }
}
```

---

## 8. 建议的文件改动

### 8.1 新增文件

```text
preview-template/index.ejs
preview-template/mcp-log-bridge.js
```

如果希望把模板也纳入仓库管理，可以在项目说明里明确：

- 预览模板由用户在 Cocos Creator 中生成
- 生成后把桥接脚本拷贝到项目目录

### 8.2 修改文件

#### `source/mcp-server.ts`

新增 `POST /api/logs/ingest` 路由。

建议同时把 HTTP 层的错误响应标准化，保证预览脚本在上报失败时能拿到明确错误码。

#### `source/tools/v2/debug-tools.ts`

扩展 `logs` 的参数和查询逻辑，接入 browser 内存缓存。

建议新增内部方法：

- `ingestBrowserLogs()`
- `getBrowserLogs()`
- `searchBrowserLogs()`
- `clearBrowserLogs()`

#### 结构化日志类型归属

建议新增结构化日志类型，并归位到 `source/mcp/` 或对应领域目录，而不是重新引入全局 `source/types/`：

- `BrowserLogEntry`
- `BrowserLogBatch`
- `LogSource`

这样后续工具返回值和缓存结构都更清晰。

#### `source/tools/v2/project-tools.ts`

如果后续希望“一键预览并自动注入日志桥”，可以在这里预留 `preview` 的强化入口。

当前这一步不是必须项，但如果以后要把启动预览和日志采集合并，这里会是自然的挂载点。

---

## 9. 实施步骤

### Phase 1: 最小闭环

1. 在项目中生成 `preview-template`
2. 添加 `mcp-log-bridge.js`
3. 让桥接脚本把 `console.*` 和异常事件发往 `/api/logs/ingest`
4. 在 `mcp-server.ts` 增加接收路由
5. 在 `debug_logs` 中新增 `browser` 查询
6. 通过浏览器预览验证日志采集

### Phase 2: 稳定性增强

1. 增加日志批量合并
2. 增加 session 清理和重连识别
3. 增加 `search` 和 `clear` 的 browser 分支
4. 增加本地持久化文件

### Phase 3: 预览启动联动

1. 把 `preview` 动作升级为真正的预览启动流程
2. 预览启动后自动确保桥接脚本生效
3. 提供“一键预览 + 自动采集日志”的工作流

---

## 10. 验证标准

### 10.1 基础验证

1. 打开浏览器预览页
2. 在游戏脚本里输出 `console.log('hello')`
3. 通过 MCP 查询到同样日志

### 10.2 异常验证

1. 在预览页制造一个未捕获异常
2. 确认 `window.onerror` 被采集
3. 制造一个 Promise reject
4. 确认 `unhandledrejection` 被采集

### 10.3 热更新验证

1. 刷新预览页
2. 确认生成新的 `sessionId`
3. 确认旧会话日志仍可查询，或按策略清理

### 10.4 压力验证

1. 连续输出 500 条以上日志
2. 确认不会卡死预览页
3. 确认 MCP 缓冲区不会无限增长

---

## 11. 风险与对策

### 11.1 风险：桥接脚本缓存导致更新不生效

对策：

- 使用 query string 版本号
- 或直接内联脚本

### 11.2 风险：过早注入时引擎尚未完全初始化

对策：

- 桥接脚本只做纯浏览器 API hook，不依赖 `cc`
- 只在真正需要读取引擎对象时再做序列化

### 11.3 风险：日志风暴拖慢页面

对策：

- 批量上报
- 队列上限
- 级别过滤
- 相同日志合并

### 11.4 风险：MCP 服务重启丢日志

对策：

- 接受“运行时缓存”属性，明确是临时日志
- 如有需要，再落盘到 `temp/logs/browser-preview.log`

### 11.5 风险：多个预览标签页混淆

对策：

- 强制使用 `sessionId`
- 把 `url` 和 `userAgent` 一并记录
- 查询时默认按最新 session 排序

---

## 12. 推荐的最终工具体验

建议最终对外暴露成下面这组能力：

### `debug_logs`

- `action=console`
- `action=project`
- `action=browser`
- `action=search`
- `action=clear`

### `project_build`

- `action=preview`

后续如果做联动，理想体验是：

1. AI 调用 `project_build action=preview`
2. 预览页自动加载日志桥
3. AI 立刻调用 `debug_logs action=browser`
4. 直接看到浏览器 console 和异常栈

---

## 13. 结论

要稳定获取浏览器预览页日志，最可靠的方案是：

- 利用 `preview-template` 在预览页内注入日志桥
- 浏览器侧拦截 `console.*` 和异常事件
- 通过本地 HTTP 把日志批量上报到 MCP 服务器
- 在 `debug_logs` 中统一查询

这条链路比 DevTools 协议更轻，比系统日志更准，比编辑器广播更贴近真实运行时，适合作为 Cocos Creator MCP 的标准浏览器日志方案。
