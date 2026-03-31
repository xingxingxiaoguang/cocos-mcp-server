# Step 5: Panel、日志、规范与 Capability 治理收尾

> 前置依赖：Step 4  
> 预计改动量：中  
> 目标：让 UI、日志、协议解析和开发规范与新分层架构保持一致，防止 `tools -> use-cases -> capabilities -> drivers -> messages` 再次被旁路破坏

---

## 0. 执行上下文

本文件应被视为“可单独执行”的 Step 5 收尾说明。新会话执行时，不依赖历史对话，只依赖以下前提：

- Step 4 已基本完成，至少重型工具已经按 `tool -> use-case -> capability -> driver -> message` 分层
- 默认面板仍为当前唯一或主要 UI 入口候选
- `mcp-server.ts` 仍是请求接入与工具执行链路的统一入口

如果 Step 4 还没有把工具执行链路稳定分层，本 Step 中“按 use-case / capability / driver 记录日志”就没有实施基础，应先回补 Step 4。

### 0.1 本 Step 的输入

执行时默认面对的现状：

- 面板状态管理和生命周期可能已经部分整理，但未完全治理
- 请求日志可能只有零散 `console.log`
- JSON 解析可能仍有激进兼容修复逻辑
- README / 规范仍可能保留旧的开发路径描述

### 0.2 本 Step 的输出

完成后必须交付：

- 默认面板或最终保留面板的稳定生命周期
- 可定位到 `tool / use-case / capability / driver` 的统一日志
- 收紧后的 JSON 协议解析策略
- 明确的新分层开发规范

### 0.3 执行纪律

- 不允许每个 tool / use-case / capability 自己各打一套日志
- 不允许面板旁路调用主进程内部实现
- 不允许 README 仍把新工具开发描述成“直接在 tools 中对接 Editor API”

---

## 1. 背景

即使 Step 3-4 完成分层，如果收尾阶段不治理这些入口，架构仍然会返脏：

- 面板层可能继续旁路调用旧 IPC 或直接假设主进程内部结构
- `mcp-server.ts` 如果没有统一日志，后续很难定位 use-case / capability / driver 哪一层出错
- MCP JSON 解析如果继续“猜着修”，会掩盖真正的调用错误
- README 和开发规范如果不更新，新代码还会回到旧模式

---

## 2. 本 Step 交付物

### 2.1 重点修改文件

```text
source/panels/default/index.ts
source/panels/tool-manager/index.ts      # 若保留
source/ipc/client.ts
source/main.ts
source/mcp-server.ts
README.md
README.EN.md
doc/plan/architecture-optimization-plan.md
```

### 2.2 可新增文件

```text
source/utils/request-logger.ts
source/types/logging.ts
source/application/execution/           # 如需统一 tool/use-case 执行上下文
```

---

## 3. Panel 层治理

### 3.1 默认面板成为唯一受支持入口

目标：

- 默认面板承担服务器状态、设置管理、工具开关管理
- UI 状态统一走 `ipc/client.ts`
- 面板不感知主进程内部 service、registry 或 capability 细节

要求：

- 轮询定时器在 `hide` / `beforeUnmount` 时清理
- 面板状态以主进程返回为准，不长期保留本地派生真相
- 设置保存、服务状态刷新和工具状态刷新保持单向同步

### 3.2 旧 `tool-manager` 面板定案

本阶段必须最终定案：

1. 保留并按同一 IPC 契约重构
2. 删除并同步清理入口、模板、样式、消息与残留调用

推荐：

- 如果默认面板已覆盖配置创建、切换、批量开关能力，则删除 `panels/tool-manager`

---

## 4. 请求日志体系

### 4.1 目标

日志不只记录“调用了哪个 tool”，还要能定位分层链路：

- `requestId`
- MCP 方法
- tool 名
- use-case 名
- capability 名
- driver 名
- 执行耗时
- 成功 / 失败
- `errorCode`

### 4.2 设计建议

新增轻量 logger：

```typescript
export interface RequestLogEntry {
  requestId: string;
  method: string;
  toolName?: string;
  useCase?: string;
  capability?: string;
  driver?: string;
  durationMs: number;
  success: boolean;
  errorCode?: string;
}
```

要求：

- `enableDebugLog=true` 时输出详细日志
- 默认日志保持简洁，不刷屏
- 长脚本、长 JSON、资源文本内容要截断
- 不让 tool、use-case、capability 各自重复打一套日志

### 4.3 接线位置

建议在以下位置落统一日志：

- `handleHttpRequest()`
- `handleMCPRequest()`
- `executeToolCall()`
- use-case 执行入口或统一 execution context

目标：

- 从一次请求可以顺着看到 tool -> use-case -> capability -> driver 的路径

### 4.4 新会话执行建议

新会话里建议先确认三件事，再开始写日志体系：

1. `mcp-server.ts` 当前的统一执行入口在哪里。
2. use-case / capability / driver 的调用链上，哪个位置最适合挂 execution context。
3. 是否已经存在可复用的请求 ID、debug 开关和错误码出口。

---

## 5. 严格协议解析

### 5.1 收紧策略

建议改成三段式：

1. 直接 `JSON.parse`
2. 失败后仅记录简短上下文和错误位置
3. 返回标准 `Parse error`

不再默认做激进自动修复。

### 5.2 兼容路径约束

如果必须保留兼容修复路径，也必须满足：

- 明确受配置开关控制
- 默认关闭
- 日志里标识“使用了兼容修复路径”
- 不能绕过标准错误码体系

---

## 6. 开发规范同步

README 与内部开发规范至少补充以下规则：

### 6.1 工具开发规则

- 新工具默认只写 `tools + use-cases`
- 工具层不得直接调用 `Editor.Message.request(...)`
- 工具层不得直接依赖 message 常量
- 工具层不得处理版本兼容与 fallback

### 6.2 能力开发规则

- 新的底层 Editor 能力先加 capability interface
- 实现在 capability service + driver 中完成
- 不允许直接在 tool 或 panel 中追加底层 API 对接逻辑

### 6.3 Driver 开发规则

- 版本差异只能收敛在 driver
- message 名和参数差异只能收敛在 `messages/` + `drivers/`
- 新版本适配优先新增 driver，不回流污染 tool

### 6.4 注册与入口规则

- 工具注册只改 `tool-registry.ts`
- 面板调用统一走 `ipc/client.ts`
- `scene.ts` 继续保留 facade，直到后续明确允许改动

---

## 7. 验收标准

### L1 编译验证

```bash
npm run build
```

### L2 MCP / UI 验证

至少验证：

- 默认面板打开、关闭、再次打开无异常
- 服务器启动、停止、保存设置后状态刷新正常
- 关键工具调用日志可见
- 非法 JSON 请求返回明确 parse error

### L3 架构治理验证

至少验证：

- 默认面板不旁路调用主进程内部实现
- 日志可定位到 use-case / capability / driver
- README 与文档已明确新分层纪律
- 新增代码审查时可据文档判断是否越层

### 完成标记

- [ ] 默认面板状态治理完成
- [ ] 旧 `tool-manager` 面板已重构或删除
- [ ] `mcp-server.ts` 已接入统一请求日志
- [ ] 日志已能定位 tool / use-case / capability / driver
- [ ] JSON 自动修复逻辑已删除或降级为受控兼容路径
- [ ] README 与开发规范已同步到新分层架构

---

## 8. 回滚策略

- 请求日志中间件应为可关闭增强项，出问题时可先禁用详细日志
- JSON 解析收紧如果影响兼容，可临时保留受控 fallback，但不能恢复成默认激进修复
- 面板删除前先确认默认面板能力完全覆盖，必要时可先隐藏入口再删文件
