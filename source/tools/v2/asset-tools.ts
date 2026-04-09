import { getCapabilityRegistry } from '../../runtime/capability-registry';
import { ToolDefinition, ToolExecutor, ToolResponse } from '../../mcp/interface';

export class AssetToolsV2 implements ToolExecutor {
    private readonly asset = getCapabilityRegistry().asset as any;

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
                return this.asset.query(args);
            case 'create':
                return this.asset.create(args);
            case 'modify':
                return this.asset.modify(args);
            case 'delete':
                return this.asset.delete(args);
            case 'refresh':
                return this.asset.refresh(args);
            default:
                throw new Error(`Unknown tool: ${toolName}`);
        }
    }
}
