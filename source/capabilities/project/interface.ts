import { JsonValue } from '../../json';

export type ProjectSettingsCategory = 'general' | 'physics' | 'render' | 'assets' | 'all' | string;

export interface ProjectCapability {
    queryInfo(): Promise<QueryProjectInfoResult>;
    querySettings(input: QueryProjectSettingsInput): Promise<QueryProjectSettingsResult>;
}

export interface QueryProjectInfoResult {
    name: string;
    path: string;
    uuid: string;
    version: string;
    cocosVersion: string;
    config?: JsonValue;
}

export interface QueryProjectSettingsInput {
    category?: ProjectSettingsCategory;
}

export interface QueryProjectSettingsResult {
    category: string;
    config: JsonValue;
    message: string;
    source: string;
}
