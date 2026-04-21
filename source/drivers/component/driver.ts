import { BaseDriver } from '../base-driver';
import { RuntimeProfile } from '../../core/profile';
import { SceneQueryDriver } from '../scene-query/contract';
import {
    buildCidNameMap,
    normalizeComponentType,
} from '../scene-query/normalizer';
import { resolveDefaultSpriteFrameUuid } from '../scene-query/sprite-frame-resolver';
import { safeSerialize } from '../../utils/serializer';
import {
    ApplyPropertyInput,
    ApplyPropertyResult,
    AvailableComponentsResult,
    ComponentBridgeDriver,
    ComponentCreateInput,
    ComponentCreateResult,
    ComponentDetailResult,
    ComponentHasScriptResult,
    ComponentMethodInput,
    ComponentQueryResult,
    ComponentResetInput,
    ComponentSetPropertyInput,
    NormalizedComponent,
    PropertyVerificationResult,
    RemoveArrayElementInput,
    SceneClassesResult,
    SceneComponentsResult,
    SpriteStateResult,
} from './contract';

class EditorComponentDriver extends BaseDriver implements ComponentBridgeDriver {
    private cidNameMap: Map<string, string> | null = null;

    constructor(
        profile: RuntimeProfile,
        private readonly sceneQuery: SceneQueryDriver,
    ) {
        super(profile);
    }

    // =========================================================================
    // 低层级 IPC 操作（原有）
    // =========================================================================

    async createComponent(input: ComponentCreateInput): Promise<ComponentCreateResult> {
        this.ensureFeatureAvailable('sceneQueryNodeTree');
        const result = await this.request('scene', 'create-component', input);
        return (result ?? {}) as ComponentCreateResult;
    }

    async removeArrayElement(input: RemoveArrayElementInput): Promise<void> {
        this.ensureFeatureAvailable('sceneQueryNodeTree');
        await this.request('scene', 'remove-array-element', input);
    }

    async resetComponent(input: ComponentResetInput): Promise<void> {
        this.ensureFeatureAvailable('sceneQueryNodeTree');
        await this.request('scene', 'reset-component', input);
    }

    async executeComponentMethod(input: ComponentMethodInput): Promise<unknown> {
        this.ensureFeatureAvailable('sceneQueryNodeTree');
        return this.request('scene', 'execute-component-method', input);
    }

    async setProperty(input: ComponentSetPropertyInput): Promise<void> {
        this.ensureFeatureAvailable('sceneQueryNodeTree');
        await this.request('scene', 'set-property', input);
    }

    // =========================================================================
    // 查询操作
    // =========================================================================

    async queryNodeComponents(nodeUuid: string): Promise<ComponentQueryResult> {
        const cidMap = await this.getCidNameMap();

        try {
            const nodeData = await this.sceneQuery.queryNode(nodeUuid);
            if (nodeData && nodeData.__comps__) {
                const components = nodeData.__comps__.map((comp: any) => this.normalizeRawComponent(comp, cidMap));
                return { nodeUuid, components };
            }
            throw new Error('Node not found or no components data');
        } catch (directErr: any) {
            try {
                const result = await this.sceneQuery.executeSceneScript<any>('getNodeInfo', [nodeUuid]);
                if (!result?.success) {
                    throw new Error(result?.error || 'Scene script fallback failed');
                }

                const rawComponents = Array.isArray(result?.data?.components)
                    ? result.data.components
                    : (Array.isArray(result?.data) ? result.data : []);

                const components = rawComponents.map((comp: any) => {
                    const rawType = comp.__type__ || comp.cid || comp.type || comp.constructor?.name || 'Unknown';
                    const resolvedType = this.resolveType(rawType, cidMap);
                    return {
                        type: resolvedType.type,
                        cid: resolvedType.cid || comp.cid,
                        uuid: comp.uuid?.value || comp.uuid || comp.value?.uuid?.value || null,
                        enabled: comp.enabled?.value !== undefined ? comp.enabled.value : (comp.enabled !== undefined ? comp.enabled : true),
                        properties: comp.properties || this.extractComponentProperties(comp),
                    } as NormalizedComponent;
                });

                return { nodeUuid, components };
            } catch (scriptErr: any) {
                throw new Error(`Direct API failed: ${directErr.message}, Scene script failed: ${scriptErr.message}`);
            }
        }
    }

    async queryComponentInfo(nodeUuid: string, componentType: string): Promise<ComponentDetailResult | null> {
        const result = await this.queryNodeComponents(nodeUuid);
        const component = this.isComponentOnNode(result.components, componentType);
        if (!component) return null;
        return { nodeUuid, ...component };
    }

    async queryAvailableComponents(category: string = 'all'): Promise<AvailableComponentsResult> {
        const componentCategories: Record<string, string[]> = {
            renderer: ['cc.Sprite', 'cc.Label', 'cc.RichText', 'cc.Mask', 'cc.Graphics'],
            ui: ['cc.Button', 'cc.Toggle', 'cc.Slider', 'cc.ScrollView', 'cc.EditBox', 'cc.ProgressBar'],
            physics: ['cc.RigidBody2D', 'cc.BoxCollider2D', 'cc.CircleCollider2D', 'cc.PolygonCollider2D'],
            animation: ['cc.Animation', 'cc.AnimationClip', 'cc.SkeletalAnimation'],
            audio: ['cc.AudioSource'],
            layout: ['cc.Layout', 'cc.Widget', 'cc.PageView', 'cc.PageViewIndicator'],
            effects: ['cc.MotionStreak', 'cc.ParticleSystem2D'],
            camera: ['cc.Camera'],
            light: ['cc.Light', 'cc.DirectionalLight', 'cc.PointLight', 'cc.SpotLight'],
        };

        let components: string[] = [];
        if (category === 'all') {
            for (const cat in componentCategories) {
                components = components.concat(componentCategories[cat]);
            }
        } else if (componentCategories[category]) {
            components = componentCategories[category];
        }

        return { category, components };
    }

    async querySceneClasses(extendsClass?: string): Promise<SceneClassesResult> {
        const result = await this.sceneQuery.executeSceneScript<any>('getRegisteredClasses', [extendsClass]);
        if (!result || !result.success) {
            throw new Error(result?.error || 'getRegisteredClasses failed');
        }
        return { classes: result.data.classes, count: result.data.count, extendsFilter: extendsClass };
    }

    async querySceneComponents(): Promise<SceneComponentsResult> {
        const components = await this.sceneQuery.queryComponents();
        return { components: components as any[], count: components.length };
    }

    async queryComponentHasScript(className: string): Promise<ComponentHasScriptResult> {
        const result = await this.sceneQuery.executeSceneScript<any>('getRegisteredClasses', [undefined]);
        if (!result || !result.success) {
            throw new Error(result?.error || 'getRegisteredClasses failed');
        }
        const hasScript = result.data.classes.includes(className);
        return {
            className,
            hasScript,
            message: hasScript ? `Component '${className}' has script` : `Component '${className}' does not have script`,
        };
    }

    // =========================================================================
    // 属性设置（含完整 Cocos 类型转换）
    // =========================================================================

    async applyComponentProperty(input: ApplyPropertyInput): Promise<ApplyPropertyResult> {
        const { nodeUuid, componentType, property, value, propertyType } = input;

        try {
            console.log(`[ComponentDriver] Setting ${componentType}.${property} (type: ${propertyType}) = ${JSON.stringify(value)} on node ${nodeUuid}`);

            // 检查节点属性重定向
            const redirect = this.checkAndRedirectNodeProperties(nodeUuid, componentType, property);
            if (redirect) return redirect;

            // 查询组件列表和原始节点数据
            const queryResult = await this.queryNodeComponents(nodeUuid);
            const target = this.isComponentOnNode(queryResult.components, componentType);
            if (!target) {
                const availableTypes = queryResult.components.map(c => c.type);
                return {
                    success: false,
                    error: `Component '${componentType}' not found on node. Available components: ${availableTypes.join(', ')}`,
                    instruction: this.generateComponentSuggestion(componentType, availableTypes, property),
                };
            }

            // 获取原始节点 dump
            const rawNodeData = await this.sceneQuery.queryNode(nodeUuid);
            if (!rawNodeData || !rawNodeData.__comps__) {
                return { success: false, error: 'Failed to get raw node data for property setting' };
            }

            const cidMap = await this.getCidNameMap();
            const rawComponentIndex = this.resolveRawComponentIndex(rawNodeData, componentType, cidMap);
            if (rawComponentIndex === -1) {
                return { success: false, error: 'Could not find component index for setting property' };
            }

            // 分析属性
            let propertyInfo;
            try {
                propertyInfo = this.analyzeProperty(target, property);
            } catch (analyzeError: any) {
                return { success: false, error: `Failed to analyze property '${property}': ${analyzeError.message}` };
            }

            if (!propertyInfo.exists) {
                return {
                    success: false,
                    error: `Property '${property}' not found on component '${componentType}'. Available properties: ${propertyInfo.availableProperties.join(', ')}`,
                };
            }

            const originalValue = propertyInfo.originalValue;
            const effectivePropertyType = this.normalizePropertyType(propertyType, propertyInfo.type, property, value);

            // 转换值
            let processedValue: any;
            try {
                processedValue = this.processPropertyValue(effectivePropertyType, value, property);
            } catch (error: any) {
                return { success: false, error: error.message };
            }

            // 构造路径并设置属性
            let actualExpectedValue = processedValue;
            const propertyPath = `__comps__.${rawComponentIndex}.${property}`;

            await this.applyProcessedValue(nodeUuid, propertyPath, effectivePropertyType, processedValue, propertyInfo, componentType, property, rawComponentIndex, target, cidMap);

            // 验证
            await new Promise(resolve => setTimeout(resolve, 200));
            const verification = await this.verifyPropertyChange(nodeUuid, componentType, property, originalValue, actualExpectedValue);

            return {
                success: true,
                message: `Successfully set ${componentType}.${property}`,
                data: {
                    nodeUuid, componentType, property,
                    actualValue: verification.actualValue,
                    changeVerified: verification.verified,
                },
            };
        } catch (error: any) {
            console.error(`[ComponentDriver] Error setting property:`, error);
            return { success: false, error: `Failed to set property: ${error.message}` };
        }
    }

    // =========================================================================
    // Sprite 默认状态
    // =========================================================================

    async ensureDefaultSpriteState(nodeUuid: string): Promise<SpriteStateResult> {
        const warnings: string[] = [];
        const defaultSpriteFrameUuid = await resolveDefaultSpriteFrameUuid(this.sceneQuery);

        if (defaultSpriteFrameUuid) {
            const sfResult = await this.applyComponentProperty({
                nodeUuid,
                componentType: 'cc.Sprite',
                property: 'spriteFrame',
                propertyType: 'spriteFrame',
                value: defaultSpriteFrameUuid,
            });
            if (!sfResult.success) {
                warnings.push(`Failed to assign default SpriteFrame: ${sfResult.error}`);
            }
        } else {
            warnings.push('Default SpriteFrame asset was not found; Sprite may remain unassigned');
        }

        const smResult = await this.applyComponentProperty({
            nodeUuid,
            componentType: 'cc.Sprite',
            property: 'sizeMode',
            propertyType: 'integer',
            value: 0,
        });
        if (!smResult.success) {
            warnings.push(`Failed to set Sprite sizeMode to CUSTOM: ${smResult.error}`);
        }

        return warnings.length > 0 ? { warning: warnings.join('; ') } : {};
    }

    // =========================================================================
    // 属性变更验证
    // =========================================================================

    async verifyPropertyChange(
        nodeUuid: string,
        componentType: string,
        property: string,
        originalValue: unknown,
        expectedValue: unknown,
    ): Promise<PropertyVerificationResult> {
        try {
            const detail = await this.queryComponentInfo(nodeUuid, componentType);
            if (detail) {
                const propertyData = detail.properties?.[property];
                let actualValue = propertyData;
                if (propertyData && typeof propertyData === 'object' && 'value' in (propertyData as Record<string, unknown>)) {
                    actualValue = (propertyData as Record<string, unknown>).value;
                }

                const extractUuid = (input: any): string => {
                    if (!input || typeof input !== 'object') return '';
                    if (typeof input.uuid === 'string') return input.uuid;
                    if (input.uuid && typeof input.uuid === 'object') return input.uuid.value || input.uuid.uuid || input.uuid.__uuid__ || '';
                    if (typeof input.__uuid__ === 'string') return input.__uuid__;
                    if (input.value && typeof input.value === 'object') return extractUuid(input.value);
                    return '';
                };

                let verified = false;
                if (typeof expectedValue === 'object' && expectedValue !== null && 'uuid' in (expectedValue as Record<string, unknown>)) {
                    const actualUuid = extractUuid(actualValue);
                    const expectedUuid = extractUuid(expectedValue) || String((expectedValue as any).uuid || '');
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
                            actual: actualValue, verified, propertyMetadata: propertyData,
                        },
                        componentSummary: {
                            nodeUuid, componentType,
                            totalProperties: Object.keys(detail.properties || {}).length,
                        },
                    },
                };
            }
        } catch (error) {
            console.error('[ComponentDriver] Verification failed:', error);
        }
        return { verified: false, actualValue: undefined, fullData: null };
    }

    // =========================================================================
    // 组件匹配工具
    // =========================================================================

    isComponentOnNode(components: NormalizedComponent[], componentType: string): NormalizedComponent | undefined {
        const target = normalizeComponentType(componentType);
        return components.find(comp => {
            const type = normalizeComponentType(comp.type);
            const cid = comp.cid ? normalizeComponentType(comp.cid) : '';
            return type === target || cid === target;
        });
    }

    countComponentOnNode(components: NormalizedComponent[], componentType: string): number {
        const target = normalizeComponentType(componentType);
        return components.filter(comp => {
            const type = normalizeComponentType(comp.type);
            const cid = comp.cid ? normalizeComponentType(comp.cid) : '';
            return type === target || cid === target;
        }).length;
    }

    generateComponentSuggestion(requestedType: string, availableTypes: string[], property: string): string {
        const similarTypes = availableTypes.filter(type =>
            type.toLowerCase().includes(requestedType.toLowerCase()) ||
            requestedType.toLowerCase().includes(type.toLowerCase()),
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
            'anchorPoint': ['cc.UITransform'],
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

    // =========================================================================
    // 内部工具方法
    // =========================================================================

    private async getCidNameMap(): Promise<Map<string, string>> {
        this.cidNameMap = await buildCidNameMap(this.sceneQuery, this.cidNameMap);
        return this.cidNameMap;
    }

    private resolveType(rawType: any, cidMap: Map<string, string>): { type: string; cid?: string } {
        const normalized = normalizeComponentType(rawType);
        const resolved = cidMap.get(normalized) || normalized;
        if (resolved !== normalized) return { type: resolved, cid: normalized };
        return { type: resolved };
    }

    private getComponentAliases(componentType: string, cidMap: Map<string, string>): Set<string> {
        const normalized = normalizeComponentType(componentType);
        const aliases = new Set<string>([normalized]);
        const mapped = cidMap.get(normalized);
        if (mapped) aliases.add(normalizeComponentType(mapped));
        for (const [cid, name] of cidMap.entries()) {
            if (name === normalized) { aliases.add(normalizeComponentType(cid)); break; }
        }
        return aliases;
    }

    private normalizeRawComponent(comp: any, cidMap: Map<string, string>): NormalizedComponent {
        const rawType = comp.__type__ || comp.cid || comp.type || 'Unknown';
        const resolvedType = this.resolveType(rawType, cidMap);
        return {
            type: resolvedType.type,
            cid: resolvedType.cid,
            uuid: comp.uuid?.value || comp.uuid || comp.value?.uuid?.value || null,
            enabled: comp.enabled?.value !== undefined ? comp.enabled.value : (comp.enabled !== undefined ? comp.enabled : true),
            properties: this.extractComponentProperties(comp),
        };
    }

    private resolveRawComponentIndex(rawNodeData: any, componentType: string, cidMap: Map<string, string>): number {
        if (!rawNodeData || !Array.isArray(rawNodeData.__comps__)) return -1;
        const componentAliases = this.getComponentAliases(componentType, cidMap);
        for (let i = 0; i < rawNodeData.__comps__.length; i++) {
            const comp = rawNodeData.__comps__[i] as any;
            const rawType = comp.__type__ || comp.cid || comp.type || 'Unknown';
            const resolved = this.resolveType(rawType, cidMap);
            const rawTypeNormalized = normalizeComponentType(rawType);
            if (componentAliases.has(rawTypeNormalized) || componentAliases.has(resolved.type)) return i;
        }
        return -1;
    }

    // =========================================================================
    // 属性提取
    // =========================================================================

    private extractComponentProperties(component: any): Record<string, any> {
        const properties: Record<string, any> = {};
        const source = this.getComponentPropertySource(component);
        if (!source) return properties;

        for (const [key, propData] of Object.entries(source)) {
            if (key.startsWith('_') || this.shouldSkipComponentProperty(key)) continue;
            if (!this.isVisibleComponentPropertyDescriptor(propData)) continue;

            const descriptor = propData as any;
            const simplified: any = {};
            if (descriptor.value !== undefined) simplified.value = safeSerialize(descriptor.value);
            const resolvedType = descriptor.type !== undefined ? descriptor.type : descriptor.ctor;
            if (resolvedType !== undefined) simplified.type = safeSerialize(resolvedType);
            if (descriptor.ctor !== undefined) simplified.ctor = safeSerialize(descriptor.ctor);
            if (descriptor.readonly) simplified.readonly = true;
            if (descriptor.enumList !== undefined) simplified.enumList = safeSerialize(descriptor.enumList);
            if (descriptor.min !== undefined) simplified.min = descriptor.min;
            if (descriptor.max !== undefined) simplified.max = descriptor.max;
            if (descriptor.step !== undefined) simplified.step = descriptor.step;
            if (descriptor.extends !== undefined) simplified.extends = safeSerialize(descriptor.extends);

            if (Object.keys(simplified).length > 0) properties[key] = simplified;
        }
        return properties;
    }

    private getComponentPropertySource(component: any): Record<string, any> | null {
        if (!component || typeof component !== 'object') return null;
        if (component.value && typeof component.value === 'object' && !Array.isArray(component.value)) return component.value;
        if (component.properties && typeof component.properties === 'object') {
            if (component.properties.value && typeof component.properties.value === 'object' && !Array.isArray(component.properties.value)) return component.properties.value;
            return component.properties;
        }
        return component;
    }

    private shouldSkipComponentProperty(key: string): boolean {
        return ['__type__', '__prefab', '__scriptAsset', 'enabled', 'node', '_id', 'uuid', 'name', '_name', '_objFlags', '_enabled', 'type', 'readonly', 'visible', 'cid', 'editor', 'extends'].includes(key);
    }

    private isVisibleComponentPropertyDescriptor(propData: any): boolean {
        if (typeof propData !== 'object' || propData === null) return false;
        if ((propData as any).visible === false) return false;
        return 'value' in propData || 'type' in propData || 'ctor' in propData || 'readonly' in propData;
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
                if (defaultKeys.includes('value') && typeof propData.default.value === 'object') return hasValidStructure;
            }
            return hasValidStructure;
        } catch { return false; }
    }

    // =========================================================================
    // 属性分析
    // =========================================================================

    private analyzeProperty(component: NormalizedComponent, propertyName: string): { exists: boolean; type: string; availableProperties: string[]; originalValue: any } {
        const availableProperties: string[] = [];
        let propertyValue: any = undefined;
        let propertyExists = false;

        // 直接属性检查
        if (Object.prototype.hasOwnProperty.call(component, propertyName)) {
            propertyValue = (component as any)[propertyName];
            propertyExists = true;
        }

        // 在 properties 中搜索
        if (!propertyExists && component.properties && typeof component.properties === 'object') {
            const props = component.properties as Record<string, any>;
            // 兼容 value-wrapped 和直接格式
            const source = (props.value && typeof props.value === 'object' && !Array.isArray(props.value)) ? props.value : props;
            for (const [key, propData] of Object.entries(source)) {
                if (this.isValidPropertyDescriptor(propData)) {
                    availableProperties.push(key);
                    if (key === propertyName) {
                        const propInfo = propData as any;
                        try {
                            propertyValue = Object.keys(propInfo).includes('value') ? propInfo.value : propInfo;
                        } catch { propertyValue = propInfo; }
                        propertyExists = true;
                    }
                }
            }
        }

        // 兜底：直接枚举对象键
        if (availableProperties.length === 0) {
            for (const key of Object.keys(component)) {
                if (!key.startsWith('_') && !['__type__', 'cid', 'node', 'uuid', 'name', 'enabled', 'type', 'readonly', 'visible'].includes(key)) {
                    availableProperties.push(key);
                }
            }
        }

        if (!propertyExists) return { exists: false, type: 'unknown', availableProperties, originalValue: undefined };

        const type = this.inferPropertyType(propertyName, propertyValue);
        return { exists: true, type, availableProperties, originalValue: propertyValue };
    }

    private inferPropertyType(propertyName: string, value: any): string {
        if (Array.isArray(value)) {
            if (propertyName.toLowerCase().includes('node')) return 'nodeArray';
            if (propertyName.toLowerCase().includes('color')) return 'colorArray';
            return 'array';
        }
        if (typeof value === 'string') {
            if (['spriteFrame', 'texture', 'material', 'font', 'clip', 'prefab'].includes(propertyName.toLowerCase())) return 'asset';
            return 'string';
        }
        if (typeof value === 'number') return 'number';
        if (typeof value === 'boolean') return 'boolean';
        if (value && typeof value === 'object') {
            try {
                const keys = Object.keys(value);
                if (keys.includes('r') && keys.includes('g') && keys.includes('b')) return 'color';
                if (keys.includes('x') && keys.includes('y')) return value.z !== undefined ? 'vec3' : 'vec2';
                if (keys.includes('width') && keys.includes('height')) return 'size';
                if (keys.includes('uuid') || keys.includes('__uuid__')) {
                    if (propertyName.toLowerCase().includes('node') || propertyName.toLowerCase().includes('target') || keys.includes('__id__')) return 'node';
                    return 'asset';
                }
                if (keys.includes('__id__')) return 'node';
                return 'object';
            } catch { return 'object'; }
        }
        if (value === null || value === undefined) {
            if (['spriteFrame', 'texture', 'material', 'font', 'clip', 'prefab'].includes(propertyName.toLowerCase())) return 'asset';
            if (propertyName.toLowerCase().includes('node') || propertyName.toLowerCase().includes('target')) return 'node';
            if (propertyName.toLowerCase().includes('component')) return 'component';
            return 'unknown';
        }
        return 'unknown';
    }

    private normalizePropertyType(propertyType: string | undefined, inferredType: string, property: string, value: any): string {
        if (propertyType) return propertyType === 'cameraComponent' ? 'cameraComponent' : propertyType;
        if (inferredType === 'asset' && typeof value === 'string' && property.toLowerCase().includes('component')) return 'component';
        if (property.toLowerCase().includes('cameracomponent')) return 'cameraComponent';
        if (inferredType === 'unknown' && property.toLowerCase().includes('component')) return 'component';
        return inferredType;
    }

    // =========================================================================
    // 值转换
    // =========================================================================

    private processPropertyValue(effectivePropertyType: string, value: unknown, property: string): any {
        switch (effectivePropertyType) {
            case 'string': return String(value);
            case 'number': case 'integer': case 'float': return Number(value);
            case 'boolean': return Boolean(value);
            case 'color':
                if (typeof value === 'string') return this.parseColorString(value);
                if (typeof value === 'object' && value !== null) {
                    const v = value as Record<string, unknown>;
                    return {
                        r: Math.min(255, Math.max(0, Number(v.r) || 0)),
                        g: Math.min(255, Math.max(0, Number(v.g) || 0)),
                        b: Math.min(255, Math.max(0, Number(v.b) || 0)),
                        a: v.a !== undefined ? Math.min(255, Math.max(0, Number(v.a))) : 255,
                    };
                }
                throw new Error('Color value must be an object with r, g, b properties or a hexadecimal string (e.g., "#FF0000")');
            case 'vec2':
                if (typeof value === 'object' && value !== null) {
                    const v = value as Record<string, unknown>;
                    return { x: Number(v.x) || 0, y: Number(v.y) || 0 };
                }
                throw new Error('Vec2 value must be an object with x, y properties');
            case 'vec3':
                if (typeof value === 'object' && value !== null) {
                    const v = value as Record<string, unknown>;
                    return { x: Number(v.x) || 0, y: Number(v.y) || 0, z: Number(v.z) || 0 };
                }
                throw new Error('Vec3 value must be an object with x, y, z properties');
            case 'size':
                if (typeof value === 'object' && value !== null) {
                    const v = value as Record<string, unknown>;
                    return { width: Number(v.width) || 0, height: Number(v.height) || 0 };
                }
                throw new Error('Size value must be an object with width, height properties');
            case 'node':
                if (typeof value === 'string') return { uuid: value };
                throw new Error('Node reference value must be a string UUID');
            case 'component': case 'cameraComponent':
                if (typeof value === 'string') return value;
                throw new Error('Component reference value must be a string UUID');
            case 'spriteFrame': case 'prefab': case 'asset':
                if (typeof value === 'string') return { uuid: value };
                throw new Error(`${effectivePropertyType} value must be a string UUID`);
            case 'nodeArray':
                if (Array.isArray(value)) return value.map((item: any) => {
                    if (typeof item === 'string') return { uuid: item };
                    throw new Error('NodeArray items must be string UUIDs');
                });
                throw new Error('NodeArray value must be an array');
            case 'colorArray':
                if (Array.isArray(value)) return value.map((item: any) => {
                    if (typeof item === 'object' && item !== null && 'r' in item) {
                        return {
                            r: Math.min(255, Math.max(0, Number(item.r) || 0)),
                            g: Math.min(255, Math.max(0, Number(item.g) || 0)),
                            b: Math.min(255, Math.max(0, Number(item.b) || 0)),
                            a: item.a !== undefined ? Math.min(255, Math.max(0, Number(item.a))) : 255,
                        };
                    }
                    return { r: 255, g: 255, b: 255, a: 255 };
                });
                throw new Error('ColorArray value must be an array');
            case 'numberArray':
                if (Array.isArray(value)) return value.map((item: any) => Number(item));
                throw new Error('NumberArray value must be an array');
            case 'stringArray':
                if (Array.isArray(value)) return value.map((item: any) => String(item));
                throw new Error('StringArray value must be an array');
            default:
                throw new Error(`Unsupported property type: ${effectivePropertyType}`);
        }
    }

    private async applyProcessedValue(
        nodeUuid: string, propertyPath: string, effectivePropertyType: string,
        processedValue: any, propertyInfo: { type: string }, componentType: string,
        property: string, rawComponentIndex: number, targetComponent: NormalizedComponent,
        cidMap: Map<string, string>,
    ): Promise<void> {
        if (effectivePropertyType === 'asset' || effectivePropertyType === 'spriteFrame' || effectivePropertyType === 'prefab' ||
            (propertyInfo.type === 'asset' && effectivePropertyType === 'string')) {
            let assetType = 'cc.SpriteFrame';
            if (property.toLowerCase().includes('texture')) assetType = 'cc.Texture2D';
            else if (property.toLowerCase().includes('material')) assetType = 'cc.Material';
            else if (property.toLowerCase().includes('font')) assetType = 'cc.Font';
            else if (property.toLowerCase().includes('clip')) assetType = 'cc.AudioClip';
            else if (effectivePropertyType === 'prefab') assetType = 'cc.Prefab';
            await this.setProperty({ uuid: nodeUuid, path: propertyPath, dump: { value: processedValue, type: assetType } });
        } else if (componentType === 'cc.UITransform' && (property === '_contentSize' || property === 'contentSize')) {
            const width = Number(processedValue?.width) || 100;
            const height = Number(processedValue?.height) || 100;
            await this.setProperty({ uuid: nodeUuid, path: `__comps__.${rawComponentIndex}.width`, dump: { value: width } });
            await this.setProperty({ uuid: nodeUuid, path: `__comps__.${rawComponentIndex}.height`, dump: { value: height } });
        } else if (componentType === 'cc.UITransform' && (property === '_anchorPoint' || property === 'anchorPoint')) {
            const anchorX = Number(processedValue?.x) || 0.5;
            const anchorY = Number(processedValue?.y) || 0.5;
            await this.setProperty({ uuid: nodeUuid, path: `__comps__.${rawComponentIndex}.anchorX`, dump: { value: anchorX } });
            await this.setProperty({ uuid: nodeUuid, path: `__comps__.${rawComponentIndex}.anchorY`, dump: { value: anchorY } });
        } else if (effectivePropertyType === 'color' && processedValue && typeof processedValue === 'object') {
            await this.setProperty({ uuid: nodeUuid, path: propertyPath, dump: { value: processedValue, type: 'cc.Color' } });
        } else if (effectivePropertyType === 'vec3' && processedValue && typeof processedValue === 'object') {
            await this.setProperty({ uuid: nodeUuid, path: propertyPath, dump: { value: processedValue, type: 'cc.Vec3' } });
        } else if (effectivePropertyType === 'vec2' && processedValue && typeof processedValue === 'object') {
            await this.setProperty({ uuid: nodeUuid, path: propertyPath, dump: { value: processedValue, type: 'cc.Vec2' } });
        } else if (effectivePropertyType === 'size' && processedValue && typeof processedValue === 'object') {
            await this.setProperty({ uuid: nodeUuid, path: propertyPath, dump: { value: processedValue, type: 'cc.Size' } });
        } else if (effectivePropertyType === 'node' && processedValue && typeof processedValue === 'object' && 'uuid' in processedValue) {
            await this.setProperty({ uuid: nodeUuid, path: propertyPath, dump: { value: processedValue, type: 'cc.Node' } });
        } else if ((effectivePropertyType === 'component' || effectivePropertyType === 'cameraComponent') && typeof processedValue === 'string') {
            let expectedComponentType = effectivePropertyType === 'cameraComponent' ? 'cc.Camera' : '';
            const propertyMeta = this.getPropertyMetadata(targetComponent, property);
            expectedComponentType = this.inferExpectedComponentType(componentType, property, propertyMeta, expectedComponentType);
            if (!expectedComponentType) throw new Error(`Unable to determine required component type for property '${property}' on component '${componentType}'.`);
            const reference = await this.resolveComponentReference(processedValue, expectedComponentType, cidMap);
            if (!reference) throw new Error(`Unable to resolve component reference '${processedValue}' for property '${property}'.`);
            await this.setProperty({ uuid: nodeUuid, path: propertyPath, dump: { value: { uuid: reference.componentUuid }, type: expectedComponentType } });
        } else if (effectivePropertyType === 'nodeArray' && Array.isArray(processedValue)) {
            await this.setProperty({ uuid: nodeUuid, path: propertyPath, dump: { value: processedValue } });
        } else if (effectivePropertyType === 'colorArray' && Array.isArray(processedValue)) {
            const colorArrayValue = processedValue.map((item: any) => {
                if (item && typeof item === 'object' && 'r' in item) {
                    return {
                        r: Math.min(255, Math.max(0, Number(item.r) || 0)),
                        g: Math.min(255, Math.max(0, Number(item.g) || 0)),
                        b: Math.min(255, Math.max(0, Number(item.b) || 0)),
                        a: item.a !== undefined ? Math.min(255, Math.max(0, Number(item.a))) : 255,
                    };
                }
                return { r: 255, g: 255, b: 255, a: 255 };
            });
            await this.setProperty({ uuid: nodeUuid, path: propertyPath, dump: { value: colorArrayValue, type: 'cc.Color' } });
        } else {
            await this.setProperty({ uuid: nodeUuid, path: propertyPath, dump: { value: processedValue } });
        }
    }

    // =========================================================================
    // 节点属性重定向检查
    // =========================================================================

    private checkAndRedirectNodeProperties(_nodeUuid: string, componentType: string, property: string): ApplyPropertyResult | null {
        const nodeBasicProperties = ['name', 'active', 'layer', 'mobility', 'parent', 'children', 'hideFlags'];
        const nodeTransformProperties = ['position', 'rotation', 'scale', 'eulerAngles', 'angle'];

        if (componentType === 'cc.Node' || componentType === 'Node') {
            if (nodeBasicProperties.includes(property) || nodeTransformProperties.includes(property)) {
                return {
                    success: false,
                    error: `Property '${property}' is a node ${nodeTransformProperties.includes(property) ? 'transform' : 'basic'} property, not a component property`,
                    instruction: `Please use node_modify to set ${nodeTransformProperties.includes(property) ? 'transform' : 'node'} properties.`,
                };
            }
        }

        if (nodeBasicProperties.includes(property) || nodeTransformProperties.includes(property)) {
            return {
                success: false,
                error: `Property '${property}' is a node property, not a component property`,
                instruction: `Property '${property}' should be set using node_modify, not component_modify.`,
            };
        }

        return null;
    }

    // =========================================================================
    // 颜色解析
    // =========================================================================

    private parseColorString(colorStr: string): { r: number; g: number; b: number; a: number } {
        const str = colorStr.trim();
        if (str.startsWith('#')) {
            if (str.length === 7) {
                return {
                    r: parseInt(str.substring(1, 3), 16),
                    g: parseInt(str.substring(3, 5), 16),
                    b: parseInt(str.substring(5, 7), 16),
                    a: 255,
                };
            } else if (str.length === 9) {
                return {
                    r: parseInt(str.substring(1, 3), 16),
                    g: parseInt(str.substring(3, 5), 16),
                    b: parseInt(str.substring(5, 7), 16),
                    a: parseInt(str.substring(7, 9), 16),
                };
            }
        }
        throw new Error(`Invalid color format: "${colorStr}". Only hexadecimal format is supported (e.g., "#FF0000" or "#FF0000FF")`);
    }

    // =========================================================================
    // 组件引用解析
    // =========================================================================

    private async resolveComponentReference(
        referenceUuid: string, expectedComponentType: string, cidMap: Map<string, string>,
    ): Promise<{ componentUuid: string; sourceNodeUuid: string; componentType: string } | null> {
        const expectedAliases = this.getComponentAliases(expectedComponentType, cidMap);
        const isGenericRef = this.isGenericComponentType(expectedComponentType);

        const matchesExpected = (comp: any): boolean => {
            if (isGenericRef) return true;
            const rawType = comp.__type__ || comp.cid || comp.type || 'Unknown';
            const resolved = this.resolveType(rawType, cidMap);
            const rawTypeNormalized = normalizeComponentType(rawType);
            return expectedAliases.has(rawTypeNormalized) || expectedAliases.has(resolved.type);
        };

        // 先按 UUID 直接查找组件
        const directMatch = await this.findComponentByUuid(referenceUuid, matchesExpected, cidMap);
        if (directMatch) return directMatch;

        // 作为 nodeUuid 查找该节点上匹配的组件
        try {
            const targetNodeData = await this.sceneQuery.queryNode(referenceUuid);
            if (targetNodeData && targetNodeData.__comps__) {
                for (const comp of targetNodeData.__comps__) {
                    if (!matchesExpected(comp)) continue;
                    const componentUuid = this.getComponentUuid(comp);
                    if (componentUuid) {
                        const rawType = (comp as any).__type__ || (comp as any).cid || (comp as any).type || 'Unknown';
                        const resolved = this.resolveType(rawType, cidMap);
                        return { componentUuid, sourceNodeUuid: referenceUuid, componentType: resolved.type };
                    }
                }
            }
        } catch { /* fall through to scene scan */ }

        // 全场景扫描
        const nodeUuids = await this.collectSceneNodeUuids();
        for (const nodeUuid of nodeUuids) {
            try {
                const nodeData = await this.sceneQuery.queryNode(nodeUuid);
                if (!nodeData || !nodeData.__comps__) continue;
                for (const comp of nodeData.__comps__) {
                    const componentUuid = this.getComponentUuid(comp);
                    if (!componentUuid || componentUuid !== referenceUuid) continue;
                    if (!matchesExpected(comp)) return null;
                    const rawType = (comp as any).__type__ || (comp as any).cid || (comp as any).type || 'Unknown';
                    const resolved = this.resolveType(rawType, cidMap);
                    return { componentUuid, sourceNodeUuid: nodeUuid, componentType: resolved.type };
                }
            } catch { /* continue scanning */ }
        }

        return null;
    }

    private isGenericComponentType(componentType: string): boolean {
        const normalized = normalizeComponentType(componentType).toLowerCase();
        return normalized === 'cc.component' || normalized === 'component' || normalized === 'cc.object';
    }

    private async findComponentByUuid(
        componentUuid: string, matchesExpected: (comp: any) => boolean, cidMap: Map<string, string>,
    ): Promise<{ componentUuid: string; sourceNodeUuid: string; componentType: string } | null> {
        const nodeUuids = await this.collectSceneNodeUuids();
        for (const nodeUuid of nodeUuids) {
            try {
                const nodeData = await this.sceneQuery.queryNode(nodeUuid);
                if (!nodeData || !nodeData.__comps__) continue;
                for (const comp of nodeData.__comps__) {
                    const currentComponentUuid = this.getComponentUuid(comp);
                    if (!currentComponentUuid || currentComponentUuid !== componentUuid) continue;
                    if (!matchesExpected(comp)) return null;
                    const rawType = (comp as any).__type__ || (comp as any).cid || (comp as any).type || 'Unknown';
                    const resolved = this.resolveType(rawType, cidMap);
                    return { componentUuid: currentComponentUuid, sourceNodeUuid: nodeUuid, componentType: resolved.type };
                }
            } catch { /* continue scanning */ }
        }
        return null;
    }

    private getComponentUuid(component: any): string | null {
        return component?.uuid?.value || component?.uuid || component?.value?.uuid?.value || component?.value?.uuid || null;
    }

    private async collectSceneNodeUuids(): Promise<string[]> {
        try {
            const tree = await this.sceneQuery.queryNodeTree();
            const nodeUuids = new Set<string>();
            const traverse = (node: any) => {
                if (!node) return;
                const uuid = node.uuid?.value || node.uuid || node.value?.uuid?.value || node.value?.uuid;
                if (uuid) nodeUuids.add(String(uuid));
                if (Array.isArray(node.children)) for (const child of node.children) traverse(child);
            };
            if (Array.isArray(tree)) for (const root of tree) traverse(root);
            else traverse(tree);
            return Array.from(nodeUuids);
        } catch { return []; }
    }

    // =========================================================================
    // 属性元数据
    // =========================================================================

    private getPropertyMetadata(component: NormalizedComponent, propertyName: string): any | null {
        if (!component || typeof component !== 'object') return null;
        const props = component.properties as Record<string, any>;
        if (props) {
            if (props.value && typeof props.value === 'object' && props.value[propertyName]) return props.value[propertyName];
            if (props[propertyName]) return props[propertyName];
        }
        if (Object.prototype.hasOwnProperty.call(component, propertyName)) return (component as any)[propertyName];
        return null;
    }

    private inferExpectedComponentType(componentType: string, property: string, propertyMeta: any, fallbackType: string): string {
        let expected = fallbackType;
        if (propertyMeta && typeof propertyMeta === 'object') {
            if (propertyMeta.type) expected = propertyMeta.type;
            else if (propertyMeta.ctor) expected = propertyMeta.ctor;
            else if (propertyMeta.extends && Array.isArray(propertyMeta.extends)) {
                for (const extendType of propertyMeta.extends) {
                    if (extendType.startsWith('cc.') && extendType !== 'cc.Component' && extendType !== 'cc.Object') { expected = extendType; break; }
                }
            }
        }
        if (!expected && property.toLowerCase().includes('component')) expected = 'cc.Component';
        if (!expected && componentType === 'cc.Camera') expected = 'cc.Camera';
        return expected;
    }

}

export function createComponentDriver(profile: RuntimeProfile, sceneQuery: SceneQueryDriver): ComponentBridgeDriver {
    return new EditorComponentDriver(profile, sceneQuery);
}
