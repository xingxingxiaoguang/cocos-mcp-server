export interface AssetBridgeDriver {
    requestAssetDb(message: string, ...args: unknown[]): Promise<any>;
}
