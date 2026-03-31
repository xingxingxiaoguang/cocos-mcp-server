# 08 号修复验收：回归问题与遗留缺陷

> 08-A ✅ 已修复 | 08-B ✅ 已修复 | 08-C ✅ 已修复 | 08-D ✅ 已修复

---

## 缺陷 1：persistClipChanges save-asset 触发重导入回归 ✅ 已修复

**优先级：P0（阻断连续动画操作）**
**文件：`source/scene.ts` — `persistClipChanges` 函数（已移除）**

### 现象

```
set_keyframe(frame=0, ...)  → success ✓
set_keyframe(frame=30, ...) → "Clip xxx not loaded in assetManager" ✗
```

第一次写入成功，第二次必定失败。`debug_execute` 确认 clip 实例仍在 assetManager 中，但 tracks 的 channelCount 归零，关键帧数据丢失。

### 根因

`persistClipChanges` 策略 2/3 调用 `save-asset` / `write-asset` → 编辑器触发资产重导入 → 旧 clip 实例被新实例替换 → 后续 `getClipFromAssetManager` 拿到的是重导入后的空 clip（或在重导入过程中拿不到）。

修复前所有持久化策略都失败，修改安全地保留在内存中；修复后 `EditorExtends.serialize` 可用，`save-asset` 成功执行但引发了重导入副作用。

### 修复方案：显式 save 架构（已实施）

**将持久化从编辑操作中完全解耦，新增独立的 `save` action。**

核心思路：事务模式对 AI 调用方负担过重（需管理 begin/commit 状态），而每次编辑自动落盘又触发 reimport 副作用。显式 save 是最优平衡点——编辑操作零副作用，AI 只需在编辑完成后多调一次 `save`。

#### 改动

1. **删除 `persistClipChanges` 函数**，编辑操作（`add_track`/`remove_track`/`create_key`/`set_keyframe`/`remove_key`）不再尝试持久化，变为纯内存操作
2. **引擎回退路径**用 `usedEngine` 标记替代 `persisted` 标记，engine fallback 时附带 warning：`"Changes are in memory only. Call animation_clip(action=save) to persist, or save the scene in the editor."`
3. **新增 `saveAnimationClip` scene 方法**（`source/scene.ts`），两个策略：
   - 策略 1：`SAVE_CLIP`（编辑器动画面板打开时生效，无 reimport）
   - 策略 2：`serialize + save-asset`（触发 reimport，但 save 是最后一步，可接受）
4. **新增 `save` action**（`source/tools/v2/animation-tools.ts`），路由到 `saveAnimationClip`
5. **`package.json`** 注册 `saveAnimationClip` 到 scene methods

#### 典型工作流

```
add_track(propKey="position")            → 纯内存
set_keyframe(frame=0, value={0,0,0})     → 纯内存，warning
set_keyframe(frame=60, value={100,200,0})→ 纯内存，warning（同一 clip 实例，无 reimport）
save(nodeUuid=..., clipUuid=...)         → 落盘（reimport 可接受，编辑已结束）
```

#### 影响评估

| 指标 | 影响 |
|------|------|
| API 变更 | 新增 1 个 action（`save`），现有 action 行为不变 |
| 典型工作流开销 | +1 次 tool call（约 +11%） |
| AI 认知负担 | 低：每步 warning 自动提醒 |
| 向后兼容 | 完全兼容：不调 save 等于当前 warning 模式 |

---

## 缺陷 2：autoReturn 对单行多语句脚本无效 ✅ 已修复

**优先级：P2**
**文件：`source/scene.ts` — `autoReturn` 函数**

### 现象

```
debug_execute("var result; result = 42; result;") → { data: {} }
debug_execute("return 42;")                       → { data: { result: 42 } } ✓
```

### 根因

`autoReturn` 按 `\n` 分割取最后一行，`"var result; result = 42; result;"` 是单行，首词匹配 `/^var\b/` 被排除。

### 修复

改为按 `;` 提取最后一个语句：

```typescript
const autoReturn = (src: string): string => {
    if (/\breturn\b/.test(src)) return src;
    const stmts = src.trimEnd().split(';').map(s => s.trim()).filter(s => s);
    if (!stmts.length) return src;
    const lastStmt = stmts[stmts.length - 1];
    if (/^(var|let|const|if|for|while|switch|try|function|class|throw|do)\b/.test(lastStmt)) return src;
    if (/[{}]/.test(lastStmt)) return src;
    stmts[stmts.length - 1] = 'return ' + lastStmt;
    return stmts.join('; ') + ';';
};
```

---

## 缺陷 3：engineSetKeyframe _times 未排序导致查询值错误 ✅ 已修复

**优先级：P1（数据正确性）**
**文件：`source/scene.ts` — `engineSetKeyframe`、`engineRemoveKeyframes` 函数**

### 现象

```
create_key(frame=0, value={x:0,y:0,z:0})
create_key(frame=15, value={x:50,y:100,z:0})
create_key(frame=30, value={x:100,y:200,z:0})
query_value_at_frame(frame=0)  → {x:50,y:100,z:0}  ← 期望 {0,0,0}
```

同时 `remove_key` 返回 success 但关键帧未实际删除。

### 根因

`engineSetKeyframe` 使用 `curve.addKeyFrame(time, value)` 追加关键帧，但该 API 不保证插入后 `_times` 数组递增有序。无序的 `_times` 导致：

1. `curve.evaluate(time)` 插值计算基于错误的时间顺序，返回错误值
2. `engineRemoveKeyframes` 中 `findIndex` 按时间匹配可能找到错误索引或完全匹配不到
3. 按 index 调用 `removeKeyFrame(idx)` 在无序数组上删错条目

### 修复

**完全绕过 `addKeyFrame`/`removeKeyFrame`，自行管理有序数组。**

新增三个辅助函数：

```typescript
/** 读取 curve 的 _times/_values 为普通数组 */
function readCurveKeyframes(curve): { times: number[]; values: any[] }

/** 将有序的 times/values 写回 curve（优先 assignSorted，回退直接赋值）*/
function writeCurveKeyframes(curve, times: number[], values: any[]): void

/** 构造标准关键帧值对象 */
function makeKeyframeValue(v: number): any
```

**`engineSetKeyframe` 重写为有序插入**：
1. `readCurveKeyframes` 读取当前数据
2. 查找已有时间点 → 更新值；不存在 → `splice` 到正确排序位置
3. `writeCurveKeyframes` 写回

**`engineRemoveKeyframes` 重写为 filter 模式**：
1. `readCurveKeyframes` 读取当前数据
2. 遍历所有时间点，过滤掉匹配项
3. `writeCurveKeyframes` 写回过滤后的有序数组

保证写入后 `_times` 始终递增有序，从根本上消除排序依赖。

---

## 验收用例

```
# 缺陷 1：连续多次写入不报错
animation_clip(action=set_keyframe, frame=0, value={x:0,y:0,z:0})
animation_clip(action=set_keyframe, frame=30, value={x:100,y:200,z:0})  ← 不应报 "not loaded"
animation_clip(action=save)  ← 显式落盘

# 缺陷 2：旧语法返回值
debug_execute("var result; result = 42; result;") → data.result = 42

# 缺陷 3：有序关键帧 + 正确查询
animation_clip(action=create_key, frame=0, value={x:0,y:0,z:0})
animation_clip(action=create_key, frame=15, value={x:50,y:100,z:0})
animation_clip(action=create_key, frame=30, value={x:100,y:200,z:0})
animation_clip(action=query_value_at_frame, frame=0)  → {x:0, y:0, z:0}
animation_clip(action=query_value_at_frame, frame=15) → {x:50, y:100, z:0}
animation_clip(action=query_value_at_frame, frame=30) → {x:100, y:200, z:0}

# 缺陷 3：remove_key 实际生效
animation_clip(action=remove_key, frames=[15])
animation_clip(action=query_value_at_frame, frame=15) → 插值结果（不再是 {50,100,0}）
animation_clip(action=get_info) → keyframeCount = 2
```
