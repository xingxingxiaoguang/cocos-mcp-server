export interface ComponentBridgeDriver {
    queryComponentFunctionsOfNode(nodeUuid: string): Promise<any>;
    queryComponents(): Promise<any>;
    queryNode(nodeUuid: string): Promise<any>;
    queryNodeTree(): Promise<any>;
    executeSceneScript(options: Record<string, unknown>): Promise<any>;
    createComponent(payload: Record<string, unknown>): Promise<any>;
    removeArrayElement(payload: Record<string, unknown>): Promise<any>;
    resetComponent(payload: Record<string, unknown>): Promise<any>;
    executeComponentMethod(payload: Record<string, unknown>): Promise<any>;
    setProperty(payload: Record<string, unknown>): Promise<any>;
    queryAssetInfo(assetPath: string): Promise<any>;
    queryAssets(query: Record<string, unknown>): Promise<any>;
    queryAssetUrl(uuid: string): Promise<any>;
}
