# Step 3: 合并核心工具 — Component + Prefab

> 前置依赖：Step 2 完成
> 预计改动量：中
> 目标：将 component-tools.ts（7 个）+ prefab-tools.ts（10 个）+ scene-advanced-tools.ts 中相关工具合并为 6 个新工具

---

## 1. 来源工具清单

### 1.1 component-tools.ts（7 个）

| 原工具名 | 归入新工具 |
|----------|-----------|
| `add_component` | `component_add` |
| `attach_script` | `component_add`（自动判断） |
| `remove_component` | `component_modify` (action=remove) |
| `get_components` | `component_query` (有 uuid) |
| `get_component_info` | `component_query` (有 uuid + componentType) |
| `set_component_property` | `component_modify` (action=set) |
| `get_available_components` | `component_query` (action=available) |

### 1.2 prefab-tools.ts（10 个）

| 原工具名 | 归入新工具 |
|----------|-----------|
| `get_prefab_list` | `prefab_query` (无参数) |
| `get_prefab_info` | `prefab_query` (有 prefabPath) |
| `load_prefab` | `prefab_query` (有 prefabPath，加载并返回详情) |
| `validate_prefab` | `prefab_query` (有 prefabPath，返回中包含验证信息) |
| `create_prefab` | `prefab_create` (action=from_node) |
| `instantiate_prefab` | `prefab_create` (action=instantiate) |
| `duplicate_prefab` | `prefab_create` (action=duplicate) |
| `update_prefab` | `prefab_update` (action=apply) |
| `revert_prefab` | `prefab_update` (action=revert) |
| `restore_prefab_node` | `prefab_update` (action=revert) |

### 1.3 从 scene-advanced-tools.ts 提取（4 个）

| 原工具名 | 归入新工具 |
|----------|-----------|
| `reset_component` | `component_modify` (action=reset) |
| `execute_component_method` | `component_modify` (action=execute) |
| `restore_prefab` | `prefab_update` (action=revert) |
| `query_scene_components` | `component_query` (action=scene_components) |
| `query_component_has_script` | `component_query` (action=has_script) |
| `query_scene_classes` | `component_query` (action=classes) |

---

## 2. 新工具详细设计

### 2.1 `component_query` — 组件查询

```typescript
name: 'query'
inputSchema: {
    type: 'object',
    properties: {
        uuid: { type: 'string', description: '节点 UUID，查询该节点上的组件' },
        componentType: { type: 'string', description: '组件类型名，配合 uuid 查询特定组件详情' },
        action: {
            type: 'string',
            enum: ['list', 'info', 'available', 'classes', 'scene_components', 'has_script'],
            description: '查询类型。有 uuid 时默认 list，无 uuid 时需指定 action'
        },
        scriptPath: { type: 'string', description: 'action=has_script 时的脚本路径' }
    }
}
```

参数路由逻辑：
| 条件 | 行为 | 来源方法 |
|------|------|---------|
| 有 `uuid` + 有 `componentType` | 查询节点上特定组件详情 | `ComponentTools.getComponentInfo()` |
| 有 `uuid` + 无 `componentType` | 列出节点上所有组件 | `ComponentTools.getComponents()` |
| `action=available` | 列出所有可用组件类型 | `ComponentTools.getAvailableComponents()` |
| `action=classes` | 查询场景中所有类 | `SceneAdvancedTools.querySceneClasses()` |
| `action=scene_components` | 查询场景中所有组件 | `SceneAdvancedTools.querySceneComponents()` |
| `action=has_script` | 检查组件是否有脚本 | `SceneAdvancedTools.queryComponentHasScript()` |

### 2.2 `component_add` — 添加组件

```typescript
name: 'add'
inputSchema: {
    type: 'object',
    properties: {
        uuid: { type: 'string', description: '目标节点 UUID' },
        componentType: {
            type: 'string',
            description: '组件类型。内置组件如 "cc.Sprite"；脚本组件使用路径如 "db://assets/scripts/MyScript.ts"'
        }
    },
    required: ['uuid', 'componentType']
}
```

自动判断逻辑（关键设计）：
```
if componentType 包含 '/' 或以 '.ts' 结尾:
    → 走 attach_script 路径：
      1. Editor.Message.request('asset-db', 'query-uuid', scriptPath) 获取脚本 UUID
      2. Editor.Message.request('scene', 'create-component', { uuid, component: scriptUuid })
else:
    → 走 add_component 路径：
      Editor.Message.request('scene', 'create-component', { uuid, component: componentType })
```

迁移自 `ComponentTools.addComponent()` 和 `ComponentTools.attachScript()` 的实现。

### 2.3 `component_modify` — 修改组件

```typescript
name: 'modify'
inputSchema: {
    type: 'object',
    properties: {
        uuid: { type: 'string', description: '节点 UUID' },
        action: {
            type: 'string',
            enum: ['set', 'remove', 'reset', 'execute'],
            description: '操作类型'
        },
        // set 参数
        componentType: { type: 'string', description: '组件类型名' },
        property: { type: 'string', description: 'action=set 时的属性名' },
        value: { description: 'action=set 时的属性值' },
        // execute 参数
        method: { type: 'string', description: 'action=execute 时的方法名' },
        args: { type: 'array', description: 'action=execute 时的方法参数' }
    },
    required: ['uuid', 'action']
}
```

action 路由：
| action | 来源方法 | 关键逻辑 |
|--------|---------|---------|
| `set` | `ComponentTools.setComponentProperty()` | **必须保留复杂类型转换逻辑**（见下方） |
| `remove` | `ComponentTools.removeComponent()` | 直接迁移 |
| `reset` | `SceneAdvancedTools.resetComponent()` | 直接迁移 |
| `execute` | `SceneAdvancedTools.executeComponentMethod()` | 直接迁移 |

#### 复杂类型转换逻辑（必须完整迁移）

`ComponentTools.setComponentProperty()` 中包含对以下类型的特殊处理，这是本 Step 最关键的迁移点：

- `Color` → `{r, g, b, a}` 格式转换
- `Vec2` / `Vec3` / `Vec4` → `{x, y, z, w}` 格式转换
- `Size` → `{width, height}` 格式转换
- 节点引用 → UUID 解析
- 资源引用 → UUID 解析 + `db://` 路径转换
- 枚举类型 → 数值映射

从 `component-tools.ts` 的 `setComponentProperty()` 方法中完整复制此逻辑，不做简化。

---

### 2.4 `prefab_query` — 预制体查询

```typescript
name: 'query'
inputSchema: {
    type: 'object',
    properties: {
        prefabPath: { type: 'string', description: '预制体路径，如 db://assets/prefabs/Player.prefab' },
        folder: { type: 'string', description: '限定搜索目录' }
    }
}
```

参数路由：
| 条件 | 行为 | 来源方法 |
|------|------|---------|
| 有 `prefabPath` | 查询预制体详情（含验证信息） | `PrefabTools.getPrefabInfo()` + `validatePrefab()` + `loadPrefab()` |
| 无 `prefabPath` | 列出所有预制体 | `PrefabTools.getPrefabList()` |

### 2.5 `prefab_create` — 创建/实例化预制体

```typescript
name: 'create'
inputSchema: {
    type: 'object',
    properties: {
        action: {
            type: 'string',
            enum: ['from_node', 'instantiate', 'duplicate'],
            description: '操作类型'
        },
        // from_node 参数
        uuid: { type: 'string', description: 'action=from_node 时的源节点 UUID' },
        savePath: { type: 'string', description: 'action=from_node 时的保存路径' },
        // instantiate 参数
        prefabPath: { type: 'string', description: 'action=instantiate 时的预制体路径' },
        parentUuid: { type: 'string', description: 'action=instantiate 时的父节点 UUID' },
        // duplicate 参数
        sourcePath: { type: 'string', description: 'action=duplicate 时的源预制体路径' },
        targetPath: { type: 'string', description: 'action=duplicate 时的目标路径' }
    },
    required: ['action']
}
```

action 路由：
| action | 来源方法 |
|--------|---------|
| `from_node` | `PrefabTools.createPrefab()` |
| `instantiate` | `PrefabTools.instantiatePrefab()` |
| `duplicate` | `PrefabTools.duplicatePrefab()` |

### 2.6 `prefab_update` — 更新/恢复预制体

```typescript
name: 'update'
inputSchema: {
    type: 'object',
    properties: {
        action: {
            type: 'string',
            enum: ['apply', 'revert'],
            description: 'apply=保存修改到预制体资源，revert=恢复实例到预制体原始状态'
        },
        uuid: { type: 'string', description: '预制体实例的节点 UUID' }
    },
    required: ['action', 'uuid']
}
```

action 路由：
| action | 来源方法 |
|--------|---------|
| `apply` | `PrefabTools.updatePrefab()` |
| `revert` | `PrefabTools.revertPrefab()` + `SceneAdvancedTools.restorePrefab()` + `PrefabTools.restorePrefabNode()` |

`revert` 合并了三个来源，选择最完整的实现作为主逻辑。

---

## 3. 实现要点

### 3.1 文件结构

```
source/tools/v2/
  ├── scene-tools.ts        (Step 2 已创建)
  ├── node-tools.ts         (Step 2 已创建)
  ├── component-tools.ts    → ComponentToolsV2 类，3 个工具
  └── prefab-tools.ts       → PrefabToolsV2 类，3 个工具
```

### 3.2 category key 映射

- `component` → ComponentToolsV2
- `prefab` → PrefabToolsV2

### 3.3 scene-advanced-tools.ts 拆分进度

本 Step 提取的工具：`reset_component`, `execute_component_method`, `restore_prefab`, `query_scene_components`, `query_component_has_script`, `query_scene_classes`

Step 2 已提取的工具：`reset_node_property`, `reset_node_transform`, `copy_node`, `paste_node`, `cut_node`, `query_scene_ready`, `query_scene_dirty`, `soft_reload_scene`, `scene_snapshot`, `scene_snapshot_abort`, `query_nodes_by_asset_uuid`

剩余待 Step 4 提取的工具：`move_array_element`, `remove_array_element`, `begin_undo_recording`, `end_undo_recording`, `cancel_undo_recording`, `execute_scene_script`

---

## 4. 验证标准

### L1: 编译验证
```bash
npm run build
# 预期：零 TS 编译错误
```

### L3: 功能验证（Step 5 切换路由后执行）

| 用例 | 操作 | 预期 |
|------|------|------|
| C-1 | `component_add` uuid=<UUID>, componentType="cc.Sprite" | 节点上出现 Sprite 组件 |
| C-2 | `component_add` uuid=<UUID>, componentType="db://assets/scripts/MyScript.ts" | 节点上出现自定义脚本组件 |
| C-3 | `component_query` uuid=<UUID> | 返回节点所有组件列表 |
| C-4 | `component_query` action=available | 返回所有可用组件类型 |
| C-5 | `component_modify` action=set, property="color", value={r:255,g:0,b:0,a:255} | Sprite 颜色变红 |
| C-6 | `component_modify` action=remove, componentType="cc.Sprite" | Sprite 被移除 |
| P-1 | `prefab_query`（无参数） | 返回所有 .prefab 文件 |
| P-2 | `prefab_create` action=from_node, uuid=<UUID> | 生成 .prefab 文件 |
| P-3 | `prefab_create` action=instantiate, prefabPath=<path> | 场景中出现预制体实例 |
| P-4 | `prefab_update` action=apply | 预制体资源更新 |
| P-5 | `prefab_update` action=revert | 实例恢复原始状态 |

### 回归验证
- N-1, N-2, N-5（确认节点操作未被破坏）

### 完成标记
- [ ] `source/tools/v2/component-tools.ts` 已创建，包含 3 个工具
- [ ] `source/tools/v2/prefab-tools.ts` 已创建，包含 3 个工具
- [ ] 复杂类型转换逻辑已完整迁移
- [ ] `npm run build` 编译通过
- [ ] 创建 git tag `tool-opt/step-3`
