import { ToolDefinition, ToolResponse, ToolExecutor, AssetInfo } from '../../types';
import * as fs from 'fs';
import * as path from 'path';

/**
 * AssetToolsV2 — 资源工具 v2
 * 合并自 ProjectTools (资源部分) + AssetAdvancedTools
 * 5 个工具: query, create, modify, delete, refresh
 */
export class AssetToolsV2 implements ToolExecutor {

    getTools(): ToolDefinition[] {
        return [
            {
                name: 'query',
                description: 'Query asset information. action=list: list assets with optional type/folder filter. action=info (default when uuid/path/name provided): get asset details. action=dependencies: get asset dependencies. action=unused: find unused assets. action=db_ready: check if asset database is ready.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        uuid: { type: 'string', description: 'Asset UUID' },
                        path: { type: 'string', description: 'Asset path in db:// format' },
                        name: { type: 'string', description: 'Asset name for fuzzy search' },
                        type: { type: 'string', description: 'Asset type filter, e.g. cc.ImageAsset' },
                        folder: { type: 'string', description: 'Search directory scope' },
                        action: {
                            type: 'string',
                            enum: ['info', 'list', 'dependencies', 'unused', 'db_ready'],
                            description: 'Query type. Defaults to info when uuid/path/name provided, otherwise list'
                        },
                        exactMatch: { type: 'boolean', description: 'Exact name match when searching by name' },
                        maxResults: { type: 'number', description: 'Max results for name search' },
                        includeSubAssets: { type: 'boolean', description: 'Include sub-assets in info query' },
                        direction: {
                            type: 'string',
                            enum: ['dependents', 'dependencies', 'both'],
                            description: 'Dependency direction for action=dependencies'
                        },
                        excludeDirectories: {
                            type: 'array',
                            items: { type: 'string' },
                            description: 'Directories to exclude for action=unused'
                        }
                    }
                }
            },
            {
                name: 'create',
                description: 'Create or import assets. action=create: create a new asset file or folder. action=import: import asset(s) from external path.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        action: {
                            type: 'string',
                            enum: ['create', 'import'],
                            description: 'create=create new asset, import=import from external path'
                        },
                        targetPath: { type: 'string', description: 'Target path in db:// format' },
                        content: { type: 'string', description: 'File content for action=create (null for folder)' },
                        overwrite: { type: 'boolean', description: 'Overwrite existing file' },
                        sourcePath: { type: 'string', description: 'Source file path for action=import (single file)' },
                        sources: {
                            type: 'object',
                            properties: {
                                sourceDirectory: { type: 'string', description: 'Source directory path' },
                                fileFilter: { type: 'array', items: { type: 'string' }, description: 'File extensions to include' },
                                recursive: { type: 'boolean', description: 'Include subdirectories' }
                            },
                            description: 'Batch import config for action=import'
                        }
                    },
                    required: ['action', 'targetPath']
                }
            },
            {
                name: 'modify',
                description: 'Modify assets. action=move: move asset. action=copy: copy asset. action=save: save asset content. action=reimport: reimport asset. action=save_meta: save asset meta. action=compress: compress textures.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        action: {
                            type: 'string',
                            enum: ['move', 'copy', 'save', 'reimport', 'save_meta', 'compress'],
                            description: 'Operation type'
                        },
                        source: { type: 'string', description: 'Source path for move/copy' },
                        target: { type: 'string', description: 'Target path for move/copy' },
                        overwrite: { type: 'boolean', description: 'Overwrite existing for move/copy' },
                        url: { type: 'string', description: 'Asset URL for save/reimport' },
                        content: { type: 'string', description: 'Content for save/save_meta' },
                        uuid: { type: 'string', description: 'Asset UUID for save_meta' },
                        meta: { type: 'object', description: 'Meta data for save_meta' },
                        path: { type: 'string', description: 'Asset path for reimport' },
                        texturePaths: { type: 'array', items: { type: 'string' }, description: 'Texture paths for compress' },
                        format: { type: 'string', description: 'Compression format for compress' }
                    },
                    required: ['action']
                }
            },
            {
                name: 'delete',
                description: 'Delete one or more assets by URL.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        urls: {
                            oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
                            description: 'Asset URL(s) to delete, supports single string or array'
                        }
                    },
                    required: ['urls']
                }
            },
            {
                name: 'refresh',
                description: 'Asset auxiliary operations. action=refresh (default): refresh asset database. action=generate_url: generate available URL. action=open_external: open asset externally. action=export_manifest: export asset manifest. action=validate_refs: validate asset references.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        action: {
                            type: 'string',
                            enum: ['refresh', 'generate_url', 'open_external', 'export_manifest', 'validate_refs'],
                            description: 'Operation type. Default: refresh'
                        },
                        path: { type: 'string', description: 'Asset path' },
                        uuid: { type: 'string', description: 'Asset UUID' },
                        format: {
                            type: 'string',
                            enum: ['json', 'csv', 'xml'],
                            description: 'Export format for export_manifest'
                        },
                        includeMetadata: { type: 'boolean', description: 'Include metadata in export_manifest' },
                        directory: { type: 'string', description: 'Directory for validate_refs/export_manifest' }
                    }
                }
            }
        ];
    }

    async execute(toolName: string, args: any): Promise<ToolResponse> {
        switch (toolName) {
            case 'query':
                return await this.handleQuery(args);
            case 'create':
                return await this.handleCreate(args);
            case 'modify':
                return await this.handleModify(args);
            case 'delete':
                return await this.handleDelete(args);
            case 'refresh':
                return await this.handleRefresh(args);
            default:
                throw new Error(`Unknown tool: ${toolName}`);
        }
    }

    // ==================== query ====================

    private async handleQuery(args: any): Promise<ToolResponse> {
        const { uuid, path: assetPath, name, action } = args;

        // Route by priority
        if (action === 'db_ready') {
            return await this.queryAssetDbReady();
        }
        if (action === 'dependencies') {
            return await this.getAssetDependencies(uuid || assetPath, args.direction);
        }
        if (action === 'unused') {
            return await this.getUnusedAssets(args.folder || args.directory, args.excludeDirectories);
        }
        if (uuid && (!action || action === 'info')) {
            return await this.queryByUuid(uuid, args.includeSubAssets);
        }
        if (assetPath && (!action || action === 'info')) {
            return await this.queryByPath(assetPath, args.includeSubAssets);
        }
        if (name) {
            return await this.findByName(name, args);
        }
        // Default: list
        return await this.listAssets(args.type, args.folder);
    }

    private async queryAssetDbReady(): Promise<ToolResponse> {
        return new Promise((resolve) => {
            Editor.Message.request('asset-db', 'query-ready').then((ready: boolean) => {
                resolve({
                    success: true,
                    data: {
                        ready,
                        message: ready ? 'Asset database is ready' : 'Asset database is not ready'
                    }
                });
            }).catch((err: Error) => {
                resolve({ success: false, error: err.message });
            });
        });
    }

    private async getAssetDependencies(urlOrUUID: string, direction: string = 'dependencies'): Promise<ToolResponse> {
        return {
            success: false,
            error: 'Asset dependency analysis requires additional APIs not available in current Cocos Creator MCP implementation. Consider using the Editor UI for dependency analysis.'
        };
    }

    private async getUnusedAssets(directory: string = 'db://assets', excludeDirectories: string[] = []): Promise<ToolResponse> {
        return {
            success: false,
            error: 'Unused asset detection requires comprehensive project analysis not available in current Cocos Creator MCP implementation. Consider using the Editor UI or third-party tools for unused asset detection.'
        };
    }

    private async queryByUuid(uuid: string, includeSubAssets: boolean = true): Promise<ToolResponse> {
        try {
            // First get url from uuid
            const url: string | null = await Editor.Message.request('asset-db', 'query-url', uuid);
            if (!url) {
                return { success: false, error: 'Asset not found for given UUID' };
            }
            return await this.queryByPath(url, includeSubAssets);
        } catch (err: any) {
            return { success: false, error: err.message };
        }
    }

    private async queryByPath(assetPath: string, includeSubAssets: boolean = true): Promise<ToolResponse> {
        try {
            const assetInfo: any = await Editor.Message.request('asset-db', 'query-asset-info', assetPath);
            if (!assetInfo) {
                return { success: false, error: 'Asset not found' };
            }

            const info: any = {
                name: assetInfo.name,
                uuid: assetInfo.uuid,
                path: assetInfo.url,
                type: assetInfo.type,
                size: assetInfo.size,
                isDirectory: assetInfo.isDirectory
            };

            if (assetInfo.meta) {
                info.meta = {
                    ver: assetInfo.meta.ver,
                    importer: assetInfo.meta.importer
                };
            }

            // Sub-assets for image types
            info.subAssets = [];
            if (includeSubAssets && (assetInfo.type === 'cc.ImageAsset' || assetPath.match(/\.(png|jpg|jpeg|gif|tga|bmp|psd)$/i))) {
                const baseUuid = assetInfo.uuid;
                const possibleSubAssets = [
                    { type: 'spriteFrame', uuid: `${baseUuid}@f9941`, suffix: '@f9941' },
                    { type: 'texture', uuid: `${baseUuid}@6c48a`, suffix: '@6c48a' },
                    { type: 'texture2D', uuid: `${baseUuid}@6c48a`, suffix: '@6c48a' }
                ];

                for (const subAsset of possibleSubAssets) {
                    try {
                        const subAssetUrl = await Editor.Message.request('asset-db', 'query-url', subAsset.uuid);
                        if (subAssetUrl) {
                            info.subAssets.push({
                                type: subAsset.type,
                                uuid: subAsset.uuid,
                                url: subAssetUrl,
                                suffix: subAsset.suffix
                            });
                        }
                    } catch {
                        // Sub-asset doesn't exist
                    }
                }
            }

            return { success: true, data: info };
        } catch (err: any) {
            return { success: false, error: err.message };
        }
    }

    private async findByName(name: string, args: any): Promise<ToolResponse> {
        const { exactMatch = false, type: assetType = 'all', folder = 'db://assets', maxResults = 20 } = args;
        try {
            const allAssetsResponse = await this.listAssets(assetType, folder);
            if (!allAssetsResponse.success || !allAssetsResponse.data) {
                return { success: false, error: `Failed to get assets: ${allAssetsResponse.error}` };
            }

            const allAssets = allAssetsResponse.data.assets as any[];
            const matchedAssets: any[] = [];

            for (const asset of allAssets) {
                const assetName = asset.name;
                const matches = exactMatch
                    ? assetName === name
                    : assetName.toLowerCase().includes(name.toLowerCase());

                if (matches) {
                    try {
                        const detailResponse = await this.queryByPath(asset.path, false);
                        if (detailResponse.success) {
                            matchedAssets.push({ ...asset, details: detailResponse.data });
                        } else {
                            matchedAssets.push(asset);
                        }
                    } catch {
                        matchedAssets.push(asset);
                    }

                    if (matchedAssets.length >= maxResults) break;
                }
            }

            return {
                success: true,
                data: {
                    searchTerm: name,
                    exactMatch,
                    assetType,
                    folder,
                    totalFound: matchedAssets.length,
                    maxResults,
                    assets: matchedAssets,
                    message: `Found ${matchedAssets.length} assets matching '${name}'`
                }
            };
        } catch (error: any) {
            return { success: false, error: `Asset search failed: ${error.message}` };
        }
    }

    private async listAssets(type: string = 'all', folder: string = 'db://assets'): Promise<ToolResponse> {
        return new Promise((resolve) => {
            let pattern = `${folder}/**/*`;
            const normalizedType = this.normalizeAssetTypeKey(type);

            if (normalizedType && normalizedType !== 'all') {
                const typeExtensions: Record<string, string> = {
                    'scene': '.scene',
                    'sceneasset': '.scene',
                    'prefab': '.prefab',
                    'script': '.{ts,js}',
                    'texture': '.{png,jpg,jpeg,gif,tga,bmp,psd}',
                    'imageasset': '.{png,jpg,jpeg,gif,tga,bmp,psd}',
                    'texture2d': '.{png,jpg,jpeg,gif,tga,bmp,psd}',
                    'material': '.mtl',
                    'mesh': '.{fbx,obj,dae}',
                    'audio': '.{mp3,ogg,wav,m4a}',
                    'audioclip': '.{mp3,ogg,wav,m4a}',
                    'animation': '.{anim,clip}',
                    'animationclip': '.{anim,clip}',
                    'spriteframe': '.{png,jpg,jpeg}',
                    'spriteatlas': '.plist',
                    'font': '.{ttf,fnt,bmfont}'
                };
                const extension = typeExtensions[normalizedType];
                if (extension) {
                    pattern = `${folder}/**/*${extension}`;
                }
            }

            Editor.Message.request('asset-db', 'query-assets', { pattern }).then((results: any[]) => {
                const assets = results.map(asset => ({
                    name: asset.name,
                    uuid: asset.uuid,
                    path: asset.url,
                    type: asset.type,
                    size: asset.size || 0,
                    isDirectory: asset.isDirectory || false
                }));

                if (normalizedType && normalizedType !== 'all') {
                    const filtered = assets.filter(asset => this.matchesAssetType(asset.type, normalizedType));
                    if (filtered.length > 0) {
                        resolve({
                            success: true,
                            data: {
                                type: type || 'all',
                                folder,
                                count: filtered.length,
                                assets: filtered
                            }
                        });
                        return;
                    }
                }

                resolve({
                    success: true,
                    data: {
                        type: type || 'all',
                        folder,
                        count: assets.length,
                        assets
                    }
                });
            }).catch((err: Error) => {
                resolve({ success: false, error: err.message });
            });
        });
    }

    private normalizeAssetTypeKey(type: any): string {
        return String(type ?? '').trim().toLowerCase().replace(/^cc\./, '');
    }

    private getAssetTypeAliases(type: string): Set<string> {
        const normalized = this.normalizeAssetTypeKey(type);
        const aliasGroups: Record<string, string[]> = {
            scene: ['scene', 'sceneasset'],
            sceneasset: ['scene', 'sceneasset'],
            prefab: ['prefab'],
            script: ['script'],
            texture: ['texture', 'imageasset', 'texture2d'],
            imageasset: ['texture', 'imageasset', 'texture2d'],
            texture2d: ['texture', 'imageasset', 'texture2d'],
            material: ['material'],
            mesh: ['mesh'],
            audio: ['audio', 'audioclip'],
            audioclip: ['audio', 'audioclip'],
            animation: ['animation', 'animationclip'],
            animationclip: ['animation', 'animationclip'],
            spriteframe: ['spriteframe'],
            spriteatlas: ['spriteatlas'],
            font: ['font']
        };

        return new Set(aliasGroups[normalized] || [normalized]);
    }

    private matchesAssetType(assetType: string, requestedType: string): boolean {
        const assetAliases = this.getAssetTypeAliases(assetType);
        const requestedAliases = this.getAssetTypeAliases(requestedType);
        for (const alias of requestedAliases) {
            if (assetAliases.has(alias)) {
                return true;
            }
        }
        return false;
    }

    // ==================== create ====================

    private async handleCreate(args: any): Promise<ToolResponse> {
        const { action, targetPath } = args;
        switch (action) {
            case 'create':
                return await this.createAsset(targetPath, args.content, args.overwrite);
            case 'import':
                if (args.sources) {
                    return await this.batchImportAssets(args.sources, targetPath, args.overwrite);
                }
                return await this.importAsset(args.sourcePath, targetPath);
            default:
                return { success: false, error: `Unknown create action: ${action}` };
        }
    }

    private async createAsset(url: string, content: string | null = null, overwrite: boolean = false): Promise<ToolResponse> {
        return new Promise((resolve) => {
            const options = { overwrite, rename: !overwrite };
            Editor.Message.request('asset-db', 'create-asset', url, content, options).then((result: any) => {
                resolve({
                    success: true,
                    data: {
                        uuid: result?.uuid,
                        url: result?.url || url,
                        message: content === null ? 'Folder created successfully' : 'File created successfully'
                    }
                });
            }).catch((err: Error) => {
                resolve({ success: false, error: err.message });
            });
        });
    }

    private async importAsset(sourcePath: string, targetPath: string): Promise<ToolResponse> {
        return new Promise((resolve) => {
            if (!fs.existsSync(sourcePath)) {
                resolve({ success: false, error: 'Source file not found' });
                return;
            }

            const fileName = path.basename(sourcePath);
            const target = targetPath.startsWith('db://') ? targetPath : `db://assets/${targetPath}`;

            Editor.Message.request('asset-db', 'import-asset', sourcePath, `${target}/${fileName}`).then((result: any) => {
                resolve({
                    success: true,
                    data: {
                        uuid: result.uuid,
                        path: result.url,
                        message: `Asset imported: ${fileName}`
                    }
                });
            }).catch((err: Error) => {
                resolve({ success: false, error: err.message });
            });
        });
    }

    private async batchImportAssets(sources: any, targetDirectory: string, overwrite: boolean = false): Promise<ToolResponse> {
        try {
            const { sourceDirectory, fileFilter = [], recursive = false } = sources;

            if (!fs.existsSync(sourceDirectory)) {
                return { success: false, error: 'Source directory does not exist' };
            }

            const files = this.getFilesFromDirectory(sourceDirectory, fileFilter, recursive);
            const importResults: any[] = [];
            let successCount = 0;
            let errorCount = 0;

            for (const filePath of files) {
                try {
                    const fileName = path.basename(filePath);
                    const targetPath = `${targetDirectory}/${fileName}`;
                    const result = await Editor.Message.request('asset-db', 'import-asset',
                        filePath, targetPath, { overwrite, rename: !overwrite });

                    importResults.push({ source: filePath, target: targetPath, success: true, uuid: result?.uuid });
                    successCount++;
                } catch (err: any) {
                    importResults.push({ source: filePath, success: false, error: err.message });
                    errorCount++;
                }
            }

            return {
                success: true,
                data: {
                    totalFiles: files.length,
                    successCount,
                    errorCount,
                    results: importResults,
                    message: `Batch import completed: ${successCount} success, ${errorCount} errors`
                }
            };
        } catch (err: any) {
            return { success: false, error: err.message };
        }
    }

    private getFilesFromDirectory(dirPath: string, fileFilter: string[], recursive: boolean): string[] {
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

    // ==================== modify ====================

    private async handleModify(args: any): Promise<ToolResponse> {
        switch (args.action) {
            case 'move':
                return await this.moveAsset(args.source, args.target, args.overwrite);
            case 'copy':
                return await this.copyAsset(args.source, args.target, args.overwrite);
            case 'save':
                return await this.saveAsset(args.url, args.content);
            case 'reimport':
                return await this.reimportAsset(args.url || args.path);
            case 'save_meta':
                return await this.saveAssetMeta(args.uuid || args.url, args.content || JSON.stringify(args.meta));
            case 'compress':
                return await this.compressTextures(args.texturePaths, args.format);
            default:
                return { success: false, error: `Unknown modify action: ${args.action}` };
        }
    }

    private async moveAsset(source: string, target: string, overwrite: boolean = false): Promise<ToolResponse> {
        return new Promise((resolve) => {
            const options = { overwrite, rename: !overwrite };
            Editor.Message.request('asset-db', 'move-asset', source, target, options).then((result: any) => {
                resolve({
                    success: true,
                    data: {
                        uuid: result?.uuid,
                        url: result?.url,
                        source,
                        target,
                        message: 'Asset moved successfully'
                    }
                });
            }).catch((err: Error) => {
                resolve({ success: false, error: err.message });
            });
        });
    }

    private async copyAsset(source: string, target: string, overwrite: boolean = false): Promise<ToolResponse> {
        return new Promise((resolve) => {
            const options = { overwrite, rename: !overwrite };
            Editor.Message.request('asset-db', 'copy-asset', source, target, options).then((result: any) => {
                resolve({
                    success: true,
                    data: {
                        uuid: result?.uuid,
                        url: result?.url,
                        source,
                        target,
                        message: 'Asset copied successfully'
                    }
                });
            }).catch((err: Error) => {
                resolve({ success: false, error: err.message });
            });
        });
    }

    private async saveAsset(url: string, content: string): Promise<ToolResponse> {
        return new Promise((resolve) => {
            Editor.Message.request('asset-db', 'save-asset', url, content).then((result: any) => {
                resolve({
                    success: true,
                    data: {
                        uuid: result?.uuid,
                        url: result?.url || url,
                        message: 'Asset saved successfully'
                    }
                });
            }).catch((err: Error) => {
                resolve({ success: false, error: err.message });
            });
        });
    }

    private async reimportAsset(url: string): Promise<ToolResponse> {
        return new Promise((resolve) => {
            Editor.Message.request('asset-db', 'reimport-asset', url).then(() => {
                resolve({
                    success: true,
                    data: { url, message: 'Asset reimported successfully' }
                });
            }).catch((err: Error) => {
                resolve({ success: false, error: err.message });
            });
        });
    }

    private async saveAssetMeta(urlOrUUID: string, content: string): Promise<ToolResponse> {
        return new Promise((resolve) => {
            Editor.Message.request('asset-db', 'save-asset-meta', urlOrUUID, content).then((result: any) => {
                resolve({
                    success: true,
                    data: {
                        uuid: result?.uuid,
                        url: result?.url,
                        message: 'Asset meta saved successfully'
                    }
                });
            }).catch((err: Error) => {
                resolve({ success: false, error: err.message });
            });
        });
    }

    private async compressTextures(texturePaths: string[], format: string): Promise<ToolResponse> {
        return {
            success: false,
            error: 'Texture compression requires image processing capabilities not available in current Cocos Creator MCP implementation. Use the Editor\'s built-in texture compression settings or external tools.'
        };
    }

    // ==================== delete ====================

    private async handleDelete(args: any): Promise<ToolResponse> {
        const urls = Array.isArray(args.urls) ? args.urls : [args.urls];

        if (urls.length === 1) {
            return new Promise((resolve) => {
                Editor.Message.request('asset-db', 'delete-asset', urls[0]).then(() => {
                    resolve({
                        success: true,
                        data: { url: urls[0], message: 'Asset deleted successfully' }
                    });
                }).catch((err: Error) => {
                    resolve({ success: false, error: err.message });
                });
            });
        }

        // Batch delete
        const deleteResults: any[] = [];
        let successCount = 0;
        let errorCount = 0;

        for (const url of urls) {
            try {
                await Editor.Message.request('asset-db', 'delete-asset', url);
                deleteResults.push({ url, success: true });
                successCount++;
            } catch (err: any) {
                deleteResults.push({ url, success: false, error: err.message });
                errorCount++;
            }
        }

        return {
            success: true,
            data: {
                totalAssets: urls.length,
                successCount,
                errorCount,
                results: deleteResults,
                message: `Batch delete completed: ${successCount} success, ${errorCount} errors`
            }
        };
    }

    // ==================== refresh ====================

    private async handleRefresh(args: any): Promise<ToolResponse> {
        const action = args.action || 'refresh';
        switch (action) {
            case 'refresh':
                return await this.refreshAssets(args.path || args.directory);
            case 'generate_url':
                return await this.generateAvailableUrl(args.path || args.url);
            case 'open_external':
                return await this.openAssetExternal(args.uuid || args.path);
            case 'export_manifest':
                return await this.exportAssetManifest(args.directory, args.format, args.includeMetadata);
            case 'validate_refs':
                return await this.validateAssetReferences(args.directory);
            default:
                return { success: false, error: `Unknown refresh action: ${action}` };
        }
    }

    private async refreshAssets(folder?: string): Promise<ToolResponse> {
        return new Promise((resolve) => {
            const targetPath = folder || 'db://assets';
            Editor.Message.request('asset-db', 'refresh-asset', targetPath).then(() => {
                resolve({ success: true, message: `Assets refreshed in: ${targetPath}` });
            }).catch((err: Error) => {
                resolve({ success: false, error: err.message });
            });
        });
    }

    private async generateAvailableUrl(url: string): Promise<ToolResponse> {
        return new Promise((resolve) => {
            Editor.Message.request('asset-db', 'generate-available-url', url).then((availableUrl: string) => {
                resolve({
                    success: true,
                    data: {
                        originalUrl: url,
                        availableUrl,
                        message: availableUrl === url ? 'URL is available' : 'Generated new available URL'
                    }
                });
            }).catch((err: Error) => {
                resolve({ success: false, error: err.message });
            });
        });
    }

    private async openAssetExternal(urlOrUUID: string): Promise<ToolResponse> {
        return new Promise((resolve) => {
            Editor.Message.request('asset-db', 'open-asset', urlOrUUID).then(() => {
                resolve({ success: true, message: 'Asset opened with external program' });
            }).catch((err: Error) => {
                resolve({ success: false, error: err.message });
            });
        });
    }

    private async exportAssetManifest(directory: string = 'db://assets', format: string = 'json', includeMetadata: boolean = true): Promise<ToolResponse> {
        try {
            const assets = await Editor.Message.request('asset-db', 'query-assets', { pattern: `${directory}/**/*` });
            const manifest: any[] = [];

            for (const asset of assets) {
                const manifestEntry: any = {
                    name: asset.name,
                    url: asset.url,
                    uuid: asset.uuid,
                    type: asset.type,
                    size: (asset as any).size || 0,
                    isDirectory: asset.isDirectory || false
                };

                if (includeMetadata) {
                    try {
                        const assetInfo = await Editor.Message.request('asset-db', 'query-asset-info', asset.url);
                        if (assetInfo?.meta) {
                            manifestEntry.meta = assetInfo.meta;
                        }
                    } catch {
                        // Skip metadata if not available
                    }
                }

                manifest.push(manifestEntry);
            }

            let exportData: string;
            switch (format) {
                case 'csv':
                    exportData = this.convertToCSV(manifest);
                    break;
                case 'xml':
                    exportData = this.convertToXML(manifest);
                    break;
                default:
                    exportData = JSON.stringify(manifest, null, 2);
            }

            return {
                success: true,
                data: {
                    directory,
                    format,
                    assetCount: manifest.length,
                    includeMetadata,
                    manifest: exportData,
                    message: `Asset manifest exported with ${manifest.length} assets`
                }
            };
        } catch (err: any) {
            return { success: false, error: err.message };
        }
    }

    private async validateAssetReferences(directory: string = 'db://assets'): Promise<ToolResponse> {
        try {
            const assets = await Editor.Message.request('asset-db', 'query-assets', { pattern: `${directory}/**/*` });
            const brokenReferences: any[] = [];
            const validCount = { value: 0 };

            for (const asset of assets) {
                try {
                    const assetInfo = await Editor.Message.request('asset-db', 'query-asset-info', asset.url);
                    if (assetInfo) {
                        validCount.value++;
                    }
                } catch (err) {
                    brokenReferences.push({
                        url: asset.url,
                        uuid: asset.uuid,
                        name: asset.name,
                        error: (err as Error).message
                    });
                }
            }

            return {
                success: true,
                data: {
                    directory,
                    totalAssets: assets.length,
                    validReferences: validCount.value,
                    brokenReferences: brokenReferences.length,
                    brokenAssets: brokenReferences,
                    message: `Validation completed: ${brokenReferences.length} broken references found`
                }
            };
        } catch (err: any) {
            return { success: false, error: err.message };
        }
    }

    private convertToCSV(data: any[]): string {
        if (data.length === 0) return '';
        const headers = Object.keys(data[0]);
        const csvRows = [headers.join(',')];
        for (const row of data) {
            const values = headers.map(header => {
                const value = row[header];
                return typeof value === 'object' ? JSON.stringify(value) : String(value);
            });
            csvRows.push(values.join(','));
        }
        return csvRows.join('\n');
    }

    private convertToXML(data: any[]): string {
        let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<assets>\n';
        for (const item of data) {
            xml += '  <asset>\n';
            for (const [key, value] of Object.entries(item)) {
                const xmlValue = typeof value === 'object'
                    ? JSON.stringify(value)
                    : String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                xml += `    <${key}>${xmlValue}</${key}>\n`;
            }
            xml += '  </asset>\n';
        }
        xml += '</assets>';
        return xml;
    }
}
