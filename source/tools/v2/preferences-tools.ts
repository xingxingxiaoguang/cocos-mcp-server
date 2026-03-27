import { ToolDefinition, ToolResponse, ToolExecutor } from '../../types';

/**
 * PreferencesToolsV2 — 偏好设置工具 v2
 * 合并自 PreferencesTools
 * 2 个工具: query, modify
 */
export class PreferencesToolsV2 implements ToolExecutor {

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

    async execute(toolName: string, args: any): Promise<ToolResponse> {
        switch (toolName) {
            case 'query':
                return await this.handleQuery(args);
            case 'modify':
                return await this.handleModify(args);
            default:
                throw new Error(`Unknown tool: ${toolName}`);
        }
    }

    // ==================== query ====================

    private async handleQuery(args: any): Promise<ToolResponse> {
        if (args.name) {
            return await this.queryPreferencesConfig(args.name, args.path, args.type);
        }
        return await this.getAllPreferences();
    }

    private async queryPreferencesConfig(name: string, path?: string, type: string = 'global'): Promise<ToolResponse> {
        return new Promise((resolve) => {
            const requestArgs = [name];
            if (path) {
                requestArgs.push(path);
            }
            requestArgs.push(type);

            (Editor.Message.request as any)('preferences', 'query-config', ...requestArgs).then((config: any) => {
                resolve({
                    success: true,
                    data: { name, path, type, config }
                });
            }).catch((err: Error) => {
                resolve({ success: false, error: err.message });
            });
        });
    }

    private async getAllPreferences(): Promise<ToolResponse> {
        return new Promise((resolve) => {
            const categories = [
                'general', 'external-tools', 'data-editor', 'laboratory',
                'extensions', 'preview', 'console', 'native', 'builder'
            ];

            const preferences: any = {};
            const queryPromises = categories.map(category => {
                return Editor.Message.request('preferences', 'query-config', category, undefined, 'global')
                    .then((config: any) => { preferences[category] = config; })
                    .catch(() => { preferences[category] = null; });
            });

            Promise.all(queryPromises).then(() => {
                const validPreferences = Object.fromEntries(
                    Object.entries(preferences).filter(([_, value]) => value !== null)
                );
                resolve({
                    success: true,
                    data: {
                        categories: Object.keys(validPreferences),
                        preferences: validPreferences
                    }
                });
            }).catch((err: Error) => {
                resolve({ success: false, error: err.message });
            });
        });
    }

    // ==================== modify ====================

    private async handleModify(args: any): Promise<ToolResponse> {
        switch (args.action) {
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
                return { success: false, error: `Unknown modify action: ${args.action}` };
        }
    }

    private async setPreferencesConfig(name: string, path: string, value: any, type: string = 'global'): Promise<ToolResponse> {
        return new Promise((resolve) => {
            (Editor.Message.request as any)('preferences', 'set-config', name, path, value, type).then((success: boolean) => {
                if (success) {
                    resolve({ success: true, message: `Preference '${name}.${path}' updated successfully` });
                } else {
                    resolve({ success: false, error: `Failed to update preference '${name}.${path}'` });
                }
            }).catch((err: Error) => {
                resolve({ success: false, error: err.message });
            });
        });
    }

    private async resetPreferences(name?: string, type: string = 'global'): Promise<ToolResponse> {
        return new Promise((resolve) => {
            if (!name) {
                resolve({ success: false, error: 'Resetting all preferences is not supported. Please specify a preference category.' });
                return;
            }
            Editor.Message.request('preferences', 'query-config', name, undefined, 'default').then((defaultConfig: any) => {
                return (Editor.Message.request as any)('preferences', 'set-config', name, '', defaultConfig, type);
            }).then((success: boolean) => {
                if (success) {
                    resolve({ success: true, message: `Preference category '${name}' reset to default` });
                } else {
                    resolve({ success: false, error: `Failed to reset preference category '${name}'` });
                }
            }).catch((err: Error) => {
                resolve({ success: false, error: err.message });
            });
        });
    }

    private async openPreferencesSettings(tab?: string): Promise<ToolResponse> {
        return new Promise((resolve) => {
            const requestArgs: any[] = [];
            if (tab) {
                requestArgs.push(tab);
            }
            (Editor.Message.request as any)('preferences', 'open-settings', ...requestArgs).then(() => {
                resolve({ success: true, message: `Preferences settings opened${tab ? ` on tab: ${tab}` : ''}` });
            }).catch((err: Error) => {
                resolve({ success: false, error: err.message });
            });
        });
    }

    private async exportPreferences(): Promise<ToolResponse> {
        const prefsResult = await this.getAllPreferences();
        if (!prefsResult.success) {
            return prefsResult;
        }
        const prefsData = JSON.stringify(prefsResult.data, null, 2);
        return {
            success: true,
            data: {
                preferences: prefsResult.data,
                jsonData: prefsData,
                message: 'Preferences exported successfully'
            }
        };
    }

    private async importPreferences(configJson?: string): Promise<ToolResponse> {
        return {
            success: false,
            error: 'Import preferences functionality requires file system access which is not available in this context. Please manually import preferences through the Editor UI.'
        };
    }
}
