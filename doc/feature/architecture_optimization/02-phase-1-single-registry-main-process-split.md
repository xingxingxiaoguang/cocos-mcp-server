# Step 1: 单一工具注册源与主进程服务拆分

> 前置依赖：Step 0  
> 预计改动量：中到大  
> 目标：建立唯一工具事实来源，把 `main.ts` 从“业务堆积点”收敛为薄 IPC facade

---

## 1. 背景

当前至少有三份工具事实来源：

- `source/mcp-server.ts` 里手写 `new SceneToolsV2()` 等初始化列表
- `source/tools/tool-manager.ts` 里再次 `require('./v2/...')`
- `tool-manager.ts` 里还有一份 fallback 硬编码列表

同时，主进程职责边界也不清：

- `updateSettings()` 同时保存配置并重启服务
- `main.ts` 直接编排 `ToolManager`、`MCPServer`、`settings`
- `settings.ts` 与 `tool-manager.ts` 重复维护配置读写逻辑

---

## 2. 本 Step 交付物

### 2.1 新增文件

```text
source/services/tool-registry.ts
source/services/server-controller.ts
source/services/settings-repository.ts
source/services/tool-config-service.ts
```

### 2.2 重点修改文件

```text
source/main.ts
source/mcp-server.ts
source/tools/tool-manager.ts
source/settings.ts                  # 可保留兼容导出，内部转调 repository
source/types/index.ts               # 如需新增导出
```

---

## 3. 目标结构

### 3.1 `tool-registry.ts`

作为唯一事实来源，至少提供：

- 工具类别 key
- 工具实例工厂
- 工具定义派生方法
- `availableTools` 派生方法

建议接口：

```typescript
export interface ToolRegistration {
  category: string;
  create(): ToolExecutor;
}

export const TOOL_REGISTRY: ToolRegistration[] = [
  { category: 'scene', create: () => new SceneToolsV2() },
  { category: 'node', create: () => new NodeToolsV2() },
  // ...
];

export function createToolExecutors(): Record<string, ToolExecutor> {}
export function createAvailableToolConfigs(): ToolConfig[] {}
export function createToolDefinitions(enabled?: ToolConfig[]): ToolDefinition[] {}
```

### 3.2 `server-controller.ts`

负责：

- `start()`
- `stop()`
- `restartIfNeeded(settings)`
- `getStatus()`
- `getServer()`

`MCPServer` 的生命周期只在这里管理。

### 3.3 `settings-repository.ts`

负责：

- 统一 `mcp-server.json`
- 统一 `tool-manager.json`
- 统一目录创建和 JSON 读写

不要再让 `settings.ts` 和 `tool-manager.ts` 各自维护一套文件系统逻辑。

### 3.4 `tool-config-service.ts`

负责：

- 初始化可用工具列表
- 同步配置与注册表
- 创建 / 删除 / 更新配置
- 设置当前配置
- 单个 / 批量工具开关
- 导入 / 导出配置

---

## 4. 执行步骤

### 4.1 先落 registry，不改行为

第一提交只做：

- 新增 `tool-registry.ts`
- 从 registry 派生完整工具列表
- 对比 registry 派生结果与当前 `mcp-server.ts` / `tool-manager.ts` 结果是否一致

这个提交不应同时改主进程逻辑。

### 4.2 改 `mcp-server.ts` 消费 registry

替换当前 `initializeTools()` 的手写实例化：

- 不再直接 import 全部工具类到 `mcp-server.ts`
- 由 registry 统一创建 executors
- `setupTools()` 也优先基于 registry 派生

验收点：

- 新增 `animation` 或其他新工具时，`mcp-server.ts` 不需要再改代码

### 4.3 改工具管理配置来源

重构 `source/tools/tool-manager.ts`：

- 去掉 `require('./v2/...')`
- 去掉 fallback 工具清单
- 可改为轻量 facade，内部委托 `ToolConfigService`

推荐过渡做法：

- 暂时保留 `ToolManager` 类名，内部转调 `ToolConfigService`
- 等 Step 5 再决定是否彻底删除旧类名

### 4.4 抽出 settings repository

把以下逻辑统一收口到 `settings-repository.ts`：

- settings 路径计算
- settings 目录创建
- `mcp-server.json` 读写
- `tool-manager.json` 读写
- 配置 JSON 导入导出

`source/settings.ts` 如果仍被其他代码引用，可以变成兼容层。

### 4.5 抽出 server controller

把 `main.ts` 中对 `mcpServer` 的直接操作迁移到 `ServerController`：

- `start-server`
- `stop-server`
- `get-server-status`
- `update-settings`

要求：

- `saveSettings()` 与 `restartServerIfNeeded()` 分离
- 更新设置不应默认隐式立即重启，除非策略明确如此定义

### 4.6 收窄 `main.ts`

本 Step 结束时，`main.ts` 只保留：

- message 入口注册
- 参数校验
- 服务调用
- 最薄的错误边界

不再在 `main.ts` 中直接写配置同步、工具同步、服务重建细节。

---

## 5. 文件级实施建议

### 5.1 `source/mcp-server.ts`

- 删除对所有 `*ToolsV2` 的直接 import
- 改为依赖 registry 构建 executor map
- `setupTools()` 和 `updateEnabledTools()` 都基于同一派生路径

### 5.2 `source/tools/tool-manager.ts`

- 不再负责发现工具
- 不再负责文件系统读写
- 最多保留 façade 角色

### 5.3 `source/settings.ts`

- 不要直接删除
- 先转成兼容出口，内部调用 repository

### 5.4 `source/main.ts`

- 只保留 `methods`
- 实际业务改为调用 `serverController` / `toolConfigService`

---

## 6. 验收标准

### L1 编译验证

```bash
npm run build
```

### L2 注册源一致性验证

至少验证：

- `MCPServer` 暴露的工具数与 `ToolConfigService` 可用工具数一致
- `tools/list` 结果与面板可选工具列表一致
- 新增一个 registry 项后，MCP 和工具管理都自动感知

建议 grep 检查：

```bash
rg "new .*ToolsV2|require\\('./v2/" source/mcp-server.ts source/tools/tool-manager.ts
```

预期：

- `mcp-server.ts` 不再手写 `new XxxToolsV2()`
- `tool-manager.ts` 不再 `require('./v2/...')`

### 6.1 主要回归测试用例

#### TC-1-01：registry 派生结果与 MCP 工具列表一致

- 前置条件：`tool-registry.ts` 已接入 `mcp-server.ts`。
- 操作：比较 registry 派生的工具总数与 `tools/list` 结果。
- 预期：
  - 工具总数一致。
  - 每个工具名都符合 `category_tool` 组合规则。

#### TC-1-02：registry 派生结果与工具管理列表一致

- 前置条件：`ToolConfigService` 已消费 registry。
- 操作：调用 `getToolManagerState()` 并提取 `availableTools`。
- 预期：
  - `availableTools` 的类别与工具名集合与 registry 一致。
  - 不再依赖 fallback 硬编码清单。

#### TC-1-03：新增 registry 项后双端自动感知

- 前置条件：临时在 registry 中添加一个测试工具注册项。
- 操作：
  - 构建并启动服务。
  - 调用 `tools/list`。
  - 打开面板查看工具列表。
- 预期：
  - MCP 工具列表出现该工具。
  - 面板可选工具列表同步出现该工具。
  - 无需修改 `mcp-server.ts` 或 `tool-manager.ts` 额外代码。

#### TC-1-04：设置保存与服务生命周期解耦

- 前置条件：`ServerController` 与 `SettingsRepository` 已接线。
- 操作：
  - 修改设置并保存。
  - 检查服务是否按设计保持运行、停止或按需重启。
- 预期：
  - 行为符合当前策略定义。
  - 不再出现 `main.ts` 里隐式重建服务导致的不可预测重启。

#### TC-1-05：工具配置同步补齐新增工具

- 前置条件：已有历史 `tool-manager.json`，其中缺少新加 registry 项。
- 操作：加载扩展并读取当前配置。
- 预期：
  - 历史配置自动补齐新增工具项。
  - 已有工具启用状态保持不变。
  - `updatedAt` 仅在真实同步发生时更新。

#### TC-1-06：主进程瘦身后核心 message 仍可用

- 前置条件：`main.ts` 已改为调用 service/controller。
- 操作：逐个调用 `start-server`、`stop-server`、`get-server-status`、`getToolManagerState`。
- 预期：
  - 返回结果与 Step 0 时一致或更稳定。
  - 不因服务拆分导致 message 行为丢失。

### 完成标记

- [ ] 已新增 `tool-registry.ts`
- [ ] 工具注册源只剩 1 份
- [ ] 已新增 `server-controller.ts`
- [ ] 已新增 `settings-repository.ts`
- [ ] 已新增 `tool-config-service.ts`
- [ ] `main.ts` 不再直接承担业务编排

---

## 7. 风险与回滚

### 主要风险

- registry 派生的工具顺序变化，可能影响面板显示顺序
- `ToolManager` 向 service 迁移时，旧配置同步逻辑可能漏掉新增工具
- 设置更新策略改变后，用户可能感觉“保存设置不再立即生效”

### 回滚建议

- registry 接入与 service 拆分分两个提交完成
- 保留 `ToolManager` façade，避免一次性改完调用方
- `settings.ts` 先兼容，不在本 Step 删除
