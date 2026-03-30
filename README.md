# Cocos Creator MCP 服务器插件

**[📖 English](README.EN.md)**  **[📖 中文](README.md)**

适用于 Cocos Creator `3.8.6+` 的 MCP（Model Context Protocol）服务器扩展。它将编辑器能力通过本地 HTTP MCP 端点暴露给 AI 客户端，使 Claude、Cursor 等工具可以直接查询和操作场景、节点、组件、预制体、资源与项目配置。

当前代码状态已经完成 v2 工具体系切换，不再是旧版的 150+ 工具集合。README 以下内容以仓库当前实现为准，而不是早期规划稿。

## 当前状态

- 扩展版本：`2.0.0`
- 编辑器要求：`Cocos Creator >= 3.8.6`
- 默认端口：`3000`
- 监听地址：`127.0.0.1`
- MCP 端点：`http://127.0.0.1:3000/mcp`
- 健康检查：`http://127.0.0.1:3000/health`
- 当前工具数：`33`
- 当前类别数：`11`

## 这版已经落地的重点

- 将旧的多类别工具体系收敛为面向 AI 调用的 v2 工具体系。
- 删除 `server_*`、`broadcast_*`、`sceneView_*`、`referenceImage_*`、`validation_*` 等低价值类别。
- 当前核心工具统一为“少工具 + action 分发”的设计，降低 AI 误选和参数幻觉。
- 已切换到 v2 路由与工具管理面板，启动时按当前启用配置暴露工具。
- 节点工具已支持批量创建和内联组件初始化。
- 组件工具已支持批量属性写入。
- 资源查询、未使用资源过滤、预制体创建与实例命名、调试日志与场景检查都做过近期修复。

## 当前工具清单

README 以代码中的真实工具名为准：

| 类别 | 工具 |
| --- | --- |
| `scene` | `scene_query`, `scene_open`, `scene_save`, `scene_create`, `scene_manage` |
| `node` | `node_query`, `node_create`, `node_batch_create`, `node_modify`, `node_delete`, `node_arrange` |
| `component` | `component_query`, `component_add`, `component_modify`, `component_batch_set` |
| `prefab` | `prefab_query`, `prefab_create`, `prefab_update` |
| `asset` | `asset_query`, `asset_create`, `asset_modify`, `asset_delete`, `asset_refresh` |
| `debug` | `debug_logs`, `debug_execute`, `debug_inspect` |
| `project` | `project_query`, `project_build` |
| `preferences` | `preferences_query`, `preferences_modify` |
| `undo` | `undo_recording` |
| `sceneScript` | `sceneScript_execute` |
| `array` | `array_property` |

总计 `33` 个工具。

## 工具设计原则

- 工具名统一为 `category_operation` 风格，少量历史兼容项保留现有命名，如 `sceneScript_execute`。
- 查询和写操作尽量合并到同一个工具中，通过 `action` 区分行为。
- 优先统一参数语义：
  - 单对象通常使用 `uuid`
  - 批量通常使用 `uuids`
  - 资源路径通常使用 `db://assets/...`
- 对 AI 最常见的编辑链路进行了收敛：
  - `scene_query` / `node_query` 先拿上下文
  - `node_create` / `node_batch_create` 做结构搭建
  - `component_add` / `component_batch_set` 做组件配置
  - `prefab_create` / `prefab_update` 做资源沉淀

## 最近和工具优化相关的变更

这些内容来自最近几轮工具优化提交与 `doc/` 文档整理：

- `Step 2-5` 已完成：Scene、Node、Component、Prefab、Asset、Debug、Project、Preferences、Undo、SceneScript、ArrayProperty 全部切到 v2。
- 旧类别清理已完成，README 不再列出 `server_*`、`broadcast_*`、`sceneView_*`、`referenceImage_*`、`validation_*`。
- `node_create` 新增内联组件初始化能力，`node_batch_create` 支持批量搭节点。
- `component_batch_set` 已加入当前可用工具集，适合一次性写多个组件属性。
- 资源查询做过专项优化，未使用资源筛选逻辑已修复。
- Debug 相关修复覆盖了 console 捕获、项目日志回退、场景校验和性能检查链路。
- `debug_execute` 明确标注为运行时脚本执行入口，但其运行时改动不会自动变成持久化场景修改。
- 预制体工具近期补齐了实例命名、节点/资源处理和兼容性问题。

## 还没上线但已写入规划的内容

以下内容存在规划文档中，但不要把它们当成当前已交付能力：

- 浏览器预览页日志桥接：见 `doc/plan/browser-preview-log-bridge.md`
- 工具美术相关规划：见 `doc/plan/tools-art-plan.md`
- `animation_clip` 目前在规划文档中有详细设计，但当前代码尚未注册该工具

## 安装

### 1. 放入扩展目录

将整个 `cocos-mcp-server` 目录放到你的 Cocos Creator 项目 `extensions/` 下：

```text
YourProject/
├── assets/
├── extensions/
│   └── cocos-mcp-server/
├── settings/
└── ...
```

### 2. 安装依赖

```bash
cd extensions/cocos-mcp-server
npm install
```

### 3. 构建

```bash
npm run build
```

### 4. 在编辑器中启用

1. 重启 Cocos Creator 或刷新扩展
2. 从 `扩展 > Cocos MCP Server` 打开面板
3. 设置端口、自动启动和调试选项
4. 点击“启动服务器”

## MCP 客户端配置

### Claude CLI

```bash
claude mcp add --transport http cocos-creator http://127.0.0.1:3000/mcp
```

### Claude Desktop / 通用 MCP JSON

```json
{
  "mcpServers": {
    "cocos-creator": {
      "type": "http",
      "url": "http://127.0.0.1:3000/mcp"
    }
  }
}
```

### Cursor

```json
{
  "mcpServers": {
    "cocos-creator": {
      "url": "http://127.0.0.1:3000/mcp"
    }
  }
}
```

如果你修改了面板里的端口，以上 URL 也要同步修改。

## 推荐调用方式

### 1. 先列出工具

```bash
curl -s -X POST http://127.0.0.1:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

### 2. 查询当前场景

```bash
curl -s -X POST http://127.0.0.1:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"scene_query","arguments":{"action":"info"}}}'
```

### 3. 创建带组件的节点

```json
{
  "name": "node_create",
  "arguments": {
    "name": "Player",
    "parentUuid": "parent-node-uuid",
    "nodeType": "2DNode",
    "components": [
      "cc.UITransform",
      {
        "type": "cc.Sprite",
        "properties": {
          "color": {
            "r": 255,
            "g": 255,
            "b": 255,
            "a": 255
          }
        }
      }
    ]
  }
}
```

### 4. 批量设置组件属性

```json
{
  "name": "component_batch_set",
  "arguments": {
    "uuid": "node-uuid",
    "batch": [
      {
        "componentType": "cc.Label",
        "properties": {
          "string": "Hello MCP",
          "fontSize": 36
        }
      },
      {
        "componentType": "cc.UITransform",
        "properties": {
          "contentSize": {
            "value": { "width": 320, "height": 80 },
            "propertyType": "size"
          }
        }
      }
    ]
  }
}
```

### 5. 调试日志

```json
{
  "name": "debug_logs",
  "arguments": {
    "action": "console",
    "limit": 50,
    "level": "error"
  }
}
```

## 使用建议

- 先查再改。先用 `scene_query`、`node_query`、`component_query` 获取真实 UUID 和当前状态。
- 对节点和组件优先传 `uuid`，不要让模型靠名字猜。
- 创建多个节点时优先使用 `node_batch_create`，写多个组件字段时优先使用 `component_batch_set`。
- 要做持久化场景修改时，优先用正式工具，不要把 `debug_execute` 当成常规写接口。
- 资源路径统一使用 `db://assets/...`。

## 调试与限制

### 当前调试能力

- `debug_logs`
  - `console`: 读取内存中的编辑器 console 缓存
  - `project`: 读取项目日志文件
  - `search`: 对项目日志做正则搜索
  - `clear`: 清空 console
- `debug_inspect`
  - `node_tree`
  - `performance`
  - `validate`
  - `editor_info`

### 当前已知限制

- `debug_execute` 适合调试和验证，不适合作为长期稳定的持久化编辑接口。
- 浏览器预览页里的 `console.*` 日志当前没有正式桥接进 MCP；现阶段主要覆盖编辑器 console 和项目日志文件。
- `animation_clip` 还处于方案文档阶段，当前代码未注册。
- 工具管理面板只会暴露当前配置中启用的工具，因此客户端看到的工具数量可能少于 33。

## 工具管理与配置文件

扩展会在项目 `settings/` 下维护配置：

- `settings/mcp-server.json`
  - 服务器端口
  - 自动启动
  - 调试日志
  - 连接限制
- `settings/tool-manager.json`
  - 工具启用配置
  - 当前激活配置
  - 工具开关持久化

默认最多维护 `5` 套工具配置。

## 项目结构

```text
cocos-mcp-server/
├── source/
│   ├── main.ts
│   ├── mcp-server.ts
│   ├── settings.ts
│   ├── scene.ts
│   ├── tools/
│   │   ├── tool-manager.ts
│   │   ├── prefab-tools.ts
│   │   └── v2/
│   │       ├── scene-tools.ts
│   │       ├── node-tools.ts
│   │       ├── component-tools.ts
│   │       ├── prefab-tools.ts
│   │       ├── asset-tools.ts
│   │       ├── debug-tools.ts
│   │       ├── project-tools.ts
│   │       ├── preferences-tools.ts
│   │       ├── undo-tools.ts
│   │       ├── scene-script-tools.ts
│   │       └── array-property-tools.ts
│   ├── panels/
│   └── types/
├── doc/
│   ├── feature/tools_optimization/
│   ├── bugfix/tools_optimization/
│   └── plan/
├── dist/
├── static/
├── i18n/
└── package.json
```

## 开发

### 本地构建

```bash
npm install
npm run build
```

### 监听构建

```bash
npm run watch
```

### 关键源码入口

- `source/main.ts`: 扩展主入口与面板消息
- `source/mcp-server.ts`: HTTP/MCP 服务与工具路由
- `source/tools/tool-manager.ts`: 工具发现、配置和启停过滤
- `source/tools/v2/*.ts`: 当前生产使用的 v2 工具实现

## 故障排查

- 服务起不来：
  - 检查端口是否被占用
  - 检查面板配置是否已保存
  - 查看 Cocos Creator 控制台报错
- 工具返回找不到节点或资源：
  - 先调用查询工具确认 `uuid` 或 `db://` 路径
- 调试日志为空：
  - 先试 `debug_logs` 的 `project` 模式
  - 再确认当前场景或编辑器是否真的有输出
- 工具数与 README 不一致：
  - 面板里的工具开关可能禁用了部分工具

## 相关文档

- [工具优化总览](doc/feature/tools_optimization/00-overview.md)
- [工具优化总方案](doc/plan/tools-optimization-plan.md)
- [调试工具缺陷修复方案](doc/bugfix/tools_optimization/02-debug-tools-fixes.md)
- [浏览器预览日志桥接规划](doc/plan/browser-preview-log-bridge.md)

## 许可证

本插件供 Cocos Creator 项目使用，并且源代码一并打包，可以用于学习和交流。没有加密。可以支持你自己二次开发优化，任何本项目代码或者衍生代码均不能用于任何商用、转售，如果需要商用，请联系本人。
