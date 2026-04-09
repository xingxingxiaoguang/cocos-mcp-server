/**
 * 递归按 UUID 查找节点（修复缺陷2：getChildByUuid 只搜索顶层子节点）
 */
export function findNodeByUuid(root: any, uuid: string): any {
    if (root.uuid === uuid) return root;
    for (const child of root.children) {
        const found = findNodeByUuid(child, uuid);
        if (found) return found;
    }
    return null;
}
