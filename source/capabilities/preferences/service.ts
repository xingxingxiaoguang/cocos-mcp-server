import { JsonValue } from '../../utils/json';
import { safeSerialize } from '../../utils/serializer';
import { PreferencesBridgeDriver } from '../../drivers/preferences/contract';
import {
    ExportPreferencesResult,
    OpenPreferencesInput,
    PreferenceMutationResult,
    PreferencesCapability,
    PreferencesScope,
    QueryAllPreferencesResult,
    QueryPreferencesInput,
    QueryPreferencesResult,
    ResetPreferenceInput,
    SetPreferenceInput,
} from './interface';

const DEFAULT_SCOPE: PreferencesScope = 'global';
const DEFAULT_PREFERENCE_CATEGORIES = [
    'general',
    'external-tools',
    'data-editor',
    'laboratory',
    'extensions',
    'preview',
    'console',
    'native',
    'builder',
] as const;

export class PreferencesService implements PreferencesCapability {
    constructor(
        private readonly driver: PreferencesBridgeDriver,
        private readonly categories: readonly string[] = DEFAULT_PREFERENCE_CATEGORIES,
    ) {}

    async query(input: QueryPreferencesInput): Promise<QueryPreferencesResult> {
        const type = this.normalizeScope(input.type);

        if (input.name) {
            const config = await this.driver.queryConfig({
                name: input.name,
                path: input.path,
                type,
            });

            return {
                mode: 'single',
                target: {
                    name: input.name,
                    path: input.path,
                    type,
                },
                config: this.serialize(config),
            };
        }

        return this.queryAll(type);
    }

    async set(input: SetPreferenceInput): Promise<PreferenceMutationResult> {
        const type = this.normalizeScope(input.type);
        const success = await this.driver.setConfig({
            name: input.name,
            path: input.path,
            value: input.value,
            type,
        });

        if (!success) {
            throw new Error(`Failed to update preference '${input.name}.${input.path}'`);
        }

        return {
            action: 'set',
            message: `Preference '${input.name}.${input.path}' updated successfully`,
            target: {
                name: input.name,
                path: input.path,
                type,
            },
        };
    }

    async reset(input: ResetPreferenceInput): Promise<PreferenceMutationResult> {
        const type = this.normalizeScope(input.type);
        const defaultConfig = await this.driver.queryConfig({
            name: input.name,
            type: 'default',
        });
        const success = await this.driver.setConfig({
            name: input.name,
            path: '',
            value: defaultConfig,
            type,
        });

        if (!success) {
            throw new Error(`Failed to reset preference category '${input.name}'`);
        }

        return {
            action: 'reset',
            message: `Preference category '${input.name}' reset to default`,
            target: {
                name: input.name,
                type,
            },
        };
    }

    async open(input: OpenPreferencesInput): Promise<PreferenceMutationResult> {
        await this.driver.openSettings(input.tab);
        return {
            action: 'open',
            message: `Preferences settings opened${input.tab ? ` on tab: ${input.tab}` : ''}`,
        };
    }

    async export(): Promise<ExportPreferencesResult> {
        const queryResult = await this.queryAll(DEFAULT_SCOPE);
        return {
            categories: queryResult.categories,
            preferences: queryResult.preferences,
            jsonData: JSON.stringify(queryResult.preferences, null, 2),
            message: 'Preferences exported successfully',
        };
    }

    private async queryAll(type: PreferencesScope): Promise<QueryAllPreferencesResult> {
        const preferences: Record<string, JsonValue> = {};

        await Promise.all(this.categories.map(async (category) => {
            try {
                const config = await this.driver.queryConfig({ name: category, type });
                preferences[category] = this.serialize(config);
            } catch {
                // Best-effort aggregation. Missing categories are omitted from the result.
            }
        }));

        return {
            mode: 'all',
            categories: Object.keys(preferences),
            preferences,
        };
    }

    private normalizeScope(type?: PreferencesScope): PreferencesScope {
        return type === 'default' || type === 'local' ? type : DEFAULT_SCOPE;
    }

    private serialize(value: unknown): JsonValue {
        return safeSerialize(value) as JsonValue;
    }
}
