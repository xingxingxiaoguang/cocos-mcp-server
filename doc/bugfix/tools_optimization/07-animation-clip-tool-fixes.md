# P0-P2 修复：animation_clip 工具全套问题

> 本文档覆盖 `animation_clip` 工具测试（AN-1 ~ AN-9）中发现的所有问题。
> 文档按问题发现顺序排列，涵盖已修复和未修复的问题。
> **阅读者请注意**：本文档描述的是修复前的原始状态，用于指导新的修复会话进行优雅的代码修复。当前代码中可能已包含临时性的修复，但这些修复需要被重构为更健壮的实现。

---

## 缺陷 1：Scene 消息名称与 Cocos Creator 3.8.8 编辑器不匹配

**优先级：P0（阻断）**
**状态：已临时修复，需要正式验证和防御性编码**

### 现象

调用动画相关方法时报错：

```
Message does not exist: scene - query-animation-clip-dump
Message does not exist: scene - change-animation-root-node
Message does not exist: scene - set-edit-clip
Message does not exist: scene - apply-animation-operation
Message does not exist: scene - query-animation-prop-value-at-frame
```

所有依赖 scene facade 消息的动画功能完全不可用。

### 根因

`source/scene.ts` 中硬编码的 scene 消息名称与 Cocos Creator 3.8.8 编辑器实际注册的消息不一致。编辑器的 scene 消息名称没有公开文档，代码中的名称是基于猜测或旧版 API 写的。

错误映射关系：

| scene.ts 中使用（错误） | 编辑器实际注册（正确） | 出现位置 |
|---|---|---|
| `query-animation-clip-dump` | `query-animation-clip` | 5 处 |
| `change-animation-root-node` | `change-animation-root` | 1 处 |
| `set-edit-clip` | `change-edit-clip` | 1 处 |
| `apply-animation-operation` | `animation-operation` | 1 处 |
| `query-animation-prop-value-at-frame` | `query-property-value-at-frame` | 2 处 |

### 编辑器消息名称的正确来源

编辑器的 scene 消息注册在 `app.asar` 中：

```
/Applications/Cocos/Creator/3.8.8/CocosCreator.app/Contents/Resources/app.asar
  → builtin/scene/package.json
    → contributions.messages（包含所有 scene 消息的声明）
```

提取方式：
```bash
# 解压 app.asar（需要 @electron/asar 工具）
npx asar extract /path/to/app.asar /tmp/cocos-app
# 查看消息注册
cat /tmp/cocos-app/builtin/scene/package.json | jq '.contributions.messages | keys'
```

### 修复指导

1. **验证当前消息名称**：在 `scene.ts` 中搜索所有 `requestSceneFacade` 调用，确认每个消息名称与编辑器一致

2. **建立消息名称常量表**：将所有 scene 消息名称提取为常量集中管理，避免散落在代码各处

   ```typescript
   // 建议在 scene.ts 顶部定义
   const SCENE_MSG = {
       QUERY_ANIM_CLIP: 'query-animation-clip',
       CHANGE_ANIM_ROOT: 'change-animation-root',
       RECORD_ANIM: 'record-animation',
       CHANGE_EDIT_CLIP: 'change-edit-clip',
       ANIM_OPERATION: 'animation-operation',
       SAVE_CLIP: 'save-clip',
       QUERY_ANIM_PROPERTIES: 'query-animation-properties',
       QUERY_PROP_VALUE_AT_FRAME: 'query-property-value-at-frame',
       // ... 其他消息
   } as const;
   ```

3. **跨版本兼容**：如果需要支持多个 Cocos Creator 版本，考虑在插件初始化时探测消息是否存在，或在 `package.json` 中声明最低版本要求

---

## 缺陷 2：animation-operation 依赖编辑器动画录制模式（架构限制）

**优先级：P0（功能阻断）**
**状态：已通过引擎 API 回退机制绕过，但回退实现需要加固**

### 现象

修复消息名称后，调用 `animation-operation` 报错：

```
current edit clip: 'xxx' but you want to operate: 'yyy'
```

### 根因

`animation-operation` 是 Cocos Creator 编辑器的动画编辑器专用消息。它要求：

1. 用户在编辑器中手动打开动画编辑面板
2. 选中包含 Animation 组件的节点
3. 编辑器进入动画录制模式（`record-animation`）
4. 指定当前编辑的 clip（`change-edit-clip`）

即使 `scene.ts` 中的 `prepareAnimationEditContext()` 按顺序调用了 `change-animation-root` → `record-animation` → `change-edit-clip`，编辑器仍然不会真正进入动画编辑状态。这是因为录制模式涉及编辑器 UI 层面的状态切换，仅通过消息无法触发。

### 当前回退方案

`scene.ts` 中已实现双路径策略：

```
方法调用 → 先尝试 editor API (animation-operation)
         → 失败 → 回退到 engine API (直接操作 AnimationClip 对象)
```

受影响的方法（6 个）：
- `addAnimationTrack`
- `removeAnimationTrack`
- `createAnimationKey`
- `setAnimationKeyframe`
- `removeAnimationKey`
- `queryAnimationValueAtFrame`

### 回退方案中的问题

当前回退实现有以下需要加固的地方（详见缺陷 3、4、5）：

1. **TrackPath 内部结构访问方式不正确**（缺陷 3）
2. **RealCurve 关键帧数据读取方式不正确**（缺陷 4）
3. **clip 持久化不可靠**（缺陷 5）

### 修复指导

引擎 API 回退是正确的方向，但需要：

1. 将引擎 API 操作封装为独立函数，与 editor API 路径解耦
2. 当前代码中 editor API 先尝试 → 失败 → 引擎 API 回退的 try/catch 结构在多处重复，应抽象为统一的高阶函数或策略模式
3. 考虑提供配置项让用户选择优先使用哪种路径

---

## 缺陷 3：引擎 API 回退中 TrackPath 内部结构访问错误

**优先级：P1（回退路径功能失败）**
**状态：已在当前代码中修复，但实现需要重构**

### 现象

引擎 API 回退路径中 `findTrackInClip` 始终返回 null，无法匹配到已添加的轨道。

### 根因

`findTrackInClip` 函数对 TrackPath 内部结构的假设错误：

```typescript
// 错误假设：内部字段是 _path，元素是对象 { property: "xxx", hierarchy: "xxx" }
const pathData = (p as any)._path || p;
if (Array.isArray(pathData)) {
    const lastSeg = pathData[pathData.length - 1];
    if (lastSeg && lastSeg.property === propKey) { ... }
}
```

实际结构（通过运行时探查确认）：

```javascript
track.path._paths  // 字段名是 _paths（复数），不是 _path
// 值是纯字符串数组：
// 根节点 position → ["position"]
// 子节点 position → ["ChildName", "position"]
// 嵌套子节点     → ["Parent", "Child", "position"]
```

验证脚本：

```javascript
// 通过 sceneScript_execute evalScript 执行
var result; const { assetManager } = require('cc');
const clip = assetManager.assets.get('<clipUuid>');
const t = clip.tracks[0];
result = JSON.stringify(t.path._paths);
// 结果: '["position"]'
```

### 当前修复

已修改为使用 `_paths` 和字符串数组匹配：

```typescript
const pathSegs: string[] = (p as any)._paths;
if (!Array.isArray(pathSegs)) continue;
const targetSegs: string[] = [];
if (nodePath && nodePath.length > 0) {
    targetSegs.push(...nodePath.split('/').filter(s => s.length > 0));
}
targetSegs.push(propKey);
if (pathSegs.length === targetSegs.length && pathSegs.every(...)) return t;
```

### 修复指导

1. 当前修复依赖内部属性 `_paths`，这在引擎版本升级时可能变化。考虑：
   - 添加防御性检查：同时尝试 `_paths` 和其他可能的字段名
   - 如果 `_paths` 不存在，尝试 `track.path.toString()` 或其他公开方法

2. `buildTrackPath` 函数也需要验证 —— 确认通过 `animation.TrackPath().toProperty()` 构建的路径在 `_paths` 中存储的格式与通过 `findTrackInClip` 匹配的格式一致

---

## 缺陷 4：引擎 API 回退中 RealCurve 关键帧数据读取错误

**优先级：P1（回退路径功能失败）**
**状态：已在当前代码中修复，但实现需要重构**

### 现象

`collectKeyframeTimes` 和 `evaluateCurveAtTime` 通过 `curve.keyframes` 读取关键帧，始终得到空结果，尽管 `addKeyFrame` 返回了有效索引。

### 根因

Cocos 引擎 `RealCurve` 的数据存储结构：

```javascript
// curve 的实际内部结构
Object.getOwnPropertyNames(curve)
// → ["_times", "_values", "preExtrapolation", "postExtrapolation"]

// curve.keyframes 的类型
typeof curve.keyframes  // → "function" （getter，不是数组）

// 实际数据
curve._times   // → [0, 0.5]（Float32Array 或普通数组）
curve._values  // → [{ value: 0, leftTangent: 0, rightTangent: 0, ... }, ...]
```

错误代码：

```typescript
// 错误：keyframes 是 getter 函数，不是数组
const keyframes = curve.keyframes;
if (Array.isArray(keyframes)) { ... }  // 永远不会进入
```

### 当前修复

已改为读取 `_times` 和 `_values`：

```typescript
function collectKeyframeTimes(curve: any): Map<number, number> {
    const times: number[] = curve._times;
    const values: any[] = curve._values;
    for (let i = 0; i < times.length; i++) {
        const v = typeof values[i]?.value === 'number' ? values[i].value : ...;
        result.set(times[i], v);
    }
}
```

### 修复指导

1. 同缺陷 3，`_times` 和 `_values` 是引擎内部属性，需要防御性编码

2. 考虑使用 `curve.evaluate(time)` 公开方法来查询值，而不是自己实现线性插值。这样：
   - 不依赖内部结构
   - 自动支持所有插值模式（不仅仅是线性）
   - 引擎升级时不需要修改

   ```typescript
   // 推荐方式
   const value = curve.evaluate(time);
   ```

3. 对于 `collectKeyframeTimes`（删除关键帧时需要读取现有数据），考虑是否有公开 API 可以用

---

## 缺陷 5：引擎 API 编辑后的 clip 持久化不可靠

**优先级：P2（数据可能丢失）**
**状态：未修复**

### 现象

通过引擎 API（VectorTrack、RealCurve 等）修改 AnimationClip 后，修改存在于内存中但可能不会被保存到磁盘。编辑器重新加载或场景保存后，修改可能丢失。

### 根因

`persistClipToAssetDb` 函数尝试通过序列化 clip 并写入 asset-db 来持久化，但：

1. 依赖 `EditorExtends.serialize` 或 `cce.Utils.serialize`，这些 API 在 scene 进程中可能不可用
2. 即使序列化成功，`save-asset` 消息的调用时机可能不正确
3. 函数内部全部使用 try/catch 静默吞错误，无法诊断问题

```typescript
async function persistClipToAssetDb(clip: any, clipUuid: string): Promise<void> {
    try {
        // ... 序列化和保存
    } catch {
        // Best-effort persistence. ← 问题：完全静默
    }
}
```

### 修复指导

1. **使用 `Editor.Message.request('asset-db', 'refresh-asset', url)` 通知 asset-db 资源已变更**

2. **使用 `scene:save-clip` 消息**（如果可用）代替手动序列化

3. **至少在日志中记录持久化失败**，而不是静默吞错误

4. **考虑替代方案**：不直接修改 clip 对象，而是生成 clip 的 JSON 数据，通过 asset-db 的 `save-asset` 写入

---

## 缺陷 6：queryAnimationValueAtFrame 编辑器 API 静默返回 null

**优先级：P1**
**状态：已修复**

### 现象

```json
// 编辑器未进入动画模式时的返回
{ "success": true, "data": { "frame": 15, "value": null } }
```

调用不抛异常，但 value 为 null。

### 根因

原始代码只通过 try/catch 检测编辑器 API 失败。当编辑器未进入动画模式时，`query-property-value-at-frame` 消息执行成功但不返回有效数据，不触发 catch 分支，引擎 API 回退路径不会执行。

```typescript
// 修复前的代码
try {
    await prepareAnimationEditContext(nodeUuid, clipUuid);
    const value = await requestSceneFacade('query-property-value-at-frame', ...);
    return { success: true, data: { frame, value } };  // value 是 null 也直接返回了
} catch {
    // 只有异常才走回退，null 不会触发
}
```

### 当前修复

增加了 null 值检测：

```typescript
let editorValue: any = undefined;
let editorSucceeded = false;
try {
    editorValue = await requestSceneFacade('query-property-value-at-frame', ...);
    if (editorValue !== undefined && editorValue !== null) {
        editorSucceeded = true;
    }
} catch { }
if (editorSucceeded) { return ... }
// 走回退
```

### 修复指导

1. 这个模式应该在所有双路径方法中统一应用，而不仅仅是 `queryAnimationValueAtFrame`

2. 建议提取通用的 `tryEditorApiElseEngine` 辅助函数：

   ```typescript
   async function tryEditorApiElseEngine<T>(
       editorFn: () => Promise<T>,
       validateResult: (result: T) => boolean,
       engineFn: () => Promise<T>
   ): Promise<T> {
       try {
           const result = await editorFn();
           if (validateResult(result)) return result;
       } catch { }
       return engineFn();
   }
   ```

---

## 缺陷 7：nodePath 空字符串验证过严

**优先级：P1**
**状态：已修复**
**文件：`source/tools/v2/animation-tools.ts`**

### 现象

对根节点调用动画操作时报错：

```
{ success: false, error: "nodePath is required" }
```

参数 `nodePath: ""`（空字符串，表示根节点自身）被拒绝。

### 根因

`requireTrackContext` 方法使用 `requireString` 验证 nodePath，该函数拒绝空字符串：

```typescript
const nodePath = this.requireString(args?.nodePath, 'nodePath');
if (!nodePath.success) return nodePath;
// requireString("", "nodePath") → { success: false, error: "nodePath is required" }
```

### 当前修复

改为类型检查而非非空检查：

```typescript
if (typeof args?.nodePath !== 'string') {
    return { success: false, error: 'nodePath is required' };
}
```

### 修复指导

这是一个简单的修复，当前实现已正确。确认 `animation-tools.ts` 中所有使用 nodePath 的路径都允许空字符串。

---

## 缺陷 8：debug_execute 不支持异步返回

**优先级：P2（工具可用性）**
**状态：未修复**

### 现象

执行包含 Promise 的代码时返回空对象：

```
debug_execute({ script: "return assetManager.loadAny({ uuid: 'xxx' })" })
→ {}
```

### 根因

`debug_execute` 在 scene 进程中通过某种同步执行机制运行脚本。当脚本返回 Promise 时，序列化无法等待 resolve，直接输出 `{}`。

这导致以下场景不可用：
- `assetManager.loadAny()` / `assetManager.load()` 系列资源加载
- 任何 `Editor.Message.request()` 异步调用
- 其他返回 Promise 的引擎 API

### 修复指导

修改 `debug_execute` 的执行逻辑，支持异步结果：

```typescript
// 当前可能是同步执行
const result = eval(script);
return serializeData(result);

// 应改为支持异步
const result = eval(script);
if (result instanceof Promise) {
    const resolved = await result;
    return serializeData(resolved);
}
return serializeData(result);
```

同时增加超时保护，避免无限等待：

```typescript
const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Execution timeout')), 5000)
);
const result = await Promise.race([eval(script), timeout]);
```

---

## 缺陷 9：debug_execute 和 sceneScript_execute 序列化深度不足

**优先级：P2（调试效率）**
**状态：未修复**

### 现象

返回的对象中嵌套字段显示为 `"[max depth]"`：

```json
{
  "result": [
    {"idx": "[max depth]", "type": "[max depth]", "pathStr": "[max depth]"},
    ...
  ]
}
```

### 根因

`safeSerialize` 函数（`scene.ts` 中）设置了最大递归深度（约 3 层），超过后截断为 `"[max depth]"`。

### 影响

- 无法直接查看对象数组中的字段值
- 调试引擎内部结构时需要反复调整查询策略（先 JSON.stringify，或只返回单个字段）
- 降低了调试效率，每次探查都需要多轮试探

### 修复指导

1. **提高默认深度限制**：至少支持 5-6 层嵌套
2. **允许调用者指定深度**：在 `debug_execute` 和 `evalScript` 中增加可选的 depth 参数
3. **对引擎对象做扁平化处理**：识别常见的引擎类型（Vec3、Color 等）直接提取值，而不是递归序列化

---

## 缺陷 10：sceneScript_execute evalScript 的语法限制缺乏文档

**优先级：P2（用户体验）**
**状态：未修复**

### 现象

```javascript
// 报错：Illegal return statement
evalScript("return clip.tracks.length;")

// 报错：Cannot access 'result' before initialization
evalScript("const result = clip.tracks.length; result;")
```

### 根因

evalScript 的脚本在全局/模块作用域执行（非函数内部），`return` 语句非法。脚本需要使用 `var` 声明变量并依赖最后的表达式求值。

### 正确用法

```javascript
// 正确：使用 var + 表达式求值
var result; const clip = ...; result = clip.tracks.length; result;

// 正确：使用 JSON.stringify 返回复杂对象
var result; result = JSON.stringify(clip.tracks.map(...)); result;
```

### 修复指导

1. 在工具描述或返回的错误信息中添加用法说明
2. 考虑在 evalScript 实现中自动包裹函数体：

   ```typescript
   // 将用户脚本包裹在 async function 中
   const wrappedScript = `(async () => { ${script} })()`;
   ```

   这样用户就可以使用 `return` 语句。但需要注意表达式求值的语义变化。

---

## 缺陷 11：插件重载后 MCP 连接需要手动刷新

**优先级：P2（开发效率）**
**状态：未修复，属于架构限制**

### 现象

修改 `scene.ts` 并编译后，需要：
1. 用户在 Cocos 编辑器中手动重载插件
2. Claude Code 侧重新连接 MCP 服务

每次修改-编译-测试循环都需要双端手动操作。

### 根因

MCP 协议是长连接的 HTTP 服务。插件重载会重启 HTTP 服务，Claude Code 侧的连接失效但不会自动重连。

### 修复指导

1. **短期**：在 MCP 工具返回中提示用户需要重载，减少沟通成本
2. **中期**：在插件重载时保持端口不变，让 Claude Code 侧重连更容易
3. **长期**：考虑实现 MCP 连接的热重载，不中断连接的情况下更新工具实现

---

## 修复优先级总览

| # | 缺陷 | 优先级 | 状态 | 影响范围 |
|---|------|--------|------|---------|
| 1 | Scene 消息名称不匹配 | P0 | 已临时修复 | 所有动画操作 |
| 2 | animation-operation 依赖编辑器模式 | P0 | 已回退绕过 | 6 个动画方法 |
| 3 | TrackPath _paths 访问错误 | P1 | 已修复 | 引擎 API 回退路径 |
| 4 | RealCurve _times/_values 访问错误 | P1 | 已修复 | 引擎 API 回退路径 |
| 5 | Clip 持久化不可靠 | P2 | 未修复 | 引擎 API 编辑后数据丢失 |
| 6 | 编辑器 API 静默返回 null | P1 | 已修复 | queryAnimationValueAtFrame |
| 7 | nodePath 空字符串验证过严 | P1 | 已修复 | 根节点动画操作 |
| 8 | debug_execute 不支持异步 | P2 | 未修复 | 所有异步调试场景 |
| 9 | 序列化深度不足 | P2 | 未修复 | 调试效率 |
| 10 | evalScript 语法限制 | P2 | 未修复 | 用户体验 |
| 11 | 插件重载需手动刷新 | P2 | 未修复 | 开发效率 |

## 建议的修复会话工作流

1. **先阅读** `source/scene.ts` 中的动画相关代码，理解当前的双路径（editor API + engine API）结构
2. **重构双路径模式**：将重复的 try-catch-fallback 抽象为通用辅助函数（见缺陷 6 的修复指导）
3. **加固引擎 API 回退**：
   - 为 `_paths`、`_times`、`_values` 等内部属性添加防御性检查
   - 尝试使用 `curve.evaluate()` 等公开 API 替代内部属性直接访问
4. **修复 clip 持久化**（缺陷 5）
5. **修复 debug_execute 异步支持**（缺陷 8）
6. **提高序列化深度**（缺陷 9）
7. **运行 AN-1 ~ AN-9 全部测试验证**
