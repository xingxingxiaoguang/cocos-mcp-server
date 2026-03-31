import { ToolConfig, ToolDefinition, ToolExecutor } from '../types';
import { AnimationToolsV2 } from '../tools/v2/animation-tools';
import { ArrayPropertyToolsV2 } from '../tools/v2/array-property-tools';
import { AssetToolsV2 } from '../tools/v2/asset-tools';
import { ComponentToolsV2 } from '../tools/v2/component-tools';
import { DebugToolsV2 } from '../tools/v2/debug-tools';
import { NodeToolsV2 } from '../tools/v2/node-tools';
import { PreferencesToolsV2 } from '../tools/v2/preferences-tools';
import { PrefabToolsV2 } from '../tools/v2/prefab-tools';
import { ProjectToolsV2 } from '../tools/v2/project-tools';
import { SceneScriptToolsV2 } from '../tools/v2/scene-script-tools';
import { SceneToolsV2 } from '../tools/v2/scene-tools';
import { UndoToolsV2 } from '../tools/v2/undo-tools';

export interface ToolRegistration {
    category: string;
    create(): ToolExecutor;
}

export type ToolExecutorMap = Record<string, ToolExecutor>;

export const TOOL_REGISTRY: ToolRegistration[] = [
    { category: 'scene', create: () => new SceneToolsV2() },
    { category: 'node', create: () => new NodeToolsV2() },
    { category: 'component', create: () => new ComponentToolsV2() },
    { category: 'prefab', create: () => new PrefabToolsV2() },
    { category: 'asset', create: () => new AssetToolsV2() },
    { category: 'debug', create: () => new DebugToolsV2() },
    { category: 'project', create: () => new ProjectToolsV2() },
    { category: 'preferences', create: () => new PreferencesToolsV2() },
    { category: 'undo', create: () => new UndoToolsV2() },
    { category: 'sceneScript', create: () => new SceneScriptToolsV2() },
    { category: 'array', create: () => new ArrayPropertyToolsV2() },
    { category: 'animation', create: () => new AnimationToolsV2() },
];

export function createToolKey(category: string, toolName: string): string {
    return `${category}_${toolName}`;
}

export function createToolExecutors(): ToolExecutorMap {
    const executors: ToolExecutorMap = {};

    for (const registration of TOOL_REGISTRY) {
        executors[registration.category] = registration.create();
    }

    return executors;
}

export function createAvailableToolConfigs(executors: ToolExecutorMap = createToolExecutors()): ToolConfig[] {
    const availableTools: ToolConfig[] = [];

    for (const registration of TOOL_REGISTRY) {
        const executor = executors[registration.category];

        if (!executor) {
            continue;
        }

        for (const tool of executor.getTools()) {
            availableTools.push({
                category: registration.category,
                name: tool.name,
                enabled: true,
                description: tool.description,
            });
        }
    }

    return availableTools;
}

export function createToolDefinitions(
    enabledTools?: ToolConfig[],
    executors: ToolExecutorMap = createToolExecutors(),
): ToolDefinition[] {
    const toolDefinitions: ToolDefinition[] = [];
    const enabledToolKeys = enabledTools && enabledTools.length > 0
        ? new Set(enabledTools.map((tool) => createToolKey(tool.category, tool.name)))
        : null;

    for (const registration of TOOL_REGISTRY) {
        const executor = executors[registration.category];

        if (!executor) {
            continue;
        }

        for (const tool of executor.getTools()) {
            const fullToolName = createToolKey(registration.category, tool.name);

            if (enabledToolKeys && !enabledToolKeys.has(fullToolName)) {
                continue;
            }

            toolDefinitions.push({
                name: fullToolName,
                description: tool.description,
                inputSchema: tool.inputSchema,
            });
        }
    }

    return toolDefinitions;
}
