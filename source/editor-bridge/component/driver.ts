import { RuntimeProfile } from '../../runtime/profile';
import {
    ComponentBridgeDriver,
    ComponentCreateInput,
    ComponentCreateResult,
    ComponentMethodInput,
    ComponentResetInput,
    ComponentSetPropertyInput,
    RemoveArrayElementInput,
} from './contract';

const SCENE_CHANNEL = 'scene';

class EditorComponentDriver implements ComponentBridgeDriver {
    constructor(private readonly profile: RuntimeProfile) {}

    async createComponent(input: ComponentCreateInput): Promise<ComponentCreateResult> {
        this.ensureAvailable();
        const result = await this.request('create-component', input);
        return (result ?? {}) as ComponentCreateResult;
    }

    async removeArrayElement(input: RemoveArrayElementInput): Promise<void> {
        this.ensureAvailable();
        await this.request('remove-array-element', input);
    }

    async resetComponent(input: ComponentResetInput): Promise<void> {
        this.ensureAvailable();
        await this.request('reset-component', input);
    }

    async executeComponentMethod(input: ComponentMethodInput): Promise<unknown> {
        this.ensureAvailable();
        return this.request('execute-component-method', input);
    }

    async setProperty(input: ComponentSetPropertyInput): Promise<void> {
        this.ensureAvailable();
        await this.request('set-property', input);
    }

    // -------------------------------------------------------------------------

    private async request(message: string, ...args: unknown[]): Promise<unknown> {
        const request = (globalThis as any).Editor.Message.request as (
            targetChannel: string,
            targetMessage: string,
            ...payload: unknown[]
        ) => Promise<unknown>;
        return request(SCENE_CHANNEL, message, ...args);
    }

    private ensureAvailable(): void {
        const request = (globalThis as any).Editor?.Message?.request;
        if (typeof request !== 'function' || !this.profile.features.sceneQueryNodeTree) {
            throw new Error('Editor.Message.request is unavailable in the current runtime');
        }
    }
}

export function createComponentDriver(profile: RuntimeProfile): ComponentBridgeDriver {
    return new EditorComponentDriver(profile);
}
