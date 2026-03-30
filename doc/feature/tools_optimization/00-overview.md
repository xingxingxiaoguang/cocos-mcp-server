# MCP 工具集优化 — 总览

> 本文档是优化方案的全局上下文，所有子需求文档共享此处定义的约定和规范。

---

## 1. 优化目标

将 157 个 MCP 工具精简至 ~34 个，同时补齐 Cocos Creator 开发的关键能力缺口。

| 目标 | 量化标准 |
|------|---------|
| 工具总数 ≤ 40 | 处于 AI 模型最佳路由准确率区间 |
| 零同义工具 | 每个操作只有唯一入口，通过 `action` 参数区分行为 |
| 参数命名统一 | 见下方命名规范 |
| 写操作返回完整结果 | 减少 AI 的验证查询调用 |
| 补齐脚本读写能力 | 使 AI 能完成从场景搭建到逻辑编写的完整流程 |

---

## 2. 当前架构要点

开发前必须理解的关键机制，避免在子需求中重复说明。

### 2.1 工具路由机制

`mcp-server.ts:executeToolCall()` 按第一个 `_` 拆分工具名：

```
工具名 "node_create_node" → category="node", toolName="create_node"
工具名 "sceneAdvanced_reset_node_property" → category="sceneAdvanced", toolName="reset_node_property"
```

路由代码：
```typescript
// source/mcp-server.ts:137-147
public async executeToolCall(toolName: string, args: any): Promise<any> {
    const parts = toolName.split('_');
    const category = parts[0];
    const toolMethodName = parts.slice(1).join('_');
    if (this.tools[category]) {
        return await this.tools[category].execute(toolMethodName, args);
    }
    throw new Error(`Tool ${toolName} not found`);
}
```

### 2.2 工具注册机制

`mcp-server.ts:initializeTools()` 中以 `this.tools[categoryKey] = new XxxTools()` 注册，`setupTools()` 遍历 `this.tools` 生成 `toolsList`，工具名格式为 `{categoryKey}_{tool.name}`。

### 2.3 ToolExecutor 接口

所有工具类必须实现：
```typescript
interface ToolExecutor {
    getTools(): ToolDefinition[];
    execute(toolName: string, args: any): Promise<ToolResponse>;
}
```

### 2.4 底层调用路径

- `Editor.Message.request('scene', method, ...args)` — 节点/组件/场景操作
- `Editor.Message.request('asset-db', method, ...args)` — 资源 CRUD
- `fs` 直接读写 — 日志读取、偏好导出等

### 2.5 tool-manager.ts 的工具发现

`ToolManager.initializeAvailableTools()` 通过 `require()` 动态导入所有工具类，实例化后调用 `getTools()` 获取工具列表。工具增删时此处需同步修改。

### 2.6 面板 UI

`source/panels/default/index.ts` 通过 IPC 调用 `getToolManagerState()` 动态获取工具列表，不硬编码类别名。工具变更后面板自动适配，通常无需改动。

---

## 3. 参数命名规范（所有子需求必须遵守）

| 用途 | 参数名 | 类型 | 说明 |
|------|--------|------|------|
| 单个节点/组件/资源标识 | `uuid` | `string` | |
| 批量标识 | `uuids` | `string[]` | |
| 资源路径 | `path` | `string` | 统一使用 `db://` 格式 |
| 操作类型 | `action` | `string` literal union | 每个工具定义自己的 action 枚举 |

---

## 4. 新工具文件规范

- 新工具文件统一放在 `source/tools/v2/` 目录下
- 文件命名：`{category}-tools.ts`（如 `scene-tools.ts`、`node-tools.ts`）
- 类命名：`{Category}ToolsV2`（如 `SceneToolsV2`、`NodeToolsV2`），避免与旧类冲突
- 每个类实现 `ToolExecutor` 接口
- `execute()` 方法内通过 `switch(action)` 或参数组合路由到具体逻辑
- 底层 `Editor.Message.request()` 调用代码从旧文件直接迁移，不修改调用方式
- 所有写操作执行成功后，额外返回修改后的完整对象信息

---

## 5. 开发步骤依赖关系

```
Step 1 (删除无价值类别)           ← 01-remove-unused-categories.md
  │
  ▼
Step 2 (合并 Scene + Node)       ← 02-merge-scene-node.md
  │
  ▼
Step 3 (合并 Component + Prefab) ← 03-merge-component-prefab.md
  │
  ▼
Step 4 (合并 Asset + Debug + 其他) ← 04-merge-auxiliary-tools.md
  │
  ▼
Step 5 (切换路由层 + 删除旧文件)   ← 05-switch-routing-cleanup.md
  │
  ▼
Step 6 (新增能力工具)             ← 06-new-capability-tools.md
```

- Step 1 是所有后续步骤的前置条件
- Step 2/3/4 共享 `scene-advanced-tools.ts` 的拆分，必须顺序执行
- Step 5 依赖 Step 2/3/4 全部完成
- Step 6 依赖 Step 5 完成

---

## 6. 测试策略（所有子需求共用）

| 层次 | 方法 | 何时执行 |
|------|------|---------|
| L1: 编译验证 | `npm run build` 零 TS 错误 | 每个 Step 必做 |
| L2: 接口验证 | curl 调用 MCP 端点，验证工具注册和参数解析 | 每个 Step 必做 |
| L3: 功能验证 | 在 Cocos Creator 中实际操作 | Step 2-6 必做 |

L2 通用验证命令：
```bash
# 检查工具总数
curl -s http://127.0.0.1:8585/health | python3 -c "import sys,json; print(json.load(sys.stdin)['tools'])"

# 检查工具名列表
curl -s -X POST http://127.0.0.1:8585/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' \
  | python3 -c "import sys,json; [print(t['name']) for t in json.load(sys.stdin)['result']['tools']]"
```

---

## 7. 回滚策略

- 每个 Step 完成后创建 git tag（如 `tool-opt/step-1`）
- Step 2/3/4 期间新旧文件并存（v2/ 目录），旧文件未删除，可随时回退
- Step 5 是不可逆点（删除旧文件），执行前确保所有测试通过
- 如果 Step 5 后发现问题，通过 `git revert` 回退

---

## 8. 分支策略

```
main
  └── feature/tool-optimization
        ├── step-1-remove-unused
        ├── step-2-merge-scene-node
        ├── step-3-merge-component-prefab
        ├── step-4-merge-asset-debug-others
        ├── step-5-switch-routing
        └── step-6-new-tools
```

每个 Step 完成并验证后合并到 `feature/tool-optimization`，全部完成后合并到 `main`。

---

## 9. 目标工具集总览（34 个）

| 类别 | 工具数 | 工具名 |
|------|--------|--------|
| 场景 Scene | 5 | `scene_query`, `scene_open`, `scene_save`, `scene_create`, `scene_manage` |
| 节点 Node | 5 | `node_query`, `node_create`, `node_modify`, `node_delete`, `node_arrange` |
| 组件 Component | 3 | `component_query`, `component_add`, `component_modify` |
| 预制体 Prefab | 3 | `prefab_query`, `prefab_create`, `prefab_update` |
| 资源 Asset | 5 | `asset_query`, `asset_create`, `asset_modify`, `asset_delete`, `asset_refresh` |
| 调试 Debug | 3 | `debug_logs`, `debug_execute`, `debug_inspect` |
| 项目 Project | 2 | `project_query`, `project_build` |
| 偏好 Preferences | 2 | `preferences_query`, `preferences_modify` |
| Undo | 1 | `undo_recording` |
| 场景脚本 | 1 | `scene_script` |
| 数组属性 | 1 | `array_property` |
| 脚本文件（新增） | 1 | `script_file` |
| 动画（新增） | 1 | `animation_clip` |
| 材质（新增） | 1 | `material_property` |
