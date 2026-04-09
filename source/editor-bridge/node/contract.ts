export interface NodeBridgeDriver {
    queryNode(uuid: string): Promise<any>;
    queryNodeTree(): Promise<any>;
    executeSceneScript(options: Record<string, unknown>): Promise<any>;
    queryNodesByAssetUuid(assetUuid: string): Promise<any>;
    queryComponentFunctionsOfNode(nodeUuid: string): Promise<any>;
    queryComponents(): Promise<any>;
    queryCurrentScene(): Promise<any>;

    queryAssetInfo(assetPath: string): Promise<any>;
    queryAssets(query: Record<string, unknown>): Promise<any>;
    queryAssetUrl(uuid: string): Promise<any>;

    createNode(options: Record<string, unknown>): Promise<any>;
    setParent(payload: Record<string, unknown>): Promise<any>;
    setProperty(payload: Record<string, unknown>): Promise<any>;
    resetProperty(payload: Record<string, unknown>): Promise<any>;
    resetNode(payload: Record<string, unknown>): Promise<any>;
    removeNode(payload: Record<string, unknown>): Promise<any>;
    duplicateNode(uuid: string): Promise<any>;
    copyNode(uuids: string | string[]): Promise<any>;
    pasteNode(payload: Record<string, unknown>): Promise<any>;
    cutNode(uuids: string | string[]): Promise<any>;
}
