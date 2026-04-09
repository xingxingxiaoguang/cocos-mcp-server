import { RuntimeProfile } from '../../runtime/profile';
import { PreferencesBridgeDriver, PreferencesQueryConfigRequest, PreferencesSetConfigRequest } from './contract';

const PREFERENCES_CHANNEL = 'preferences';

class EditorPreferencesDriver implements PreferencesBridgeDriver {
    constructor(private readonly profile: RuntimeProfile) {}

    async queryConfig(input: PreferencesQueryConfigRequest): Promise<unknown> {
        this.ensureRequestAvailable();
        if (typeof input.path === 'string' && input.path.length > 0) {
            return this.request('query-config', input.name, input.path, input.type);
        }

        return this.request('query-config', input.name, input.type);
    }

    async setConfig(input: PreferencesSetConfigRequest): Promise<boolean> {
        this.ensureFeatureAvailable('preferencesSetConfig');
        return this.request('set-config', input.name, input.path, input.value, input.type);
    }

    async openSettings(tab?: string): Promise<void> {
        this.ensureFeatureAvailable('preferencesOpenSettings');
        if (tab) {
            await this.request('open-settings', tab);
            return;
        }
        await this.request('open-settings');
    }

    private ensureRequestAvailable(): void {
        const request = (globalThis as any).Editor?.Message?.request;
        if (typeof request !== 'function') {
            throw new Error('Editor.Message.request is unavailable in the current runtime');
        }
    }

    private ensureFeatureAvailable(feature: keyof RuntimeProfile['features']): void {
        this.ensureRequestAvailable();
        if (!this.profile.features[feature]) {
            throw new Error(`Runtime profile does not support '${feature}'`);
        }
    }

    private async request<T>(message: string, ...args: unknown[]): Promise<T> {
        const request = (globalThis as any).Editor.Message.request as (
            channel: string,
            message: string,
            ...payload: unknown[]
        ) => Promise<T>;
        return request(PREFERENCES_CHANNEL, message, ...args);
    }
}

export function createPreferencesDriver(profile: RuntimeProfile): PreferencesBridgeDriver {
    return new EditorPreferencesDriver(profile);
}
