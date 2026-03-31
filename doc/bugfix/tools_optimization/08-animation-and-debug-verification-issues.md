# 验收测试发现的遗留问题：animation_clip 与 debug_execute

> 本文档基于对 07 号文档（AN-1 ~ AN-9）修复后的验收测试结果编写。
> 07 号文档中标注为"已修复"的缺陷 1/2/3/4/6/7 确认通过测试。
> 缺陷 8/9/10 在源码层面已修复但 07 号文档未更新状态。
> 本文档记录验收过程中新发现的 4 个问题，按修复优先级排列。

---

## 缺陷 A：create_key 返回的 keyframeCount 始终为 0

**优先级：P1（返回值误导调用方）**
**文件：`source/scene.ts`，第 1310-1344 行**

### 现象

```json
// create_key 返回
{ "success": true, "data": { "frame": 0, "track": null, "keyframeCount": 0 } }

// 但 get_info 确认关键帧确实被创建了
{ "curves": [{ "propKey": "position", "keyframeCount": 3 }] }
```

调用 `create_key` 后 `success: true`，但 `keyframeCount` 报 0，`track` 为 null。

### 根因

`createAnimationKey` 在写入关键帧后，通过 `queryClipDump` 读取编辑器 dump 来获取 track 信息：

```typescript
// scene.ts:1331-1338
const dump = await queryClipDump(nodeUuid, clipUuid);  // 编辑器 API → 可能失败或返回旧数据
const track = dump ? findAnimationCurveSummary(dump, nodePath, propKey) : null;
return {
    success: true,
    data: serializeData({
        frame,
        track,                             // null
        keyframeCount: track?.keyframeCount ?? 0  // 回退到 0
    })
};
```

问题出在：
1. 引擎 API 回退路径修改了内存中的 clip 对象
2. `queryClipDump` 调用编辑器的 `query-animation-clip` 消息
3. 编辑器未处于动画模式时，dump 查询失败或返回旧数据
4. `track` 为 null，`keyframeCount` 回退到 0

### 对比 set_keyframe

`setAnimationKeyframe`（第 1349-1402 行）不依赖 dump 查询，而是通过引擎 API 直接验证写入结果：

```typescript
// scene.ts:1382-1393
const verifiedValueAtFrame = await tryEditorThenEngine(
    async () => {
        return await requestSceneFacade(SCENE_ANIM_MSG.QUERY_VALUE_AT_FRAME, ...);
    },
    isValidResult,
    async () => {
        const clip = getClipFromAssetManager(clipUuid);
        return engineQueryValueAtTime(clip, nodePath, propKey, time);  // 直接从内存 clip 读取
    }
);
return { success: true, data: serializeData({ frame, value, curve, verifiedValueAtFrame }) };
```

这种方式能正确反映引擎 API 回退路径的修改结果。

### 修复方案

改造 `createAnimationKey` 的返回值生成逻辑，不再依赖 `queryClipDump`，改为从内存 clip 直接统计：

```typescript
// 方案 1：从内存 clip 统计关键帧数（推荐）
async createAnimationKey(nodeUuid, clipUuid, nodePath, propKey, frame, value) {
    // ... 创建关键帧（已有逻辑不变）...

    // 验证：直接从内存读取，同 setAnimationKeyframe 的模式
    const verifiedValue = await tryEditorThenEngine(
        async () => {
            await prepareAnimationEditContext(nodeUuid, clipUuid);
            return await requestSceneFacade(SCENE_ANIM_MSG.QUERY_VALUE_AT_FRAME, clipUuid, nodePath, propKey, frame);
        },
        isValidResult,
        async () => engineQueryValueAtTime(getClipFromAssetManager(clipUuid), nodePath, propKey, frame / sample)
    );

    return {
        success: true,
        data: serializeData({ frame, value: verifiedValue })
    };
}
```

`removeAnimationKey`（第 1407-1441 行）也有同样的问题（依赖 `queryClipDump` 获取 `remainingKeyframeCount`），应一并修复。

---

## 缺陷 B：create_key 写入的值可能未生效

**优先级：P1（数据正确性）**
**文件：`source/scene.ts`，`engineSetKeyframe` 函数**

### 现象

```
create_key(frame=0, value={x:0, y:0, z:0})  → success
create_key(frame=30, value={x:100, y:200, z:0})  → success
set_keyframe(frame=15, value={x:50, y:100, z:0})  → success

query_value_at_frame(frame=0)  → {x:50, y:100, z:0}  ← 期望 {0,0,0}
query_value_at_frame(frame=15) → {x:50, y:100, z:0}  ← 正确
query_value_at_frame(frame=30) → {x:100, y:200, z:0} ← 正确
```

frame 0 查询到的值是 `{50,100,0}` 而非写入的 `{0,0,0}`。

### 可能根因

1. `create_key` 和 `set_keyframe` 在引擎 API 路径都调用 `engineSetKeyframe`，逻辑相同
2. 但 `create_key` 传入的 `value` 格式可能与 `engineSetKeyframe` 期望的不一致
3. 当 value 为 `{x:0, y:0, z:0}` 时，所有分量为 0，可能被 `engineSetKeyframe` 中的某个条件判断跳过
4. 或者 `persistClipChanges` 后写入被覆盖

### 排查方向

1. 在 `engineSetKeyframe` 中添加日志，确认 `create_key` 的 value 参数是否正确传入
2. 检查 `engineSetKeyframe` 中是否有对全零值的特殊处理
3. 检查两次 `create_key` + 一次 `set_keyframe` 连续调用时，`persistClipChanges` 是否存在竞态问题

---

## 缺陷 C：编辑器 dump 与引擎内存状态不一致（缺陷 5 的具体表现）

**优先级：P2（数据一致性）**
**文件：`source/scene.ts`，第 528-577 行**

### 现象

```
remove_key(frame=15) → { "removedFrames": [15], "remainingKeyframeCount": 0 }
get_info()           → { "keyframeCount": 3 }  ← 编辑器 dump 仍显示 3
```

`remove_key` 返回 `remainingKeyframeCount: 0`（来自失败的 dump 查询回退），而 `get_info`（通过编辑器 `query-animation-clip`）仍报告 3 个关键帧。

### 根因分析

这是 07 号文档缺陷 5 的具体表现。`persistClipChanges`（第 528-554 行）有三个持久化策略：

```typescript
async function persistClipChanges(clip, clipUuid) {
    // 策略 1：编辑器 save-clip 消息（需要动画编辑模式 → 必定失败）
    try { await requestSceneFacade(SCENE_ANIM_MSG.SAVE_CLIP); return; } catch {}

    // 策略 2：序列化 + asset-db save-asset（依赖 EditorExtends.serialize）
    const serializer = globalThis.EditorExtends?.serialize || globalThis.cce?.Utils?.serialize;
    if (serializer) { /* ... 尝试序列化保存 ... */ }

    // 策略 3：放弃，只打 warning
    console.warn('[cocos-mcp-server] clip persist: all strategies failed. Changes are in memory only.');
}
```

在非动画编辑模式下：
- 策略 1 必定失败（需要编辑器动画面板打开）
- 策略 2 取决于 `EditorExtends.serialize` 是否可用，在 scene 进程中通常不可用
- 最终静默降级为内存修改

导致的读写不一致：
- **写入路径**：`engineSetKeyframe` / `engineRemoveKeyframes` → 修改内存中的 clip 对象 ✓
- **读取路径**：`queryClipDump` → `query-animation-clip` → 读取编辑器管理的序列化数据 ✗（旧数据）

### 修复方案

**方案 1（推荐）：读取路径统一到引擎 API**

当编辑器 dump 不可用或不可信时，从内存 clip 构建等价信息：

```typescript
async function queryClipInfo(nodeUuid: string, clipUuid: string): Promise<any> {
    // 优先编辑器 dump
    const dump = await queryClipDump(nodeUuid, clipUuid);
    if (dump) return dump;

    // 回退：从内存 clip 构建
    const clip = getClipFromAssetManager(clipUuid);
    if (!clip) return null;
    return buildClipInfoFromEngine(clip);  // 新函数：遍历 tracks 构建等价结构
}
```

**方案 2：修复持久化**

参考 07 号文档缺陷 5 的修复指导，使 `persistClipChanges` 真正生效，使编辑器 dump 与内存一致。

---

## 缺陷 D：evalScript Path 2（eval 回退）返回值丢失

**优先级：P2（旧语法兼容性）**
**文件：`source/scene.ts`，第 1029-1036 行；`source/tools/v2/debug-tools.ts`，第 343-374 行**

### 现象

```
debug_execute("var result; result = 42; result;") → { "data": {} }
debug_execute("return 42;")                       → { "data": { "result": 42 } }   ✓
```

使用 `return` 语法（Path 1）正常，但旧的表达式求值语法（Path 2）返回 `{}`。

### 根因

`evalScript` 有两条执行路径：

```typescript
// Path 1（第 1024-1027 行）：async function 包裹 → 支持 return/await
const wrapped = new Function('require', `return (async () => { ${script} })()`);
const result = await withTimeout(wrapped(require));
return { success: true, data: { result: safeSerialize(result) } };

// Path 2（第 1029-1036 行）：eval 回退 → 表达式求值语法
const result = eval(script);
return { success: true, data: { result: safeSerialize(result) } };
```

问题链：
1. `var result; result = 42; result;` 对于 Path 1 来说是合法的（async function 内部可以有 var），Path 1 执行成功
2. **但** async function 返回的是最后一个 `result` 赋值语句的值？不，async function 没有 `return` 语句时返回 `undefined`
3. `safeSerialize(undefined)` → 返回 `undefined` → `data: { result: undefined }`
4. `execute-scene-script` 通信层序列化时丢弃 `undefined` 字段 → `data: {}` 

实际上对于 `var result; result = 42; result;` 这种脚本：
- Path 1 包裹为 `(async () => { var result; result = 42; result; })()` → **没有 return，返回 undefined**
- Path 2 根本不会执行，因为 Path 1 不抛异常

### 修复方案

在 Path 1 的包裹逻辑中，自动将最后一个表达式语句转换为 return：

```typescript
// 方案 1：尝试自动补 return（简单启发式）
function autoReturn(script: string): string {
    const trimmed = script.trimEnd().replace(/;$/, '');
    // 如果脚本已包含 return，不处理
    if (/\breturn\b/.test(script)) return script;
    // 尝试在最后一行前加 return
    const lines = trimmed.split('\n');
    const lastLine = lines[lines.length - 1].trim();
    // 如果最后一行是纯表达式（不是赋值、声明、控制流）
    if (!/^(var|let|const|if|for|while|switch|try|function|class)\b/.test(lastLine) &&
        !/[={}]/.test(lastLine)) {
        lines[lines.length - 1] = 'return ' + lastLine;
    }
    return lines.join('\n');
}

// 使用
const wrapped = new Function('require', `return (async () => { ${autoReturn(script)} })()`);
```

```typescript
// 方案 2：如果 Path 1 返回 undefined，尝试 Path 2
const result = await withTimeout(wrapped(require));
if (result !== undefined) {
    return { success: true, data: { result: safeSerialize(result) } };
}
// result 为 undefined，尝试 Path 2 的 eval
// ...（继续原有 Path 2 逻辑）
```

**注意**：方案 2 仍然面临 Path 2 的 `eval()` 在 scene 进程 context 中可能丢失返回值的问题。方案 1 更可靠。

---

## 修复优先级总览

| # | 缺陷 | 优先级 | 文件 | 影响 |
|---|------|--------|------|------|
| A | create_key 返回 keyframeCount 始终为 0 | P1 | scene.ts:1310-1344 | 调用方无法判断关键帧是否创建成功 |
| B | create_key 写入值可能未生效 | P1 | scene.ts:engineSetKeyframe | 数据正确性 |
| C | 编辑器 dump 与引擎内存状态不一致 | P2 | scene.ts:528-577 | 读写不一致，remove_key 后 get_info 显示旧数据 |
| D | evalScript 旧表达式语法返回值丢失 | P2 | scene.ts:1024-1036 | 不影响 return 语法，仅影响旧式脚本兼容 |

## 建议的修复顺序

1. **缺陷 A**：改造 `createAnimationKey` 和 `removeAnimationKey` 的返回值逻辑，不再依赖 `queryClipDump`，改为从内存 clip 直接验证（同 `setAnimationKeyframe` 的模式）
2. **缺陷 B**：在 `engineSetKeyframe` 中添加调试日志，排查 `create_key` 写入全零值时是否被跳过
3. **缺陷 C**：实现 `buildClipInfoFromEngine` 函数，在 dump 不可用时从内存 clip 构建轨道信息
4. **缺陷 D**：在 `evalScript` 的 Path 1 中实现 `autoReturn` 启发式，自动为末尾表达式添加 return

## 验收测试用例

修复后请验证以下场景：

```
# 缺陷 A 验证
animation_clip(action=create_key, propKey=position, frame=0, value={x:0,y:0,z:0})
→ 期望 keyframeCount >= 1（不为 0）

animation_clip(action=remove_key, propKey=position, frames=[0])
→ 期望 remainingKeyframeCount 与实际一致

# 缺陷 B 验证
animation_clip(action=create_key, frame=0, value={x:0,y:0,z:0})
animation_clip(action=query_value_at_frame, frame=0)
→ 期望 value = {x:0, y:0, z:0}

# 缺陷 C 验证
animation_clip(action=create_key, frame=0, value={x:1,y:2,z:3})
animation_clip(action=get_info)
→ 期望 keyframeCount 包含新创建的关键帧

animation_clip(action=remove_key, frames=[0])
animation_clip(action=get_info)
→ 期望 keyframeCount 已减少

# 缺陷 D 验证
debug_execute("var result; result = 42; result;")
→ 期望 data.result = 42（不为 {}）

debug_execute("return 42;")
→ 期望 data.result = 42（不变）
```
