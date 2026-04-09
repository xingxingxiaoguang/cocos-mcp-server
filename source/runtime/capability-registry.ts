import { AnimationService } from '../capabilities/animation/service';
import { AssetService } from '../capabilities/asset/service';
import { ComponentService } from '../capabilities/component/service';
import { NodeService } from '../capabilities/node/service';
import { PrefabService } from '../capabilities/prefab/service';
import { ProjectService } from '../capabilities/project/service';
import { PreferencesService } from '../capabilities/preferences/service';
import { SceneService } from '../capabilities/scene/service';
import { createAnimationDriver } from '../editor-bridge/animation/driver';
import { createAssetDriver } from '../editor-bridge/asset/driver';
import { createComponentDriver } from '../editor-bridge/component/driver';
import { createNodeDriver } from '../editor-bridge/node/driver';
import { createPrefabDriver } from '../editor-bridge/prefab/driver';
import { createProjectDriver } from '../editor-bridge/project/driver';
import { createPreferencesDriver } from '../editor-bridge/preferences/driver';
import { createSceneDriver } from '../editor-bridge/scene/driver';
import { createRuntimeProfile, RuntimeProfile } from './profile';
import type { CapabilityRegistry, CapabilityRegistryOptions } from './interface';
export type { CapabilityRegistry, CapabilityRegistryOptions } from './interface';

let defaultRegistry: CapabilityRegistry | null = null;

export function createCapabilityRegistry(options: CapabilityRegistryOptions = {}): CapabilityRegistry {
    const profile = options.profile ?? createRuntimeProfile();
    const assetDriver = options.assetDriver ?? createAssetDriver(profile);
    const componentDriver = options.componentDriver ?? createComponentDriver(profile);
    const nodeDriver = options.nodeDriver ?? createNodeDriver(profile);
    const preferencesDriver = options.preferencesDriver ?? createPreferencesDriver(profile);
    const projectDriver = options.projectDriver ?? createProjectDriver(profile);
    const animationDriver = options.animationDriver ?? createAnimationDriver(profile);
    const prefabDriver = options.prefabDriver ?? createPrefabDriver(profile);
    const sceneDriver = options.sceneDriver ?? createSceneDriver(profile);
    const componentCapability = options.componentCapability ?? new ComponentService(componentDriver);

    return {
        profile,
        asset: options.assetCapability ?? new AssetService(assetDriver),
        component: componentCapability,
        node: options.nodeCapability ?? new NodeService(nodeDriver, componentCapability),
        preferences: options.preferencesCapability ?? new PreferencesService(preferencesDriver),
        project: options.projectCapability ?? new ProjectService(projectDriver),
        animation: options.animationCapability ?? new AnimationService(animationDriver),
        prefab: options.prefabCapability ?? new PrefabService(prefabDriver),
        scene: options.sceneCapability ?? new SceneService(sceneDriver),
    };
}

export function getCapabilityRegistry(): CapabilityRegistry {
    if (!defaultRegistry) {
        defaultRegistry = createCapabilityRegistry();
    }

    return defaultRegistry;
}

export function resetCapabilityRegistry(): void {
    defaultRegistry = null;
}
