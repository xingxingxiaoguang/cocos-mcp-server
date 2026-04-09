import { NodeBridgeDriver } from '../../editor-bridge/node/contract';

export async function resolveSpriteFrameUuidFromAssetInfo(
    driver: Pick<NodeBridgeDriver, 'queryAssetUrl'>,
    assetInfo: any,
): Promise<string | null> {
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
        const spriteFrameUrl = await driver.queryAssetUrl(spriteFrameUuid);
        if (spriteFrameUrl) {
            return spriteFrameUuid;
        }
    } catch {
    }

    return null;
}

export async function resolveDefaultSpriteFrameUuid(
    driver: Pick<NodeBridgeDriver, 'queryAssetInfo' | 'queryAssets' | 'queryAssetUrl'>,
): Promise<string | null> {
    const candidates = [
        'db://internal/default_ui/default_sprite.png',
        'db://internal/default_ui/default_sprite/default_sprite.spriteframe',
        'db://internal/default_ui/default_sprite',
        'db://internal/default_ui/default_sprite.spriteframe',
        'db://internal/default_ui/default_sprite/default_sprite',
    ];

    for (const candidate of candidates) {
        try {
            const assetInfo: any = await driver.queryAssetInfo(candidate);
            if (assetInfo && assetInfo.uuid) {
                const resolvedUuid = await resolveSpriteFrameUuidFromAssetInfo(driver, assetInfo);
                if (resolvedUuid) {
                    return resolvedUuid;
                }
            }
        } catch {
        }
    }

    const searchPatterns = [
        'db://internal/**/default_sprite*',
        'db://internal/**/*default_sprite*.spriteframe',
        'db://internal/default_ui/**/*spriteframe',
    ];

    for (const pattern of searchPatterns) {
        try {
            const assets: any = await driver.queryAssets({ pattern });
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
        }
    }

    return null;
}
