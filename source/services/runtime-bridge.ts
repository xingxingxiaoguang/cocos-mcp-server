import * as http from 'http';
import WebSocket from 'ws';
import { ConsoleMessage } from '../tools/v2/debug/interface';

interface PendingRequest {
    resolve: (value: any) => void;
    reject: (reason: any) => void;
    timer: ReturnType<typeof setTimeout>;
}

interface AgentInfo {
    url?: string;
    userAgent?: string;
    connectedAt: string;
}

/**
 * RuntimeBridge — WebSocket Server that communicates with the Runtime Agent
 * injected into the Preview browser.
 *
 * Attaches to the existing HTTP server on the `/runtime` path.
 */
export class RuntimeBridge {
    private wss: WebSocket.Server | null = null;
    private agent: WebSocket | null = null;
    private agentInfo: AgentInfo | null = null;

    private logs: ConsoleMessage[] = [];
    private readonly maxLogs = 1000;

    private requestId = 0;
    private pending = new Map<number, PendingRequest>();
    private readonly requestTimeout = 10_000;

    // ---- lifecycle ----

    attach(server: http.Server): void {
        if (this.wss) return;

        this.wss = new WebSocket.Server({ noServer: true });

        server.on('upgrade', (req: http.IncomingMessage, socket, head) => {
            if (req.url === '/runtime') {
                this.wss!.handleUpgrade(req, socket as any, head, (ws) => {
                    this.wss!.emit('connection', ws, req);
                });
            }
        });

        this.wss.on('connection', (ws) => {
            // Only allow one agent at a time
            if (this.agent) {
                this.agent.close();
            }
            this.agent = ws;
            this.agentInfo = { connectedAt: new Date().toISOString() };
            console.log('[RuntimeBridge] Agent connected');

            ws.on('message', (raw) => {
                try {
                    const msg = JSON.parse(String(raw));
                    this.handleAgentMessage(msg);
                } catch {
                    // ignore malformed messages
                }
            });

            ws.on('close', () => {
                if (this.agent === ws) {
                    this.agent = null;
                    this.agentInfo = null;
                    console.log('[RuntimeBridge] Agent disconnected');
                }
            });
        });

        console.log('[RuntimeBridge] Attached to HTTP server on /runtime');
    }

    detach(): void {
        // Reject all pending requests
        for (const [, req] of this.pending) {
            clearTimeout(req.timer);
            req.reject(new Error('RuntimeBridge detached'));
        }
        this.pending.clear();

        if (this.agent) {
            this.agent.close();
            this.agent = null;
            this.agentInfo = null;
        }
        if (this.wss) {
            this.wss.close();
            this.wss = null;
        }
        this.logs = [];
        console.log('[RuntimeBridge] Detached');
    }

    // ---- status ----

    isConnected(): boolean {
        return this.agent !== null && this.agent.readyState === WebSocket.OPEN;
    }

    getStatus(): { connected: boolean; agentInfo: AgentInfo | null } {
        return { connected: this.isConnected(), agentInfo: this.agentInfo };
    }

    // ---- logs ----

    getLogs(limit: number = 100, level: string = 'all'): ConsoleMessage[] {
        let logs = this.logs;
        if (level && level !== 'all') {
            logs = logs.filter((l) => l.type === level);
        }
        return logs.slice(-limit);
    }

    clearLogs(): void {
        this.logs = [];
    }

    // ---- remote calls ----

    execute(script: string): Promise<any> {
        return this.sendRequest('execute', { script });
    }

    getSummary(): Promise<any> {
        return this.sendRequest('get_summary', {});
    }

    // ---- internals ----

    private handleAgentMessage(msg: any): void {
        switch (msg.type) {
            case 'log':
                this.addLog(msg);
                break;
            case 'response':
                this.resolveRequest(msg);
                break;
            case 'ready':
                if (msg.info && this.agentInfo) {
                    this.agentInfo.url = msg.info.url;
                    this.agentInfo.userAgent = msg.info.userAgent;
                }
                console.log('[RuntimeBridge] Agent ready', msg.info?.url || '');
                break;
        }
    }

    private addLog(msg: any): void {
        this.logs.push({
            timestamp: msg.timestamp || new Date().toISOString(),
            type: msg.level || 'log',
            content: msg.content || '',
            source: 'runtime',
        });
        if (this.logs.length > this.maxLogs) {
            this.logs.shift();
        }
    }

    private resolveRequest(msg: any): void {
        const pending = this.pending.get(msg.id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(msg.id);

        if (msg.success) {
            pending.resolve(msg.data);
        } else {
            pending.reject(new Error(msg.error || 'Agent request failed'));
        }
    }

    private sendRequest(type: string, payload: Record<string, any>): Promise<any> {
        if (!this.isConnected()) {
            return Promise.reject(new Error('Runtime agent not connected. Load the agent script in Preview first: inject <script src="http://127.0.0.1:<port>/runtime-agent.js"></script> into your preview page, or paste this in Preview DevTools console: const s=document.createElement("script");s.src="http://127.0.0.1:<port>/runtime-agent.js";document.head.appendChild(s);'));
        }

        const id = ++this.requestId;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`Runtime agent request timed out (${this.requestTimeout / 1000}s)`));
            }, this.requestTimeout);

            this.pending.set(id, { resolve, reject, timer });
            this.agent!.send(JSON.stringify({ type, id, ...payload }));
        });
    }
}

// ---- global singleton accessor ----

let _bridge: RuntimeBridge | null = null;
export function setGlobalRuntimeBridge(b: RuntimeBridge | null): void { _bridge = b; }
export function getGlobalRuntimeBridge(): RuntimeBridge | null { return _bridge; }
