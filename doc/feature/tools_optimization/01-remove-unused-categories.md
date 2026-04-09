# Step 1: 删除无价值工具类别

> 前置依赖：无
> 预计改动量：小
> 目标：删除 5 个对 AI 无价值的工具类别，工具数从 157 降至 111

---

## 1. 背景

以下 5 个类别共 46 个工具对 AI 无使用价值：

| 类别 | 文件 | 工具数 | 删除理由 |
|------|------|--------|----------|
| sceneView_* | `source/tools/scene-view-tools.ts` | 20 | Gizmo/视口是人类视觉操作，AI 无法感知视口画面 |
| referenceImage_* | `source/tools/reference-image-tools.ts` | 12 | 参考图是人类视觉辅助功能，AI 无法查看 |
| server_* | `source/tools/server-tools.ts` | 6 | 查询编辑器内置预览服务器的 IP/端口，与游戏开发无关 |
| broadcast_* | `source/tools/broadcast-tools.ts` | 5 | 编辑器内部消息总线监控，AI 无使用场景 |
| validation_* | `source/tools/validation-tools.ts` | 3 | JSON 校验和字符串转义，AI 自身能力已覆盖 |

这些工具与其他工具无调用依赖关系，删除风险极低。

---

## 2. 改动清单

### 2.1 删除文件（5 个）

```
source/tools/scene-view-tools.ts
source/tools/reference-image-tools.ts
source/tools/server-tools.ts
source/tools/broadcast-tools.ts
source/tools/validation-tools.ts
```

### 2.2 修改 `source/mcp-server.ts`

删除对应的 import 语句（第 12-18 行区域）：
```typescript
// 删除以下 5 行
import { ServerTools } from './tools/server-tools';
import { BroadcastTools } from './tools/broadcast-tools';
import { SceneViewTools } from './tools/scene-view-tools';
import { ReferenceImageTools } from './tools/reference-image-tools';
import { ValidationTools } from './tools/validation-tools';
```

删除 `initializeTools()` 中对应的 5 行实例化代码（第 43-49 行区域）：
```typescript
// 删除以下 5 行
this.tools.server = new ServerTools();
this.tools.broadcast = new BroadcastTools();
this.tools.sceneView = new SceneViewTools();
this.tools.referenceImage = new ReferenceImageTools();
this.tools.validation = new ValidationTools();
```

### 2.3 修改 `source/tools/tool-manager.ts`

`initializeAvailableTools()` 方法中删除对应的 5 个 `require()` 和实例化代码（第 88-98 行区域和第 109-115 行区域）：

```typescript
// 删除以下 require
const { ServerTools } = require('./server-tools');
const { BroadcastTools } = require('./broadcast-tools');
const { SceneViewTools } = require('./scene-view-tools');
const { ReferenceImageTools } = require('./reference-image-tools');
const { ValidationTools } = require('./validation-tools');

// 删除以下实例化
server: new ServerTools(),
broadcast: new BroadcastTools(),
sceneView: new SceneViewTools(),
referenceImage: new ReferenceImageTools(),
validation: new ValidationTools()
```

同时删除 `initializeDefaultTools()` 中对应的 5 个后备类别定义（第 187-220 行区域）：
```typescript
// 删除 category: 'server' 整个对象
// 删除 category: 'broadcast' 整个对象
// 删除 category: 'sceneView' 整个对象
// 删除 category: 'referenceImage' 整个对象
// 删除 category: 'validation' 整个对象
```

---

## 3. 不需要改动的文件

- `source/panels/default/index.ts` — 面板通过 IPC 动态获取工具列表，无需改动
- `source/types/index.ts` — 类型定义不涉及具体工具类别
- `source/cocos-entry.ts` — 场景脚本不涉及这些工具
- `source/main.ts` — 主进程不直接引用这些工具类（通过 MCPServer 间接使用）

---

## 4. 验证标准

### L1: 编译验证
```bash
npm run build
# 预期：零 TS 编译错误
```

### L2: 接口验证
```bash
# 检查工具总数 = 111
curl -s http://127.0.0.1:8585/health | python3 -c "import sys,json; print(json.load(sys.stdin)['tools'])"

# 确认无已删除类别的工具
curl -s -X POST http://127.0.0.1:8585/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' \
  | python3 -c "
import sys, json
tools = json.load(sys.stdin)['result']['tools']
deleted = ['sceneView_', 'referenceImage_', 'server_', 'broadcast_', 'validation_']
for t in tools:
    for d in deleted:
        if t['name'].startswith(d):
            print(f'ERROR: found deleted tool {t[\"name\"]}')
            sys.exit(1)
print(f'OK: {len(tools)} tools, no deleted categories found')
"
```

### 完成标记
- [ ] 5 个文件已删除
- [ ] `mcp-server.ts` 编译通过，无残留引用
- [ ] `tool-manager.ts` 编译通过，无残留引用
- [ ] 工具总数 = 111
- [ ] 创建 git tag `tool-opt/step-1`
