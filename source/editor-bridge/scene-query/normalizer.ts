import {
    CocosComponentRef,
    CocosNodeDump,
    ComponentFunctionRecord,
    ComponentInfo,
    ComponentTypeRecord,
    NodeInfo,
    SceneQueryDriver,
} from './contract';

export function getNodeName(node: unknown): string {
    if (!node) {
        return 'Unknown';
    }
    if (typeof node === 'string') {
        return node;
    }
    const n = node as Record<string, unknown>;
    const name = n.name;
    if (name && typeof name === 'object') {
        const nameObj = name as Record<string, unknown>;
        if (typeof nameObj.value === 'string') return nameObj.value;
    }
    if (typeof name === 'string') return name;
    return 'Unknown';
}

export async function buildCidNameMap(
    driver: Pick<SceneQueryDriver, 'queryComponentFunctionsOfNode' | 'queryComponents'>,
    cached?: Map<string, string> | null,
): Promise<Map<string, string>> {
    if (cached) {
        return cached;
    }

    const map = new Map<string, string>();

    const collect = (items: Array<ComponentTypeRecord | ComponentFunctionRecord>) => {
        for (const item of items) {
            if (item && item.cid && item.name) {
                map.set(String(item.cid), String(item.name));
            }
        }
    };

    try {
        const result = await driver.queryComponentFunctionsOfNode('');
        if (Array.isArray(result)) {
            collect(result);
        }
    } catch {
    }

    if (map.size === 0) {
        try {
            const result = await driver.queryComponents();
            if (Array.isArray(result)) {
                collect(result);
            }
        } catch {
        }
    }

    return map;
}

export function normalizeComponentType(rawType: unknown): string {
    if (rawType && typeof rawType === 'object' && !Array.isArray(rawType)) {
        const obj = rawType as Record<string, unknown>;
        const nested = obj.value ?? obj.cid ?? obj.type ?? obj.name;
        if (nested !== undefined && nested !== null) {
            if (typeof nested === 'object') {
                return normalizeComponentType(nested);
            }
            return String(nested);
        }
    }
    if (rawType === undefined || rawType === null) {
        return 'Unknown';
    }
    return String(rawType);
}

export function resolveComponentType(rawType: unknown, cidMap: Map<string, string>): string {
    const normalizedType = normalizeComponentType(rawType);
    return cidMap.get(normalizedType) || normalizedType;
}

export function extractComponentEnabled(comp: CocosComponentRef): boolean {
    if (comp?.enabled?.value !== undefined) {
        return Boolean(comp.enabled.value);
    }
    return true;
}

export function buildNodeInfo(uuid: string, nodeData: CocosNodeDump, cidMap: Map<string, string>): NodeInfo {
    const children: string[] = [];
    if (Array.isArray(nodeData.children)) {
        for (const child of nodeData.children) {
            const childName = child?.name?.value;
            if (childName) children.push(childName);
        }
    }

    const components: ComponentInfo[] = (nodeData.__comps__ ?? []).map((comp) => ({
        type: resolveComponentType(comp.__type__ ?? comp.cid ?? comp.type, cidMap),
        enabled: extractComponentEnabled(comp),
    }));

    return {
        uuid:     nodeData.uuid?.value || uuid,
        name:     nodeData.name?.value || 'Unknown',
        active:   nodeData.active?.value !== undefined ? nodeData.active.value : true,
        position: nodeData.position?.value ?? { x: 0, y: 0, z: 0 },
        rotation: nodeData.rotation?.value ?? { x: 0, y: 0, z: 0 },
        scale:    nodeData.scale?.value    ?? { x: 1, y: 1, z: 1 },
        parent:   (nodeData.parent?.value as { uuid?: { value?: string } } | null)?.uuid?.value ?? null,
        children,
        components,
        layer:    nodeData.layer?.value    ?? 1073741824,
        mobility: nodeData.mobility?.value ?? 0,
    };
}

export function searchNodeTree(
    tree: unknown,
    pattern: string,
): Array<{ uuid: string; name: string; path: string }> {
    const nodes: Array<{ uuid: string; name: string; path: string }> = [];
    const normalizedPattern = pattern.toLowerCase();

    const visit = (node: unknown, currentPath: string = '') => {
        if (!node || typeof node !== 'object') return;
        const n = node as Record<string, unknown>;
        const nodeName = getNodeName(node);
        const nodePath = currentPath ? `${currentPath}/${nodeName}` : nodeName;
        if (nodeName.toLowerCase().includes(normalizedPattern)) {
            nodes.push({ uuid: String(n.uuid ?? ''), name: nodeName, path: nodePath });
        }
        if (Array.isArray(n.children)) {
            for (const child of n.children) {
                visit(child, nodePath);
            }
        }
    };

    if (tree) {
        visit(tree);
    }

    return nodes;
}

export function flattenNodeTree(
    tree: unknown,
): Array<{ uuid: string; name: string; type: unknown; active: unknown; path: string }> {
    const nodes: Array<{ uuid: string; name: string; type: unknown; active: unknown; path: string }> = [];

    const visit = (node: unknown, currentPath: string = '') => {
        if (!node || typeof node !== 'object') return;
        const n = node as Record<string, unknown>;
        const nodeName = getNodeName(node);
        const nodePath = currentPath ? `${currentPath}/${nodeName}` : nodeName;
        nodes.push({ uuid: String(n.uuid ?? ''), name: nodeName, type: n.type, active: n.active, path: nodePath });
        if (Array.isArray(n.children)) {
            for (const child of n.children) {
                visit(child, nodePath);
            }
        }
    };

    if (Array.isArray(tree)) {
        for (const root of tree) {
            visit(root);
        }
    } else if (tree) {
        visit(tree);
    }

    return nodes;
}

export function is2DNode(nodeInfo: NodeInfo): boolean {
    const components = nodeInfo.components ?? [];

    const has2DComponents = components.some((comp) =>
        comp.type && (
            comp.type.includes('cc.Sprite')
            || comp.type.includes('cc.Label')
            || comp.type.includes('cc.Button')
            || comp.type.includes('cc.Layout')
            || comp.type.includes('cc.Widget')
            || comp.type.includes('cc.Mask')
            || comp.type.includes('cc.Graphics')
        )
    );

    if (has2DComponents) {
        return true;
    }

    const has3DComponents = components.some((comp) =>
        comp.type && (
            comp.type.includes('cc.MeshRenderer')
            || comp.type.includes('cc.Camera')
            || comp.type.includes('cc.Light')
            || comp.type.includes('cc.DirectionalLight')
            || comp.type.includes('cc.PointLight')
            || comp.type.includes('cc.SpotLight')
        )
    );

    if (has3DComponents) {
        return false;
    }

    const position = nodeInfo.position;
    return Boolean(position && Math.abs(position.z ?? 0) < 0.001);
}
