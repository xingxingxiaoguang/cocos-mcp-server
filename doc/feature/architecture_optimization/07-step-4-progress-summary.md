# Step 4 迁移进度总结（当前工作面）

> 更新时间：2026-04-09  
> 目标：记录当前已完成内容、未完成内容，以及下一步应如何继续推进  
> 适用范围：本轮 `architecture_optimization` 改动涉及的 `source/` 与 `doc/` 目录

---

## 1. 当前结论

本轮已经完成以下关键方向：

1. `scene` 已迁入 `tool -> capability -> contract/driver`
2. `prefab` 已完成 legacy 入口切流并删除旧实现
3. `asset / node / component` 已迁入 capability + driver 骨架，tool 层不再直连 `Editor.Message.request(...)`
4. `editor-bridge/runtime/` 已迁到更中立的 `source/runtime/`
5. `scene` 命名歧义已消除：
   - `source/cocos-entry.ts`
   - `source/cocos-runtime/`
   - `source/runtime/`
6. `animation / preferences / prefab` 的 bridge 反向依赖 capability type 已按方案 A 收敛

当前代码已经通过：

```bash
npm run build

npm run smoke:asset
npm run smoke:component
npm run smoke:node
npm run smoke:prefab
npm run smoke:scene
npm run smoke:preferences
npm run smoke:animation
npm run smoke:project
```

---

## 2. 已完成项

### 2.1 入口与运行时命名治理

已完成：

- `source/scene.ts` → `source/cocos-entry.ts`
- `source/scene/` → `source/cocos-runtime/`
- `source/editor-bridge/runtime/` → `source/runtime/`
- `package.json` 的 scene script 入口已同步到 `./dist/cocos-entry.js`

意义：

- `cocos-entry` 明确表示 Cocos scene script 入口
- `cocos-runtime` 明确表示 scene script 运行时实现
- `runtime` 明确表示主进程侧 profile / capability 装配

---

### 2.2 Scene 领域已完成标准三层迁移

已完成：

- `source/capabilities/scene/interface.ts`
- `source/capabilities/scene/service.ts`
- `source/editor-bridge/scene/contract.ts`
- `source/editor-bridge/scene/driver.ts`
- `source/tools/v2/scene-tools.ts`
- `source/test/scene-capability-smoke.ts`

状态：

- tool 层不再直连 `Editor.Message.request(...)`
- capability 层负责业务语义
- driver 层负责 scene / asset-db 协议与 fallback

---

### 2.3 Prefab 领域已完成 legacy 切流

已完成：

- `source/capabilities/prefab/interface.ts`
- `source/capabilities/prefab/service.ts`
- `source/editor-bridge/prefab/contract.ts`
- `source/editor-bridge/prefab/driver.ts`
- `source/tools/v2/prefab-tools.ts` 已改为直连 capability
- `source/test/prefab-capability-smoke.ts`

已删除：

- `source/tools/prefab-tools.ts`
- `source/tools/prefab/interface.ts`
- `source/test/prefab-tools-test.ts`

状态：

- `PrefabToolsV2` 不再依赖 `legacyPrefabTools`
- prefab 已是 runtime registry 中的一等 capability

---

### 2.4 Asset / Node / Component 已完成第一轮迁移

已完成：

- `source/capabilities/asset/`
- `source/capabilities/node/`
- `source/capabilities/component/`
- `source/editor-bridge/asset/`
- `source/editor-bridge/node/`
- `source/editor-bridge/component/`

已完成的结构性目标：

- `source/tools/v2/asset-tools.ts`
- `source/tools/v2/node-tools.ts`
- `source/tools/v2/component-tools.ts`

现在都只保留：

- tool schema
- tool name
- capability 路由

不再保留：

- `Editor.Message.request(...)`

已补 smoke：

- `source/test/asset-capability-smoke.ts`
- `source/test/node-capability-smoke.ts`
- `source/test/component-capability-smoke.ts`

---

### 2.5 反向依赖收敛（方案 A）

已完成：

- `source/editor-bridge/animation/contract.ts`
- `source/editor-bridge/preferences/contract.ts`
- `source/editor-bridge/prefab/contract.ts`

状态：

- bridge contract 不再 import capability 的领域类型
- capability service 负责把 bridge DTO 映射为 capability DTO

---

### 2.6 Runtime 装配层拆分

已完成：

- `source/runtime/profile.ts`
- `source/runtime/interface.ts`
- `source/runtime/capability-registry.ts`

状态：

- `CapabilityRegistry` 类型已独立
- `capability-registry.ts` 只保留装配逻辑与默认实例缓存

---

## 3. 当前未完成项

虽然 `asset/node/component/prefab/scene` 都已经进入 capability/driver 架构，但还没有全部达到“理想收口态”。

### 3.1 Node 仍然偏胖

当前状态：

- `source/capabilities/node/service.ts` 仍有约 900+ 行

已经下沉/拆出的部分：

- 节点归一化、树 flatten、cidMap 构建：
  - `source/capabilities/node/normalizer.ts`
- 默认 spriteFrame 解析：
  - `source/capabilities/node/sprite-frame-resolver.ts`

仍待继续下沉的内容：

- `queryByPattern` / `queryAll` 的 fallback 组合
- `copy / paste / cut / duplicate / move` 的协议级动作包装
- 部分 `queryByUuid` 的 direct/fallback 组合
- `createNodeFromSpec` 里与协议细节耦合的部分

判断：

- 现在 `NodeService` 已明显更干净
- 但仍混着“业务编排”和“协议级适配”

---

### 3.2 Component 仍然偏胖

当前状态：

- `source/capabilities/component/service.ts` 仍然很长

主要原因：

- 组件属性设置逻辑复杂
- 含大量 descriptor 分析 / 类型推断 / 引用解析
- direct API 与 scene-script fallback 组合还在 service 内

仍待继续下沉的内容：

- `queryComponents/queryNode/executeSceneScript` 的组合查询
- `createComponent/removeArrayElement/resetComponent/executeComponentMethod` 的协议包装
- `set-property` 多分支写入策略中更底层的一层
- 资产引用解析的协议部分

判断：

- Component 目前处于“能用、已分层、但 service 过胖”的中间态

---

### 3.3 Asset 仍然偏胖

当前状态：

- `source/capabilities/asset/service.ts` 仍承担大量资产扫描和引用分析

其中两类逻辑应继续区分：

- 适合保留在 capability：
  - unused/dependencies 之类跨多步分析
  - manifest 导出
- 适合继续下沉到 driver：
  - `query-asset-info / query-assets / read-asset / query-asset-meta`
  - `create / move / copy / save / reimport / delete / refresh`
  - 各种单次 asset-db mutation

判断：

- Asset 已完成“工具层减负”
- 但 driver 语义化深度仍不够

---

### 3.4 文档尚未系统跟进

当前仅做了必要同步：

- `cocos-entry / cocos-runtime / runtime` 命名
- 关键架构说明路径更新

仍未系统补齐：

- `asset/node/component` 迁移完成度说明
- Step 4 的完成勾选
- 新的 smoke test 清单
- README 中更完整的新目录树说明

---

## 4. 当前推荐做法（How to continue）

建议继续按“driver 增厚、service 减负”的方向推进，而不是再加新层。

### 4.1 Node 下一步建议

优先处理：

1. 将查询 fallback 组合下沉到 `source/editor-bridge/node/driver.ts`
   - `queryByUuid`
   - `queryByPattern`
   - `queryAll`
2. 将剪贴板/排列动作进一步语义化
   - `move`
   - `duplicate`
   - `copy`
   - `paste`
   - `cut`
3. 保留在 service 的只应该是：
   - 创建节点后挂组件
   - 初始 transform 编排
   - Sprite 默认资源策略

### 4.2 Component 下一步建议

优先处理：

1. 抽 `component query / fallback` helper
2. 抽 `component property write` adapter/helper
3. 把更底层的 `set-property` 分支写法从 service 中继续下沉
4. 保留在 service 的只应该是：
   - 组件业务规则
   - batch set 的业务决策
   - descriptor 级别的少量能力语义

### 4.3 Asset 下一步建议

优先处理：

1. 给 `AssetBridgeDriver` 增加命名动作
   - `getAssetDbReady`
   - `resolveAsset`
   - `queryAssets`
   - `readAssetContent`
   - `readAssetMeta`
   - `createAsset`
   - `moveAsset`
   - `copyAsset`
   - `saveAsset`
   - `reimportAsset`
   - `deleteAssets`
   - `refreshAssets`
2. capability 保留：
   - unused/dependencies 分析
   - export manifest
   - 引用校验

---

## 5. 哪些算“已经做完”

以下可以视为本轮已完成：

- `scene` capability 三层迁移
- `prefab` legacy tool 切流与旧实现删除
- `asset/node/component` 工具层不再直连 Editor 协议
- runtime 命名治理
- bridge 反向依赖 capability type 收敛

以下不能视为已完全做完：

- `asset/node/component` driver 语义化深化
- `node/component` service 继续瘦身
- 文档与 Step 4 完成勾选的系统同步

---

## 6. 当前风险

### 风险 1：Node / Component service 仍过胖

现状：

- 不是“分层错了”，而是“下沉还没下够”

风险：

- 继续在 service 加新逻辑，会把 service 再次堆胖

应对：

- 新增逻辑优先判断是否属于 driver 语义动作

### 风险 2：Asset 仍像“重逻辑工具搬家”

现状：

- 资产分析逻辑和底层协议动作还混得比较近

风险：

- 后续继续改 asset 时会出现 service 持续膨胀

应对：

- 先把 asset-db 单次操作收口，再保留 capability 分析逻辑

### 风险 3：文档与代码完成度感知不一致

现状：

- 代码已经明显前进
- 但 Step 4 文档还没有完整打勾

风险：

- 后续接手者容易误判哪些已经做完、哪些还只是骨架

应对：

- 下一轮应补一份更正式的 Step 4 状态同步文档

---

## 7. 建议的下一步执行顺序

建议继续按下面顺序：

1. `node` 第二轮瘦身
2. `component` 第二轮瘦身
3. `asset` driver 语义化增强
4. 同步更新 `05-phase-4-domain-migration-prefab-refactor.md` 完成标记

不建议现在做的事：

- 不建议重新调整目录大结构
- 不建议再引入 `use-case` 层
- 不建议跨多个重型领域混成一次大改

---

## 8. 快速核对清单

如果要继续本工作面，先确认以下命令仍通过：

```bash
npm run build

npm run smoke:asset
npm run smoke:component
npm run smoke:node
npm run smoke:prefab
npm run smoke:scene
npm run smoke:preferences
npm run smoke:animation
npm run smoke:project
```

---

## 9. 一句话总结

当前仓库已经从“工具层直连 Editor 协议 + prefab legacy 混用”推进到了：

> `tool 变薄、capability 成形、driver 开始语义化、legacy prefab 已退役`

但 `asset/node/component` 还没有完全到达最终理想形态，后续重点应是：

> **继续把协议适配和 fallback 从 service 压到 driver，把 capability 收敛成真正的业务编排层。**
