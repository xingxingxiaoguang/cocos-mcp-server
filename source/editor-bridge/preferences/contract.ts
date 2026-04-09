import { PreferencesScope } from '../../capabilities/preferences/interface';

export interface PreferencesQueryConfigRequest {
    name: string;
    path?: string;
    type: PreferencesScope;
}

export interface PreferencesSetConfigRequest {
    name: string;
    path: string;
    value: unknown;
    type: PreferencesScope;
}

export interface PreferencesBridgeDriver {
    queryConfig(input: PreferencesQueryConfigRequest): Promise<unknown>;
    setConfig(input: PreferencesSetConfigRequest): Promise<boolean>;
    openSettings(tab?: string): Promise<void>;
}
