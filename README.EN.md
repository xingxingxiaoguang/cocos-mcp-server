# Cocos Creator MCP Server Plugin

**[📖 English](README.EN.md)**  **[📖 中文](README.md)**

An MCP (Model Context Protocol) extension for Cocos Creator `3.8.6+`. It exposes editor capabilities through a local HTTP MCP endpoint so AI clients such as Claude and Cursor can inspect and operate scenes, nodes, components, prefabs, assets, and project settings directly.

The repository has already switched to the v2 tool system. This README describes the current implementation, not the older 150+ tool layout or early planning drafts.

## Current Status

- Extension version: `2.0.0`
- Editor requirement: `Cocos Creator >= 3.8.6`
- Default port: `3000`
- Bind address: `127.0.0.1`
- MCP endpoint: `http://127.0.0.1:3000/mcp`
- Health check: `http://127.0.0.1:3000/health`
- Current tool count: `33`
- Current category count: `11`

## What Is Already Shipped

- The old multi-category tool layout has been consolidated into an AI-oriented v2 tool system.
- Low-value categories such as `server_*`, `broadcast_*`, `sceneView_*`, `referenceImage_*`, and `validation_*` were removed.
- The current design favors fewer tools with `action`-based branching to reduce tool selection errors.
- Routing and the tool manager panel are both on v2 now, and the server only exposes tools enabled in the active configuration.
- Node tools now support batch creation and inline component initialization.
- Component tools now support batch property writes.
- Recent fixes covered asset queries, unused asset filtering, prefab creation and naming, debug logging, and scene inspection reliability.

## Current Tool List

The list below reflects the actual tool names in code:

| Category | Tools |
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

Total: `33` tools.

## Tool Design Principles

- Tool names mostly follow `category_operation`, with a few compatibility exceptions such as `sceneScript_execute`.
- Query and write flows are merged into a smaller set of tools, with behavior selected by `action`.
- Common argument conventions:
  - `uuid` for single objects
  - `uuids` for bulk operations
  - `db://assets/...` for asset paths
- The main AI editing workflow is intentionally streamlined:
  - query first with `scene_query` / `node_query`
  - build structure with `node_create` / `node_batch_create`
  - configure behavior with `component_add` / `component_batch_set`
  - persist reusable assets with `prefab_create` / `prefab_update`

## Recent Tool Optimization Changes

This summary is based on recent tool-optimization commits and the reorganized docs under `doc/`:

- `Step 2-5` is already implemented: Scene, Node, Component, Prefab, Asset, Debug, Project, Preferences, Undo, SceneScript, and ArrayProperty all run through v2.
- Removed categories are no longer documented here.
- `node_create` now supports inline component initialization, and `node_batch_create` is part of the shipped toolset.
- `component_batch_set` is available and should be preferred for many property updates in one call.
- Asset queries and unused-asset filtering were hardened recently.
- Debug fixes covered console capture, project-log fallback, scene validation, and performance inspection.
- `debug_execute` is explicitly documented as a runtime execution entry point, not a durable scene editing API.
- Prefab tools were recently improved around instance naming, asset handling, and compatibility.

## Planned But Not Shipped Yet

These items exist in planning docs and should not be described as current capabilities:

- Browser preview log bridge: `doc/plan/browser-preview-log-bridge.md`
- Tools-art planning: `doc/plan/tools-art-plan.md`
- `animation_clip` has a design doc, but the tool is not registered in the current codebase

## Installation

### 1. Place the extension in your project

Copy `cocos-mcp-server` into the `extensions/` directory of your Cocos Creator project:

```text
YourProject/
├── assets/
├── extensions/
│   └── cocos-mcp-server/
├── settings/
└── ...
```

### 2. Install dependencies

```bash
cd extensions/cocos-mcp-server
npm install
```

### 3. Build

```bash
npm run build
```

### 4. Enable in Cocos Creator

1. Restart Cocos Creator or refresh extensions
2. Open `Extensions > Cocos MCP Server`
3. Configure port, auto-start, and debug options
4. Start the server from the panel

## MCP Client Configuration

### Claude CLI

```bash
claude mcp add --transport http cocos-creator http://127.0.0.1:3000/mcp
```

### Claude Desktop / Generic MCP JSON

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

If you change the port in the panel, update the URL accordingly.

## Recommended Usage Pattern

### 1. List tools

```bash
curl -s -X POST http://127.0.0.1:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

### 2. Query the current scene

```bash
curl -s -X POST http://127.0.0.1:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"scene_query","arguments":{"action":"info"}}}'
```

### 3. Create a node with inline components

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

### 4. Batch-set component properties

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

### 5. Query debug logs

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

## Usage Guidance

- Query before mutating. Use `scene_query`, `node_query`, and `component_query` to resolve the current state first.
- Prefer `uuid` over names whenever possible.
- Prefer `node_batch_create` for many node creations and `component_batch_set` for many component property updates.
- Use proper editing tools for durable changes; do not treat `debug_execute` as the normal write path.
- Use `db://assets/...` consistently for asset paths.

## Debugging and Limitations

### Current Debug Coverage

- `debug_logs`
  - `console`: in-memory editor console cache
  - `project`: project log file
  - `search`: regex search over project logs
  - `clear`: clear console
- `debug_inspect`
  - `node_tree`
  - `performance`
  - `validate`
  - `editor_info`

### Known Limitations

- `debug_execute` is suitable for debugging and verification, not as a stable persisted editing interface.
- Browser preview page `console.*` output is not fully bridged into MCP yet; current coverage is mainly editor console and project log files.
- `animation_clip` is still a design item and is not registered in the current build.
- The tool manager panel may expose fewer than 33 tools if some tools are disabled in the active configuration.

## Tool Manager and Settings Files

The extension stores config files under the project `settings/` directory:

- `settings/mcp-server.json`
  - server port
  - auto-start
  - debug logging
  - connection limits
- `settings/tool-manager.json`
  - tool enable/disable state
  - active configuration
  - persistent tool filtering

The tool manager currently supports up to `5` configurations.

## Project Structure

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

## Development

### Build locally

```bash
npm install
npm run build
```

### Watch mode

```bash
npm run watch
```

### Main source entry points

- `source/main.ts`: extension entry and panel messages
- `source/mcp-server.ts`: HTTP/MCP server and tool routing
- `source/tools/tool-manager.ts`: tool discovery, config, and exposure filtering
- `source/tools/v2/*.ts`: production v2 tool implementations

## Troubleshooting

- Server does not start:
  - check whether the port is already in use
  - check whether panel settings were saved
  - inspect Cocos Creator console output
- Tool cannot find a node or asset:
  - query the `uuid` or `db://` path first
- Debug logs are empty:
  - try `debug_logs` with `action=project`
  - then verify the editor or scene actually produced output
- Tool count does not match this README:
  - the active tool configuration may have disabled some tools

## Related Docs

- [Tool optimization overview](doc/feature/tools_optimization/00-overview.md)
- [Main tool optimization plan](doc/plan/tools-optimization-plan.md)
- [Debug tool bugfix plan](doc/bugfix/tools_optimization/02-debug-tools-fixes.md)
- [Browser preview log bridge plan](doc/plan/browser-preview-log-bridge.md)

## License

This plugin is for Cocos Creator project use, and the source code is packaged together. It can be used for learning and communication. It is not encrypted. You can modify and optimize it for your own use, but any code from this project or derived code may not be used for commercial use or resale. If you need commercial use, please contact the author.
