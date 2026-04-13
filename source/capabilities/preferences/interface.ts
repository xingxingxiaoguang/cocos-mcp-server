import { JsonValue } from '../../json';

export interface PreferencesCapability {
    // Queries
    query(input: QueryPreferencesInput): Promise<QueryPreferencesResult>;
    export(): Promise<ExportPreferencesResult>;

    // Mutations
    set(input: SetPreferenceInput): Promise<PreferenceMutationResult>;
    reset(input: ResetPreferenceInput): Promise<PreferenceMutationResult>;
    open(input: OpenPreferencesInput): Promise<PreferenceMutationResult>;
}

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

export type PreferencesScope = 'default' | 'global' | 'local';

export interface PreferencesTarget {
    name: string;
    path?: string;
    type: PreferencesScope;
}

// ---------------------------------------------------------------------------
// Query results
// ---------------------------------------------------------------------------

export interface QuerySinglePreferenceResult {
    mode: 'single';
    target: PreferencesTarget;
    config: JsonValue;
}

export interface QueryAllPreferencesResult {
    mode: 'all';
    categories: string[];
    preferences: Record<string, JsonValue>;
}

export type QueryPreferencesResult = QuerySinglePreferenceResult | QueryAllPreferencesResult;

export interface ExportPreferencesResult {
    preferences: Record<string, JsonValue>;
    categories: string[];
    jsonData: string;
    message: string;
}

// ---------------------------------------------------------------------------
// Mutation results
// ---------------------------------------------------------------------------

export interface PreferenceMutationResult {
    action: 'set' | 'reset' | 'open';
    message: string;
    target?: PreferencesTarget;
}

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export interface QueryPreferencesInput {
    name?: string;
    path?: string;
    type?: PreferencesScope;
}

export interface SetPreferenceInput {
    name: string;
    path: string;
    value: unknown;
    type?: PreferencesScope;
}

export interface ResetPreferenceInput {
    name: string;
    type?: PreferencesScope;
}

export interface OpenPreferencesInput {
    tab?: string;
}
