# Step 4: 工具迁移与 Prefab v1 退役

> 前置依赖：Step 3  
> 预计改动量：大  
> 目标：让各 v2 工具接入新基础设施，并彻底剪除 `source/tools/prefab-tools.ts` 依赖

---

## 1. 背景

到这个阶段，基础设施已经具备：

- IPC 契约稳定
- 工具注册源统一
- 主进程职责拆分
- `types` / `serializer` / `error-codes` / `base-tool` 已存在
- Editor Bridge 和 `scene/` 模块已可用

接下来要做的是把具体工具类逐步迁过去。这里最关键的不是“迁完”，而是：

- 每迁一个工具都要消掉一类重复样板
- 优先从低风险工具开始，建立迁移模板
- `PrefabToolsV2` 必须彻底摆脱 `legacyPrefabTools`

---

## 2. 本 Step 总体策略

按风险分波次迁移，而不是按文件大小或类别名机械推进。

| 波次 | 工具 | 目标 |
|------|------|------|
| Wave A | `undo-tools.ts`、`array-property-tools.ts`、`scene-script-tools.ts` | 验证 `BaseToolExecutor`、`serializer`、`async/await` 模板 |
| Wave B | `preferences-tools.ts`、`project-tools.ts`、`animation-tools.ts` | 验证 Editor Bridge 与错误码接入 |
| Wave C | `prefab-tools.ts` | 迁出 v1 核心逻辑，删除 legacy 依赖 |
| Wave D | `debug-tools.ts` | 接入结构化错误与日志语义 |
| Wave E | `scene-tools.ts`、`asset-tools.ts`、`node-tools.ts`、`component-tools.ts` | 处理大体量高耦合工具 |

---

## 3. 通用迁移模板

每个工具文件统一按以下顺序改：

1. 改为继承 `BaseToolExecutor`
2. 删除重复 `switch + default throw`
3. 删除 `return new Promise(resolve => ...)`
4. 接入 `makeError()` / `normalizeUnknownError()`
5. 替换散落的 `Editor.Message.request()` 为 bridge
6. 复用 `CommonSchemas`
7. 复用 `safeSerialize()`
8. 补一条 smoke test 或手测记录

要求：

- 同一轮迁移只处理一个工具文件的主要行为改造。
- 不要顺手再改 unrelated 逻辑。

---

## 4. Wave A：低风险试点

### 4.1 `undo-tools.ts`

目标：

- 验证 `BaseToolExecutor`
- 验证结构化错误返回

实施点：

- 用 `handlers` 替换 `execute()` 的手写分发
- 用 `async/await` 替换 Promise 包装

### 4.2 `array-property-tools.ts`

目标：

- 再验证一遍基类和 schema 复用
- 看 `CommonSchemas.uuid` / `actionEnum()` 是否足够用

### 4.3 `scene-script-tools.ts`

目标：

- 替换自定义序列化逻辑
- 统一超长结果截断策略

这个波次完成后，必须沉淀一份迁移模板 commit，后续工具直接照模板推进。

---

## 5. Wave B：桥接层消费者

### 5.1 `preferences-tools.ts`

当前问题：

- 存在 `(Editor.Message.request as any)(...)` 这类类型逃逸

改造目标：

- 完全切到 `preferences-messages.ts`
- 删除类型逃逸

### 5.2 `project-tools.ts`

改造目标：

- 切到 `builder-messages.ts`
- 明确构建相关错误码，区分参数问题和构建失败

### 5.3 `animation-tools.ts`

改造目标：

- 接入 `scene/animation-context.ts`
- 不再从大 `scene.ts` 文件里偷拿上下文逻辑

---

## 6. Wave C：Prefab v1 退役

### 6.1 当前真实问题

`source/tools/v2/prefab-tools.ts` 仍然：

```typescript
import { PrefabTools } from '../prefab-tools';
private legacyPrefabTools = new PrefabTools();
```

并把以下能力委托给 v1：

- `create_prefab`
- `duplicate_prefab`

而旧 `source/tools/prefab-tools.ts` 还有两个重要事实：

- `create_prefab` 确实有多策略逻辑：`asset-db -> native -> custom`
- `duplicate_prefab` 当前实际上返回“暂时不可用”，并不是真正稳定能力

### 6.2 迁移目标

本次不是“把 legacy import 改个位置”，而是：

1. 把 `create_prefab` 的多策略主流程搬到 v2。
2. 判断 `duplicate_prefab` 的真实交付策略：
   - 如果要支持，就在 v2 内补完整实现。
   - 如果短期不支持，就在 v2 内明确返回结构化错误，不再委托 v1。
3. 删除 `legacyPrefabTools` 字段。
4. 删除 `source/tools/prefab-tools.ts`。

### 6.3 推荐重构方式

把 Prefab 细节逻辑抽到独立 helper / service，而不是继续往 `PrefabToolsV2` 塞 1000+ 行：

```text
source/tools/prefab/
├── prefab-create-service.ts
├── prefab-duplicate-service.ts
├── prefab-instance-service.ts
└── prefab-asset-utils.ts
```

职责建议：

- `prefab-create-service.ts`
  - `asset-db` 创建策略
  - native fallback
  - custom fallback
- `prefab-duplicate-service.ts`
  - 读取源 prefab
  - 重写 uuid / fileId / meta
  - 写入目标 prefab
- `prefab-instance-service.ts`
  - instantiate
  - apply
  - revert
  - restore
- `prefab-asset-utils.ts`
  - 读取 prefab JSON
  - 写 meta
  - 重写标识引用

### 6.4 Prefab 迁移执行顺序

1. 先把 v1 `create_prefab` 相关 helper 拆出来。
2. 让 v2 直接调用新 helper，而不是调用 v1 类。
3. 明确 `duplicate` 最终策略并落到 v2。
4. 删除 v1 import 和 `legacyPrefabTools`。
5. `rg "legacyPrefabTools|from '../prefab-tools'|from \"../prefab-tools\""` 结果归零。
6. 删除 `source/tools/prefab-tools.ts`。

### 6.5 Prefab 验收项

必须至少手测：

- `prefab_create` `action=from_node`
- `prefab_create` `action=instantiate`
- `prefab_create` `action=duplicate`
- `prefab_update` `action=apply`
- `prefab_update` `action=revert`

---

## 7. Wave D：Debug 工具

改造目标：

- 明确 `debug_logs` / `debug_execute` / `debug_inspect` 的错误码
- 为 Step 5 的请求日志中间件做接线准备
- 统一敏感参数截断和执行日志输出

---

## 8. Wave E：重型工具

### 8.1 迁移顺序

严格按以下顺序：

1. `scene-tools.ts`
2. `asset-tools.ts`
3. `node-tools.ts`
4. `component-tools.ts`

原因：

- `node-tools.ts` 常常依赖场景查询与创建能力
- `component-tools.ts` 复杂度最高，且容易反向影响节点和 prefab

### 8.2 重型工具迁移要求

- 每个文件单独提交
- 每个文件至少保留一份人工验证记录
- 禁止和其他大文件混改

### 8.3 特别关注点

`component-tools.ts`：

- 当前文件体量最大
- 很可能包含本项目最多的重复序列化和属性写入逻辑
- 最后处理，避免前期风险放大

---

## 9. 验收标准

### L1 编译验证

```bash
npm run build
```

### L2 MCP 验证

验证 `tools/list` 和关键工具调用仍然可用。

### L3 手测

最少覆盖：

- 设置偏好
- 项目构建
- 动画剪辑最小链路
- 预制体创建 / 实例化 / 应用 / 回退
- 节点创建与组件修改

### 9.1 主要回归测试用例

#### TC-4-A-01：Wave A 试点工具迁移模板有效

- 前置条件：`undo-tools.ts`、`array-property-tools.ts`、`scene-script-tools.ts` 至少完成一个。
- 操作：
  - 调用已迁移工具的成功路径。
  - 调用错误参数路径。
- 预期：
  - 统一走 `BaseToolExecutor`。
  - 成功路径正常，错误路径返回结构化错误。

#### TC-4-A-02：`scene-script-tools.ts` 结果序列化不回归

- 前置条件：脚本工具已切到统一 serializer。
- 操作：执行会返回复杂对象的脚本。
- 预期：
  - 返回被安全序列化。
  - 不因对象深度或循环引用导致调用失败。

#### TC-4-B-01：`preferences-tools.ts` 去除类型逃逸后仍可读写

- 前置条件：`preferences-tools.ts` 已接入 bridge。
- 操作：查询一次偏好，再修改一次偏好。
- 预期：
  - 不再依赖 `(Editor.Message.request as any)`。
  - 功能行为保持一致。

#### TC-4-B-02：`project-tools.ts` 和 `animation-tools.ts` 接线正常

- 前置条件：Wave B 完成。
- 操作：
  - 执行一次项目查询或构建相关调用。
  - 执行一次动画 clip 查询或编辑。
- 预期：
  - 返回正确结果。
  - 错误码可区分参数错误和 Editor 调用失败。

#### TC-4-C-01：Prefab `from_node` 不再依赖 v1

- 前置条件：Prefab create 逻辑已迁入 v2/service。
- 操作：调用 `prefab_create`，`action=from_node`。
- 预期：
  - 成功创建 prefab。
  - 代码路径不再实例化 `PrefabTools` v1。
  - 结果中包含新 prefab 路径 / uuid 或等价成功信息。

#### TC-4-C-02：Prefab `instantiate` / `apply` / `revert` 链路完整

- 前置条件：Prefab 实例链路已接入新实现。
- 操作：
  1. 实例化 prefab
  2. 修改实例
  3. `prefab_update action=apply`
  4. 再修改实例
  5. `prefab_update action=revert`
- 预期：
  - 实例创建成功。
  - apply 后资源被更新。
  - revert 后实例回到资源状态。

#### TC-4-C-03：Prefab `duplicate` 策略明确且自洽

- 前置条件：`duplicate` 已在 v2 定案。
- 操作：调用 `prefab_create action=duplicate`。
- 预期二选一：
  - 如果支持：生成目标 prefab，元数据与引用正确。
  - 如果暂不支持：返回明确的结构化错误和限制说明。
- 补充预期：
  - 不再通过 v1 `duplicate_prefab` 委托。

#### TC-4-C-04：legacy 依赖已清零

- 前置条件：准备删除 v1 prefab 文件。
- 操作：执行：

```bash
rg "legacyPrefabTools|from '../prefab-tools'|from \"../prefab-tools\"" source
```

- 预期：
  - 搜索结果为空。

#### TC-4-E-01：重型工具迁移不破坏核心编辑链路

- 前置条件：Wave E 中对应工具已迁移。
- 操作：
  1. `scene_query` 获取上下文
  2. `node_create` 创建节点
  3. `component_add` 或 `component_modify` 修改组件
  4. `asset_query` 查询相关资源
- 预期：
  - 整条 AI 常用编辑链路可用。
  - 无因 bridge、base-tool 或 schema 迁移造成的参数兼容性回归。

### 完成标记

- [ ] Wave A 完成
- [ ] Wave B 完成
- [ ] Prefab v1 依赖已剪除
- [ ] `source/tools/prefab-tools.ts` 已删除
- [ ] 所有迁移工具已切到 `BaseToolExecutor` 或给出保留理由
- [ ] 无遗留 `legacyPrefabTools`

---

## 10. 回滚策略

- 每个 wave 单独提交。
- Prefab 退役前打 tag。
- 删除 `source/tools/prefab-tools.ts` 必须放在最后一个独立提交。
- 如果 prefab 回归，只回滚 prefab wave，不回滚前面已稳定的基础设施波次。
