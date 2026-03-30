# Debug Tools — 缺陷修复方案

> 本文档记录 `debug-tools.ts` 中 `inspect` 和 `logs` 工具的 4 个缺陷及其修复方案。这些缺陷均源于**调用了 Cocos Creator 3.8.x 中不存在的编辑器消息**或**未真正实现的功能桩代码**。

---

## 背景

通过逐一测试 debug 工具的所有 action，发现以下问题：

| 工具 | Action | 状态 | 错误信息 |
|------|--------|------|----------|
| `debug_inspect` | `node_tree` | **失败** | `Message does not exist: scene - query-hierarchy` |
| `debug_inspect` | `performance` | **降级** | catch 后返回 "not available in edit mode"，未获取实际数据 |
| `debug_inspect` | `validate` | **静默失败** | 内部 `query-hierarchy` 失败被吞掉，`checkPerformance` 永远不会报警 |
| `debug_logs` | `console` | **空数据** | `setupConsoleCapture()` 是桩代码，内存缓存永远为空 |

已正常工作的功能（无需修改）：
- `debug_inspect` → `editor_info`、`validate`（基础流程）
- `debug_logs` → `project`、`file_info`、`search`、`clear`
- `debug_execute` → 已在 05.5 中修复

---

## 缺陷 1：`inspect node_tree` 调用了不存在的 `query-hierarchy`

### 现象

```json
{"success": false, "error": "Message does not exist: scene - query-hierarchy"}
```

### 根因

`getNodeTree()` 方法（第 367 行）调用：

```typescript
Editor.Message.request('scene', 'query-hierarchy')
```

Cocos Creator 3.8.x 中**不存在**此消息。正确的消息是 `query-node-tree`，这在同项目的 `scene-tools.ts` 中已被正确使用（第 161 行）。

此外，`buildTree` 内部递归调用了 `Editor.Message.request('scene', 'query-node', nodeUuid)`，这个消息同样不存在于 3.8.x。

### 修复方案

**废弃逐节点递归查询方式**，改为一次性获取完整节点树后在内存中构建：

```typescript
private async getNodeTree(rootUuid?: string, maxDepth: number = 10): Promise<ToolResponse> {
    try {
        // 方案 A：使用 query-node-tree（与 scene-tools 一致）
        const tree = await Editor.Message.request('scene', 'query-node-tree');
        if (!tree) {
            return { success: false, error: 'No scene data available' };
        }

        const buildTree = (node: any, depth: number): any => {
            if (depth >= maxDepth) return { name: node.name, uuid: node.uuid, truncated: true };
            return {
                uuid: node.uuid,
                name: node.name,
                active: node.active,
                type: node.type,
                components: node.__comps__
                    ? node.__comps__.map((c: any) => c.__type__ || 'Unknown')
                    : [],
                childCount: node.children ? node.children.length : 0,
                children: (node.children || []).map((child: any) => buildTree(child, depth + 1))
            };
        };

        // 如果指定了 rootUuid，在树中查找该节点作为根
        if (rootUuid) {
            const findNode = (node: any): any => {
                if (node.uuid === rootUuid) return node;
                for (const child of (node.children || [])) {
                    const found = findNode(child);
                    if (found) return found;
                }
                return null;
            };
            const targetNode = findNode(tree);
            if (!targetNode) {
                return { success: false, error: `Node ${rootUuid} not found in scene` };
            }
            return { success: true, data: buildTree(targetNode, 0) };
        }

        return { success: true, data: buildTree(tree, 0) };
    } catch (err: any) {
        // 方案 B fallback：通过 scene script 获取
        try {
            const result = await Editor.Message.request('scene', 'execute-scene-script', {
                name: 'cocos-mcp-server',
                method: 'getSceneHierarchy',
                args: [true]  // includeComponents = true
            });
            if (result && result.success) {
                return { success: true, data: result.data };
            }
            return { success: false, error: `query-node-tree failed: ${err.message}` };
        } catch (err2: any) {
            return { success: false, error: `Direct API failed: ${err.message}, Scene script failed: ${err2.message}` };
        }
    }
}
```

**核心变更点：**
- `query-hierarchy` → `query-node-tree`
- 删除逐节点 `query-node` 递归，改为一次获取完整树后内存遍历
- 增加 scene script fallback（复用已有的 `getSceneHierarchy`）

---

## 缺陷 2：`inspect performance` 无法获取真实性能数据

### 现象

```json
{"success": true, "data": {"message": "Performance stats not available in edit mode"}}
```

### 根因

`getPerformanceStats()` 调用了 `Editor.Message.request('scene', 'query-performance')`，该消息在 3.8.x 中不存在。catch 后返回了 fallback 信息，但没有提供任何有用数据。

### 修复方案

通过 scene script 从场景进程中获取真实的节点/组件统计数据。

**Step 1：在 `scene.ts` 中新增 `getPerformanceStats` 方法**

```typescript
// scene.ts 新增
getPerformanceStats() {
    try {
        const { director } = require('cc');
        const scene = director.getScene();
        if (!scene) {
            return { success: false, error: 'No active scene' };
        }

        let nodeCount = 0;
        let componentCount = 0;
        let activeNodeCount = 0;

        const traverse = (node: any) => {
            nodeCount++;
            if (node.active) activeNodeCount++;
            componentCount += node.components ? node.components.length : 0;
            for (const child of node.children) {
                traverse(child);
            }
        };

        for (const child of scene.children) {
            traverse(child);
        }

        return {
            success: true,
            data: {
                nodeCount,
                activeNodeCount,
                componentCount,
                // drawCalls/triangles 在编辑模式下不可用，诚实标注
                drawCalls: null,
                triangles: null,
                memory: process.memoryUsage ? process.memoryUsage() : null,
                note: 'drawCalls and triangles are only available at runtime (preview/build)'
            }
        };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}
```

**Step 2：`package.json` 注册方法**

在 `contributions.scene.methods` 中新增 `getPerformanceStats`。

**Step 3：修改 `getPerformanceStats()` 实现**

```typescript
private async getPerformanceStats(): Promise<ToolResponse> {
    try {
        const result = await Editor.Message.request('scene', 'execute-scene-script', {
            name: 'cocos-mcp-server',
            method: 'getPerformanceStats',
            args: []
        });
        if (result && result.success) {
            return result;
        }
        return { success: false, error: result?.error || 'Failed to get performance stats from scene process' };
    } catch (err: any) {
        // 最终 fallback：返回主进程可获取的信息
        return {
            success: true,
            data: {
                nodeCount: null,
                componentCount: null,
                drawCalls: null,
                triangles: null,
                memory: process.memoryUsage(),
                note: 'Scene process unavailable, only main process memory data shown'
            }
        };
    }
}
```

---

## 缺陷 3：`inspect validate` 的 `checkPerformance` 静默失败

### 现象

`validate` 返回 `{ valid: true, issueCount: 0 }` 即使场景节点数超过阈值，因为 `checkPerformance` 内部的 `query-hierarchy` 静默失败被吞掉。

### 根因

`validateScene()` 第 423 行：

```typescript
const hierarchy = await Editor.Message.request('scene', 'query-hierarchy');
const nodeCount = this.countNodes(hierarchy.children);
```

同缺陷 1，`query-hierarchy` 不存在，catch 后直接忽略。

### 修复方案

复用缺陷 2 中新增的 `getPerformanceStats` scene script，直接获取 nodeCount：

```typescript
if (options.checkPerformance !== false) {
    try {
        const perfResult = await Editor.Message.request('scene', 'execute-scene-script', {
            name: 'cocos-mcp-server',
            method: 'getPerformanceStats',
            args: []
        });
        if (perfResult && perfResult.success && perfResult.data) {
            const nodeCount = perfResult.data.nodeCount;
            if (nodeCount > 1000) {
                issues.push({
                    type: 'warning',
                    category: 'performance',
                    message: `High node count: ${nodeCount} nodes (recommended < 1000)`,
                    suggestion: 'Consider using object pooling or scene optimization'
                });
            }
            if (perfResult.data.componentCount > 5000) {
                issues.push({
                    type: 'warning',
                    category: 'performance',
                    message: `High component count: ${perfResult.data.componentCount} components`,
                    suggestion: 'Review if all components are necessary'
                });
            }
        }
    } catch {
        // Scene script unavailable, skip performance check
    }
}
```

**额外改进：** 增加了 componentCount 阈值检查，提供更完整的性能校验。

---

## 缺陷 4：`logs console` 内存缓存始终为空

### 现象

```json
{"success": true, "data": {"total": 0, "returned": 0, "logs": []}}
```

### 根因

`setupConsoleCapture()` 是桩代码：

```typescript
private setupConsoleCapture(): void {
    console.log('Console capture setup - implementation depends on Editor API availability');
}
```

没有任何实际的 console 消息捕获逻辑，`consoleMessages` 数组永远为空。

### 修复方案

使用 `Editor.Message.addBroadcastListener` 监听编辑器的 console 广播消息：

```typescript
private setupConsoleCapture(): void {
    try {
        // 监听编辑器 console 广播
        const listener = (message: any) => {
            this.addConsoleMessage({
                type: message.type || 'log',
                content: message.message || message.content || String(message),
                source: 'editor'
            });
        };

        // Cocos Creator 3.8.x 的 console 广播消息
        Editor.Message.addBroadcastListener('console:log', listener);
        Editor.Message.addBroadcastListener('console:warn', listener);
        Editor.Message.addBroadcastListener('console:error', listener);

        console.log('[DebugToolsV2] Console capture initialized');
    } catch (err) {
        console.warn('[DebugToolsV2] Console capture setup failed, falling back to project log file');
    }
}
```

**同时添加 `dispose` 方法**，在插件卸载时清理监听器：

```typescript
dispose(): void {
    // 清理广播监听
    try {
        Editor.Message.removeBroadcastListener('console:log');
        Editor.Message.removeBroadcastListener('console:warn');
        Editor.Message.removeBroadcastListener('console:error');
    } catch {
        // ignore
    }
    this.consoleMessages = [];
}
```

> **注意：** `Editor.Message.addBroadcastListener` 的具体 console 事件名需在实际 3.8.3 编辑器中验证。如果 console 广播不可用，备选方案是 monkey-patch `console.log/warn/error`，但这会影响主进程中的所有 console 输出，副作用较大，建议作为最终 fallback。

### Fallback 方案：如果广播 API 不可用

改为增强 `getConsoleLogs`，当内存缓存为空时自动回退到读取 project.log：

```typescript
private async getConsoleLogs(limit: number = 100, filter: string = 'all'): Promise<ToolResponse> {
    let logs = this.consoleMessages;
    if (filter && filter !== 'all') {
        logs = logs.filter(log => log.type === filter);
    }
    const recentLogs = logs.slice(-limit);

    // 如果内存缓存为空，自动回退到 project.log
    if (recentLogs.length === 0) {
        const projectLogs = await this.getProjectLogs(limit, undefined, filter === 'all' ? 'ALL' : filter);
        if (projectLogs.success && projectLogs.data) {
            return {
                success: true,
                data: {
                    total: projectLogs.data.filteredLines,
                    returned: projectLogs.data.filteredLines,
                    logs: projectLogs.data.logs,
                    source: 'project_log_fallback',
                    note: 'Console capture not available, showing project log instead'
                }
            };
        }
    }

    return {
        success: true,
        data: { total: logs.length, returned: recentLogs.length, logs: recentLogs }
    };
}
```

---

## 影响的文件清单

| 文件 | 修改类型 |
|------|---------|
| `source/tools/v2/debug-tools.ts` | 重写 `getNodeTree`、`getPerformanceStats`、`validateScene`、`setupConsoleCapture`、`getConsoleLogs`；新增 `dispose` |
| `source/scene.ts` | 新增 `getPerformanceStats` 方法 |
| `package.json` | `contributions.scene.methods` 中新增 `getPerformanceStats` |

---

## 验证用例

修复完成后，以下调用应全部成功：

```bash
# 1. node_tree 返回完整场景树
mcp: debug_inspect { "action": "node_tree" }
# 期望: { success: true, data: { uuid: "...", name: "hello", children: [...] } }

# 2. node_tree 指定根节点
mcp: debug_inspect { "action": "node_tree", "uuid": "<canvasUuid>", "depth": 2 }
# 期望: { success: true, data: { uuid: "<canvasUuid>", name: "Canvas", children: [...] } }

# 3. performance 返回真实统计
mcp: debug_inspect { "action": "performance" }
# 期望: { success: true, data: { nodeCount: N, componentCount: M, activeNodeCount: K, ... } }

# 4. validate checkPerformance 能正常报警
# （在节点数 > 1000 的场景中测试）
mcp: debug_inspect { "action": "validate", "checkPerformance": true }
# 期望: issues 中包含 performance warning

# 5. console logs 不再返回空
mcp: debug_logs { "action": "console", "limit": 10 }
# 期望: 返回日志数据（来自广播捕获或 project.log fallback）
```

---

## 优先级建议

| 缺陷 | 优先级 | 理由 |
|------|--------|------|
| 缺陷 1（node_tree） | P0 | 工具完全不可用，且修复方案简单明确 |
| 缺陷 2（performance） | P1 | 降级运行但无有用数据，需要新增 scene script |
| 缺陷 3（validate） | P1 | 可随缺陷 2 一并修复，复用同一个 scene script |
| 缺陷 4（console） | P2 | 需要验证编辑器广播 API，有 fallback 方案兜底 |
