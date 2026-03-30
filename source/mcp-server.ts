import * as http from 'http';
import * as url from 'url';
import { v4 as uuidv4 } from 'uuid';
import { MCPServerSettings, ServerStatus, MCPClient, ToolDefinition } from './types';
import { SceneToolsV2 } from './tools/v2/scene-tools';
import { NodeToolsV2 } from './tools/v2/node-tools';
import { ComponentToolsV2 } from './tools/v2/component-tools';
import { PrefabToolsV2 } from './tools/v2/prefab-tools';
import { AssetToolsV2 } from './tools/v2/asset-tools';
import { DebugToolsV2 } from './tools/v2/debug-tools';
import { ProjectToolsV2 } from './tools/v2/project-tools';
import { PreferencesToolsV2 } from './tools/v2/preferences-tools';
import { UndoToolsV2 } from './tools/v2/undo-tools';
import { SceneScriptToolsV2 } from './tools/v2/scene-script-tools';
import { ArrayPropertyToolsV2 } from './tools/v2/array-property-tools';
import { AnimationToolsV2 } from './tools/v2/animation-tools';

export class MCPServer {
    private settings: MCPServerSettings;
    private httpServer: http.Server | null = null;
    private clients: Map<string, MCPClient> = new Map();
    private tools: Record<string, any> = {};
    private toolsList: ToolDefinition[] = [];
    private enabledTools: any[] = []; // 存储启用的工具列表

    constructor(settings: MCPServerSettings) {
        this.settings = settings;
        this.initializeTools();
    }

    private initializeTools(): void {
        try {
            console.log('[MCPServer] Initializing v2 tools...');
            this.tools.scene = new SceneToolsV2();
            this.tools.node = new NodeToolsV2();
            this.tools.component = new ComponentToolsV2();
            this.tools.prefab = new PrefabToolsV2();
            this.tools.asset = new AssetToolsV2();
            this.tools.debug = new DebugToolsV2();
            this.tools.project = new ProjectToolsV2();
            this.tools.preferences = new PreferencesToolsV2();
            this.tools.undo = new UndoToolsV2();
            this.tools.sceneScript = new SceneScriptToolsV2();
            this.tools.array = new ArrayPropertyToolsV2();
            this.tools.animation = new AnimationToolsV2();
            console.log('[MCPServer] V2 tools initialized successfully');
        } catch (error) {
            console.error('[MCPServer] Error initializing v2 tools:', error);
            throw error;
        }
    }

    public async start(): Promise<void> {
        if (this.httpServer) {
            console.log('[MCPServer] Server is already running');
            return;
        }

        try {
            console.log(`[MCPServer] Starting HTTP server on port ${this.settings.port}...`);
            this.httpServer = http.createServer(this.handleHttpRequest.bind(this));

            await new Promise<void>((resolve, reject) => {
                this.httpServer!.listen(this.settings.port, '127.0.0.1', () => {
                    console.log(`[MCPServer] ✅ HTTP server started successfully on http://127.0.0.1:${this.settings.port}`);
                    console.log(`[MCPServer] Health check: http://127.0.0.1:${this.settings.port}/health`);
                    console.log(`[MCPServer] MCP endpoint: http://127.0.0.1:${this.settings.port}/mcp`);
                    resolve();
                });
                this.httpServer!.on('error', (err: any) => {
                    console.error('[MCPServer] ❌ Failed to start server:', err);
                    if (err.code === 'EADDRINUSE') {
                        console.error(`[MCPServer] Port ${this.settings.port} is already in use. Please change the port in settings.`);
                    }
                    reject(err);
                });
            });

            this.setupTools();
            console.log('[MCPServer] 🚀 MCP Server is ready for connections');
        } catch (error) {
            console.error('[MCPServer] ❌ Failed to start server:', error);
            throw error;
        }
    }

    private setupTools(): void {
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
        } else {
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

    public getFilteredTools(enabledTools: any[]): ToolDefinition[] {
        if (!enabledTools || enabledTools.length === 0) {
            return this.toolsList; // 如果没有过滤配置，返回所有工具
        }

        const enabledToolNames = new Set(enabledTools.map(tool => `${tool.category}_${tool.name}`));
        return this.toolsList.filter(tool => enabledToolNames.has(tool.name));
    }

    public async executeToolCall(toolName: string, args: any): Promise<any> {
        const parts = toolName.split('_');
        const category = parts[0];
        const toolMethodName = parts.slice(1).join('_');
        
        if (this.tools[category]) {
            return await this.tools[category].execute(toolMethodName, args);
        }
        
        throw new Error(`Tool ${toolName} not found`);
    }

    public getClients(): MCPClient[] {
        return Array.from(this.clients.values());
    }
    public getAvailableTools(): ToolDefinition[] {
        return this.toolsList;
    }

    public updateEnabledTools(enabledTools: any[]): void {
        console.log(`[MCPServer] Updating enabled tools: ${enabledTools.length} tools`);
        this.enabledTools = enabledTools;
        this.setupTools(); // 重新设置工具列表
    }

    public getSettings(): MCPServerSettings {
        return this.settings;
    }

    private async handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
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
            } else if (pathname === '/health' && req.method === 'GET') {
                res.writeHead(200);
                res.end(JSON.stringify({ status: 'ok', tools: this.toolsList.length }));
            } else if (pathname?.startsWith('/api/') && req.method === 'POST') {
                await this.handleSimpleAPIRequest(req, res, pathname);
            } else if (pathname === '/api/tools' && req.method === 'GET') {
                res.writeHead(200);
                res.end(JSON.stringify({ tools: this.getSimplifiedToolsList() }));
            } else {
                res.writeHead(404);
                res.end(JSON.stringify({ error: 'Not found' }));
            }
        } catch (error) {
            console.error('HTTP request error:', error);
            res.writeHead(500);
            res.end(JSON.stringify({ error: 'Internal server error' }));
        }
    }
    
    private async handleMCPRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
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
                } catch (parseError: any) {
                    // Try to fix common JSON issues
                    const fixedBody = this.fixCommonJsonIssues(body);
                    try {
                        message = JSON.parse(fixedBody);
                        console.log('[MCPServer] Fixed JSON parsing issue');
                    } catch (secondError) {
                        throw new Error(`JSON parsing failed: ${parseError.message}. Original body: ${body.substring(0, 500)}...`);
                    }
                }
                
                const response = await this.handleMessage(message);
                res.writeHead(200);
                res.end(JSON.stringify(response));
            } catch (error: any) {
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

    private async handleMessage(message: any): Promise<any> {
        const { id, method, params } = message;

        try {
            let result: any;

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
        } catch (error: any) {
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

    private fixCommonJsonIssues(jsonStr: string): string {
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

    public stop(): void {
        if (this.httpServer) {
            this.httpServer.close();
            this.httpServer = null;
            console.log('[MCPServer] HTTP server stopped');
        }

        this.clients.clear();
    }

    public getStatus(): ServerStatus {
        return {
            running: !!this.httpServer,
            port: this.settings.port,
            clients: 0 // HTTP is stateless, no persistent clients
        };
    }

    private async handleSimpleAPIRequest(req: http.IncomingMessage, res: http.ServerResponse, pathname: string): Promise<void> {
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
                } catch (parseError: any) {
                    // Try to fix JSON issues
                    const fixedBody = this.fixCommonJsonIssues(body);
                    try {
                        params = JSON.parse(fixedBody);
                        console.log('[MCPServer] Fixed API JSON parsing issue');
                    } catch (secondError: any) {
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
                
            } catch (error: any) {
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

    private getSimplifiedToolsList(): any[] {
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

    private generateCurlExample(category: string, toolName: string, schema: any): string {
        // Generate sample parameters based on schema
        const sampleParams = this.generateSampleParams(schema);
        const jsonString = JSON.stringify(sampleParams, null, 2);
        
        return `curl -X POST http://127.0.0.1:8585/api/${category}/${toolName} \\
  -H "Content-Type: application/json" \\
  -d '${jsonString}'`;
    }

    private generateSampleParams(schema: any): any {
        if (!schema || !schema.properties) return {};
        
        const sample: any = {};
        for (const [key, prop] of Object.entries(schema.properties as any)) {
            const propSchema = prop as any;
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

    public updateSettings(settings: MCPServerSettings) {
        this.settings = settings;
        if (this.httpServer) {
            this.stop();
            this.start();
        }
    }
}

// HTTP transport doesn't need persistent connections
// MCP over HTTP uses request-response pattern
