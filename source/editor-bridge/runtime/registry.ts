import { AnimationService } from '../../capabilities/animation/service';
import { AnimationCapability } from '../../capabilities/animation/interface';
import { ProjectService } from '../../capabilities/project/service';
import { ProjectCapability } from '../../capabilities/project/interface';
import { PreferencesService } from '../../capabilities/preferences/service';
import { PreferencesCapability } from '../../capabilities/preferences/interface';
import { AnimationBridgeDriver } from '../animation/contract';
import { createAnimationDriver } from '../animation/driver';
import { ProjectBridgeDriver } from '../project/contract';
import { createProjectDriver } from '../project/driver';
import { PreferencesBridgeDriver } from '../preferences/contract';
import { createPreferencesDriver } from '../preferences/driver';
import { createRuntimeProfile, RuntimeProfile } from './profile';

export interface CapabilityRegistry {
    profile: RuntimeProfile;
    preferences: PreferencesCapability;
    project: ProjectCapability;
    animation: AnimationCapability;
}

interface CapabilityRegistryOptions {
    profile?: RuntimeProfile;
    preferencesDriver?: PreferencesBridgeDriver;
    preferencesCapability?: PreferencesCapability;
    projectDriver?: ProjectBridgeDriver;
    projectCapability?: ProjectCapability;
    animationDriver?: AnimationBridgeDriver;
    animationCapability?: AnimationCapability;
}

let defaultRegistry: CapabilityRegistry | null = null;

export function createCapabilityRegistry(options: CapabilityRegistryOptions = {}): CapabilityRegistry {
    const profile = options.profile ?? createRuntimeProfile();
    const preferencesDriver = options.preferencesDriver ?? createPreferencesDriver(profile);
    const projectDriver = options.projectDriver ?? createProjectDriver(profile);
    const animationDriver = options.animationDriver ?? createAnimationDriver(profile);

    return {
        profile,
        preferences: options.preferencesCapability ?? new PreferencesService(preferencesDriver),
        project: options.projectCapability ?? new ProjectService(projectDriver),
        animation: options.animationCapability ?? new AnimationService(animationDriver),
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
