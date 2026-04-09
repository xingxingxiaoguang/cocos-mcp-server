# MCP UI / 动画设计辅助能力技术方案

> 版本: 1.0
> 日期: 2026-03-30
> 目标: 在保持工具总量可控的前提下，为 AI 补齐 UI 设计和动画设计所需的预览可观测能力、设计抽象能力与运行态闭环能力，使其能够稳定完成中低复杂度界面和动效草案。

---

## 一、现状分析

### 1.1 目标场景

当前这套 MCP 工具已经能较强地完成“工程实现”类任务：

- 场景、节点、组件、预制体的查询与修改
- 基础资源与脚本文件操作
- 材质、动画等能力正在补齐

但如果目标升级为“让 AI 帮忙完成 UI 设计和动画设计”，问题就不再是单次代码生成，而是一个高频迭代闭环：

```text
设计目标输入
  → 生成初稿
  → 运行预览
  → 观察画面 / 日志 / 运行态
  → 评审问题
  → 继续修正
```

当前 MCP 工具在“生成”和“修改”上已有一定基础，但在“观察”和“高层设计抽象”上明显缺位。

### 1.2 当前能力基础

基于现有代码和文档，已经具备以下可复用基础：

| 能力 | 现状 |
|------|------|
| 节点/组件修改 | 已完成 v2 合并工具，适合作为底层执行层 |
| 资源绑定 | `component_modify action=set` 已支持 `spriteFrame`、`prefab`、`asset`、`node` 等引用类型 |
| 预览入口 | `project_build action=preview` 已保留，但目前仅打开 Build 面板，不是真正的预览控制链路 |
| 日志工具 | `debug_logs` 已支持 editor console 和 `project.log` 查询 |
| 浏览器日志桥接设计 | 已有 `doc/feature/tools_optimization/07-browser-preview-log-bridge.md` 可作为前置能力 |
| 性能统计 | `source/cocos-entry.ts` 已有编辑器侧 `getPerformanceStats()`，可作为摘要字段参考 |

### 1.3 当前关键缺口

| 缺口 | 当前表现 | 影响 |
|------|---------|------|
| 无法看见浏览器预览画面 | 没有截图、序列帧、资源绑定后的视觉反馈 | AI 无法判断层级、间距、色彩、拥挤度、动效节奏 |
| 无法稳定拿到浏览器运行日志 | `debug_logs` 只覆盖 editor console 和 `project.log` | AI 无法定位预览页报错、资源加载失败、Promise 异常 |
| 无运行态摘要 | 没有会话级 summary / timeline / marker | AI 无法理解首帧、加载、动画播放、卡顿等运行过程 |
| 编辑抽象层过低 | 主要依赖节点属性、组件属性直接修改 | AI 容易陷入“调 x/y/width/color”式盲改 |
| 缺少设计语义层 | 没有 design token、motion preset、semantic patch | AI 难以稳定做“换风格”“统一节奏”“强化层级” |
| 没有资源绑定式的预览工件 | 目前 MCP 服务未实现 `resources/list` / `resources/read` | 截图、摘要、时间线只能零散塞在工具返回里，复用性差 |

### 1.4 根因判断

问题本质不是“AI 不会设计”，而是当前系统缺少三层能力：

1. **可观测层**: AI 看不到结果，也看不到运行过程
2. **设计抽象层**: AI 只能改底层属性，缺少 token / motion 语义
3. **闭环层**: AI 无法把“预览结果”重新输入下一轮修改

---

## 二、建设目标

### 2.1 总目标

将 MCP 工具从“工程执行器”增强为“设计闭环代理”，使 AI 能够在 Cocos Creator 项目中完成以下任务：

- 基于 brief 和参考图生成 UI 草案
- 根据预览截图和运行态摘要迭代视觉层级、布局和留白
- 根据运行态摘要和关键帧截图调整按钮反馈、入场动效、页面切换节奏
- 在 2 到 3 轮迭代内收敛到可接受的中低复杂度结果

### 2.2 量化目标

| 目标 | 量化标准 |
|------|---------|
| AI 可看见预览结果 | 单次调用可获得截图资源 URI 或最新截图文件 |
| AI 可理解运行态 | 单次调用可获得 session 级 runtime summary 和 event timeline |
| 工具数可控 | 在现有 34 个工具基础上新增不超过 4 个工具，总数控制在 38 个左右 |
| 预览日志可查询 | 浏览器预览页日志采集延迟 < 1 秒 |
| 运行时开销可控 | 心跳采样默认 1Hz，日志批量上报，不持续推流 |
| 设计修改可回滚 | 设计 patch 默认支持 dry-run、apply、rollback |

### 2.3 非目标

本方案第一阶段不覆盖：

- 视频流或实时屏幕推流
- 远程设备浏览器 / 原生设备运行态
- 自动生成高质量插画、角色立绘、复杂粒子特效
- 替代专业 UI 设计师完成最终视觉定稿

---

## 三、总体架构

### 3.1 闭环模型

推荐的 AI 设计工作流如下：

```text
设计 brief / 参考图
  ↓
AI 生成结构方案或 design patch
  ↓
MCP 修改场景 / 组件 / token
  ↓
启动预览会话
  ↓
采集截图 + 浏览器日志 + runtime summary + timeline
  ↓
AI 复盘并产出下一轮 patch
  ↓
重复 2~3 轮
```

### 3.2 分层架构

```text
Layer A: 预览可观测层
  - 浏览器日志桥接
  - Runtime Heartbeat / Event Timeline
  - Snapshot Capture
  - Session 管理

Layer B: 设计抽象层
  - Design Tokens
  - Motion Presets
  - Semantic Patch

Layer C: 执行与闭环层
  - 将 semantic patch 编译为 node/component/prefab/material 操作
  - 将预览工件暴露为 MCP Resource
  - 让 AI 通过资源和工具完成下一轮设计迭代
```

### 3.3 与现有工具集的关系

本方案尽量复用现有 v2 工具，不额外引入平行系统：

- 继续复用 `node_*` / `component_*` / `prefab_*` 作为底层执行
- 增强 `project_build`，让 `action=preview` 变成真实预览会话入口
- 增强 `debug_logs`，让其可查询浏览器预览日志
- 新增最小必要的 `preview_*` 与 `design_*` 工具

---

## 四、目标工具集设计

### 4.1 工具数量策略

为保持工具选择成本可控，本方案不新增独立的“设计评审工具”和“动画评审工具”，而是采用：

- 工具负责采集、摘要、修改
- 资源负责承载截图、摘要、时间线
- 多模态模型直接基于资源做评审

这样可以把新增工具数控制在 4 个。

### 4.2 扩展现有工具（不新增工具数）

#### `project_build`

保留现有工具名，增强以下 action：

| action | 现状 | 目标行为 |
|--------|------|---------|
| `preview` | 打开 Build 面板 | 启动或接管一个预览会话，返回 `sessionId`、`previewUrl`、桥接状态、资源 URI |
| `status` | 查询 builder ready | 返回 builder 状态 + 当前 preview session 状态 |
| `start_preview` / `stop_preview` | 当前直接报不支持 | 改为真正控制会话生命周期，至少支持逻辑层 stop/clear |

推荐 `preview` 返回结构：

```ts
interface PreviewStartResult {
  sessionId: string;
  previewUrl: string;
  bridgeInjected: boolean;
  runtimeConnected: boolean;
  resourceUris: string[];
}
```

#### `debug_logs`

扩展 `action` 枚举：

```text
console | project | file_info | search | clear | browser
```

`action=browser` 支持按以下维度查询：

- `sessionId`
- `level`
- `keyword`
- `sinceTs`
- `limit`

### 4.3 新增工具（4 个）

#### `preview_runtime`

category key: `preview`

MCP 工具名: `preview_runtime`

```typescript
action: 'summary' | 'timeline' | 'markers' | 'clear'
sessionId?: string
limit?: number
sinceTs?: string
```

职责：

- 查询最新 runtime summary
- 查询事件时间线
- 查询 marker 列表
- 清理某个会话的运行态缓存

#### `preview_capture`

category key: `preview`

MCP 工具名: `preview_capture`

```typescript
action: 'snapshot' | 'sequence' | 'latest'
sessionId?: string
count?: number
intervalMs?: number
format?: 'png'
```

职责：

- 主动触发截图
- 抓取关键帧序列
- 查询最近一次截图结果

#### `design_token`

category key: `design`

MCP 工具名: `design_token`

```typescript
action: 'query' | 'upsert' | 'remove' | 'export'
scope?: 'global' | 'scene' | 'prefab'
tokenSet?: string
key?: string
value?: any
path?: string
```

职责：

- 查询和维护设计 token
- 支持全局 token、场景级 token、prefab 级 token
- 为高层风格改动提供稳定入口

#### `design_patch`

category key: `design`

MCP 工具名: `design_patch`

```typescript
action: 'dry_run' | 'apply' | 'rollback'
sessionId?: string
patch: DesignPatch
rollbackId?: string
```

职责：

- 接收 AI 生成的 semantic patch
- 先编译为节点/组件/资源层面的具体改动
- 支持 dry-run 预演和 rollback 回滚

### 4.4 工具总数汇总

| 项目 | 数量 |
|------|------|
| 现有优化后工具 | 34 |
| 扩展现有工具 | 0 |
| 新增 `preview_*` | 2 |
| 新增 `design_*` | 2 |
| **总计** | **38** |

---

## 五、资源绑定设计

### 5.1 为什么需要 MCP Resource

截图、运行态摘要、事件时间线都具有“可反复引用”的特点，不适合每次都塞在工具返回里。

因此本方案推荐在 MCP 服务中新增标准资源能力：

- `resources/list`
- `resources/read`

这一步是“让 AI 真正看见预览结果”的关键。

### 5.2 资源 URI 设计

推荐暴露以下资源：

| Resource URI | 类型 | 说明 |
|--------------|------|------|
| `preview://sessions` | JSON | 当前所有预览会话 |
| `preview://session/{sessionId}/summary` | JSON | 最新 runtime summary |
| `preview://session/{sessionId}/timeline` | JSON | 事件时间线 |
| `preview://session/{sessionId}/snapshot/latest` | Image | 最新截图 |
| `preview://session/{sessionId}/snapshot/{snapshotId}` | Image | 指定截图 |
| `design://tokens/current` | JSON | 当前 design token 集 |
| `design://patches/latest` | JSON | 最近一次 design patch 结果 |

### 5.3 工具与资源的绑定方式

工具返回应附带资源 URI，方便客户端直接绑定到对话上下文：

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

如果短期内不实现标准 MCP Resource，可先以 HTTP GET 资源接口过渡：

- `/api/preview/session/:id/summary`
- `/api/preview/session/:id/timeline`
- `/api/preview/session/:id/snapshot/latest`

但长期仍建议升级到标准 resource 模型。

---

## 六、核心数据结构设计

### 6.1 预览会话

```ts
interface PreviewSession {
  sessionId: string;
  projectPath: string;
  previewUrl: string;
  createdAt: string;
  lastSeenAt: string;
  status: 'starting' | 'connected' | 'stale' | 'stopped';
  bridgeVersion: string;
  pageTitle?: string;
  userAgent?: string;
}
```

### 6.2 浏览器日志

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
  category?: 'console' | 'window.onerror' | 'unhandledrejection' | 'network';
}
```

### 6.3 Runtime Heartbeat

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

### 6.4 Runtime Summary

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
  markers: Array<{
    name: string;
    ts: string;
    payload?: any;
  }>;
}
```

### 6.5 Design Token

```ts
interface DesignTokenSet {
  version: string;
  updatedAt: string;
  colors: Record<string, string>;
  typography: Record<string, { fontSize: number; lineHeight?: number; fontWeight?: number }>;
  spacing: Record<string, number>;
  radius: Record<string, number>;
  shadow: Record<string, any>;
  motion: {
    duration: Record<string, number>;
    easing: Record<string, string>;
    stagger: Record<string, number>;
  };
}
```

### 6.6 Semantic Patch

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

---

## 七、详细技术实现

### 7.1 预览可观测层

#### 7.1.1 浏览器桥接脚本

在项目根目录建立：

```text
preview-template/
  ├── index.ejs
  └── mcp-preview-bridge.js
```

该桥接脚本负责：

- hook `console.log/info/warn/error/debug`
- 监听 `window.onerror`
- 监听 `unhandledrejection`
- 周期性发送 runtime heartbeat
- 响应服务端的截图请求
- 在页面关闭前 flush 最后一批日志和摘要

浏览器日志桥接的细节直接复用现有文档 `doc/feature/tools_optimization/07-browser-preview-log-bridge.md`。

#### 7.1.2 Runtime Summary 采样策略

推荐采用“心跳快照 + 事件时间线 + 按需截图”的成熟模式：

- **Heartbeat Snapshot**: 每 1000ms 上报一次
- **Event Timeline**: 关键事件立即上报
- **On-demand Capture**: 仅在 AI 请求时截图

关键 marker 建议内置：

- `preview-connected`
- `boot-started`
- `first-scene-loaded`
- `first-frame-rendered`
- `assets-load-start`
- `assets-load-error`
- `animation-start`
- `animation-stop`
- `fatal-error`

同时提供一个页面侧 API：

```js
window.__MCP_PREVIEW_MARK__(name, payload)
```

让项目脚本可以主动埋点。

#### 7.1.3 截图策略

第一阶段不做视频流，只做两类截图：

- 单次快照 `snapshot`
- 序列帧 `sequence`

实现优先级：

1. 首先抓取 Cocos 预览主 canvas 的 `toDataURL('image/png')`
2. 如果后续出现 DOM overlay 需求，再评估额外的 DOM 层截图方案

默认策略：

- 不持续截图
- 只有收到 `preview_capture` 请求时才抓取
- 序列帧默认最多 5 张，默认间隔 120ms

#### 7.1.4 服务端缓存策略

建议引入 4 个存储组件：

- `PreviewSessionStore`
- `BrowserLogStore`
- `RuntimeSummaryStore`
- `SnapshotStore`

存储策略：

- 日志: 内存环形缓冲区，默认每 session 1000 条
- 时间线: 内存环形缓冲区，默认每 session 300 条
- 截图: 文件落盘到 `temp/mcp-preview/snapshots/`
- 会话元数据: 内存 + `temp/mcp-preview/sessions/`

### 7.2 设计抽象层

#### 7.2.1 Token 持久化位置

推荐将设计 token 持久化到项目根目录：

```text
.mcp/design/tokens.json
.mcp/design/motion-presets.json
```

原因：

- 应纳入版本控制
- 不污染 `assets/` 资源树
- 不依赖 asset-db 才能读写

如果后续需要让运行时代码直接消费 token，再补一条同步导出链路到 `db://assets/`。

#### 7.2.2 Token 范围

第一阶段建议只支持稳定、可迁移的核心 token：

- 颜色角色: `bg/base`, `bg/panel`, `text/primary`, `text/secondary`, `accent`, `danger`
- 字号层级: `display`, `title`, `body`, `caption`
- 间距层级: `xs`, `sm`, `md`, `lg`, `xl`
- 圆角层级: `sm`, `md`, `lg`
- 阴影角色
- Motion: `fast`, `normal`, `slow`, `snappy`, `soft`, `spring-lite`

先不支持过度细粒度的自由 token，避免 AI 失去约束。

#### 7.2.3 Patch 编译策略

`design_patch` 不直接操作文件，而是将 semantic patch 编译为现有 MCP 操作：

- `tokenChanges` → `design_token upsert`
- `layoutChanges` → `node_modify` / `node_arrange`
- `visualChanges` → `component_modify`
- `motionChanges` → `animation_clip` / `component_modify` / `material_property`

这意味着 `design_patch` 本质上是一个“高层 patch 编译器”，而不是另一个底层执行器。

### 7.3 资源绑定层

#### 7.3.1 为什么优先做资源而不是工具返回

因为设计迭代高度依赖“同一张图反复讨论”，资源模型更适合：

- latest snapshot 可反复引用
- runtime summary 可在多轮对话中复用
- timeline 可只追加，不必每次全量复制

#### 7.3.2 服务端实现建议

推荐在 `source/mcp-server.ts` 中补齐两类能力：

- MCP `resources/list` / `resources/read`
- 简单 HTTP 资源读取接口作为兼容层

内部可新增：

- `source/resources/preview-resources.ts`
- `source/resources/design-resources.ts`

### 7.4 兼容现有代码结构的改动点

建议新增或修改以下文件：

| 文件 | 改动 |
|------|------|
| `source/mcp-server.ts` | 新增 preview ingest API、resources 路由、工具注册 |
| 领域目录或 `source/mcp/` | 新增 preview/design 相关类型，避免恢复全局 `source/types/` |
| `source/tools/v2/debug-tools.ts` | 扩展 browser log 查询 |
| `source/tools/v2/project-tools.ts` | 将 preview 改造成真实会话入口 |
| `source/tools/v2/preview-tools.ts` | 新增 `runtime` / `capture` |
| `source/tools/v2/design-tools.ts` | 新增 `token` / `patch` |
| `source/tools/tool-manager.ts` | 更新工具发现列表 |
| `preview-template/index.ejs` | 注入 bridge 脚本 |
| `preview-template/mcp-preview-bridge.js` | 日志、心跳、截图桥接 |

可选新增服务层：

- `source/services/preview-session-manager.ts`
- `source/services/browser-log-store.ts`
- `source/services/runtime-summary-store.ts`
- `source/services/snapshot-manager.ts`
- `source/services/design-token-manager.ts`
- `source/services/design-patch-engine.ts`

---

## 八、开发步骤拆分

整个能力建议拆分为 6 个 Step，便于逐步上线验证。

### Step 1: 预览会话与浏览器日志桥接

**目标**: 让 `project_build action=preview` 真正返回 `sessionId`，并打通预览页日志采集。

**范围**:

- `project_build` 预览会话化
- `/api/preview/logs/ingest`
- `debug_logs action=browser`
- `preview-template/mcp-preview-bridge.js` 中的 console / error hook

**完成标准**:

- 刷新浏览器预览页后，`debug_logs action=browser` 能稳定看到日志
- 日志支持 session 过滤

### Step 2: Runtime Summary 与 Timeline

**目标**: 让 AI 能理解页面是否正常启动、是否卡顿、是否存在资源失败和动画运行。

**范围**:

- `/api/preview/runtime/ingest`
- `preview_runtime action=summary|timeline|markers`
- marker 机制

**完成标准**:

- 能看到首帧、加载、错误、动画等 marker
- summary 中能返回 fps、frameTime、node/component 基础统计

### Step 3: Snapshot Capture

**目标**: 让 AI 能看见当前画面和关键帧序列。

**范围**:

- `/api/preview/capture/request`
- `/api/preview/capture/upload`
- `preview_capture`
- snapshot 资源读出

**完成标准**:

- `preview_capture action=snapshot` 返回截图 artifact
- `preview://session/{id}/snapshot/latest` 可读取

### Step 4: Design Token 持久化与查询

**目标**: 给 AI 一个稳定的高层视觉入口，而不是只改底层属性。

**范围**:

- `.mcp/design/tokens.json`
- `design_token query/upsert/remove/export`

**完成标准**:

- AI 可查询现有 token
- AI 可一次性调整一组颜色/字号/间距 token

### Step 5: Semantic Patch 编译器

**目标**: 把“设计建议”变成可执行 patch，并支持 dry-run / rollback。

**范围**:

- `design_patch dry_run/apply/rollback`
- 编译到 `node_modify` / `component_modify` / `animation_clip`

**完成标准**:

- dry-run 能返回预期改动列表
- apply 后能产出 rollbackId

### Step 6: 资源绑定与工作流固化

**目标**: 让资源能直接进入 AI 上下文，形成稳定工作流。

**范围**:

- `resources/list`
- `resources/read`
- 输出示例 prompt / 工作流文档

**完成标准**:

- `project_build action=preview` 返回 resource URI
- AI 能在一个工作流中完成“预览 -> 读 summary -> 看截图 -> patch -> 再预览”

---

## 九、测试策略

### 9.1 L1: 编译验证

```bash
npm run build
```

预期：

- 零 TypeScript 错误

### 9.2 L2: 工具与资源注册验证

验证工具：

- `project_build`
- `debug_logs`
- `preview_runtime`
- `preview_capture`
- `design_token`
- `design_patch`

验证资源：

- `preview://sessions`
- `preview://session/{id}/summary`
- `preview://session/{id}/snapshot/latest`

### 9.3 L3: 预览链路验证

验证场景：

1. 启动浏览器预览
2. 页面输出 `console.log`
3. 人为制造一个 `Promise.reject`
4. 触发一次截图
5. 查询 runtime summary

预期：

- 日志能采集
- 异常能采集
- summary 能更新
- 截图可读取

### 9.4 L4: 设计闭环验证

推荐至少验证 3 个真实任务：

1. **UI 风格统一**
   - 修改标题、正文、按钮的字号层级和颜色角色
2. **布局优化**
   - 调整列表项间距和信息层级
3. **动效调优**
   - 给按钮点击增加反馈动画
   - 给列表项增加 stagger 入场

验收标准：

- AI 能在 2 到 3 轮内收敛
- 修改主要通过 token 和 semantic patch 完成，而不是大量手调低层属性

---

## 十、风险与回滚

### 10.1 主要风险

| 风险 | 影响 | 规避方案 |
|------|------|---------|
| 预览桥接脚本对 Creator 模板兼容性差 | 预览页启动失败 | 优先用最小注入脚本，必要时提供一键关闭桥接 |
| 运行态采样过重 | 影响预览帧率 | 默认 1Hz 心跳、按需截图、环形缓冲 |
| 动画统计难度高 | 摘要不准确 | 第一阶段只保证基础字段，复杂 tween 跟踪设为可选 |
| 设计 token 过度自由 | AI 产生混乱风格 | 限制 token 种类，先支持固定语义角色 |
| 资源能力接入成本高 | MCP 兼容性延期 | 先提供 HTTP 兼容资源接口，后补标准 resource |

### 10.2 回滚策略

- Step 1 到 Step 5 可独立回滚
- `preview-template` 注入脚本可通过开关禁用
- `design_patch` 默认先 dry-run，降低误修改风险
- 所有 apply 操作记录 rollbackId

---

## 十一、结论

如果希望 AI 真正帮你补齐 UI 设计和动画设计短板，最关键的不是再增加更多“生成”工具，而是补齐以下 3 件事：

1. **让 AI 看得见**: 截图、日志、runtime summary、timeline
2. **让 AI 改得高层**: design token、motion preset、semantic patch
3. **让 AI 能闭环**: 资源绑定、dry-run、rollback、多轮评审

在现有工具优化方案基础上，本方案只新增 4 个工具，并增强 2 个已有工具，即可把 MCP 从“场景编辑器”推进到“设计闭环代理”。

这是当前性价比最高、也最符合你这套系统现状的演进方向。
