import { ToolDefinition, ToolResponse, ToolExecutor, ComponentInfo } from '../../types';
import { safeSerialize } from '../../utils/serializer';

interface ComponentSetContext {
    nodeUuid: string;
    componentType: string;
    targetComponent: any;
    availableTypes: string[];
    rawNodeData: any;
    rawComponentIndex: number;
    cidMap: Map<string, string>;
    componentAliases: Set<string>;
}

interface PreparedBatchSetContext {
    nodeUuid: string;
    componentsResponse: any;
    rawNodeData: any;
    cidMap: Map<string, string>;
}

export class ComponentToolsV2 implements ToolExecutor {
    getTools(): ToolDefinition[] {
        return [
            {
                name: 'query',
                description: 'Query component information. With uuid: list components on a node. With uuid+componentType: get specific component details. action=available: list all available component types. action=classes: query all registered classes. action=scene_components: query all scene components. action=has_script: check if component has script.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        uuid: {
                            type: 'string',
                            description: 'Node UUID, query components on this node'
                        },
                        componentType: {
                            type: 'string',
                            description: 'Component type name, used with uuid to query specific component details'
                        },
                        action: {
                            type: 'string',
                            enum: ['list', 'info', 'available', 'classes', 'scene_components', 'has_script'],
                            description: 'Query type. With uuid defaults to list. Without uuid, must specify action.'
                        },
                        category: {
                            type: 'string',
                            description: 'Component category filter for action=available',
                            enum: ['all', 'renderer', 'ui', 'physics', 'animation', 'audio'],
                            default: 'all'
                        },
                        extends: {
                            type: 'string',
                            description: 'Filter classes that extend this base class (action=classes)'
                        },
                        scriptPath: {
                            type: 'string',
                            description: 'Script class name for action=has_script'
                        }
                    }
                }
            },
            {
                name: 'add',
                description: 'Add a component to a node. For built-in components use type like "cc.Sprite". For script components use path like "db://assets/scripts/MyScript.ts" or filename like "MyScript.ts".',
                inputSchema: {
                    type: 'object',
                    properties: {
                        uuid: {
                            type: 'string',
                            description: 'Target node UUID'
                        },
                        componentType: {
                            type: 'string',
                            description: 'Component type. Built-in: "cc.Sprite". Script: "db://assets/scripts/MyScript.ts" or "MyScript.ts"'
                        }
                    },
                    required: ['uuid', 'componentType']
                }
            },
            {
                name: 'modify',
                description: 'Modify components on a node. action=set: set property value. action=remove: remove component. action=reset: reset component to defaults. action=execute: execute component method.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        uuid: {
                            type: 'string',
                            description: 'Node UUID'
                        },
                        action: {
                            type: 'string',
                            enum: ['set', 'remove', 'reset', 'execute'],
                            description: 'Operation type'
                        },
                        componentType: {
                            type: 'string',
                            description: 'Component type name (required for set/remove)'
                        },
                        property: {
                            type: 'string',
                            description: 'Property name for action=set'
                        },
                        propertyType: {
                            type: 'string',
                            description: 'Property data type for correct value conversion',
                            enum: [
                                'string', 'number', 'boolean', 'integer', 'float',
                                'color', 'vec2', 'vec3', 'size',
                                'node', 'component', 'cameraComponent', 'spriteFrame', 'prefab', 'asset',
                                'nodeArray', 'colorArray', 'numberArray', 'stringArray'
                            ]
                        },
                        value: {
                            description: 'Property value for action=set. Format depends on propertyType: color={r,g,b,a}, vec2={x,y}, vec3={x,y,z}, size={width,height}, node/asset="uuid-string", component/cameraComponent="component-uuid-or-node-uuid"'
                        },
                        method: {
                            type: 'string',
                            description: 'Method name for action=execute'
                        },
                        args: {
                            type: 'array',
                            description: 'Method arguments for action=execute'
                        }
                    },
                    required: ['uuid', 'action']
                }
            },
            {
                name: 'batch_set',
                description: 'Set multiple properties on one node in a single call. Shared node/component lookup makes it efficient for many property updates.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        uuid: {
                            type: 'string',
                            description: 'Node UUID'
                        },
                        batch: {
                            type: 'array',
                            description: 'Array of component property groups to set',
                            items: {
                                type: 'object',
                                properties: {
                                    componentType: {
                                        type: 'string',
                                        description: 'Target component type'
                                    },
                                    properties: {
                                        type: 'object',
                                        description: 'Property map. Use raw values for common types, or { value, propertyType } for explicit type control.'
                                    }
                                },
                                required: ['componentType', 'properties']
                            }
                        },
                        continueOnError: {
                            type: 'boolean',
                            description: 'Continue processing remaining items after a failure',
                            default: true
                        }
                    },
                    required: ['uuid', 'batch']
                }
            }
        ];
    }

    async execute(toolName: string, args: any): Promise<ToolResponse> {
        switch (toolName) {
            case 'query':
                return await this.handleQuery(args);
            case 'add':
                return await this.handleAdd(args);
            case 'modify':
                return await this.handleModify(args);
            case 'batch_set':
                return await this.batchSetComponentProperties(args);
            default:
                throw new Error(`Unknown tool: ${toolName}`);
        }
    }

    // ============================================================
    // Query handler
    // ============================================================

    private async handleQuery(args: any): Promise<ToolResponse> {
        const { uuid, componentType, action, category, scriptPath } = args;

        // With uuid + componentType → specific component details
        if (uuid && componentType) {
            return await this.getComponentInfo(uuid, componentType);
        }
        // With uuid only → list all components on node
        if (uuid) {
            return await this.getComponents(uuid);
        }
        // Action-based queries
        switch (action) {
            case 'available':
                return await this.getAvailableComponents(category || 'all');
            case 'classes':
                return await this.querySceneClasses(args.extends);
            case 'scene_components':
                return await this.querySceneComponents();
            case 'has_script':
                return await this.queryComponentHasScript(scriptPath || args.className);
            default:
                return { success: false, error: 'Must provide uuid or specify action (available, classes, scene_components, has_script)' };
        }
    }

    // ============================================================
    // Add handler — auto-detects script vs built-in component
    // ============================================================

    private async handleAdd(args: any): Promise<ToolResponse> {
        const { uuid, componentType } = args;

        // Auto-detect: if contains '/' or ends with '.ts'/'.js', treat as script path
        if (componentType.includes('/') || componentType.endsWith('.ts') || componentType.endsWith('.js')) {
            return await this.attachScript(uuid, componentType);
        }
        return await this.addComponent(uuid, componentType);
    }

    // ============================================================
    // Modify handler
    // ============================================================

    private async handleModify(args: any): Promise<ToolResponse> {
        const { uuid, action } = args;

        switch (action) {
            case 'set':
                return await this.setComponentProperty(args);
            case 'remove':
                return await this.removeComponent(uuid, args.componentType);
            case 'reset':
                return await this.resetComponent(uuid);
            case 'execute':
                return await this.executeComponentMethod(uuid, args.method, args.args || []);
            case 'batch_set':
                return await this.batchSetComponentProperties(args);
            default:
                return { success: false, error: `Unknown action: ${action}. Must be one of: set, remove, reset, execute, batch_set` };
        }
    }

    // ============================================================
    // Component query methods (migrated from ComponentTools)
    // ============================================================

    private async buildCidNameMap(): Promise<Map<string, string>> {
        const map = new Map<string, string>();
        const build = (items: any[]) => {
            for (const item of items) {
                if (item && item.cid && item.name) {
                    map.set(item.cid, item.name);
                }
            }
        };

        try {
            const result = await Editor.Message.request('scene', 'query-component-function-of-node', '');
            if (Array.isArray(result)) {
                build(result);
                return map;
            }
        } catch {
            // Ignore and fallback to query-components
        }

        try {
            const result = await Editor.Message.request('scene', 'query-components');
            if (Array.isArray(result)) {
                build(result);
            }
        } catch {
            // Ignore; type map is best-effort only
        }

        return map;
    }

    private normalizeComponentType(rawType: any): string {
        if (rawType && typeof rawType === 'object') {
            const nested = rawType.value || rawType.cid || rawType.type || rawType.name;
            if (nested !== undefined && nested !== null) {
                return String(nested);
            }
        }
        if (rawType === undefined || rawType === null) return 'Unknown';
        return String(rawType);
    }

    private resolveComponentType(rawType: any, cidMap: Map<string, string>): { type: string; cid?: string } {
        const normalizedType = this.normalizeComponentType(rawType);
        const resolvedType = cidMap.get(normalizedType) || normalizedType;
        if (resolvedType !== normalizedType) {
            return { type: resolvedType, cid: normalizedType };
        }
        return { type: resolvedType };
    }

    private isComponentMatch(component: any, componentType: string): boolean {
        const target = this.normalizeComponentType(componentType);
        const type = this.normalizeComponentType(component?.type);
        const cid = component?.cid ? this.normalizeComponentType(component.cid) : '';
        return type === target || cid === target;
    }

    private countMatchingComponents(components: any[], componentType: string): number {
        return components.filter((comp: any) => this.isComponentMatch(comp, componentType)).length;
    }

    private findMatchingComponent(components: any[], componentType: string): any {
        return components.find((comp: any) => this.isComponentMatch(comp, componentType));
    }

    private getComponentAliases(componentType: string, cidMap: Map<string, string>): Set<string> {
        const normalized = this.normalizeComponentType(componentType);
        const aliases = new Set<string>([normalized]);
        const mapped = cidMap.get(normalized);
        if (mapped) {
            aliases.add(this.normalizeComponentType(mapped));
        }

        for (const [cid, name] of cidMap.entries()) {
            if (name === normalized) {
                aliases.add(this.normalizeComponentType(cid));
                break;
            }
        }

        return aliases;
    }

    private async getComponents(nodeUuid: string): Promise<ToolResponse> {
        const cidMap = await this.buildCidNameMap();

        try {
            const nodeData = await Editor.Message.request('scene', 'query-node', nodeUuid);
            if (nodeData && nodeData.__comps__) {
                const components = nodeData.__comps__.map((comp: any) => {
                    const rawType = comp.__type__ || comp.cid || comp.type || 'Unknown';
                    const resolvedType = this.resolveComponentType(rawType, cidMap);
                    return {
                        type: resolvedType.type,
                        cid: resolvedType.cid,
                        uuid: comp.uuid?.value || comp.uuid || comp.value?.uuid?.value || null,
                        enabled: comp.enabled?.value !== undefined ? comp.enabled.value : (comp.enabled !== undefined ? comp.enabled : true),
                        properties: this.extractComponentProperties(comp)
                    };
                });
                return { success: true, data: { nodeUuid, components } };
            }

            return { success: false, error: 'Node not found or no components data' };
        } catch (err: any) {
            const options = {
                name: 'cocos-mcp-server',
                method: 'getNodeInfo',
                args: [nodeUuid]
            };

            try {
                const result = await Editor.Message.request('scene', 'execute-scene-script', options);
                if (!result?.success) {
                    return { success: false, error: result?.error || 'Scene script fallback failed' };
                }

                const rawComponents = Array.isArray(result?.data?.components)
                    ? result.data.components
                    : (Array.isArray(result?.data) ? result.data : []);

                const components = rawComponents.map((comp: any) => {
                    const rawType = comp.__type__ || comp.cid || comp.type || comp.constructor?.name || 'Unknown';
                    const resolvedType = this.resolveComponentType(rawType, cidMap);
                    return {
                        type: resolvedType.type,
                        cid: resolvedType.cid || comp.cid,
                        uuid: comp.uuid?.value || comp.uuid || comp.value?.uuid?.value || null,
                        enabled: comp.enabled?.value !== undefined ? comp.enabled.value : (comp.enabled !== undefined ? comp.enabled : true),
                        properties: comp.properties || this.extractComponentProperties(comp)
                    };
                });

                return { success: true, data: { nodeUuid, components } };
            } catch (err2: any) {
                return { success: false, error: `Direct API failed: ${err.message}, Scene script failed: ${err2.message}` };
            }
        }
    }

    private async getComponentInfo(nodeUuid: string, componentType: string): Promise<ToolResponse> {
        const allComponentsInfo = await this.getComponents(nodeUuid);
        if (!allComponentsInfo.success || !allComponentsInfo.data?.components) {
            return {
                success: false,
                error: allComponentsInfo.error || 'Node not found or no components data'
            };
        }

        const component = this.findMatchingComponent(allComponentsInfo.data.components, componentType);
        if (!component) {
            return { success: false, error: `Component '${componentType}' not found on node` };
        }

        return {
            success: true,
            data: { nodeUuid, componentType: component.type, ...component }
        };
    }

    private async getAvailableComponents(category: string = 'all'): Promise<ToolResponse> {
        const componentCategories: Record<string, string[]> = {
            renderer: ['cc.Sprite', 'cc.Label', 'cc.RichText', 'cc.Mask', 'cc.Graphics'],
            ui: ['cc.Button', 'cc.Toggle', 'cc.Slider', 'cc.ScrollView', 'cc.EditBox', 'cc.ProgressBar'],
            physics: ['cc.RigidBody2D', 'cc.BoxCollider2D', 'cc.CircleCollider2D', 'cc.PolygonCollider2D'],
            animation: ['cc.Animation', 'cc.AnimationClip', 'cc.SkeletalAnimation'],
            audio: ['cc.AudioSource'],
            layout: ['cc.Layout', 'cc.Widget', 'cc.PageView', 'cc.PageViewIndicator'],
            effects: ['cc.MotionStreak', 'cc.ParticleSystem2D'],
            camera: ['cc.Camera'],
            light: ['cc.Light', 'cc.DirectionalLight', 'cc.PointLight', 'cc.SpotLight']
        };

        let components: string[] = [];
        if (category === 'all') {
            for (const cat in componentCategories) {
                components = components.concat(componentCategories[cat]);
            }
        } else if (componentCategories[category]) {
            components = componentCategories[category];
        }

        return { success: true, data: { category, components } };
    }

    // Methods migrated from SceneAdvancedTools
    private async querySceneClasses(extendsClass?: string): Promise<ToolResponse> {
        return new Promise((resolve) => {
            // 委托给场景进程执行（修复缺陷5：主进程无法访问场景进程注册的类）
            Editor.Message.request('scene', 'execute-scene-script', {
                name: 'cocos-mcp-server',
                method: 'getRegisteredClasses',
                args: [extendsClass]
            }).then((result: any) => {
                if (!result || !result.success) {
                    resolve({ success: false, error: result?.error || 'getRegisteredClasses failed' });
                    return;
                }
                resolve({
                    success: true,
                    data: { classes: result.data.classes, count: result.data.count, extendsFilter: extendsClass }
                });
            }).catch((err: Error) => {
                resolve({ success: false, error: err.message });
            });
        });
    }

    private async querySceneComponents(): Promise<ToolResponse> {
        return new Promise((resolve) => {
            Editor.Message.request('scene', 'query-components').then((components: any[]) => {
                resolve({
                    success: true,
                    data: { components, count: components.length }
                });
            }).catch((err: Error) => {
                resolve({ success: false, error: err.message });
            });
        });
    }

    private async queryComponentHasScript(className: string): Promise<ToolResponse> {
        return new Promise((resolve) => {
            // 通过场景进程验证类是否已注册（修复缺陷5）
            Editor.Message.request('scene', 'execute-scene-script', {
                name: 'cocos-mcp-server',
                method: 'getRegisteredClasses',
                args: [undefined]
            }).then((result: any) => {
                if (!result || !result.success) {
                    resolve({ success: false, error: result?.error || 'getRegisteredClasses failed' });
                    return;
                }
                const hasScript = result.data.classes.includes(className);
                resolve({
                    success: true,
                    data: {
                        className,
                        hasScript,
                        message: hasScript ? `Component '${className}' has script` : `Component '${className}' does not have script`
                    }
                });
            }).catch((err: Error) => {
                resolve({ success: false, error: err.message });
            });
        });
    }

    // ============================================================
    // Add component methods (migrated from ComponentTools)
    // ============================================================

    private async addComponent(nodeUuid: string, componentType: string): Promise<ToolResponse> {
        const beforeInfo = await this.getComponents(nodeUuid);
        const beforeComponents = beforeInfo.success && beforeInfo.data?.components ? beforeInfo.data.components : [];
        const beforeCount = beforeComponents.length;

        if (beforeInfo.success && beforeInfo.data?.components) {
            const existingComponent = this.findMatchingComponent(beforeInfo.data.components, componentType);
            if (existingComponent) {
                return {
                    success: true,
                    message: `Component '${componentType}' already exists on node`,
                    data: {
                        nodeUuid,
                        componentType: existingComponent.type,
                        cid: existingComponent.cid,
                        componentVerified: true,
                        existing: true
                    }
                };
            }
        }

        try {
            await Editor.Message.request('scene', 'create-component', {
                uuid: nodeUuid,
                component: componentType
            });
        } catch (err: any) {
            try {
                const fallbackResult = await Editor.Message.request('scene', 'execute-scene-script', {
                    name: 'cocos-mcp-server',
                    method: 'addComponentToNode',
                    args: [nodeUuid, componentType]
                });
                if (!fallbackResult?.success) {
                    return { success: false, error: fallbackResult?.error || err.message };
                }
            } catch (err2: any) {
                return { success: false, error: `Direct API failed: ${err.message}, Scene script failed: ${err2.message}` };
            }
        }

        await new Promise(resolve => setTimeout(resolve, 150));
        const afterInfo = await this.getComponents(nodeUuid);
        if (!afterInfo.success || !afterInfo.data?.components) {
            return { success: false, error: `Failed to verify component addition: ${afterInfo.error || 'Unable to get node components'}` };
        }

        const afterComponents = afterInfo.data.components;
        const afterCount = afterComponents.length;
        const addedComponent = this.findMatchingComponent(afterComponents, componentType);

        if (addedComponent && afterCount >= beforeCount) {
            const response: ToolResponse = {
                success: true,
                message: `Component '${componentType}' added successfully`,
                data: {
                    nodeUuid,
                    componentType: addedComponent.type,
                    cid: addedComponent.cid,
                    componentVerified: true,
                    existing: false
                }
            };

            if (this.normalizeComponentType(addedComponent.type) === 'cc.Sprite') {
                const spriteSetup = await this.ensureDefaultSpriteComponentState(nodeUuid);
                if (spriteSetup.warning) {
                    response.warning = spriteSetup.warning;
                }
            }

            return response;
        }

        if (afterCount > beforeCount) {
            const response: ToolResponse = {
                success: true,
                message: `Component '${componentType}' added successfully`,
                data: {
                    nodeUuid,
                    componentType,
                    componentVerified: true,
                    existing: false
                }
            };

            if (this.normalizeComponentType(componentType) === 'cc.Sprite') {
                const spriteSetup = await this.ensureDefaultSpriteComponentState(nodeUuid);
                if (spriteSetup.warning) {
                    response.warning = spriteSetup.warning;
                }
            }

            return response;
        }

        return {
            success: false,
            error: `Failed to add component '${componentType}'. Component count unchanged. Available components: ${afterComponents.map((c: any) => c.type).join(', ')}`
        };
    }

    private async attachScript(nodeUuid: string, scriptPath: string): Promise<ToolResponse> {
        const scriptName = scriptPath.split('/').pop()?.replace('.ts', '').replace('.js', '');
        if (!scriptName) {
            return { success: false, error: 'Invalid script path' };
        }

        const beforeInfo = await this.getComponents(nodeUuid);
        const beforeComponents = beforeInfo.success && beforeInfo.data?.components ? beforeInfo.data.components : [];
        const beforeCount = beforeComponents.length;

        if (beforeInfo.success && beforeInfo.data?.components) {
            const existingScript = this.findMatchingComponent(beforeInfo.data.components, scriptName);
            if (existingScript) {
                return {
                    success: true,
                    message: `Script '${scriptName}' already exists on node`,
                    data: { nodeUuid, componentName: existingScript.type, cid: existingScript.cid, existing: true }
                };
            }
        }

        try {
            await Editor.Message.request('scene', 'create-component', {
                uuid: nodeUuid,
                component: scriptName
            });
        } catch (err: any) {
            try {
                const fallbackResult = await Editor.Message.request('scene', 'execute-scene-script', {
                    name: 'cocos-mcp-server',
                    method: 'addComponentToNode',
                    args: [nodeUuid, scriptName]
                });
                if (!fallbackResult?.success) {
                    return {
                        success: false,
                        error: fallbackResult?.error || err.message,
                        instruction: 'Please ensure the script is properly compiled and exported as a Component class.'
                    };
                }
            } catch {
                return {
                    success: false,
                    error: `Failed to attach script '${scriptName}': ${err.message}`,
                    instruction: 'Please ensure the script is properly compiled and exported as a Component class.'
                };
            }
        }

        await new Promise(resolve => setTimeout(resolve, 150));
        const afterInfo = await this.getComponents(nodeUuid);
        if (!afterInfo.success || !afterInfo.data?.components) {
            return { success: false, error: `Failed to verify script addition: ${afterInfo.error || 'Unable to get node components'}` };
        }

        const afterComponents = afterInfo.data.components;
        const afterCount = afterComponents.length;
        const addedScript = this.findMatchingComponent(afterComponents, scriptName);
        if (addedScript && afterCount >= beforeCount) {
            return {
                success: true,
                message: `Script '${scriptName}' attached successfully`,
                data: { nodeUuid, componentName: addedScript.type, cid: addedScript.cid, existing: false }
            };
        }

        if (afterCount > beforeCount) {
            return {
                success: true,
                message: `Script '${scriptName}' attached successfully`,
                data: { nodeUuid, componentName: scriptName, existing: false }
            };
        }

        return {
            success: false,
            error: `Script '${scriptName}' was not found on node after addition. Available components: ${afterComponents.map((c: any) => c.type).join(', ')}`
        };
    }

    // ============================================================
    // Modify methods
    // ============================================================

    private async removeComponent(nodeUuid: string, componentType: string): Promise<ToolResponse> {
        const allComponentsInfo = await this.getComponents(nodeUuid);
        if (!allComponentsInfo.success || !allComponentsInfo.data?.components) {
            return { success: false, error: `Failed to get components for node '${nodeUuid}': ${allComponentsInfo.error}` };
        }

        const components = allComponentsInfo.data.components;
        const targetIndex = components.findIndex((comp: any) => this.isComponentMatch(comp, componentType));
        if (targetIndex < 0) {
            const available = components.map((comp: any) => comp.type).join(', ');
            return {
                success: false,
                error: `Component '${componentType}' not found on node '${nodeUuid}'. Available: ${available}`
            };
        }

        const beforeCount = this.countMatchingComponents(components, componentType);

        try {
            await Editor.Message.request('scene', 'remove-array-element', {
                uuid: nodeUuid,
                path: '__comps__',
                index: targetIndex
            });
        } catch (err: any) {
            try {
                const fallbackResult = await Editor.Message.request('scene', 'execute-scene-script', {
                    name: 'cocos-mcp-server',
                    method: 'removeComponentFromNode',
                    args: [nodeUuid, componentType]
                });
                if (!fallbackResult?.success) {
                    return { success: false, error: `Failed to remove component: ${fallbackResult?.error || err.message}` };
                }
            } catch {
                return { success: false, error: `Failed to remove component: ${err.message}` };
            }
        }

        await new Promise(resolve => setTimeout(resolve, 100));
        const afterInfo = await this.getComponents(nodeUuid);
        if (!afterInfo.success || !afterInfo.data?.components) {
            return { success: false, error: `Failed to verify component removal: ${afterInfo.error || 'Unable to get node components'}` };
        }

        const afterCount = this.countMatchingComponents(afterInfo.data.components, componentType);
        if (afterCount >= beforeCount) {
            return { success: false, error: `Component '${componentType}' still exists after removal attempt` };
        }

        return {
            success: true,
            message: `Component '${componentType}' removed successfully`,
            data: { nodeUuid, componentType, removedIndex: targetIndex }
        };
    }

    // Migrated from SceneAdvancedTools
    private async resetComponent(uuid: string): Promise<ToolResponse> {
        return new Promise((resolve) => {
            Editor.Message.request('scene', 'reset-component', { uuid }).then(() => {
                resolve({ success: true, message: 'Component reset to default values' });
            }).catch((err: Error) => {
                resolve({ success: false, error: err.message });
            });
        });
    }

    // Migrated from SceneAdvancedTools
    private async executeComponentMethod(uuid: string, name: string, args: any[] = []): Promise<ToolResponse> {
        return new Promise((resolve) => {
            Editor.Message.request('scene', 'execute-component-method', {
                uuid, name, args
            }).then((result: any) => {
                resolve({
                    success: true,
                    data: { result: safeSerialize(result), message: `Method '${name}' executed successfully` }
                });
            }).catch((err: Error) => {
                resolve({ success: false, error: err.message });
            });
        });
    }

    private async batchSetComponentProperties(args: any): Promise<ToolResponse> {
        const { uuid: nodeUuid, batch, continueOnError = true } = args;

        if (!Array.isArray(batch) || batch.length === 0) {
            return { success: false, error: 'batch must be a non-empty array' };
        }

        const prepared = await this.prepareBatchSetContext(nodeUuid);
        if (!prepared.success || !prepared.data) {
            return prepared;
        }

        const results: any[] = [];
        const failures: any[] = [];
        const contextCache = new Map<string, ComponentSetContext>();

        for (const item of batch) {
            if (!item || typeof item !== 'object') {
                const failure = { success: false, error: 'Invalid batch item', item };
                results.push(failure);
                failures.push(failure);
                if (!continueOnError) break;
                continue;
            }

            const { componentType, properties } = item;
            if (!componentType || !properties || typeof properties !== 'object') {
                const failure = { success: false, error: 'Each batch item must include componentType and properties', item };
                results.push(failure);
                failures.push(failure);
                if (!continueOnError) break;
                continue;
            }

            let context = contextCache.get(componentType);
            if (!context) {
                const contextResult = this.buildComponentSetContextFromPrepared(prepared.data, componentType);
                if (!contextResult.success || !contextResult.data) {
                    results.push(contextResult);
                    failures.push(contextResult);
                    if (!continueOnError) break;
                    continue;
                }
                context = contextResult.data;
                const resolvedContext = context as ComponentSetContext;
                contextCache.set(componentType, resolvedContext);
            }
            const resolvedContext = context as ComponentSetContext;

            for (const [property, rawEntry] of Object.entries(properties)) {
                const normalized = this.normalizeBatchPropertyEntry(rawEntry);
                const setResult = await this.applyComponentPropertyWithContext(resolvedContext, {
                    componentType,
                    property,
                    propertyType: normalized.propertyType,
                    value: normalized.value
                });

                results.push({
                    componentType,
                    property,
                    propertyType: normalized.propertyType || null,
                    success: setResult.success,
                    message: setResult.message,
                    error: setResult.error,
                    data: setResult.data,
                    warning: setResult.warning
                });

                if (!setResult.success) {
                    failures.push(setResult);
                    if (!continueOnError) {
                        break;
                    }
                }
            }

            if (!continueOnError && failures.length > 0) {
                break;
            }
        }

        if (failures.length > 0) {
            return {
                success: false,
                error: `Batch set completed with ${failures.length} failure(s)`,
                data: {
                    nodeUuid,
                    results,
                    failures
                }
            };
        }

        return {
            success: true,
            message: `Batch set completed for ${results.length} property update(s)`,
            data: {
                nodeUuid,
                results
            }
        };
    }

    private async prepareBatchSetContext(nodeUuid: string): Promise<{ success: true; data: PreparedBatchSetContext } | ToolResponse> {
        const componentsResponse = await this.getComponents(nodeUuid);
        if (!componentsResponse.success || !componentsResponse.data) {
            return {
                success: false,
                error: `Failed to get components for node '${nodeUuid}': ${componentsResponse.error}`,
                instruction: `Please verify that node UUID '${nodeUuid}' is correct.`
            };
        }

        let rawNodeData: any;
        try {
            rawNodeData = await Editor.Message.request('scene', 'query-node', nodeUuid);
        } catch (err: any) {
            return {
                success: false,
                error: `Failed to get raw node data for batch set: ${err.message}`
            };
        }

        if (!rawNodeData || !rawNodeData.__comps__) {
            return { success: false, error: 'Failed to get raw node data for batch set' };
        }

        const cidMap = await this.buildCidNameMap();
        return {
            success: true,
            data: {
                nodeUuid,
                componentsResponse,
                rawNodeData,
                cidMap
            }
        };
    }

    private buildComponentSetContextFromPrepared(prepared: PreparedBatchSetContext, componentType: string): { success: true; data: ComponentSetContext } | ToolResponse {
        const allComponents = prepared.componentsResponse.data.components;
        const availableTypes: string[] = [];
        let targetComponent = null;
        for (let i = 0; i < allComponents.length; i++) {
            const comp = allComponents[i];
            availableTypes.push(comp.type);
            if (comp.type === componentType) {
                targetComponent = comp;
                break;
            }
        }

        if (!targetComponent) {
            const instruction = this.generateComponentSuggestion(componentType, availableTypes, '');
            return {
                success: false,
                error: `Component '${componentType}' not found on node. Available components: ${availableTypes.join(', ')}`,
                instruction
            };
        }

        const rawComponentIndex = this.resolveRawComponentIndex(prepared.rawNodeData, componentType, prepared.cidMap);
        if (rawComponentIndex === -1) {
            return { success: false, error: 'Could not find component index for setting property' };
        }

        return {
            success: true,
            data: {
                nodeUuid: prepared.nodeUuid,
                componentType,
                targetComponent,
                availableTypes,
                rawNodeData: prepared.rawNodeData,
                rawComponentIndex,
                cidMap: prepared.cidMap,
                componentAliases: this.getComponentAliases(componentType, prepared.cidMap)
            }
        };
    }

    private resolveRawComponentIndex(rawNodeData: any, componentType: string, cidMap: Map<string, string>): number {
        if (!rawNodeData || !Array.isArray(rawNodeData.__comps__)) {
            return -1;
        }

        const componentAliases = this.getComponentAliases(componentType, cidMap);
        for (let i = 0; i < rawNodeData.__comps__.length; i++) {
            const comp = rawNodeData.__comps__[i] as any;
            const rawType = comp.__type__ || comp.cid || comp.type || 'Unknown';
            const resolved = this.resolveComponentType(rawType, cidMap);
            const rawTypeNormalized = this.normalizeComponentType(rawType);
            if (componentAliases.has(rawTypeNormalized) || componentAliases.has(resolved.type)) {
                return i;
            }
        }

        return -1;
    }

    // ============================================================
    // set_component_property — full migration with complex type conversion
    // ============================================================

    private async setComponentProperty(args: any): Promise<ToolResponse> {
        const { uuid: nodeUuid, componentType } = args;
        const contextResult = args._context
            ? { success: true, data: args._context }
            : await this.prepareComponentSetContext(nodeUuid, componentType);

        if (!contextResult.success || !contextResult.data) {
            return contextResult;
        }

        return await this.applyComponentPropertyWithContext(contextResult.data, args);
    }

    private async prepareComponentSetContext(nodeUuid: string, componentType: string): Promise<{ success: true; data: ComponentSetContext } | ToolResponse> {
        const componentsResponse = await this.getComponents(nodeUuid);
        if (!componentsResponse.success || !componentsResponse.data) {
            return {
                success: false,
                error: `Failed to get components for node '${nodeUuid}': ${componentsResponse.error}`,
                instruction: `Please verify that node UUID '${nodeUuid}' is correct.`
            };
        }

        const allComponents = componentsResponse.data.components;
        const availableTypes: string[] = [];
        let targetComponent = null;
        for (let i = 0; i < allComponents.length; i++) {
            const comp = allComponents[i];
            availableTypes.push(comp.type);
            if (comp.type === componentType) {
                targetComponent = comp;
                break;
            }
        }

        if (!targetComponent) {
            const instruction = this.generateComponentSuggestion(componentType, availableTypes, '');
            return {
                success: false,
                error: `Component '${componentType}' not found on node. Available components: ${availableTypes.join(', ')}`,
                instruction
            };
        }

        let rawNodeData: any;
        try {
            rawNodeData = await Editor.Message.request('scene', 'query-node', nodeUuid);
        } catch (err: any) {
            return { success: false, error: `Failed to get raw node data for property setting: ${err.message}` };
        }

        if (!rawNodeData || !rawNodeData.__comps__) {
            return { success: false, error: 'Failed to get raw node data for property setting' };
        }

        const cidMap = await this.buildCidNameMap();
        const rawComponentIndex = this.resolveRawComponentIndex(rawNodeData, componentType, cidMap);
        if (rawComponentIndex === -1) {
            return { success: false, error: 'Could not find component index for setting property' };
        }

        return {
            success: true,
            data: {
                nodeUuid,
                componentType,
                targetComponent,
                availableTypes,
                rawNodeData,
                rawComponentIndex,
                cidMap,
                componentAliases: this.getComponentAliases(componentType, cidMap)
            }
        };
    }

    private async applyComponentPropertyWithContext(context: ComponentSetContext, args: any): Promise<ToolResponse> {
        const { nodeUuid, componentType, targetComponent, rawComponentIndex, cidMap } = context;
        const { property, propertyType, value } = args;

        return new Promise(async (resolve) => {
            try {
                console.log(`[ComponentToolsV2] Setting ${componentType}.${property} (type: ${propertyType}) = ${JSON.stringify(value)} on node ${nodeUuid}`);

                const nodeRedirectResult = await this.checkAndRedirectNodeProperties({
                    uuid: nodeUuid,
                    componentType,
                    property,
                    value
                });
                if (nodeRedirectResult) {
                    resolve(nodeRedirectResult);
                    return;
                }

                let propertyInfo;
                try {
                    propertyInfo = this.analyzeProperty(targetComponent, property);
                } catch (analyzeError: any) {
                    resolve({ success: false, error: `Failed to analyze property '${property}': ${analyzeError.message}` });
                    return;
                }

                if (!propertyInfo.exists) {
                    resolve({
                        success: false,
                        error: `Property '${property}' not found on component '${componentType}'. Available properties: ${propertyInfo.availableProperties.join(', ')}`
                    });
                    return;
                }

                const originalValue = propertyInfo.originalValue;
                const effectivePropertyType = this.normalizePropertyType(propertyType, propertyInfo.type, property, value);
                let processedValue: any;

                switch (effectivePropertyType) {
                    case 'string':
                        processedValue = String(value);
                        break;
                    case 'number':
                    case 'integer':
                    case 'float':
                        processedValue = Number(value);
                        break;
                    case 'boolean':
                        processedValue = Boolean(value);
                        break;
                    case 'color':
                        if (typeof value === 'string') {
                            processedValue = this.parseColorString(value);
                        } else if (typeof value === 'object' && value !== null) {
                            processedValue = {
                                r: Math.min(255, Math.max(0, Number(value.r) || 0)),
                                g: Math.min(255, Math.max(0, Number(value.g) || 0)),
                                b: Math.min(255, Math.max(0, Number(value.b) || 0)),
                                a: value.a !== undefined ? Math.min(255, Math.max(0, Number(value.a))) : 255
                            };
                        } else {
                            throw new Error('Color value must be an object with r, g, b properties or a hexadecimal string (e.g., "#FF0000")');
                        }
                        break;
                    case 'vec2':
                        if (typeof value === 'object' && value !== null) {
                            processedValue = { x: Number(value.x) || 0, y: Number(value.y) || 0 };
                        } else {
                            throw new Error('Vec2 value must be an object with x, y properties');
                        }
                        break;
                    case 'vec3':
                        if (typeof value === 'object' && value !== null) {
                            processedValue = { x: Number(value.x) || 0, y: Number(value.y) || 0, z: Number(value.z) || 0 };
                        } else {
                            throw new Error('Vec3 value must be an object with x, y, z properties');
                        }
                        break;
                    case 'size':
                        if (typeof value === 'object' && value !== null) {
                            processedValue = { width: Number(value.width) || 0, height: Number(value.height) || 0 };
                        } else {
                            throw new Error('Size value must be an object with width, height properties');
                        }
                        break;
                    case 'node':
                        if (typeof value === 'string') {
                            processedValue = { uuid: value };
                        } else {
                            throw new Error('Node reference value must be a string UUID');
                        }
                        break;
                    case 'component':
                    case 'cameraComponent':
                        if (typeof value === 'string') {
                            processedValue = value;
                        } else {
                            throw new Error('Component reference value must be a string UUID');
                        }
                        break;
                    case 'spriteFrame':
                    case 'prefab':
                    case 'asset':
                        if (typeof value === 'string') {
                            processedValue = { uuid: value };
                        } else {
                            throw new Error(`${effectivePropertyType} value must be a string UUID`);
                        }
                        break;
                    case 'nodeArray':
                        if (Array.isArray(value)) {
                            processedValue = value.map((item: any) => {
                                if (typeof item === 'string') return { uuid: item };
                                throw new Error('NodeArray items must be string UUIDs');
                            });
                        } else {
                            throw new Error('NodeArray value must be an array');
                        }
                        break;
                    case 'colorArray':
                        if (Array.isArray(value)) {
                            processedValue = value.map((item: any) => {
                                if (typeof item === 'object' && item !== null && 'r' in item) {
                                    return {
                                        r: Math.min(255, Math.max(0, Number(item.r) || 0)),
                                        g: Math.min(255, Math.max(0, Number(item.g) || 0)),
                                        b: Math.min(255, Math.max(0, Number(item.b) || 0)),
                                        a: item.a !== undefined ? Math.min(255, Math.max(0, Number(item.a))) : 255
                                    };
                                }
                                return { r: 255, g: 255, b: 255, a: 255 };
                            });
                        } else {
                            throw new Error('ColorArray value must be an array');
                        }
                        break;
                    case 'numberArray':
                        if (Array.isArray(value)) {
                            processedValue = value.map((item: any) => Number(item));
                        } else {
                            throw new Error('NumberArray value must be an array');
                        }
                        break;
                    case 'stringArray':
                        if (Array.isArray(value)) {
                            processedValue = value.map((item: any) => String(item));
                        } else {
                            throw new Error('StringArray value must be an array');
                        }
                        break;
                    default:
                        throw new Error(`Unsupported property type: ${effectivePropertyType}`);
                }

                let actualExpectedValue = processedValue;
                let propertyPath = `__comps__.${rawComponentIndex}.${property}`;

                if (effectivePropertyType === 'asset' || effectivePropertyType === 'spriteFrame' || effectivePropertyType === 'prefab' ||
                    (propertyInfo.type === 'asset' && effectivePropertyType === 'string')) {
                    let assetType = 'cc.SpriteFrame';
                    if (property.toLowerCase().includes('texture')) assetType = 'cc.Texture2D';
                    else if (property.toLowerCase().includes('material')) assetType = 'cc.Material';
                    else if (property.toLowerCase().includes('font')) assetType = 'cc.Font';
                    else if (property.toLowerCase().includes('clip')) assetType = 'cc.AudioClip';
                    else if (effectivePropertyType === 'prefab') assetType = 'cc.Prefab';

                    await Editor.Message.request('scene', 'set-property', {
                        uuid: nodeUuid, path: propertyPath,
                        dump: { value: processedValue, type: assetType }
                    });
                } else if (componentType === 'cc.UITransform' && (property === '_contentSize' || property === 'contentSize')) {
                    const width = Number(value.width) || 100;
                    const height = Number(value.height) || 100;
                    await Editor.Message.request('scene', 'set-property', {
                        uuid: nodeUuid, path: `__comps__.${rawComponentIndex}.width`, dump: { value: width }
                    });
                    await Editor.Message.request('scene', 'set-property', {
                        uuid: nodeUuid, path: `__comps__.${rawComponentIndex}.height`, dump: { value: height }
                    });
                } else if (componentType === 'cc.UITransform' && (property === '_anchorPoint' || property === 'anchorPoint')) {
                    const anchorX = Number(value.x) || 0.5;
                    const anchorY = Number(value.y) || 0.5;
                    await Editor.Message.request('scene', 'set-property', {
                        uuid: nodeUuid, path: `__comps__.${rawComponentIndex}.anchorX`, dump: { value: anchorX }
                    });
                    await Editor.Message.request('scene', 'set-property', {
                        uuid: nodeUuid, path: `__comps__.${rawComponentIndex}.anchorY`, dump: { value: anchorY }
                    });
                } else if (effectivePropertyType === 'color' && processedValue && typeof processedValue === 'object') {
                    const colorValue = {
                        r: Math.min(255, Math.max(0, Number(processedValue.r) || 0)),
                        g: Math.min(255, Math.max(0, Number(processedValue.g) || 0)),
                        b: Math.min(255, Math.max(0, Number(processedValue.b) || 0)),
                        a: processedValue.a !== undefined ? Math.min(255, Math.max(0, Number(processedValue.a))) : 255
                    };
                    await Editor.Message.request('scene', 'set-property', {
                        uuid: nodeUuid, path: propertyPath, dump: { value: colorValue, type: 'cc.Color' }
                    });
                } else if (effectivePropertyType === 'vec3' && processedValue && typeof processedValue === 'object') {
                    await Editor.Message.request('scene', 'set-property', {
                        uuid: nodeUuid, path: propertyPath,
                        dump: { value: { x: Number(processedValue.x) || 0, y: Number(processedValue.y) || 0, z: Number(processedValue.z) || 0 }, type: 'cc.Vec3' }
                    });
                } else if (effectivePropertyType === 'vec2' && processedValue && typeof processedValue === 'object') {
                    await Editor.Message.request('scene', 'set-property', {
                        uuid: nodeUuid, path: propertyPath,
                        dump: { value: { x: Number(processedValue.x) || 0, y: Number(processedValue.y) || 0 }, type: 'cc.Vec2' }
                    });
                } else if (effectivePropertyType === 'size' && processedValue && typeof processedValue === 'object') {
                    await Editor.Message.request('scene', 'set-property', {
                        uuid: nodeUuid, path: propertyPath,
                        dump: { value: { width: Number(processedValue.width) || 0, height: Number(processedValue.height) || 0 }, type: 'cc.Size' }
                    });
                } else if (effectivePropertyType === 'node' && processedValue && typeof processedValue === 'object' && 'uuid' in processedValue) {
                    await Editor.Message.request('scene', 'set-property', {
                        uuid: nodeUuid, path: propertyPath, dump: { value: processedValue, type: 'cc.Node' }
                    });
                } else if ((effectivePropertyType === 'component' || effectivePropertyType === 'cameraComponent') && typeof processedValue === 'string') {
                    let expectedComponentType = effectivePropertyType === 'cameraComponent' ? 'cc.Camera' : '';
                    const propertyMeta = this.getPropertyMetadata(targetComponent, property);
                    expectedComponentType = this.inferExpectedComponentType(componentType, property, propertyMeta, expectedComponentType);

                    if (!expectedComponentType) {
                        throw new Error(`Unable to determine required component type for property '${property}' on component '${componentType}'.`);
                    }

                    const reference = await this.resolveComponentReference(processedValue, expectedComponentType, cidMap);
                    if (!reference) {
                        throw new Error(`Unable to resolve component reference '${processedValue}' for property '${property}'.`);
                    }

                    actualExpectedValue = { uuid: reference.componentUuid };
                    await Editor.Message.request('scene', 'set-property', {
                        uuid: nodeUuid, path: propertyPath,
                        dump: { value: { uuid: reference.componentUuid }, type: expectedComponentType }
                    });
                } else if (effectivePropertyType === 'nodeArray' && Array.isArray(processedValue)) {
                    await Editor.Message.request('scene', 'set-property', {
                        uuid: nodeUuid, path: propertyPath, dump: { value: processedValue }
                    });
                } else if (effectivePropertyType === 'colorArray' && Array.isArray(processedValue)) {
                    const colorArrayValue = processedValue.map((item: any) => {
                        if (item && typeof item === 'object' && 'r' in item) {
                            return {
                                r: Math.min(255, Math.max(0, Number(item.r) || 0)),
                                g: Math.min(255, Math.max(0, Number(item.g) || 0)),
                                b: Math.min(255, Math.max(0, Number(item.b) || 0)),
                                a: item.a !== undefined ? Math.min(255, Math.max(0, Number(item.a))) : 255
                            };
                        }
                        return { r: 255, g: 255, b: 255, a: 255 };
                    });
                    await Editor.Message.request('scene', 'set-property', {
                        uuid: nodeUuid, path: propertyPath, dump: { value: colorArrayValue, type: 'cc.Color' }
                    });
                } else {
                    await Editor.Message.request('scene', 'set-property', {
                        uuid: nodeUuid, path: propertyPath, dump: { value: processedValue }
                    });
                }

                await new Promise(resolve => setTimeout(resolve, 200));
                const verification = await this.verifyPropertyChange(nodeUuid, componentType, property, originalValue, actualExpectedValue);

                resolve({
                    success: true,
                    message: `Successfully set ${componentType}.${property}`,
                    data: {
                        nodeUuid, componentType, property,
                        actualValue: verification.actualValue,
                        changeVerified: verification.verified
                    }
                });

            } catch (error: any) {
                console.error(`[ComponentToolsV2] Error setting property:`, error);
                resolve({ success: false, error: `Failed to set property: ${error.message}` });
            }
        });
    }

    private async ensureDefaultSpriteComponentState(nodeUuid: string): Promise<{ warning?: string }> {
        const warnings: string[] = [];
        const defaultSpriteFrameUuid = await this.resolveDefaultSpriteFrameUuid();

        if (defaultSpriteFrameUuid) {
            const spriteFrameResult = await this.setComponentProperty({
                uuid: nodeUuid,
                componentType: 'cc.Sprite',
                action: 'set',
                property: 'spriteFrame',
                propertyType: 'spriteFrame',
                value: defaultSpriteFrameUuid
            });

            if (!spriteFrameResult.success) {
                warnings.push(`Failed to assign default SpriteFrame: ${spriteFrameResult.error}`);
            }
        } else {
            warnings.push('Default SpriteFrame asset was not found; Sprite may remain unassigned');
        }

        const sizeModeResult = await this.setComponentProperty({
            uuid: nodeUuid,
            componentType: 'cc.Sprite',
            action: 'set',
            property: 'sizeMode',
            propertyType: 'integer',
            value: 0
        });

        if (!sizeModeResult.success) {
            warnings.push(`Failed to set Sprite sizeMode to CUSTOM: ${sizeModeResult.error}`);
        }

        return warnings.length > 0 ? { warning: warnings.join('; ') } : {};
    }

    private async resolveDefaultSpriteFrameUuid(): Promise<string | null> {
        const candidates = [
            'db://internal/default_ui/default_sprite.png',
            'db://internal/default_ui/default_sprite/default_sprite.spriteframe',
            'db://internal/default_ui/default_sprite',
            'db://internal/default_ui/default_sprite.spriteframe',
            'db://internal/default_ui/default_sprite/default_sprite'
        ];

        for (const candidate of candidates) {
            try {
                const assetInfo: any = await Editor.Message.request('asset-db', 'query-asset-info', candidate);
                if (assetInfo && assetInfo.uuid) {
                    const resolvedUuid = await this.resolveSpriteFrameUuidFromAssetInfo(assetInfo);
                    if (resolvedUuid) {
                        return resolvedUuid;
                    }
                }
            } catch {
                // Try the next candidate.
            }
        }

        const searchPatterns = [
            'db://internal/**/default_sprite*',
            'db://internal/**/*default_sprite*.spriteframe',
            'db://internal/default_ui/**/*spriteframe'
        ];

        for (const pattern of searchPatterns) {
            try {
                const assets: any = await Editor.Message.request('asset-db', 'query-assets', { pattern });
                if (!Array.isArray(assets)) {
                    continue;
                }

                const matched = assets.find((asset: any) => {
                    const url = String(asset?.url || asset?.path || asset?.name || '').toLowerCase();
                    const type = String(asset?.type || '').toLowerCase();
                    return type === 'cc.spriteframe' && url.includes('default_sprite');
                }) || assets.find((asset: any) => {
                    const url = String(asset?.url || asset?.path || asset?.name || '').toLowerCase();
                    return url.includes('default_sprite');
                });

                if (matched?.uuid) {
                    return String(matched.uuid);
                }
            } catch {
                // Try the next pattern.
            }
        }

        return null;
    }

    private getPropertyMetadata(component: any, propertyName: string): any | null {
        if (!component || typeof component !== 'object') {
            return null;
        }

        if (component.properties && typeof component.properties === 'object') {
            if (component.properties.value && typeof component.properties.value === 'object' && component.properties.value[propertyName]) {
                return component.properties.value[propertyName];
            }
            if (component.properties[propertyName]) {
                return component.properties[propertyName];
            }
        }

        if (Object.prototype.hasOwnProperty.call(component, propertyName)) {
            return component[propertyName];
        }

        return null;
    }

    private inferExpectedComponentType(componentType: string, property: string, propertyMeta: any, fallbackType: string): string {
        let expectedComponentType = fallbackType;
        if (propertyMeta && typeof propertyMeta === 'object') {
            if (propertyMeta.type) {
                expectedComponentType = propertyMeta.type;
            } else if (propertyMeta.ctor) {
                expectedComponentType = propertyMeta.ctor;
            } else if (propertyMeta.extends && Array.isArray(propertyMeta.extends)) {
                for (const extendType of propertyMeta.extends) {
                    if (extendType.startsWith('cc.') && extendType !== 'cc.Component' && extendType !== 'cc.Object') {
                        expectedComponentType = extendType;
                        break;
                    }
                }
            }
        }

        if (!expectedComponentType && property.toLowerCase().includes('component')) {
            expectedComponentType = 'cc.Component';
        }

        if (!expectedComponentType && componentType === 'cc.Camera') {
            expectedComponentType = 'cc.Camera';
        }

        return expectedComponentType;
    }

    private async resolveSpriteFrameUuidFromAssetInfo(assetInfo: any): Promise<string | null> {
        const assetUuid = String(assetInfo?.uuid || '').trim();
        if (!assetUuid) {
            return null;
        }

        const assetType = String(assetInfo?.type || '').toLowerCase();
        if (assetType === 'cc.spriteframe') {
            return assetUuid;
        }

        const subAssets = Array.isArray(assetInfo?.subAssets)
            ? assetInfo.subAssets
            : (assetInfo?.subAssets && Array.isArray(assetInfo.subAssets.value) ? assetInfo.subAssets.value : []);
        if (Array.isArray(subAssets)) {
            const spriteFrameSubAsset = subAssets.find((subAsset: any) => {
                const subType = String(subAsset?.type || '').toLowerCase();
                return subType === 'cc.spriteframe' || subType === 'spriteframe';
            });
            if (spriteFrameSubAsset?.uuid) {
                return String(spriteFrameSubAsset.uuid);
            }
        }

        const spriteFrameUuid = `${assetUuid}@f9941`;
        try {
            const spriteFrameUrl = await Editor.Message.request('asset-db', 'query-url', spriteFrameUuid);
            if (spriteFrameUrl) {
                return spriteFrameUuid;
            }
        } catch {
            // fall back below
        }

        return null;
    }

    private normalizeBatchPropertyEntry(entry: any): { value: any; propertyType?: string } {
        if (entry && typeof entry === 'object' && !Array.isArray(entry) && Object.prototype.hasOwnProperty.call(entry, 'propertyType')) {
            return {
                value: Object.prototype.hasOwnProperty.call(entry, 'value') ? entry.value : entry,
                propertyType: String(entry.propertyType || '')
            };
        }

        return { value: entry };
    }

    private normalizePropertyType(propertyType: string | undefined, inferredType: string, property: string, value: any): string {
        if (propertyType) {
            return propertyType === 'cameraComponent' ? 'cameraComponent' : propertyType;
        }

        if (inferredType === 'asset' && typeof value === 'string' && property.toLowerCase().includes('component')) {
            return 'component';
        }

        if (property.toLowerCase().includes('cameracomponent')) {
            return 'cameraComponent';
        }

        if (inferredType === 'unknown' && property.toLowerCase().includes('component')) {
            return 'component';
        }

        return inferredType;
    }

    private getComponentUuid(component: any): string | null {
        return component?.uuid?.value || component?.uuid || component?.value?.uuid?.value || component?.value?.uuid || null;
    }

    private async collectSceneNodeUuids(): Promise<string[]> {
        try {
            const tree = await Editor.Message.request('scene', 'query-node-tree');
            const nodeUuids = new Set<string>();

            const traverse = (node: any) => {
                if (!node) {
                    return;
                }

                const uuid = node.uuid?.value || node.uuid || node.value?.uuid?.value || node.value?.uuid;
                if (uuid) {
                    nodeUuids.add(String(uuid));
                }

                if (Array.isArray(node.children)) {
                    for (const child of node.children) {
                        traverse(child);
                    }
                }
            };

            if (Array.isArray(tree)) {
                for (const root of tree) {
                    traverse(root);
                }
            } else {
                traverse(tree);
            }

            return Array.from(nodeUuids);
        } catch {
            return [];
        }
    }

    private async resolveComponentReference(referenceUuid: string, expectedComponentType: string, cidMap: Map<string, string>): Promise<{ componentUuid: string; sourceNodeUuid: string; componentType: string } | null> {
        const expectedAliases = this.getComponentAliases(expectedComponentType, cidMap);
        const isGenericComponentReference = this.isGenericComponentType(expectedComponentType);

        const matchesExpected = (component: any): boolean => {
            if (isGenericComponentReference) {
                return true;
            }

            const rawType = component.__type__ || component.cid || component.type || 'Unknown';
            const resolved = this.resolveComponentType(rawType, cidMap);
            const rawTypeNormalized = this.normalizeComponentType(rawType);
            return expectedAliases.has(rawTypeNormalized) || expectedAliases.has(resolved.type);
        };

        const directComponentMatch = await this.findComponentByUuid(referenceUuid, expectedComponentType, cidMap, matchesExpected);
        if (directComponentMatch) {
            return directComponentMatch;
        }

        try {
            const targetNodeData = await Editor.Message.request('scene', 'query-node', referenceUuid);
            if (targetNodeData && targetNodeData.__comps__) {
                for (const comp of targetNodeData.__comps__) {
                    if (!matchesExpected(comp)) {
                        continue;
                    }
                    const componentUuid = this.getComponentUuid(comp);
                    if (componentUuid) {
                        const rawType = (comp as any).__type__ || (comp as any).cid || (comp as any).type || 'Unknown';
                        const resolved = this.resolveComponentType(rawType, cidMap);
                        return {
                            componentUuid,
                            sourceNodeUuid: referenceUuid,
                            componentType: resolved.type
                        };
                    }
                }
            }
        } catch {
            // Fall through to scene scan.
        }

        const nodeUuids = await this.collectSceneNodeUuids();
        for (const nodeUuid of nodeUuids) {
            try {
                const nodeData = await Editor.Message.request('scene', 'query-node', nodeUuid);
                if (!nodeData || !nodeData.__comps__) {
                    continue;
                }

                for (const comp of nodeData.__comps__) {
                    const componentUuid = this.getComponentUuid(comp);
                    if (!componentUuid || componentUuid !== referenceUuid) {
                        continue;
                    }
                    if (!matchesExpected(comp)) {
                        return null;
                    }

                    const rawType = (comp as any).__type__ || (comp as any).cid || (comp as any).type || 'Unknown';
                    const resolved = this.resolveComponentType(rawType, cidMap);
                    return {
                        componentUuid,
                        sourceNodeUuid: nodeUuid,
                        componentType: resolved.type
                    };
                }
            } catch {
                // Continue scanning remaining nodes.
            }
        }

        return null;
    }

    private isGenericComponentType(componentType: string): boolean {
        const normalized = this.normalizeComponentType(componentType).toLowerCase();
        return normalized === 'cc.component' || normalized === 'component' || normalized === 'cc.object';
    }

    private async findComponentByUuid(
        componentUuid: string,
        expectedComponentType: string,
        cidMap: Map<string, string>,
        matchesExpected: (component: any) => boolean
    ): Promise<{ componentUuid: string; sourceNodeUuid: string; componentType: string } | null> {
        const nodeUuids = await this.collectSceneNodeUuids();
        for (const nodeUuid of nodeUuids) {
            try {
                const nodeData = await Editor.Message.request('scene', 'query-node', nodeUuid);
                if (!nodeData || !nodeData.__comps__) {
                    continue;
                }

                for (const comp of nodeData.__comps__) {
                    const currentComponentUuid = this.getComponentUuid(comp);
                    if (!currentComponentUuid || currentComponentUuid !== componentUuid) {
                        continue;
                    }

                    if (!matchesExpected(comp)) {
                        return null;
                    }

                    const rawType = (comp as any).__type__ || (comp as any).cid || (comp as any).type || 'Unknown';
                    const resolved = this.resolveComponentType(rawType, cidMap);
                    return {
                        componentUuid: currentComponentUuid,
                        sourceNodeUuid: nodeUuid,
                        componentType: resolved.type
                    };
                }
            } catch {
                // Continue scanning remaining nodes.
            }
        }

        return null;
    }

    // ============================================================
    // Helper methods (migrated from ComponentTools)
    // ============================================================

    private extractComponentProperties(component: any): Record<string, any> {
        const properties: Record<string, any> = {};
        const source = this.getComponentPropertySource(component);
        if (!source) {
            return properties;
        }

        for (const [key, propData] of Object.entries(source)) {
            if (key.startsWith('_') || this.shouldSkipComponentProperty(key)) {
                continue;
            }

            if (!this.isVisibleComponentPropertyDescriptor(propData)) {
                continue;
            }

            const descriptor = propData as any;
            const simplified: any = {};

            if (descriptor.value !== undefined) {
                simplified.value = safeSerialize(descriptor.value);
            }

            const resolvedType = descriptor.type !== undefined ? descriptor.type : descriptor.ctor;
            if (resolvedType !== undefined) {
                simplified.type = safeSerialize(resolvedType);
            }
            if (descriptor.ctor !== undefined) {
                simplified.ctor = safeSerialize(descriptor.ctor);
            }
            if (descriptor.readonly) {
                simplified.readonly = true;
            }
            if (descriptor.enumList !== undefined) {
                simplified.enumList = safeSerialize(descriptor.enumList);
            }
            if (descriptor.min !== undefined) {
                simplified.min = descriptor.min;
            }
            if (descriptor.max !== undefined) {
                simplified.max = descriptor.max;
            }
            if (descriptor.step !== undefined) {
                simplified.step = descriptor.step;
            }
            if (descriptor.extends !== undefined) {
                simplified.extends = safeSerialize(descriptor.extends);
            }

            if (Object.keys(simplified).length > 0) {
                properties[key] = simplified;
            }
        }
        return properties;
    }

    private getComponentPropertySource(component: any): Record<string, any> | null {
        if (!component || typeof component !== 'object') {
            return null;
        }

        if (component.value && typeof component.value === 'object' && !Array.isArray(component.value)) {
            return component.value;
        }

        if (component.properties && typeof component.properties === 'object') {
            if (component.properties.value && typeof component.properties.value === 'object' && !Array.isArray(component.properties.value)) {
                return component.properties.value;
            }
            return component.properties;
        }

        return component;
    }

    private shouldSkipComponentProperty(key: string): boolean {
        return ['__type__', '__prefab', '__scriptAsset', 'enabled', 'node', '_id', 'uuid', 'name', '_name', '_objFlags', '_enabled', 'type', 'readonly', 'visible', 'cid', 'editor', 'extends'].includes(key);
    }

    private isVisibleComponentPropertyDescriptor(propData: any): boolean {
        if (typeof propData !== 'object' || propData === null) return false;
        const descriptor = propData as any;
        if (descriptor.visible === false) return false;
        return 'value' in descriptor || 'type' in descriptor || 'ctor' in descriptor || 'readonly' in descriptor;
    }

    private isValidPropertyDescriptor(propData: any): boolean {
        if (typeof propData !== 'object' || propData === null) return false;
        try {
            const keys = Object.keys(propData);
            const isSimpleValueObject = keys.every(key => {
                const value = propData[key];
                return typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean';
            });
            if (isSimpleValueObject) return false;
            const hasName = keys.includes('name');
            const hasValue = keys.includes('value');
            const hasType = keys.includes('type');
            const hasDisplayName = keys.includes('displayName');
            const hasReadonly = keys.includes('readonly');
            const hasValidStructure = (hasName || hasValue) && (hasType || hasDisplayName || hasReadonly);
            if (keys.includes('default') && propData.default && typeof propData.default === 'object') {
                const defaultKeys = Object.keys(propData.default);
                if (defaultKeys.includes('value') && typeof propData.default.value === 'object') {
                    return hasValidStructure;
                }
            }
            return hasValidStructure;
        } catch {
            return false;
        }
    }

    private analyzeProperty(component: any, propertyName: string): { exists: boolean; type: string; availableProperties: string[]; originalValue: any } {
        const availableProperties: string[] = [];
        let propertyValue: any = undefined;
        let propertyExists = false;

        if (Object.prototype.hasOwnProperty.call(component, propertyName)) {
            propertyValue = component[propertyName];
            propertyExists = true;
        }

        if (!propertyExists && component.properties && typeof component.properties === 'object') {
            if (component.properties.value && typeof component.properties.value === 'object') {
                const valueObj = component.properties.value;
                for (const [key, propData] of Object.entries(valueObj)) {
                    if (this.isValidPropertyDescriptor(propData)) {
                        const propInfo = propData as any;
                        availableProperties.push(key);
                        if (key === propertyName) {
                            try {
                                const propKeys = Object.keys(propInfo);
                                propertyValue = propKeys.includes('value') ? propInfo.value : propInfo;
                            } catch {
                                propertyValue = propInfo;
                            }
                            propertyExists = true;
                        }
                    }
                }
            } else {
                for (const [key, propData] of Object.entries(component.properties)) {
                    if (this.isValidPropertyDescriptor(propData)) {
                        const propInfo = propData as any;
                        availableProperties.push(key);
                        if (key === propertyName) {
                            try {
                                const propKeys = Object.keys(propInfo);
                                propertyValue = propKeys.includes('value') ? propInfo.value : propInfo;
                            } catch {
                                propertyValue = propInfo;
                            }
                            propertyExists = true;
                        }
                    }
                }
            }
        }

        if (availableProperties.length === 0) {
            for (const key of Object.keys(component)) {
                if (!key.startsWith('_') && !['__type__', 'cid', 'node', 'uuid', 'name', 'enabled', 'type', 'readonly', 'visible'].includes(key)) {
                    availableProperties.push(key);
                }
            }
        }

        if (!propertyExists) {
            return { exists: false, type: 'unknown', availableProperties, originalValue: undefined };
        }

        let type = 'unknown';
        if (Array.isArray(propertyValue)) {
            if (propertyName.toLowerCase().includes('node')) type = 'nodeArray';
            else if (propertyName.toLowerCase().includes('color')) type = 'colorArray';
            else type = 'array';
        } else if (typeof propertyValue === 'string') {
            if (['spriteFrame', 'texture', 'material', 'font', 'clip', 'prefab'].includes(propertyName.toLowerCase())) type = 'asset';
            else type = 'string';
        } else if (typeof propertyValue === 'number') {
            type = 'number';
        } else if (typeof propertyValue === 'boolean') {
            type = 'boolean';
        } else if (propertyValue && typeof propertyValue === 'object') {
            try {
                const keys = Object.keys(propertyValue);
                if (keys.includes('r') && keys.includes('g') && keys.includes('b')) type = 'color';
                else if (keys.includes('x') && keys.includes('y')) type = propertyValue.z !== undefined ? 'vec3' : 'vec2';
                else if (keys.includes('width') && keys.includes('height')) type = 'size';
                else if (keys.includes('uuid') || keys.includes('__uuid__')) {
                    if (propertyName.toLowerCase().includes('node') || propertyName.toLowerCase().includes('target') || keys.includes('__id__')) type = 'node';
                    else type = 'asset';
                } else if (keys.includes('__id__')) type = 'node';
                else type = 'object';
            } catch {
                type = 'object';
            }
        } else if (propertyValue === null || propertyValue === undefined) {
            if (['spriteFrame', 'texture', 'material', 'font', 'clip', 'prefab'].includes(propertyName.toLowerCase())) type = 'asset';
            else if (propertyName.toLowerCase().includes('node') || propertyName.toLowerCase().includes('target')) type = 'node';
            else if (propertyName.toLowerCase().includes('component')) type = 'component';
            else type = 'unknown';
        }

        return { exists: true, type, availableProperties, originalValue: propertyValue };
    }

    private parseColorString(colorStr: string): { r: number; g: number; b: number; a: number } {
        const str = colorStr.trim();
        if (str.startsWith('#')) {
            if (str.length === 7) {
                return {
                    r: parseInt(str.substring(1, 3), 16),
                    g: parseInt(str.substring(3, 5), 16),
                    b: parseInt(str.substring(5, 7), 16),
                    a: 255
                };
            } else if (str.length === 9) {
                return {
                    r: parseInt(str.substring(1, 3), 16),
                    g: parseInt(str.substring(3, 5), 16),
                    b: parseInt(str.substring(5, 7), 16),
                    a: parseInt(str.substring(7, 9), 16)
                };
            }
        }
        throw new Error(`Invalid color format: "${colorStr}". Only hexadecimal format is supported (e.g., "#FF0000" or "#FF0000FF")`);
    }

    private async verifyPropertyChange(nodeUuid: string, componentType: string, property: string, originalValue: any, expectedValue: any): Promise<{ verified: boolean; actualValue: any; fullData: any }> {
        try {
            const componentInfo = await this.getComponentInfo(nodeUuid, componentType);
            if (componentInfo.success && componentInfo.data) {
                const propertyData = componentInfo.data.properties?.[property];
                let actualValue = propertyData;
                if (propertyData && typeof propertyData === 'object' && 'value' in propertyData) {
                    actualValue = propertyData.value;
                }

                const extractUuid = (input: any): string => {
                    if (!input || typeof input !== 'object') {
                        return '';
                    }
                    if (typeof input.uuid === 'string') {
                        return input.uuid;
                    }
                    if (input.uuid && typeof input.uuid === 'object') {
                        return input.uuid.value || input.uuid.uuid || input.uuid.__uuid__ || '';
                    }
                    if (typeof input.__uuid__ === 'string') {
                        return input.__uuid__;
                    }
                    if (input.value && typeof input.value === 'object') {
                        return extractUuid(input.value);
                    }
                    return '';
                };

                let verified = false;
                if (typeof expectedValue === 'object' && expectedValue !== null && 'uuid' in expectedValue) {
                    const actualUuid = extractUuid(actualValue);
                    const expectedUuid = extractUuid(expectedValue) || String(expectedValue.uuid || '');
                    verified = actualUuid === expectedUuid && expectedUuid !== '';
                } else {
                    if (typeof actualValue === typeof expectedValue) {
                        if (typeof actualValue === 'object' && actualValue !== null && expectedValue !== null) {
                            verified = JSON.stringify(actualValue) === JSON.stringify(expectedValue);
                        } else {
                            verified = actualValue === expectedValue;
                        }
                    } else {
                        verified = String(actualValue) === String(expectedValue) || Number(actualValue) === Number(expectedValue);
                    }
                }

                return {
                    verified,
                    actualValue,
                    fullData: {
                        modifiedProperty: {
                            name: property, before: originalValue, expected: expectedValue,
                            actual: actualValue, verified, propertyMetadata: propertyData
                        },
                        componentSummary: {
                            nodeUuid, componentType,
                            totalProperties: Object.keys(componentInfo.data?.properties || {}).length
                        }
                    }
                };
            }
        } catch (error) {
            console.error('[ComponentToolsV2] Verification failed:', error);
        }
        return { verified: false, actualValue: undefined, fullData: null };
    }

    private async checkAndRedirectNodeProperties(args: any): Promise<ToolResponse | null> {
        const { uuid, componentType, property, value } = args;
        const nodeBasicProperties = ['name', 'active', 'layer', 'mobility', 'parent', 'children', 'hideFlags'];
        const nodeTransformProperties = ['position', 'rotation', 'scale', 'eulerAngles', 'angle'];

        if (componentType === 'cc.Node' || componentType === 'Node') {
            if (nodeBasicProperties.includes(property)) {
                return {
                    success: false,
                    error: `Property '${property}' is a node basic property, not a component property`,
                    instruction: `Please use node_modify to set node properties.`
                };
            } else if (nodeTransformProperties.includes(property)) {
                return {
                    success: false,
                    error: `Property '${property}' is a node transform property, not a component property`,
                    instruction: `Please use node_modify to set transform properties.`
                };
            }
        }

        if (nodeBasicProperties.includes(property) || nodeTransformProperties.includes(property)) {
            const methodName = nodeTransformProperties.includes(property) ? 'node_modify' : 'node_modify';
            return {
                success: false,
                error: `Property '${property}' is a node property, not a component property`,
                instruction: `Property '${property}' should be set using ${methodName}, not component_modify.`
            };
        }

        return null;
    }

    private generateComponentSuggestion(requestedType: string, availableTypes: string[], property: string): string {
        const similarTypes = availableTypes.filter(type =>
            type.toLowerCase().includes(requestedType.toLowerCase()) ||
            requestedType.toLowerCase().includes(type.toLowerCase())
        );

        let instruction = '';
        if (similarTypes.length > 0) {
            instruction += `\nFound similar components: ${similarTypes.join(', ')}`;
            instruction += `\nSuggestion: Perhaps you meant '${similarTypes[0]}'?`;
        }

        const propertyToComponentMap: Record<string, string[]> = {
            'string': ['cc.Label', 'cc.RichText', 'cc.EditBox'],
            'text': ['cc.Label', 'cc.RichText'],
            'fontSize': ['cc.Label', 'cc.RichText'],
            'spriteFrame': ['cc.Sprite'],
            'color': ['cc.Label', 'cc.Sprite', 'cc.Graphics'],
            'normalColor': ['cc.Button'],
            'pressedColor': ['cc.Button'],
            'target': ['cc.Button'],
            'contentSize': ['cc.UITransform'],
            'anchorPoint': ['cc.UITransform']
        };

        const recommendedComponents = propertyToComponentMap[property] || [];
        const availableRecommended = recommendedComponents.filter(comp => availableTypes.includes(comp));
        if (availableRecommended.length > 0) {
            instruction += `\nBased on property '${property}', recommended components: ${availableRecommended.join(', ')}`;
        }

        instruction += `\nSuggested Actions:`;
        instruction += `\n1. Use component_query(uuid=...) to view all components on the node`;
        instruction += `\n2. If needed, use component_add(uuid=..., componentType="${requestedType}") to add the component`;

        return instruction;
    }
}
