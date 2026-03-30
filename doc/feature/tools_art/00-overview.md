# MCP UI / 动画设计辅助能力 — 总览

> 本文档定义 UI / 动画设计辅助能力的总体目标、边界、工具集和开发步骤。所有子需求文档共享这里的约定。

---

## 1. 目标

把当前 MCP 工具从“工程执行器”增强为“设计闭环代理”，让 AI 能在 Cocos Creator 项目中完成中低复杂度的：

- UI 草案生成与迭代
- 布局层级、留白、视觉统一性优化
- 按钮反馈、列表入场、页面切换等基础动效设计

核心不是一次性生成最终稿，而是建立下面这条闭环：

```text
brief / 参考图
  → 生成初稿
  → 运行预览
  → 采集截图 / 日志 / 运行态摘要
  → AI 评审
  → 继续 patch
```

---

## 2. 当前缺口

| 缺口 | 当前表现 | 影响 |
|------|---------|------|
| 预览不可观测 | 无截图、无序列帧、无资源绑定 | AI 看不到真实画面 |
| 浏览器日志缺失 | `debug_logs` 只覆盖 editor console 和 `project.log` | 无法定位预览页错误 |
| 无运行态摘要 | 无 session summary、timeline、marker | 无法理解首帧、加载、卡顿、动画状态 |
| 编辑抽象过低 | 主要靠节点/组件属性直接修改 | AI 易陷入盲调属性 |
| 无设计语义层 | 无 design token、semantic patch | 风格和节奏难统一 |
| 无资源能力 | MCP 服务未实现标准 `resources/list` / `resources/read` | 截图和摘要难复用 |

---

## 3. 建设原则

1. 先补“看得见”，再补“改得高层”。
2. 工具数保持克制，优先增强现有工具。
3. 不做视频流，优先做心跳摘要、时间线和按需截图。
4. 高层设计修改必须能编译回现有 `node_*` / `component_*` 工具。
5. 所有运行态数据都按 `sessionId` 隔离。

---

## 4. 总体架构

```text
Layer A: 预览可观测层
  - 预览会话管理
  - 浏览器 console / error bridge
  - runtime heartbeat / timeline
  - on-demand snapshot

Layer B: 设计抽象层
  - design tokens
  - motion presets
  - semantic patch

Layer C: 闭环层
  - patch 编译为现有 MCP 写操作
  - 将截图、摘要、时间线暴露为 MCP Resource
  - 支持 dry-run / rollback / 多轮迭代
```

---

## 5. 目标工具集

### 5.1 增强现有工具

| 工具 | 增强点 |
|------|-------|
| `project_build` | `action=preview` 返回真实预览会话；`status` 包含 session 状态 |
| `debug_logs` | 新增 `action=browser`，可按 `sessionId` 查询浏览器日志 |

### 5.2 新增工具

| MCP 工具名 | 说明 |
|-----------|------|
| `preview_runtime` | 查询 summary / timeline / markers |
| `preview_capture` | 请求单帧截图、序列帧、读取 latest |
| `design_token` | 查询和维护 design tokens |
| `design_patch` | dry-run / apply / rollback 语义化设计 patch |

### 5.3 工具数量

| 项目 | 数量 |
|------|------|
| 现有优化后工具 | 34 |
| 新增工具 | 4 |
| **总计** | **38** |

---

## 6. 资源模型

推荐为预览工件补齐 MCP Resource：

| Resource URI | 说明 |
|--------------|------|
| `preview://sessions` | 当前所有预览会话 |
| `preview://session/{sessionId}/summary` | 最新 runtime summary |
| `preview://session/{sessionId}/timeline` | 事件时间线 |
| `preview://session/{sessionId}/snapshot/latest` | 最新截图 |
| `preview://session/{sessionId}/snapshot/{snapshotId}` | 指定截图 |
| `design://tokens/current` | 当前 design token 集 |
| `design://patches/latest` | 最近一次 patch 结果 |

短期可先提供 HTTP 兼容接口，长期再升级为标准 MCP Resource。

---

## 7. 公共命名规范

| 用途 | 参数名 | 说明 |
|------|--------|------|
| 预览会话标识 | `sessionId` | 统一用于日志、摘要、截图、timeline |
| 操作类型 | `action` | 每个工具定义自己的枚举 |
| 资源 URI 列表 | `resourceUris` | 工具返回中统一字段 |
| 时间戳 | `ts` | ISO 8601 字符串 |
| 查询起点 | `sinceTs` | 增量读取运行态数据 |

---

## 8. 新类型约定

新增核心类型：

- `PreviewSession`
- `BrowserLogEntry`
- `RuntimeHeartbeat`
- `RuntimeSummary`
- `PreviewMarker`
- `SnapshotArtifact`
- `DesignTokenSet`
- `DesignPatch`
- `PatchPlan`

具体结构由后续 step 文档定义。

---

## 9. 开发步骤依赖

```text
Step 1 预览会话与浏览器日志桥接
  ↓
Step 2 Runtime Summary 与 Timeline
  ↓
Step 3 Snapshot Capture
  ↓
Step 4 Design Token 层
  ↓
Step 5 Semantic Patch 编译器
  ↓
Step 6 Resource 绑定与工作流固化
```

依赖关系：

- Step 1 是所有后续步骤前置条件
- Step 2 依赖 Step 1 的 session 和桥接脚本
- Step 3 依赖 Step 1 的会话链路
- Step 5 依赖 Step 4 的 token 能力
- Step 6 依赖 Step 1-5 全部完成

---

## 10. 测试策略

| 层次 | 方法 | 何时执行 |
|------|------|---------|
| L1: 编译验证 | `npm run build` | 每个 Step 必做 |
| L2: 工具注册验证 | MCP `tools/list` / `tools/call` | 每个 Step 必做 |
| L3: 资源验证 | `resources/list` / `resources/read` 或 HTTP 兼容接口 | Step 3 以后必做 |
| L4: Cocos 实机验证 | 在浏览器预览中验证日志、摘要、截图和 patch | Step 1-6 必做 |

---

## 11. 回滚策略

- `preview-template` 注入脚本必须可开关禁用。
- 所有写操作优先支持 `dry_run`。
- `design_patch apply` 必须返回 `rollbackId`。
- 截图、摘要、日志都应按会话隔离，清理时不影响其他 session。

---

## 12. 子文档索引

| Step | 文档 |
|------|------|
| Step 1 | `01-preview-session-browser-logs.md` |
| Step 2 | `02-runtime-summary-timeline.md` |
| Step 3 | `03-snapshot-capture.md` |
| Step 4 | `04-design-token-layer.md` |
| Step 5 | `05-semantic-patch-engine.md` |
| Step 6 | `06-resource-workflow.md` |
