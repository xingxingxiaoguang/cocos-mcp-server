# P1 修复：node_query / asset_query / prefab_create / project_query

> 本文档覆盖 5 个 P1 级问题，涉及节点信息展示不完整、资产查询过滤失效、预制体创建不完整、项目配置读取为空。

---

## 缺陷 4：node_query / node_create 组件类型显示为 "Unknown"

### 现象

```json
{
  "components": [
    { "type": "Unknown", "enabled": true },
    { "type": "Unknown", "enabled": true }
  ]
}
```

所有节点的组件类型均为 `"Unknown"`，无法区分 `cc.UITransform`、`cc.Sprite` 等。

### 根因

`queryByUuid()` (node-tools.ts:217) 解析组件的逻辑：

```typescript
components: (nodeData.__comps__ || []).map((comp: any) => ({
    type: comp.__type__ || 'Unknown',
    enabled: comp.enabled !== undefined ? comp.enabled : true
})),
```

`query-node` 返回的 `__comps__` 中每个组件的 `__type__` 是一个**嵌套对象**（包含 `value` 字段），不是直接的字符串。正确的取值路径应该检查 `comp.__type__` 的具体结构。

对比 `getComponents()` (component-tools.ts:197)，它用的是相同有问题的方式，但在 scene-tools 中 `buildHierarchy` 方法却能正确解析（因为 `query-node-tree` 返回的数据格式不同）。

### 修复方案

在 `queryByUuid` 中使用与 `scene_query hierarchy` 一致的 `query-node-tree` 数据源，或者正确解析 `query-node` 的嵌套格式：

```typescript
// node-tools.ts - queryByUuid 修改组件解析
components: (nodeData.__comps__ || []).map((comp: any) => {
    // __type__ 可能是字符串、嵌套对象、或 cid
    let rawType = comp.__type__;
    if (rawType && typeof rawType === 'object') {
        rawType = rawType.value || rawType.cid || rawType;
    }
    const typeName = typeof rawType === 'string' ? rawType : 'Unknown';
    return {
        type: typeName,
        enabled: comp.enabled?.value !== undefined ? comp.enabled.value :
                 comp.enabled !== undefined ? comp.enabled : true
    };
}),
```

**更优方案**：复用 `component-tools.ts` 中 01 方案新增的 `buildCidNameMap()`，将 cid 解析为可读类名：

```typescript
// node-tools.ts 中添加 cidMap 缓存
private cidNameMap: Map<string, string> | null = null;

private async getCidNameMap(): Promise<Map<string, string>> {
    if (this.cidNameMap) return this.cidNameMap;
    // 复用 component-tools 的映射构建逻辑
    const map = new Map<string, string>();
    try {
        const result = await Editor.Message.request(
            'scene', 'query-component-function-of-node', ''
        );
        if (Array.isArray(result)) {
            for (const comp of result) {
                if (comp.cid && comp.name) {
                    map.set(comp.cid, comp.name);
                }
            }
        }
    } catch { /* ignore */ }
    this.cidNameMap = map;
    return map;
}
```

然后在组件解析中：

```typescript
const cidMap = await this.getCidNameMap();
// ...
type: cidMap.get(typeName) || typeName,
```

### 影响文件

| 文件 | 修改 |
|------|------|
| `source/tools/v2/node-tools.ts` | `queryByUuid()` 组件解析逻辑 |

---

## 缺陷 5：node_query 无参查询 path 缺少完整层级

### 现象

```json
{ "name": "Ground", "path": "/Ground" }
```

应为 `hello/Canvas/Ground`，当前丢失了父级路径。

### 根因

`queryAll()` (node-tools.ts) 调用 `getNodePath(node)` (:259)：

```typescript
private getNodePath(node: any): string {
    const path = [node.name];
    let current = node.parent;
    while (current && current.name !== 'Canvas') {  // ← 在 Canvas 处截断
        path.unshift(current.name);
        current = current.parent;
    }
    return path.join('/');
}
```

两个问题：
1. 在 `Canvas` 处截断路径，丢失了 `Canvas` 自身和 Scene 节点。
2. `query-node-tree` 返回的节点结构中 `parent` 字段不存在（树结构是自上而下的 children，没有反向 parent 引用），所以 `current.parent` 始终为 `undefined`，while 循环永远只执行零次。

### 修复方案

在 `traverseTree` 遍历时传递完整路径：

```typescript
private async queryAll(): Promise<ToolResponse> {
    return new Promise((resolve) => {
        Editor.Message.request('scene', 'query-node-tree').then((tree: any) => {
            const nodes: any[] = [];

            const traverseTree = (node: any, parentPath: string = '') => {
                const currentPath = parentPath
                    ? `${parentPath}/${node.name}`
                    : node.name;

                nodes.push({
                    uuid: node.uuid,
                    name: node.name,
                    type: node.type,
                    active: node.active,
                    path: currentPath
                });

                if (node.children) {
                    for (const child of node.children) {
                        traverseTree(child, currentPath);
                    }
                }
            };

            if (tree) {
                traverseTree(tree);
            }

            resolve({
                success: true,
                data: { totalNodes: nodes.length, nodes }
            });
        }).catch(/* ... existing fallback ... */);
    });
}
```

同时删除不再需要的 `getNodePath()` 方法。

### 影响文件

| 文件 | 修改 |
|------|------|
| `source/tools/v2/node-tools.ts` | 重写 `queryAll()` 中的路径构建，删除 `getNodePath()` |

---

## 缺陷 6：asset_query list 的 type 过滤未生效

### 现象

```
asset_query { action: "list", type: "cc.ImageAsset" }
```

返回了所有资产（Script、Prefab、Scene 等），类型过滤形同虚设。

### 根因

`listAssets()` (asset-tools.ts:334) 的类型过滤机制：

```typescript
const typeExtensions: Record<string, string> = {
    'scene': '.scene',
    'prefab': '.prefab',
    'script': '.{ts,js}',
    'texture': '.{png,jpg,jpeg,gif,tga,bmp,psd}',
    // ...
};
const extension = typeExtensions[type];  // type = "cc.ImageAsset"
if (extension) {
    pattern = `${folder}/**/*${extension}`;
}
// typeExtensions 中没有 "cc.ImageAsset" 这个 key → extension = undefined
// → pattern 不变 → 查全部
```

过滤只支持简写 key（`scene`/`texture`），不支持 Cocos 类型名（`cc.ImageAsset`/`cc.Script`）。当传入不匹配的 key 时，静默 fallback 到查询全部资产。

### 修复方案

**Step 1：扩展 type 映射，支持 cc 类型名**

```typescript
private async listAssets(type: string = 'all', folder: string = 'db://assets'): Promise<ToolResponse> {
    let pattern = `${folder}/**/*`;

    if (type && type !== 'all') {
        // 支持简写和 cc 类型名两种格式
        const typeExtensions: Record<string, string> = {
            'scene': '.scene', 'cc.SceneAsset': '.scene',
            'prefab': '.prefab', 'cc.Prefab': '.prefab',
            'script': '.{ts,js}', 'cc.Script': '.{ts,js}',
            'texture': '.{png,jpg,jpeg,gif,tga,bmp,psd}',
            'cc.ImageAsset': '.{png,jpg,jpeg,gif,tga,bmp,psd}',
            'cc.Texture2D': '.{png,jpg,jpeg,gif,tga,bmp,psd}',
            'material': '.mtl', 'cc.Material': '.mtl',
            'mesh': '.{fbx,obj,dae}', 'cc.Mesh': '.{fbx,obj,dae}',
            'audio': '.{mp3,ogg,wav,m4a}', 'cc.AudioClip': '.{mp3,ogg,wav,m4a}',
            'animation': '.{anim,clip}', 'cc.AnimationClip': '.{anim,clip}',
            'spriteFrame': '.{png,jpg,jpeg}', 'cc.SpriteFrame': '.{png,jpg,jpeg}',
            'spriteAtlas': '.plist', 'cc.SpriteAtlas': '.plist',
            'font': '.{ttf,fnt,bmfont}', 'cc.Font': '.{ttf,fnt,bmfont}',
        };

        const extension = typeExtensions[type];
        if (extension) {
            pattern = `${folder}/**/*${extension}`;
        }
        // 无匹配扩展名时，仍查全部但在结果中按 type 过滤
    }

    return new Promise((resolve) => {
        Editor.Message.request('asset-db', 'query-assets', { pattern }).then((results: any[]) => {
            let assets = results.map(asset => ({
                name: asset.name,
                uuid: asset.uuid,
                path: asset.url,
                type: asset.type,
                size: asset.size || 0,
                isDirectory: asset.isDirectory || false
            }));

            // Step 2：后置 type 过滤（兜底）
            if (type && type !== 'all') {
                const filtered = assets.filter(a =>
                    a.type === type || a.type?.includes(type.replace('cc.', ''))
                );
                // 仅当过滤后有结果时才使用过滤结果
                if (filtered.length > 0) {
                    assets = filtered;
                }
            }

            resolve({
                success: true,
                data: { type: type || 'all', folder, count: assets.length, assets }
            });
        }).catch((err: Error) => {
            resolve({ success: false, error: err.message });
        });
    });
}
```

### 影响文件

| 文件 | 修改 |
|------|------|
| `source/tools/v2/asset-tools.ts` | 重写 `listAssets()` 类型映射和后置过滤 |

---

## 缺陷 7：prefab_create from_node 节点未转为 prefab 实例

### 现象

```json
{
  "success": true,
  "convertResult": { "success": false, "error": "节点转换为预制体实例需要更深入的引擎集成支持" },
  "message": "预制体创建成功，但节点转换失败"
}
```

预制体文件创建成功，但源节点没有变成 prefab 实例（没有蓝色标识）。

### 根因

`prefab_create from_node` 分两步：
1. 将节点序列化为 `.prefab` 文件 → 成功
2. 将源节点转为预制体实例（关联到新创建的 prefab 资源）→ 失败

第 2 步需要使用 Cocos 编辑器的 `link-node-to-prefab` 或类似的内部 API，当前代码没有正确调用。

### 修复方案

```typescript
// prefab-tools.ts 中 from_node 的转换步骤
private async convertNodeToPrefabInstance(
    nodeUuid: string, prefabUuid: string
): Promise<ToolResponse> {
    try {
        // 方案 A：使用编辑器内置 API 关联节点和预制体
        await Editor.Message.request('scene', 'link-prefab', {
            nodeUuid: nodeUuid,
            prefabAssetUuid: prefabUuid
        });
        return { success: true, message: 'Node linked to prefab successfully' };
    } catch (err1: any) {
        try {
            // 方案 B：使用 create-nodes-by-uuids 从 prefab 重建
            // 1. 记录节点的父节点和位置
            const nodeInfo = await Editor.Message.request('scene', 'query-node', nodeUuid);
            const parentUuid = nodeInfo?.parent?.value?.uuid;
            const position = nodeInfo?.position?.value;

            // 2. 删除旧节点
            await Editor.Message.request('scene', 'remove-node', { uuid: nodeUuid });

            // 3. 从 prefab 实例化新节点
            const newUuid = await Editor.Message.request('scene', 'create-node', {
                parent: parentUuid,
                assetUuid: prefabUuid
            });

            // 4. 恢复位置
            if (position) {
                await Editor.Message.request('scene', 'set-property', {
                    uuid: Array.isArray(newUuid) ? newUuid[0] : newUuid,
                    path: 'position',
                    dump: { value: position }
                });
            }

            return {
                success: true,
                data: { newNodeUuid: Array.isArray(newUuid) ? newUuid[0] : newUuid },
                message: 'Node replaced with prefab instance (delete + re-instantiate)'
            };
        } catch (err2: any) {
            return {
                success: false,
                error: `link-prefab failed: ${err1.message}, re-instantiate failed: ${err2.message}`
            };
        }
    }
}
```

> **注意**：方案 B（删除+重建）会改变节点 UUID，可能影响其他引用。应在返回数据中明确告知新 UUID。`link-prefab` 的具体 API 名需在 3.8.3 中验证。

### 影响文件

| 文件 | 修改 |
|------|------|
| `source/tools/v2/prefab-tools.ts` | 重写 `convertNodeToPrefabInstance()` |

---

## 缺陷 8：project_query settings 返回 config: null

### 现象

```
project_query { action: "settings", category: "physics" }
→ { category: "physics", config: null, message: "physics settings retrieved successfully" }
```

但 `project_query info` 能返回 physics 配置（在 `config.physics` 中）。

### 根因

`getProjectSettings()` (project-tools.ts:95) 使用：

```typescript
Editor.Message.request('project', 'query-config', 'physics')
```

Cocos Creator 3.8.x 中 `project` 模块的 `query-config` 消息可能不接受 `physics` 作为参数，或者该 API 的用法不是传分类名。

而 `project_query info` 中是通过文件系统读取 `settings/project.json` 获取配置的，所以能拿到数据。

### 修复方案

**直接读取项目配置文件**，这是最可靠的方式：

```typescript
private async getProjectSettings(category: string = 'general'): Promise<ToolResponse> {
    try {
        const projectPath = Editor.Project.path;
        const configPath = path.join(projectPath, 'settings', 'project.json');

        if (!fs.existsSync(configPath)) {
            return { success: false, error: 'Project config file not found' };
        }

        const configContent = JSON.parse(fs.readFileSync(configPath, 'utf8'));

        if (category === 'general' || category === 'all') {
            return {
                success: true,
                data: { category, config: configContent }
            };
        }

        // 提取指定分类的配置
        const categoryConfig = configContent[category];
        if (categoryConfig !== undefined) {
            return {
                success: true,
                data: {
                    category,
                    config: categoryConfig,
                    message: `${category} settings retrieved successfully`
                }
            };
        }

        // 尝试查找嵌套路径（如 "script" → configContent.script）
        const available = Object.keys(configContent).filter(k => !k.startsWith('_'));
        return {
            success: false,
            error: `Category '${category}' not found in project config. Available: ${available.join(', ')}`
        };
    } catch (err: any) {
        return { success: false, error: `Failed to read project settings: ${err.message}` };
    }
}
```

需要在文件顶部添加 `import * as fs from 'fs'` 和 `import * as path from 'path'`。

### 影响文件

| 文件 | 修改 |
|------|------|
| `source/tools/v2/project-tools.ts` | 重写 `getProjectSettings()`，新增 fs/path import |

---

## 验证用例

```bash
# 缺陷 4：组件类型正确显示
mcp: node_query { uuid: "<nodeUuid>" }
# 期望: components 中 type 为 "cc.UITransform"、"cc.Sprite" 等可读名称

# 缺陷 5：path 包含完整层级
mcp: node_query {}
# 期望: { path: "hello/Canvas/Ground" }

# 缺陷 6：type 过滤生效
mcp: asset_query { action: "list", type: "cc.ImageAsset" }
# 期望: 只返回图片资产

# 缺陷 7：from_node 创建完整 prefab
mcp: prefab_create { action: "from_node", uuid: "<node>", savePath: "db://assets/prefabs/X.prefab" }
# 期望: convertResult.success = true

# 缺陷 8：settings 返回实际配置
mcp: project_query { action: "settings", category: "physics" }
# 期望: config 包含 gravity、allowSleep 等字段
```
