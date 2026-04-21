import { ToolConfiguration } from './interface';
import {
    DEFAULT_SETTINGS,
    DEFAULT_TOOL_MANAGER_SETTINGS,
    SettingsRepository,
} from './repository';

const settingsRepository = new SettingsRepository();

export function readSettings() {
    return settingsRepository.readServerSettings();
}

export function saveSettings(settings: ReturnType<typeof readSettings>): void {
    settingsRepository.saveServerSettings(settings);
}

export function readToolManagerSettings() {
    return settingsRepository.readToolManagerSettings();
}

export function saveToolManagerSettings(settings: ReturnType<typeof readToolManagerSettings>): void {
    settingsRepository.saveToolManagerSettings(settings);
}

export function exportToolConfiguration(config: ToolConfiguration): string {
    return settingsRepository.exportToolConfiguration(config);
}

export function importToolConfiguration(configJson: string): ToolConfiguration {
    return settingsRepository.importToolConfiguration(configJson);
}

export { DEFAULT_SETTINGS, DEFAULT_TOOL_MANAGER_SETTINGS };
