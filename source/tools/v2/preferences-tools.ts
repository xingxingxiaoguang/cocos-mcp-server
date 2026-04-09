import { PreferencesScope } from '../../capabilities/preferences/interface';
import { getCapabilityRegistry } from '../../runtime/capability-registry';
import { BaseToolExecutor, ToolHandler } from '../base-tool';
import { ToolDefinition, ToolResponse } from '../../mcp/interface';
import { makeError, ToolErrorCode } from '../../utils/error-codes';

/**
 * PreferencesToolsV2 — 偏好设置工具 v2
 * 合并自 PreferencesTools
 * 2 个工具: query, modify
 */
export class PreferencesToolsV2 extends BaseToolExecutor {
    private readonly preferences = getCapabilityRegistry().preferences;

    protected readonly handlers: Record<string, ToolHandler> = {
        query: async (args: any) => this.handleQuery(args),
        modify: async (args: any) => this.handleModify(args),
    };

    getTools(): ToolDefinition[] {
        return [
            {
                name: 'query',
                description: 'Query preferences configuration. Provide name to query specific category, or omit to get all preferences.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        name: { type: 'string', description: 'Preference category name (e.g. general, external-tools)' },
                        path: { type: 'string', description: 'Configuration path within the category' },
                        type: { type: 'string', enum: ['default', 'global', 'local'], description: 'Configuration type. Default: global' }
                    }
                }
            },
            {
                name: 'modify',
                description: 'Modify preferences. action=set: set preference value. action=reset: reset to defaults. action=open: open preferences panel. action=export: export preferences. action=import: import preferences.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        action: {
                            type: 'string',
                            enum: ['set', 'reset', 'open', 'export', 'import'],
                            description: 'Operation type'
                        },
                        name: { type: 'string', description: 'Preference category name' },
                        path: { type: 'string', description: 'Configuration path' },
                        value: { description: 'Value for action=set' },
                        type: { type: 'string', enum: ['default', 'global', 'local'], description: 'Configuration type' },
                        tab: { type: 'string', description: 'Tab name for action=open' },
                        configJson: { type: 'string', description: 'Configuration JSON string for action=import' }
                    },
                    required: ['action']
                }
            }
        ];
    }

    // ==================== query ====================

    private async handleQuery(args: any): Promise<ToolResponse> {
        const result = await this.preferences.query({
            name: this.optionalTrimmedString(args?.name),
            path: this.optionalTrimmedString(args?.path),
            type: this.normalizeScope(args?.type),
        });

        if (result.mode === 'single') {
            return {
                success: true,
                data: {
                    name: result.target.name,
                    path: result.target.path,
                    type: result.target.type,
                    config: result.config,
                },
            };
        }

        return {
            success: true,
            data: {
                categories: result.categories,
                preferences: result.preferences,
            },
        };
    }

    // ==================== modify ====================

    private async handleModify(args: any): Promise<ToolResponse> {
        const action = typeof args?.action === 'string' ? args.action : '';

        switch (action) {
            case 'set':
                return await this.setPreferencesConfig(args.name, args.path, args.value, args.type);
            case 'reset':
                return await this.resetPreferences(args.name, args.type);
            case 'open':
                return await this.openPreferencesSettings(args.tab || args.name);
            case 'export':
                return await this.exportPreferences();
            case 'import':
                return await this.importPreferences(args.configJson);
            default:
                return makeError(ToolErrorCode.INVALID_ARGS, `Unknown modify action: ${action || 'undefined'}`);
        }
    }

    private async setPreferencesConfig(name: string, path: string, value: any, type: string = 'global'): Promise<ToolResponse> {
        const normalizedName = this.requireTrimmedString(name, 'name');
        if (!normalizedName.success) {
            return normalizedName.response;
        }

        const normalizedPath = this.requireTrimmedString(path, 'path');
        if (!normalizedPath.success) {
            return normalizedPath.response;
        }

        const result = await this.preferences.set({
            name: normalizedName.value,
            path: normalizedPath.value,
            value,
            type: this.normalizeScope(type),
        });

        return {
            success: true,
            message: result.message,
        };
    }

    private async resetPreferences(name?: string, type: string = 'global'): Promise<ToolResponse> {
        const normalizedName = this.requireTrimmedString(name, 'name');
        if (!normalizedName.success) {
            return makeError(
                ToolErrorCode.MISSING_REQUIRED,
                'Resetting all preferences is not supported. Please specify a preference category.',
            );
        }

        const result = await this.preferences.reset({
            name: normalizedName.value,
            type: this.normalizeScope(type),
        });

        return {
            success: true,
            message: result.message,
        };
    }

    private async openPreferencesSettings(tab?: string): Promise<ToolResponse> {
        const result = await this.preferences.open({
            tab: this.optionalTrimmedString(tab),
        });

        return {
            success: true,
            message: result.message,
        };
    }

    private async exportPreferences(): Promise<ToolResponse> {
        const prefsResult = await this.preferences.export();
        return {
            success: true,
            data: {
                categories: prefsResult.categories,
                preferences: prefsResult.preferences,
                jsonData: prefsResult.jsonData,
                message: prefsResult.message,
            },
        };
    }

    private async importPreferences(configJson?: string): Promise<ToolResponse> {
        return {
            success: false,
            error: 'Import preferences functionality requires file system access which is not available in this context. Please manually import preferences through the Editor UI.'
        };
    }

    private normalizeScope(type?: string): PreferencesScope | undefined {
        if (type === 'default' || type === 'global' || type === 'local') {
            return type;
        }
        return undefined;
    }

    private optionalTrimmedString(value: unknown): string | undefined {
        if (typeof value !== 'string') {
            return undefined;
        }

        const trimmed = value.trim();
        return trimmed ? trimmed : undefined;
    }

    private requireTrimmedString(
        value: unknown,
        fieldName: string,
    ): { success: true; value: string } | { success: false; response: ToolResponse } {
        const normalized = this.optionalTrimmedString(value);
        if (!normalized) {
            return {
                success: false,
                response: makeError(ToolErrorCode.MISSING_REQUIRED, `${fieldName} is required`),
            };
        }

        return {
            success: true,
            value: normalized,
        };
    }
}
