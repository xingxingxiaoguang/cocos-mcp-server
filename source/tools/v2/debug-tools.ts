import { BaseToolExecutor, ToolHandler, ToolDefinition, ToolResponse } from '../base-tool';
import { getCapabilityRegistry } from '../../runtime/capability-registry';
import type { DebugCapability } from '../../capabilities/debug/interface';

export class DebugToolsV2 extends BaseToolExecutor {
    private readonly debug: DebugCapability = getCapabilityRegistry().debug;

    protected readonly handlers: Record<string, ToolHandler> = {
        logs: async (args: any) => this.handleLogs(args),
        execute: async (args: any) => this.handleExecute(args),
        inspect: async (args: any) => this.handleInspect(args),
        trace: async (args: any) => this.handleTrace(args),
    };

    getTools(): ToolDefinition[] {
        return [
            {
                name: 'logs',
                description: 'Query logs. action=query (default): get logs with optional source/level/keyword filters. source=runtime for preview game logs. action=search: search logs with regex. action=clear: clear console.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        action: {
                            type: 'string',
                            enum: ['query', 'search', 'clear'],
                            description: 'Operation type. Default: query'
                        },
                        source: { type: 'string', enum: ['console', 'file', 'runtime', 'all'], description: 'Log source for action=query. runtime=preview game logs via RuntimeBridge. Default: all' },
                        limit: { type: 'number', description: 'Number of logs to retrieve for action=query' },
                        filter: { type: 'string', description: 'Filter keyword for action=query' },
                        level: { type: 'string', enum: ['log', 'warn', 'error', 'info', 'all'], description: 'Log level filter for action=query' },
                        pattern: { type: 'string', description: 'Search pattern (supports regex) for action=search' },
                        maxResults: { type: 'number', description: 'Max search results for action=search' },
                        contextLines: { type: 'number', description: 'Context lines around each match for action=search' }
                    }
                }
            },
            {
                name: 'execute',
                description: 'Execute JavaScript code. target=editor (default): execute in editor scene process. target=runtime: execute in preview browser (requires runtime agent connected). Use require("cc") or window.cc to access engine APIs.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        script: { type: 'string', description: 'JavaScript code to execute' },
                        target: { type: 'string', enum: ['editor', 'runtime'], description: 'Execution context. editor=scene process (default), runtime=preview browser' }
                    },
                    required: ['script']
                }
            },
            {
                name: 'inspect',
                description: 'Inspect editor/scene state. action=env (default): get editor environment info. action=validate: validate scene for issues. action=runtime_summary: get preview runtime snapshot (FPS, drawCalls, nodeCount, memory, physics gravity/PTM ratio, etc.). For node tree use scene_query action=hierarchy.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        action: {
                            type: 'string',
                            enum: ['env', 'validate', 'runtime_summary'],
                            description: 'Inspection type. Default: env'
                        },
                        checkMissingAssets: { type: 'boolean', description: 'Check missing assets for action=validate' },
                        checkPerformance: { type: 'boolean', description: 'Check performance for action=validate' }
                    }
                }
            },
            {
                name: 'trace',
                description: 'Synchronous trigger+sample for runtime debugging. action=sample: pure property sampling on nodes. action=trace: trigger an action (keyboard/method/property/script) and sample before/after to analyze changes. action=collision_wait: synchronously wait for a collision event. action=game_state: get current game state (paused, fps, scene, physics).',
                inputSchema: {
                    type: 'object',
                    properties: {
                        action: {
                            type: 'string',
                            enum: ['sample', 'trace', 'collision_wait', 'game_state'],
                            description: 'Operation type. Default: game_state'
                        },
                        nodeFilter: {
                            type: 'object',
                            description: 'How to select target nodes.',
                            properties: {
                                name: { type: 'string', description: 'Match nodes by name (substring)' },
                                path: { type: 'string', description: 'Match node by path (e.g., "Canvas/Player")' },
                                uuid: { type: 'string', description: 'Match specific node by UUID' }
                            }
                        },
                        properties: {
                            type: 'array',
                            items: { type: 'string' },
                            description: 'Properties to sample: position, localPosition, rotation, localRotation, scale, localScale, active, eulerAngles, childCount. Default: ["position", "rotation", "scale"]'
                        },
                        frames: {
                            type: 'number',
                            description: 'For action=sample. Number of sample frames. Default: 5'
                        },
                        interval: {
                            type: 'number',
                            description: 'For action=sample/trace. Interval in ms between samples. Default: 100'
                        },
                        trigger: {
                            type: 'object',
                            description: 'For action=trace. The action to trigger.',
                            properties: {
                                type: {
                                    type: 'string',
                                    enum: ['keyboard', 'method', 'property', 'script'],
                                    description: 'Trigger type'
                                },
                                key: { type: 'string', description: 'For keyboard: key name (e.g. "ArrowUp", "Space")' },
                                keyCode: { type: 'number', description: 'For keyboard: numeric keyCode' },
                                componentType: { type: 'string', description: 'For method/property: component type (e.g. "cc.RigidBody2D")' },
                                method: { type: 'string', description: 'For method: method name to call' },
                                args: {
                                    type: 'array',
                                    description: 'For method: arguments to pass'
                                },
                                property: { type: 'string', description: 'For property: property name to set' },
                                value: { description: 'For property: value to set' },
                                code: { type: 'string', description: 'For script: JS code to execute' }
                            },
                            required: ['type']
                        },
                        preFrames: {
                            type: 'number',
                            description: 'For action=trace. Frames to sample before trigger. Default: 3'
                        },
                        postFrames: {
                            type: 'number',
                            description: 'For action=trace. Frames to sample after trigger. Default: 10'
                        },
                        collisionEvents: {
                            type: 'array',
                            items: { type: 'string' },
                            description: 'For action=collision_wait. Events to listen for: onCollisionEnter, onCollisionStay, onCollisionExit, onBeginContact, onEndContact. Default: ["onCollisionEnter"]'
                        },
                        timeout: {
                            type: 'number',
                            description: 'For action=collision_wait. Wait timeout in seconds. Default: 5'
                        }
                    },
                    required: ['action']
                }
            }
        ];
    }

    // ==================== logs ====================

    private async handleLogs(args: any): Promise<ToolResponse> {
        const action = args.action || 'query';
        switch (action) {
            case 'query':
                return this.ok(await this.debug.queryLogs(args));
            case 'search':
                return this.ok(await this.debug.searchLogs(args.pattern, args.maxResults, args.contextLines));
            case 'clear':
                await this.debug.clearConsole();
                return this.okMessage('Console cleared successfully');
            default:
                return { success: false, error: `Unknown logs action: ${action}` };
        }
    }

    // ==================== execute ====================

    private async handleExecute(args: any): Promise<ToolResponse> {
        const result = await this.debug.executeScript(args.script, args.target);
        return { success: true, data: { result: result.result }, warning: result.warning };
    }

    // ==================== inspect ====================

    private async handleInspect(args: any): Promise<ToolResponse> {
        const action = args?.action || 'env';
        switch (action) {
            case 'env':
                return this.ok(this.debug.getEditorEnvironment());
            case 'validate':
                return this.ok(await this.debug.validateScene(args));
            case 'runtime_summary':
                return this.ok(await this.debug.getRuntimeSummary());
            default:
                return { success: false, error: `Unknown inspect action: ${action}` };
        }
    }

    // ==================== trace ====================

    private async handleTrace(args: any): Promise<ToolResponse> {
        const action = args.action || 'game_state';
        switch (action) {
            case 'sample':
                if (!args.nodeFilter) return { success: false, error: 'nodeFilter is required for sample action' };
                return this.ok(await this.debug.traceSample(args));
            case 'trace':
                if (!args.nodeFilter) return { success: false, error: 'nodeFilter is required for trace action' };
                if (!args.trigger) return { success: false, error: 'trigger is required for trace action' };
                return this.ok(await this.debug.trace(args));
            case 'collision_wait':
                if (!args.nodeFilter) return { success: false, error: 'nodeFilter is required for collision_wait action' };
                return this.ok(await this.debug.traceCollisionWait(args));
            case 'game_state':
                return this.ok(await this.debug.getGameState());
            default:
                return { success: false, error: `Unknown trace action: ${action}` };
        }
    }
}
