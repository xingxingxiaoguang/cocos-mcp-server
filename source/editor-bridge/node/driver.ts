import { RuntimeProfile } from '../../runtime/profile';
import {
    NodeBridgeDriver,
    NodeCreateInput,
    NodePasteInput,
    NodeResetPropertyInput,
    NodeSetParentInput,
    NodeSetPropertyInput,
} from './contract';

const SCENE_CHANNEL = 'scene';

class EditorNodeDriver implements NodeBridgeDriver {
    constructor(private readonly profile: RuntimeProfile) {}

    async createNode(input: NodeCreateInput): Promise<string> {
        this.ensureAvailable();
        const result = await this.request('create-node', input);
        // Editor 返回 uuid 字符串或数组
        return Array.isArray(result) ? (result[0] as string) : (result as string);
    }

    async setParent(input: NodeSetParentInput): Promise<void> {
        this.ensureAvailable();
        await this.request('set-parent', input);
    }

    async setProperty(input: NodeSetPropertyInput): Promise<void> {
        this.ensureAvailable();
        await this.request('set-property', input);
    }

    async resetProperty(input: NodeResetPropertyInput): Promise<void> {
        this.ensureAvailable();
        await this.request('reset-property', input);
    }

    async resetNode(uuid: string): Promise<void> {
        this.ensureAvailable();
        await this.request('reset-node', { uuid });
    }

    async removeNode(uuid: string): Promise<void> {
        this.ensureAvailable();
        await this.request('remove-node', { uuid });
    }

    async duplicateNode(uuid: string): Promise<string> {
        this.ensureAvailable();
        const result = await this.request('duplicate-node', uuid);
        return Array.isArray(result) ? (result[0] as string) : (result as string);
    }

    async copyNode(uuids: string[]): Promise<string[]> {
        this.ensureAvailable();
        const result = await this.request('copy-node', uuids);
        return Array.isArray(result) ? (result as string[]) : [result as string];
    }

    async pasteNode(input: NodePasteInput): Promise<string[]> {
        this.ensureAvailable();
        const result = await this.request('paste-node', input);
        return Array.isArray(result) ? (result as string[]) : [result as string];
    }

    async cutNode(uuids: string[]): Promise<string[]> {
        this.ensureAvailable();
        const result = await this.request('cut-node', uuids);
        return Array.isArray(result) ? (result as string[]) : [result as string];
    }

    // -------------------------------------------------------------------------

    private async request(message: string, ...args: unknown[]): Promise<unknown> {
        const request = (globalThis as any).Editor.Message.request as (
            targetChannel: string,
            targetMessage: string,
            ...payload: unknown[]
        ) => Promise<unknown>;
        return request(SCENE_CHANNEL, message, ...args);
    }

    private ensureAvailable(): void {
        const request = (globalThis as any).Editor?.Message?.request;
        if (typeof request !== 'function' || !this.profile.features.sceneQueryNodeTree) {
            throw new Error('Editor.Message.request is unavailable in the current runtime');
        }
    }
}

export function createNodeDriver(profile: RuntimeProfile): NodeBridgeDriver {
    return new EditorNodeDriver(profile);
}
