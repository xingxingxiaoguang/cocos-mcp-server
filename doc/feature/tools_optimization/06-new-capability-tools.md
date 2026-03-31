# Step 6: 新增能力工具 — animation_clip

> 前置依赖：Step 5 完成
> 预计改动量：中
> 目标：新增 1 个工具，补齐动画剪辑编辑能力缺口，工具总数从 31 增至 32

---

## 1. 设计结论

Step 6 只保留一个新增工具：
- `animation_clip`：补齐动画剪辑查询、创建、轨道编辑、关键帧编辑能力

Step 6 收敛为单一动画能力，原因如下：
- 当前插件仅服务于本次本地 Cocos Creator 编辑会话时，非动画类能力缺口并不构成阻塞
- 动画编辑仍然是现有工具集中的明显空白
- 将 Step 6 聚焦为单一能力，可以显著提高需求确定性和落地效率

---

## 2. 总体实现策略

### 2.1 主实现路径

- 不以“手写 `.anim` JSON”作为主实现路径
- 主路径改为：通过 `scene` 进程中的场景脚本封装 Cocos Creator 动画编辑 API
- 查询类操作优先使用编辑器可获取的 clip dump
- 写操作通过编辑器 API 修改 clip，再由编辑器持久化资源

### 2.2 为什么放弃 `.anim` JSON 方案

- Cocos Creator 3.8 的动画资源序列化格式复杂，稳定性依赖引擎版本
- 轨道、关键帧、插值、切线、辅助曲线等信息由编辑器内部结构管理，直接拼 JSON 风险高
- 通过编辑器动画 API 操作，更符合“可编辑、可验证、可维护”的目标

---

## 3. 工具详细设计

### 3.1 `animation_clip` — 动画剪辑操作

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
            enum: [
                'list',
                'create',
                'get_info',
                'list_editable_properties',
                'add_track',
                'remove_track',
                'create_key',
                'set_keyframe',
                'remove_key',
                'query_value_at_frame'
            ],
            description: '动画剪辑操作类型'
        },
        uuid: { type: 'string', description: '动画剪辑资源 UUID' },
        path: { type: 'string', description: '动画剪辑 db:// 路径' },
        nodeUuid: { type: 'string', description: '挂载动画组件的根节点 UUID。编辑类 action 必填' },
        clipUuid: { type: 'string', description: '动画剪辑 UUID。编辑类 action 优先使用' },
        name: { type: 'string', description: 'action=create 时的动画名称' },
        savePath: { type: 'string', description: 'action=create 时的保存路径，如 db://assets/anim/walk.anim' },
        duration: { type: 'number', description: '动画时长（秒），默认 1.0' },
        sample: { type: 'number', description: '采样帧率，默认 60' },
        nodePath: { type: 'string', description: '动画目标节点路径，如 Canvas/Player' },
        propKey: { type: 'string', description: '属性标识，使用编辑器 dump 中返回的 propKey' },
        frame: { type: 'number', description: '关键帧位置，单位为帧' },
        frames: { type: 'array', items: { type: 'number' }, description: '批量关键帧位置' },
        value: { description: '关键帧值' },
        curve: {
            type: 'object',
            description: '关键帧曲线参数，如 interpMode / inTangent / outTangent / easingMethod'
        }
    },
    required: ['action']
}
```

#### 核心原则

- 所有编辑类 action 都通过 `scene` 进程中的插件场景脚本完成
- 不直接要求 MCP 层理解 `.anim` 的底层 JSON 结构
- `nodePath` + `propKey` 以编辑器 dump 返回值为准，不在 MCP 层自行推导复杂属性路径

#### action 实现细节

**`list`**:
```
1. Editor.Message.request('asset-db', 'query-assets', { pattern: 'db://assets/**/*.anim' })
2. 返回 { animations: [{ uuid, path, name, type, size }] }
```

**`create`**:
```
1. 校验 savePath 以 db://assets/ 开头，以 .anim 结尾
2. 在 scene.ts 中新增 createAnimationClip(scene method)
3. scene method 内使用 cc.AnimationClip 构造空 clip，设置 name / duration / sample
4. 通过 asset-db create-asset / save-asset 持久化
5. 返回 { clipUuid, path, name, duration, sample, trackCount: 0 }
```

**`get_info`**:
```
1. 通过 uuid / path 解析 clipUuid
2. 调用 scene method: getAnimationClipInfo(nodeUuid, clipUuid)
3. scene method 内调用编辑器动画查询接口，获取 clip dump
4. 返回:
   - clip 基本信息：name / duration / sample / speed / wrapMode
   - curves: [{ nodePath, propKey, keyframeCount, type, displayName }]
   - events / auxiliaryCurves 摘要
```

**`list_editable_properties`**:
```
1. 调用 scene method: listAnimationEditableProperties(nodeUuid, clipUuid)
2. 返回当前动画根节点下可创建轨道的属性列表
3. 返回值必须包含 nodePath / propKey / displayName / type
```

**`add_track`**:
```
1. 调用 scene method: addAnimationTrack(nodeUuid, clipUuid, nodePath, propKey)
2. 场景脚本内部通过编辑器动画 API 创建属性轨道
3. 返回最新 clip 摘要与该轨道信息
```

**`remove_track`**:
```
1. 调用 scene method: removeAnimationTrack(nodeUuid, clipUuid, nodePath, propKey)
2. 返回最新 clip 摘要
```

**`create_key`**:
```
1. 调用 scene method: createAnimationKey(nodeUuid, clipUuid, nodePath, propKey, frame, value)
2. value 通过 customData/newValue 传入
3. 返回该轨道最新关键帧信息
```

**`set_keyframe`**:
```
1. 若 frame 位置不存在关键帧，先 create_key
2. 调用 scene method: setAnimationKeyframe(nodeUuid, clipUuid, nodePath, propKey, frame, value, curve)
3. 场景脚本内部更新关键帧值，并调用 modifyCurveOfKey 设置插值/切线等曲线参数
4. 返回 { frame, value, curve, verifiedValueAtFrame }
```

**`remove_key`**:
```
1. 调用 scene method: removeAnimationKey(nodeUuid, clipUuid, nodePath, propKey, frames)
2. 返回该轨道剩余关键帧数量
```

**`query_value_at_frame`**:
```
1. 调用 scene method: queryAnimationValueAtFrame(nodeUuid, clipUuid, nodePath, propKey, frame)
2. 返回该轨道在指定帧的求值结果
```

#### 推荐的 scene.ts 新增场景脚本方法

在 `package.json` 的 `contributions.scene.methods` 中注册：

```typescript
createAnimationClip
getAnimationClipInfo
listAnimationEditableProperties
addAnimationTrack
removeAnimationTrack
createAnimationKey
setAnimationKeyframe
removeAnimationKey
queryAnimationValueAtFrame
```

这些方法统一由 `animation_clip` 调用，不直接暴露给 MCP。

#### scene.ts 内部推荐实现路径

优先使用编辑器动画接口封装：
- 查询 clip dump
- 查询可编辑属性
- 创建属性轨道
- 创建关键帧
- 修改关键帧曲线
- 查询某帧属性值

如果少量接口无法直接访问，再在 `scene.ts` 内部退回到：
- `cc.AnimationClip`
- `animation.TrackPath`
- `animation.RealTrack` / `VectorTrack` / `QuatTrack` / `ColorTrack` / `ObjectTrack`
- `RealCurve.assignSorted()` / `addKeyFrame()`

但这类退回应封装在场景脚本内部，不能暴露为 MCP 层直接拼装 `.anim` JSON。

#### 已知限制

- 编辑类 action 依赖节点上存在可编辑的动画上下文，不能只拿一个孤立 `.anim` 文件路径就完成全部编辑
- 外部导入的骨骼动画、部分只读动画资源，不保证支持轨道级编辑
- `propKey` 的稳定来源应是 `list_editable_properties` 或 `get_info` 的返回值，不建议由模型自行猜测
- 不同属性类型对应不同轨道类型，`scene.ts` 需要做统一的类型分发与错误提示

---

## 4. 实现要点

### 4.1 文件结构

```
source/tools/v2/
  ├── ... (Step 2/3/4 已创建的文件)
  └── animation-tools.ts      → AnimationToolsV2
```

### 4.2 注册到 mcp-server.ts

在 `initializeTools()` 中添加：

```typescript
this.tools.animation = new AnimationToolsV2();
```

同步更新 `tool-manager.ts` 的 `initializeAvailableTools()`。

### 4.3 package.json 与 scene.ts 改动

除新增 v2 工具文件外，还需要：
- 在 `package.json` 的 `contributions.scene.methods` 中注册动画相关方法
- 在 `source/scene.ts` 中实现这些方法
- 所有动画编辑逻辑统一收口到 `scene.ts`

### 4.4 建议实现顺序

1. `animation_clip` 的 `list` / `create` / `get_info`
2. `animation_clip` 的 `list_editable_properties` / `add_track`
3. `animation_clip` 的 `create_key` / `set_keyframe` / `remove_key` / `query_value_at_frame`

---

## 5. 验证标准

### L1: 编译验证

```bash
npm run build
```

### L2: 接口验证

```bash
# 检查工具总数 = 32
curl -s http://127.0.0.1:8585/health

# 确认新工具已注册
curl -s -X POST http://127.0.0.1:8585/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' \
  | python3 -c "
import sys, json
tools = json.load(sys.stdin)['result']['tools']
new_tools = ['animation_clip']
for nt in new_tools:
    found = any(t['name'] == nt for t in tools)
    print(f'{nt}: {\"OK\" if found else \"MISSING\"}')"
```

### L3: 功能验证

| 用例 | 操作 | 预期 |
|------|------|------|
| AN-1 | `animation_clip` action=create, savePath="db://assets/anim/walk.anim", name="walk" | 生成空动画剪辑 |
| AN-2 | `animation_clip` action=get_info, clipUuid=<AN-1结果>, nodeUuid=<动画根节点> | 返回 clip 基本信息与曲线摘要 |
| AN-3 | `animation_clip` action=list | 返回项目中所有 .anim 文件 |
| AN-4 | `animation_clip` action=list_editable_properties, nodeUuid=<动画根节点>, clipUuid=<clipUuid> | 返回可编辑属性列表 |
| AN-5 | `animation_clip` action=add_track, nodeUuid=<动画根节点>, clipUuid=<clipUuid>, nodePath="Canvas/Player", propKey=<positionPropKey> | 成功创建轨道 |
| AN-6 | `animation_clip` action=create_key, ... frame=0, value={x:0,y:0,z:0} | 成功创建关键帧 |
| AN-7 | `animation_clip` action=set_keyframe, ... frame=30, value={x:100,y:0,z:0} | 成功设置关键帧值 |
| AN-8 | `animation_clip` action=query_value_at_frame, ... frame=15 | 返回插值结果 |
| AN-9 | `animation_clip` action=remove_key, ... frames=[30] | 成功删除关键帧 |

### 回归验证

- Step 5 的全部回归项（S-1, N-1, C-1, P-1, A-1）
- `debug_execute` 与新增动画 scene methods 不冲突

---

## 6. 完成标记

- [ ] `source/tools/v2/animation-tools.ts` 已创建
- [ ] `package.json` 已注册动画相关 scene methods
- [ ] `source/scene.ts` 已实现动画相关 scene methods
- [ ] `animation_clip` 的 `list` / `create` / `get_info` 可用
- [ ] `animation_clip` 的 `list_editable_properties` / `add_track` / `remove_track` 可用
- [ ] `animation_clip` 的 `create_key` / `set_keyframe` / `remove_key` / `query_value_at_frame` 可用
- [ ] 工具总数 = 32
- [ ] `npm run build` 编译通过
- [ ] 创建 git tag `tool-opt/step-6`
