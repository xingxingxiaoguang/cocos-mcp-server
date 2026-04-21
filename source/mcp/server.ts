import * as http from 'http';
import * as url from 'url';
import * as crypto from 'crypto';
import { MCPClient, MCPServerSettings, ServerStatus, ToolDefinition, ToolExecutor, ToolResponse } from './interface';
import { ToolConfig } from '../config/interface';
import { createToolDefinitions, createToolExecutors } from '../tools/registry';
import { RuntimeBridge, setGlobalRuntimeBridge } from '../preview/bridge';
import { getCapabilityRegistry, resetCapabilityRegistry } from '../core/capability-registry';
import { getAgentScript } from '../preview/inject-script';

export class MCPServer {
    private settings: MCPServerSettings;
    private httpServer: http.Server | null = null;
    private clients: Map<string, MCPClient> = new Map();
    private tools: Record<string, ToolExecutor> = {};
    private toolsList: ToolDefinition[] = [];
    private enabledTools: ToolConfig[] = [];
    private runtimeBridge: RuntimeBridge | null = null;

    // Streamable HTTP session state
    private sessionId: string | null = null;
    private initialized = false;
    private sseStream: http.ServerResponse | null = null;

    constructor(settings: MCPServerSettings) {
        this.settings = settings;
        this.initializeTools();
        this.setupTools();
    }

    private initializeTools(): void {
        try {
            console.log('[MCPServer] Initializing v2 tools...');
            this.tools = createToolExecutors();
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

            this.runtimeBridge = new RuntimeBridge();
            this.runtimeBridge.attach(this.httpServer!);
            setGlobalRuntimeBridge(this.runtimeBridge);

            this.setupTools();
            console.log('[MCPServer] 🚀 MCP Server is ready for connections');
        } catch (error) {
            console.error('[MCPServer] ❌ Failed to start server:', error);
            throw error;
        }
    }

    private setupTools(): void {
        this.toolsList = createToolDefinitions(this.enabledTools, this.tools);
        console.log(`[MCPServer] Setup tools: ${this.toolsList.length} tools available`);
    }

    public getFilteredTools(enabledTools: ToolConfig[]): ToolDefinition[] {
        return createToolDefinitions(enabledTools, this.tools);
    }

    public async executeToolCall(toolName: string, args: any): Promise<ToolResponse> {
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

    public updateEnabledTools(enabledTools: ToolConfig[]): void {
        console.log(`[MCPServer] Updating enabled tools: ${enabledTools.length} tools`);
        this.enabledTools = enabledTools;
        this.setupTools();
    }

    public getSettings(): MCPServerSettings {
        return this.settings;
    }

    // ==================== HTTP request routing ====================

    private async handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        const parsedUrl = url.parse(req.url || '', true);
        const pathname = parsedUrl.pathname;

        // CORS headers
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, Mcp-Session-Id, Mcp-Protocol-Version');
        res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');

        if (req.method === 'OPTIONS') {
            res.writeHead(200);
            res.end();
            return;
        }

        try {
            if (pathname === '/runtime-agent.js' && req.method === 'GET') {
                this.serveRuntimeAgent(res);
            } else if (pathname === '/mcp') {
                await this.handleMCPEndpoint(req, res);
            } else if (pathname === '/health' && req.method === 'GET') {
                res.setHeader('Content-Type', 'application/json');
                res.writeHead(200);
                res.end(JSON.stringify({ status: 'ok', tools: this.toolsList.length }));
            } else if (pathname?.startsWith('/api/') && req.method === 'POST') {
                await this.handleSimpleAPIRequest(req, res, pathname);
            } else if (pathname === '/api/tools' && req.method === 'GET') {
                res.setHeader('Content-Type', 'application/json');
                res.writeHead(200);
                res.end(JSON.stringify({ tools: this.getSimplifiedToolsList() }));
            } else {
                res.setHeader('Content-Type', 'application/json');
                res.writeHead(404);
                res.end(JSON.stringify({ error: 'Not found' }));
            }
        } catch (error) {
            console.error('HTTP request error:', error);
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(500);
            res.end(JSON.stringify({ error: 'Internal server error' }));
        }
    }

    // ==================== MCP Streamable HTTP transport ====================

    private async handleMCPEndpoint(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        switch (req.method) {
            case 'POST':
                await this.handleMCPPost(req, res);
                break;
            case 'GET':
                this.handleMCPGet(req, res);
                break;
            case 'DELETE':
                this.handleMCPDelete(req, res);
                break;
            default:
                res.setHeader('Allow', 'GET, POST, DELETE');
                this.writeJsonError(res, 405, -32000, 'Method not allowed');
        }
    }

    /**
     * POST /mcp — Handle JSON-RPC requests via SSE stream.
     * Fallback to plain JSON if client doesn't accept text/event-stream.
     */
    private async handleMCPPost(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        const body = await this.readBody(req);
        const accept = req.headers.accept || '';
        const useSse = accept.includes('text/event-stream');

        // Parse JSON-RPC message
        let message: any;
        try {
            message = JSON.parse(body);
        } catch {
            try {
                message = JSON.parse(this.fixCommonJsonIssues(body));
            } catch {
                this.writeJsonError(res, 400, -32700, 'Parse error: Invalid JSON');
                return;
            }
        }

        const isInitReq = message.method === 'initialize';
        const isNotification = message.method && message.id === undefined;

        // Session validation for non-init requests
        if (!isInitReq && this.sessionId) {
            const clientSessionId = req.headers['mcp-session-id'] as string | undefined;
            if (!clientSessionId) {
                this.writeJsonError(res, 400, -32000, 'Bad Request: Mcp-Session-Id header is required');
                return;
            }
            if (clientSessionId !== this.sessionId) {
                this.writeJsonError(res, 404, -32001, 'Session not found');
                return;
            }
        }

        // Handle initialize: generate session
        if (isInitReq) {
            this.sessionId = crypto.randomUUID();
            this.initialized = true;
        }

        // Notifications have no response — return 202
        if (isNotification) {
            if (this.sessionId) {
                res.setHeader('Mcp-Session-Id', this.sessionId);
            }
            res.writeHead(202);
            res.end();
            return;
        }

        // Build the JSON-RPC response
        const response = await this.handleMessage(message);

        if (useSse) {
            // SSE streaming response (Streamable HTTP standard)
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache, no-transform');
            res.setHeader('Connection', 'keep-alive');
            if (this.sessionId) {
                res.setHeader('Mcp-Session-Id', this.sessionId);
            }
            res.writeHead(200);
            this.writeSSEEvent(res, response);
            res.end();
        } else {
            // Fallback: plain JSON response (backward compatible)
            res.setHeader('Content-Type', 'application/json');
            if (this.sessionId) {
                res.setHeader('Mcp-Session-Id', this.sessionId);
            }
            res.writeHead(200);
            res.end(JSON.stringify(response));
        }
    }

    /**
     * GET /mcp — Open SSE stream for server-initiated messages.
     */
    private handleMCPGet(req: http.IncomingMessage, res: http.ServerResponse): void {
        const accept = req.headers.accept || '';
        if (!accept.includes('text/event-stream')) {
            this.writeJsonError(res, 406, -32000, 'Not Acceptable: Client must accept text/event-stream');
            return;
        }

        // Session validation
        if (this.sessionId) {
            const clientSessionId = req.headers['mcp-session-id'] as string | undefined;
            if (!clientSessionId || clientSessionId !== this.sessionId) {
                this.writeJsonError(res, this.initialized ? 404 : 400, -32000, 'Invalid or missing Mcp-Session-Id');
                return;
            }
        }

        // Close existing SSE stream if any
        if (this.sseStream) {
            try { this.sseStream.end(); } catch { /* ignore */ }
        }

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        if (this.sessionId) {
            res.setHeader('Mcp-Session-Id', this.sessionId);
        }
        res.writeHead(200);

        this.sseStream = res;

        req.on('close', () => {
            if (this.sseStream === res) {
                this.sseStream = null;
            }
        });
    }

    /**
     * DELETE /mcp — Terminate the session.
     */
    private handleMCPDelete(req: http.IncomingMessage, res: http.ServerResponse): void {
        if (this.sessionId) {
            const clientSessionId = req.headers['mcp-session-id'] as string | undefined;
            if (!clientSessionId || clientSessionId !== this.sessionId) {
                this.writeJsonError(res, 404, -32001, 'Session not found');
                return;
            }
        }

        // Close SSE stream
        if (this.sseStream) {
            try { this.sseStream.end(); } catch { /* ignore */ }
            this.sseStream = null;
        }

        // Reset session
        this.sessionId = null;
        this.initialized = false;

        res.writeHead(200);
        res.end();
    }

    // ==================== SSE helpers ====================

    private writeSSEEvent(res: http.ServerResponse, data: any): void {
        res.write(`event: message\ndata: ${JSON.stringify(data)}\n\n`);
    }

    private writeJsonError(res: http.ServerResponse, status: number, code: number, message: string): void {
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(status);
        res.end(JSON.stringify({
            jsonrpc: '2.0',
            error: { code, message },
            id: null,
        }));
    }

    // ==================== JSON-RPC message handling ====================

    private async handleMessage(message: any): Promise<any> {
        const { id, method, params } = message;

        try {
            let result: any;

            switch (method) {
                case 'tools/list':
                    result = { tools: this.getAvailableTools() };
                    break;
                case 'tools/call': {
                    const { name, arguments: args } = params;
                    const toolResult = await this.executeToolCall(name, args);
                    result = { content: [{ type: 'text', text: JSON.stringify(toolResult) }] };
                    break;
                }
                case 'initialize':
                    result = {
                        protocolVersion: '2025-03-26',
                        capabilities: {
                            tools: {}
                        },
                        serverInfo: {
                            name: 'cocos-mcp-server',
                            version: '2.0.0'
                        }
                    };
                    break;
                default:
                    throw new Error(`Unknown method: ${method}`);
            }

            return { jsonrpc: '2.0', id, result };
        } catch (error: any) {
            return {
                jsonrpc: '2.0',
                id,
                error: { code: -32603, message: error.message }
            };
        }
    }

    // ==================== Utilities ====================

    private readBody(req: http.IncomingMessage): Promise<string> {
        return new Promise((resolve, reject) => {
            let body = '';
            req.on('data', (chunk) => { body += chunk.toString(); });
            req.on('end', () => resolve(body));
            req.on('error', reject);
        });
    }

    private fixCommonJsonIssues(jsonStr: string): string {
        return jsonStr
            .replace(/([^\\])"([^"]*[^\\])"([^,}\]:])/g, '$1\\"$2\\"$3')
            .replace(/([^\\])\\([^"\\\/bfnrt])/g, '$1\\\\$2')
            .replace(/,(\s*[}\]])/g, '$1')
            .replace(/'/g, '"')
            .replace(/\n/g, '\\n')
            .replace(/\r/g, '\\r')
            .replace(/\t/g, '\\t');
    }

    private serveRuntimeAgent(res: http.ServerResponse): void {
        try {
            const script = getAgentScript(this.settings.port);
            res.setHeader('Content-Type', 'application/javascript');
            res.writeHead(200);
            res.end(script);
        } catch (err: any) {
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(500);
            res.end(JSON.stringify({ error: err.message }));
        }
    }

    // ==================== Server lifecycle ====================

    public stop(): void {
        if (this.sseStream) {
            try { this.sseStream.end(); } catch { /* ignore */ }
            this.sseStream = null;
        }

        this.sessionId = null;
        this.initialized = false;

        if (this.runtimeBridge) {
            this.runtimeBridge.detach();
            setGlobalRuntimeBridge(null);
            this.runtimeBridge = null;
        }

        if (this.httpServer) {
            this.httpServer.close();
            this.httpServer = null;
            console.log('[MCPServer] HTTP server stopped');
        }

        this.clients.clear();

        try {
            getCapabilityRegistry().debug.dispose();
        } catch { /* registry may not be initialized */ }
        resetCapabilityRegistry();
    }

    public getStatus(): ServerStatus {
        return {
            running: !!this.httpServer,
            port: this.settings.port,
            clients: this.sseStream ? 1 : 0
        };
    }

    public updateSettings(settings: MCPServerSettings) {
        this.settings = settings;
        if (this.httpServer) {
            this.stop();
            this.start();
        }
    }

    // ==================== Simple REST API (backward compatible) ====================

    private async handleSimpleAPIRequest(req: http.IncomingMessage, res: http.ServerResponse, pathname: string): Promise<void> {
        const body = await this.readBody(req);

        try {
            const pathParts = pathname.split('/').filter(p => p);
            if (pathParts.length < 3) {
                res.setHeader('Content-Type', 'application/json');
                res.writeHead(400);
                res.end(JSON.stringify({ error: 'Invalid API path. Use /api/{category}/{tool_name}' }));
                return;
            }

            const category = pathParts[1];
            const toolName = pathParts[2];
            const fullToolName = `${category}_${toolName}`;

            let params;
            try {
                params = body ? JSON.parse(body) : {};
            } catch {
                try {
                    params = JSON.parse(this.fixCommonJsonIssues(body));
                } catch (e: any) {
                    res.setHeader('Content-Type', 'application/json');
                    res.writeHead(400);
                    res.end(JSON.stringify({ error: 'Invalid JSON in request body', details: e.message }));
                    return;
                }
            }

            const result = await this.executeToolCall(fullToolName, params);

            res.setHeader('Content-Type', 'application/json');
            res.writeHead(200);
            res.end(JSON.stringify({ success: true, tool: fullToolName, result }));
        } catch (error: any) {
            console.error('Simple API error:', error);
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(500);
            res.end(JSON.stringify({ success: false, error: error.message, tool: pathname }));
        }
    }

    private getSimplifiedToolsList(): any[] {
        return this.toolsList.map(tool => {
            const parts = tool.name.split('_');
            const category = parts[0];
            const toolName = parts.slice(1).join('_');

            return {
                name: tool.name,
                category,
                toolName,
                description: tool.description,
                apiPath: `/api/${category}/${toolName}`,
                curlExample: `curl -X POST http://127.0.0.1:${this.settings.port}/api/${category}/${toolName} -H "Content-Type: application/json" -d '{}'`
            };
        });
    }
}
