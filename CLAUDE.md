# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Is

A Cocos Creator 3.8+ editor plugin that runs an HTTP MCP (Model Context Protocol) server inside the editor, allowing AI assistants to control the editor via 50 tools over HTTP at `http://127.0.0.1:<port>/mcp`.

This is a **Cocos Creator extension**, not a standalone Node.js app. It runs inside the Cocos Creator editor process and uses the `Editor` global API (from `@cocos/creator-types`).

## Build Commands

```bash
npm install       # Install dependencies (preinstall script runs automatically)
npm run build     # Compile TypeScript → dist/
npm run watch     # Watch mode for development
```

After building, reload the extension in Cocos Creator for changes to take effect. There are no automated tests — `source/test/` contains manual test scripts.

## Architecture

### Entry Points

- `source/main.ts` — Plugin main process. Exports `methods` object (IPC handlers) and `load`/`unload` lifecycle hooks. Owns the `MCPServer` and `ToolManager` instances.
- `source/scene.ts` — Scene script, runs in the scene process. Handles scene-level operations (node manipulation, component access) that require scene context.
- `source/panels/default/` — Vue 3 panel UI (server controls + tool management tabs).

### Core Flow

```
Cocos Editor
  └── main.ts (main process)
        ├── MCPServer (source/mcp-server.ts)
        │     ├── HTTP server on configured port
        │     ├── /mcp endpoint — handles MCP JSON-RPC protocol
        │     ├── /health endpoint
        │     └── Tool instances (one per category)
        └── ToolManager (source/tools/tool-manager.ts)
              └── Persists tool enable/disable config to
                  <project>/settings/tool-manager.json
```

### Tool System

Each tool file in `source/tools/` exports a class implementing `ToolExecutor`:

```typescript
interface ToolExecutor {
    getTools(): ToolDefinition[];
    execute(toolName: string, args: any): Promise<ToolResponse>;
}
```

Tools use the `action` parameter pattern — one tool name handles multiple operations via an `action` field:

```json
{ "tool": "node_lifecycle", "arguments": { "action": "create", "name": "MyNode" } }
```

Tools that need scene access call `Editor.Message.request('scene', 'methodName', ...args)` to invoke methods registered in `source/scene.ts`.

### Settings Persistence

- Server settings (port, autoStart, etc.) → `<project>/settings/cocos-mcp-server.json` via `source/settings.ts`
- Tool enable/disable config → `<project>/settings/tool-manager.json` via `ToolManager`

### IPC Message Flow

The panel communicates with `main.ts` via `Editor.Message.send/request('cocos-mcp-server', 'methodName', ...)`. All message handlers are declared in `package.json` under `contributions.messages` and implemented as methods in `main.ts`.

## Adding a New Tool

1. Create `source/tools/my-tools.ts` implementing `ToolExecutor`
2. Import and instantiate it in `MCPServer.initializeTools()` in `source/mcp-server.ts`
3. The tool is automatically exposed via MCP after rebuild

## Key Types (`source/types/index.ts`)

- `ToolResponse` — standard return shape: `{ success, data?, message?, error?, warning? }`
- `ToolDefinition` — MCP tool schema: `{ name, description, inputSchema }`
- `MCPServerSettings` — server config shape
- `ToolExecutor` — interface all tool classes must implement
