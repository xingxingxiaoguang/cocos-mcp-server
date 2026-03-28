# Scene Process Bridge — 缺陷修复需求

> 本文档记录在实际 AI 辅助开发（马里奥 Demo）过程中发现的 5 个工具缺陷，均源于**主进程与场景进程通信桥梁不完整**。修复这些问题后，AI 可完成"从脚本编写到场景搭建"的完整闭环。

---

## 背景

在使用 AI 通过 MCP 工具自动构建马里奥 Demo 游戏的过程中，以下工具出现了阻断性或误导性错误，导致任务无法完成。复盘后归纳为 5 个独立缺陷，本文档作为修复需求的完整描述。

---

## 缺陷 1：`component_add` 无法挂载自定义脚本组件

### 现象

```
Component 'MarioGameManager' was not found on node after addition.
Available components: cc.UITransform, 1e9beM9IUZBIYDEVzZc/9BE
```

即使 `component_query has_script` 已确认脚本存在，`component_add` 仍然失败，且每次重试都会在节点上留下一个 uuid 形式的残留组件。

### 根因

`component_add` 工具通过编辑器 API `Editor.Message.request('scene', 'create-component', ...)` 添加组件。该 API 在脚本类尚未在场景进程中完成注册时，会静默失败并留下垃圾组件，没有任何有效的错误信息返回给调用方。

### 修复方案

**Step 1：添加前置验证**

在执行 `create-component` 之前，先通过场景进程验证脚本类是否已注册：

```typescript
// 在 scene.ts 中新增辅助方法
isClassRegistered(className: string): boolean {
    const { js } = require('cc');
    return !!js.getClassByName(className);
}
```

**Step 2：改用 `js.getClassByName` 路径挂载**

对自定义脚本组件，改走场景进程直接挂载路径，而非编辑器 API：

```typescript
addComponentToNode(nodeUuid: string, componentType: string) {
    const { director, js } = require('cc');
    const scene = director.getScene();
    const node = scene.getChildByUuid(nodeUuid);  // 需递归查找，见缺陷2

    // 优先尝试 js 注册表（自定义脚本）
    const Cls = js.getClassByName(componentType);
    if (Cls) {
        const comp = node.addComponent(Cls);
        return { success: true, data: { uuid: comp.uuid } };
    }
    // fallback 到编辑器 API（内置组件如 cc.Sprite）
    // ...
}
```

**Step 3：清理残留组件**

失败时自动移除本次调用中错误添加的组件，不留垃圾数据。

**Step 4：返回明确错误**

```json
{
  "success": false,
  "error": "Script class 'MarioGameManager' is not registered in scene process. The script may still be compiling — retry in 1-2 seconds."
}
```

---

## 缺陷 2：`scene.ts` 的 `getChildByUuid` 只搜索顶层子节点

### 现象

`addComponentToNode`、`setNodeProperty` 等依赖 `scene.getChildByUuid(uuid)` 的方法，对非顶层节点（如 Canvas 的子节点）返回 `null`，导致操作失败。

### 根因

`scene.getChildByUuid()` 只搜索 Scene 的**直接子节点**，不递归。但 Cocos Creator 场景结构通常至少有 2 层（Scene → Canvas → 各节点）。

### 修复方案

在 `scene.ts` 中提取通用的递归查找工具函数，所有方法统一使用：

```typescript
function findNodeByUuid(root: any, uuid: string): any {
    if (root.uuid === uuid) return root;
    for (const child of root.children) {
        const found = findNodeByUuid(child, uuid);
        if (found) return found;
    }
    return null;
}

// 用法（替换所有 scene.getChildByUuid 调用）
const node = findNodeByUuid(scene, nodeUuid);
if (!node) return { success: false, error: `Node ${nodeUuid} not found` };
```

> **影响范围：** `scene.ts` 中所有使用 `scene.getChildByUuid()` 的方法均需更新，包括 `addComponentToNode`、`removeComponentFromNode`、`getNodeInfo`、`setNodeProperty`、`setComponentProperty`。

---

## 缺陷 3：`debug_execute` 依赖不存在的内置场景脚本

### 现象

```
Scenario scripts do not exist: console
```

`debug_execute` 工具完全不可用。

### 根因

`DebugToolsV2.handleExecute()` 硬编码调用：

```typescript
Editor.Message.request('scene', 'execute-scene-script', {
    name: 'console',   // ← 不存在的场景脚本名
    method: 'eval',
    args: [args.script]
})
```

Cocos Creator 3.8.x 中不存在名为 `console` 的内置场景脚本，这是一个错误的假设。

### 修复方案

在 `scene.ts` 中新增 `evalScript` 方法，并在 `package.json` 注册，让 `debug_execute` 调用插件自身的场景脚本：

```typescript
// scene.ts 新增
evalScript(script: string) {
    try {
        const result = new Function('require', 'return ' + script)(require);
        return { success: true, data: { result } };
    } catch (e: any) {
        // 尝试 void 表达式（语句而非表达式）
        try {
            new Function('require', script)(require);
            return { success: true, data: { result: undefined } };
        } catch (e2: any) {
            return { success: false, error: e2.message };
        }
    }
}
```

```typescript
// DebugToolsV2.handleExecute 改为
Editor.Message.request('scene', 'execute-scene-script', {
    name: 'cocos-mcp-server',  // 使用插件自身的场景脚本
    method: 'evalScript',
    args: [args.script]
})
```

同时在 `package.json` 的 `contributions.scene.methods` 中注册 `evalScript`。

---

## 缺陷 4：`sceneScript_execute` 对未注册方法静默成功

### 现象

调用一个未在 `package.json` 的 `contributions.scene.methods` 中注册的方法时，返回：

```json
{"success": true}
```

没有任何错误提示，AI 无法判断方法是否真正执行。

### 根因

Cocos Creator 的 `execute-scene-script` 对未注册方法静默忽略并返回 `undefined`，`SceneScriptToolsV2` 将 `undefined` 直接包装为 `{success: true, data: undefined}`，丢失了错误信息。

### 修复方案

**方案 A：结果校验**

约定场景脚本方法必须返回带 `success` 字段的对象，若 result 为 `undefined` 或不含 `success`，则判定为方法未找到：

```typescript
.then((result: any) => {
    if (result === undefined || result === null) {
        resolve({ success: false, error: `Method '${method}' not found or returned nothing. Check that it is registered in package.json contributions.scene.methods.` });
        return;
    }
    resolve({ success: true, data: result });
})
```

**方案 B（配合）：注册校验**

在 `SceneScriptToolsV2` 中维护一份已知的已注册方法列表，调用前先校验：

```typescript
private readonly registeredMethods = new Set([
    'createNewScene', 'addComponentToNode', /* ... */, 'evalScript'
]);

private async executeSceneScript(name: string, method: string, args: any[]) {
    if (name === 'cocos-mcp-server' && !this.registeredMethods.has(method)) {
        return { success: false, error: `Method '${method}' is not registered. Available: ${[...this.registeredMethods].join(', ')}` };
    }
    // ...
}
```

---

## 缺陷 5：`component_query classes` 跨进程隔离导致始终返回空

### 现象

```json
{"classes": [], "count": 0}
```

无论项目中有多少自定义脚本，`component_query classes` 始终返回空列表。

### 根因

该工具在**主进程**中尝试枚举组件类，而用户脚本是在**场景进程**中加载和注册的。两个进程相互隔离，主进程无法直接访问场景进程中 `js.getClassByName` 注册的类。

同样的问题也导致 `component_query has_script` 的结果不可信：它检查的是脚本文件是否存在（主进程文件系统），而不是类是否在场景进程中完成注册。

### 修复方案

在 `scene.ts` 中新增 `getRegisteredClasses` 方法，委托给场景进程执行：

```typescript
// scene.ts 新增
getRegisteredClasses(extendsFilter?: string) {
    const { js, Component } = require('cc');
    const FilterClass = extendsFilter ? js.getClassByName(extendsFilter) : null;
    const allClasses: string[] = [];

    // cc.js 内部维护了一个类注册表
    const classMap = (js as any)._nameToClass || {};
    for (const name of Object.keys(classMap)) {
        const cls = classMap[name];
        if (!FilterClass || (cls.prototype instanceof FilterClass)) {
            allClasses.push(name);
        }
    }
    return { success: true, data: { classes: allClasses, count: allClasses.length } };
}
```

`component_query has_script` 改为调用此方法而非检查文件系统：

```typescript
// 改为通过场景进程验证
Editor.Message.request('scene', 'execute-scene-script', {
    name: 'cocos-mcp-server',
    method: 'getRegisteredClasses',
    args: [undefined]
}).then(result => {
    const found = result.data.classes.includes(scriptPath);
    resolve({ success: true, data: { hasScript: found } });
})
```

---

## 影响的文件清单

| 文件 | 修改类型 |
|------|---------|
| `source/scene.ts` | 新增 `evalScript`、`getRegisteredClasses`、`findNodeByUuid` 工具函数；修复所有方法中的递归查找；修复 `addComponentToNode` |
| `package.json` | `contributions.scene.methods` 中新增 `evalScript`、`getRegisteredClasses` |
| `source/tools/v2/debug-tools.ts` | `handleExecute` 改用 `cocos-mcp-server.evalScript` |
| `source/tools/v2/scene-script-tools.ts` | `executeSceneScript` 增加 undefined 结果校验 |
| `source/tools/v2/component-tools.ts` | `has_script` 改为通过场景进程验证 |

---

## 验证用例

修复完成后，以下调用序列应全部成功：

```bash
# 1. debug_execute 可正常执行代码
mcp: debug_execute { "script": "1 + 1" }
# 期望: { success: true, data: { result: 2 } }

# 2. component_query classes 返回项目自定义脚本
mcp: component_query { "action": "classes", "extends": "Component" }
# 期望: { classes: ["MarioPlayer", "MarioEnemy", ...], count: N }

# 3. component_query has_script 与 component_add 结果一致
mcp: component_query { "action": "has_script", "scriptPath": "MarioPlayer" }
# 期望: { hasScript: true }
mcp: component_add { "uuid": "<nodeUuid>", "componentType": "MarioPlayer" }
# 期望: { success: true }

# 4. sceneScript_execute 调用不存在方法时明确报错
mcp: sceneScript_execute { "action": "scene_script", "name": "cocos-mcp-server", "method": "nonExistent" }
# 期望: { success: false, error: "Method 'nonExistent' not found..." }
```

---

## 优先级建议

| 缺陷 | 优先级 | 理由 |
|------|--------|------|
| 缺陷 2（递归查找） | P0 | 影响几乎所有 scene.ts 方法的可靠性 |
| 缺陷 3（debug_execute） | P0 | 工具完全不可用 |
| 缺陷 1（component_add） | P1 | 阻断自定义脚本挂载的核心流程 |
| 缺陷 4（静默成功） | P1 | 误导 AI 判断，导致难以调试 |
| 缺陷 5（classes 跨进程） | P2 | 影响自省能力，但有 workaround |

建议在 Step 6（新增能力工具）之前先完成 P0/P1 修复，作为 **Step 5.5** 插入现有开发计划。
