import { ToolDefinition, ToolResponse, ToolExecutor, ComponentInfo } from '../../types';

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
                                'node', 'component', 'spriteFrame', 'prefab', 'asset',
                                'nodeArray', 'colorArray', 'numberArray', 'stringArray'
                            ]
                        },
                        value: {
                            description: 'Property value for action=set. Format depends on propertyType: color={r,g,b,a}, vec2={x,y}, vec3={x,y,z}, size={width,height}, node/asset="uuid-string"'
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
            default:
                return { success: false, error: `Unknown action: ${action}. Must be one of: set, remove, reset, execute` };
        }
    }

    // ============================================================
    // Component query methods (migrated from ComponentTools)
    // ============================================================

    private async getComponents(nodeUuid: string): Promise<ToolResponse> {
        return new Promise((resolve) => {
            Editor.Message.request('scene', 'query-node', nodeUuid).then((nodeData: any) => {
                if (nodeData && nodeData.__comps__) {
                    const components = nodeData.__comps__.map((comp: any) => ({
                        type: comp.__type__ || comp.cid || comp.type || 'Unknown',
                        uuid: comp.uuid?.value || comp.uuid || null,
                        enabled: comp.enabled !== undefined ? comp.enabled : true,
                        properties: this.extractComponentProperties(comp)
                    }));
                    resolve({
                        success: true,
                        data: { nodeUuid, components }
                    });
                } else {
                    resolve({ success: false, error: 'Node not found or no components data' });
                }
            }).catch((err: Error) => {
                const options = {
                    name: 'cocos-mcp-server',
                    method: 'getNodeInfo',
                    args: [nodeUuid]
                };
                Editor.Message.request('scene', 'execute-scene-script', options).then((result: any) => {
                    if (result.success) {
                        resolve({ success: true, data: result.data.components });
                    } else {
                        resolve(result);
                    }
                }).catch((err2: Error) => {
                    resolve({ success: false, error: `Direct API failed: ${err.message}, Scene script failed: ${err2.message}` });
                });
            });
        });
    }

    private async getComponentInfo(nodeUuid: string, componentType: string): Promise<ToolResponse> {
        return new Promise((resolve) => {
            Editor.Message.request('scene', 'query-node', nodeUuid).then((nodeData: any) => {
                if (nodeData && nodeData.__comps__) {
                    const component = nodeData.__comps__.find((comp: any) => {
                        const compType = comp.__type__ || comp.cid || comp.type;
                        return compType === componentType;
                    });
                    if (component) {
                        resolve({
                            success: true,
                            data: {
                                nodeUuid,
                                componentType,
                                enabled: component.enabled !== undefined ? component.enabled : true,
                                properties: this.extractComponentProperties(component)
                            }
                        });
                    } else {
                        resolve({ success: false, error: `Component '${componentType}' not found on node` });
                    }
                } else {
                    resolve({ success: false, error: 'Node not found or no components data' });
                }
            }).catch((err: Error) => {
                const options = {
                    name: 'cocos-mcp-server',
                    method: 'getNodeInfo',
                    args: [nodeUuid]
                };
                Editor.Message.request('scene', 'execute-scene-script', options).then((result: any) => {
                    if (result.success && result.data.components) {
                        const component = result.data.components.find((comp: any) => comp.type === componentType);
                        if (component) {
                            resolve({
                                success: true,
                                data: { nodeUuid, componentType, ...component }
                            });
                        } else {
                            resolve({ success: false, error: `Component '${componentType}' not found on node` });
                        }
                    } else {
                        resolve({ success: false, error: result.error || 'Failed to get component info' });
                    }
                }).catch((err2: Error) => {
                    resolve({ success: false, error: `Direct API failed: ${err.message}, Scene script failed: ${err2.message}` });
                });
            });
        });
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
        return new Promise(async (resolve) => {
            // Check if component already exists
            const allComponentsInfo = await this.getComponents(nodeUuid);
            if (allComponentsInfo.success && allComponentsInfo.data?.components) {
                const existingComponent = allComponentsInfo.data.components.find((comp: any) => comp.type === componentType);
                if (existingComponent) {
                    resolve({
                        success: true,
                        message: `Component '${componentType}' already exists on node`,
                        data: { nodeUuid, componentType, componentVerified: true, existing: true }
                    });
                    return;
                }
            }
            // Try Editor API
            Editor.Message.request('scene', 'create-component', {
                uuid: nodeUuid,
                component: componentType
            }).then(async () => {
                await new Promise(resolve => setTimeout(resolve, 100));
                try {
                    const allComponentsInfo2 = await this.getComponents(nodeUuid);
                    if (allComponentsInfo2.success && allComponentsInfo2.data?.components) {
                        const addedComponent = allComponentsInfo2.data.components.find((comp: any) => comp.type === componentType);
                        if (addedComponent) {
                            resolve({
                                success: true,
                                message: `Component '${componentType}' added successfully`,
                                data: { nodeUuid, componentType, componentVerified: true, existing: false }
                            });
                        } else {
                            resolve({
                                success: false,
                                error: `Component '${componentType}' was not found on node after addition. Available components: ${allComponentsInfo2.data.components.map((c: any) => c.type).join(', ')}`
                            });
                        }
                    } else {
                        resolve({ success: false, error: `Failed to verify component addition: ${allComponentsInfo2.error || 'Unable to get node components'}` });
                    }
                } catch (verifyError: any) {
                    resolve({ success: false, error: `Failed to verify component addition: ${verifyError.message}` });
                }
            }).catch((err: Error) => {
                // Fallback: scene script
                const options = {
                    name: 'cocos-mcp-server',
                    method: 'addComponentToNode',
                    args: [nodeUuid, componentType]
                };
                Editor.Message.request('scene', 'execute-scene-script', options).then((result: any) => {
                    resolve(result);
                }).catch((err2: Error) => {
                    resolve({ success: false, error: `Direct API failed: ${err.message}, Scene script failed: ${err2.message}` });
                });
            });
        });
    }

    private async attachScript(nodeUuid: string, scriptPath: string): Promise<ToolResponse> {
        return new Promise(async (resolve) => {
            const scriptName = scriptPath.split('/').pop()?.replace('.ts', '').replace('.js', '');
            if (!scriptName) {
                resolve({ success: false, error: 'Invalid script path' });
                return;
            }
            // Check if script already exists
            const allComponentsInfo = await this.getComponents(nodeUuid);
            if (allComponentsInfo.success && allComponentsInfo.data?.components) {
                const existingScript = allComponentsInfo.data.components.find((comp: any) => comp.type === scriptName);
                if (existingScript) {
                    resolve({
                        success: true,
                        message: `Script '${scriptName}' already exists on node`,
                        data: { nodeUuid, componentName: scriptName, existing: true }
                    });
                    return;
                }
            }
            // Try using script name as component type
            Editor.Message.request('scene', 'create-component', {
                uuid: nodeUuid,
                component: scriptName
            }).then(async () => {
                await new Promise(resolve => setTimeout(resolve, 100));
                const allComponentsInfo2 = await this.getComponents(nodeUuid);
                if (allComponentsInfo2.success && allComponentsInfo2.data?.components) {
                    const addedScript = allComponentsInfo2.data.components.find((comp: any) => comp.type === scriptName);
                    if (addedScript) {
                        resolve({
                            success: true,
                            message: `Script '${scriptName}' attached successfully`,
                            data: { nodeUuid, componentName: scriptName, existing: false }
                        });
                    } else {
                        resolve({
                            success: false,
                            error: `Script '${scriptName}' was not found on node after addition. Available components: ${allComponentsInfo2.data.components.map((c: any) => c.type).join(', ')}`
                        });
                    }
                } else {
                    resolve({ success: false, error: `Failed to verify script addition: ${allComponentsInfo2.error || 'Unable to get node components'}` });
                }
            }).catch((err: Error) => {
                // Fallback: scene script
                const options = {
                    name: 'cocos-mcp-server',
                    method: 'attachScript',
                    args: [nodeUuid, scriptPath]
                };
                Editor.Message.request('scene', 'execute-scene-script', options).then((result: any) => {
                    resolve(result);
                }).catch(() => {
                    resolve({
                        success: false,
                        error: `Failed to attach script '${scriptName}': ${err.message}`,
                        instruction: 'Please ensure the script is properly compiled and exported as a Component class.'
                    });
                });
            });
        });
    }

    // ============================================================
    // Modify methods
    // ============================================================

    private async removeComponent(nodeUuid: string, componentType: string): Promise<ToolResponse> {
        return new Promise(async (resolve) => {
            const allComponentsInfo = await this.getComponents(nodeUuid);
            if (!allComponentsInfo.success || !allComponentsInfo.data?.components) {
                resolve({ success: false, error: `Failed to get components for node '${nodeUuid}': ${allComponentsInfo.error}` });
                return;
            }
            const exists = allComponentsInfo.data.components.some((comp: any) => comp.type === componentType);
            if (!exists) {
                resolve({ success: false, error: `Component cid '${componentType}' not found on node '${nodeUuid}'. Use component_query to get the correct type (cid).` });
                return;
            }
            try {
                await Editor.Message.request('scene', 'remove-component', {
                    uuid: nodeUuid,
                    component: componentType
                });
                const afterRemoveInfo = await this.getComponents(nodeUuid);
                const stillExists = afterRemoveInfo.success && afterRemoveInfo.data?.components?.some((comp: any) => comp.type === componentType);
                if (stillExists) {
                    resolve({ success: false, error: `Component cid '${componentType}' was not removed from node '${nodeUuid}'.` });
                } else {
                    resolve({
                        success: true,
                        message: `Component cid '${componentType}' removed successfully from node '${nodeUuid}'`,
                        data: { nodeUuid, componentType }
                    });
                }
            } catch (err: any) {
                resolve({ success: false, error: `Failed to remove component: ${err.message}` });
            }
        });
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
                    data: { result, message: `Method '${name}' executed successfully` }
                });
            }).catch((err: Error) => {
                resolve({ success: false, error: err.message });
            });
        });
    }

    // ============================================================
    // set_component_property — full migration with complex type conversion
    // ============================================================

    private async setComponentProperty(args: any): Promise<ToolResponse> {
        const { uuid: nodeUuid, componentType, property, propertyType, value } = args;

        return new Promise(async (resolve) => {
            try {
                console.log(`[ComponentToolsV2] Setting ${componentType}.${property} (type: ${propertyType}) = ${JSON.stringify(value)} on node ${nodeUuid}`);

                // Step 0: Detect node property redirect
                const nodeRedirectResult = await this.checkAndRedirectNodeProperties(args);
                if (nodeRedirectResult) {
                    resolve(nodeRedirectResult);
                    return;
                }

                // Step 1: Get components
                const componentsResponse = await this.getComponents(nodeUuid);
                if (!componentsResponse.success || !componentsResponse.data) {
                    resolve({
                        success: false,
                        error: `Failed to get components for node '${nodeUuid}': ${componentsResponse.error}`,
                        instruction: `Please verify that node UUID '${nodeUuid}' is correct.`
                    });
                    return;
                }

                const allComponents = componentsResponse.data.components;

                // Step 2: Find target component
                let targetComponent = null;
                const availableTypes: string[] = [];
                for (let i = 0; i < allComponents.length; i++) {
                    const comp = allComponents[i];
                    availableTypes.push(comp.type);
                    if (comp.type === componentType) {
                        targetComponent = comp;
                        break;
                    }
                }

                if (!targetComponent) {
                    const instruction = this.generateComponentSuggestion(componentType, availableTypes, property);
                    resolve({
                        success: false,
                        error: `Component '${componentType}' not found on node. Available components: ${availableTypes.join(', ')}`,
                        instruction
                    });
                    return;
                }

                // Step 3: Analyze property
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

                // Step 4: Process value based on propertyType
                const originalValue = propertyInfo.originalValue;
                let processedValue: any;

                switch (propertyType) {
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
                        if (typeof value === 'string') {
                            processedValue = value; // Will be converted to __id__ later
                        } else {
                            throw new Error('Component reference value must be a string (node UUID containing the target component)');
                        }
                        break;
                    case 'spriteFrame':
                    case 'prefab':
                    case 'asset':
                        if (typeof value === 'string') {
                            processedValue = { uuid: value };
                        } else {
                            throw new Error(`${propertyType} value must be a string UUID`);
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
                        throw new Error(`Unsupported property type: ${propertyType}`);
                }

                let actualExpectedValue = processedValue;

                // Step 5: Get raw node data for property path
                const rawNodeData = await Editor.Message.request('scene', 'query-node', nodeUuid);
                if (!rawNodeData || !rawNodeData.__comps__) {
                    resolve({ success: false, error: 'Failed to get raw node data for property setting' });
                    return;
                }

                let rawComponentIndex = -1;
                for (let i = 0; i < rawNodeData.__comps__.length; i++) {
                    const comp = rawNodeData.__comps__[i] as any;
                    const compType = comp.__type__ || comp.cid || comp.type || 'Unknown';
                    if (compType === componentType) {
                        rawComponentIndex = i;
                        break;
                    }
                }

                if (rawComponentIndex === -1) {
                    resolve({ success: false, error: 'Could not find component index for setting property' });
                    return;
                }

                let propertyPath = `__comps__.${rawComponentIndex}.${property}`;

                // Special handling for different property types
                if (propertyType === 'asset' || propertyType === 'spriteFrame' || propertyType === 'prefab' ||
                    (propertyInfo.type === 'asset' && propertyType === 'string')) {
                    let assetType = 'cc.SpriteFrame';
                    if (property.toLowerCase().includes('texture')) assetType = 'cc.Texture2D';
                    else if (property.toLowerCase().includes('material')) assetType = 'cc.Material';
                    else if (property.toLowerCase().includes('font')) assetType = 'cc.Font';
                    else if (property.toLowerCase().includes('clip')) assetType = 'cc.AudioClip';
                    else if (propertyType === 'prefab') assetType = 'cc.Prefab';

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
                } else if (propertyType === 'color' && processedValue && typeof processedValue === 'object') {
                    const colorValue = {
                        r: Math.min(255, Math.max(0, Number(processedValue.r) || 0)),
                        g: Math.min(255, Math.max(0, Number(processedValue.g) || 0)),
                        b: Math.min(255, Math.max(0, Number(processedValue.b) || 0)),
                        a: processedValue.a !== undefined ? Math.min(255, Math.max(0, Number(processedValue.a))) : 255
                    };
                    await Editor.Message.request('scene', 'set-property', {
                        uuid: nodeUuid, path: propertyPath, dump: { value: colorValue, type: 'cc.Color' }
                    });
                } else if (propertyType === 'vec3' && processedValue && typeof processedValue === 'object') {
                    await Editor.Message.request('scene', 'set-property', {
                        uuid: nodeUuid, path: propertyPath,
                        dump: { value: { x: Number(processedValue.x) || 0, y: Number(processedValue.y) || 0, z: Number(processedValue.z) || 0 }, type: 'cc.Vec3' }
                    });
                } else if (propertyType === 'vec2' && processedValue && typeof processedValue === 'object') {
                    await Editor.Message.request('scene', 'set-property', {
                        uuid: nodeUuid, path: propertyPath,
                        dump: { value: { x: Number(processedValue.x) || 0, y: Number(processedValue.y) || 0 }, type: 'cc.Vec2' }
                    });
                } else if (propertyType === 'size' && processedValue && typeof processedValue === 'object') {
                    await Editor.Message.request('scene', 'set-property', {
                        uuid: nodeUuid, path: propertyPath,
                        dump: { value: { width: Number(processedValue.width) || 0, height: Number(processedValue.height) || 0 }, type: 'cc.Size' }
                    });
                } else if (propertyType === 'node' && processedValue && typeof processedValue === 'object' && 'uuid' in processedValue) {
                    await Editor.Message.request('scene', 'set-property', {
                        uuid: nodeUuid, path: propertyPath, dump: { value: processedValue, type: 'cc.Node' }
                    });
                } else if (propertyType === 'component' && typeof processedValue === 'string') {
                    // Component reference: find __id__ via node UUID
                    const targetNodeUuid = processedValue;
                    let expectedComponentType = '';

                    const currentComponentInfo = await this.getComponentInfo(nodeUuid, componentType);
                    if (currentComponentInfo.success && currentComponentInfo.data?.properties?.[property]) {
                        const propertyMeta = currentComponentInfo.data.properties[property];
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
                    }

                    if (!expectedComponentType) {
                        throw new Error(`Unable to determine required component type for property '${property}' on component '${componentType}'.`);
                    }

                    const targetNodeData = await Editor.Message.request('scene', 'query-node', targetNodeUuid);
                    if (!targetNodeData || !targetNodeData.__comps__) {
                        throw new Error(`Target node ${targetNodeUuid} not found or has no components`);
                    }

                    let componentId: string | null = null;
                    for (let i = 0; i < targetNodeData.__comps__.length; i++) {
                        const comp = targetNodeData.__comps__[i] as any;
                        if (comp.type === expectedComponentType) {
                            if (comp.value && comp.value.uuid && comp.value.uuid.value) {
                                componentId = comp.value.uuid.value;
                            } else {
                                throw new Error('Unable to extract component ID from component structure');
                            }
                            break;
                        }
                    }

                    if (!componentId) {
                        const availableComponents = targetNodeData.__comps__.map((comp: any, index: number) => {
                            let sceneId = 'unknown';
                            if (comp.value && comp.value.uuid && comp.value.uuid.value) {
                                sceneId = comp.value.uuid.value;
                            }
                            return `${comp.type}(scene_id:${sceneId})`;
                        });
                        throw new Error(`Component type '${expectedComponentType}' not found on node ${targetNodeUuid}. Available components: ${availableComponents.join(', ')}`);
                    }

                    actualExpectedValue = { uuid: componentId };
                    await Editor.Message.request('scene', 'set-property', {
                        uuid: nodeUuid, path: propertyPath,
                        dump: { value: { uuid: componentId }, type: expectedComponentType }
                    });
                } else if (propertyType === 'nodeArray' && Array.isArray(processedValue)) {
                    await Editor.Message.request('scene', 'set-property', {
                        uuid: nodeUuid, path: propertyPath, dump: { value: processedValue }
                    });
                } else if (propertyType === 'colorArray' && Array.isArray(processedValue)) {
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

                // Step 6: Verify
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

    // ============================================================
    // Helper methods (migrated from ComponentTools)
    // ============================================================

    private extractComponentProperties(component: any): Record<string, any> {
        if (component.value && typeof component.value === 'object') {
            return component.value;
        }
        const properties: Record<string, any> = {};
        const excludeKeys = ['__type__', 'enabled', 'node', '_id', '__scriptAsset', 'uuid', 'name', '_name', '_objFlags', '_enabled', 'type', 'readonly', 'visible', 'cid', 'editor', 'extends'];
        for (const key in component) {
            if (!excludeKeys.includes(key) && !key.startsWith('_')) {
                properties[key] = component[key];
            }
        }
        return properties;
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

                let verified = false;
                if (typeof expectedValue === 'object' && expectedValue !== null && 'uuid' in expectedValue) {
                    const actualUuid = actualValue && typeof actualValue === 'object' && 'uuid' in actualValue ? actualValue.uuid : '';
                    const expectedUuid = expectedValue.uuid || '';
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
