# Step 2: 基础模块建设

> 前置依赖：Step 1  
> 预计改动量：中  
> 目标：为后续迁移准备过渡性基础模块，包括统一类型入口、统一序列化、统一错误码、统一 schema 与统一执行基类

> 历史说明（2026-04-09）：
> 本 Step 的 `source/types/` 拆分是过渡态，当前仓库已完成后续演进：
> `source/types/` 已删除；
> 协议类型位于 `source/mcp/interface.ts`；
> 工具配置类型位于 `source/tools/interface.ts`；
> 基础 JSON 类型位于 `source/json.ts`；
> 领域类型按领域目录归位。

---

## 1. 背景

当前的公共基础设施处于“各文件各写一份”的状态：

- `types/index.ts` 混合协议、配置、领域模型
- 序列化逻辑至少有三份
- 错误只有 `{ success: false, error: string }`
- `uuid` / `path` / `action` 等 schema 到处复制
- 每个工具类都重复 `execute()` 分发和 Promise 包装

这些问题不先解决，后续工具迁移会持续放大重复代码。

补充约束：

- 本 Step 中对 `source/types/` 的拆分是过渡态，不是最终类型归属方案。
- 从 Step 3 开始，capability / bridge / shared 类型必须继续从 `source/types/` 迁出，不能把本 Step 的临时整理误当成终局结构。

---

## 2. 本 Step 交付物

### 2.1 新增文件

```text
source/types/mcp.ts
source/types/domain.ts
source/types/config.ts
source/types/editor.ts
source/utils/serializer.ts
source/utils/error-codes.ts
source/tools/schemas/common.ts
source/tools/base-tool.ts
```

### 2.2 修改文件

```text
source/types/index.ts
source/scene.ts
source/tools/v2/component-tools.ts
source/tools/v2/scene-script-tools.ts
source/tools/v2/prefab-tools.ts
```

说明：

- 本 Step 不要求大规模迁移全部工具。
- 只允许做最小接线或试点替换，核心迁移留到 Step 4。

---

## 3. 模块设计

### 3.1 类型分层

建议拆分如下，作为 Step 2 的过渡性整理：

- `mcp.ts`
  - `ToolDefinition`
  - `ToolResponse`
  - `ToolExecutor`
  - `ServerStatus`
- `domain.ts`
  - `NodeInfo`
  - `ComponentInfo`
  - `PrefabInfo`
  - `AnimationClipInfo`
- `config.ts`
  - `MCPServerSettings`
  - `ToolConfig`
  - `ToolConfiguration`
  - `ToolManagerSettings`
- `editor.ts`
  - 对 `scene` / `asset-db` / `preferences` 返回值的最小声明

`source/types/index.ts` 保留 re-export，避免一次性改全仓 import；但这只用于兼容过渡，自 Step 3 起不再承接新增 capability / bridge / shared 类型。

### 3.2 统一序列化

新增 `source/utils/serializer.ts`：

```typescript
export interface SerializeOptions {
  maxDepth?: number;
  maxArrayLength?: number;
  maxObjectKeys?: number;
}

export function safeSerialize(value: unknown, options?: SerializeOptions): unknown;
```

默认策略建议：

- `maxDepth = 4`
- `maxArrayLength = 100`
- `maxObjectKeys = 50`

允许调用方覆盖，但不允许再复制实现。

### 3.3 错误码体系

新增 `source/utils/error-codes.ts`：

```typescript
export enum ToolErrorCode {
  INVALID_ARGS = 'INVALID_ARGS',
  MISSING_REQUIRED = 'MISSING_REQUIRED',
  NODE_NOT_FOUND = 'NODE_NOT_FOUND',
  ASSET_NOT_FOUND = 'ASSET_NOT_FOUND',
  SCENE_NOT_OPEN = 'SCENE_NOT_OPEN',
  EDITOR_API_FAILED = 'EDITOR_API_FAILED',
  UNSUPPORTED_VERSION = 'UNSUPPORTED_VERSION',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}
```

同时提供：

- `makeError(code, message, extra?)`
- `normalizeUnknownError(error, fallbackCode?)`

### 3.4 公共 schema

新增 `source/tools/schemas/common.ts`：

- `uuid`
- `uuids`
- `path`
- `dbPath`
- `actionEnum(values, description)`

要求：

- 只抽稳定字段
- 不为了复用而制造复杂 schema DSL

### 3.5 `BaseToolExecutor`

新增 `source/tools/base-tool.ts`：

```typescript
export abstract class BaseToolExecutor implements ToolExecutor {
  protected abstract readonly handlers: Record<string, (args: any) => Promise<ToolResponse>>;
  abstract getTools(): ToolDefinition[];

  async execute(toolName: string, args: any): Promise<ToolResponse> {
    const handler = this.handlers[toolName];
    if (!handler) {
      return makeError(ToolErrorCode.INVALID_ARGS, `Unknown tool: ${toolName}`);
    }
    try {
      return await handler(args);
    } catch (error) {
      return normalizeUnknownError(error);
    }
  }
}
```

---

## 4. 执行步骤

### 4.1 先拆 types，保持兼容

- 新建 `mcp.ts` / `domain.ts` / `config.ts` / `editor.ts`
- `index.ts` 全量 re-export
- 本阶段不强制逐文件改 import 路径
- 这一步只解决“先分开、先可迁移”，不代表 `source/types/` 仍然是后续新架构的长期归宿

### 4.2 引入统一 serializer

先把三份实现迁到一个地方，再做接入：

- `scene.ts` 的 `safeSerialize()`
- `scene-script-tools.ts` 的 `serializeResult()`
- `component-tools.ts` 的 `serializeToolResult()`

先完成统一模块，再视风险挑一个低风险调用点切换。

### 4.3 引入错误码与错误工厂

- 不要求一次性改掉所有旧返回
- 先让新基类、后续迁移工具有统一出口

### 4.4 引入公共 schema

- 先在新增或轻量工具里使用
- 重型工具统一切换放到 Step 4

### 4.5 落 `BaseToolExecutor`

要求：

- 先通过一个低风险样例验证设计
- 不要在本 Step 同时迁移 `node-tools.ts` / `component-tools.ts`

推荐试点：

- `undo-tools.ts`
- `array-property-tools.ts`

如果试点成本过高，也可以只通过独立 smoke test 验证基类行为。

---

## 5. 设计约束

- `ToolResponse` 新增 `errorCode` 时，必须保持旧消费方兼容。
- `serializer.ts` 必须处理循环引用、深层对象、大数组截断。
- `BaseToolExecutor` 不使用字符串反射，不允许 `(this as any)[toolName]`。
- `types/index.ts` 在 Step 4 完成前不能删除。
- `source/types/` 只作为兼容过渡层保留；自 Step 3 起不得继续新增 capability、bridge 或 shared 类型。

---

## 6. 验收标准

### L1 编译验证

```bash
npm run build
```

### L2 基础模块验证

至少验证：

- `serializer.ts` 能处理循环对象
- `makeError()` 产出结构化错误
- `BaseToolExecutor` 未知工具名时返回 `INVALID_ARGS`
- `types/index.ts` 兼容旧 import

### 6.1 主要回归测试用例

#### TC-2-01：`types/index.ts` 兼容旧引用

- 前置条件：类型拆分完成。
- 操作：执行 `npm run build`，重点观察旧文件 import 是否需要大规模改动。
- 预期：
  - 老 import 不因拆分直接失效。
  - 新类型文件已可被独立引用。

#### TC-2-02：统一 serializer 处理循环引用

- 前置条件：已新增 `safeSerialize()`。
- 操作：传入循环对象、深层对象、大数组。
- 预期：
  - 不抛异常。
  - 深度、数组长度、对象键数按预设截断。
  - 输出格式与工具调用场景兼容。

#### TC-2-03：三个旧序列化调用点行为一致

- 前置条件：至少一个试点工具已切到新 serializer。
- 操作：
  - 用同一份复杂输入分别走场景侧、组件侧、脚本侧序列化路径。
- 预期：
  - 截断行为一致。
  - 不再出现一边能序列化、一边直接爆对象的差异。

#### TC-2-04：错误码工厂兼容旧消费方

- 前置条件：`ToolResponse` 已支持 `errorCode`。
- 操作：构造参数错误、内部错误、未知错误三类结果。
- 预期：
  - 返回仍包含 `success` / `error`。
  - 新增 `errorCode` 可用。
  - 旧 UI 或调用方不会因多一个字段而崩溃。

#### TC-2-05：`BaseToolExecutor` 正确分发与兜底

- 前置条件：存在一个试点工具或独立 mock executor。
- 操作：
  - 调用已注册 handler。
  - 调用不存在的 toolName。
  - 让 handler 主动抛错。
- 预期：
  - 已注册 handler 正常执行。
  - 未知工具名返回 `INVALID_ARGS`。
  - 抛错能被 `normalizeUnknownError()` 统一收口。

#### TC-2-06：公共 schema 复用不改变现有参数语义

- 前置条件：至少一个轻量工具使用 `CommonSchemas`。
- 操作：对该工具进行原有参数调用。
- 预期：
  - 参数名仍是 `uuid` / `path` / `action` 等原语义。
  - 不因抽 schema 导致必填项或描述错乱。

### 完成标记

- [x] 已拆分 `source/types/`
- [x] 已新增 `serializer.ts`
- [x] 已新增 `error-codes.ts`
- [x] 已新增 `schemas/common.ts`
- [x] 已新增 `base-tool.ts`
- [x] 基础模块存在最小测试或 smoke 验证

---

## 7. 回滚策略

- 先落新增模块，再接线旧代码。
- 新增模块本身几乎无回滚风险，可长期保留。
- 若某个试点工具接入后出问题，只回滚该工具接线，不回滚基础模块定义。
