# MCP 工具集优化技术方案

> 版本: 1.0
> 日期: 2026-03-26
> 目标: 从 AI 调用偏好出发，将 157 个工具精简至 ~38 个，同时补齐 Cocos Creator 开发的关键能力缺口。

---

## 一、现状分析

### 1.1 工具清单（基于源码 `source/tools/*.ts` 实际统计）

| 文件 | 工具数 | 类别前缀 |
|------|--------|----------|
| scene-tools.ts | 8 | `scene_` |
| node-tools.ts | 11 | `node_` |
| component-tools.ts | 7 | `component_` |
| prefab-tools.ts | 10 | `prefab_` |
| project-tools.ts | 24 | `project_` |
| debug-tools.ts | 10 | `debug_` |
| preferences-tools.ts | 7 | `preferences_` |
| server-tools.ts | 6 | `server_` |
| broadcast-tools.ts | 5 | `broadcast_` |
| scene-advanced-tools.ts | 23 | `sceneAdvanced_` |
| scene-view-tools.ts | 20 | `sceneView_` |
| reference-image-tools.ts | 12 | `referenceImage_` |
| asset-advanced-tools.ts | 11 | `assetAdvanced_` |
| validation-tools.ts | 3 | `validation_` |
| **合计** | **157** | |

### 1.2 工具路由机制

`mcp-server.ts:executeToolCall()` 按 `{category}_{toolName}` 格式拆分，取第一个 `_` 前的部分作为 category key，后续部分作为 toolName 传入对应 ToolExecutor 的 `execute()` 方法。

```
工具名 "node_create_node" → category="node", toolName="create_node"
工具名 "sceneAdvanced_reset_node_property" → category="sceneAdvanced", toolName="reset_node_property"
```

### 1.3 底层调用路径

所有工具最终通过两条路径与 Cocos Creator 交互：

- **Editor.Message.request('scene', method, ...args)** — 主进程→场景进程 IPC，覆盖节点/组件/场景操作
- **Editor.Message.request('asset-db', method, ...args)** — 主进程→资源数据库，覆盖资源 CRUD

少数工具使用 `fs` 直接读写文件系统（日志读取、偏好导出等）。

### 1.4 当前问题

| 问题 | 影响 |
|------|------|
| 157 个工具远超 AI 模型最佳工具数（20-40） | 工具选择延迟增加，误选率上升 |
| 大量同义工具（如 `find_nodes` / `find_node_by_name` / `get_all_nodes`） | AI 在同义工具间犹豫，经常选错 |
| 参数命名不一致（`uuid` / `nodeUuid` / `uuids`） | AI 产生参数名幻觉 |
| 整类工具对 AI 无价值（sceneView、referenceImage、broadcast、server、validation） | 浪费 token 和上下文窗口 |
| 缺少脚本文件读写能力 | AI 无法完成完整的游戏开发工作流 |

---

## 二、优化目标

1. **工具总数 ≤ 40**，处于 AI 模型最佳路由准确率区间
2. **零同义工具** — 每个操作只有唯一入口，通过参数区分行为
3. **参数命名统一** — 全部使用 `uuid: string`（单个）和 `uuids: string[]`（批量）
4. **写操作返回完整结果** — 减少 AI 的验证查询调用
5. **补齐脚本读写能力** — 使 AI 能完成从场景搭建到逻辑编写的完整流程

---

## 三、目标工具集设计（157 → 38）

### 3.1 删除整个类别（共 46 个工具）

| 类别 | 工具数 | 删除理由 |
|------|--------|----------|
| sceneView_* | 20 | Gizmo/视口是人类视觉操作，AI 无法感知视口画面，调用无意义 |
| referenceImage_* | 12 | 参考图是人类视觉辅助功能，AI 无法查看参考图 |
| server_* | 6 | 查询编辑器内置预览服务器的 IP/端口，与游戏开发无关 |
| broadcast_* | 5 | 编辑器内部消息总线监控，AI 无使用场景 |
| validation_* | 3 | JSON 校验和字符串转义，AI 自身能力已覆盖 |

### 3.2 合并后保留的工具（38 个）

#### 场景 Scene（5 个工具，合并自 scene-tools.ts + scene-advanced-tools.ts 部分）

| 新工具名 | 合并来源 | 参数设计 | 说明 |
|----------|---------|---------|------|
| `scene_query` | `get_current_scene` + `get_scene_hierarchy` + `get_scene_list` + `query_scene_ready` + `query_scene_dirty` | `action: 'info' \| 'hierarchy' \| 'list' \| 'status'`; `includeComponents?: boolean` | 无参数默认返回 info |
| `scene_open` | `open_scene` | `scenePath: string` | 保持不变 |
| `scene_save` | `save_scene` + `save_scene_as` + `close_scene` | `action: 'save' \| 'save_as' \| 'close'`; `path?: string` | 有 path 则另存为 |
| `scene_create` | `create_scene` | `sceneName: string`; `savePath?: string` | 保持不变 |
| `scene_manage` | `soft_reload_scene` + `scene_snapshot` + `scene_snapshot_abort` | `action: 'reload' \| 'snapshot' \| 'snapshot_abort'` | 场景管理操作 |

#### 节点 Node（5 个工具，合并自 node-tools.ts + scene-advanced-tools.ts 部分）

| 新工具名 | 合并来源 | 参数设计 | 说明 |
|----------|---------|---------|------|
| `node_query` | `find_nodes` + `find_node_by_name` + `get_all_nodes` + `get_node_info` + `detect_node_type` + `query_nodes_by_asset_uuid` | `uuid?: string`; `pattern?: string`; `assetUuid?: string` | 有 uuid 查单个，有 pattern 搜索，有 assetUuid 按资源查，无参数返回全部 |
| `node_create` | `create_node` | 保持现有参数 | 创建后直接返回完整 node info |
| `node_modify` | `set_node_property` + `set_node_transform` + `reset_node_property` + `reset_node_transform` | `uuid: string`; `action: 'set_property' \| 'set_transform' \| 'reset_property' \| 'reset_transform'`; 对应子参数 | 统一修改入口 |
| `node_delete` | `delete_node` | `uuids: string \| string[]` | 支持批量 |
| `node_arrange` | `move_node` + `duplicate_node` + `copy_node` + `paste_node` + `cut_node` | `action: 'move' \| 'duplicate' \| 'copy' \| 'paste' \| 'cut'`; 对应子参数 | 节点组织操作 |

#### 组件 Component（3 个工具，合并自 component-tools.ts + scene-advanced-tools.ts 部分）

| 新工具名 | 合并来源 | 参数设计 | 说明 |
|----------|---------|---------|------|
| `component_query` | `get_components` + `get_component_info` + `query_scene_components` + `query_component_has_script` + `query_scene_classes` | `uuid?: string`; `componentType?: string`; `action?: 'list' \| 'info' \| 'available' \| 'classes'` | 有 uuid 查节点组件，无 uuid+action=available 查可用组件列表 |
| `component_add` | `add_component` + `attach_script` | `uuid: string`; `componentType: string` | 自动判断是内置组件名还是脚本路径（含 `/` 或 `.ts` 则走 attach_script 逻辑） |
| `component_modify` | `set_component_property` + `remove_component` + `reset_component` + `execute_component_method` | `uuid: string`; `action: 'set' \| 'remove' \| 'reset' \| 'execute'`; 对应子参数 | 统一组件操作入口 |

#### 预制体 Prefab（3 个工具，合并自 prefab-tools.ts + scene-advanced-tools.ts 部分）

| 新工具名 | 合并来源 | 参数设计 | 说明 |
|----------|---------|---------|------|
| `prefab_query` | `get_prefab_list` + `get_prefab_info` + `load_prefab` + `validate_prefab` | `prefabPath?: string`; `folder?: string` | 有 path 查详情，无 path 列全部 |
| `prefab_create` | `create_prefab` + `instantiate_prefab` + `duplicate_prefab` | `action: 'from_node' \| 'instantiate' \| 'duplicate'`; 对应子参数 | |
| `prefab_update` | `update_prefab` + `revert_prefab` + `restore_prefab` + `restore_prefab_node` | `action: 'apply' \| 'revert'`; `uuid: string` | apply=保存修改到预制体，revert=恢复到预制体原始状态 |

#### 资源 Asset（5 个工具，合并自 project-tools.ts + asset-advanced-tools.ts）

| 新工具名 | 合并来源 | 参数设计 | 说明 |
|----------|---------|---------|------|
| `asset_query` | `get_assets` + `get_asset_info` + `get_asset_details` + `query_asset_uuid` + `query_asset_path` + `query_asset_url` + `find_asset_by_name` + `get_asset_dependencies` + `get_unused_assets` + `query_asset_db_ready` | `path?: string`; `uuid?: string`; `name?: string`; `type?: string`; `action?: 'info' \| 'list' \| 'dependencies' \| 'unused' \| 'db_ready'` | 统一查询入口 |
| `asset_create` | `create_asset` + `import_asset` + `batch_import_assets` | `action: 'create' \| 'import'`; `sourcePath?: string`; `targetPath: string`; `content?: string` | 本地创建或外部导入 |
| `asset_modify` | `move_asset` + `copy_asset` + `save_asset` + `reimport_asset` + `save_asset_meta` + `compress_textures` | `action: 'move' \| 'copy' \| 'save' \| 'reimport' \| 'save_meta' \| 'compress'`; 对应子参数 | |
| `asset_delete` | `delete_asset` + `batch_delete_assets` | `urls: string \| string[]` | 支持单个和批量 |
| `asset_refresh` | `refresh_assets` + `generate_available_url` + `open_asset_external` + `export_asset_manifest` + `validate_asset_references` | `action: 'refresh' \| 'generate_url' \| 'open_external' \| 'export_manifest' \| 'validate_refs'` | 资源辅助操作 |

#### 调试 Debug（3 个工具，合并自 debug-tools.ts）

| 新工具名 | 合并来源 | 参数设计 | 说明 |
|----------|---------|---------|------|
| `debug_logs` | `get_console_logs` + `get_project_logs` + `get_log_file_info` + `search_project_logs` + `clear_console` | `action: 'console' \| 'project' \| 'file_info' \| 'search' \| 'clear'`; `limit?: number`; `filter?: string` | 统一日志入口 |
| `debug_execute` | `execute_script` | `script: string` | 保持不变，这是万能后门 |
| `debug_inspect` | `get_node_tree` + `get_performance_stats` + `validate_scene` + `get_editor_info` | `action: 'node_tree' \| 'performance' \| 'validate' \| 'editor_info'` | 统一检查入口 |

#### 项目 Project（3 个工具，合并自 project-tools.ts）

| 新工具名 | 合并来源 | 参数设计 | 说明 |
|----------|---------|---------|------|
| `project_query` | `get_project_info` + `get_project_settings` + `get_build_settings` | `action: 'info' \| 'settings' \| 'build_settings'`; `category?: string` | |
| `project_build` | `build_project` + `run_project` + `check_builder_status` + `start_preview_server` + `stop_preview_server` + `open_build_panel` | `action: 'build' \| 'preview' \| 'status' \| 'start_preview' \| 'stop_preview'`; `platform?: string` | |

#### 偏好 Preferences（2 个工具，合并自 preferences-tools.ts）

| 新工具名 | 合并来源 | 参数设计 | 说明 |
|----------|---------|---------|------|
| `preferences_query` | `query_preferences_config` + `get_all_preferences` | `name?: string`; `path?: string`; `type?: 'default' \| 'global' \| 'local'` | |
| `preferences_modify` | `set_preferences_config` + `reset_preferences` + `open_preferences_settings` + `export_preferences` + `import_preferences` | `action: 'set' \| 'reset' \| 'open' \| 'export' \| 'import'`; 对应子参数 | |

#### Undo 操作（1 个工具，从 scene-advanced-tools.ts 提取）

| 新工具名 | 合并来源 | 参数设计 | 说明 |
|----------|---------|---------|------|
| `undo_recording` | `begin_undo_recording` + `end_undo_recording` + `cancel_undo_recording` | `action: 'begin' \| 'end' \| 'cancel'`; `uuid?: string`; `undoId?: string` | AI 执行批量修改前应先 begin，完成后 end |

#### 高级场景操作（1 个工具，从 scene-advanced-tools.ts 提取）

| 新工具名 | 合并来源 | 参数设计 | 说明 |
|----------|---------|---------|------|
| `scene_script` | `execute_scene_script` + `execute_component_method` | `action: 'scene_script' \| 'component_method'`; `name?: string`; `method?: string`; `uuid?: string`; `args?: any[]` | 底层脚本执行能力，是 debug_execute 之外的另一个扩展点 |

#### 数组属性操作（1 个工具，从 scene-advanced-tools.ts 提取）

| 新工具名 | 合并来源 | 参数设计 | 说明 |
|----------|---------|---------|------|
| `array_property` | `move_array_element` + `remove_array_element` | `uuid: string`; `path: string`; `action: 'move' \| 'remove'`; `index?: number`; `offset?: number` | 操作节点/组件上的数组类型属性 |

### 3.3 新增工具 — 补齐能力缺口（3 个）

| 新工具名 | 能力缺口 | 参数设计 | 底层实现 |
|----------|---------|---------|---------|
| `script_file` | AI 无法读写项目中的 TypeScript 脚本 | `action: 'read' \| 'write' \| 'create' \| 'list'`; `path: string`; `content?: string`; `folder?: string` | `fs.readFileSync/writeFileSync` 操作 `db://assets/` 映射的本地路径，写入后调用 `Editor.Message.request('asset-db', 'refresh-asset', path)` |
| `animation_clip` | 动画是游戏核心能力，当前完全缺失 | `action: 'create' \| 'get_info' \| 'add_track' \| 'set_keyframe' \| 'list'`; 对应子参数 | 通过 `execute-scene-script` 操作 `cc.AnimationClip` API，或通过 `asset-db` 创建 `.anim` 资源文件 |
| `material_property` | 无法修改材质 uniform 参数 | `action: 'get_info' \| 'set_property' \| 'set_texture'`; `uuid: string`; `property: string`; `value: any` | 通过 `set-property` 操作 MeshRenderer 的 material 属性链，或通过 `save_asset_meta` 修改 `.mtl` 文件 |

### 3.4 工具总数汇总

| 类别 | 工具数 |
|------|--------|
| 场景 Scene | 5 |
| 节点 Node | 5 |
| 组件 Component | 3 |
| 预制体 Prefab | 3 |
| 资源 Asset | 5 |
| 调试 Debug | 3 |
| 项目 Project | 2 |
| 偏好 Preferences | 2 |
| Undo | 1 |
| 场景脚本 | 1 |
| 数组属性 | 1 |
| **已有合并小计** | **31** |
| 脚本文件（新增） | 1 |
| 动画（新增） | 1 |
| 材质（新增） | 1 |
| **新增小计** | **3** |
| **总计** | **34** |

---

## 四、开发步骤拆分

整个优化拆分为 6 个独立开发步骤（Step），每个 Step 聚焦一个明确目标，可独立编译验证。Step 之间存在顺序依赖关系。

### Step 1: 删除无价值类别（预计改动量：小）

**目标**: 删除 5 个对 AI 无价值的工具类别，工具数从 157 降至 111。

**改动范围**:
- 删除文件:
  - `source/tools/scene-view-tools.ts`（20 个工具）
  - `source/tools/reference-image-tools.ts`（12 个工具）
  - `source/tools/server-tools.ts`（6 个工具）
  - `source/tools/broadcast-tools.ts`（5 个工具）
  - `source/tools/validation-tools.ts`（3 个工具）
- 修改 `source/mcp-server.ts`:
  - 删除对应的 5 个 import 语句
  - 删除 `initializeTools()` 中对应的 5 行实例化代码
- 修改 `source/tools/tool-manager.ts`:
  - 删除对应类别的配置项（如果有硬编码的类别列表）

**验证标准**:
- `npm run build` 编译通过，无 TS 错误
- 启动 MCP 服务器后 `/health` 返回的 tools 数量 = 111
- `tools/list` 返回的工具列表中不包含任何 `sceneView_`、`referenceImage_`、`server_`、`broadcast_`、`validation_` 前缀的工具

**风险**: 极低。这些工具与其他工具无调用依赖关系。

---

### Step 2: 合并核心工具 — Scene + Node（预计改动量：大）

**目标**: 将 scene-tools.ts（8 个）+ node-tools.ts（11 个）+ scene-advanced-tools.ts 中的相关工具合并为 10 个新工具。

**改动范围**:
- 新建 `source/tools/v2/scene-tools.ts` — 实现 5 个场景工具（`scene_query`、`scene_open`、`scene_save`、`scene_create`、`scene_manage`）
- 新建 `source/tools/v2/node-tools.ts` — 实现 5 个节点工具（`node_query`、`node_create`、`node_modify`、`node_delete`、`node_arrange`）
- 每个新工具内部通过 `action` 参数路由到对应的原有实现逻辑
- 原有的 `Editor.Message.request()` 调用代码直接迁移，不修改底层调用方式

**关键设计决策**:
- 新工具文件放在 `source/tools/v2/` 目录下，与旧文件并存，便于对比和回滚
- `node_query` 的参数路由逻辑: 有 `uuid` → 调用 `query-node`；有 `pattern` → 调用 `query-node-tree` + 遍历匹配；有 `assetUuid` → 调用 `query-nodes-by-asset-uuid`；无参数 → 调用 `query-node-tree` 返回全部
- `node_modify` 的 `set_transform` action 保留现有的 2D/3D 自动检测逻辑（来自原 `set_node_transform`）
- 所有写操作在执行成功后，额外调用一次 `query-node` 返回修改后的完整节点信息

**参数命名规范**（从本 Step 开始执行）:
- 单个节点/组件标识: `uuid: string`
- 批量标识: `uuids: string[]`
- 资源路径: `path: string`（统一使用 `db://` 格式）
- 操作类型: `action: string`

**验证标准**:
- `npm run build` 编译通过
- 新旧工具的每个 action 分支都能正确调用到对应的 `Editor.Message.request()` 方法
- 具体测试用例见第六节

---

### Step 3: 合并核心工具 — Component + Prefab（预计改动量：中）

**目标**: 将 component-tools.ts（7 个）+ prefab-tools.ts（10 个）+ scene-advanced-tools.ts 中的相关工具合并为 6 个新工具。

**改动范围**:
- 新建 `source/tools/v2/component-tools.ts` — 实现 3 个组件工具
- 新建 `source/tools/v2/prefab-tools.ts` — 实现 3 个预制体工具
- 迁移 scene-advanced-tools.ts 中的 `restore_prefab`、`reset_component`、`execute_component_method`、`query_scene_components`、`query_component_has_script`、`query_scene_classes` 到对应的新工具中

**关键设计决策**:
- `component_add` 的自动判断逻辑: `componentType` 参数包含 `/` 或以 `.ts` 结尾 → 走 `attach_script` 路径（先 `query-uuid` 获取脚本 UUID，再 `create-component`）；否则 → 直接 `create-component`
- `component_modify` 的 `set` action 保留现有的复杂类型转换逻辑（Color、Vec2/3、Size、节点引用、资源引用等），这部分代码从原 `component-tools.ts` 的 `setComponentProperty()` 方法原样迁移
- `prefab_query` 无参数时调用 `query-assets` 列出所有 `.prefab` 文件；有 `prefabPath` 时调用 `query-asset-info` 获取详情

**验证标准**:
- `npm run build` 编译通过
- 组件属性设置的复杂类型（Color、Vec3 等）转换逻辑与原实现行为一致

---

### Step 4: 合并辅助工具 — Asset + Debug + Project + Preferences + Undo + 其他（预计改动量：大）

**目标**: 将剩余的 project-tools.ts（24 个）+ asset-advanced-tools.ts（11 个）+ debug-tools.ts（10 个）+ preferences-tools.ts（7 个）+ scene-advanced-tools.ts 剩余工具合并为 15 个新工具。

**改动范围**:
- 新建 `source/tools/v2/asset-tools.ts` — 实现 5 个资源工具
- 新建 `source/tools/v2/debug-tools.ts` — 实现 3 个调试工具
- 新建 `source/tools/v2/project-tools.ts` — 实现 2 个项目工具
- 新建 `source/tools/v2/preferences-tools.ts` — 实现 2 个偏好工具
- 新建 `source/tools/v2/undo-tools.ts` — 实现 1 个 undo 工具
- 新建 `source/tools/v2/scene-script-tools.ts` — 实现 1 个场景脚本工具
- 新建 `source/tools/v2/array-property-tools.ts` — 实现 1 个数组属性工具

**关键设计决策**:
- `asset_query` 是本 Step 最复杂的工具，需要合并 10 个原工具的查询逻辑。路由规则:
  - 有 `uuid` 且无 `action` → 调用 `query-asset-info`（by UUID）
  - 有 `path` 且无 `action` → 调用 `query-asset-info`（by path）
  - 有 `name` → 调用 `query-assets` + 名称过滤
  - `action='list'` → 调用 `query-assets`，可选 `type` 和 `folder` 过滤
  - `action='dependencies'` → 调用依赖分析逻辑
  - `action='unused'` → 调用未使用资源扫描逻辑
  - `action='db_ready'` → 调用 `query-ready`
- `debug_logs` 保留原 `DebugTools` 类的 `consoleMessages` 内存缓存机制
- `project_build` 的 `preview` action 对应原 `run_project`，`build` action 对应原 `build_project`

**验证标准**:
- `npm run build` 编译通过
- `asset_query` 的各种参数组合都能正确路由到对应的 `Editor.Message.request()` 调用

---

### Step 5: 切换路由层 + 删除旧文件（预计改动量：中）

**目标**: 将 `mcp-server.ts` 的工具注册从旧文件切换到 `v2/` 新文件，删除所有旧工具文件。

**改动范围**:
- 修改 `source/mcp-server.ts`:
  - 将所有 import 从 `./tools/xxx-tools` 改为 `./tools/v2/xxx-tools`
  - `initializeTools()` 中注册新的工具类实例
  - 更新 category key 映射（新工具的 category 前缀可能变化）
- 修改 `source/mcp-server.ts:executeToolCall()`:
  - 当前路由逻辑按第一个 `_` 拆分 category，新工具名如 `scene_query` 仍然兼容此逻辑
  - 但 `undo_recording`、`array_property`、`scene_script` 等新 category 需要在 `this.tools` 中注册对应的 key
- 删除旧文件:
  - `source/tools/scene-tools.ts`
  - `source/tools/node-tools.ts`
  - `source/tools/component-tools.ts`
  - `source/tools/prefab-tools.ts`
  - `source/tools/project-tools.ts`
  - `source/tools/debug-tools.ts`
  - `source/tools/preferences-tools.ts`
  - `source/tools/scene-advanced-tools.ts`
  - `source/tools/asset-advanced-tools.ts`
  - （Step 1 已删除的 5 个文件）
- 修改 `source/tools/tool-manager.ts`:
  - 更新工具类别列表和默认配置，使其与新的 34 个工具对齐
- 修改面板 UI（`source/panels/default/`）:
  - 更新工具管理界面的类别显示

**关键设计决策**:
- `executeToolCall()` 的路由逻辑需要适配新的 category 命名。新工具名格式仍为 `{category}_{action}`，但 category 粒度更细（如 `undo`、`array` 等独立 category）
- `tool-manager.ts` 的配置持久化格式（`settings/tool-manager.json`）需要迁移。建议: 检测到旧格式时自动重置为全部启用，避免复杂的配置迁移逻辑

**验证标准**:
- `npm run build` 编译通过，无残留的旧文件引用
- MCP 服务器启动后 `tools/list` 返回恰好 31 个工具（不含新增的 3 个）
- 所有工具名符合新命名规范
- `tool-manager.json` 能正确持久化新工具的启用/禁用状态
- 面板 UI 能正确显示新的工具类别

---

### Step 6: 新增能力工具 — script_file / animation_clip / material_property（预计改动量：中）

**目标**: 实现 3 个新工具，补齐 Cocos Creator 开发的关键能力缺口。

**改动范围**:
- 新建 `source/tools/v2/script-file-tools.ts`
- 新建 `source/tools/v2/animation-tools.ts`
- 新建 `source/tools/v2/material-tools.ts`
- 修改 `source/mcp-server.ts` 注册新工具

#### 6a: script_file 工具

**实现细节**:
```typescript
// action: 'read'
// 1. 通过 Editor.Project.path 获取项目根路径
// 2. 将 db://assets/xxx.ts 转换为本地绝对路径
// 3. fs.readFileSync() 读取文件内容返回

// action: 'write'
// 1. 路径转换同上
// 2. fs.writeFileSync() 写入内容
// 3. Editor.Message.request('asset-db', 'refresh-asset', dbUrl) 刷新资源数据库

// action: 'create'
// 1. 生成 Cocos Creator 标准组件脚本模板（含 @ccclass 装饰器）
// 2. 写入文件 + 刷新资源数据库

// action: 'list'
// 1. Editor.Message.request('asset-db', 'query-assets') 过滤 *.ts 文件
```

**安全约束**:
- `path` 参数必须以 `db://assets/` 开头，拒绝访问项目目录外的文件
- `write` 操作前检查文件是否存在，存在则覆盖（AI 应先 read 再 write）
- 文件大小限制: 读取上限 1MB，写入上限 500KB

#### 6b: animation_clip 工具

**实现细节**:
```typescript
// action: 'create'
// 通过 asset-db 创建 .anim 文件，内容为 Cocos Creator AnimationClip 的 JSON 格式
// 需要的最小 JSON 结构:
// { "__type__": "cc.AnimationClip", "_name": "xxx", "_duration": 1.0, "sample": 60, ... }

// action: 'get_info'
// 读取 .anim 文件的 JSON 内容，解析并返回轨道、时长、帧率等信息

// action: 'add_track'
// 读取 .anim JSON → 添加新轨道到 _tracks 数组 → 写回文件 → 刷新资源

// action: 'set_keyframe'
// 读取 .anim JSON → 在指定轨道的指定时间点设置关键帧值 → 写回 → 刷新

// action: 'list'
// query-assets 过滤 *.anim 文件
```

**已知限制**:
- Cocos Creator 3.8 的 AnimationClip JSON 格式较复杂，包含序列化的类型标记（`__type__`）。需要在 Cocos Creator 中手动创建一个示例 .anim 文件，分析其 JSON 结构后再实现。
- 此工具的 `add_track` 和 `set_keyframe` action 实现复杂度较高，建议 Step 6 先实现 `create`、`get_info`、`list` 三个 action，`add_track` 和 `set_keyframe` 作为后续迭代。

#### 6c: material_property 工具

**实现细节**:
```typescript
// action: 'get_info'
// 1. 通过 uuid 查询材质资源信息
// 2. 读取 .mtl 文件的 JSON 内容，解析 effect、technique、uniform 列表

// action: 'set_property'
// 1. 通过 set-property 设置 MeshRenderer 组件的 material 属性链
//    路径格式: __comps__.{index}.sharedMaterials.{matIndex}.{propertyName}
// 2. 或者直接修改 .mtl 文件的 JSON 内容中的 _props 字段

// action: 'set_texture'
// 1. 获取纹理资源的 UUID
// 2. 通过 set-property 设置材质的纹理属性
```

**已知限制**:
- 材质属性的 `set-property` 路径格式需要在 Cocos Creator 中实际测试确认，不同版本可能有差异。
- 建议 Step 6 先实现 `get_info` action，`set_property` 和 `set_texture` 在确认路径格式后再实现。

**验证标准**:
- `npm run build` 编译通过
- `tools/list` 返回 34 个工具
- `script_file` 的 read/write/create/list 四个 action 在 Cocos Creator 中实际可用
- `animation_clip` 的 create/get_info/list 三个 action 在 Cocos Creator 中实际可用
- `material_property` 的 get_info action 在 Cocos Creator 中实际可用

---

## 五、前置依赖

### 5.1 开发环境依赖

| 依赖项 | 版本要求 | 用途 | 检查方式 |
|--------|---------|------|---------|
| Node.js | ≥ 16.x | TypeScript 编译 | `node -v` |
| npm | ≥ 8.x | 依赖管理 | `npm -v` |
| TypeScript | package.json 中已声明 | 编译 | `npm run build` |
| Cocos Creator | ≥ 3.8.x | 运行时环境，加载扩展 | 编辑器内查看版本 |

### 5.2 各 Step 的前置依赖关系

```
Step 1 (删除无价值类别)
  │
  ▼
Step 2 (合并 Scene + Node)  ──┐
  │                            │
  ▼                            │ 可并行开发，但建议顺序执行以控制风险
Step 3 (合并 Component + Prefab) │
  │                            │
  ▼                            │
Step 4 (合并 Asset + Debug + 其他) ◄─┘
  │
  ▼
Step 5 (切换路由层 + 删除旧文件)
  │
  ▼
Step 6 (新增能力工具)
```

- Step 1 是所有后续步骤的前置条件（减少干扰文件）
- Step 2/3/4 之间理论上可并行，但共享 `scene-advanced-tools.ts` 的拆分，建议顺序执行避免合并冲突
- Step 5 依赖 Step 2/3/4 全部完成（需要所有 v2 工具文件就绪后才能切换）
- Step 6 依赖 Step 5 完成（需要路由层已切换到 v2）

### 5.3 开发前必须确认的事项

1. **Cocos Creator Editor API 兼容性**: 本方案中所有 `Editor.Message.request()` 调用均基于当前代码中已验证可用的 API。新增工具（Step 6）涉及的 API 需要在目标 Cocos Creator 版本中实际验证:
   - `asset-db:refresh-asset` — 用于 `script_file` 写入后刷新
   - `.anim` 文件的 JSON 序列化格式 — 用于 `animation_clip`
   - `set-property` 对材质属性链的支持深度 — 用于 `material_property`

2. **tool-manager.ts 配置迁移策略**: 当前 `tool-manager.ts` 将工具启用/禁用状态持久化到 `<project>/settings/tool-manager.json`。工具名变更后，旧配置将失效。需确认:
   - 是否接受"旧配置自动重置为全部启用"的策略
   - 还是需要实现旧工具名→新工具名的映射迁移

3. **面板 UI 适配**: `source/panels/default/` 中的 Vue 3 面板显示工具类别和启用/禁用开关。工具数量和类别变更后，面板需要同步更新。需确认:
   - 面板是否动态读取工具列表（是 → 无需改动）
   - 还是硬编码了类别名称（是 → 需要在 Step 5 中一并修改）

---

## 六、测试方案

### 6.1 测试策略

本项目无自动化测试框架（`source/test/` 仅包含手动测试脚本）。测试分为三个层次:

| 层次 | 方法 | 覆盖范围 |
|------|------|---------|
| L1: 编译验证 | `npm run build` | 每个 Step 完成后必须通过 |
| L2: 接口验证 | curl 调用 MCP 端点 | 验证工具注册、参数解析、返回格式 |
| L3: 功能验证 | 在 Cocos Creator 中实际操作 | 验证 Editor.Message 调用的实际效果 |

### 6.2 L1: 编译验证（每个 Step 必做）

```bash
npm run build
```

通过标准: 零 TS 编译错误。允许 warning（如未使用的变量，后续 Step 会清理）。

### 6.3 L2: 接口验证（每个 Step 必做）

启动 Cocos Creator 并加载扩展后，通过 curl 验证:

#### 6.3.1 工具列表检查

```bash
# 检查工具总数
curl -s http://127.0.0.1:8585/health | python3 -c "import sys,json; print(json.load(sys.stdin)['tools'])"

# 检查工具名列表
curl -s -X POST http://127.0.0.1:8585/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' \
  | python3 -c "import sys,json; [print(t['name']) for t in json.load(sys.stdin)['result']['tools']]"
```

各 Step 预期工具数:
- Step 1 完成后: 111（157 - 46）
- Step 5 完成后: 31
- Step 6 完成后: 34

#### 6.3.2 工具调用格式验证

对每个新工具，验证参数解析和错误处理:

```bash
# 正常调用 — 验证返回 success: true
curl -s -X POST http://127.0.0.1:8585/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"scene_query","arguments":{"action":"info"}}}'

# 缺少必填参数 — 验证返回合理的错误信息
curl -s -X POST http://127.0.0.1:8585/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"node_modify","arguments":{}}}'

# 无效 action — 验证返回错误而非崩溃
curl -s -X POST http://127.0.0.1:8585/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"node_modify","arguments":{"uuid":"xxx","action":"invalid_action"}}}'
```

### 6.4 L3: 功能验证（Step 2-6 必做）

在 Cocos Creator 中打开一个测试项目，执行以下场景化测试。每个测试用例标注了对应的 Step。

#### 6.4.1 场景操作（Step 2）

| 测试用例 | 操作 | 预期结果 |
|----------|------|---------|
| S-1 | `scene_query` action=info | 返回当前场景名称和 UUID |
| S-2 | `scene_query` action=hierarchy, includeComponents=true | 返回完整节点树，每个节点包含组件列表 |
| S-3 | `scene_query` action=list | 返回项目中所有 .scene 文件路径 |
| S-4 | `scene_query` action=status | 返回 ready 和 dirty 状态 |
| S-5 | `scene_create` sceneName="TestScene" | 项目中出现 TestScene.scene 文件 |
| S-6 | `scene_open` scenePath="db://assets/TestScene.scene" | 编辑器切换到 TestScene |
| S-7 | `scene_save` action=save | 场景保存成功，dirty 状态变为 false |
| S-8 | `scene_manage` action=reload | 场景重新加载，无报错 |

#### 6.4.2 节点操作（Step 2）

| 测试用例 | 操作 | 预期结果 |
|----------|------|---------|
| N-1 | `node_create` name="TestNode" | 返回新节点的完整信息（含 UUID） |
| N-2 | `node_query` uuid=<N-1返回的UUID> | 返回该节点的详细信息 |
| N-3 | `node_query` pattern="Test*" | 返回名称匹配的节点列表 |
| N-4 | `node_query`（无参数） | 返回场景中所有节点 |
| N-5 | `node_modify` action=set_transform, position={x:1,y:2,z:3} | 节点位置更新，返回更新后的完整信息 |
| N-6 | `node_modify` action=set_property, property="active", value=false | 节点变为不可见 |
| N-7 | `node_modify` action=reset_transform | 节点位置/旋转/缩放归零 |
| N-8 | `node_arrange` action=duplicate | 场景中出现副本节点 |
| N-9 | `node_arrange` action=move, parentUuid=<另一个节点UUID> | 节点移动到新父节点下 |
| N-10 | `node_delete` uuids=<UUID> | 节点从场景中移除 |

#### 6.4.3 组件操作（Step 3）

| 测试用例 | 操作 | 预期结果 |
|----------|------|---------|
| C-1 | `component_add` uuid=<节点UUID>, componentType="cc.Sprite" | 节点上出现 Sprite 组件 |
| C-2 | `component_add` uuid=<节点UUID>, componentType="db://assets/scripts/MyScript.ts" | 节点上出现自定义脚本组件 |
| C-3 | `component_query` uuid=<节点UUID> | 返回该节点的所有组件列表 |
| C-4 | `component_query` action=available | 返回所有可用组件类型（来自 query-components） |
| C-5 | `component_modify` action=set, property="color", value={r:255,g:0,b:0,a:255} | Sprite 颜色变为红色 |
| C-6 | `component_modify` action=remove, componentType="cc.Sprite" | Sprite 组件被移除 |

#### 6.4.4 预制体操作（Step 3）

| 测试用例 | 操作 | 预期结果 |
|----------|------|---------|
| P-1 | `prefab_query`（无参数） | 返回项目中所有 .prefab 文件 |
| P-2 | `prefab_create` action=from_node, uuid=<节点UUID> | 生成 .prefab 文件 |
| P-3 | `prefab_create` action=instantiate, prefabPath=<P-2的路径> | 场景中出现预制体实例 |
| P-4 | `prefab_update` action=apply | 预制体资源更新 |
| P-5 | `prefab_update` action=revert | 实例恢复到预制体原始状态 |

#### 6.4.5 资源操作（Step 4）

| 测试用例 | 操作 | 预期结果 |
|----------|------|---------|
| A-1 | `asset_query` action=list, type="cc.ImageAsset" | 返回项目中所有图片资源 |
| A-2 | `asset_query` path="db://assets/textures/logo.png" | 返回该资源的详细信息（UUID、类型、大小等） |
| A-3 | `asset_query` name="logo" | 返回名称匹配的资源列表 |
| A-4 | `asset_create` action=create, targetPath="db://assets/test.txt", content="hello" | 项目中出现 test.txt |
| A-5 | `asset_modify` action=move, source="db://assets/test.txt", target="db://assets/moved/test.txt" | 文件移动成功 |
| A-6 | `asset_delete` urls="db://assets/moved/test.txt" | 文件删除成功 |
| A-7 | `asset_refresh` action=refresh | 资源数据库刷新完成 |

#### 6.4.6 新增工具（Step 6）

| 测试用例 | 操作 | 预期结果 |
|----------|------|---------|
| SF-1 | `script_file` action=create, path="db://assets/scripts/TestComp.ts" | 生成包含 @ccclass 装饰器的标准脚本模板 |
| SF-2 | `script_file` action=read, path="db://assets/scripts/TestComp.ts" | 返回脚本文件内容 |
| SF-3 | `script_file` action=write, path=同上, content=<修改后的内容> | 文件内容更新，资源数据库刷新 |
| SF-4 | `script_file` action=list, folder="db://assets/scripts/" | 返回该目录下所有 .ts 文件 |
| SF-5 | `script_file` action=read, path="/etc/passwd" | 返回错误: 路径必须以 db://assets/ 开头 |
| AN-1 | `animation_clip` action=create, name="walk", duration=1.0 | 生成 .anim 文件 |
| AN-2 | `animation_clip` action=get_info, path=<AN-1的路径> | 返回动画时长、帧率等信息 |
| AN-3 | `animation_clip` action=list | 返回项目中所有 .anim 文件 |
| MT-1 | `material_property` action=get_info, uuid=<材质UUID> | 返回材质的 effect、technique、uniform 列表 |

### 6.5 回归验证

每个 Step 完成后，除了验证本 Step 的测试用例外，还需要回归验证前序 Step 的关键用例:

| 当前 Step | 需回归的用例 |
|-----------|-------------|
| Step 2 | Step 1 的工具列表检查 |
| Step 3 | N-1, N-2, N-5（节点操作未被破坏） |
| Step 4 | N-1, C-1, P-1（核心操作未被破坏） |
| Step 5 | 全部 L2 接口验证 + N-1, C-1, P-1, S-1 |
| Step 6 | Step 5 的全部回归项 |

---

## 七、风险与回滚策略

### 7.1 风险评估

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| 合并工具时遗漏某个原工具的边界处理逻辑 | 中 | 特定参数组合下工具调用失败 | 每个新工具的 execute() 方法中保留原有的 try-catch 和错误处理；L3 测试覆盖 |
| tool-manager.json 旧配置导致工具全部被禁用 | 低 | 服务器启动后无可用工具 | Step 5 中实现: 检测到未知工具名时自动重置为全部启用 |
| Step 6 新增工具的 Editor API 在目标版本不可用 | 中 | 新工具调用报错 | Step 6 的每个子步骤独立实现，API 不可用时该工具返回明确的"不支持"错误，不影响其他工具 |
| 面板 UI 与新工具列表不兼容 | 低 | 面板显示异常 | 面板通过 IPC 动态获取工具列表（已确认 `getToolsList()` 是动态的），大概率无需改动 |

### 7.2 回滚策略

- 每个 Step 完成后创建 git tag（如 `tool-opt/step-1`、`tool-opt/step-2`）
- Step 2/3/4 期间新旧文件并存（v2/ 目录），旧文件未删除，可随时回退
- Step 5 是不可逆点（删除旧文件），执行前确保所有 L2 + L3 测试通过
- 如果 Step 5 后发现问题，通过 `git revert` 回退到 Step 4 的 tag

### 7.3 分支策略建议

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
