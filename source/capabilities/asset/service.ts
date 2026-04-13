import { ToolResponse } from '../../mcp/interface';
import {
    AssetCapability,
    AssetCreateInput,
    AssetDeleteInput,
    AssetModifyInput,
    AssetQueryInput,
    AssetRefreshInput,
} from './interface';
import { AssetBridgeDriver } from '../../editor-bridge/asset/contract';
import * as path from 'path';

export class AssetService implements AssetCapability {
    constructor(private readonly driver: AssetBridgeDriver) {}

    async query(input: AssetQueryInput): Promise<ToolResponse> { return this.handleQuery(input); }
    async create(input: AssetCreateInput): Promise<ToolResponse> { return this.handleCreate(input); }
    async modify(input: AssetModifyInput): Promise<ToolResponse> { return this.handleModify(input); }
    async delete(input: AssetDeleteInput): Promise<ToolResponse> { return this.handleDelete(input); }
    async refresh(input: AssetRefreshInput): Promise<ToolResponse> { return this.handleRefresh(input); }

    // ==================== query ====================

    private async handleQuery(args: any): Promise<ToolResponse> {
        const { uuid, path: assetPath, name, action } = args;
        if (action === 'db_ready') return this.queryAssetDbReady();
        if (action === 'dependencies') return this.getAssetDependencies(uuid || assetPath, args.direction);
        if (action === 'unused') return this.getUnusedAssets(args.folder || args.directory, args.excludeDirectories);
        if (uuid && (!action || action === 'info')) return this.queryByUuid(uuid, args.includeSubAssets);
        if (assetPath && (!action || action === 'info')) return this.queryByPath(assetPath, args.includeSubAssets);
        if (name) return this.findByName(name, args);
        return this.listAssets(args.type, args.folder);
    }

    private async queryAssetDbReady(): Promise<ToolResponse> {
        try {
            const ready = await this.driver.queryReady();
            return { success: true, data: { ready, message: ready ? 'Asset database is ready' : 'Asset database is not ready' } };
        } catch (err: any) { return { success: false, error: err.message }; }
    }

    private async getAssetDependencies(urlOrUUID: string, direction: string = 'dependencies'): Promise<ToolResponse> {
        try {
            const assetInfo = await this.driver.resolveAssetInfo(urlOrUUID);
            if (!assetInfo) return { success: false, error: `Asset ${urlOrUUID} not found` };

            const normalizedDirection = (direction || 'dependencies').toLowerCase();
            if (!['dependencies', 'dependents', 'both'].includes(normalizedDirection)) {
                return { success: false, error: `Unknown direction: ${direction}` };
            }

            const data: any = { uuid: assetInfo.uuid, name: assetInfo.name, path: (assetInfo as any).url || assetInfo.path, type: assetInfo.type, direction: normalizedDirection };

            if (normalizedDirection === 'dependencies' || normalizedDirection === 'both') {
                const dependencies = await this.driver.collectAssetDependencies(assetInfo);
                data.dependencies = dependencies;
                data.dependencyCount = dependencies.length;
            }

            if (normalizedDirection === 'dependents' || normalizedDirection === 'both') {
                const allAssetsResponse = await this.listAssets('all', 'db://assets');
                const allAssets = allAssetsResponse.success ? (allAssetsResponse.data?.assets as any[] || []) : [];
                const dependents = await this.driver.findAssetDependents(assetInfo.uuid, (assetInfo as any).url || assetInfo.path, allAssets);
                data.dependents = dependents;
                data.dependentCount = dependents.length;
            }

            return { success: true, data };
        } catch (err: any) { return { success: false, error: `Dependency analysis failed: ${err.message}` }; }
    }

    private async getUnusedAssets(directory: string = 'db://assets', excludeDirectories: string[] = []): Promise<ToolResponse> {
        try {
            const scopeDirectory = this.normalizeDbUrl(directory || 'db://assets');
            const excludeSet = new Set((excludeDirectories || []).map(dir => this.normalizeDbUrl(dir)));

            const allAssetsResponse = await this.listAssets('all', 'db://assets');
            if (!allAssetsResponse.success || !allAssetsResponse.data?.assets) {
                return { success: false, error: allAssetsResponse.error || 'Failed to query project assets' };
            }

            const allAssets = allAssetsResponse.data.assets as any[];
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
                success: true,
                data: {
                    directory: scopeDirectory, excludeDirectories: Array.from(excludeSet),
                    totalAssets: allAssets.length, referencedCount: referencedUuids.size,
                    unusedCount: unused.length, unused,
                    note: 'Basic reference scan across text assets, prefabs and materials. Scripts and scenes are excluded from unused results because scripts are imported and scenes are entry assets.',
                },
            };
        } catch (err: any) { return { success: false, error: `Unused asset detection failed: ${err.message}` }; }
    }

    private async queryByUuid(uuid: string, includeSubAssets: boolean = true): Promise<ToolResponse> {
        try {
            const url = await this.driver.queryAssetUrl(uuid);
            if (!url) return { success: false, error: 'Asset not found for given UUID' };
            return this.queryByPath(url, includeSubAssets);
        } catch (err: any) { return { success: false, error: err.message }; }
    }

    private async queryByPath(assetPath: string, includeSubAssets: boolean = true): Promise<ToolResponse> {
        try {
            const assetInfo: any = await this.driver.queryAssetInfo(assetPath);
            if (!assetInfo) return { success: false, error: 'Asset not found' };

            const info: any = {
                name: assetInfo.name, uuid: assetInfo.uuid, path: assetInfo.url,
                type: assetInfo.type, size: assetInfo.size, isDirectory: assetInfo.isDirectory,
            };
            if (assetInfo.meta) info.meta = { ver: assetInfo.meta.ver, importer: assetInfo.meta.importer };

            info.subAssets = [];
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
                        if (subAssetUrl) info.subAssets.push({ type: subAsset.type, uuid: subAsset.uuid, url: subAssetUrl, suffix: subAsset.suffix });
                    } catch { /* Sub-asset doesn't exist */ }
                }
            }

            return { success: true, data: info };
        } catch (err: any) { return { success: false, error: err.message }; }
    }

    private async findByName(name: string, args: any): Promise<ToolResponse> {
        const { exactMatch = false, type: assetType = 'all', folder = 'db://assets', maxResults = 20 } = args;
        try {
            const allAssetsResponse = await this.listAssets(assetType, folder);
            if (!allAssetsResponse.success || !allAssetsResponse.data) return { success: false, error: `Failed to get assets: ${allAssetsResponse.error}` };

            const allAssets = allAssetsResponse.data.assets as any[];
            const matchedAssets: any[] = [];
            for (const asset of allAssets) {
                const matches = exactMatch ? asset.name === name : asset.name.toLowerCase().includes(name.toLowerCase());
                if (matches) {
                    try {
                        const detailResponse = await this.queryByPath(asset.path, false);
                        matchedAssets.push(detailResponse.success ? { ...asset, details: detailResponse.data } : asset);
                    } catch { matchedAssets.push(asset); }
                    if (matchedAssets.length >= maxResults) break;
                }
            }

            return { success: true, data: { searchTerm: name, exactMatch, assetType, folder, totalFound: matchedAssets.length, maxResults, assets: matchedAssets, message: `Found ${matchedAssets.length} assets matching '${name}'` } };
        } catch (error: any) { return { success: false, error: `Asset search failed: ${error.message}` }; }
    }

    private async listAssets(type: string = 'all', folder: string = 'db://assets'): Promise<ToolResponse> {
        try {
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
                if (filtered.length > 0) return { success: true, data: { type: type || 'all', folder, count: filtered.length, assets: filtered } };
            }

            return { success: true, data: { type: type || 'all', folder, count: assets.length, assets } };
        } catch (err: any) { return { success: false, error: err.message }; }
    }

    // ==================== create ====================

    private async handleCreate(args: any): Promise<ToolResponse> {
        const { action, targetPath } = args;
        switch (action) {
            case 'create': return this.createAsset(targetPath, args.content, args.overwrite);
            case 'import':
                if (args.sources) return this.batchImportAssets(args.sources, targetPath, args.overwrite);
                return this.importAsset(args.sourcePath, targetPath);
            default: return { success: false, error: `Unknown create action: ${action}` };
        }
    }

    private async createAsset(url: string, content: string | null = null, overwrite: boolean = false): Promise<ToolResponse> {
        try {
            const result = await this.driver.createAsset({ url, content: content ?? '', overwrite, rename: !overwrite });
            return { success: true, data: { uuid: result?.uuid, url: result?.url || url, message: content === null ? 'Folder created successfully' : 'File created successfully' } };
        } catch (err: any) { return { success: false, error: err.message }; }
    }

    private async importAsset(sourcePath: string, targetPath: string): Promise<ToolResponse> {
        if (!this.driver.fileExists(sourcePath)) return { success: false, error: 'Source file not found' };
        const fileName = path.basename(sourcePath);
        const target = targetPath.startsWith('db://') ? targetPath : `db://assets/${targetPath}`;
        try {
            const result = await this.driver.importAsset({ source: sourcePath, target: `${target}/${fileName}` });
            return { success: true, data: { uuid: result.uuid, path: result.url, message: `Asset imported: ${fileName}` } };
        } catch (err: any) { return { success: false, error: err.message }; }
    }

    private async batchImportAssets(sources: any, targetDirectory: string, _overwrite: boolean = false): Promise<ToolResponse> {
        try {
            const { sourceDirectory, fileFilter = [], recursive = false } = sources;
            if (!this.driver.fileExists(sourceDirectory)) return { success: false, error: 'Source directory does not exist' };

            const files = this.driver.getFilesFromDirectory(sourceDirectory, fileFilter, recursive);
            const importResults: any[] = [];
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

            return { success: true, data: { totalFiles: files.length, successCount, errorCount, results: importResults, message: `Batch import completed: ${successCount} success, ${errorCount} errors` } };
        } catch (err: any) { return { success: false, error: err.message }; }
    }

    // ==================== modify ====================

    private async handleModify(args: any): Promise<ToolResponse> {
        switch (args.action) {
            case 'move': return this.moveAsset(args.source, args.target);
            case 'copy': return this.copyAsset(args.source, args.target);
            case 'save': return this.saveAsset(args.url, args.content);
            case 'reimport': return this.reimportAsset(args.url || args.path);
            case 'save_meta': return this.saveAssetMeta(args.uuid || args.url, args.content || JSON.stringify(args.meta));
            case 'compress': return this.compressTextures();
            default: return { success: false, error: `Unknown modify action: ${args.action}` };
        }
    }

    private async moveAsset(source: string, target: string): Promise<ToolResponse> {
        try {
            const result = await this.driver.moveAsset({ source, target });
            return { success: true, data: { uuid: result?.uuid, url: result?.url, source, target, message: 'Asset moved successfully' } };
        } catch (err: any) { return { success: false, error: err.message }; }
    }

    private async copyAsset(source: string, target: string): Promise<ToolResponse> {
        try {
            const result = await this.driver.copyAsset({ source, target });
            return { success: true, data: { uuid: result?.uuid, url: result?.url, source, target, message: 'Asset copied successfully' } };
        } catch (err: any) { return { success: false, error: err.message }; }
    }

    private async saveAsset(url: string, content: string): Promise<ToolResponse> {
        try {
            const result = await this.driver.saveAsset({ url, content });
            return { success: true, data: { uuid: result?.uuid, url: result?.url || url, message: 'Asset saved successfully' } };
        } catch (err: any) { return { success: false, error: err.message }; }
    }

    private async reimportAsset(url: string): Promise<ToolResponse> {
        try {
            await this.driver.reimportAsset(url);
            return { success: true, data: { url, message: 'Asset reimported successfully' } };
        } catch (err: any) { return { success: false, error: err.message }; }
    }

    private async saveAssetMeta(urlOrUUID: string, content: string): Promise<ToolResponse> {
        try {
            const result = await this.driver.saveAssetMeta({ urlOrUuid: urlOrUUID, content });
            return { success: true, data: { uuid: result?.uuid, url: result?.url, message: 'Asset meta saved successfully' } };
        } catch (err: any) { return { success: false, error: err.message }; }
    }

    private async compressTextures(): Promise<ToolResponse> {
        return { success: false, error: 'Texture compression requires image processing capabilities not available in current Cocos Creator MCP implementation.' };
    }

    // ==================== delete ====================

    private async handleDelete(args: any): Promise<ToolResponse> {
        const urls = Array.isArray(args.urls) ? args.urls : [args.urls];
        if (urls.length === 1) {
            try {
                await this.driver.deleteAsset(urls[0]);
                return { success: true, data: { url: urls[0], message: 'Asset deleted successfully' } };
            } catch (err: any) { return { success: false, error: err.message }; }
        }

        const deleteResults: any[] = [];
        let successCount = 0, errorCount = 0;
        for (const url of urls) {
            try { await this.driver.deleteAsset(url); deleteResults.push({ url, success: true }); successCount++; }
            catch (err: any) { deleteResults.push({ url, success: false, error: err.message }); errorCount++; }
        }
        return { success: true, data: { totalAssets: urls.length, successCount, errorCount, results: deleteResults, message: `Batch delete completed: ${successCount} success, ${errorCount} errors` } };
    }

    // ==================== refresh ====================

    private async handleRefresh(args: any): Promise<ToolResponse> {
        const action = args.action || 'refresh';
        switch (action) {
            case 'refresh': return this.refreshAssets(args.path || args.directory);
            case 'generate_url': return this.generateAvailableUrl(args.path || args.url);
            case 'open_external': return this.openAssetExternal(args.uuid || args.path);
            case 'export_manifest': return this.exportAssetManifest(args.directory, args.format, args.includeMetadata);
            case 'validate_refs': return this.validateAssetReferences(args.directory);
            default: return { success: false, error: `Unknown refresh action: ${action}` };
        }
    }

    private async refreshAssets(folder?: string): Promise<ToolResponse> {
        try { await this.driver.refreshAsset(folder || 'db://assets'); return { success: true, message: `Assets refreshed in: ${folder || 'db://assets'}` }; }
        catch (err: any) { return { success: false, error: err.message }; }
    }

    private async generateAvailableUrl(url: string): Promise<ToolResponse> {
        try {
            const availableUrl = await this.driver.generateAvailableUrl(url);
            return { success: true, data: { originalUrl: url, availableUrl, message: availableUrl === url ? 'URL is available' : 'Generated new available URL' } };
        } catch (err: any) { return { success: false, error: err.message }; }
    }

    private async openAssetExternal(urlOrUUID: string): Promise<ToolResponse> {
        try { await this.driver.openAsset(urlOrUUID); return { success: true, message: 'Asset opened with external program' }; }
        catch (err: any) { return { success: false, error: err.message }; }
    }

    private async exportAssetManifest(directory: string = 'db://assets', format: string = 'json', includeMetadata: boolean = true): Promise<ToolResponse> {
        try {
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

            return { success: true, data: { directory, format, assetCount: manifest.length, includeMetadata, manifest: exportData, message: `Asset manifest exported with ${manifest.length} assets` } };
        } catch (err: any) { return { success: false, error: err.message }; }
    }

    private async validateAssetReferences(directory: string = 'db://assets'): Promise<ToolResponse> {
        try {
            const assets = await this.driver.queryAssets({ pattern: `${directory}/**/*` });
            const brokenReferences: any[] = [];
            let validCount = 0;
            for (const asset of assets) {
                try { const info = await this.driver.queryAssetInfo((asset as any).url ?? asset.path); if (info) validCount++; }
                catch (err) { brokenReferences.push({ url: (asset as any).url, uuid: asset.uuid, name: asset.name, error: (err as Error).message }); }
            }
            return { success: true, data: { directory, totalAssets: assets.length, validReferences: validCount, brokenReferences: brokenReferences.length, brokenAssets: brokenReferences, message: `Validation completed: ${brokenReferences.length} broken references found` } };
        } catch (err: any) { return { success: false, error: err.message }; }
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
