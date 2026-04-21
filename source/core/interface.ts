import type { AnimationCapability } from '../capabilities/animation/interface';
import type { AssetCapability } from '../capabilities/asset/interface';
import type { ComponentCapability } from '../capabilities/component/interface';
import type { NodeCapability } from '../capabilities/node/interface';
import type { ProjectCapability } from '../capabilities/project/interface';
import type { PreferencesCapability } from '../capabilities/preferences/interface';
import type { PrefabCapability } from '../capabilities/prefab/interface';
import type { SceneCapability } from '../capabilities/scene/interface';
import type { DebugCapability } from '../capabilities/debug/interface';
import type { AnimationBridgeDriver } from '../drivers/animation/contract';
import type { AssetBridgeDriver } from '../drivers/asset/contract';
import type { ComponentBridgeDriver } from '../drivers/component/contract';
import type { NodeBridgeDriver } from '../drivers/node/contract';
import type { PrefabBridgeDriver } from '../drivers/prefab/contract';
import type { ProjectBridgeDriver } from '../drivers/project/contract';
import type { PreferencesBridgeDriver } from '../drivers/preferences/contract';
import type { SceneBridgeDriver } from '../drivers/scene/contract';
import type { SceneQueryDriver } from '../drivers/scene-query/contract';
import type { DebugBridgeDriver } from '../drivers/debug/contract';
import type { RuntimeProfile } from './profile';

export interface CapabilityRegistry {
    profile: RuntimeProfile;
    asset: AssetCapability;
    component: ComponentCapability;
    node: NodeCapability;
    preferences: PreferencesCapability;
    project: ProjectCapability;
    animation: AnimationCapability;
    prefab: PrefabCapability;
    scene: SceneCapability;
    debug: DebugCapability;
}

export interface CapabilityRegistryOptions {
    profile?: RuntimeProfile;
    sceneQueryDriver?: SceneQueryDriver;
    assetDriver?: AssetBridgeDriver;
    assetCapability?: AssetCapability;
    componentDriver?: ComponentBridgeDriver;
    componentCapability?: ComponentCapability;
    nodeDriver?: NodeBridgeDriver;
    nodeCapability?: NodeCapability;
    preferencesDriver?: PreferencesBridgeDriver;
    preferencesCapability?: PreferencesCapability;
    projectDriver?: ProjectBridgeDriver;
    projectCapability?: ProjectCapability;
    animationDriver?: AnimationBridgeDriver;
    animationCapability?: AnimationCapability;
    prefabDriver?: PrefabBridgeDriver;
    prefabCapability?: PrefabCapability;
    sceneDriver?: SceneBridgeDriver;
    sceneCapability?: SceneCapability;
    debugDriver?: DebugBridgeDriver;
    debugCapability?: DebugCapability;
}
