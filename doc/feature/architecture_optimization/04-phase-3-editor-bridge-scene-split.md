# Step 3: Editor Bridge 建设与 `scene.ts` 拆分

> 前置依赖：Step 2  
> 预计改动量：大  
> 目标：收敛 Editor API 魔法字符串，拆分 `scene.ts` 的多重职责，但保留稳定入口

---

## 1. 背景

当前 Editor API 调用分散在工具文件和 `scene.ts` 中：

- `Editor.Message.request('scene', ...)`
- `Editor.Message.request('asset-db', ...)`
- `Editor.Message.request('preferences', ...)`
- `Editor.Message.request('builder', ...)`

问题不只在“字符串分散”，更在于：

- fallback 逻辑不统一
- 返回值没有类型边界
- Cocos 版本变动时没有集中适配点
- `scene.ts` 同时混杂序列化、节点查找、动画上下文和 fallback

---

## 2. 本 Step 交付物

### 2.1 新增文件

```text
source/editor-bridge/message-constants.ts
source/editor-bridge/scene-messages.ts
source/editor-bridge/asset-messages.ts
source/editor-bridge/preferences-messages.ts
source/editor-bridge/builder-messages.ts
source/editor-bridge/index.ts

source/scene/methods.ts
source/scene/node-registry.ts
source/scene/animation-context.ts
source/scene/editor-fallback.ts
source/scene/serialization.ts
```

### 2.2 修改文件

```text
source/scene.ts
source/tools/v2/preferences-tools.ts
source/tools/v2/project-tools.ts
source/tools/v2/animation-tools.ts
```

说明：

- 本 Step 允许只迁移少量低风险调用点做贯通验证。
- 全量工具接入 bridge 留到 Step 4。

---

## 3. Editor Bridge 设计

### 3.1 消息常量集中化

`message-constants.ts` 统一定义所有消息名：

```typescript
export const SCENE_MSG = {
  QUERY_NODE: 'query-node',
  CREATE_NODE: 'create-node',
  SET_PROPERTY: 'set-property',
  APPLY_PREFAB: 'apply-prefab',
} as const;
```

要求：

- 后续业务代码不再直接写 `'query-node'` 这类常量。
- 如果消息名存在版本差异，在 bridge 中处理，不向业务层泄漏。

### 3.2 Wrapper 职责

以 `scene-messages.ts` 为例，负责：

- 参数整理
- 返回值类型声明
- 错误转译
- fallback 兼容

不要把复杂业务判断塞进 bridge，bridge 只做“协议适配层”。

### 3.3 Fallback 收口

现有 `tryEditorThenEngine<T>()` 应迁入 `source/scene/editor-fallback.ts`，并允许：

- `scene.ts` 内复用
- 后续 bridge 层复用
- 未来单测或 smoke test 验证

---

## 4. `scene.ts` 拆分方案

### 4.1 保留 facade

`source/scene.ts` 不删除，保持为 Cocos 注册入口：

```typescript
export { methods } from './scene/methods';
```

这样可以降低 `package.json` scene 脚本接入变更风险。

### 4.2 模块职责

- `scene/methods.ts`
  - 导出场景脚本 methods
- `scene/node-registry.ts`
  - `findNodeByUuid`
  - 节点遍历与注册
- `scene/animation-context.ts`
  - 动画编辑上下文与缓存
- `scene/editor-fallback.ts`
  - `tryEditorThenEngine`
- `scene/serialization.ts`
  - 场景侧序列化工具

### 4.3 拆分顺序

1. 先复制并移动，不改行为。
2. 跑通编译和场景脚本加载。
3. 再开始清理旧 `scene.ts` 中的重复实现。

不要一上来边拆边重构逻辑。

---

## 5. 执行步骤

### 5.1 建桥接目录和常量

优先覆盖高频消息：

- `scene`
- `asset-db`
- `preferences`
- `builder`

### 5.2 迁 `scene.ts` 内部基础模块

迁移顺序建议：

1. `safeSerialize`
2. `tryEditorThenEngine`
3. 节点查询与遍历
4. 动画上下文
5. `methods` 汇总导出

### 5.3 选低风险工具打通 bridge

推荐先迁：

- `preferences-tools.ts`
- `project-tools.ts`
- `animation-tools.ts`

原因：

- 这些工具耦合面相对窄
- 可以较快验证 bridge 是否可用
- 不会像 `node-tools.ts` / `component-tools.ts` 一样牵动大量逻辑

### 5.4 建立直接调用禁令

从这个 Step 开始，新增代码不得继续写：

```typescript
Editor.Message.request('scene', ...)
Editor.Message.request('asset-db', ...)
```

必须改为通过 `editor-bridge/` 进入。

---

## 6. 验收标准

### L1 编译验证

```bash
npm run build
```

### L2 场景脚本稳定性验证

重点验证：

- 扩展启动后 scene 脚本正常注册
- `package.json` 中 `scene.methods` 能正常调用
- `scene.ts` 改为 facade 后无加载异常

### L3 手测

至少手测以下链路：

- 查询节点
- 创建节点
- 读取资源信息
- 动画相关最小调用

### 6.1 主要回归测试用例

#### TC-3-01：scene 脚本入口 facade 可正常加载

- 前置条件：`source/scene.ts` 已改为 facade。
- 操作：重载扩展并触发任一 `package.json` 注册的 scene 方法。
- 预期：
  - scene 脚本可加载。
  - 方法调用无 `module not found` 或导出缺失错误。

#### TC-3-02：`editor-bridge` 对 scene 调用的封装正确

- 前置条件：`scene-messages.ts` 已落地。
- 操作：
  - 调用节点查询。
  - 调用节点创建。
  - 调用节点属性设置。
- 预期：
  - 结果与旧直接 `Editor.Message.request('scene', ...)` 行为一致。
  - 消息名不再散落在业务工具内。

#### TC-3-03：低风险工具 bridge 迁移不回归

- 前置条件：`preferences-tools.ts`、`project-tools.ts`、`animation-tools.ts` 至少迁移一个。
- 操作：执行对应最小链路：
  - preferences：读一次配置，再改一次配置
  - project：查询一次项目，再触发一次构建配置读取或构建动作
  - animation：查询一次 clip 或属性
- 预期：
  - 功能成功。
  - 报错能定位到 bridge 层而不是散落调用点。

#### TC-3-04：`tryEditorThenEngine` fallback 行为保真

- 前置条件：fallback 逻辑已迁入 `scene/editor-fallback.ts`。
- 操作：构造一次 Editor API 路径失败、Engine 路径可用的场景。
- 预期：
  - fallback 能按原逻辑生效。
  - 错误信息不被吞掉。

#### TC-3-05：节点注册与遍历拆分后结果一致

- 前置条件：节点查询和遍历逻辑已拆到 `scene/node-registry.ts`。
- 操作：
  - 查询一个存在节点。
  - 查询一个不存在节点。
  - 拉取当前场景层级。
- 预期：
  - 存在节点返回正确。
  - 不存在节点返回清晰错误。
  - 层级结构与拆分前一致。

#### TC-3-06：动画上下文拆分后无状态污染

- 前置条件：动画上下文已独立到 `scene/animation-context.ts`。
- 操作：连续编辑两个不同动画资源，再切回第一个资源。
- 预期：
  - 上下文切换正确。
  - 不出现上一个 clip 状态污染当前 clip 的问题。

### 完成标记

- [ ] 已新增 `editor-bridge/`
- [ ] 已新增 `scene/` 拆分目录
- [ ] `source/scene.ts` 已变为 facade
- [ ] 至少 1-3 个低风险工具已接入 bridge
- [ ] 无新增散落的 Editor 魔法字符串

---

## 7. 风险与回滚

### 主要风险

- `scene.ts` facade 变更导致 Cocos 场景脚本加载失败
- 动画上下文拆分时引入隐藏状态问题
- bridge 抽象过厚，反而把业务逻辑挤进适配层

### 回滚建议

- `scene.ts` facade 改动单独提交
- bridge 接入与工具切换拆开提交
- 场景相关问题优先回滚 `scene.ts` 接线，不回滚新目录骨架
