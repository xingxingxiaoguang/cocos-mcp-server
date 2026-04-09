import { NodeBridgeDriver } from '../../editor-bridge/node/contract';
import { NodeInfo } from './interface';

export function getNodeName(node: any): string {
    if (!node) {
        return 'Unknown';
    }
    if (typeof node === 'string') {
        return node;
    }
    return node.name?.value || node.name || node.value?.name?.value || node.value?.name || 'Unknown';
}

export async function buildCidNameMap(
    driver: Pick<NodeBridgeDriver, 'queryComponentFunctionsOfNode' | 'queryComponents'>,
    cached?: Map<string, string> | null,
): Promise<Map<string, string>> {
    if (cached) {
        return cached;
    }

    const map = new Map<string, string>();

    const collect = (items: any[]) => {
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

export function normalizeComponentType(rawType: any): string {
    if (rawType && typeof rawType === 'object') {
        const nested = rawType.value || rawType.cid || rawType.type || rawType.name;
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

export function resolveComponentType(rawType: any, cidMap: Map<string, string>): string {
    const normalizedType = normalizeComponentType(rawType);
    return cidMap.get(normalizedType) || normalizedType;
}

export function extractComponentEnabled(comp: any): boolean {
    if (comp?.enabled?.value !== undefined) {
        return !!comp.enabled.value;
    }
    if (comp?.enabled !== undefined) {
        return !!comp.enabled;
    }
    return true;
}

export function buildNodeInfo(uuid: string, nodeData: any, cidMap: Map<string, string>): NodeInfo {
    return {
        uuid: nodeData.uuid?.value || uuid,
        name: nodeData.name?.value || 'Unknown',
        active: nodeData.active?.value !== undefined ? nodeData.active.value : true,
        position: nodeData.position?.value || { x: 0, y: 0, z: 0 },
        rotation: nodeData.rotation?.value || { x: 0, y: 0, z: 0 },
        scale: nodeData.scale?.value || { x: 1, y: 1, z: 1 },
        parent: nodeData.parent?.value?.uuid || null,
        children: Array.isArray(nodeData.children)
            ? nodeData.children.map((child: any) => getNodeName(child)).filter(Boolean)
            : [],
        components: (nodeData.__comps__ || []).map((comp: any) => ({
            type: resolveComponentType(comp.__type__ || comp.cid || comp.type, cidMap),
            enabled: extractComponentEnabled(comp),
        })),
        layer: nodeData.layer?.value || 1073741824,
        mobility: nodeData.mobility?.value || 0,
    };
}

export function searchNodeTree(tree: any, pattern: string): Array<{ uuid: string; name: string; path: string }> {
    const nodes: Array<{ uuid: string; name: string; path: string }> = [];
    const normalizedPattern = pattern.toLowerCase();

    const visit = (node: any, currentPath: string = '') => {
        const nodeName = getNodeName(node);
        const nodePath = currentPath ? `${currentPath}/${nodeName}` : nodeName;
        if (nodeName.toLowerCase().includes(normalizedPattern)) {
            nodes.push({
                uuid: node.uuid,
                name: nodeName,
                path: nodePath,
            });
        }

        if (Array.isArray(node?.children)) {
            for (const child of node.children) {
                visit(child, nodePath);
            }
        }
    };

    if (tree) {
        visit(tree);
    }

    return nodes;
}

export function flattenNodeTree(tree: any): Array<{ uuid: string; name: string; type: any; active: any; path: string }> {
    const nodes: Array<{ uuid: string; name: string; type: any; active: any; path: string }> = [];

    const visit = (node: any, currentPath: string = '') => {
        const nodeName = getNodeName(node);
        const nodePath = currentPath ? `${currentPath}/${nodeName}` : nodeName;
        nodes.push({
            uuid: node.uuid,
            name: nodeName,
            type: node.type,
            active: node.active,
            path: nodePath,
        });

        if (Array.isArray(node?.children)) {
            for (const child of node.children) {
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

export function is2DNode(nodeInfo: any): boolean {
    const components = nodeInfo.components || [];

    const has2DComponents = components.some((comp: any) =>
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

    const has3DComponents = components.some((comp: any) =>
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
    return Boolean(position && Math.abs(position.z) < 0.001);
}
