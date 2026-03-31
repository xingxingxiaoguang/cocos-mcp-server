# Step 0: IPC 契约治理与死代码止血

> 前置依赖：无  
> 预计改动量：中  
> 目标：修复主进程与面板的契约漂移，清掉“注册了但没实现”的消息和遗留入口

---

## 1. 背景

当前已经出现明确的边界失配：

- `package.json` 注册了 `open-tool-manager -> openToolManager`，但 `source/main.ts` 没有对应实现。
- `source/panels/tool-manager/index.ts` 调用 `updateToolStatus(configId, category, name, enabled)`。
- `source/main.ts` 实现的 `updateToolStatus(category, toolName, enabled)` 会忽略面板传入的 `configId`。
- `updateToolStatusBatch` 也存在同样问题，面板传 `(configId, updates)`，主进程只接 `updates`。
- `default` 面板和 `tool-manager` 面板直接散落调用 `Editor.Message.request('cocos-mcp-server', ...)`，没有统一约束。

如果这个阶段不先修，后续所有服务拆分和面板治理都会建立在错误契约上。

---

## 2. 本 Step 交付物

### 2.1 新增文件

```text
source/ipc/contracts.ts
source/ipc/client.ts
source/test/ipc-contract-smoke.ts   # 可按项目现有测试方式落成
```

### 2.2 修改文件

```text
package.json
source/main.ts
source/panels/default/index.ts
source/panels/tool-manager/index.ts
source/types/index.ts               # 如需 re-export IPC 相关类型，可最小补充
```

---

## 3. 目标契约设计

### 3.1 `contracts.ts` 负责什么

集中定义：

- 主进程 message 名称常量
- 每个 message 的参数类型
- 每个 message 的返回值类型
- `ToolManagerState` 的统一结构
- 批量更新项 `ToolStatusUpdate`

建议结构：

```typescript
export const IPC_MESSAGES = {
  OPEN_PANEL: 'open-panel',
  START_SERVER: 'start-server',
  STOP_SERVER: 'stop-server',
  GET_SERVER_STATUS: 'get-server-status',
  UPDATE_SETTINGS: 'update-settings',
  GET_TOOL_MANAGER_STATE: 'getToolManagerState',
  UPDATE_TOOL_STATUS: 'updateToolStatus',
  UPDATE_TOOL_STATUS_BATCH: 'updateToolStatusBatch',
} as const;

export interface ToolStatusUpdate {
  category: string;
  name: string;
  enabled: boolean;
}

export interface ToolManagerState {
  success: boolean;
  selectedConfigId: string;
  currentConfiguration: ToolConfiguration | null;
  configurations: ToolConfiguration[];
  availableTools: ToolConfig[];
}
```

### 3.2 `client.ts` 负责什么

封装面板侧 IPC 请求：

- `getToolManagerState()`
- `updateToolStatus(configId, category, name, enabled)`
- `updateToolStatusBatch(configId, updates)`
- `createToolConfiguration(name, description?)`
- `setCurrentToolConfiguration(configId)`

要求：

- 面板内不再直接写 message 字符串。
- 所有 `Editor.Message.request('cocos-mcp-server', ...)` 都经过这里。

---

## 4. 执行步骤

### 4.1 先做 message 清点

核对 `package.json > contributions.messages` 和 `source/main.ts > methods`：

- 列出“已注册未实现”
- 列出“已实现未注册”
- 列出“参数签名不一致”

这一轮清点结果必须写进提交描述，作为后续回归基线。

### 4.2 建立 IPC 类型契约

新增 `source/ipc/contracts.ts`，至少覆盖以下消息：

- `get-server-status`
- `update-settings`
- `getToolManagerState`
- `createToolConfiguration`
- `updateToolConfiguration`
- `deleteToolConfiguration`
- `setCurrentToolConfiguration`
- `updateToolStatus`
- `updateToolStatusBatch`
- `exportToolConfiguration`
- `importToolConfiguration`
- `getEnabledTools`

### 4.3 建立面板侧统一 client

新增 `source/ipc/client.ts`：

- 默认面板切到 client 调用
- 如果保留 `tool-manager` 面板，也必须同时切到 client
- 不允许两个面板继续各自维护参数顺序

### 4.4 对齐主进程签名

`source/main.ts` 统一为显式签名：

```typescript
async updateToolStatus(configId: string, category: string, toolName: string, enabled: boolean)
async updateToolStatusBatch(configId: string, updates: ToolStatusUpdate[])
```

不要再依赖“当前配置隐式存在”的副作用。

### 4.5 处理 `open-tool-manager`

二选一，必须在本 Step 定案：

1. 补 `openToolManager()` 并把面板接到同一套 IPC 契约。
2. 从 `package.json` 删除 `open-tool-manager`，并把 `panels/tool-manager` 标记为遗留待删。

推荐选项：

- 如果当前默认面板已覆盖主要工具管理能力，直接删除贡献消息，避免继续养遗留入口。

### 4.6 增加契约冒烟验证

建议新增一个最小测试脚本或编译型断言，至少覆盖：

- `getToolManagerState` 返回结构完整
- `updateToolStatus` 参数顺序正确
- `updateToolStatusBatch` 参数顺序正确
- `package.json` 中不存在“声明了却找不到实现”的 message

---

## 5. 文件级改动建议

### 5.1 `package.json`

- 修正或删除 `open-tool-manager`
- 如有不再使用的消息名，顺手清理

### 5.2 `source/main.ts`

- 保留消息入口，不做大规模业务重构
- 只修正签名、参数转发、错误边界
- 复杂业务拆分留给 Step 1

### 5.3 `source/panels/default/index.ts`

- 删除散落的直接 IPC 调用
- 统一改走 `ipc/client.ts`
- 为下一阶段状态同步治理留出单一入口

### 5.4 `source/panels/tool-manager/index.ts`

- 如果保留：必须先修签名和状态读取
- 如果不保留：本 Step 只断开贡献入口，不必立即删文件

---

## 6. 验收标准

### L1 编译验证

```bash
npm run build
```

### L2 契约冒烟

至少验证以下调用链：

```text
panel -> ipc/client -> main.ts -> ToolManager / ToolConfigService
```

重点检查：

- 单工具开关能命中正确配置
- 批量开关不会因为参数错位而误改全部工具
- 获取状态时 `selectedConfigId`、`currentConfiguration`、`configurations` 三者一致

### 6.1 主要回归测试用例

#### TC-0-01：message 注册与实现一致性检查

- 前置条件：完成 `package.json` 与 `source/main.ts` 的对齐。
- 操作：遍历 `contributions.messages`，逐个核对 `methods` 是否存在。
- 预期：
  - 不存在“已注册未实现”的 message。
  - 不存在“已实现未注册”的主进程方法。

#### TC-0-02：获取工具管理状态结构稳定

- 前置条件：扩展已加载，存在至少 1 个配置。
- 操作：通过 `ipc/client.ts` 调用 `getToolManagerState()`。
- 预期：
  - 返回含 `success`、`selectedConfigId`、`currentConfiguration`、`configurations`、`availableTools`。
  - `selectedConfigId === currentConfiguration.id`。
  - `currentConfiguration.tools` 与 `availableTools` 的类别和工具名可对应。

#### TC-0-03：单工具开关命中指定配置

- 前置条件：至少存在两个配置，且同一工具在两个配置中的启用状态不同。
- 操作：调用 `updateToolStatus(configId, category, toolName, enabled)` 更新指定配置。
- 预期：
  - 只有目标 `configId` 被修改。
  - 非目标配置不受影响。
  - 返回 `success: true`。

#### TC-0-04：批量工具开关参数不串位

- 前置条件：当前配置内至少有一个类别下 2 个以上工具。
- 操作：调用 `updateToolStatusBatch(configId, updates)`，混合开启和关闭多个工具。
- 预期：
  - 所有 update 按 `category + name` 精确落到目标工具。
  - 不出现整类误开或误关。
  - 主进程不会把 `configId` 当作更新数组处理。

#### TC-0-05：面板调用路径统一

- 前置条件：默认面板和旧 `tool-manager` 面板都可打开，或旧面板入口已移除。
- 操作：
  - 在默认面板切换一个工具状态。
  - 如果保留旧面板，也在旧面板切换一个工具状态。
- 预期：
  - 两者都经由 `ipc/client.ts`。
  - 参数顺序一致。
  - 状态刷新一致。

#### TC-0-06：`open-tool-manager` 去留一致

- 前置条件：完成本 Step 对该入口的决策。
- 操作：
  - 如果保留，触发 `open-tool-manager`。
  - 如果删除，检查 `package.json` 中已无该 message。
- 预期：
  - 不存在“菜单或消息入口可触发，但实际无实现”的情况。

### 完成标记

- [ ] 已新增 `source/ipc/contracts.ts`
- [ ] 已新增 `source/ipc/client.ts`
- [ ] `updateToolStatus*` 参数顺序统一
- [ ] `getToolManagerState` 返回结构统一
- [ ] 无“注册了但未实现”的 message
- [ ] IPC smoke test 可执行

---

## 7. 回滚策略

- 这个 Step 不应删除核心业务代码，回滚成本应保持在单提交级别。
- 如果 `tool-manager` 面板暂未删除，只断开贡献入口即可，避免强行删文件导致排查困难。
- `contracts.ts` / `client.ts` 可以保留，即使回滚主进程实现，也不会影响后续重做。
