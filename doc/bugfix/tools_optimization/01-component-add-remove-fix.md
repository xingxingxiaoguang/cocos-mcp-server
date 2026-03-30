# P0 修复：component_add / component_modify remove / debug_execute

> 本文档覆盖测试中发现的 3 个 P0 级问题，均导致核心工作流阻断。

---

## 缺陷 1：component_add 自定义脚本误报失败并留下残留组件

### 现象

```
component_add { uuid: "<node>", componentType: "MarioPlayer" }
→ { success: false, error: "Component 'MarioPlayer' was not found on node after addition.
   Available components: cc.UITransform, cc.Sprite, d0671ZrVN9Nvpo7fsYXTwtq" }
```

实际上组件 **已经添加成功**（以 cid `d0671ZrVN9Nvpo7fsYXTwtq` 形式存在），但验证判定失败。每次"失败"调用都在节点上留下一个残留组件，反复调用会堆积多个重复组件。

### 根因

`addComponent()` (component-tools.ts:372) 和 `attachScript()` (:431) 中的验证逻辑：

```typescript
// 第 396 行：用类名去匹配 __type__
const addedComponent = allComponentsInfo2.data.components.find(
    (comp: any) => comp.type === componentType  // "MarioPlayer"
);
```

而 `getComponents()` (:193) 解析组件类型时：

```typescript
type: comp.__type__ || comp.cid || comp.type || 'Unknown'
```

对于自定义脚本，`query-node` 返回的 `__type__` 是 **cid**（如 `d0671ZrVN9Nvpo7fsYXTwtq`）而非类名 `MarioPlayer`。因此 `find()` 永远匹配不到，验证必然失败。

同时，`create-component` API 在**调用前没有检查组件是否已存在**的精确逻辑（已有检查也用了同样有 bug 的匹配方式），导致重复添加。

### 修复方案

**Step 1：建立 cid ↔ 类名映射表**

`scene_components` 查询已经返回了 cid 和 name 的对应关系。在 add/remove 前先构建映射：

```typescript
// component-tools.ts 新增工具方法
private async buildCidNameMap(): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    try {
        const result = await Editor.Message.request(
            'scene', 'query-component-function-of-node', ''
        );
        if (Array.isArray(result)) {
            for (const comp of result) {
                if (comp.cid && comp.name) {
                    map.set(comp.cid, comp.name);
                    map.set(comp.name, comp.cid);
                }
            }
        }
    } catch { /* ignore */ }
    return map;
}
```

**Step 2：修改 getComponents 的类型解析**

```typescript
private async getComponents(nodeUuid: string): Promise<ToolResponse> {
    const cidMap = await this.buildCidNameMap();

    return new Promise((resolve) => {
        Editor.Message.request('scene', 'query-node', nodeUuid).then((nodeData: any) => {
            if (nodeData && nodeData.__comps__) {
                const components = nodeData.__comps__.map((comp: any) => {
                    const rawType = comp.__type__ || comp.cid || comp.type || 'Unknown';
                    // 将 cid 解析为可读类名
                    const resolvedType = cidMap.get(rawType) || rawType;
                    return {
                        type: resolvedType,
                        cid: rawType !== resolvedType ? rawType : undefined,
                        uuid: comp.uuid?.value || comp.uuid || null,
                        enabled: comp.enabled !== undefined ? comp.enabled : true,
                        properties: this.extractComponentProperties(comp)
                    };
                });
                resolve({ success: true, data: { nodeUuid, components } });
            } else {
                resolve({ success: false, error: 'Node not found or no components data' });
            }
        }).catch(/* ... existing fallback ... */);
    });
}
```

**Step 3：修改 addComponent 验证逻辑**

```typescript
private async addComponent(nodeUuid: string, componentType: string): Promise<ToolResponse> {
    // 获取添加前的组件快照
    const beforeInfo = await this.getComponents(nodeUuid);
    const beforeCount = beforeInfo.data?.components?.length || 0;

    // 检查是否已存在（用解析后的类名匹配）
    if (beforeInfo.success && beforeInfo.data?.components) {
        const existing = beforeInfo.data.components.find((comp: any) =>
            comp.type === componentType || comp.cid === componentType
        );
        if (existing) {
            return {
                success: true,
                message: `Component '${componentType}' already exists on node`,
                data: { nodeUuid, componentType, componentVerified: true, existing: true }
            };
        }
    }

    // 调用 create-component
    try {
        await Editor.Message.request('scene', 'create-component', {
            uuid: nodeUuid,
            component: componentType
        });
    } catch (err: any) {
        // create-component 失败则走 scene script fallback
        // ... existing fallback ...
    }

    await new Promise(resolve => setTimeout(resolve, 150));

    // 验证：对比添加前后的组件数量和类型
    const afterInfo = await this.getComponents(nodeUuid);
    const afterCount = afterInfo.data?.components?.length || 0;

    if (afterCount > beforeCount) {
        // 新增了组件，验证成功
        const newComp = afterInfo.data.components.find((comp: any) =>
            comp.type === componentType || comp.cid === componentType
        );
        return {
            success: true,
            message: `Component '${componentType}' added successfully`,
            data: {
                nodeUuid,
                componentType: newComp?.type || componentType,
                cid: newComp?.cid,
                componentVerified: true,
                existing: false
            }
        };
    }

    // 数量没变，真正失败
    return {
        success: false,
        error: `Failed to add component '${componentType}'. Component count unchanged.`
    };
}
```

**Step 4：attachScript 同步修改**

`attachScript()` 中的验证逻辑同样需要使用 cid 映射，改法与 Step 3 一致。

### 影响文件

| 文件 | 修改 |
|------|------|
| `source/tools/v2/component-tools.ts` | 新增 `buildCidNameMap()`，修改 `getComponents()`、`addComponent()`、`attachScript()` |

---

## 缺陷 2：component_modify remove 无法移除组件

### 现象

```
component_modify { uuid: "<node>", action: "remove", componentType: "cc.Sprite" }
→ { success: false, error: "Component cid 'cc.Sprite' was not removed from node" }
```

### 根因

`removeComponent()` (component-tools.ts:499) 调用了：

```typescript
Editor.Message.request('scene', 'remove-component', {
    uuid: nodeUuid,
    component: componentType  // "cc.Sprite"
});
```

问题有两个层面：

1. **API 参数格式错误**：Cocos Creator 3.8.x 的 `remove-component` 需要的是**组件在节点上的索引**或**组件实例 UUID**，而不是组件类型名。

2. **验证也有 bug**：与缺陷 1 同源，用类名匹配 cid 判定组件"仍然存在"。

### 修复方案

**改用组件索引定位**：

```typescript
private async removeComponent(nodeUuid: string, componentType: string): Promise<ToolResponse> {
    const allInfo = await this.getComponents(nodeUuid);
    if (!allInfo.success || !allInfo.data?.components) {
        return { success: false, error: `Failed to get components: ${allInfo.error}` };
    }

    // 查找目标组件的索引（使用解析后的类名和 cid 双重匹配）
    const components = allInfo.data.components;
    const targetIndex = components.findIndex((comp: any) =>
        comp.type === componentType || comp.cid === componentType
    );

    if (targetIndex < 0) {
        const available = components.map((c: any) => c.type).join(', ');
        return {
            success: false,
            error: `Component '${componentType}' not found on node. Available: ${available}`
        };
    }

    try {
        // 方案 A：使用 __comps__ 数组路径 + remove-array-element
        await Editor.Message.request('scene', 'remove-array-element', {
            uuid: nodeUuid,
            path: '__comps__',
            index: targetIndex
        });
    } catch (err: any) {
        // 方案 B fallback：通过 scene script 移除
        try {
            const result = await Editor.Message.request(
                'scene', 'execute-scene-script', {
                    name: 'cocos-mcp-server',
                    method: 'removeComponentFromNode',
                    args: [nodeUuid, componentType]
                }
            );
            if (result && result.success) {
                return result;
            }
        } catch { /* ignore */ }
        return { success: false, error: `Failed to remove component: ${err.message}` };
    }

    // 验证
    await new Promise(resolve => setTimeout(resolve, 100));
    const afterInfo = await this.getComponents(nodeUuid);
    const stillExists = afterInfo.data?.components?.some((comp: any) =>
        comp.type === componentType || comp.cid === componentType
    );

    if (stillExists) {
        return { success: false, error: `Component '${componentType}' still exists after removal attempt` };
    }

    return {
        success: true,
        message: `Component '${componentType}' removed successfully`,
        data: { nodeUuid, componentType, removedIndex: targetIndex }
    };
}
```

> **注意**：`remove-array-element` 的具体 API 名需在 3.8.3 中验证。若不存在，可改用 `scene script` 中已有的 `removeComponentFromNode` 方法作为主路径。

### 影响文件

| 文件 | 修改 |
|------|------|
| `source/tools/v2/component-tools.ts` | 重写 `removeComponent()` |

---

## 缺陷 3：debug_execute 返回引擎对象时序列化为空 `{}`

### 现象

```javascript
// 返回普通值 → 正常
debug_execute { script: "42" }         → { result: 42 }
debug_execute { script: "JSON.stringify({a:1})" } → { result: "{\"a\":1}" }

// 返回引擎对象 → 空
debug_execute { script: "const {director}=require('cc'); ({name: director.getScene().name})" }
→ { data: {} }
```

### 根因

`scene.ts` 的 `evalScript()` 方法中，`new Function()` 返回的引擎对象（如 `cc.Node`、`cc.Scene`）含有循环引用和不可序列化的内部属性。当 `execute-scene-script` 跨进程传递结果时，`JSON.stringify` 对这类对象的序列化结果为 `{}`。

### 修复方案

**在 scene.ts 的 evalScript 中自动序列化结果**：

```typescript
// scene.ts 修改 evalScript
evalScript(script: string) {
    try {
        const result = new Function('require', 'return ' + script)(require);
        return { success: true, data: { result: this.safeSerialize(result) } };
    } catch (e: any) {
        try {
            new Function('require', script)(require);
            return { success: true, data: { result: undefined } };
        } catch (e2: any) {
            return { success: false, error: e2.message };
        }
    }
},

/**
 * 安全序列化：将引擎对象转为可跨进程传递的普通对象
 */
safeSerialize(value: any, depth: number = 0): any {
    if (depth > 3) return '[max depth]';
    if (value === null || value === undefined) return value;

    const type = typeof value;
    if (type === 'number' || type === 'string' || type === 'boolean') return value;

    if (Array.isArray(value)) {
        return value.slice(0, 100).map((v: any) => this.safeSerialize(v, depth + 1));
    }

    if (type === 'object') {
        // 尝试 JSON 序列化，成功说明是普通对象
        try {
            const json = JSON.stringify(value);
            if (json !== '{}' && json !== '[]') {
                return JSON.parse(json);
            }
        } catch { /* 有循环引用，继续手动处理 */ }

        // 手动提取可读属性
        const result: any = {};
        const keys = Object.keys(value);
        // 如果没有可枚举 key，尝试常见引擎对象属性
        const tryKeys = keys.length > 0 ? keys :
            ['name', 'uuid', 'active', 'position', 'rotation', 'scale',
             'x', 'y', 'z', 'w', 'width', 'height', 'r', 'g', 'b', 'a',
             'children', 'components', 'parent'];

        for (const key of tryKeys.slice(0, 20)) {
            try {
                const v = value[key];
                if (v !== undefined && typeof v !== 'function') {
                    result[key] = this.safeSerialize(v, depth + 1);
                }
            } catch { /* skip inaccessible */ }
        }
        return Object.keys(result).length > 0 ? result : String(value);
    }

    return String(value);
}
```

### 影响文件

| 文件 | 修改 |
|------|------|
| `source/scene.ts` | 修改 `evalScript()`，新增 `safeSerialize()` |

---

## 验证用例

```bash
# 缺陷 1：自定义脚本添加成功且不残留
mcp: component_add { uuid: "<node>", componentType: "MarioPlayer" }
# 期望: { success: true, componentType: "MarioPlayer" }
# 重复调用: { success: true, existing: true }（不会重复添加）

# 缺陷 2：组件移除成功
mcp: component_modify { uuid: "<node>", action: "remove", componentType: "cc.Sprite" }
# 期望: { success: true }

# 缺陷 3：引擎对象可正确返回
mcp: debug_execute { script: "const {director}=require('cc'); const s=director.getScene(); ({name:s.name, children:s.children.length})" }
# 期望: { result: { name: "hello", children: 1 } }（非空对象）
```

---

## 修复优先级

| 缺陷 | 建议顺序 | 理由 |
|------|---------|------|
| 缺陷 1 (add) | 第一个修 | 阻断自定义脚本开发闭环，且 cid 映射是 2 的前置依赖 |
| 缺陷 2 (remove) | 第二个修 | 复用缺陷 1 的 cid 映射和改进后的 getComponents |
| 缺陷 3 (execute) | 第三个修 | 独立修改，不依赖上述改动 |
