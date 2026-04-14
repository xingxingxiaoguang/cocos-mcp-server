import { BaseDriver } from '../base-driver';
import { RuntimeProfile } from '../../runtime/profile';
import { PreferencesBridgeDriver, PreferencesQueryConfigRequest, PreferencesSetConfigRequest } from './contract';

class EditorPreferencesDriver extends BaseDriver implements PreferencesBridgeDriver {

    async queryConfig(input: PreferencesQueryConfigRequest): Promise<unknown> {
        this.ensureRequestAvailable();
        if (typeof input.path === 'string' && input.path.length > 0) {
            return this.request('preferences', 'query-config', input.name, input.path, input.type);
        }

        return this.request('preferences', 'query-config', input.name, input.type);
    }

    async setConfig(input: PreferencesSetConfigRequest): Promise<boolean> {
        this.ensureFeatureAvailable('preferencesSetConfig');
        return this.request('preferences', 'set-config', input.name, input.path, input.value, input.type);
    }

    async openSettings(tab?: string): Promise<void> {
        this.ensureFeatureAvailable('preferencesOpenSettings');
        if (tab) {
            await this.request('preferences', 'open-settings', tab);
            return;
        }
        await this.request('preferences', 'open-settings');
    }
}

export function createPreferencesDriver(profile: RuntimeProfile): PreferencesBridgeDriver {
    return new EditorPreferencesDriver(profile);
}
