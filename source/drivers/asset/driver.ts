import * as fs from 'fs';
import * as path from 'path';
import { BaseDriver } from '../base-driver';
import { RuntimeProfile } from '../../core/profile';
import {
    AssetBridgeDriver,
    AssetCopyInput,
    AssetCreateInput,
    AssetDependencyItem,
    AssetImportInput,
    AssetMetadata,
    AssetMoveInput,
    AssetMutationResult,
    AssetQueryInput,
    AssetSaveInput,
    AssetSaveMetaInput,
} from './contract';

const ASSET_DB_CHANNEL = 'asset-db';

const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const TEXT_REFERENCE_EXTENSIONS = [
    '.scene', '.prefab', '.anim', '.mtl', '.material', '.json', '.ts', '.js',
    '.txt', '.xml', '.plist', '.fnt', '.shader', '.effect', '.subgraph',
    '.graph', '.csv', '.md', '.html', '.css',
];

class EditorAssetDriver extends BaseDriver implements AssetBridgeDriver {

    // =========================================================================
    // 查询（原有）
    // =========================================================================

    async queryReady(): Promise<boolean> {
        this.ensureFeatureAvailable('assetQueryAssets');
        const result = await this.request('asset-db', 'query-ready');
        return Boolean(result);
    }

    async queryAssetInfo(assetPath: string): Promise<AssetMetadata | null> {
        this.ensureFeatureAvailable('assetQueryAssets');
        const result = await this.request('asset-db', 'query-asset-info', assetPath);
        return result ? (result as AssetMetadata) : null;
    }

    async queryAssetMeta(urlOrUuid: string): Promise<Record<string, unknown>> {
        this.ensureFeatureAvailable('assetQueryAssets');
        const result = await this.request('asset-db', 'query-asset-meta', urlOrUuid);
        return (result ?? {}) as Record<string, unknown>;
    }

    async queryAssets(query: AssetQueryInput): Promise<AssetMetadata[]> {
        this.ensureFeatureAvailable('assetQueryAssets');
        const result = await this.request('asset-db', 'query-assets', query);
        return (Array.isArray(result) ? result : []) as AssetMetadata[];
    }

    async queryAssetUrl(uuid: string): Promise<string | null> {
        this.ensureFeatureAvailable('assetQueryAssets');
        const result = await this.request('asset-db', 'query-url', uuid);
        return typeof result === 'string' ? result : null;
    }

    async readAsset(urlOrUuid: string): Promise<string | unknown> {
        this.ensureFeatureAvailable('assetQueryAssets');
        return this.request('asset-db', 'read-asset', urlOrUuid);
    }

    async generateAvailableUrl(url: string): Promise<string> {
        this.ensureFeatureAvailable('assetQueryAssets');
        const result = await this.request('asset-db', 'generate-available-url', url);
        return typeof result === 'string' ? result : url;
    }

    // =========================================================================
    // 资产信息解析（从 service 下沉）
    // =========================================================================

    async resolveAssetInfo(urlOrUUID: string): Promise<AssetMetadata | null> {
        const input = String(urlOrUUID || '').trim();
        if (!input) return null;

        const candidates = new Set<string>([this.normalizeDbUrl(input)]);
        if (!input.startsWith('db://')) {
            try {
                const resolvedUrl = await this.queryAssetUrl(input);
                if (resolvedUrl) candidates.add(this.normalizeDbUrl(String(resolvedUrl)));
            } catch { /* ignore */ }
        }

        for (const candidate of candidates) {
            try {
                const assetInfo = await this.queryAssetInfo(candidate);
                if (assetInfo) {
                    const url = this.normalizeDbUrl((assetInfo as any).url || assetInfo.path || candidate);
                    return {
                        ...assetInfo,
                        url,
                        path: url,
                        name: assetInfo.name || path.basename(url),
                        type: assetInfo.type || 'unknown',
                    } as AssetMetadata;
                }
            } catch { /* try next */ }
        }

        return null;
    }

    // =========================================================================
    // 依赖分析（从 service 下沉）
    // =========================================================================

    async collectAssetDependencies(assetInfo: AssetMetadata): Promise<AssetDependencyItem[]> {
        const references = new Set<string>();

        try {
            const metaInfo = await this.readAssetMeta(assetInfo.uuid, (assetInfo as any).url || assetInfo.path || '');
            this.collectUuidReferences(metaInfo, references, assetInfo.uuid);
        } catch { /* optional */ }

        const assetUrl = this.normalizeDbUrl((assetInfo as any).url || assetInfo.path || '');
        if (this.shouldScanAssetContent(assetUrl)) {
            const content = await this.readAssetContent(assetUrl);
            this.collectUuidReferencesFromText(content, references, assetInfo.uuid);
        }

        const uuids = Array.from(references);
        const dependencies: AssetDependencyItem[] = [];
        for (const depUuid of uuids.slice(0, 100)) {
            const depInfo = await this.resolveAssetInfo(depUuid);
            dependencies.push(depInfo
                ? { uuid: depInfo.uuid, name: depInfo.name, path: (depInfo as any).url || depInfo.path, type: depInfo.type }
                : { uuid: depUuid });
        }

        if (uuids.length > 100) {
            dependencies.push({ uuid: '', truncated: true, remaining: uuids.length - 100 });
        }

        return dependencies;
    }

    async findAssetDependents(targetUuid: string, targetUrl: string, allAssets: AssetMetadata[]): Promise<AssetDependencyItem[]> {
        const dependents: AssetDependencyItem[] = [];
        for (const asset of allAssets) {
            if (dependents.length >= 100) break;
            const assetUrl = this.normalizeDbUrl((asset as any).path || (asset as any).url || '');
            if (!assetUrl || (asset as any).isDirectory || assetUrl === targetUrl) continue;
            if (!this.shouldScanAssetContent(assetUrl)) continue;

            const content = await this.readAssetContent(assetUrl);
            if (!content) continue;
            if (content.includes(targetUuid)) {
                dependents.push({ uuid: asset.uuid, name: asset.name, path: assetUrl, type: asset.type });
            }
        }
        return dependents;
    }

    async collectReferencedUuids(assets: AssetMetadata[]): Promise<Set<string>> {
        const referenced = new Set<string>();
        for (const asset of assets) {
            if (!asset || (asset as any).isDirectory) continue;
            const assetUrl = this.normalizeDbUrl((asset as any).path || (asset as any).url || '');
            if (!assetUrl || !this.shouldScanAssetContent(assetUrl)) continue;

            const content = await this.readAssetContent(assetUrl);
            this.collectUuidReferencesFromText(content, referenced, asset.uuid);

            try {
                const metaInfo = await this.readAssetMeta(asset.uuid, assetUrl);
                this.collectUuidReferences(metaInfo, referenced, asset.uuid);
            } catch { /* ignore */ }
        }
        return referenced;
    }

    // =========================================================================
    // 文件系统操作（从 service 下沉）
    // =========================================================================

    async readAssetMeta(uuid: string, assetUrl: string): Promise<Record<string, unknown> | null> {
        try {
            const metaInfo = await this.queryAssetMeta(uuid);
            if (metaInfo && Object.keys(metaInfo).length > 0) return metaInfo;
        } catch { /* fallback to disk */ }

        const metaPath = `${this.dbUrlToFilePath(assetUrl)}.meta`;
        if (!metaPath || !fs.existsSync(metaPath)) return null;

        try {
            return JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        } catch { return null; }
    }

    async readAssetContent(assetUrl: string): Promise<string | null> {
        try {
            const content = await this.readAsset(assetUrl);
            if (typeof content === 'string') return content;
            if (content === null || content === undefined) return null;
            return JSON.stringify(content);
        } catch {
            try {
                const filePath = this.dbUrlToFilePath(assetUrl);
                if (filePath && fs.existsSync(filePath)) return fs.readFileSync(filePath, 'utf8');
            } catch { /* ignore */ }
            return null;
        }
    }

    getFilesFromDirectory(dirPath: string, fileFilter: string[], recursive: boolean): string[] {
        const files: string[] = [];
        const items = fs.readdirSync(dirPath);
        for (const item of items) {
            const fullPath = path.join(dirPath, item);
            const stat = fs.statSync(fullPath);
            if (stat.isFile()) {
                if (fileFilter.length === 0 || fileFilter.some(ext => item.toLowerCase().endsWith(ext.toLowerCase()))) {
                    files.push(fullPath);
                }
            } else if (stat.isDirectory() && recursive) {
                files.push(...this.getFilesFromDirectory(fullPath, fileFilter, recursive));
            }
        }
        return files;
    }

    fileExists(filePath: string): boolean {
        return fs.existsSync(filePath);
    }

    // =========================================================================
    // 创建 / 修改（原有）
    // =========================================================================

    async createAsset(input: AssetCreateInput): Promise<AssetMutationResult> {
        this.ensureFeatureAvailable('assetQueryAssets');
        const result = await this.request('asset-db', 'create-asset', input.url, input.content, {
            overwrite: input.overwrite,
            rename: input.rename,
        });
        return result as AssetMutationResult;
    }

    async importAsset(input: AssetImportInput): Promise<AssetMutationResult> {
        this.ensureFeatureAvailable('assetQueryAssets');
        const result = await this.request('asset-db', 'import-asset', input.source, input.target);
        return result as AssetMutationResult;
    }

    async saveAsset(input: AssetSaveInput): Promise<AssetMutationResult> {
        this.ensureFeatureAvailable('assetQueryAssets');
        const result = await this.request('asset-db', 'save-asset', input.url, input.content);
        return result as AssetMutationResult;
    }

    async saveAssetMeta(input: AssetSaveMetaInput): Promise<AssetMutationResult> {
        this.ensureFeatureAvailable('assetQueryAssets');
        const result = await this.request('asset-db', 'save-asset-meta', input.urlOrUuid, input.content);
        return result as AssetMutationResult;
    }

    async reimportAsset(url: string): Promise<void> {
        this.ensureFeatureAvailable('assetQueryAssets');
        await this.request('asset-db', 'reimport-asset', url);
    }

    async moveAsset(input: AssetMoveInput): Promise<AssetMutationResult> {
        this.ensureFeatureAvailable('assetQueryAssets');
        const result = await this.request('asset-db', 'move-asset', input.source, input.target);
        return result as AssetMutationResult;
    }

    async copyAsset(input: AssetCopyInput): Promise<AssetMutationResult> {
        this.ensureFeatureAvailable('assetQueryAssets');
        const result = await this.request('asset-db', 'copy-asset', input.source, input.target);
        return result as AssetMutationResult;
    }

    async deleteAsset(url: string): Promise<void> {
        this.ensureFeatureAvailable('assetQueryAssets');
        await this.request('asset-db', 'delete-asset', url);
    }

    async refreshAsset(targetPath?: string): Promise<void> {
        this.ensureFeatureAvailable('assetQueryAssets');
        await this.request('asset-db', 'refresh-asset', targetPath);
    }

    async openAsset(urlOrUuid: string): Promise<void> {
        this.ensureFeatureAvailable('assetQueryAssets');
        await this.request('asset-db', 'open-asset', urlOrUuid);
    }

    // =========================================================================
    // 内部工具
    // =========================================================================

    private normalizeDbUrl(value: string): string {
        const normalized = String(value || '').trim().replace(/\\/g, '/').replace(/\/+$/, '');
        if (!normalized) return '';
        if (normalized.startsWith('db://')) return normalized;
        if (normalized.startsWith('assets/')) return `db://${normalized}`;
        return `db://assets/${normalized.replace(/^\/+/, '')}`;
    }

    private dbUrlToFilePath(assetUrl: string): string {
        const normalized = this.normalizeDbUrl(assetUrl);
        const relativePath = normalized.startsWith('db://') ? normalized.replace('db://', '') : normalized;
        const Editor = (globalThis as any).Editor;
        return path.join(Editor.Project.path, relativePath);
    }

    private shouldScanAssetContent(assetUrl: string): boolean {
        const lowerUrl = assetUrl.toLowerCase();
        return TEXT_REFERENCE_EXTENSIONS.some(ext => lowerUrl.endsWith(ext));
    }

    private collectUuidReferences(value: any, target: Set<string>, excludeUuid?: string, seen: WeakSet<object> = new WeakSet(), depth: number = 0): void {
        if (value === null || value === undefined || depth > 8) return;
        if (typeof value === 'string') { this.collectUuidReferencesFromText(value, target, excludeUuid); return; }
        if (typeof value !== 'object') return;
        if (seen.has(value)) return;
        seen.add(value);
        try {
            if (Array.isArray(value)) {
                for (const item of value) this.collectUuidReferences(item, target, excludeUuid, seen, depth + 1);
                return;
            }
            for (const item of Object.values(value)) this.collectUuidReferences(item, target, excludeUuid, seen, depth + 1);
        } finally { seen.delete(value); }
    }

    private collectUuidReferencesFromText(text: string | null, target: Set<string>, excludeUuid?: string): void {
        if (!text) return;
        const matches = text.match(UUID_PATTERN) || [];
        for (const match of matches) {
            if (excludeUuid && match === excludeUuid) continue;
            target.add(match);
        }
    }

}

export function createAssetDriver(profile: RuntimeProfile): AssetBridgeDriver {
    return new EditorAssetDriver(profile);
}
