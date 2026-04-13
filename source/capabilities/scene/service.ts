import {
    SceneCapability,
    SceneHierarchyNode,
    SceneInfoResult,
    SceneMutationResult,
    SceneStatusResult,
    CreateSceneInput,
    CreateSceneResult,
    OpenSceneInput,
    QuerySceneHierarchyInput,
    SaveSceneAsInput,
} from './interface';
import { SceneBridgeDriver } from '../../editor-bridge/scene/contract';

export class SceneService implements SceneCapability {
    constructor(private readonly driver: SceneBridgeDriver) {}

    async queryInfo(): Promise<SceneInfoResult> {
        return this.driver.querySceneInfo();
    }

    async queryHierarchy(input: QuerySceneHierarchyInput = {}): Promise<SceneHierarchyNode> {
        return this.driver.querySceneHierarchy(Boolean(input.includeComponents));
    }

    async listScenes() {
        const scenes = await this.driver.listSceneAssets();
        return {
            scenes: scenes.map(item => ({ name: item.name, path: item.path, uuid: item.uuid })),
            count: scenes.length,
        };
    }

    async queryStatus(): Promise<SceneStatusResult> {
        const [ready, dirty] = await Promise.all([
            this.driver.querySceneReady(),
            this.driver.querySceneDirty(),
        ]);
        return { ready, dirty, message: `Scene is ${ready ? 'ready' : 'not ready'}, ${dirty ? 'has unsaved changes' : 'clean'}` };
    }

    async openScene(input: OpenSceneInput): Promise<SceneMutationResult> {
        const sceneUuid = await this.driver.resolveSceneUuid(input.scenePath);
        if (!sceneUuid) throw new Error(`Scene not found: ${input.scenePath}`);
        await this.driver.openScene(sceneUuid);
        return { message: `Scene opened: ${input.scenePath}` };
    }

    async saveScene(): Promise<SceneMutationResult> {
        await this.driver.saveScene();
        return { message: 'Scene saved successfully' };
    }

    async saveSceneAs(input: SaveSceneAsInput): Promise<SceneMutationResult> {
        await this.driver.saveSceneAs();
        return { message: 'Scene save-as dialog opened', data: { path: input.path } };
    }

    async closeScene(): Promise<SceneMutationResult> {
        await this.driver.closeScene();
        return { message: 'Scene closed successfully' };
    }

    async createScene(input: CreateSceneInput): Promise<CreateSceneResult> {
        const created = await this.driver.createSceneAsset(input.sceneName, input.savePath);
        const scenes = await this.listScenes();
        const verificationData = scenes.scenes.find(scene => scene.uuid === created.uuid);

        return {
            message: `Scene '${input.sceneName}' created successfully`,
            data: { uuid: created.uuid, url: created.url, name: input.sceneName, sceneVerified: Boolean(verificationData) },
            ...(verificationData ? { verificationData } : {}),
        };
    }

    async reloadScene(): Promise<SceneMutationResult> {
        await this.driver.softReloadScene();
        return { message: 'Scene soft reloaded successfully' };
    }

    async createSnapshot(): Promise<SceneMutationResult> {
        await this.driver.createSnapshot();
        return { message: 'Scene snapshot created' };
    }

    async abortSnapshot(): Promise<SceneMutationResult> {
        await this.driver.abortSnapshot();
        return { message: 'Scene snapshot aborted' };
    }
}
