export type PreferencesScopeValue = 'default' | 'global' | 'local';

export interface PreferencesQueryConfigRequest {
    name: string;
    path?: string;
    type: PreferencesScopeValue;
}

export interface PreferencesSetConfigRequest {
    name: string;
    path: string;
    value: unknown;
    type: PreferencesScopeValue;
}

export interface PreferencesBridgeDriver {
    queryConfig(input: PreferencesQueryConfigRequest): Promise<unknown>;
    setConfig(input: PreferencesSetConfigRequest): Promise<boolean>;
    openSettings(tab?: string): Promise<void>;
}
