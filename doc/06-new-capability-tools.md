# Step 6: 新增能力工具 — script_file / animation_clip / material_property

> 前置依赖：Step 5 完成
> 预计改动量：中
> 目标：新增 3 个工具，补齐 Cocos Creator 开发的关键能力缺口，工具总数从 31 增至 34

---

## 1. 为什么需要这些工具

当前工具集能操作场景节点和组件，但无法：
- 读写脚本文件内容 → AI 无法编写游戏逻辑
- 创建/编辑动画 → AI 无法制作动画效果
- 查看/修改材质属性 → AI 无法调整视觉表现

这三个工具补齐了"从场景搭建到逻辑编写"的完整流程。

---

## 2. 新工具详细设计

### 2.1 `script_file` — 脚本文件读写

```typescript
// 文件: source/tools/v2/script-file-tools.ts
// 类名: ScriptFileToolsV2
// category key: scriptFile
// MCP 工具名: scriptFile_file

name: 'file'
inputSchema: {
    type: 'object',
    properties: {
        action: {
            type: 'string',
            enum: ['read', 'write', 'create', 'list'],
            description: '操作类型'
        },
        path: {
            type: 'string',
            description: '脚本路径，必须以 db://assets/ 开头。如 db://assets/scripts/PlayerController.ts'
        },
        content: {
            type: 'string',
            description: 'action=write 时的文件内容'
        },
        className: {
            type: 'string',
            description: 'action=create 时的类名，用于生成 @ccclass 模板'
        },
        folder: {
            type: 'string',
            description: 'action=list 时的目录路径，如 db://assets/scripts/'
        }
    },
    required: ['action']
}
```

#### action 实现细节

**`read`**:
```
1. 校验 path 以 db://assets/ 开头
2. 将 db://assets/xxx.ts 转换为本地绝对路径:
   localPath = path.join(Editor.Project.path, 'assets', relativePath)
3. 检查文件大小 ≤ 1MB
4. fs.readFileSync(localPath, 'utf-8') 返回内容
```

**`write`**:
```
1. 校验 path 以 db://assets/ 开头
2. 路径转换同上
3. 检查内容大小 ≤ 500KB
4. fs.writeFileSync(localPath, content, 'utf-8')
5. Editor.Message.request('asset-db', 'refresh-asset', dbUrl) 刷新资源数据库
6. 返回 { success: true, path, size: content.length }
```

**`create`**:
```
1. 校验 path 以 db://assets/ 开头，以 .ts 结尾
2. 生成 Cocos Creator 标准组件脚本模板:

import { _decorator, Component, Node } from 'cc';
const { ccclass, property } = _decorator;

@ccclass('{className}')
export class {className} extends Component {
    start() {

    }

    update(deltaTime: number) {

    }
}

3. 写入文件 + 刷新资源数据库
4. 返回 { success: true, path, className }
```

**`list`**:
```
1. Editor.Message.request('asset-db', 'query-assets') 过滤 *.ts 文件
2. 如果有 folder 参数，进一步过滤路径前缀
3. 返回 { success: true, scripts: [{ path, name, size }] }
```

#### 安全约束

| 约束 | 实现方式 |
|------|---------|
| 路径限制 | `path` 必须以 `db://assets/` 开头，否则返回错误 |
| 路径遍历防护 | 转换后的绝对路径必须在 `Editor.Project.path/assets/` 下（防止 `../` 攻击） |
| 读取大小限制 | 文件 > 1MB 时返回错误 |
| 写入大小限制 | content > 500KB 时返回错误 |

---

### 2.2 `animation_clip` — 动画剪辑操作

```typescript
// 文件: source/tools/v2/animation-tools.ts
// 类名: AnimationToolsV2
// category key: animation
// MCP 工具名: animation_clip

name: 'clip'
inputSchema: {
    type: 'object',
    properties: {
        action: {
            type: 'string',
            enum: ['create', 'get_info', 'list'],
            description: '操作类型。注意: add_track 和 set_keyframe 暂不实现，作为后续迭代'
        },
        // create 参数
        name: { type: 'string', description: 'action=create 时的动画名称' },
        savePath: { type: 'string', description: 'action=create 时的保存路径' },
        duration: { type: 'number', description: '动画时长（秒），默认 1.0' },
        sample: { type: 'number', description: '采样帧率，默认 60' },
        // get_info 参数
        path: { type: 'string', description: 'action=get_info 时的 .anim 文件路径' }
    },
    required: ['action']
}
```

#### action 实现细节

**`create`**:
```
1. 生成 Cocos Creator AnimationClip 的最小 JSON 结构:
   {
     "__type__": "cc.AnimationClip",
     "_name": "{name}",
     "_duration": {duration},
     "sample": {sample},
     "_tracks": [],
     "_exoticAnimation": null
   }
   注意: 实际 JSON 结构需要在 Cocos Creator 中创建示例 .anim 文件后确认
2. 通过 asset-db 创建 .anim 文件
3. 返回 { success: true, path, name, duration, sample }
```

**`get_info`**:
```
1. 将 db:// 路径转换为本地路径
2. fs.readFileSync() 读取 .anim 文件
3. JSON.parse() 解析
4. 提取并返回: name, duration, sample, tracks 数量, 各轨道类型
```

**`list`**:
```
1. Editor.Message.request('asset-db', 'query-assets') 过滤 *.anim 文件
2. 返回 { success: true, animations: [{ path, name }] }
```

#### 已知限制

- Cocos Creator 3.8 的 AnimationClip JSON 格式包含序列化的类型标记（`__type__`），结构较复杂
- `create` action 生成的 JSON 模板需要在 Cocos Creator 中手动创建一个示例 .anim 文件后，分析其实际 JSON 结构再确定
- `add_track` 和 `set_keyframe` 暂不实现，作为后续迭代目标

---

### 2.3 `material_property` — 材质属性操作

```typescript
// 文件: source/tools/v2/material-tools.ts
// 类名: MaterialToolsV2
// category key: material
// MCP 工具名: material_property

name: 'property'
inputSchema: {
    type: 'object',
    properties: {
        action: {
            type: 'string',
            enum: ['get_info', 'set_property', 'set_texture'],
            description: '操作类型。注意: set_property 和 set_texture 需确认 API 路径后实现'
        },
        uuid: { type: 'string', description: '材质资源 UUID' },
        path: { type: 'string', description: '材质文件路径' },
        // set_property 参数
        propertyName: { type: 'string', description: 'action=set_property 时的属性名' },
        value: { description: 'action=set_property 时的属性值' },
        // set_texture 参数
        textureUuid: { type: 'string', description: 'action=set_texture 时的纹理 UUID' },
        texturePath: { type: 'string', description: 'action=set_texture 时的纹理路径' }
    },
    required: ['action']
}
```

#### action 实现细节

**`get_info`**（优先实现）:
```
1. 通过 uuid 或 path 查询材质资源
2. 读取 .mtl 文件的 JSON 内容
3. 解析并返回:
   - effectName: 使用的 effect 名称
   - technique: 当前 technique
   - passes: pass 列表
   - properties: uniform 属性列表（名称、类型、当前值）
```

**`set_property`**（需确认 API 后实现）:
```
方案 A: 通过 set-property 设置 MeshRenderer 组件的材质属性链
  路径格式: __comps__.{index}.sharedMaterials.{matIndex}.{propertyName}

方案 B: 直接修改 .mtl 文件的 JSON 内容中的 _props 字段
  1. 读取 .mtl JSON
  2. 修改 _props 中对应属性
  3. 写回文件
  4. 刷新资源数据库
```

**`set_texture`**（需确认 API 后实现）:
```
1. 获取纹理资源的 UUID
2. 通过 set-property 设置材质的纹理属性
```

#### 已知限制

- `set-property` 对材质属性链的支持深度需要在 Cocos Creator 中实际测试确认
- 不同 Cocos Creator 版本的 .mtl 文件格式可能有差异
- 建议先实现 `get_info`，`set_property` 和 `set_texture` 在确认路径格式后再实现

---

## 3. 实现要点

### 3.1 文件结构

```
source/tools/v2/
  ├── ... (Step 2/3/4 已创建的文件)
  ├── script-file-tools.ts    → ScriptFileToolsV2
  ├── animation-tools.ts      → AnimationToolsV2
  └── material-tools.ts       → MaterialToolsV2
```

### 3.2 注册到 mcp-server.ts

在 `initializeTools()` 中添加：
```typescript
this.tools.scriptFile = new ScriptFileToolsV2();
this.tools.animation = new AnimationToolsV2();
this.tools.material = new MaterialToolsV2();
```

同步更新 `tool-manager.ts` 的 `initializeAvailableTools()`。

### 3.3 建议的实现顺序

1. `script_file` — 最简单，纯文件读写 + 模板生成，无复杂 API 依赖
2. `animation_clip` — 需要先在 Cocos Creator 中创建示例 .anim 分析 JSON 结构
3. `material_property` — 需要确认 set-property 的材质路径格式

每个工具独立实现和测试，一个工具的失败不影响其他工具。

### 3.4 db:// 路径转本地路径的通用工具函数

`script_file` 和 `animation_clip` 都需要将 `db://assets/xxx` 转换为本地绝对路径。建议在 `source/tools/v2/` 下创建一个 `utils.ts` 提供此函数：

```typescript
export function dbPathToLocal(dbPath: string): string {
    if (!dbPath.startsWith('db://assets/')) {
        throw new Error('路径必须以 db://assets/ 开头');
    }
    const relativePath = dbPath.replace('db://assets/', '');
    const localPath = path.join(Editor.Project.path, 'assets', relativePath);

    // 防止路径遍历
    const assetsDir = path.join(Editor.Project.path, 'assets');
    if (!path.resolve(localPath).startsWith(path.resolve(assetsDir))) {
        throw new Error('路径不允许访问 assets 目录之外的文件');
    }

    return localPath;
}
```

---

## 4. 验证标准

### L1: 编译验证
```bash
npm run build
```

### L2: 接口验证
```bash
# 检查工具总数 = 34
curl -s http://127.0.0.1:8585/health

# 确认新工具已注册
curl -s -X POST http://127.0.0.1:8585/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' \
  | python3 -c "
import sys, json
tools = json.load(sys.stdin)['result']['tools']
new_tools = ['scriptFile_file', 'animation_clip', 'material_property']
for nt in new_tools:
    found = any(t['name'] == nt for t in tools)
    print(f'{nt}: {\"OK\" if found else \"MISSING\"}')"
```

### L3: 功能验证

| 用例 | 操作 | 预期 |
|------|------|------|
| SF-1 | `script_file` action=create, path="db://assets/scripts/TestComp.ts", className="TestComp" | 生成包含 @ccclass('TestComp') 的标准脚本 |
| SF-2 | `script_file` action=read, path="db://assets/scripts/TestComp.ts" | 返回脚本文件内容 |
| SF-3 | `script_file` action=write, path=同上, content=<修改后内容> | 文件更新，资源数据库刷新 |
| SF-4 | `script_file` action=list, folder="db://assets/scripts/" | 返回该目录下所有 .ts 文件 |
| SF-5 | `script_file` action=read, path="/etc/passwd" | 返回错误: 路径必须以 db://assets/ 开头 |
| SF-6 | `script_file` action=read, path="db://assets/../../etc/passwd" | 返回错误: 路径遍历被阻止 |
| AN-1 | `animation_clip` action=create, name="walk", duration=1.0 | 生成 .anim 文件 |
| AN-2 | `animation_clip` action=get_info, path=<AN-1的路径> | 返回动画时长、帧率等信息 |
| AN-3 | `animation_clip` action=list | 返回项目中所有 .anim 文件 |
| MT-1 | `material_property` action=get_info, uuid=<材质UUID> | 返回材质的 effect、technique、uniform 列表 |

### 回归验证
- Step 5 的全部回归项（S-1, N-1, C-1, P-1, A-1）

### 完成标记
- [ ] `source/tools/v2/script-file-tools.ts` 已创建
- [ ] `source/tools/v2/animation-tools.ts` 已创建
- [ ] `source/tools/v2/material-tools.ts` 已创建
- [ ] `source/tools/v2/utils.ts` 已创建（路径转换 + 安全校验）
- [ ] `script_file` 的 read/write/create/list 四个 action 可用
- [ ] `animation_clip` 的 create/get_info/list 三个 action 可用
- [ ] `material_property` 的 get_info action 可用
- [ ] 安全约束测试通过（SF-5, SF-6）
- [ ] 工具总数 = 34
- [ ] `npm run build` 编译通过
- [ ] 创建 git tag `tool-opt/step-6`
