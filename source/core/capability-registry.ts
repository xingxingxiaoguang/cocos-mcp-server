import { AnimationService } from '../capabilities/animation/service';
import { AssetService } from '../capabilities/asset/service';
import { ComponentService } from '../capabilities/component/service';
import type { ComponentCapability } from '../capabilities/component/interface';
import { NodeService } from '../capabilities/node/service';
import { PrefabService } from '../capabilities/prefab/service';
import { ProjectService } from '../capabilities/project/service';
import { PreferencesService } from '../capabilities/preferences/service';
import { SceneService } from '../capabilities/scene/service';
import { DebugService } from '../capabilities/debug/service';
import { createAnimationDriver } from '../drivers/animation/driver';
import { createAssetDriver } from '../drivers/asset/driver';
import { createComponentDriver } from '../drivers/component/driver';
import { createNodeDriver } from '../drivers/node/driver';
import { createPrefabDriver } from '../drivers/prefab/driver';
import { createProjectDriver } from '../drivers/project/driver';
import { createPreferencesDriver } from '../drivers/preferences/driver';
import { createSceneDriver } from '../drivers/scene/driver';
import { createSceneQueryDriver } from '../drivers/scene-query/driver';
import { createDebugDriver } from '../drivers/debug/driver';
import { createRuntimeProfile, RuntimeProfile } from './profile';
import type { CapabilityRegistry, CapabilityRegistryOptions } from './interface';
export type { CapabilityRegistry, CapabilityRegistryOptions } from './interface';

let defaultRegistry: CapabilityRegistry | null = null;

export function createCapabilityRegistry(options: CapabilityRegistryOptions = {}): CapabilityRegistry {
    const profile = options.profile ?? createRuntimeProfile();
    const sceneQueryDriver = options.sceneQueryDriver ?? createSceneQueryDriver(profile);
    const assetDriver = options.assetDriver ?? createAssetDriver(profile);
    const componentDriver = options.componentDriver ?? createComponentDriver(profile, sceneQueryDriver);
    const nodeDriver = options.nodeDriver ?? createNodeDriver(profile, sceneQueryDriver);
    const preferencesDriver = options.preferencesDriver ?? createPreferencesDriver(profile);
    const projectDriver = options.projectDriver ?? createProjectDriver(profile);
    const animationDriver = options.animationDriver ?? createAnimationDriver(profile);
    const prefabDriver = options.prefabDriver ?? createPrefabDriver(profile);
    const sceneDriver = options.sceneDriver ?? createSceneDriver(profile);
    const debugDriver = options.debugDriver ?? createDebugDriver(profile);
    const componentCapability: ComponentCapability = options.componentCapability ?? new ComponentService(componentDriver);

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
        debug: options.debugCapability ?? new DebugService(debugDriver),
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
