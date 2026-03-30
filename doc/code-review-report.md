# MCP 工具集优化 — 代码审查报告

> 审查范围：Step 1 ~ Step 5（对照 `00-overview.md` 及 `01` ~ `05` 号需求文档）
> 审查时间：2026-03-27
> 审查方式：静态代码分析 + 编译验证（`npm run build` 通过）

---

## 总评

整体实现质量良好，5 个 Step 均已落地，编译零错误。工具总数从 157 降至 **31 个**，符合"≤ 40"的目标。核心架构（路由机制、ToolExecutor 接口、action 参数模式）均正确迁移。以下按 Step 逐项列出审查结论。

---

## Step 1: 删除无价值工具类别 ✅ 通过

**需求对照：**

| 检查项 | 要求 | 实际 | 结果 |
|--------|------|------|------|
| 删除 5 个文件 | scene-view, reference-image, server, broadcast, validation | 5 个均已删除（commit `7a448a2`） | ✅ |
| mcp-server.ts 清理 import | 删除 5 条 import + 5 条实例化 | 已清理，无残留引用 | ✅ |
| tool-manager.ts 清理 | 删除 require + 实例化 + 后备定义 | 已清理 | ✅ |
| 不动 panels/types/scene/main | 无需改动 | 未改动 | ✅ |

**偏差：** 无。

---

## Step 2: 合并 Scene + Node ✅ 通过（有小偏差）

**需求对照：**

| 检查项 | 要求 | 实际 | 结果 |
|--------|------|------|------|
| 创建 `v2/scene-tools.ts` | SceneToolsV2，5 个工具 | 已创建，5 个工具：query/open/save/create/manage | ✅ |
| 创建 `v2/node-tools.ts` | NodeToolsV2，5 个工具 | 已创建，5 个工具：query/create/modify/delete/arrange | ✅ |
| scene_query action 枚举 | info/hierarchy/list/status | 已实现全部 4 个 action | ✅ |
| scene_save action 枚举 | save/save_as/close | 已实现 | ✅ |
| scene_manage action 枚举 | reload/snapshot/snapshot_abort | 已实现 | ✅ |
| node_query 参数路由 | uuid > pattern > assetUuid > 无参数 | 已实现 if-else 优先级链 | ✅ |
| node_modify 保留 2D/3D 自动检测 | set_transform 保留 is2DNode 逻辑 | `is2DNode()` + `normalizeTransformValue()` 均已迁移 | ✅ |
| node_arrange 5 个 action | move/duplicate/copy/paste/cut | 已实现 | ✅ |
| node_delete 统一 string → string[] | uuids 支持 oneOf string/array | 已实现 | ✅ |
| 实现 ToolExecutor 接口 | 两个类均需实现 | 均已 `implements ToolExecutor` | ✅ |
| 写操作返回完整结果 | node_create/modify 返回完整节点信息 | 创建后调用 query-node 返回完整信息 | ✅ |

**偏差：**

1. ⚠️ **node_create 的 `parentUuid` 不在 required 中。** 需求文档中 `required: ['name']`，实现一致。但 description 写了 "Always provide parentUuid"，属于 schema 设计上的弱引导。建议将 `parentUuid` 加入 required 或在 description 中标明默认行为。**影响：低**

---

## Step 3: 合并 Component + Prefab ✅ 通过（有偏差）

**需求对照：**

| 检查项 | 要求 | 实际 | 结果 |
|--------|------|------|------|
| 创建 `v2/component-tools.ts` | ComponentToolsV2，3 个工具 | 已创建：query/add/modify | ✅ |
| 创建 `v2/prefab-tools.ts` | PrefabToolsV2，3 个工具 | 已创建：query/create/update | ✅ |
| component_add 自动判断脚本/内置 | 包含 `/` 或以 `.ts` 结尾走脚本路径 | 已实现，还额外支持 `.js` 后缀 | ✅ |
| component_modify 复杂类型转换 | Color/Vec2/Vec3/Size/节点引用/资源引用/枚举 | 已完整迁移（~380 行类型转换逻辑） | ✅ |
| component_query action 枚举 | list/info/available/classes/scene_components/has_script | 已实现全部 6 个 action + uuid/componentType 路由 | ✅ |
| prefab_query 参数路由 | 有 prefabPath → 详情，无 → 列表 | 已实现 | ✅ |
| prefab_create 3 个 action | from_node/instantiate/duplicate | 已实现 | ✅ |
| prefab_update 2 个 action | apply/revert | 已实现，revert 含多策略回退 | ✅ |

**偏差：**

1. 🔴 **`PrefabToolsV2` 依赖遗留 `PrefabTools` 类。** `v2/prefab-tools.ts` 第 2 行 `import { PrefabTools } from '../prefab-tools'`，第 5 行实例化 `private legacyPrefabTools = new PrefabTools()`。`createPrefabFromNode()` 和 `duplicatePrefab()` 两个操作完全委托给旧类。这意味着：
   - `source/tools/prefab-tools.ts`（旧文件，1098 行）**无法删除**，违反了 Step 5 "删除 9 个旧文件" 的要求（实际仅删除 8 个）
   - 旧类的全部 10 个工具定义仍被加载到内存中，尽管不再注册到 MCP
   - 如果旧类中存在 bug，v2 不会受益于独立修复
   - **建议：将 `create_prefab` 和 `duplicate_prefab` 的核心逻辑提取到 `PrefabToolsV2` 中，然后删除旧文件**
   - **影响：中** — 功能正常，但架构不干净

2. ⚠️ **component_modify 的 `propertyType` 参数。** 需求文档中未定义此参数，但实现中新增了 `propertyType` 枚举（18 个类型），用于辅助类型转换。这是一个**合理的增强**，对 AI 调用更友好。**影响：无负面影响，属于正向偏差。**

---

## Step 4: 合并辅助工具 ✅ 通过（有小偏差）

**需求对照：**

| 检查项 | 要求 | 实际 | 结果 |
|--------|------|------|------|
| 创建 7 个新文件 | asset/debug/project/preferences/undo/scene-script/array-property | 均已创建 | ✅ |
| asset_query 参数路由 | db_ready > dependencies > unused > uuid > path > name > list | 已实现 if-chain 优先级 | ✅ |
| debug_logs 内存缓存机制 | consoleMessages 数组 + 监听 + 清空 | 已保留，上限 1000 条，FIFO 策略 | ✅ |
| scene-advanced-tools.ts 全部拆完 | 23 个工具分配完毕 | 已全部分配到新工具中 | ✅ |
| scene_script category key | 需要与 scene 区分，使用 sceneScript | `sceneScript` → SceneScriptToolsV2 | ✅ |
| array_property category key | 使用 array | `array` → ArrayPropertyToolsV2 | ✅ |
| project_build 6 个 action | build/preview/status/start_preview/stop_preview/open_panel | 已实现 | ✅ |
| undo_recording 3 个 action | begin/end/cancel | 已实现 | ✅ |

**偏差：**

1. ⚠️ **`asset_query` 额外增加了 `exactMatch`、`maxResults`、`includeSubAssets`、`direction`、`excludeDirectories` 参数。** 需求文档中未提及这些参数。属于功能增强。**影响：正向偏差。**

2. ⚠️ **`asset_create` 的 `sources` 参数结构不同。** 需求定义 `sources` 为 `{source, target}` 对象数组，实现为含 `sourceDirectory`、`fileFilter`、`recursive` 的对象。**影响：低** — 提供了更灵活的批量导入方式，但与需求文档定义不一致。

3. ⚠️ **`debug_logs` 的 `level` 枚举扩展。** 需求定义 `['log', 'warn', 'error', 'info']`，实现额外包含大写变体。**影响：无负面影响。**

4. ⚠️ **`project_build` 的 `start_preview` / `stop_preview` 返回失败。** 实现中这两个 action 直接返回 `success: false` 并附带手动操作说明，而非实际调用 API。可能是 Cocos Editor API 限制导致。**影响：功能不完整，但有明确的用户提示。**

---

## Step 5: 切换路由 + 删除旧文件 ⚠️ 部分通过

**需求对照：**

| 检查项 | 要求 | 实际 | 结果 |
|--------|------|------|------|
| mcp-server.ts 替换 import | 全部替换为 v2 import | 11 个 v2 import 全部到位 | ✅ |
| initializeTools() 替换 | 11 个 v2 类实例化 | 已替换 | ✅ |
| tool-manager.ts 替换 | require + 实例化 + 后备列表 | 全部替换为 v2 | ✅ |
| executeToolCall() 路由 | 按首个 `_` 拆分 category | 未修改，现有逻辑兼容所有 31 个工具名 | ✅ |
| 工具总数 = 31 | | 实际 31 个 | ✅ |
| 删除 9 个旧文件 | 9 个文件 | **仅删除 8 个**，`prefab-tools.ts` 保留 | ⚠️ |
| npm run build 通过 | | 通过 | ✅ |
| git tag `tool-opt/step-5` | 创建 tag | **未创建** | ❌ |

**偏差：**

1. 🔴 **`source/tools/prefab-tools.ts` 未删除。** 这是 Step 3 中 `PrefabToolsV2` 依赖遗留类的直接后果。Commit 消息明确记录 "Retain prefab-tools.ts as legacy helper for v2/prefab-tools.ts delegation"。需求要求删除全部 9 个旧文件。**影响：中** — 代码基中保留了一个 1098 行的遗留文件。

2. 🔴 **未创建 git tag。** 5 个 Step 均无 `tool-opt/step-*` 标签。需求文档 `00-overview.md` 第 7 节明确要求每个 Step 创建 tag，且 Step 5 是不可逆点。**影响：低** — 不影响功能，但不符合回滚策略。

3. 🔴 **未使用 feature 分支。** 需求文档 `00-overview.md` 第 8 节要求使用 `feature/tool-optimization` 分支及子分支，实际所有 commit 直接在 `main` 上。**影响：低** — 开发已完成且通过编译，但不符合分支规范。

---

## 交叉审查：参数命名规范（00-overview.md 第 3 节）

| 规范 | 检查结果 |
|------|----------|
| 单个标识使用 `uuid` | ✅ 全部工具统一使用 `uuid` |
| 批量标识使用 `uuids` | ✅ `node_delete` 和 `node_arrange` 使用 `uuids` |
| 资源路径使用 `path`（`db://` 格式） | ✅ 统一使用 `db://` 格式 |
| 操作类型使用 `action` | ✅ 所有多操作工具均使用 `action` 参数 |

---

## 交叉审查：ToolExecutor 接口合规

| 文件 | implements ToolExecutor | getTools() | execute() | 结果 |
|------|------------------------|------------|-----------|------|
| scene-tools.ts | ✅ | ✅ 返回 ToolDefinition[] | ✅ switch 路由 | ✅ |
| node-tools.ts | ✅ | ✅ | ✅ | ✅ |
| component-tools.ts | ✅ | ✅ | ✅ | ✅ |
| prefab-tools.ts | ✅ | ✅ | ✅ | ✅ |
| asset-tools.ts | ✅ | ✅ | ✅ | ✅ |
| debug-tools.ts | ✅ | ✅ | ✅ | ✅ |
| project-tools.ts | ✅ | ✅ | ✅ | ✅ |
| preferences-tools.ts | ✅ | ✅ | ✅ | ✅ |
| undo-tools.ts | ✅ | ✅ | ✅ | ✅ |
| scene-script-tools.ts | ✅ | ✅ | ✅ | ✅ |
| array-property-tools.ts | ✅ | ✅ | ✅ | ✅ |

---

## 工具总数统计

| 类别 | 目标（00-overview.md） | 实际 | 匹配 |
|------|----------------------|------|------|
| Scene | 5 | 5 | ✅ |
| Node | 5 | 5 | ✅ |
| Component | 3 | 3 | ✅ |
| Prefab | 3 | 3 | ✅ |
| Asset | 5 | 5 | ✅ |
| Debug | 3 | 3 | ✅ |
| Project | 2 | 2 | ✅ |
| Preferences | 2 | 2 | ✅ |
| Undo | 1 | 1 | ✅ |
| SceneScript | 1 | 1 | ✅ |
| ArrayProperty | 1 | 1 | ✅ |
| **总计（Step 1~5）** | **31** | **31** | ✅ |

> 注：目标 34 包含 Step 6 的 3 个新能力工具（script_file / animation_clip / material_property），不在本次审查范围内。

---

## 问题汇总

### 🔴 需修复（3 项）

| # | 问题 | 涉及 Step | 严重度 | 建议 |
|---|------|----------|--------|------|
| 1 | PrefabToolsV2 依赖遗留 PrefabTools 类，导致旧文件无法删除 | Step 3/5 | 中 | 将 `create_prefab` 和 `duplicate_prefab` 的核心逻辑内联到 PrefabToolsV2，然后删除 `source/tools/prefab-tools.ts` |
| 2 | 未创建 `tool-opt/step-*` git tag | 全部 | 低 | 补建 5 个 tag 在对应 commit 上 |
| 3 | 未使用 feature 分支，直接提交到 main | 全部 | 低 | 已完成的改动无需回退，后续 Step 6 建议使用分支 |

### ⚠️ 建议优化（4 项）

| # | 问题 | 涉及 Step | 建议 |
|---|------|----------|------|
| 4 | `node_create` 的 `parentUuid` 未设为 required | Step 2 | 考虑加入 required 或明确默认行为（场景根节点） |
| 5 | `asset_create` 的 `sources` 参数结构与需求文档不一致 | Step 4 | 更新需求文档以反映实际实现，或调整实现 |
| 6 | `project_build` 的 `start_preview` / `stop_preview` 返回失败 | Step 4 | 如 API 不可用，在工具 description 中标明这两个 action 暂不支持 |
| 7 | `component_modify` 新增 `propertyType` 参数未同步到需求文档 | Step 3 | 更新需求文档 |

---

## 编译状态

```
$ npm run build
> cocos-mcp-server@1.4.0 build
> tsc
(零错误)
```

---

## 结论

Step 1 ~ Step 5 的核心目标已达成：工具从 157 精简到 31 个，路由正确，架构清晰，编译通过。主要遗留问题是 **PrefabToolsV2 对旧类的依赖**（问题 #1），建议优先修复以实现"零旧文件"的完整清理。git tag 和分支策略的偏差属于流程问题，不影响功能。
