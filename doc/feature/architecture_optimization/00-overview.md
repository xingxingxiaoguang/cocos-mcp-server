# 架构优化实施总览

> 来源：`doc/plan/architecture-optimization-plan.md` v1.2  
> 若与旧 `plan` 文档冲突，以当前 `doc/feature/architecture_optimization/` 实施文档为准  
> 目标：把总体架构规划拆成可顺序执行、可验收、可回滚的实施方案  
> 适用范围：`source/main.ts`、`source/mcp-server.ts`、`source/tools/`、`source/panels/`、`source/scene.ts` 及新增基础设施目录

> 状态同步（2026-04-09）：
> 当前仓库已正式删除 `source/types/`。
> 类型归属基线改为：协议类型进入 `source/mcp/`，工具配置类型进入 `source/tools/`，基础 JSON 类型进入 `source/json.ts`，领域类型随领域目录归位。

---

## 1. 拆解原则

- 先修边界漂移和死代码，再做分层重构，避免在错误契约上继续加代码。
- 先建立单一事实来源，再做工具和场景侧迁移，避免“迁一次、改三处”。
- 历史全局类型垃圾桶治理必须与架构迁移同步执行，不允许把类型归属重构当作“以后再说”的附属任务。
- 当前迁移基线只覆盖 Cocos Creator `3.8.x`，不为假想的多版本兼容预埋额外层级或目录。
- 本轮 Step 3/4 的迁移样板不把 `builder` 能力和 `open-tool-manager` / 遗留面板入口作为主线范围。
- 全程保留兼容 facade，避免一次性大爆炸式重写。
- 每个阶段都要求“编译验证 + 行为验证 + 回滚点”，不接受只有文档完成。

---

## 2. 执行路线

| Step | 文档 | 目标 | 优先级 |
|------|------|------|--------|
| Step 0 | `01-phase-0-ipc-contract-governance.md` | 修复 IPC 契约漂移、注册未实现消息、遗留面板去留 | P0 |
| Step 1 | `02-phase-1-single-registry-main-process-split.md` | 建立单一工具注册源，拆主进程服务职责 | P0 |
| Step 2 | `03-phase-2-foundation-modules.md` | 建基础模块：过渡类型拆分、serializer、error-codes、schema、base-tool | P1 |
| Step 3 | `04-phase-3-capability-layer-scene-split.md` | 建立 `tools -> capabilities -> contract/driver` 三层架构，并拆分 `scene.ts` | P1 |
| Step 4 | `05-phase-4-domain-migration-prefab-refactor.md` | 把重型工具迁入 `capabilities -> contract/driver` 架构，并退役 prefab legacy 实现 | P1-P2 |
| Step 5 | `06-phase-5-panel-logging-governance.md` | 让 Panel、日志、协议解析和开发规范与新分层架构对齐 | P2 |

---

## 3. 依赖关系

```text
Step 0 IPC 契约治理
  ↓
Step 1 单一注册源 + 主进程拆分
  ↓
Step 2 基础模块建设
  ↓
Step 3 Capability Layer + scene 拆分
  ↓
Step 4 重型工具迁移 + Prefab legacy 退役
  ↓
Step 5 Panel / 日志 / 规范收尾
```

关键约束：

- Step 0 完成前，不进入大规模面板或服务层改造。
- Step 1 完成前，不允许继续在 `mcp-server.ts` 和 `tool-manager.ts` 手写新增工具列表。
- Step 2 完成前，不启动大规模工具类迁移，只能做最小接线验证。
- Step 3 完成前，禁止继续新增散落的 `Editor.Message.request('scene' | 'asset-db' | ...)`，并禁止把版本差异逻辑继续写回 tools。
- 自 Step 3 起，类型归属重构必须与领域迁移同步推进：新增 capability/driver/shared 类型不得重新落入全局类型垃圾桶，重型领域迁移时必须同步剪除对应的历史全局类型依赖。
- Step 4 完成前，不删除 `source/scene.ts` facade。
- Step 4 期间，重型工具必须通过 `capability / contract / driver` 迁移，不接受只有 message wrapper 的“伪迁移”。

---

## 4. 每个 Step 的标准输出

每个 Step 至少应交付以下内容：

1. 代码改动落地。
2. 对应文档中的“完成标记”全部勾选。
3. `npm run build` 通过。
4. 至少一条 smoke test、手测记录或可复现验证命令。
5. 明确回滚点。

---

## 5. 通用测试矩阵

| 层次 | 目标 | 最低要求 |
|------|------|----------|
| L1 编译 | 保证类型和模块依赖正确 | `npm run build` |
| L2 主进程 / MCP 冒烟 | 保证工具列表、路由、设置更新不回归 | `health` / `tools/list` / 关键 IPC 调用 |
| L3 编辑器手测 | 保证场景、资源、预制体、面板行为正常 | 在 Cocos Creator 内执行 |

通用命令：

```bash
npm run build

curl -s http://127.0.0.1:3000/health

curl -s -X POST http://127.0.0.1:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

阶段回归重点：

- Step 0：IPC 参数顺序、状态结构、未实现 message 清理
- Step 1：工具注册源一致性、配置同步、服务生命周期拆分
- Step 2：基础模块行为一致性，尤其是 serializer / error-codes / base-tool
- Step 3：分层骨架稳定、scene facade 加载稳定、低风险领域 capability 试点贯通；基础 JSON 类型收敛到 `source/json.ts`，协议类型收敛到 `source/mcp/interface.ts`，工具配置类型收敛到 `source/tools/interface.ts`，领域类型继续回归各自目录
- Step 3 起，`capabilities` 默认按领域组织：`source/capabilities/<domain>/interface.ts + service.ts`，不再按 `models/interfaces/services` 横向扩展
- Step 4：重型工具 capability / contract / driver 迁移不回归，尤其是 prefab legacy 退役后的创建 / 实例化 / 回退链路
- Step 5：默认面板生命周期、请求级日志、严格 JSON 解析与开发规范同步

---

## 6. 分支建议

```text
feature/architecture-optimization
  ├── step-0-ipc-contracts
  ├── step-1-registry-services
  ├── step-2-foundation-modules
  ├── step-3-capability-scene
  ├── step-4-domain-migration
  └── step-5-panel-logging-governance
```

建议做法：

- 每个 Step 单独提交和评审。
- Step 4 内部再按迁移波次拆 commit，不要把所有工具迁移压成一个提交。
- `prefab-tools.ts` 删除前单独保留一个回滚 tag。

---

## 7. 当前阶段重点提醒

- `open-tool-manager` 与旧 `tool-manager` 面板属于历史治理项；当前文档保留记录，但它们不作为本轮 Step 3 重做的主线阻塞项。
- 当前迁移模板只服务于 `3.8.x`；不要为了未来版本预先拆分多套 driver 目录或兼容层。
- `source/mcp-server.ts` 与 `source/tools/tool-manager.ts` 仍各自维护一份工具初始化逻辑，新增 `animation` 后更证明当前不是单一事实来源。
- 仅有 message wrapper 不足以解决 tools 膨胀，Step 3 起必须按 `tools / capabilities / contract / driver` 分层推进。
- `source/types/` 已退役；后续任何架构迁移都必须继续遵守“协议类型回协议、领域类型回领域、基础类型最小化”的归属规则，避免重新长出新的类型垃圾桶。
- `source/tools/v2/prefab-tools.ts` 仍通过 `legacyPrefabTools` 依赖 `source/tools/prefab-tools.ts`，Step 4 必须真正剪掉。

---

## 8. 文档清单

- `01-phase-0-ipc-contract-governance.md`
- `02-phase-1-single-registry-main-process-split.md`
- `03-phase-2-foundation-modules.md`
- `04-phase-3-capability-layer-scene-split.md`
- `05-phase-4-domain-migration-prefab-refactor.md`
- `06-phase-5-panel-logging-governance.md`
