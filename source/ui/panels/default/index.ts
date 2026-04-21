/* eslint-disable vue/one-component-per-file */

import { readFileSync } from 'fs-extra';
import { join } from 'path';
import {
    App,
    ComputedRef,
    computed,
    createApp,
    defineComponent,
    onBeforeUnmount,
    onMounted,
    Ref,
    ref,
    watch,
} from 'vue';
import * as ipcClient from '../../ipc/client';

const panelDataMap = new WeakMap<any, App>();

const PANEL_TEMPLATE = readFileSync(join(__dirname, '../../../static/template/default/index.html'), 'utf-8');
const PANEL_STYLE = readFileSync(join(__dirname, '../../../static/style/default/index.css'), 'utf-8');
const APP_TEMPLATE = readFileSync(join(__dirname, '../../../static/template/vue/mcp-server-app.html'), 'utf-8');

const DEFAULT_SERVER_SETTINGS: ServerSettings = {
    port: 3000,
    autoStart: false,
    debugLog: false,
    maxConnections: 10,
};

const CATEGORY_DISPLAY_NAMES: Record<string, string> = {
    scene: '场景工具',
    node: '节点工具',
    component: '组件工具',
    prefab: '预制体工具',
    project: '项目工具',
    debug: '调试工具',
    preferences: '偏好设置工具',
    server: '服务器工具',
    broadcast: '广播工具',
    sceneAdvanced: '高级场景工具',
    sceneView: '场景视图工具',
    referenceImage: '参考图片工具',
    assetAdvanced: '高级资源工具',
    validation: '验证工具',
};

interface ToolConfig {
    category: string;
    name: string;
    enabled: boolean;
    description: string;
}

interface ServerSettings {
    port: number;
    autoStart: boolean;
    debugLog: boolean;
    maxConnections: number;
}

interface ServerPanelState {
    activeTab: Ref<string>;
    serverRunning: Ref<boolean>;
    serverStatus: Ref<string>;
    connectedClients: Ref<number>;
    httpUrl: Ref<string>;
    isProcessing: Ref<boolean>;
    settings: Ref<ServerSettings>;
    settingsChanged: Ref<boolean>;
    statusClass: ComputedRef<Record<string, boolean>>;
}

interface ToolPanelState {
    availableTools: Ref<ToolConfig[]>;
    toolCategories: Ref<string[]>;
    selectedConfigId: Ref<string>;
    totalTools: ComputedRef<number>;
    enabledTools: ComputedRef<number>;
    disabledTools: ComputedRef<number>;
}

function createServerPanelState(): ServerPanelState {
    const serverRunning = ref(false);
    const settings = ref<ServerSettings>({ ...DEFAULT_SERVER_SETTINGS });

    return {
        activeTab: ref('server'),
        serverRunning,
        serverStatus: ref('已停止'),
        connectedClients: ref(0),
        httpUrl: ref(''),
        isProcessing: ref(false),
        settings,
        settingsChanged: ref(false),
        statusClass: computed(() => ({
            'status-running': serverRunning.value,
            'status-stopped': !serverRunning.value,
        })),
    };
}

function createToolPanelState(): ToolPanelState {
    const availableTools = ref<ToolConfig[]>([]);

    return {
        availableTools,
        toolCategories: ref<string[]>([]),
        selectedConfigId: ref(''),
        totalTools: computed(() => availableTools.value.length),
        enabledTools: computed(() => availableTools.value.filter((tool) => tool.enabled).length),
        disabledTools: computed(() => availableTools.value.length - availableTools.value.filter((tool) => tool.enabled).length),
    };
}

function cloneTools(tools: ToolConfig[]): ToolConfig[] {
    return tools.map((tool) => ({ ...tool }));
}

function buildServerSettingsPayload(settings: ServerSettings) {
    return {
        port: settings.port,
        autoStart: settings.autoStart,
        debugLog: settings.debugLog,
        maxConnections: settings.maxConnections,
    };
}

function updateToolCategories(state: ToolPanelState): void {
    state.toolCategories.value = Array.from(new Set(state.availableTools.value.map((tool) => tool.category)));
}

function replaceAvailableTools(state: ToolPanelState, tools: ToolConfig[]): void {
    state.availableTools.value = tools;
    updateToolCategories(state);
}

function findToolIndex(tools: ToolConfig[], category: string, name: string): number {
    return tools.findIndex((tool) => tool.category === category && tool.name === name);
}

function createToolPanelActions(state: ToolPanelState) {
    const persistToolChanges = async (): Promise<boolean> => {
        if (!state.selectedConfigId.value) {
            console.error('[Vue App] No selected configuration available for batch update');
            return false;
        }

        try {
            const updates = state.availableTools.value.map((tool) => ({
                category: String(tool.category),
                name: String(tool.name),
                enabled: Boolean(tool.enabled),
            }));

            console.log('[Vue App] Sending updates:', updates.length, 'tools');
            const result = await ipcClient.updateToolStatusBatch(state.selectedConfigId.value, updates);
            if (result && result.success) {
                console.log('[Vue App] Tool changes saved successfully');
                return true;
            }
        } catch (error) {
            console.error('[Vue App] Failed to save tool changes:', error);
        }

        return false;
    };

    const loadToolManagerState = async () => {
        try {
            const result = await ipcClient.getToolManagerState();
            if (result && result.success) {
                replaceAvailableTools(state, cloneTools(result.availableTools || []));
                state.selectedConfigId.value = result.selectedConfigId || '';
                console.log('[Vue App] Loaded tools:', state.availableTools.value.length);
            }
        } catch (error) {
            console.error('[Vue App] Failed to load tool manager state:', error);
        }
    };

    const saveChanges = async () => {
        await persistToolChanges();
    };

    const updateToolStatus = async (category: string, name: string, enabled: boolean) => {
        if (!state.selectedConfigId.value) {
            console.error('[Vue App] No selected configuration available for tool update');
            return;
        }

        const previousTools = cloneTools(state.availableTools.value);
        const nextTools = cloneTools(state.availableTools.value);
        const toolIndex = findToolIndex(nextTools, category, name);

        if (toolIndex === -1) {
            return;
        }

        nextTools[toolIndex].enabled = enabled;
        replaceAvailableTools(state, nextTools);

        try {
            console.log('[Vue App] updateToolStatus called:', category, name, enabled);
            const result = await ipcClient.updateToolStatus(state.selectedConfigId.value, category, name, enabled);
            if (!result || !result.success) {
                replaceAvailableTools(state, previousTools);
                console.error('[Vue App] Backend update failed, rolled back local state');
                return;
            }
            console.log('[Vue App] Backend update successful');
        } catch (error) {
            replaceAvailableTools(state, previousTools);
            console.error('[Vue App] Failed to update tool status:', error);
        }
    };

    const applyBatchToolMutation = async (mutate: (tools: ToolConfig[]) => void, errorMessage: string) => {
        const previousTools = cloneTools(state.availableTools.value);
        const nextTools = cloneTools(state.availableTools.value);

        mutate(nextTools);
        replaceAvailableTools(state, nextTools);

        const success = await persistToolChanges();
        if (!success) {
            replaceAvailableTools(state, previousTools);
            console.error(errorMessage);
        }
    };

    const selectAllTools = async () => {
        await applyBatchToolMutation((tools) => {
            tools.forEach((tool) => {
                tool.enabled = true;
            });
        }, '[Vue App] Failed to select all tools');
    };

    const deselectAllTools = async () => {
        await applyBatchToolMutation((tools) => {
            tools.forEach((tool) => {
                tool.enabled = false;
            });
        }, '[Vue App] Failed to deselect all tools');
    };

    const toggleCategoryTools = async (category: string, enabled: boolean) => {
        await applyBatchToolMutation((tools) => {
            tools.forEach((tool) => {
                if (tool.category === category) {
                    tool.enabled = enabled;
                }
            });
        }, '[Vue App] Failed to toggle category tools');
    };

    const getToolsByCategory = (category: string) => {
        return state.availableTools.value.filter((tool) => tool.category === category);
    };

    const getCategoryDisplayName = (category: string): string => {
        return CATEGORY_DISPLAY_NAMES[category] || category;
    };

    return {
        loadToolManagerState,
        saveChanges,
        updateToolStatus,
        selectAllTools,
        deselectAllTools,
        toggleCategoryTools,
        getToolsByCategory,
        getCategoryDisplayName,
    };
}

function createServerPanelActions(
    state: ServerPanelState,
    loadToolManagerState: () => Promise<void>,
) {
    const switchTab = async (tabName: string) => {
        state.activeTab.value = tabName;
        if (tabName === 'tools') {
            await loadToolManagerState();
        }
    };

    const toggleServer = async () => {
        state.isProcessing.value = true;

        try {
            if (state.serverRunning.value) {
                await ipcClient.stopServer();
            } else {
                await ipcClient.updateSettings(buildServerSettingsPayload(state.settings.value));
                await ipcClient.startServer();
            }
            console.log('[Vue App] Server toggled');
        } catch (error) {
            console.error('[Vue App] Failed to toggle server:', error);
        } finally {
            state.isProcessing.value = false;
        }
    };

    const saveSettings = async () => {
        try {
            await ipcClient.updateSettings(buildServerSettingsPayload(state.settings.value));
            state.settingsChanged.value = false;
            console.log('[Vue App] Settings saved');
        } catch (error) {
            console.error('[Vue App] Failed to save settings:', error);
        }
    };

    const copyUrl = async () => {
        try {
            await navigator.clipboard.writeText(state.httpUrl.value);
            console.log('[Vue App] URL copied to clipboard');
        } catch (error) {
            console.error('[Vue App] Failed to copy URL:', error);
        }
    };

    const loadServerSettings = async () => {
        try {
            const serverStatus = await ipcClient.getServerStatus();
            if (serverStatus && serverStatus.settings) {
                state.settings.value = {
                    port: serverStatus.settings.port || DEFAULT_SERVER_SETTINGS.port,
                    autoStart: serverStatus.settings.autoStart || false,
                    debugLog: serverStatus.settings.enableDebugLog || false,
                    maxConnections: serverStatus.settings.maxConnections || DEFAULT_SERVER_SETTINGS.maxConnections,
                };
                state.settingsChanged.value = false;
                console.log('[Vue App] Server settings loaded from status:', serverStatus.settings);
                return;
            }

            if (serverStatus && serverStatus.port) {
                state.settings.value.port = serverStatus.port;
                state.settingsChanged.value = false;
                console.log('[Vue App] Port loaded from server status:', serverStatus.port);
            }
        } catch (error) {
            console.error('[Vue App] Failed to get server status:', error);
            console.log('[Vue App] Using default server settings');
        }
    };

    const refreshServerStatus = async () => {
        try {
            const result = await ipcClient.getServerStatus();
            if (!result) {
                return;
            }

            state.serverRunning.value = result.running;
            state.serverStatus.value = result.running ? '运行中' : '已停止';
            state.connectedClients.value = result.clients || 0;
            state.httpUrl.value = result.running ? `http://localhost:${result.port}` : '';
            state.isProcessing.value = false;
        } catch (error) {
            console.error('[Vue App] Failed to get server status:', error);
        }
    };

    return {
        switchTab,
        toggleServer,
        saveSettings,
        copyUrl,
        loadServerSettings,
        refreshServerStatus,
    };
}

function registerPanelLifecycle(
    serverState: ServerPanelState,
    serverActions: ReturnType<typeof createServerPanelActions>,
    toolActions: ReturnType<typeof createToolPanelActions>,
): void {
    let statusTimer: ReturnType<typeof setInterval> | null = null;

    watch(serverState.settings, () => {
        serverState.settingsChanged.value = true;
    }, { deep: true });

    onMounted(async () => {
        await toolActions.loadToolManagerState();
        await serverActions.loadServerSettings();
        await serverActions.refreshServerStatus();

        statusTimer = setInterval(() => {
            void serverActions.refreshServerStatus();
        }, 2000);
    });

    onBeforeUnmount(() => {
        if (statusTimer) {
            clearInterval(statusTimer);
        }
    });
}

const McpServerApp = defineComponent({
    setup() {
        const serverState = createServerPanelState();
        const toolState = createToolPanelState();
        const toolActions = createToolPanelActions(toolState);
        const serverActions = createServerPanelActions(serverState, toolActions.loadToolManagerState);

        registerPanelLifecycle(serverState, serverActions, toolActions);

        return {
            activeTab: serverState.activeTab,
            serverRunning: serverState.serverRunning,
            serverStatus: serverState.serverStatus,
            connectedClients: serverState.connectedClients,
            httpUrl: serverState.httpUrl,
            isProcessing: serverState.isProcessing,
            settings: serverState.settings,
            settingsChanged: serverState.settingsChanged,
            statusClass: serverState.statusClass,
            availableTools: toolState.availableTools,
            toolCategories: toolState.toolCategories,
            totalTools: toolState.totalTools,
            enabledTools: toolState.enabledTools,
            disabledTools: toolState.disabledTools,
            switchTab: serverActions.switchTab,
            toggleServer: serverActions.toggleServer,
            saveSettings: serverActions.saveSettings,
            copyUrl: serverActions.copyUrl,
            loadToolManagerState: toolActions.loadToolManagerState,
            updateToolStatus: toolActions.updateToolStatus,
            selectAllTools: toolActions.selectAllTools,
            deselectAllTools: toolActions.deselectAllTools,
            saveChanges: toolActions.saveChanges,
            toggleCategoryTools: toolActions.toggleCategoryTools,
            getToolsByCategory: toolActions.getToolsByCategory,
            getCategoryDisplayName: toolActions.getCategoryDisplayName,
        };
    },
    template: APP_TEMPLATE,
});

module.exports = Editor.Panel.define({
    listeners: {
        show() {
            console.log('[MCP Panel] Panel shown');
        },
        hide() {
            console.log('[MCP Panel] Panel hidden');
        },
    },
    template: PANEL_TEMPLATE,
    style: PANEL_STYLE,
    $: {
        app: '#app',
        panelTitle: '#panelTitle',
    },
    ready() {
        if (!this.$.app) {
            return;
        }

        const app = createApp(McpServerApp);
        app.config.compilerOptions.isCustomElement = (tag) => tag.startsWith('ui-');
        app.mount(this.$.app);
        panelDataMap.set(this, app);

        console.log('[MCP Panel] Vue3 app mounted successfully');
    },
    beforeClose() { },
    close() {
        const app = panelDataMap.get(this);
        if (app) {
            app.unmount();
        }
    },
});
