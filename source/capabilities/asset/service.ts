import {
    AssetCapability,
    AssetCreateInput,
    AssetDeleteInput,
    AssetModifyInput,
    AssetRefreshInput,
    AssetInfoInput,
    AssetNameSearchInput,
    AssetListInput,
    AssetDependencyInput,
    AssetUnusedInput,
    AssetDetail,
    AssetSearchResult,
    AssetListResult,
    AssetDependencyResult,
    AssetUnusedResult,
    AssetDbStatus,
    AssetCreateResult,
    AssetModifyResult,
    AssetDeleteResult,
    AssetRefreshResult,
} from './interface';
import { AssetBridgeDriver } from '../../editor-bridge/asset/contract';
import * as path from 'path';

export class AssetService implements AssetCapability {
    constructor(private readonly driver: AssetBridgeDriver) {}

    // ==================== query methods ====================

    async checkDbReady(): Promise<AssetDbStatus> {
        const ready = await this.driver.queryReady();
        return { ready, message: ready ? 'Asset database is ready' : 'Asset database is not ready' };
    }

    async getInfo(input: AssetInfoInput): Promise<AssetDetail> {
        if (input.uuid) {
            const url = await this.driver.queryAssetUrl(input.uuid);
            if (!url) throw new Error('Asset not found for given UUID');
            return this.queryByPath(url, input.includeSubAssets ?? true);
        }
        if (input.path) {
            return this.queryByPath(input.path, input.includeSubAssets ?? true);
        }
        throw new Error('Either uuid or path must be provided');
    }

    async searchByName(input: AssetNameSearchInput): Promise<AssetSearchResult> {
        const { name, exactMatch = false, type: assetType = 'all', folder = 'db://assets', maxResults = 20 } = input;

        const listResult = await this.list({ type: assetType, folder });
        const allAssets = listResult.assets;
        const matchedAssets: unknown[] = [];

        for (const asset of allAssets) {
            const matches = exactMatch ? asset.name === name : asset.name.toLowerCase().includes(name.toLowerCase());
            if (matches) {
                try {
                    const detail = await this.getInfo({ path: asset.path, includeSubAssets: false });
                    matchedAssets.push({ ...asset, details: detail });
                } catch {
                    matchedAssets.push(asset);
                }
                if (matchedAssets.length >= maxResults) break;
            }
        }

        return {
            searchTerm: name,
            exactMatch,
            assetType,
            folder,
            totalFound: matchedAssets.length,
            maxResults,
            assets: matchedAssets,
            message: `Found ${matchedAssets.length} assets matching '${name}'`,
        };
    }

    async list(input?: AssetListInput): Promise<AssetListResult> {
        const type = input?.type ?? 'all';
        const folder = input?.folder ?? 'db://assets';

        let pattern = `${folder}/**/*`;
        const normalizedType = this.normalizeAssetTypeKey(type);

        if (normalizedType && normalizedType !== 'all') {
            const typeExtensions: Record<string, string> = {
                scene: '.scene', sceneasset: '.scene', prefab: '.prefab', script: '.{ts,js}',
                texture: '.{png,jpg,jpeg,gif,tga,bmp,psd}', imageasset: '.{png,jpg,jpeg,gif,tga,bmp,psd}',
                texture2d: '.{png,jpg,jpeg,gif,tga,bmp,psd}', material: '.mtl', mesh: '.{fbx,obj,dae}',
                audio: '.{mp3,ogg,wav,m4a}', audioclip: '.{mp3,ogg,wav,m4a}',
                animation: '.{anim,clip}', animationclip: '.{anim,clip}',
                spriteframe: '.{png,jpg,jpeg}', spriteatlas: '.plist', font: '.{ttf,fnt,bmfont}',
            };
            const extension = typeExtensions[normalizedType];
            if (extension) pattern = `${folder}/**/*${extension}`;
        }

        const results = await this.driver.queryAssets({ pattern });
        const assets = results.map((asset: any) => ({
            name: asset.name, uuid: asset.uuid, path: asset.url, type: asset.type,
            size: asset.size || 0, isDirectory: asset.isDirectory || false,
        }));

        if (normalizedType && normalizedType !== 'all') {
            const filtered = assets.filter(asset => this.matchesAssetType(asset.type, normalizedType));
            if (filtered.length > 0) return { type: type || 'all', folder, count: filtered.length, assets: filtered };
        }

        return { type: type || 'all', folder, count: assets.length, assets };
    }

    async getDependencies(input: AssetDependencyInput): Promise<AssetDependencyResult> {
        const { urlOrUuid, direction = 'dependencies' } = input;

        const assetInfo = await this.driver.resolveAssetInfo(urlOrUuid);
        if (!assetInfo) throw new Error(`Asset ${urlOrUuid} not found`);

        const normalizedDirection = (direction || 'dependencies').toLowerCase();
        if (!['dependencies', 'dependents', 'both'].includes(normalizedDirection)) {
            throw new Error(`Unknown direction: ${direction}`);
        }

        const data: AssetDependencyResult = {
            uuid: assetInfo.uuid,
            name: assetInfo.name,
            path: (assetInfo as any).url || assetInfo.path,
            type: assetInfo.type,
            direction: normalizedDirection,
        };

        if (normalizedDirection === 'dependencies' || normalizedDirection === 'both') {
            const dependencies = await this.driver.collectAssetDependencies(assetInfo);
            data.dependencies = dependencies;
            data.dependencyCount = dependencies.length;
        }

        if (normalizedDirection === 'dependents' || normalizedDirection === 'both') {
            const listResult = await this.list({ type: 'all', folder: 'db://assets' });
            const allAssets = listResult.assets;
            const dependents = await this.driver.findAssetDependents(assetInfo.uuid, (assetInfo as any).url || assetInfo.path, allAssets);
            data.dependents = dependents;
            data.dependentCount = dependents.length;
        }

        return data;
    }

    async getUnused(input?: AssetUnusedInput): Promise<AssetUnusedResult> {
        const directory = input?.directory ?? 'db://assets';
        const excludeDirectories = input?.excludeDirectories ?? [];

        const scopeDirectory = this.normalizeDbUrl(directory || 'db://assets');
        const excludeSet = new Set((excludeDirectories || []).map(dir => this.normalizeDbUrl(dir)));

        const listResult = await this.list({ type: 'all', folder: 'db://assets' });
        const allAssets = listResult.assets;
        const referencedUuids = await this.driver.collectReferencedUuids(allAssets);

        const unused = allAssets.filter((asset: any) => {
            const assetUrl = this.normalizeDbUrl(asset.path || asset.url || '');
            const assetType = String(asset.type || '').toLowerCase();
            if (!assetUrl || asset.isDirectory) return false;
            if (!this.isAssetWithinDirectory(assetUrl, scopeDirectory)) return false;
            if (excludeSet.size > 0) {
                for (const excluded of excludeSet) {
                    if (excluded && this.isAssetWithinDirectory(assetUrl, excluded)) return false;
                }
            }
            if (!asset.uuid) return false;
            if (this.shouldSkipForUnusedCheck(assetUrl, assetType)) return false;
            return !referencedUuids.has(asset.uuid);
        }).map((asset: any) => ({ name: asset.name, uuid: asset.uuid, path: asset.path || asset.url, type: asset.type }));

        return {
            directory: scopeDirectory,
            excludeDirectories: Array.from(excludeSet),
            totalAssets: allAssets.length,
            referencedCount: referencedUuids.size,
            unusedCount: unused.length,
            unused,
            note: 'Basic reference scan across text assets, prefabs and materials. Scripts and scenes are excluded from unused results because scripts are imported and scenes are entry assets.',
        };
    }

    // ==================== create ====================

    async create(input: AssetCreateInput): Promise<AssetCreateResult> {
        const { action, targetPath } = input;
        switch (action) {
            case 'create': return this.createAsset(targetPath, input.content, input.overwrite);
            case 'import':
                if (input.sources) return this.batchImportAssets(input.sources, targetPath, input.overwrite);
                return this.importAsset(input.sourcePath!, targetPath);
            default: throw new Error(`Unknown create action: ${action}`);
        }
    }

    // ==================== modify ====================

    async modify(input: AssetModifyInput): Promise<AssetModifyResult> {
        switch (input.action) {
            case 'move': return this.moveAsset(input.source, input.target);
            case 'copy': return this.copyAsset(input.source, input.target);
            case 'save': return this.saveAsset(input.url, input.content);
            case 'reimport': return this.reimportAsset(input.url || input.path!);
            case 'save_meta': return this.saveAssetMeta(input.uuid || input.url!, input.content || JSON.stringify(input.meta));
            case 'compress': return this.compressTextures();
            default: throw new Error(`Unknown modify action: ${(input as any).action}`);
        }
    }

    // ==================== delete ====================

    async delete(input: AssetDeleteInput): Promise<AssetDeleteResult> {
        const urls = Array.isArray(input.urls) ? input.urls : [input.urls];
        if (urls.length === 1) {
            await this.driver.deleteAsset(urls[0]);
            return { url: urls[0], message: 'Asset deleted successfully' };
        }

        const deleteResults: Array<{ url: string; success: boolean; error?: string }> = [];
        let successCount = 0, errorCount = 0;
        for (const url of urls) {
            try { await this.driver.deleteAsset(url); deleteResults.push({ url, success: true }); successCount++; }
            catch (err: any) { deleteResults.push({ url, success: false, error: err.message }); errorCount++; }
        }
        return { totalAssets: urls.length, successCount, errorCount, results: deleteResults, message: `Batch delete completed: ${successCount} success, ${errorCount} errors` };
    }

    // ==================== refresh ====================

    async refresh(input: AssetRefreshInput): Promise<AssetRefreshResult> {
        const action = input.action || 'refresh';
        switch (action) {
            case 'refresh': return this.refreshAssets(input.path || input.directory);
            case 'generate_url': return this.generateAvailableUrl(input.path || input.url!);
            case 'open_external': return this.openAssetExternal(input.uuid || input.path!);
            case 'export_manifest': return this.exportAssetManifest(input.directory, input.format, input.includeMetadata);
            case 'validate_refs': return this.validateAssetReferences(input.directory);
            default: throw new Error(`Unknown refresh action: ${action}`);
        }
    }

    // ==================== private query helpers ====================

    private async queryByPath(assetPath: string, includeSubAssets: boolean = true): Promise<AssetDetail> {
        const assetInfo: any = await this.driver.queryAssetInfo(assetPath);
        if (!assetInfo) throw new Error('Asset not found');

        const detail: AssetDetail = {
            name: assetInfo.name, uuid: assetInfo.uuid, path: assetInfo.url,
            type: assetInfo.type, size: assetInfo.size, isDirectory: assetInfo.isDirectory,
        };
        if (assetInfo.meta) detail.meta = { ver: assetInfo.meta.ver, importer: assetInfo.meta.importer };

        detail.subAssets = [];
        if (includeSubAssets && (assetInfo.type === 'cc.ImageAsset' || assetPath.match(/\.(png|jpg|jpeg|gif|tga|bmp|psd)$/i))) {
            const baseUuid = assetInfo.uuid;
            const possibleSubAssets = [
                { type: 'spriteFrame', uuid: `${baseUuid}@f9941`, suffix: '@f9941' },
                { type: 'texture', uuid: `${baseUuid}@6c48a`, suffix: '@6c48a' },
                { type: 'texture2D', uuid: `${baseUuid}@6c48a`, suffix: '@6c48a' },
            ];
            for (const subAsset of possibleSubAssets) {
                try {
                    const subAssetUrl = await this.driver.queryAssetUrl(subAsset.uuid);
                    if (subAssetUrl) detail.subAssets.push({ type: subAsset.type, uuid: subAsset.uuid, url: subAssetUrl, suffix: subAsset.suffix });
                } catch { /* Sub-asset doesn't exist */ }
            }
        }

        return detail;
    }

    // ==================== private create helpers ====================

    private async createAsset(url: string, content: string | null | undefined = null, overwrite: boolean = false): Promise<AssetCreateResult> {
        const result = await this.driver.createAsset({ url, content: content ?? '', overwrite, rename: !overwrite });
        return { uuid: result?.uuid, url: result?.url || url, message: content === null || content === undefined ? 'Folder created successfully' : 'File created successfully' };
    }

    private async importAsset(sourcePath: string, targetPath: string): Promise<AssetCreateResult> {
        if (!this.driver.fileExists(sourcePath)) throw new Error('Source file not found');
        const fileName = path.basename(sourcePath);
        const target = targetPath.startsWith('db://') ? targetPath : `db://assets/${targetPath}`;
        const result = await this.driver.importAsset({ source: sourcePath, target: `${target}/${fileName}` });
        return { uuid: result.uuid, path: result.url, message: `Asset imported: ${fileName}` };
    }

    private async batchImportAssets(sources: any, targetDirectory: string, _overwrite: boolean = false): Promise<AssetCreateResult> {
        const { sourceDirectory, fileFilter = [], recursive = false } = sources;
        if (!this.driver.fileExists(sourceDirectory)) throw new Error('Source directory does not exist');

        const files = this.driver.getFilesFromDirectory(sourceDirectory, fileFilter, recursive);
        const importResults: Array<{ source: string; target?: string; success: boolean; uuid?: string; error?: string }> = [];
        let successCount = 0, errorCount = 0;

        for (const filePath of files) {
            try {
                const fileName = path.basename(filePath);
                const targetPath = `${targetDirectory}/${fileName}`;
                const result = await this.driver.importAsset({ source: filePath, target: targetPath });
                importResults.push({ source: filePath, target: targetPath, success: true, uuid: result?.uuid });
                successCount++;
            } catch (err: any) {
                importResults.push({ source: filePath, success: false, error: err.message });
                errorCount++;
            }
        }

        return { totalFiles: files.length, successCount, errorCount, results: importResults, message: `Batch import completed: ${successCount} success, ${errorCount} errors` };
    }

    // ==================== private modify helpers ====================

    private async moveAsset(source: string, target: string): Promise<AssetModifyResult> {
        const result = await this.driver.moveAsset({ source, target });
        return { uuid: result?.uuid, url: result?.url, source, target, message: 'Asset moved successfully' };
    }

    private async copyAsset(source: string, target: string): Promise<AssetModifyResult> {
        const result = await this.driver.copyAsset({ source, target });
        return { uuid: result?.uuid, url: result?.url, source, target, message: 'Asset copied successfully' };
    }

    private async saveAsset(url: string, content: string): Promise<AssetModifyResult> {
        const result = await this.driver.saveAsset({ url, content });
        return { uuid: result?.uuid, url: result?.url || url, message: 'Asset saved successfully' };
    }

    private async reimportAsset(url: string): Promise<AssetModifyResult> {
        await this.driver.reimportAsset(url);
        return { url, message: 'Asset reimported successfully' };
    }

    private async saveAssetMeta(urlOrUUID: string, content: string): Promise<AssetModifyResult> {
        const result = await this.driver.saveAssetMeta({ urlOrUuid: urlOrUUID, content });
        return { uuid: result?.uuid, url: result?.url, message: 'Asset meta saved successfully' };
    }

    private async compressTextures(): Promise<AssetModifyResult> {
        throw new Error('Texture compression requires image processing capabilities not available in current Cocos Creator MCP implementation.');
    }

    // ==================== private refresh helpers ====================

    private async refreshAssets(folder?: string): Promise<AssetRefreshResult> {
        await this.driver.refreshAsset(folder || 'db://assets');
        return { message: `Assets refreshed in: ${folder || 'db://assets'}` };
    }

    private async generateAvailableUrl(url: string): Promise<AssetRefreshResult> {
        const availableUrl = await this.driver.generateAvailableUrl(url);
        return { originalUrl: url, availableUrl, message: availableUrl === url ? 'URL is available' : 'Generated new available URL' };
    }

    private async openAssetExternal(urlOrUUID: string): Promise<AssetRefreshResult> {
        await this.driver.openAsset(urlOrUUID);
        return { message: 'Asset opened with external program' };
    }

    private async exportAssetManifest(directory: string = 'db://assets', format: string = 'json', includeMetadata: boolean = true): Promise<AssetRefreshResult> {
        const assets = await this.driver.queryAssets({ pattern: `${directory}/**/*` });
        const manifest: any[] = [];
        for (const asset of assets) {
            const entry: any = { name: asset.name, url: (asset as any).url, uuid: asset.uuid, type: asset.type, size: asset.size || 0, isDirectory: (asset as any).isDirectory || false };
            if (includeMetadata) {
                try { const info = await this.driver.queryAssetInfo((asset as any).url ?? asset.path); if (info && (info as any).meta) entry.meta = (info as any).meta; }
                catch { /* skip */ }
            }
            manifest.push(entry);
        }

        let exportData: string;
        switch (format) {
            case 'csv': exportData = this.convertToCSV(manifest); break;
            case 'xml': exportData = this.convertToXML(manifest); break;
            default: exportData = JSON.stringify(manifest, null, 2);
        }

        return { directory, format, assetCount: manifest.length, includeMetadata, manifest: exportData, message: `Asset manifest exported with ${manifest.length} assets` };
    }

    private async validateAssetReferences(directory: string = 'db://assets'): Promise<AssetRefreshResult> {
        const assets = await this.driver.queryAssets({ pattern: `${directory}/**/*` });
        const brokenReferences: any[] = [];
        let validCount = 0;
        for (const asset of assets) {
            try { const info = await this.driver.queryAssetInfo((asset as any).url ?? asset.path); if (info) validCount++; }
            catch (err) { brokenReferences.push({ url: (asset as any).url, uuid: asset.uuid, name: asset.name, error: (err as Error).message }); }
        }
        return { directory, totalAssets: assets.length, validReferences: validCount, brokenReferences: brokenReferences.length, brokenAssets: brokenReferences, message: `Validation completed: ${brokenReferences.length} broken references found` };
    }

    // ==================== utility ====================

    private normalizeDbUrl(value: string): string {
        const normalized = String(value || '').trim().replace(/\\/g, '/').replace(/\/+$/, '');
        if (!normalized) return '';
        if (normalized.startsWith('db://')) return normalized;
        if (normalized.startsWith('assets/')) return `db://${normalized}`;
        return `db://assets/${normalized.replace(/^\/+/, '')}`;
    }

    private isAssetWithinDirectory(assetUrl: string, directoryUrl: string): boolean {
        const a = this.normalizeDbUrl(assetUrl), d = this.normalizeDbUrl(directoryUrl);
        if (!a || !d) return false;
        return a === d || a.startsWith(`${d}/`);
    }

    private shouldSkipForUnusedCheck(assetUrl: string, assetType: string = ''): boolean {
        const lowerUrl = assetUrl.toLowerCase();
        const nt = String(assetType || '').toLowerCase();
        return lowerUrl.endsWith('.meta') || lowerUrl.endsWith('.ts') || lowerUrl.endsWith('.js') || lowerUrl.endsWith('.scene') || nt.includes('script') || nt.includes('scene');
    }

    private normalizeAssetTypeKey(type: any): string { return String(type ?? '').trim().toLowerCase().replace(/^cc\./, ''); }

    private getAssetTypeAliases(type: string): Set<string> {
        const normalized = this.normalizeAssetTypeKey(type);
        const aliasGroups: Record<string, string[]> = {
            scene: ['scene', 'sceneasset'], sceneasset: ['scene', 'sceneasset'], prefab: ['prefab'], script: ['script'],
            texture: ['texture', 'imageasset', 'texture2d'], imageasset: ['texture', 'imageasset', 'texture2d'], texture2d: ['texture', 'imageasset', 'texture2d'],
            material: ['material'], mesh: ['mesh'], audio: ['audio', 'audioclip'], audioclip: ['audio', 'audioclip'],
            animation: ['animation', 'animationclip'], animationclip: ['animation', 'animationclip'],
            spriteframe: ['spriteframe'], spriteatlas: ['spriteatlas'], font: ['font'],
        };
        return new Set(aliasGroups[normalized] || [normalized]);
    }

    private matchesAssetType(assetType: string, requestedType: string): boolean {
        const a = this.getAssetTypeAliases(assetType), r = this.getAssetTypeAliases(requestedType);
        for (const alias of r) { if (a.has(alias)) return true; }
        return false;
    }

    private convertToCSV(data: any[]): string {
        if (data.length === 0) return '';
        const headers = Object.keys(data[0]);
        const csvRows = [headers.join(',')];
        for (const row of data) csvRows.push(headers.map(h => typeof row[h] === 'object' ? JSON.stringify(row[h]) : String(row[h])).join(','));
        return csvRows.join('\n');
    }

    private convertToXML(data: any[]): string {
        let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<assets>\n';
        for (const item of data) {
            xml += '  <asset>\n';
            for (const [key, value] of Object.entries(item)) xml += `    <${key}>${typeof value === 'object' ? JSON.stringify(value) : String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</${key}>\n`;
            xml += '  </asset>\n';
        }
        return xml + '</assets>';
    }
}
