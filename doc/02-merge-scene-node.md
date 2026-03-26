# Step 2: 合并核心工具 — Scene + Node

> 前置依赖：Step 1 完成
> 预计改动量：大
> 目标：将 scene-tools.ts（8 个）+ node-tools.ts（11 个）+ scene-advanced-tools.ts 中相关工具合并为 10 个新工具

---

## 1. 来源工具清单

### 1.1 scene-tools.ts（8 个）

| 原工具名 | 归入新工具 |
|----------|-----------|
| `get_current_scene` | `scene_query` (action=info) |
| `get_scene_list` | `scene_query` (action=list) |
| `get_scene_hierarchy` | `scene_query` (action=hierarchy) |
| `open_scene` | `scene_open` |
| `save_scene` | `scene_save` (action=save) |
| `save_scene_as` | `scene_save` (action=save_as) |
| `close_scene` | `scene_save` (action=close) |
| `create_scene` | `scene_create` |

### 1.2 node-tools.ts（11 个）

| 原工具名 | 归入新工具 |
|----------|-----------|
| `create_node` | `node_create` |
| `get_node_info` | `node_query` (有 uuid) |
| `find_nodes` | `node_query` (有 pattern) |
| `find_node_by_name` | `node_query` (有 pattern) |
| `get_all_nodes` | `node_query` (无参数) |
| `set_node_property` | `node_modify` (action=set_property) |
| `set_node_transform` | `node_modify` (action=set_transform) |
| `delete_node` | `node_delete` |
| `move_node` | `node_arrange` (action=move) |
| `duplicate_node` | `node_arrange` (action=duplicate) |
| `detect_node_type` | `node_query` (有 uuid，返回中包含类型信息) |

### 1.3 从 scene-advanced-tools.ts 提取（7 个）

| 原工具名 | 归入新工具 |
|----------|-----------|
| `reset_node_property` | `node_modify` (action=reset_property) |
| `reset_node_transform` | `node_modify` (action=reset_transform) |
| `copy_node` | `node_arrange` (action=copy) |
| `paste_node` | `node_arrange` (action=paste) |
| `cut_node` | `node_arrange` (action=cut) |
| `query_scene_ready` | `scene_query` (action=status) |
| `query_scene_dirty` | `scene_query` (action=status) |
| `soft_reload_scene` | `scene_manage` (action=reload) |
| `scene_snapshot` | `scene_manage` (action=snapshot) |
| `scene_snapshot_abort` | `scene_manage` (action=snapshot_abort) |
| `query_nodes_by_asset_uuid` | `node_query` (有 assetUuid) |

---

## 2. 新工具详细设计

### 2.1 `scene_query` — 场景查询

```typescript
name: 'query'
inputSchema: {
    type: 'object',
    properties: {
        action: {
            type: 'string',
            enum: ['info', 'hierarchy', 'list', 'status'],
            description: '查询类型。info=当前场景信息，hierarchy=节点树，list=项目场景列表，status=就绪/脏状态。默认 info'
        },
        includeComponents: {
            type: 'boolean',
            description: '仅 action=hierarchy 时有效，是否包含组件列表',
            default: false
        }
    }
}
```

action 路由：
| action | 调用的 Editor API | 来源方法 |
|--------|------------------|---------|
| `info`（默认） | `Editor.Message.request('scene', 'query-scene-info')` 或等效 | `SceneTools.getCurrentScene()` |
| `hierarchy` | `Editor.Message.request('scene', 'query-node-tree')` | `SceneTools.getSceneHierarchy()` |
| `list` | `Editor.Message.request('asset-db', 'query-assets', { type: 'cc.SceneAsset' })` | `SceneTools.getSceneList()` |
| `status` | `Editor.Message.request('scene', 'query-scene-ready')` + `query-scene-dirty` | `SceneAdvancedTools.querySceneReady()` + `querySceneDirty()` |

### 2.2 `scene_open` — 打开场景

```typescript
name: 'open'
inputSchema: {
    type: 'object',
    properties: {
        scenePath: { type: 'string', description: '场景文件路径，如 db://assets/scenes/Main.scene' }
    },
    required: ['scenePath']
}
```

直接迁移 `SceneTools.openScene()` 的实现。

### 2.3 `scene_save` — 保存/另存/关闭场景

```typescript
name: 'save'
inputSchema: {
    type: 'object',
    properties: {
        action: {
            type: 'string',
            enum: ['save', 'save_as', 'close'],
            description: '操作类型。默认 save'
        },
        path: {
            type: 'string',
            description: '仅 action=save_as 时必填，另存为的目标路径'
        }
    }
}
```

action 路由：
| action | 来源方法 |
|--------|---------|
| `save` | `SceneTools.saveScene()` |
| `save_as` | `SceneTools.saveSceneAs()` |
| `close` | `SceneTools.closeScene()` |

### 2.4 `scene_create` — 创建场景

```typescript
name: 'create'
inputSchema: {
    type: 'object',
    properties: {
        sceneName: { type: 'string', description: '场景名称' },
        savePath: { type: 'string', description: '保存路径，如 db://assets/scenes/NewScene.scene' }
    },
    required: ['sceneName', 'savePath']
}
```

直接迁移 `SceneTools.createScene()` 的实现。

### 2.5 `scene_manage` — 场景管理操作

```typescript
name: 'manage'
inputSchema: {
    type: 'object',
    properties: {
        action: {
            type: 'string',
            enum: ['reload', 'snapshot', 'snapshot_abort'],
            description: '操作类型'
        }
    },
    required: ['action']
}
```

action 路由：
| action | 来源方法 |
|--------|---------|
| `reload` | `SceneAdvancedTools.softReloadScene()` |
| `snapshot` | `SceneAdvancedTools.sceneSnapshot()` |
| `snapshot_abort` | `SceneAdvancedTools.sceneSnapshotAbort()` |

---

### 2.6 `node_query` — 节点查询

```typescript
name: 'query'
inputSchema: {
    type: 'object',
    properties: {
        uuid: { type: 'string', description: '节点 UUID，查询单个节点详情' },
        pattern: { type: 'string', description: '名称匹配模式，支持通配符' },
        assetUuid: { type: 'string', description: '资源 UUID，查询引用该资源的节点' }
    }
}
```

参数路由逻辑（优先级从高到低）：
1. 有 `uuid` → 调用 `query-node` 获取单个节点详情（合并 `get_node_info` + `detect_node_type`）
2. 有 `pattern` → 调用 `query-node-tree` + 遍历匹配（合并 `find_nodes` + `find_node_by_name`）
3. 有 `assetUuid` → 调用 `query-nodes-by-asset-uuid`
4. 无参数 → 调用 `query-node-tree` 返回全部节点（`get_all_nodes`）

### 2.7 `node_create` — 创建节点

```typescript
name: 'create'
inputSchema: {
    // 保持 NodeTools.createNode() 的现有参数设计
    type: 'object',
    properties: {
        name: { type: 'string', description: '节点名称' },
        parentUuid: { type: 'string', description: '父节点 UUID' },
        nodeType: { type: 'string', enum: ['Node', '2DNode', '3DNode'], default: 'Node' },
        siblingIndex: { type: 'number', default: -1 },
        assetUuid: { type: 'string', description: '从资源实例化' },
        assetPath: { type: 'string', description: '从资源路径实例化' },
        components: { type: 'array', items: { type: 'string' } },
        unlinkPrefab: { type: 'boolean', default: false },
        keepWorldTransform: { type: 'boolean', default: false },
        initialTransform: { type: 'object' }
    },
    required: ['name']
}
```

迁移 `NodeTools.createNode()` 的完整实现。创建成功后额外调用 `query-node` 返回完整节点信息。

### 2.8 `node_modify` — 修改节点

```typescript
name: 'modify'
inputSchema: {
    type: 'object',
    properties: {
        uuid: { type: 'string', description: '节点 UUID' },
        action: {
            type: 'string',
            enum: ['set_property', 'set_transform', 'reset_property', 'reset_transform'],
            description: '操作类型'
        },
        // set_property 参数
        property: { type: 'string', description: 'action=set_property 时的属性路径' },
        value: { description: 'action=set_property 时的属性值' },
        // set_transform 参数
        position: { type: 'object', description: 'action=set_transform 时的位置 {x,y,z}' },
        rotation: { type: 'object', description: 'action=set_transform 时的旋转 {x,y,z}' },
        scale: { type: 'object', description: 'action=set_transform 时的缩放 {x,y,z}' },
        // reset_property 参数
        path: { type: 'string', description: 'action=reset_property 时的属性路径' }
    },
    required: ['uuid', 'action']
}
```

action 路由：
| action | 来源方法 | 关键逻辑 |
|--------|---------|---------|
| `set_property` | `NodeTools.setNodeProperty()` | 直接迁移 |
| `set_transform` | `NodeTools.setNodeTransform()` | 保留 2D/3D 自动检测逻辑 |
| `reset_property` | `SceneAdvancedTools.resetNodeProperty()` | 直接迁移 |
| `reset_transform` | `SceneAdvancedTools.resetNodeTransform()` | 直接迁移 |

所有写操作成功后，额外调用 `query-node` 返回修改后的完整节点信息。

### 2.9 `node_delete` — 删除节点

```typescript
name: 'delete'
inputSchema: {
    type: 'object',
    properties: {
        uuids: {
            oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
            description: '要删除的节点 UUID，支持单个或数组'
        }
    },
    required: ['uuids']
}
```

迁移 `NodeTools.deleteNode()` 的实现，统一将 `string` 转为 `string[]` 处理。

### 2.10 `node_arrange` — 节点组织操作

```typescript
name: 'arrange'
inputSchema: {
    type: 'object',
    properties: {
        action: {
            type: 'string',
            enum: ['move', 'duplicate', 'copy', 'paste', 'cut'],
            description: '操作类型'
        },
        // move 参数
        uuid: { type: 'string', description: 'action=move 时的节点 UUID' },
        parentUuid: { type: 'string', description: 'action=move/paste 时的目标父节点 UUID' },
        siblingIndex: { type: 'number', description: 'action=move 时的兄弟索引' },
        // duplicate 参数
        uuids: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
        // copy/cut 参数（复用 uuids）
    },
    required: ['action']
}
```

action 路由：
| action | 来源方法 |
|--------|---------|
| `move` | `NodeTools.moveNode()` |
| `duplicate` | `NodeTools.duplicateNode()` |
| `copy` | `SceneAdvancedTools.copyNode()` |
| `paste` | `SceneAdvancedTools.pasteNode()` |
| `cut` | `SceneAdvancedTools.cutNode()` |

---

## 3. 实现要点

### 3.1 文件结构

```
source/tools/v2/
  ├── scene-tools.ts    → SceneToolsV2 类，实现 5 个场景工具
  └── node-tools.ts     → NodeToolsV2 类，实现 5 个节点工具
```

### 3.2 category key 映射

新工具在 `mcp-server.ts` 中注册时的 category key：
- `scene` → SceneToolsV2（与旧 key 相同）
- `node` → NodeToolsV2（与旧 key 相同）

由于 Step 2 阶段新旧文件并存，新文件暂不注册到 `mcp-server.ts`。注册切换在 Step 5 统一执行。

### 3.3 代码迁移策略

1. 从旧文件中复制 `execute()` 方法内的具体实现逻辑（`Editor.Message.request()` 调用）
2. 在新文件的 `execute()` 方法中通过 `switch(action)` 或参数判断路由到对应逻辑
3. 保留原有的 try-catch 和错误处理
4. `node_modify` 的 `set_transform` action 必须保留 `NodeTools.setNodeTransform()` 中的 2D/3D 自动检测逻辑

### 3.4 注意：scene-advanced-tools.ts 的拆分

本 Step 从 `scene-advanced-tools.ts` 提取了部分工具。剩余工具将在 Step 3 和 Step 4 中提取。不要删除 `scene-advanced-tools.ts`，仅从中复制需要的实现代码。

---

## 4. 验证标准

### L1: 编译验证
```bash
npm run build
# 预期：零 TS 编译错误（新文件在 v2/ 目录下，旧文件仍存在）
```

### L2: 单元级验证（Step 5 切换路由后执行）

此阶段新工具尚未注册到 MCP 服务器，L2 验证推迟到 Step 5。但可以编写简单的测试脚本验证 `getTools()` 返回正确的工具定义。

### L3: 功能验证（Step 5 切换路由后执行）

| 用例 | 操作 | 预期 |
|------|------|------|
| S-1 | `scene_query` action=info | 返回当前场景名称和 UUID |
| S-2 | `scene_query` action=hierarchy, includeComponents=true | 返回完整节点树含组件 |
| S-3 | `scene_query` action=list | 返回所有 .scene 文件路径 |
| S-4 | `scene_query` action=status | 返回 ready 和 dirty 状态 |
| S-5 | `scene_create` sceneName="TestScene" | 项目中出现 TestScene.scene |
| S-6 | `scene_open` scenePath="db://assets/TestScene.scene" | 编辑器切换场景 |
| S-7 | `scene_save` action=save | 场景保存，dirty→false |
| S-8 | `scene_manage` action=reload | 场景重新加载 |
| N-1 | `node_create` name="TestNode" | 返回新节点完整信息含 UUID |
| N-2 | `node_query` uuid=<UUID> | 返回节点详情 |
| N-3 | `node_query` pattern="Test*" | 返回匹配节点列表 |
| N-4 | `node_query`（无参数） | 返回所有节点 |
| N-5 | `node_modify` action=set_transform, position={x:1,y:2,z:3} | 位置更新，返回完整信息 |
| N-6 | `node_modify` action=set_property, property="active", value=false | 节点不可见 |
| N-7 | `node_modify` action=reset_transform | 位置/旋转/缩放归零 |
| N-8 | `node_arrange` action=duplicate | 出现副本节点 |
| N-9 | `node_arrange` action=move, parentUuid=<UUID> | 节点移动到新父节点 |
| N-10 | `node_delete` uuids=<UUID> | 节点从场景移除 |

### 完成标记
- [ ] `source/tools/v2/scene-tools.ts` 已创建，包含 5 个工具
- [ ] `source/tools/v2/node-tools.ts` 已创建，包含 5 个工具
- [ ] `npm run build` 编译通过
- [ ] 创建 git tag `tool-opt/step-2`
