# P2 优化：component_query 精简 + 未实现功能占位 + debug_execute 体验

> 本文档覆盖 4 个 P2 级问题，主要影响工具易用性和 token 消耗效率。

---

## 缺陷 9 & 10：asset_query dependencies / unused 未实现

### 现象

```
asset_query { action: "dependencies", uuid: "..." }
→ "Asset dependency analysis requires additional APIs not available..."

asset_query { action: "unused" }
→ "Unused asset detection requires comprehensive project analysis..."
```

### 当前状态

两个功能返回了"未实现"的提示文案，但仍然暴露在工具定义中。AI 调用后得到的错误信息没有提供替代方案。

### 修复方案

**方案 A（推荐）：实现基础的 dependencies 查询**

Cocos Creator 3.8.x 的 asset-db 提供了 `query-asset-meta` 接口，meta 中包含依赖信息：

```typescript
private async getAssetDependencies(uuid: string, direction: string = 'dependencies'): Promise<ToolResponse> {
    try {
        const assetInfo = await Editor.Message.request('asset-db', 'query-asset-info', uuid);
        if (!assetInfo) {
            return { success: false, error: `Asset ${uuid} not found` };
        }

        if (direction === 'dependencies' || direction === 'both') {
            // 读取 .meta 文件中的依赖信息
            const metaPath = assetInfo.file + '.meta';
            if (fs.existsSync(metaPath)) {
                const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
                // 场景/预制体文件可以解析 JSON 内容中的 uuid 引用
                const deps = this.extractUuidReferences(assetInfo.file, assetInfo.type);
                return {
                    success: true,
                    data: {
                        uuid,
                        name: assetInfo.name,
                        direction,
                        dependencies: deps,
                        count: deps.length
                    }
                };
            }
        }

        if (direction === 'dependents' || direction === 'both') {
            // 反向查找：哪些资产引用了该 uuid
            // 通过 grep 项目 assets 目录
            const projectPath = Editor.Project.path;
            const assetsPath = path.join(projectPath, 'assets');
            const dependents = this.findUuidReferences(assetsPath, uuid);
            return {
                success: true,
                data: { uuid, direction, dependents, count: dependents.length }
            };
        }

        return { success: false, error: `Unknown direction: ${direction}` };
    } catch (err: any) {
        return { success: false, error: `Dependency analysis failed: ${err.message}` };
    }
}

/**
 * 从场景/预制体文件中提取 UUID 引用
 */
private extractUuidReferences(filePath: string, type: string): string[] {
    try {
        if (!filePath || !fs.existsSync(filePath)) return [];
        const content = fs.readFileSync(filePath, 'utf8');
        // 匹配 Cocos UUID 格式
        const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
        const matches = content.match(uuidRegex) || [];
        return [...new Set(matches)];
    } catch {
        return [];
    }
}

/**
 * 在资产目录中搜索引用了指定 UUID 的文件
 */
private findUuidReferences(assetsPath: string, targetUuid: string): any[] {
    const results: any[] = [];
    const searchExtensions = ['.scene', '.prefab', '.mtl', '.anim'];

    const walkDir = (dir: string) => {
        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    walkDir(fullPath);
                } else if (searchExtensions.some(ext => entry.name.endsWith(ext))) {
                    try {
                        const content = fs.readFileSync(fullPath, 'utf8');
                        if (content.includes(targetUuid)) {
                            results.push({
                                file: fullPath.replace(assetsPath, 'db://assets'),
                                name: entry.name
                            });
                        }
                    } catch { /* skip unreadable */ }
                }
            }
        } catch { /* skip inaccessible dir */ }
    };

    walkDir(assetsPath);
    return results;
}
```

**方案 B（unused 功能）：基于引用统计的简易实现**

```typescript
private async findUnusedAssets(excludeDirs: string[] = []): Promise<ToolResponse> {
    try {
        const projectPath = Editor.Project.path;
        const assetsPath = path.join(projectPath, 'assets');

        // 1. 收集所有资产的 UUID
        const allAssets = await Editor.Message.request('asset-db', 'query-assets', {
            pattern: 'db://assets/**/*'
        });

        // 2. 收集所有场景和预制体中引用的 UUID
        const referencedUuids = new Set<string>();
        const refFiles = allAssets.filter((a: any) =>
            a.url.endsWith('.scene') || a.url.endsWith('.prefab')
        );

        for (const file of refFiles) {
            const filePath = path.join(projectPath,
                file.url.replace('db://', '').replace(/\//g, path.sep));
            try {
                const content = fs.readFileSync(filePath, 'utf8');
                const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
                const matches = content.match(uuidRegex) || [];
                matches.forEach(uuid => referencedUuids.add(uuid));
            } catch { /* skip */ }
        }

        // 3. 找出未被引用的资产（排除目录和脚本）
        const unused = allAssets.filter((a: any) => {
            if (a.isDirectory) return false;
            if (a.url.endsWith('.ts') || a.url.endsWith('.js')) return false;
            if (a.url.endsWith('.scene')) return false;
            if (excludeDirs.some(d => a.url.startsWith(d))) return false;
            return !referencedUuids.has(a.uuid);
        }).map((a: any) => ({
            name: a.name,
            uuid: a.uuid,
            path: a.url,
            type: a.type
        }));

        return {
            success: true,
            data: {
                totalAssets: allAssets.length,
                unusedCount: unused.length,
                unused,
                note: 'Basic reference check only (scene/prefab). Script imports not analyzed.'
            }
        };
    } catch (err: any) {
        return { success: false, error: `Unused asset detection failed: ${err.message}` };
    }
}
```

### 影响文件

| 文件 | 修改 |
|------|------|
| `source/tools/v2/asset-tools.ts` | 实现 `getAssetDependencies()`、`findUnusedAssets()` 及辅助方法 |

---

## 缺陷 11：component_query 返回数据过于冗长

### 现象

查询一个 Sprite 组件会返回 **所有属性**，包括：
- `_` 前缀的私有属性（如 `_fillStart`、`_isTrimmedMode`）
- 系统属性（`_objFlags`、`_name`、`__scriptAsset`）
- 未本地化的 i18n key 作为 displayName
- 嵌套的类型元数据（extends、animatable 等）

一个节点两个组件就消耗大量 token，严重影响 AI 工具使用效率。

### 修复方案

在 `extractComponentProperties()` 中增加过滤，只返回 `visible: true` 的属性，并精简每个属性的元数据：

```typescript
private extractComponentProperties(comp: any): any {
    const properties: any = {};

    for (const [key, propData] of Object.entries(comp)) {
        // 跳过系统内部字段
        if (key.startsWith('_') || key === '__type__' || key === '__prefab') continue;

        const prop = propData as any;
        if (!prop || typeof prop !== 'object') continue;

        // 只保留 visible 属性（编辑器 Inspector 中可见的属性）
        if (prop.visible === false) continue;

        // 精简输出
        const simplified: any = {
            value: prop.value,
            type: prop.type,
        };

        // 仅在有意义时添加额外元数据
        if (prop.readonly) simplified.readonly = true;
        if (prop.enumList) simplified.enumList = prop.enumList;
        if (prop.min !== undefined) simplified.min = prop.min;
        if (prop.max !== undefined) simplified.max = prop.max;

        properties[key] = simplified;
    }

    return properties;
}
```

**预期效果**：

修改前（一个 Sprite 组件约 200+ 行 JSON）：
```json
{
  "_name": { "name": "_name", "value": "", "default": "", "type": "String", "readonly": false, "visible": false, ... },
  "_objFlags": { ... },
  "__scriptAsset": { ... },
  "color": { "name": "color", "value": {"r":255,"g":255,"b":255,"a":255}, "type": "cc.Color", "readonly": false, "visible": true, "animatable": true, "displayOrder": 1, "displayName": "i18n:ENGINE...", "tooltip": "i18n:ENGINE...", "extends": ["cc.ValueType"] },
  ...
}
```

修改后（约 30 行）：
```json
{
  "color": { "value": {"r":255,"g":255,"b":255,"a":255}, "type": "cc.Color" },
  "spriteFrame": { "value": {"uuid":""}, "type": "cc.SpriteFrame" },
  "type": { "value": 0, "type": "Enum", "enumList": [{"name":"SIMPLE","value":0}, ...] },
  "sizeMode": { "value": 1, "type": "Enum", "enumList": [...] },
  "trim": { "value": true, "type": "Boolean" },
  "grayscale": { "value": false, "type": "Boolean" }
}
```

### 影响文件

| 文件 | 修改 |
|------|------|
| `source/tools/v2/component-tools.ts` | 重写 `extractComponentProperties()` |

---

## 缺陷 12：debug_execute 引擎对象需手动 JSON.stringify

### 现象

用户必须知道引擎对象不可直接返回，需要自行手动构建可序列化的对象。

```javascript
// 不工作
debug_execute { script: "require('cc').director.getScene()" }

// 需要用户自己写
debug_execute { script: "JSON.stringify({name: require('cc').director.getScene().name})" }
```

### 当前状态

此问题已在 01 方案的缺陷 3 中覆盖（`safeSerialize` 自动处理序列化）。当 `safeSerialize` 实现后，此问题自动解决。

### 额外优化：工具描述改进

在 tool description 中增加提示，让 AI 知道返回值已自动序列化：

```typescript
{
    name: 'execute',
    description: 'Execute JavaScript code in scene context. Returns auto-serialized results. Engine objects (cc.Node, cc.Scene, etc.) are automatically converted to plain objects with common properties extracted. Use `require("cc")` to access engine APIs.',
    // ...
}
```

### 影响文件

| 文件 | 修改 |
|------|------|
| `source/scene.ts` | 见 01 方案缺陷 3 |
| `source/tools/v2/debug-tools.ts` | 更新 `execute` 工具的 description |

---

## 修复优先级与依赖关系

```
缺陷 11（query 精简） ← 无依赖，可独立修复
缺陷 12（execute 序列化） ← 依赖 01 方案缺陷 3
缺陷 9（dependencies） ← 无依赖，可独立修复
缺陷 10（unused） ← 可复用缺陷 9 的 UUID 搜索工具方法
```

建议修复顺序：11 → 12 → 9 → 10

---

## 完整影响文件汇总（三个文档合计）

| 文件 | 涉及缺陷 |
|------|---------|
| `source/tools/v2/component-tools.ts` | #1, #2, #11 |
| `source/tools/v2/node-tools.ts` | #4, #5 |
| `source/tools/v2/asset-tools.ts` | #6, #9, #10 |
| `source/tools/v2/prefab-tools.ts` | #7 |
| `source/tools/v2/project-tools.ts` | #8 |
| `source/tools/v2/debug-tools.ts` | #12 (description only) |
| `source/scene.ts` | #3 |
