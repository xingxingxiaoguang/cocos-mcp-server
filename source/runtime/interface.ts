import type { AnimationCapability } from '../capabilities/animation/interface';
import type { AssetCapability } from '../capabilities/asset/interface';
import type { ComponentCapability } from '../capabilities/component/interface';
import type { NodeCapability } from '../capabilities/node/interface';
import type { ProjectCapability } from '../capabilities/project/interface';
import type { PreferencesCapability } from '../capabilities/preferences/interface';
import type { PrefabCapability } from '../capabilities/prefab/interface';
import type { SceneCapability } from '../capabilities/scene/interface';
import type { AnimationBridgeDriver } from '../editor-bridge/animation/contract';
import type { AssetBridgeDriver } from '../editor-bridge/asset/contract';
import type { ComponentBridgeDriver } from '../editor-bridge/component/contract';
import type { NodeBridgeDriver } from '../editor-bridge/node/contract';
import type { PrefabBridgeDriver } from '../editor-bridge/prefab/contract';
import type { ProjectBridgeDriver } from '../editor-bridge/project/contract';
import type { PreferencesBridgeDriver } from '../editor-bridge/preferences/contract';
import type { SceneBridgeDriver } from '../editor-bridge/scene/contract';
import type { SceneQueryDriver } from '../editor-bridge/scene-query/contract';
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
}
