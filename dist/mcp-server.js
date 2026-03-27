"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.MCPServer = void 0;
const http = __importStar(require("http"));
const url = __importStar(require("url"));
const scene_tools_1 = require("./tools/scene-tools");
const node_tools_1 = require("./tools/node-tools");
const component_tools_1 = require("./tools/component-tools");
const prefab_tools_1 = require("./tools/prefab-tools");
const project_tools_1 = require("./tools/project-tools");
const debug_tools_1 = require("./tools/debug-tools");
const preferences_tools_1 = require("./tools/preferences-tools");
const scene_advanced_tools_1 = require("./tools/scene-advanced-tools");
const asset_advanced_tools_1 = require("./tools/asset-advanced-tools");
class MCPServer {
    constructor(settings) {
        this.httpServer = null;
        this.clients = new Map();
        this.tools = {};
        this.toolsList = [];
        this.enabledTools = []; // 存储启用的工具列表
        this.settings = settings;
        this.initializeTools();
    }
    initializeTools() {
        try {
            console.log('[MCPServer] Initializing tools...');
            this.tools.scene = new scene_tools_1.SceneTools();
            this.tools.node = new node_tools_1.NodeTools();
            this.tools.component = new component_tools_1.ComponentTools();
            this.tools.prefab = new prefab_tools_1.PrefabTools();
            this.tools.project = new project_tools_1.ProjectTools();
            this.tools.debug = new debug_tools_1.DebugTools();
            this.tools.preferences = new preferences_tools_1.PreferencesTools();
            this.tools.sceneAdvanced = new scene_advanced_tools_1.SceneAdvancedTools();
            this.tools.assetAdvanced = new asset_advanced_tools_1.AssetAdvancedTools();
            console.log('[MCPServer] Tools initialized successfully');
        }
        catch (error) {
            console.error('[MCPServer] Error initializing tools:', error);
            throw error;
        }
    }
    async start() {
        if (this.httpServer) {
            console.log('[MCPServer] Server is already running');
            return;
        }
        try {
            console.log(`[MCPServer] Starting HTTP server on port ${this.settings.port}...`);
            this.httpServer = http.createServer(this.handleHttpRequest.bind(this));
            await new Promise((resolve, reject) => {
                this.httpServer.listen(this.settings.port, '127.0.0.1', () => {
                    console.log(`[MCPServer] ✅ HTTP server started successfully on http://127.0.0.1:${this.settings.port}`);
                    console.log(`[MCPServer] Health check: http://127.0.0.1:${this.settings.port}/health`);
                    console.log(`[MCPServer] MCP endpoint: http://127.0.0.1:${this.settings.port}/mcp`);
                    resolve();
                });
                this.httpServer.on('error', (err) => {
                    console.error('[MCPServer] ❌ Failed to start server:', err);
                    if (err.code === 'EADDRINUSE') {
                        console.error(`[MCPServer] Port ${this.settings.port} is already in use. Please change the port in settings.`);
                    }
                    reject(err);
                });
            });
            this.setupTools();
            console.log('[MCPServer] 🚀 MCP Server is ready for connections');
        }
        catch (error) {
            console.error('[MCPServer] ❌ Failed to start server:', error);
            throw error;
        }
    }
    setupTools() {
        this.toolsList = [];
        // 如果没有启用工具配置，返回所有工具
        if (!this.enabledTools || this.enabledTools.length === 0) {
            for (const [category, toolSet] of Object.entries(this.tools)) {
                const tools = toolSet.getTools();
                for (const tool of tools) {
                    this.toolsList.push({
                        name: `${category}_${tool.name}`,
                        description: tool.description,
                        inputSchema: tool.inputSchema
                    });
                }
            }
        }
        else {
            // 根据启用的工具配置过滤
            const enabledToolNames = new Set(this.enabledTools.map(tool => `${tool.category}_${tool.name}`));
            for (const [category, toolSet] of Object.entries(this.tools)) {
                const tools = toolSet.getTools();
                for (const tool of tools) {
                    const toolName = `${category}_${tool.name}`;
                    if (enabledToolNames.has(toolName)) {
                        this.toolsList.push({
                            name: toolName,
                            description: tool.description,
                            inputSchema: tool.inputSchema
                        });
                    }
                }
            }
        }
        console.log(`[MCPServer] Setup tools: ${this.toolsList.length} tools available`);
    }
    getFilteredTools(enabledTools) {
        if (!enabledTools || enabledTools.length === 0) {
            return this.toolsList; // 如果没有过滤配置，返回所有工具
        }
        const enabledToolNames = new Set(enabledTools.map(tool => `${tool.category}_${tool.name}`));
        return this.toolsList.filter(tool => enabledToolNames.has(tool.name));
    }
    async executeToolCall(toolName, args) {
        const parts = toolName.split('_');
        const category = parts[0];
        const toolMethodName = parts.slice(1).join('_');
        if (this.tools[category]) {
            return await this.tools[category].execute(toolMethodName, args);
        }
        throw new Error(`Tool ${toolName} not found`);
    }
    getClients() {
        return Array.from(this.clients.values());
    }
    getAvailableTools() {
        return this.toolsList;
    }
    updateEnabledTools(enabledTools) {
        console.log(`[MCPServer] Updating enabled tools: ${enabledTools.length} tools`);
        this.enabledTools = enabledTools;
        this.setupTools(); // 重新设置工具列表
    }
    getSettings() {
        return this.settings;
    }
    async handleHttpRequest(req, res) {
        const parsedUrl = url.parse(req.url || '', true);
        const pathname = parsedUrl.pathname;
        // Set CORS headers
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        res.setHeader('Content-Type', 'application/json');
        if (req.method === 'OPTIONS') {
            res.writeHead(200);
            res.end();
            return;
        }
        try {
            if (pathname === '/mcp' && req.method === 'POST') {
                await this.handleMCPRequest(req, res);
            }
            else if (pathname === '/health' && req.method === 'GET') {
                res.writeHead(200);
                res.end(JSON.stringify({ status: 'ok', tools: this.toolsList.length }));
            }
            else if ((pathname === null || pathname === void 0 ? void 0 : pathname.startsWith('/api/')) && req.method === 'POST') {
                await this.handleSimpleAPIRequest(req, res, pathname);
            }
            else if (pathname === '/api/tools' && req.method === 'GET') {
                res.writeHead(200);
                res.end(JSON.stringify({ tools: this.getSimplifiedToolsList() }));
            }
            else {
                res.writeHead(404);
                res.end(JSON.stringify({ error: 'Not found' }));
            }
        }
        catch (error) {
            console.error('HTTP request error:', error);
            res.writeHead(500);
            res.end(JSON.stringify({ error: 'Internal server error' }));
        }
    }
    async handleMCPRequest(req, res) {
        let body = '';
        req.on('data', (chunk) => {
            body += chunk.toString();
        });
        req.on('end', async () => {
            try {
                // Enhanced JSON parsing with better error handling
                let message;
                try {
                    message = JSON.parse(body);
                }
                catch (parseError) {
                    // Try to fix common JSON issues
                    const fixedBody = this.fixCommonJsonIssues(body);
                    try {
                        message = JSON.parse(fixedBody);
                        console.log('[MCPServer] Fixed JSON parsing issue');
                    }
                    catch (secondError) {
                        throw new Error(`JSON parsing failed: ${parseError.message}. Original body: ${body.substring(0, 500)}...`);
                    }
                }
                const response = await this.handleMessage(message);
                res.writeHead(200);
                res.end(JSON.stringify(response));
            }
            catch (error) {
                console.error('Error handling MCP request:', error);
                res.writeHead(400);
                res.end(JSON.stringify({
                    jsonrpc: '2.0',
                    id: null,
                    error: {
                        code: -32700,
                        message: `Parse error: ${error.message}`
                    }
                }));
            }
        });
    }
    async handleMessage(message) {
        const { id, method, params } = message;
        try {
            let result;
            switch (method) {
                case 'tools/list':
                    result = { tools: this.getAvailableTools() };
                    break;
                case 'tools/call':
                    const { name, arguments: args } = params;
                    const toolResult = await this.executeToolCall(name, args);
                    result = { content: [{ type: 'text', text: JSON.stringify(toolResult) }] };
                    break;
                case 'initialize':
                    // MCP initialization
                    result = {
                        protocolVersion: '2024-11-05',
                        capabilities: {
                            tools: {}
                        },
                        serverInfo: {
                            name: 'cocos-mcp-server',
                            version: '1.0.0'
                        }
                    };
                    break;
                default:
                    throw new Error(`Unknown method: ${method}`);
            }
            return {
                jsonrpc: '2.0',
                id,
                result
            };
        }
        catch (error) {
            return {
                jsonrpc: '2.0',
                id,
                error: {
                    code: -32603,
                    message: error.message
                }
            };
        }
    }
    fixCommonJsonIssues(jsonStr) {
        let fixed = jsonStr;
        // Fix common escape character issues
        fixed = fixed
            // Fix unescaped quotes in strings
            .replace(/([^\\])"([^"]*[^\\])"([^,}\]:])/g, '$1\\"$2\\"$3')
            // Fix unescaped backslashes
            .replace(/([^\\])\\([^"\\\/bfnrt])/g, '$1\\\\$2')
            // Fix trailing commas
            .replace(/,(\s*[}\]])/g, '$1')
            // Fix single quotes (should be double quotes)
            .replace(/'/g, '"')
            // Fix common control characters
            .replace(/\n/g, '\\n')
            .replace(/\r/g, '\\r')
            .replace(/\t/g, '\\t');
        return fixed;
    }
    stop() {
        if (this.httpServer) {
            this.httpServer.close();
            this.httpServer = null;
            console.log('[MCPServer] HTTP server stopped');
        }
        this.clients.clear();
    }
    getStatus() {
        return {
            running: !!this.httpServer,
            port: this.settings.port,
            clients: 0 // HTTP is stateless, no persistent clients
        };
    }
    async handleSimpleAPIRequest(req, res, pathname) {
        let body = '';
        req.on('data', (chunk) => {
            body += chunk.toString();
        });
        req.on('end', async () => {
            try {
                // Extract tool name from path like /api/node/set_position
                const pathParts = pathname.split('/').filter(p => p);
                if (pathParts.length < 3) {
                    res.writeHead(400);
                    res.end(JSON.stringify({ error: 'Invalid API path. Use /api/{category}/{tool_name}' }));
                    return;
                }
                const category = pathParts[1];
                const toolName = pathParts[2];
                const fullToolName = `${category}_${toolName}`;
                // Parse parameters with enhanced error handling
                let params;
                try {
                    params = body ? JSON.parse(body) : {};
                }
                catch (parseError) {
                    // Try to fix JSON issues
                    const fixedBody = this.fixCommonJsonIssues(body);
                    try {
                        params = JSON.parse(fixedBody);
                        console.log('[MCPServer] Fixed API JSON parsing issue');
                    }
                    catch (secondError) {
                        res.writeHead(400);
                        res.end(JSON.stringify({
                            error: 'Invalid JSON in request body',
                            details: parseError.message,
                            receivedBody: body.substring(0, 200)
                        }));
                        return;
                    }
                }
                // Execute tool
                const result = await this.executeToolCall(fullToolName, params);
                res.writeHead(200);
                res.end(JSON.stringify({
                    success: true,
                    tool: fullToolName,
                    result: result
                }));
            }
            catch (error) {
                console.error('Simple API error:', error);
                res.writeHead(500);
                res.end(JSON.stringify({
                    success: false,
                    error: error.message,
                    tool: pathname
                }));
            }
        });
    }
    getSimplifiedToolsList() {
        return this.toolsList.map(tool => {
            const parts = tool.name.split('_');
            const category = parts[0];
            const toolName = parts.slice(1).join('_');
            return {
                name: tool.name,
                category: category,
                toolName: toolName,
                description: tool.description,
                apiPath: `/api/${category}/${toolName}`,
                curlExample: this.generateCurlExample(category, toolName, tool.inputSchema)
            };
        });
    }
    generateCurlExample(category, toolName, schema) {
        // Generate sample parameters based on schema
        const sampleParams = this.generateSampleParams(schema);
        const jsonString = JSON.stringify(sampleParams, null, 2);
        return `curl -X POST http://127.0.0.1:8585/api/${category}/${toolName} \\
  -H "Content-Type: application/json" \\
  -d '${jsonString}'`;
    }
    generateSampleParams(schema) {
        if (!schema || !schema.properties)
            return {};
        const sample = {};
        for (const [key, prop] of Object.entries(schema.properties)) {
            const propSchema = prop;
            switch (propSchema.type) {
                case 'string':
                    sample[key] = propSchema.default || 'example_string';
                    break;
                case 'number':
                    sample[key] = propSchema.default || 42;
                    break;
                case 'boolean':
                    sample[key] = propSchema.default || true;
                    break;
                case 'object':
                    sample[key] = propSchema.default || { x: 0, y: 0, z: 0 };
                    break;
                default:
                    sample[key] = 'example_value';
            }
        }
        return sample;
    }
    updateSettings(settings) {
        this.settings = settings;
        if (this.httpServer) {
            this.stop();
            this.start();
        }
    }
}
exports.MCPServer = MCPServer;
// HTTP transport doesn't need persistent connections
// MCP over HTTP uses request-response pattern
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWNwLXNlcnZlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL3NvdXJjZS9tY3Atc2VydmVyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUFBLDJDQUE2QjtBQUM3Qix5Q0FBMkI7QUFHM0IscURBQWlEO0FBQ2pELG1EQUErQztBQUMvQyw2REFBeUQ7QUFDekQsdURBQW1EO0FBQ25ELHlEQUFxRDtBQUNyRCxxREFBaUQ7QUFDakQsaUVBQTZEO0FBQzdELHVFQUFrRTtBQUNsRSx1RUFBa0U7QUFFbEUsTUFBYSxTQUFTO0lBUWxCLFlBQVksUUFBMkI7UUFOL0IsZUFBVSxHQUF1QixJQUFJLENBQUM7UUFDdEMsWUFBTyxHQUEyQixJQUFJLEdBQUcsRUFBRSxDQUFDO1FBQzVDLFVBQUssR0FBd0IsRUFBRSxDQUFDO1FBQ2hDLGNBQVMsR0FBcUIsRUFBRSxDQUFDO1FBQ2pDLGlCQUFZLEdBQVUsRUFBRSxDQUFDLENBQUMsWUFBWTtRQUcxQyxJQUFJLENBQUMsUUFBUSxHQUFHLFFBQVEsQ0FBQztRQUN6QixJQUFJLENBQUMsZUFBZSxFQUFFLENBQUM7SUFDM0IsQ0FBQztJQUVPLGVBQWU7UUFDbkIsSUFBSSxDQUFDO1lBQ0QsT0FBTyxDQUFDLEdBQUcsQ0FBQyxtQ0FBbUMsQ0FBQyxDQUFDO1lBQ2pELElBQUksQ0FBQyxLQUFLLENBQUMsS0FBSyxHQUFHLElBQUksd0JBQVUsRUFBRSxDQUFDO1lBQ3BDLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSSxHQUFHLElBQUksc0JBQVMsRUFBRSxDQUFDO1lBQ2xDLElBQUksQ0FBQyxLQUFLLENBQUMsU0FBUyxHQUFHLElBQUksZ0NBQWMsRUFBRSxDQUFDO1lBQzVDLElBQUksQ0FBQyxLQUFLLENBQUMsTUFBTSxHQUFHLElBQUksMEJBQVcsRUFBRSxDQUFDO1lBQ3RDLElBQUksQ0FBQyxLQUFLLENBQUMsT0FBTyxHQUFHLElBQUksNEJBQVks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QyxRQUEyQjtRQUM3QyxJQUFJLENBQUMsUUFBUSxHQUFHLFFBQVEsQ0FBQztRQUN6QixJQUFJLElBQUksQ0FBQyxVQUFVLEVBQUUsQ0FBQztZQUNsQixJQUFJLENBQUMsSUFBSSxFQUFFLENBQUM7WUFDWixJQUFJLENBQUMsS0FBSyxFQUFFLENBQUM7UUFDakIsQ0FBQztJQUNMLENBQUM7Q0FDSjtBQWpiRCw4QkFpYkM7QUFFRCxxREFBcUQ7QUFDckQsOENBQThDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgaHR0cCBmcm9tICdodHRwJztcbmltcG9ydCAqIGFzIHVybCBmcm9tICd1cmwnO1xuaW1wb3J0IHsgdjQgYXMgdXVpZHY0IH0gZnJvbSAndXVpZCc7XG5pbXBvcnQgeyBNQ1BTZXJ2ZXJTZXR0aW5ncywgU2VydmVyU3RhdHVzLCBNQ1BDbGllbnQsIFRvb2xEZWZpbml0aW9uIH0gZnJvbSAnLi90eXBlcyc7XG5pbXBvcnQgeyBTY2VuZVRvb2xzIH0gZnJvbSAnLi90b29scy9zY2VuZS10b29scyc7XG5pbXBvcnQgeyBOb2RlVG9vbHMgfSBmcm9tICcuL3Rvb2xzL25vZGUtdG9vbHMnO1xuaW1wb3J0IHsgQ29tcG9uZW50VG9vbHMgfSBmcm9tICcuL3Rvb2xzL2NvbXBvbmVudC10b29scyc7XG5pbXBvcnQgeyBQcmVmYWJUb29scyB9IGZyb20gJy4vdG9vbHMvcHJlZmFiLXRvb2xzJztcbmltcG9ydCB7IFByb2plY3RUb29scyB9IGZyb20gJy4vdG9vbHMvcHJvamVjdC10b29scyc7XG5pbXBvcnQgeyBEZWJ1Z1Rvb2xzIH0gZnJvbSAnLi90b29scy9kZWJ1Zy10b29scyc7XG5pbXBvcnQgeyBQcmVmZXJlbmNlc1Rvb2xzIH0gZnJvbSAnLi90b29scy9wcmVmZXJlbmNlcy10b29scyc7XG5pbXBvcnQgeyBTY2VuZUFkdmFuY2VkVG9vbHMgfSBmcm9tICcuL3Rvb2xzL3NjZW5lLWFkdmFuY2VkLXRvb2xzJztcbmltcG9ydCB7IEFzc2V0QWR2YW5jZWRUb29scyB9IGZyb20gJy4vdG9vbHMvYXNzZXQtYWR2YW5jZWQtdG9vbHMnO1xuXG5leHBvcnQgY2xhc3MgTUNQU2VydmVyIHtcbiAgICBwcml2YXRlIHNldHRpbmdzOiBNQ1BTZXJ2ZXJTZXR0aW5ncztcbiAgICBwcml2YXRlIGh0dHBTZXJ2ZXI6IGh0dHAuU2VydmVyIHwgbnVsbCA9IG51bGw7XG4gICAgcHJpdmF0ZSBjbGllbnRzOiBNYXA8c3RyaW5nLCBNQ1BDbGllbnQ+ID0gbmV3IE1hcCgpO1xuICAgIHByaXZhdGUgdG9vbHM6IFJlY29yZDxzdHJpbmcsIGFueT4gPSB7fTtcbiAgICBwcml2YXRlIHRvb2xzTGlzdDogVG9vbERlZmluaXRpb25bXSA9IFtdO1xuICAgIHByaXZhdGUgZW5hYmxlZFRvb2xzOiBhbnlbXSA9IFtdOyAvLyDlrZjlgqjlkK/nlKjnmoTlt6XlhbfliJfooahcblxuICAgIGNvbnN0cnVjdG9yKHNldHRpbmdzOiBNQ1BTZXJ2ZXJTZXR0aW5ncykge1xuICAgICAgICB0aGlzLnNldHRpbmdzID0gc2V0dGluZ3M7XG4gICAgICAgIHRoaXMuaW5pdGlhbGl6ZVRvb2xzKCk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBpbml0aWFsaXplVG9vbHMoKTogdm9pZCB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBjb25zb2xlLmxvZygnW01DUFNlcnZlcl0gSW5pdGlhbGl6aW5nIHRvb2xzLi4uJyk7XG4gICAgICAgICAgICB0aGlzLnRvb2xzLnNjZW5lID0gbmV3IFNjZW5lVG9vbHMoKTtcbiAgICAgICAgICAgIHRoaXMudG9vbHMubm9kZSA9IG5ldyBOb2RlVG9vbHMoKTtcbiAgICAgICAgICAgIHRoaXMudG9vbHMuY29tcG9uZW50ID0gbmV3IENvbXBvbmVudFRvb2xzKCk7XG4gICAgICAgICAgICB0aGlzLnRvb2xzLnByZWZhYiA9IG5ldyBQcmVmYWJUb29scygpO1xuICAgICAgICAgICAgdGhpcy50b29scy5wcm9qZWN0ID0gbmV3IFByb2plY3RUb29scygpO1xuICAgICAgICAgICAgdGhpcy50b29scy5kZWJ1ZyA9IG5ldyBEZWJ1Z1Rvb2xzKCk7XG4gICAgICAgICAgICB0aGlzLnRvb2xzLnByZWZlcmVuY2VzID0gbmV3IFByZWZlcmVuY2VzVG9vbHMoKTtcbiAgICAgICAgICAgIHRoaXMudG9vbHMuc2NlbmVBZHZhbmNlZCA9IG5ldyBTY2VuZUFkdmFuY2VkVG9vbHMoKTtcbiAgICAgICAgICAgIHRoaXMudG9vbHMuYXNzZXRBZHZhbmNlZCA9IG5ldyBBc3NldEFkdmFuY2VkVG9vbHMoKTtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKCdbTUNQU2VydmVyXSBUb29scyBpbml0aWFsaXplZCBzdWNjZXNzZnVsbHknKTtcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tNQ1BTZXJ2ZXJdIEVycm9yIGluaXRpYWxpemluZyB0b29sczonLCBlcnJvcik7XG4gICAgICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHB1YmxpYyBhc3luYyBzdGFydCgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAgICAgaWYgKHRoaXMuaHR0cFNlcnZlcikge1xuICAgICAgICAgICAgY29uc29sZS5sb2coJ1tNQ1BTZXJ2ZXJdIFNlcnZlciBpcyBhbHJlYWR5IHJ1bm5pbmcnKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBjb25zb2xlLmxvZyhgW01DUFNlcnZlcl0gU3RhcnRpbmcgSFRUUCBzZXJ2ZXIgb24gcG9ydCAke3RoaXMuc2V0dGluZ3MucG9ydH0uLi5gKTtcbiAgICAgICAgICAgIHRoaXMuaHR0cFNlcnZlciA9IGh0dHAuY3JlYXRlU2VydmVyKHRoaXMuaGFuZGxlSHR0cFJlcXVlc3QuYmluZCh0aGlzKSk7XG5cbiAgICAgICAgICAgIGF3YWl0IG5ldyBQcm9taXNlPHZvaWQ+KChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgICAgICAgICAgICB0aGlzLmh0dHBTZXJ2ZXIhLmxpc3Rlbih0aGlzLnNldHRpbmdzLnBvcnQsICcxMjcuMC4wLjEnLCAoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbTUNQU2VydmVyXSDinIUgSFRUUCBzZXJ2ZXIgc3RhcnRlZCBzdWNjZXNzZnVsbHkgb24gaHR0cDovLzEyNy4wLjAuMToke3RoaXMuc2V0dGluZ3MucG9ydH1gKTtcbiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coYFtNQ1BTZXJ2ZXJdIEhlYWx0aCBjaGVjazogaHR0cDovLzEyNy4wLjAuMToke3RoaXMuc2V0dGluZ3MucG9ydH0vaGVhbHRoYCk7XG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbTUNQU2VydmVyXSBNQ1AgZW5kcG9pbnQ6IGh0dHA6Ly8xMjcuMC4wLjE6JHt0aGlzLnNldHRpbmdzLnBvcnR9L21jcGApO1xuICAgICAgICAgICAgICAgICAgICByZXNvbHZlKCk7XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgdGhpcy5odHRwU2VydmVyIS5vbignZXJyb3InLCAoZXJyOiBhbnkpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcignW01DUFNlcnZlcl0g4p2MIEZhaWxlZCB0byBzdGFydCBzZXJ2ZXI6JywgZXJyKTtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGVyci5jb2RlID09PSAnRUFERFJJTlVTRScpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoYFtNQ1BTZXJ2ZXJdIFBvcnQgJHt0aGlzLnNldHRpbmdzLnBvcnR9IGlzIGFscmVhZHkgaW4gdXNlLiBQbGVhc2UgY2hhbmdlIHRoZSBwb3J0IGluIHNldHRpbmdzLmApO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIHJlamVjdChlcnIpO1xuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIHRoaXMuc2V0dXBUb29scygpO1xuICAgICAgICAgICAgY29uc29sZS5sb2coJ1tNQ1BTZXJ2ZXJdIPCfmoAgTUNQIFNlcnZlciBpcyByZWFkeSBmb3IgY29ubmVjdGlvbnMnKTtcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tNQ1BTZXJ2ZXJdIOKdjCBGYWlsZWQgdG8gc3RhcnQgc2VydmVyOicsIGVycm9yKTtcbiAgICAgICAgICAgIHRocm93IGVycm9yO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBzZXR1cFRvb2xzKCk6IHZvaWQge1xuICAgICAgICB0aGlzLnRvb2xzTGlzdCA9IFtdO1xuICAgICAgICBcbiAgICAgICAgLy8g5aaC5p6c5rKh5pyJ5ZCv55So5bel5YW36YWN572u77yM6L+U5Zue5omA5pyJ5bel5YW3XG4gICAgICAgIGlmICghdGhpcy5lbmFibGVkVG9vbHMgfHwgdGhpcy5lbmFibGVkVG9vbHMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICBmb3IgKGNvbnN0IFtjYXRlZ29yeSwgdG9vbFNldF0gb2YgT2JqZWN0LmVudHJpZXModGhpcy50b29scykpIHtcbiAgICAgICAgICAgICAgICBjb25zdCB0b29scyA9IHRvb2xTZXQuZ2V0VG9vbHMoKTtcbiAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IHRvb2wgb2YgdG9vbHMpIHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy50b29sc0xpc3QucHVzaCh7XG4gICAgICAgICAgICAgICAgICAgICAgICBuYW1lOiBgJHtjYXRlZ29yeX1fJHt0b29sLm5hbWV9YCxcbiAgICAgICAgICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiB0b29sLmRlc2NyaXB0aW9uLFxuICAgICAgICAgICAgICAgICAgICAgICAgaW5wdXRTY2hlbWE6IHRvb2wuaW5wdXRTY2hlbWFcbiAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgLy8g5qC55o2u5ZCv55So55qE5bel5YW36YWN572u6L+H5rukXG4gICAgICAgICAgICBjb25zdCBlbmFibGVkVG9vbE5hbWVzID0gbmV3IFNldCh0aGlzLmVuYWJsZWRUb29scy5tYXAodG9vbCA9PiBgJHt0b29sLmNhdGVnb3J5fV8ke3Rvb2wubmFtZX1gKSk7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGZvciAoY29uc3QgW2NhdGVnb3J5LCB0b29sU2V0XSBvZiBPYmplY3QuZW50cmllcyh0aGlzLnRvb2xzKSkge1xuICAgICAgICAgICAgICAgIGNvbnN0IHRvb2xzID0gdG9vbFNldC5nZXRUb29scygpO1xuICAgICAgICAgICAgICAgIGZvciAoY29uc3QgdG9vbCBvZiB0b29scykge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCB0b29sTmFtZSA9IGAke2NhdGVnb3J5fV8ke3Rvb2wubmFtZX1gO1xuICAgICAgICAgICAgICAgICAgICBpZiAoZW5hYmxlZFRvb2xOYW1lcy5oYXModG9vbE5hbWUpKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLnRvb2xzTGlzdC5wdXNoKHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBuYW1lOiB0b29sTmFtZSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogdG9vbC5kZXNjcmlwdGlvbixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpbnB1dFNjaGVtYTogdG9vbC5pbnB1dFNjaGVtYVxuICAgICAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgICAgIGNvbnNvbGUubG9nKGBbTUNQU2VydmVyXSBTZXR1cCB0b29sczogJHt0aGlzLnRvb2xzTGlzdC5sZW5ndGh9IHRvb2xzIGF2YWlsYWJsZWApO1xuICAgIH1cblxuICAgIHB1YmxpYyBnZXRGaWx0ZXJlZFRvb2xzKGVuYWJsZWRUb29sczogYW55W10pOiBUb29sRGVmaW5pdGlvbltdIHtcbiAgICAgICAgaWYgKCFlbmFibGVkVG9vbHMgfHwgZW5hYmxlZFRvb2xzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMudG9vbHNMaXN0OyAvLyDlpoLmnpzmsqHmnInov4fmu6TphY3nva7vvIzov5Tlm57miYDmnInlt6XlhbdcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGVuYWJsZWRUb29sTmFtZXMgPSBuZXcgU2V0KGVuYWJsZWRUb29scy5tYXAodG9vbCA9PiBgJHt0b29sLmNhdGVnb3J5fV8ke3Rvb2wubmFtZX1gKSk7XG4gICAgICAgIHJldHVybiB0aGlzLnRvb2xzTGlzdC5maWx0ZXIodG9vbCA9PiBlbmFibGVkVG9vbE5hbWVzLmhhcyh0b29sLm5hbWUpKTtcbiAgICB9XG5cbiAgICBwdWJsaWMgYXN5bmMgZXhlY3V0ZVRvb2xDYWxsKHRvb2xOYW1lOiBzdHJpbmcsIGFyZ3M6IGFueSk6IFByb21pc2U8YW55PiB7XG4gICAgICAgIGNvbnN0IHBhcnRzID0gdG9vbE5hbWUuc3BsaXQoJ18nKTtcbiAgICAgICAgY29uc3QgY2F0ZWdvcnkgPSBwYXJ0c1swXTtcbiAgICAgICAgY29uc3QgdG9vbE1ldGhvZE5hbWUgPSBwYXJ0cy5zbGljZSgxKS5qb2luKCdfJyk7XG4gICAgICAgIFxuICAgICAgICBpZiAodGhpcy50b29sc1tjYXRlZ29yeV0pIHtcbiAgICAgICAgICAgIHJldHVybiBhd2FpdCB0aGlzLnRvb2xzW2NhdGVnb3J5XS5leGVjdXRlKHRvb2xNZXRob2ROYW1lLCBhcmdzKTtcbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBUb29sICR7dG9vbE5hbWV9IG5vdCBmb3VuZGApO1xuICAgIH1cblxuICAgIHB1YmxpYyBnZXRDbGllbnRzKCk6IE1DUENsaWVudFtdIHtcbiAgICAgICAgcmV0dXJuIEFycmF5LmZyb20odGhpcy5jbGllbnRzLnZhbHVlcygpKTtcbiAgICB9XG4gICAgcHVibGljIGdldEF2YWlsYWJsZVRvb2xzKCk6IFRvb2xEZWZpbml0aW9uW10ge1xuICAgICAgICByZXR1cm4gdGhpcy50b29sc0xpc3Q7XG4gICAgfVxuXG4gICAgcHVibGljIHVwZGF0ZUVuYWJsZWRUb29scyhlbmFibGVkVG9vbHM6IGFueVtdKTogdm9pZCB7XG4gICAgICAgIGNvbnNvbGUubG9nKGBbTUNQU2VydmVyXSBVcGRhdGluZyBlbmFibGVkIHRvb2xzOiAke2VuYWJsZWRUb29scy5sZW5ndGh9IHRvb2xzYCk7XG4gICAgICAgIHRoaXMuZW5hYmxlZFRvb2xzID0gZW5hYmxlZFRvb2xzO1xuICAgICAgICB0aGlzLnNldHVwVG9vbHMoKTsgLy8g6YeN5paw6K6+572u5bel5YW35YiX6KGoXG4gICAgfVxuXG4gICAgcHVibGljIGdldFNldHRpbmdzKCk6IE1DUFNlcnZlclNldHRpbmdzIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuc2V0dGluZ3M7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBhc3luYyBoYW5kbGVIdHRwUmVxdWVzdChyZXE6IGh0dHAuSW5jb21pbmdNZXNzYWdlLCByZXM6IGh0dHAuU2VydmVyUmVzcG9uc2UpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAgICAgY29uc3QgcGFyc2VkVXJsID0gdXJsLnBhcnNlKHJlcS51cmwgfHwgJycsIHRydWUpO1xuICAgICAgICBjb25zdCBwYXRobmFtZSA9IHBhcnNlZFVybC5wYXRobmFtZTtcbiAgICAgICAgXG4gICAgICAgIC8vIFNldCBDT1JTIGhlYWRlcnNcbiAgICAgICAgcmVzLnNldEhlYWRlcignQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJywgJyonKTtcbiAgICAgICAgcmVzLnNldEhlYWRlcignQWNjZXNzLUNvbnRyb2wtQWxsb3ctTWV0aG9kcycsICdHRVQsIFBPU1QsIE9QVElPTlMnKTtcbiAgICAgICAgcmVzLnNldEhlYWRlcignQWNjZXNzLUNvbnRyb2wtQWxsb3ctSGVhZGVycycsICdDb250ZW50LVR5cGUsIEF1dGhvcml6YXRpb24nKTtcbiAgICAgICAgcmVzLnNldEhlYWRlcignQ29udGVudC1UeXBlJywgJ2FwcGxpY2F0aW9uL2pzb24nKTtcbiAgICAgICAgXG4gICAgICAgIGlmIChyZXEubWV0aG9kID09PSAnT1BUSU9OUycpIHtcbiAgICAgICAgICAgIHJlcy53cml0ZUhlYWQoMjAwKTtcbiAgICAgICAgICAgIHJlcy5lbmQoKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGlmIChwYXRobmFtZSA9PT0gJy9tY3AnICYmIHJlcS5tZXRob2QgPT09ICdQT1NUJykge1xuICAgICAgICAgICAgICAgIGF3YWl0IHRoaXMuaGFuZGxlTUNQUmVxdWVzdChyZXEsIHJlcyk7XG4gICAgICAgICAgICB9IGVsc2UgaWYgKHBhdGhuYW1lID09PSAnL2hlYWx0aCcgJiYgcmVxLm1ldGhvZCA9PT0gJ0dFVCcpIHtcbiAgICAgICAgICAgICAgICByZXMud3JpdGVIZWFkKDIwMCk7XG4gICAgICAgICAgICAgICAgcmVzLmVuZChKU09OLnN0cmluZ2lmeSh7IHN0YXR1czogJ29rJywgdG9vbHM6IHRoaXMudG9vbHNMaXN0Lmxlbmd0aCB9KSk7XG4gICAgICAgICAgICB9IGVsc2UgaWYgKHBhdGhuYW1lPy5zdGFydHNXaXRoKCcvYXBpLycpICYmIHJlcS5tZXRob2QgPT09ICdQT1NUJykge1xuICAgICAgICAgICAgICAgIGF3YWl0IHRoaXMuaGFuZGxlU2ltcGxlQVBJUmVxdWVzdChyZXEsIHJlcywgcGF0aG5hbWUpO1xuICAgICAgICAgICAgfSBlbHNlIGlmIChwYXRobmFtZSA9PT0gJy9hcGkvdG9vbHMnICYmIHJlcS5tZXRob2QgPT09ICdHRVQnKSB7XG4gICAgICAgICAgICAgICAgcmVzLndyaXRlSGVhZCgyMDApO1xuICAgICAgICAgICAgICAgIHJlcy5lbmQoSlNPTi5zdHJpbmdpZnkoeyB0b29sczogdGhpcy5nZXRTaW1wbGlmaWVkVG9vbHNMaXN0KCkgfSkpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICByZXMud3JpdGVIZWFkKDQwNCk7XG4gICAgICAgICAgICAgICAgcmVzLmVuZChKU09OLnN0cmluZ2lmeSh7IGVycm9yOiAnTm90IGZvdW5kJyB9KSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKCdIVFRQIHJlcXVlc3QgZXJyb3I6JywgZXJyb3IpO1xuICAgICAgICAgICAgcmVzLndyaXRlSGVhZCg1MDApO1xuICAgICAgICAgICAgcmVzLmVuZChKU09OLnN0cmluZ2lmeSh7IGVycm9yOiAnSW50ZXJuYWwgc2VydmVyIGVycm9yJyB9KSk7XG4gICAgICAgIH1cbiAgICB9XG4gICAgXG4gICAgcHJpdmF0ZSBhc3luYyBoYW5kbGVNQ1BSZXF1ZXN0KHJlcTogaHR0cC5JbmNvbWluZ01lc3NhZ2UsIHJlczogaHR0cC5TZXJ2ZXJSZXNwb25zZSk6IFByb21pc2U8dm9pZD4ge1xuICAgICAgICBsZXQgYm9keSA9ICcnO1xuICAgICAgICBcbiAgICAgICAgcmVxLm9uKCdkYXRhJywgKGNodW5rKSA9PiB7XG4gICAgICAgICAgICBib2R5ICs9IGNodW5rLnRvU3RyaW5nKCk7XG4gICAgICAgIH0pO1xuICAgICAgICBcbiAgICAgICAgcmVxLm9uKCdlbmQnLCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIC8vIEVuaGFuY2VkIEpTT04gcGFyc2luZyB3aXRoIGJldHRlciBlcnJvciBoYW5kbGluZ1xuICAgICAgICAgICAgICAgIGxldCBtZXNzYWdlO1xuICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgIG1lc3NhZ2UgPSBKU09OLnBhcnNlKGJvZHkpO1xuICAgICAgICAgICAgICAgIH0gY2F0Y2ggKHBhcnNlRXJyb3I6IGFueSkge1xuICAgICAgICAgICAgICAgICAgICAvLyBUcnkgdG8gZml4IGNvbW1vbiBKU09OIGlzc3Vlc1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBmaXhlZEJvZHkgPSB0aGlzLmZpeENvbW1vbkpzb25Jc3N1ZXMoYm9keSk7XG4gICAgICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBtZXNzYWdlID0gSlNPTi5wYXJzZShmaXhlZEJvZHkpO1xuICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coJ1tNQ1BTZXJ2ZXJdIEZpeGVkIEpTT04gcGFyc2luZyBpc3N1ZScpO1xuICAgICAgICAgICAgICAgICAgICB9IGNhdGNoIChzZWNvbmRFcnJvcikge1xuICAgICAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBKU09OIHBhcnNpbmcgZmFpbGVkOiAke3BhcnNlRXJyb3IubWVzc2FnZX0uIE9yaWdpbmFsIGJvZHk6ICR7Ym9keS5zdWJzdHJpbmcoMCwgNTAwKX0uLi5gKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHRoaXMuaGFuZGxlTWVzc2FnZShtZXNzYWdlKTtcbiAgICAgICAgICAgICAgICByZXMud3JpdGVIZWFkKDIwMCk7XG4gICAgICAgICAgICAgICAgcmVzLmVuZChKU09OLnN0cmluZ2lmeShyZXNwb25zZSkpO1xuICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3I6IGFueSkge1xuICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIGhhbmRsaW5nIE1DUCByZXF1ZXN0OicsIGVycm9yKTtcbiAgICAgICAgICAgICAgICByZXMud3JpdGVIZWFkKDQwMCk7XG4gICAgICAgICAgICAgICAgcmVzLmVuZChKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgICAgICAgICAgICAgIGpzb25ycGM6ICcyLjAnLFxuICAgICAgICAgICAgICAgICAgICBpZDogbnVsbCxcbiAgICAgICAgICAgICAgICAgICAgZXJyb3I6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvZGU6IC0zMjcwMCxcbiAgICAgICAgICAgICAgICAgICAgICAgIG1lc3NhZ2U6IGBQYXJzZSBlcnJvcjogJHtlcnJvci5tZXNzYWdlfWBcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0pKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBhc3luYyBoYW5kbGVNZXNzYWdlKG1lc3NhZ2U6IGFueSk6IFByb21pc2U8YW55PiB7XG4gICAgICAgIGNvbnN0IHsgaWQsIG1ldGhvZCwgcGFyYW1zIH0gPSBtZXNzYWdlO1xuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBsZXQgcmVzdWx0OiBhbnk7XG5cbiAgICAgICAgICAgIHN3aXRjaCAobWV0aG9kKSB7XG4gICAgICAgICAgICAgICAgY2FzZSAndG9vbHMvbGlzdCc6XG4gICAgICAgICAgICAgICAgICAgIHJlc3VsdCA9IHsgdG9vbHM6IHRoaXMuZ2V0QXZhaWxhYmxlVG9vbHMoKSB9O1xuICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICBjYXNlICd0b29scy9jYWxsJzpcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgeyBuYW1lLCBhcmd1bWVudHM6IGFyZ3MgfSA9IHBhcmFtcztcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgdG9vbFJlc3VsdCA9IGF3YWl0IHRoaXMuZXhlY3V0ZVRvb2xDYWxsKG5hbWUsIGFyZ3MpO1xuICAgICAgICAgICAgICAgICAgICByZXN1bHQgPSB7IGNvbnRlbnQ6IFt7IHR5cGU6ICd0ZXh0JywgdGV4dDogSlNPTi5zdHJpbmdpZnkodG9vbFJlc3VsdCkgfV0gfTtcbiAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgY2FzZSAnaW5pdGlhbGl6ZSc6XG4gICAgICAgICAgICAgICAgICAgIC8vIE1DUCBpbml0aWFsaXphdGlvblxuICAgICAgICAgICAgICAgICAgICByZXN1bHQgPSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBwcm90b2NvbFZlcnNpb246ICcyMDI0LTExLTA1JyxcbiAgICAgICAgICAgICAgICAgICAgICAgIGNhcGFiaWxpdGllczoge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRvb2xzOiB7fVxuICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgIHNlcnZlckluZm86IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBuYW1lOiAnY29jb3MtbWNwLXNlcnZlcicsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdmVyc2lvbjogJzEuMC4wJ1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFVua25vd24gbWV0aG9kOiAke21ldGhvZH1gKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICBqc29ucnBjOiAnMi4wJyxcbiAgICAgICAgICAgICAgICBpZCxcbiAgICAgICAgICAgICAgICByZXN1bHRcbiAgICAgICAgICAgIH07XG4gICAgICAgIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcbiAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAganNvbnJwYzogJzIuMCcsXG4gICAgICAgICAgICAgICAgaWQsXG4gICAgICAgICAgICAgICAgZXJyb3I6IHtcbiAgICAgICAgICAgICAgICAgICAgY29kZTogLTMyNjAzLFxuICAgICAgICAgICAgICAgICAgICBtZXNzYWdlOiBlcnJvci5tZXNzYWdlXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHByaXZhdGUgZml4Q29tbW9uSnNvbklzc3Vlcyhqc29uU3RyOiBzdHJpbmcpOiBzdHJpbmcge1xuICAgICAgICBsZXQgZml4ZWQgPSBqc29uU3RyO1xuICAgICAgICBcbiAgICAgICAgLy8gRml4IGNvbW1vbiBlc2NhcGUgY2hhcmFjdGVyIGlzc3Vlc1xuICAgICAgICBmaXhlZCA9IGZpeGVkXG4gICAgICAgICAgICAvLyBGaXggdW5lc2NhcGVkIHF1b3RlcyBpbiBzdHJpbmdzXG4gICAgICAgICAgICAucmVwbGFjZSgvKFteXFxcXF0pXCIoW15cIl0qW15cXFxcXSlcIihbXix9XFxdOl0pL2csICckMVxcXFxcIiQyXFxcXFwiJDMnKVxuICAgICAgICAgICAgLy8gRml4IHVuZXNjYXBlZCBiYWNrc2xhc2hlc1xuICAgICAgICAgICAgLnJlcGxhY2UoLyhbXlxcXFxdKVxcXFwoW15cIlxcXFxcXC9iZm5ydF0pL2csICckMVxcXFxcXFxcJDInKVxuICAgICAgICAgICAgLy8gRml4IHRyYWlsaW5nIGNvbW1hc1xuICAgICAgICAgICAgLnJlcGxhY2UoLywoXFxzKlt9XFxdXSkvZywgJyQxJylcbiAgICAgICAgICAgIC8vIEZpeCBzaW5nbGUgcXVvdGVzIChzaG91bGQgYmUgZG91YmxlIHF1b3RlcylcbiAgICAgICAgICAgIC5yZXBsYWNlKC8nL2csICdcIicpXG4gICAgICAgICAgICAvLyBGaXggY29tbW9uIGNvbnRyb2wgY2hhcmFjdGVyc1xuICAgICAgICAgICAgLnJlcGxhY2UoL1xcbi9nLCAnXFxcXG4nKVxuICAgICAgICAgICAgLnJlcGxhY2UoL1xcci9nLCAnXFxcXHInKVxuICAgICAgICAgICAgLnJlcGxhY2UoL1xcdC9nLCAnXFxcXHQnKTtcbiAgICAgICAgXG4gICAgICAgIHJldHVybiBmaXhlZDtcbiAgICB9XG5cbiAgICBwdWJsaWMgc3RvcCgpOiB2b2lkIHtcbiAgICAgICAgaWYgKHRoaXMuaHR0cFNlcnZlcikge1xuICAgICAgICAgICAgdGhpcy5odHRwU2VydmVyLmNsb3NlKCk7XG4gICAgICAgICAgICB0aGlzLmh0dHBTZXJ2ZXIgPSBudWxsO1xuICAgICAgICAgICAgY29uc29sZS5sb2coJ1tNQ1BTZXJ2ZXJdIEhUVFAgc2VydmVyIHN0b3BwZWQnKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMuY2xpZW50cy5jbGVhcigpO1xuICAgIH1cblxuICAgIHB1YmxpYyBnZXRTdGF0dXMoKTogU2VydmVyU3RhdHVzIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHJ1bm5pbmc6ICEhdGhpcy5odHRwU2VydmVyLFxuICAgICAgICAgICAgcG9ydDogdGhpcy5zZXR0aW5ncy5wb3J0LFxuICAgICAgICAgICAgY2xpZW50czogMCAvLyBIVFRQIGlzIHN0YXRlbGVzcywgbm8gcGVyc2lzdGVudCBjbGllbnRzXG4gICAgICAgIH07XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBhc3luYyBoYW5kbGVTaW1wbGVBUElSZXF1ZXN0KHJlcTogaHR0cC5JbmNvbWluZ01lc3NhZ2UsIHJlczogaHR0cC5TZXJ2ZXJSZXNwb25zZSwgcGF0aG5hbWU6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgICAgICBsZXQgYm9keSA9ICcnO1xuICAgICAgICBcbiAgICAgICAgcmVxLm9uKCdkYXRhJywgKGNodW5rKSA9PiB7XG4gICAgICAgICAgICBib2R5ICs9IGNodW5rLnRvU3RyaW5nKCk7XG4gICAgICAgIH0pO1xuICAgICAgICBcbiAgICAgICAgcmVxLm9uKCdlbmQnLCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIC8vIEV4dHJhY3QgdG9vbCBuYW1lIGZyb20gcGF0aCBsaWtlIC9hcGkvbm9kZS9zZXRfcG9zaXRpb25cbiAgICAgICAgICAgICAgICBjb25zdCBwYXRoUGFydHMgPSBwYXRobmFtZS5zcGxpdCgnLycpLmZpbHRlcihwID0+IHApO1xuICAgICAgICAgICAgICAgIGlmIChwYXRoUGFydHMubGVuZ3RoIDwgMykge1xuICAgICAgICAgICAgICAgICAgICByZXMud3JpdGVIZWFkKDQwMCk7XG4gICAgICAgICAgICAgICAgICAgIHJlcy5lbmQoSlNPTi5zdHJpbmdpZnkoeyBlcnJvcjogJ0ludmFsaWQgQVBJIHBhdGguIFVzZSAvYXBpL3tjYXRlZ29yeX0ve3Rvb2xfbmFtZX0nIH0pKTtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBjb25zdCBjYXRlZ29yeSA9IHBhdGhQYXJ0c1sxXTtcbiAgICAgICAgICAgICAgICBjb25zdCB0b29sTmFtZSA9IHBhdGhQYXJ0c1syXTtcbiAgICAgICAgICAgICAgICBjb25zdCBmdWxsVG9vbE5hbWUgPSBgJHtjYXRlZ29yeX1fJHt0b29sTmFtZX1gO1xuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIC8vIFBhcnNlIHBhcmFtZXRlcnMgd2l0aCBlbmhhbmNlZCBlcnJvciBoYW5kbGluZ1xuICAgICAgICAgICAgICAgIGxldCBwYXJhbXM7XG4gICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgcGFyYW1zID0gYm9keSA/IEpTT04ucGFyc2UoYm9keSkgOiB7fTtcbiAgICAgICAgICAgICAgICB9IGNhdGNoIChwYXJzZUVycm9yOiBhbnkpIHtcbiAgICAgICAgICAgICAgICAgICAgLy8gVHJ5IHRvIGZpeCBKU09OIGlzc3Vlc1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBmaXhlZEJvZHkgPSB0aGlzLmZpeENvbW1vbkpzb25Jc3N1ZXMoYm9keSk7XG4gICAgICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBwYXJhbXMgPSBKU09OLnBhcnNlKGZpeGVkQm9keSk7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmxvZygnW01DUFNlcnZlcl0gRml4ZWQgQVBJIEpTT04gcGFyc2luZyBpc3N1ZScpO1xuICAgICAgICAgICAgICAgICAgICB9IGNhdGNoIChzZWNvbmRFcnJvcjogYW55KSB7XG4gICAgICAgICAgICAgICAgICAgICAgICByZXMud3JpdGVIZWFkKDQwMCk7XG4gICAgICAgICAgICAgICAgICAgICAgICByZXMuZW5kKEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBlcnJvcjogJ0ludmFsaWQgSlNPTiBpbiByZXF1ZXN0IGJvZHknLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRldGFpbHM6IHBhcnNlRXJyb3IubWVzc2FnZSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZWNlaXZlZEJvZHk6IGJvZHkuc3Vic3RyaW5nKDAsIDIwMClcbiAgICAgICAgICAgICAgICAgICAgICAgIH0pKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAvLyBFeGVjdXRlIHRvb2xcbiAgICAgICAgICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLmV4ZWN1dGVUb29sQ2FsbChmdWxsVG9vbE5hbWUsIHBhcmFtcyk7XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgcmVzLndyaXRlSGVhZCgyMDApO1xuICAgICAgICAgICAgICAgIHJlcy5lbmQoSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICAgICAgICAgICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgICAgICAgICAgICAgICB0b29sOiBmdWxsVG9vbE5hbWUsXG4gICAgICAgICAgICAgICAgICAgIHJlc3VsdDogcmVzdWx0XG4gICAgICAgICAgICAgICAgfSkpO1xuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3I6IGFueSkge1xuICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1NpbXBsZSBBUEkgZXJyb3I6JywgZXJyb3IpO1xuICAgICAgICAgICAgICAgIHJlcy53cml0ZUhlYWQoNTAwKTtcbiAgICAgICAgICAgICAgICByZXMuZW5kKEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgICAgICAgICAgICAgc3VjY2VzczogZmFsc2UsXG4gICAgICAgICAgICAgICAgICAgIGVycm9yOiBlcnJvci5tZXNzYWdlLFxuICAgICAgICAgICAgICAgICAgICB0b29sOiBwYXRobmFtZVxuICAgICAgICAgICAgICAgIH0pKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBnZXRTaW1wbGlmaWVkVG9vbHNMaXN0KCk6IGFueVtdIHtcbiAgICAgICAgcmV0dXJuIHRoaXMudG9vbHNMaXN0Lm1hcCh0b29sID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHBhcnRzID0gdG9vbC5uYW1lLnNwbGl0KCdfJyk7XG4gICAgICAgICAgICBjb25zdCBjYXRlZ29yeSA9IHBhcnRzWzBdO1xuICAgICAgICAgICAgY29uc3QgdG9vbE5hbWUgPSBwYXJ0cy5zbGljZSgxKS5qb2luKCdfJyk7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgbmFtZTogdG9vbC5uYW1lLFxuICAgICAgICAgICAgICAgIGNhdGVnb3J5OiBjYXRlZ29yeSxcbiAgICAgICAgICAgICAgICB0b29sTmFtZTogdG9vbE5hbWUsXG4gICAgICAgICAgICAgICAgZGVzY3JpcHRpb246IHRvb2wuZGVzY3JpcHRpb24sXG4gICAgICAgICAgICAgICAgYXBpUGF0aDogYC9hcGkvJHtjYXRlZ29yeX0vJHt0b29sTmFtZX1gLFxuICAgICAgICAgICAgICAgIGN1cmxFeGFtcGxlOiB0aGlzLmdlbmVyYXRlQ3VybEV4YW1wbGUoY2F0ZWdvcnksIHRvb2xOYW1lLCB0b29sLmlucHV0U2NoZW1hKVxuICAgICAgICAgICAgfTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBnZW5lcmF0ZUN1cmxFeGFtcGxlKGNhdGVnb3J5OiBzdHJpbmcsIHRvb2xOYW1lOiBzdHJpbmcsIHNjaGVtYTogYW55KTogc3RyaW5nIHtcbiAgICAgICAgLy8gR2VuZXJhdGUgc2FtcGxlIHBhcmFtZXRlcnMgYmFzZWQgb24gc2NoZW1hXG4gICAgICAgIGNvbnN0IHNhbXBsZVBhcmFtcyA9IHRoaXMuZ2VuZXJhdGVTYW1wbGVQYXJhbXMoc2NoZW1hKTtcbiAgICAgICAgY29uc3QganNvblN0cmluZyA9IEpTT04uc3RyaW5naWZ5KHNhbXBsZVBhcmFtcywgbnVsbCwgMik7XG4gICAgICAgIFxuICAgICAgICByZXR1cm4gYGN1cmwgLVggUE9TVCBodHRwOi8vMTI3LjAuMC4xOjg1ODUvYXBpLyR7Y2F0ZWdvcnl9LyR7dG9vbE5hbWV9IFxcXFxcbiAgLUggXCJDb250ZW50LVR5cGU6IGFwcGxpY2F0aW9uL2pzb25cIiBcXFxcXG4gIC1kICcke2pzb25TdHJpbmd9J2A7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBnZW5lcmF0ZVNhbXBsZVBhcmFtcyhzY2hlbWE6IGFueSk6IGFueSB7XG4gICAgICAgIGlmICghc2NoZW1hIHx8ICFzY2hlbWEucHJvcGVydGllcykgcmV0dXJuIHt9O1xuICAgICAgICBcbiAgICAgICAgY29uc3Qgc2FtcGxlOiBhbnkgPSB7fTtcbiAgICAgICAgZm9yIChjb25zdCBba2V5LCBwcm9wXSBvZiBPYmplY3QuZW50cmllcyhzY2hlbWEucHJvcGVydGllcyBhcyBhbnkpKSB7XG4gICAgICAgICAgICBjb25zdCBwcm9wU2NoZW1hID0gcHJvcCBhcyBhbnk7XG4gICAgICAgICAgICBzd2l0Y2ggKHByb3BTY2hlbWEudHlwZSkge1xuICAgICAgICAgICAgICAgIGNhc2UgJ3N0cmluZyc6XG4gICAgICAgICAgICAgICAgICAgIHNhbXBsZVtrZXldID0gcHJvcFNjaGVtYS5kZWZhdWx0IHx8ICdleGFtcGxlX3N0cmluZyc7XG4gICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgIGNhc2UgJ251bWJlcic6XG4gICAgICAgICAgICAgICAgICAgIHNhbXBsZVtrZXldID0gcHJvcFNjaGVtYS5kZWZhdWx0IHx8IDQyO1xuICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICBjYXNlICdib29sZWFuJzpcbiAgICAgICAgICAgICAgICAgICAgc2FtcGxlW2tleV0gPSBwcm9wU2NoZW1hLmRlZmF1bHQgfHwgdHJ1ZTtcbiAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgY2FzZSAnb2JqZWN0JzpcbiAgICAgICAgICAgICAgICAgICAgc2FtcGxlW2tleV0gPSBwcm9wU2NoZW1hLmRlZmF1bHQgfHwgeyB4OiAwLCB5OiAwLCB6OiAwIH07XG4gICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICAgICAgICAgIHNhbXBsZVtrZXldID0gJ2V4YW1wbGVfdmFsdWUnO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiBzYW1wbGU7XG4gICAgfVxuXG4gICAgcHVibGljIHVwZGF0ZVNldHRpbmdzKHNldHRpbmdzOiBNQ1BTZXJ2ZXJTZXR0aW5ncykge1xuICAgICAgICB0aGlzLnNldHRpbmdzID0gc2V0dGluZ3M7XG4gICAgICAgIGlmICh0aGlzLmh0dHBTZXJ2ZXIpIHtcbiAgICAgICAgICAgIHRoaXMuc3RvcCgpO1xuICAgICAgICAgICAgdGhpcy5zdGFydCgpO1xuICAgICAgICB9XG4gICAgfVxufVxuXG4vLyBIVFRQIHRyYW5zcG9ydCBkb2Vzbid0IG5lZWQgcGVyc2lzdGVudCBjb25uZWN0aW9uc1xuLy8gTUNQIG92ZXIgSFRUUCB1c2VzIHJlcXVlc3QtcmVzcG9uc2UgcGF0dGVybiJdfQ==