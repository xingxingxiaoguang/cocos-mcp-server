# Step 5: 切换路由层 + 删除旧文件

> 前置依赖：Step 2/3/4 全部完成
> 预计改动量：中
> 目标：将 MCP 服务器从旧工具切换到 v2 工具，删除旧文件

---

## 1. 背景

Step 2/3/4 在 `source/tools/v2/` 目录下创建了所有新工具文件，但 MCP 服务器仍然使用旧工具。本 Step 执行切换。

这是不可逆操作点。执行前必须确认所有 v2 工具编译通过。

---

## 2. 改动清单

### 2.1 修改 `source/mcp-server.ts`

#### 2.1.1 替换 import 语句

删除所有旧 import：
```typescript
// 删除以下所有行
import { SceneTools } from './tools/scene-tools';
import { NodeTools } from './tools/node-tools';
import { ComponentTools } from './tools/component-tools';
import { PrefabTools } from './tools/prefab-tools';
import { ProjectTools } from './tools/project-tools';
import { DebugTools } from './tools/debug-tools';
import { PreferencesTools } from './tools/preferences-tools';
import { SceneAdvancedTools } from './tools/scene-advanced-tools';
import { AssetAdvancedTools } from './tools/asset-advanced-tools';
```

替换为 v2 import：
```typescript
import { SceneToolsV2 } from './tools/v2/scene-tools';
import { NodeToolsV2 } from './tools/v2/node-tools';
import { ComponentToolsV2 } from './tools/v2/component-tools';
import { PrefabToolsV2 } from './tools/v2/prefab-tools';
import { AssetToolsV2 } from './tools/v2/asset-tools';
import { DebugToolsV2 } from './tools/v2/debug-tools';
import { ProjectToolsV2 } from './tools/v2/project-tools';
import { PreferencesToolsV2 } from './tools/v2/preferences-tools';
import { UndoToolsV2 } from './tools/v2/undo-tools';
import { SceneScriptToolsV2 } from './tools/v2/scene-script-tools';
import { ArrayPropertyToolsV2 } from './tools/v2/array-property-tools';
```

#### 2.1.2 替换 `initializeTools()` 方法

```typescript
private initializeTools(): void {
    try {
        console.log('[MCPServer] Initializing v2 tools...');
        this.tools.scene = new SceneToolsV2();
        this.tools.node = new NodeToolsV2();
        this.tools.component = new ComponentToolsV2();
        this.tools.prefab = new PrefabToolsV2();
        this.tools.asset = new AssetToolsV2();
        this.tools.debug = new DebugToolsV2();
        this.tools.project = new ProjectToolsV2();
        this.tools.preferences = new PreferencesToolsV2();
        this.tools.undo = new UndoToolsV2();
        this.tools.sceneScript = new SceneScriptToolsV2();
        this.tools.array = new ArrayPropertyToolsV2();
        console.log('[MCPServer] V2 tools initialized successfully');
    } catch (error) {
        console.error('[MCPServer] Error initializing v2 tools:', error);
        throw error;
    }
}
```

#### 2.1.3 工具名映射（关键）

旧路由通过 `_` 拆分 category 和 toolName。新工具的 category key 和工具名组合后的 MCP 工具名如下：

| MCP 工具名 | category key | tool.name |
|-----------|-------------|-----------|
| `scene_query` | scene | query |
| `scene_open` | scene | open |
| `scene_save` | scene | save |
| `scene_create` | scene | create |
| `scene_manage` | scene | manage |
| `node_query` | node | query |
| `node_create` | node | create |
| `node_modify` | node | modify |
| `node_delete` | node | delete |
| `node_arrange` | node | arrange |
| `component_query` | component | query |
| `component_add` | component | add |
| `component_modify` | component | modify |
| `prefab_query` | prefab | query |
| `prefab_create` | prefab | create |
| `prefab_update` | prefab | update |
| `asset_query` | asset | query |
| `asset_create` | asset | create |
| `asset_modify` | asset | modify |
| `asset_delete` | asset | delete |
| `asset_refresh` | asset | refresh |
| `debug_logs` | debug | logs |
| `debug_execute` | debug | execute |
| `debug_inspect` | debug | inspect |
| `project_query` | project | query |
| `project_build` | project | build |
| `preferences_query` | preferences | query |
| `preferences_modify` | preferences | modify |
| `undo_recording` | undo | recording |
| `sceneScript_execute` | sceneScript | execute |
| `array_property` | array | property |

现有的 `executeToolCall()` 路由逻辑（按第一个 `_` 拆分）对大部分工具仍然有效。但需要注意 `sceneScript_execute` 的拆分结果是 `category=sceneScript, toolName=execute`，这是正确的。

### 2.2 修改 `source/tools/tool-manager.ts`

#### 2.2.1 替换 `initializeAvailableTools()` 中的 require 和实例化

```typescript
private initializeAvailableTools(): void {
    try {
        const { SceneToolsV2 } = require('./v2/scene-tools');
        const { NodeToolsV2 } = require('./v2/node-tools');
        const { ComponentToolsV2 } = require('./v2/component-tools');
        const { PrefabToolsV2 } = require('./v2/prefab-tools');
        const { AssetToolsV2 } = require('./v2/asset-tools');
        const { DebugToolsV2 } = require('./v2/debug-tools');
        const { ProjectToolsV2 } = require('./v2/project-tools');
        const { PreferencesToolsV2 } = require('./v2/preferences-tools');
        const { UndoToolsV2 } = require('./v2/undo-tools');
        const { SceneScriptToolsV2 } = require('./v2/scene-script-tools');
        const { ArrayPropertyToolsV2 } = require('./v2/array-property-tools');

        const tools = {
            scene: new SceneToolsV2(),
            node: new NodeToolsV2(),
            component: new ComponentToolsV2(),
            prefab: new PrefabToolsV2(),
            asset: new AssetToolsV2(),
            debug: new DebugToolsV2(),
            project: new ProjectToolsV2(),
            preferences: new PreferencesToolsV2(),
            undo: new UndoToolsV2(),
            sceneScript: new SceneScriptToolsV2(),
            array: new ArrayPropertyToolsV2()
        };
        // ... 后续遍历逻辑不变
    }
}
```

#### 2.2.2 更新 `initializeDefaultTools()` 后备列表

将后备列表更新为新的 11 个类别和对应工具名。

### 2.3 删除旧文件

确认编译通过且功能验证完成后，删除以下文件：

```
source/tools/scene-tools.ts
source/tools/node-tools.ts
source/tools/component-tools.ts
source/tools/prefab-tools.ts
source/tools/project-tools.ts
source/tools/debug-tools.ts
source/tools/preferences-tools.ts
source/tools/scene-advanced-tools.ts
source/tools/asset-advanced-tools.ts
```

注意：Step 1 已删除的 5 个文件不在此列表中。

### 2.4 处理 `node-tools.ts` 对 `component-tools.ts` 的依赖

旧 `node-tools.ts` 第 2 行有 `import { ComponentTools } from './component-tools'`，第 5 行有 `private componentTools = new ComponentTools()`。

检查新 `NodeToolsV2` 是否仍需要此依赖。如果 `node_create` 的 `components` 参数需要调用组件添加逻辑，则改为引用 `ComponentToolsV2`。

---

## 3. 切换策略

为降低风险，建议分两步执行：

### Phase A: 切换路由（不删旧文件）
1. 修改 `mcp-server.ts` 和 `tool-manager.ts` 指向 v2
2. `npm run build` 编译通过
3. 在 Cocos Creator 中重载扩展
4. 执行 L2 + L3 验证

### Phase B: 删除旧文件
1. 确认 Phase A 验证全部通过
2. 删除 9 个旧文件
3. `npm run build` 确认无残留引用
4. 创建 git tag

---

## 4. 验证标准

### L1: 编译验证
```bash
npm run build
# 预期：零 TS 编译错误
```

### L2: 接口验证
```bash
# 检查工具总数 = 31（不含 Step 6 的 1 个新工具）
curl -s http://127.0.0.1:8585/health

# 检查工具名列表，确认全部为新格式
curl -s -X POST http://127.0.0.1:8585/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' \
  | python3 -c "
import sys, json
tools = json.load(sys.stdin)['result']['tools']
expected = {
    'scene_query', 'scene_open', 'scene_save', 'scene_create', 'scene_manage',
    'node_query', 'node_create', 'node_modify', 'node_delete', 'node_arrange',
    'component_query', 'component_add', 'component_modify',
    'prefab_query', 'prefab_create', 'prefab_update',
    'asset_query', 'asset_create', 'asset_modify', 'asset_delete', 'asset_refresh',
    'debug_logs', 'debug_execute', 'debug_inspect',
    'project_query', 'project_build',
    'preferences_query', 'preferences_modify',
    'undo_recording', 'sceneScript_execute', 'array_property'
}
actual = {t['name'] for t in tools}
missing = expected - actual
extra = actual - expected
if missing: print(f'MISSING: {missing}')
if extra: print(f'EXTRA: {extra}')
if not missing and not extra: print(f'OK: {len(tools)} tools match expected set')
"
```

### L3: 功能验证

执行 Step 2/3/4 中定义的所有 L3 测试用例（S-1~S-8, N-1~N-10, C-1~C-6, P-1~P-5, A-1~A-7）。

### 完成标记
- [ ] `mcp-server.ts` 已切换到 v2 工具
- [ ] `tool-manager.ts` 已切换到 v2 工具
- [ ] 工具总数 = 31
- [ ] 所有 L3 测试用例通过
- [ ] 9 个旧文件已删除
- [ ] `npm run build` 编译通过
- [ ] 创建 git tag `tool-opt/step-5`
