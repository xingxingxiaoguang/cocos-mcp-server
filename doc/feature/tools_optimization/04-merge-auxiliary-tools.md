# Step 4: 合并辅助工具 — Asset + Debug + Project + Preferences + Undo + 其他

> 前置依赖：Step 3 完成
> 预计改动量：大
> 目标：将剩余工具合并为 15 个新工具

---

## 1. 来源工具清单

### 1.1 project-tools.ts（24 个）→ 拆分到 Asset（5）+ Project（2）

**归入 Asset 工具：**

| 原工具名 | 归入新工具 |
|----------|-----------|
| `get_assets` | `asset_query` (action=list) |
| `get_asset_info` | `asset_query` (有 path 或 uuid) |
| `get_asset_details` | `asset_query` (有 path 或 uuid，返回详情) |
| `query_asset_uuid` | `asset_query` (有 path) |
| `query_asset_path` | `asset_query` (有 uuid) |
| `query_asset_url` | `asset_query` (有 uuid) |
| `find_asset_by_name` | `asset_query` (有 name) |
| `refresh_assets` | `asset_refresh` (action=refresh) |
| `import_asset` | `asset_create` (action=import) |
| `create_asset` | `asset_create` (action=create) |
| `copy_asset` | `asset_modify` (action=copy) |
| `move_asset` | `asset_modify` (action=move) |
| `save_asset` | `asset_modify` (action=save) |
| `reimport_asset` | `asset_modify` (action=reimport) |
| `delete_asset` | `asset_delete` |

**归入 Project 工具：**

| 原工具名 | 归入新工具 |
|----------|-----------|
| `get_project_info` | `project_query` (action=info) |
| `get_project_settings` | `project_query` (action=settings) |
| `get_build_settings` | `project_query` (action=build_settings) |
| `build_project` | `project_build` (action=build) |
| `run_project` | `project_build` (action=preview) |
| `check_builder_status` | `project_build` (action=status) |
| `start_preview_server` | `project_build` (action=start_preview) |
| `stop_preview_server` | `project_build` (action=stop_preview) |
| `open_build_panel` | `project_build` (action=open_panel) |

### 1.2 asset-advanced-tools.ts（11 个）→ 归入 Asset

| 原工具名 | 归入新工具 |
|----------|-----------|
| `save_asset_meta` | `asset_modify` (action=save_meta) |
| `generate_available_url` | `asset_refresh` (action=generate_url) |
| `query_asset_db_ready` | `asset_query` (action=db_ready) |
| `open_asset_external` | `asset_refresh` (action=open_external) |
| `batch_import_assets` | `asset_create` (action=import，支持批量) |
| `batch_delete_assets` | `asset_delete` (支持批量) |
| `validate_asset_references` | `asset_refresh` (action=validate_refs) |
| `get_asset_dependencies` | `asset_query` (action=dependencies) |
| `get_unused_assets` | `asset_query` (action=unused) |
| `compress_textures` | `asset_modify` (action=compress) |
| `export_asset_manifest` | `asset_refresh` (action=export_manifest) |

### 1.3 debug-tools.ts（10 个）→ Debug（3）

| 原工具名 | 归入新工具 |
|----------|-----------|
| `get_console_logs` | `debug_logs` (action=console) |
| `get_project_logs` | `debug_logs` (action=project) |
| `get_log_file_info` | `debug_logs` (action=file_info) |
| `search_project_logs` | `debug_logs` (action=search) |
| `clear_console` | `debug_logs` (action=clear) |
| `execute_script` | `debug_execute` |
| `get_node_tree` | `debug_inspect` (action=node_tree) |
| `get_performance_stats` | `debug_inspect` (action=performance) |
| `validate_scene` | `debug_inspect` (action=validate) |
| `get_editor_info` | `debug_inspect` (action=editor_info) |

### 1.4 preferences-tools.ts（7 个）→ Preferences（2）

| 原工具名 | 归入新工具 |
|----------|-----------|
| `query_preferences_config` | `preferences_query` |
| `get_all_preferences` | `preferences_query` |
| `set_preferences_config` | `preferences_modify` (action=set) |
| `reset_preferences` | `preferences_modify` (action=reset) |
| `open_preferences_settings` | `preferences_modify` (action=open) |
| `export_preferences` | `preferences_modify` (action=export) |
| `import_preferences` | `preferences_modify` (action=import) |

### 1.5 scene-advanced-tools.ts 剩余（6 个）→ Undo（1）+ SceneScript（1）+ ArrayProperty（1）

| 原工具名 | 归入新工具 |
|----------|-----------|
| `begin_undo_recording` | `undo_recording` (action=begin) |
| `end_undo_recording` | `undo_recording` (action=end) |
| `cancel_undo_recording` | `undo_recording` (action=cancel) |
| `execute_scene_script` | `scene_script` (action=scene_script) |
| `move_array_element` | `array_property` (action=move) |
| `remove_array_element` | `array_property` (action=remove) |

---

## 2. 新工具详细设计

### 2.1 `asset_query` — 资源查询（本 Step 最复杂的工具）

```typescript
name: 'query'
inputSchema: {
    type: 'object',
    properties: {
        uuid: { type: 'string', description: '资源 UUID' },
        path: { type: 'string', description: '资源路径，db:// 格式' },
        name: { type: 'string', description: '资源名称，模糊搜索' },
        type: { type: 'string', description: '资源类型过滤，如 cc.ImageAsset' },
        folder: { type: 'string', description: '限定搜索目录' },
        action: {
            type: 'string',
            enum: ['info', 'list', 'dependencies', 'unused', 'db_ready'],
            description: '查询类型。有 uuid/path/name 时默认 info，否则默认 list'
        }
    }
}
```

参数路由逻辑（优先级从高到低）：

| 条件 | 行为 | 来源方法 |
|------|------|---------|
| `action=db_ready` | 检查资源数据库就绪状态 | `AssetAdvancedTools.queryAssetDbReady()` |
| `action=dependencies` + `uuid`/`path` | 查询资源依赖 | `AssetAdvancedTools.getAssetDependencies()` |
| `action=unused` | 查询未使用资源 | `AssetAdvancedTools.getUnusedAssets()` |
| 有 `uuid` 且无 `action` | 通过 UUID 查询资源详情 | `ProjectTools.getAssetInfo()` + `getAssetDetails()` |
| 有 `path` 且无 `action` | 通过路径查询资源详情 | `ProjectTools.getAssetInfo()` |
| 有 `name` | 按名称搜索资源 | `ProjectTools.findAssetByName()` |
| `action=list` 或无参数 | 列出资源，可选 `type` 和 `folder` 过滤 | `ProjectTools.getAssets()` |

### 2.2 `asset_create` — 创建/导入资源

```typescript
name: 'create'
inputSchema: {
    type: 'object',
    properties: {
        action: {
            type: 'string',
            enum: ['create', 'import'],
            description: 'create=创建新资源，import=从外部导入'
        },
        targetPath: { type: 'string', description: '目标路径，db:// 格式' },
        content: { type: 'string', description: 'action=create 时的文件内容' },
        sourcePath: { type: 'string', description: 'action=import 时的源文件路径' },
        sources: {
            type: 'array',
            items: { type: 'object', properties: { source: { type: 'string' }, target: { type: 'string' } } },
            description: 'action=import 时的批量导入列表'
        }
    },
    required: ['action', 'targetPath']
}
```

| action | 来源方法 |
|--------|---------|
| `create` | `ProjectTools.createAsset()` |
| `import`（单个） | `ProjectTools.importAsset()` |
| `import`（有 sources） | `AssetAdvancedTools.batchImportAssets()` |

### 2.3 `asset_modify` — 修改资源

```typescript
name: 'modify'
inputSchema: {
    type: 'object',
    properties: {
        action: {
            type: 'string',
            enum: ['move', 'copy', 'save', 'reimport', 'save_meta', 'compress'],
            description: '操作类型'
        },
        // move/copy 参数
        source: { type: 'string', description: '源路径' },
        target: { type: 'string', description: '目标路径' },
        // save 参数
        url: { type: 'string', description: '资源 URL' },
        // save_meta 参数
        uuid: { type: 'string' },
        meta: { type: 'object', description: 'meta 数据' },
        // reimport 参数
        path: { type: 'string' },
        // compress 参数
        texturePaths: { type: 'array', items: { type: 'string' } },
        format: { type: 'string' }
    },
    required: ['action']
}
```

### 2.4 `asset_delete` — 删除资源

```typescript
name: 'delete'
inputSchema: {
    type: 'object',
    properties: {
        urls: {
            oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
            description: '要删除的资源 URL，支持单个或数组'
        }
    },
    required: ['urls']
}
```

合并 `ProjectTools.deleteAsset()` + `AssetAdvancedTools.batchDeleteAssets()`。

### 2.5 `asset_refresh` — 资源辅助操作

```typescript
name: 'refresh'
inputSchema: {
    type: 'object',
    properties: {
        action: {
            type: 'string',
            enum: ['refresh', 'generate_url', 'open_external', 'export_manifest', 'validate_refs'],
            description: '操作类型。默认 refresh'
        },
        path: { type: 'string' },
        uuid: { type: 'string' }
    }
}
```

### 2.6 `debug_logs` — 日志查询

```typescript
name: 'logs'
inputSchema: {
    type: 'object',
    properties: {
        action: {
            type: 'string',
            enum: ['console', 'project', 'file_info', 'search', 'clear'],
            description: '操作类型。默认 console'
        },
        limit: { type: 'number', description: '返回条数限制' },
        filter: { type: 'string', description: '过滤关键词' },
        level: { type: 'string', enum: ['log', 'warn', 'error', 'info'] }
    }
}
```

注意：保留 `DebugTools` 类的 `consoleMessages` 内存缓存机制。

### 2.7 `debug_execute` — 执行脚本

```typescript
name: 'execute'
inputSchema: {
    type: 'object',
    properties: {
        script: { type: 'string', description: '要执行的 JavaScript 代码' }
    },
    required: ['script']
}
```

直接迁移 `DebugTools.executeScript()`。

### 2.8 `debug_inspect` — 检查工具

```typescript
name: 'inspect'
inputSchema: {
    type: 'object',
    properties: {
        action: {
            type: 'string',
            enum: ['node_tree', 'performance', 'validate', 'editor_info'],
            description: '检查类型'
        },
        uuid: { type: 'string', description: 'action=node_tree 时的根节点 UUID' },
        depth: { type: 'number', description: 'action=node_tree 时的遍历深度' }
    },
    required: ['action']
}
```

### 2.9 `project_query` — 项目查询

```typescript
name: 'query'
inputSchema: {
    type: 'object',
    properties: {
        action: {
            type: 'string',
            enum: ['info', 'settings', 'build_settings'],
            description: '查询类型。默认 info'
        },
        category: { type: 'string', description: 'action=settings 时的设置分类' }
    }
}
```

### 2.10 `project_build` — 项目构建

```typescript
name: 'build'
inputSchema: {
    type: 'object',
    properties: {
        action: {
            type: 'string',
            enum: ['build', 'preview', 'status', 'start_preview', 'stop_preview', 'open_panel'],
            description: '操作类型'
        },
        platform: { type: 'string', description: 'action=build 时的目标平台' },
        buildOptions: { type: 'object', description: 'action=build 时的构建选项' }
    },
    required: ['action']
}
```

### 2.11 `preferences_query` — 偏好查询

```typescript
name: 'query'
inputSchema: {
    type: 'object',
    properties: {
        name: { type: 'string', description: '偏好名称' },
        path: { type: 'string', description: '偏好路径' },
        type: { type: 'string', enum: ['default', 'global', 'local'] }
    }
}
```

### 2.12 `preferences_modify` — 偏好修改

```typescript
name: 'modify'
inputSchema: {
    type: 'object',
    properties: {
        action: {
            type: 'string',
            enum: ['set', 'reset', 'open', 'export', 'import'],
            description: '操作类型'
        },
        name: { type: 'string' },
        path: { type: 'string' },
        value: { description: '设置值' },
        type: { type: 'string', enum: ['default', 'global', 'local'] },
        configJson: { type: 'string', description: 'action=import 时的配置 JSON' }
    },
    required: ['action']
}
```

### 2.13 `undo_recording` — Undo 操作

```typescript
name: 'recording'
inputSchema: {
    type: 'object',
    properties: {
        action: {
            type: 'string',
            enum: ['begin', 'end', 'cancel'],
            description: 'begin=开始录制，end=结束录制并提交，cancel=取消录制'
        },
        uuid: { type: 'string', description: 'action=begin 时的节点 UUID' },
        undoId: { type: 'string', description: 'action=end/cancel 时的录制 ID' }
    },
    required: ['action']
}
```

### 2.14 `scene_script` — 场景脚本执行

注意：此工具的 category key 为 `scene`，但 Step 2 已有 `scene` → SceneToolsV2。需要使用不同的 category key，如 `sceneScript`。

```typescript
// category key: sceneScript
name: 'execute'
inputSchema: {
    type: 'object',
    properties: {
        action: {
            type: 'string',
            enum: ['scene_script', 'component_method'],
            description: '执行类型'
        },
        // scene_script 参数
        name: { type: 'string', description: '场景脚本名' },
        method: { type: 'string', description: '方法名' },
        args: { type: 'array', description: '参数列表' },
        // component_method 参数
        uuid: { type: 'string', description: '节点 UUID' }
    },
    required: ['action']
}
```

实际注册到 MCP 后的工具名为 `sceneScript_execute`，但对外暴露名为 `scene_script`。需要在 Step 5 的路由层处理此映射。

### 2.15 `array_property` — 数组属性操作

```typescript
// category key: array
name: 'property'
inputSchema: {
    type: 'object',
    properties: {
        uuid: { type: 'string', description: '节点 UUID' },
        path: { type: 'string', description: '数组属性路径，如 __comps__' },
        action: {
            type: 'string',
            enum: ['move', 'remove'],
            description: '操作类型'
        },
        index: { type: 'number', description: 'action=remove 时的目标索引' },
        target: { type: 'number', description: 'action=move 时的目标索引' },
        offset: { type: 'number', description: 'action=move 时的偏移量' }
    },
    required: ['uuid', 'path', 'action']
}
```

---

## 3. 实现要点

### 3.1 文件结构

```
source/tools/v2/
  ├── scene-tools.ts          (Step 2)
  ├── node-tools.ts           (Step 2)
  ├── component-tools.ts      (Step 3)
  ├── prefab-tools.ts         (Step 3)
  ├── asset-tools.ts          → AssetToolsV2，5 个工具
  ├── debug-tools.ts          → DebugToolsV2，3 个工具
  ├── project-tools.ts        → ProjectToolsV2，2 个工具
  ├── preferences-tools.ts    → PreferencesToolsV2，2 个工具
  ├── undo-tools.ts           → UndoToolsV2，1 个工具
  ├── scene-script-tools.ts   → SceneScriptToolsV2，1 个工具
  └── array-property-tools.ts → ArrayPropertyToolsV2，1 个工具
```

### 3.2 debug_logs 的内存缓存

`DebugTools` 类维护了一个 `consoleMessages: ConsoleMessage[]` 数组作为控制台日志缓存。新的 `DebugToolsV2` 必须保留此机制，包括：
- 构造函数中注册控制台消息监听
- `get_console_logs` 从缓存读取
- `clear_console` 清空缓存

### 3.3 scene-advanced-tools.ts 拆分完成

本 Step 完成后，`scene-advanced-tools.ts` 的所有 23 个工具已全部分配到新工具中。

---

## 4. 验证标准

### L1: 编译验证
```bash
npm run build
```

### L3: 功能验证（Step 5 切换路由后执行）

| 用例 | 操作 | 预期 |
|------|------|------|
| A-1 | `asset_query` action=list, type="cc.ImageAsset" | 返回所有图片资源 |
| A-2 | `asset_query` path="db://assets/textures/logo.png" | 返回资源详情 |
| A-3 | `asset_query` name="logo" | 返回匹配资源列表 |
| A-4 | `asset_create` action=create, targetPath="db://assets/test.txt", content="hello" | 创建文件 |
| A-5 | `asset_modify` action=move, source=..., target=... | 文件移动 |
| A-6 | `asset_delete` urls="db://assets/moved/test.txt" | 文件删除 |
| A-7 | `asset_refresh` action=refresh | 资源数据库刷新 |

### 回归验证
- N-1, C-1, P-1（核心操作未被破坏）

### 完成标记
- [ ] 7 个新文件已创建
- [ ] `asset_query` 的所有参数组合路由正确
- [ ] `debug_logs` 的内存缓存机制已迁移
- [ ] `npm run build` 编译通过
- [ ] 创建 git tag `tool-opt/step-4`
