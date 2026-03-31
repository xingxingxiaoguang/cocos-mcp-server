# Step 5: Panel、日志与协议收尾

> 前置依赖：Step 4  
> 预计改动量：中  
> 目标：统一 UI 入口、补齐请求级日志、收紧协议解析，并同步开发规范

---

## 1. 背景

即使核心架构已经收敛，项目最后仍有三类“容易返脏”的地方：

- 面板状态管理还不一致
- `mcp-server.ts` 缺少统一请求日志
- MCP JSON 解析仍存在激进自动修复逻辑

如果这一步不做，后续维护还是会重新长出旁路实现。

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
doc/plan/architecture-optimization-plan.md   # 可补阶段状态，不改主设计
```

### 2.2 可新增文件

```text
source/utils/request-logger.ts
source/types/logging.ts                   # 如需单独声明
```

---

## 3. Panel 层治理

### 3.1 默认面板成为唯一受支持入口

目标：

- 默认面板承担服务器状态、设置管理、工具开关管理
- 状态读取统一走 `ipc/client.ts`
- 生命周期和轮询清理有明确边界

需要处理的问题：

- 轮询定时器必须在 `hide` / `beforeUnmount` 时清理
- 面板内本地状态不能长期偏离主进程状态
- 设置保存和服务状态刷新要有单向同步

### 3.2 旧 `tool-manager` 面板定案

这个阶段必须最终落地，不能继续“留着再说”：

1. 保留并重构
2. 删除文件和相关静态资源

推荐做法：

- 如果默认面板已覆盖配置创建、切换、批量开关能力，则删除 `panels/tool-manager`

删除时需要同步清理：

- `package.json` 消息或面板入口
- 无用模板 / 样式引用
- 相关 IPC client 调用残留

---

## 4. 请求日志中间件

### 4.1 目标

在 `mcp-server.ts` 工具执行链路记录：

- `requestId`
- MCP 方法
- 工具名
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
  durationMs: number;
  success: boolean;
  errorCode?: string;
}
```

要求：

- `enableDebugLog` 为 `true` 时输出详细日志
- 默认日志保持简洁，不刷屏
- 长脚本、长 JSON、资源文本内容要截断

### 4.3 接线位置

建议在以下位置落日志：

- `handleHttpRequest()`
- `handleMCPRequest()`
- `handleMessage()`
- `executeToolCall()`

不要让每个工具自己重复写一套调用日志。

---

## 5. 严格协议解析

### 5.1 现状问题

`mcp-server.ts` 里 `fixCommonJsonIssues()` 过于激进，容易把非法输入“猜着修”，最终增加误诊成本。

### 5.2 收紧策略

建议改成三段式：

1. 直接 `JSON.parse`
2. 失败后仅记录简短上下文和错误位置
3. 返回标准 `Parse error`

不再默认自动修复 JSON。

如果确实要保留兼容逻辑，也必须：

- 开关受控
- 默认关闭
- 日志里明确标识“使用了兼容修复路径”

---

## 6. 文档与规范同步

需要同步更新：

- `README.md`
- `README.EN.md`
- 架构 plan 的阶段完成状态

至少补充以下内容：

- 工具注册只改 `tool-registry.ts`
- 面板调用统一走 `ipc/client.ts`
- 不允许新增散落的 `Editor.Message.request(...)`
- 新工具默认继承 `BaseToolExecutor`

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

### 7.1 主要回归测试用例

#### TC-5-01：默认面板生命周期稳定

- 前置条件：默认面板已成为唯一受支持入口。
- 操作：连续执行“打开面板 -> 切换 tab -> 关闭面板 -> 再次打开”三次。
- 预期：
  - 无重复挂载、重复监听、空引用报错。
  - 状态展示与主进程一致。

#### TC-5-02：轮询和定时器正确清理

- 前置条件：默认面板存在状态轮询或刷新定时器。
- 操作：打开面板观察一段时间后关闭，再检查是否仍有重复刷新或后台报错。
- 预期：
  - 面板关闭后定时器被释放。
  - 再次打开不会叠加多份轮询。

#### TC-5-03：工具状态和服务状态单向同步

- 前置条件：默认面板已通过 `ipc/client.ts` 读取状态。
- 操作：
  - 在面板里修改配置或工具启用状态。
  - 重新打开面板或刷新状态。
- 预期：
  - 面板展示以主进程状态为准。
  - 不出现本地状态与实际状态长期偏离。

#### TC-5-04：请求日志记录关键字段

- 前置条件：`request-logger` 已接入，`enableDebugLog=true`。
- 操作：
  - 调用一次成功工具。
  - 调用一次失败工具。
- 预期：
  - 日志至少包含 `requestId`、method、toolName、durationMs、success。
  - 失败日志包含 `errorCode` 或等价错误分类信息。

#### TC-5-05：长参数和脚本内容被截断

- 前置条件：请求日志已启用。
- 操作：发送包含长脚本或大 JSON 参数的工具调用。
- 预期：
  - 日志中参数被截断或脱敏。
  - 不把整段脚本或大对象原样刷到控制台。

#### TC-5-06：非法 JSON 不再走激进自动修复

- 前置条件：已收紧 `fixCommonJsonIssues()`。
- 操作：向 `/mcp` 发送明显非法的 JSON 请求。
- 预期：
  - 返回标准 parse error。
  - 不再“猜着修”后继续执行工具。

#### TC-5-07：旧 `tool-manager` 面板去留与代码状态一致

- 前置条件：本 Step 对旧面板已定案。
- 操作：
  - 如果删除，检查入口、消息、静态模板、残留调用是否已清理。
  - 如果保留，打开并验证与默认面板契约一致。
- 预期：
  - 不存在“入口被删了但代码仍在偷偷依赖”或“入口还在但已失效”的半状态。

### 完成标记

- [ ] 默认面板状态治理完成
- [ ] 旧 `tool-manager` 面板已重构或删除
- [ ] `mcp-server.ts` 已接入统一请求日志
- [ ] JSON 自动修复逻辑已删除或降级为受控兼容路径
- [ ] README 与开发规范已同步更新

---

## 8. 回滚策略

- 请求日志中间件应为可关闭增强项，出问题时可先禁用详细日志。
- JSON 解析收紧如果影响现网兼容，可临时保留受控 fallback，但不能恢复到默认激进修复。
- 面板删除前先确认默认面板能力完全覆盖，必要时可先隐藏入口再删文件。
