import { JsonValue } from '../../utils/json';

export interface ProjectCapability {
    // Queries
    queryInfo(): Promise<QueryProjectInfoResult>;
    querySettings(input: QueryProjectSettingsInput): Promise<QueryProjectSettingsResult>;
}

// ---------------------------------------------------------------------------
// Query results
// ---------------------------------------------------------------------------

export type ProjectSettingsCategory = 'general' | 'physics' | 'render' | 'assets' | 'all' | string;

export interface QueryProjectInfoResult {
    name: string;
    path: string;
    uuid: string;
    version: string;
    cocosVersion: string;
    config?: JsonValue;
}

export interface QueryProjectSettingsResult {
    category: string;
    config: JsonValue;
    message: string;
    source: string;
}

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export interface QueryProjectSettingsInput {
    category?: ProjectSettingsCategory;
}
