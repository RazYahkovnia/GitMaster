/* eslint-disable @typescript-eslint/no-explicit-any */
import * as path from 'path';
import * as fs from 'fs';
import { GitService } from '../services/gitService';
import { listShelves, ShelvesListInput } from './tools/shelves';

/**
 * GitMaster MCP (data) server — stdio transport.
 *
 * Notes:
 * - We keep SDK imports dynamic so this file is resilient if the SDK changes import paths slightly.
 * - This file is intended to be executed via `node out/mcp/server.js`.
 * - Ensures node_modules resolution works when run from extension directory.
 */
function findNodeModules(startPath: string): string | null {
    let current = path.resolve(startPath);
    while (current !== path.dirname(current)) {
        const nodeModulesPath = path.join(current, 'node_modules');
        if (fs.existsSync(nodeModulesPath)) {
            return nodeModulesPath;
        }
        current = path.dirname(current);
    }
    return null;
}

export async function startGitMasterDataMcpServer(): Promise<void> {
    // Ensure node_modules can be resolved (important when running from extension install directory)
    const scriptDir = __dirname;
    const nodeModulesPath = findNodeModules(scriptDir);

    // Dynamic import to avoid hard-coupling compile-time to ESM/CJS nuances.
    // Use Function constructor to preserve dynamic import() syntax (works for both ESM and CJS packages)
    // This ensures TypeScript doesn't convert await import() to require()
    const dynamicImport = new Function('specifier', 'return import(specifier)');

    let sdkServer: any;
    let sdkStdio: any;
    let sdkTypes: any;

    try {
        sdkServer = await dynamicImport('@modelcontextprotocol/sdk/server/index.js');
        sdkStdio = await dynamicImport('@modelcontextprotocol/sdk/server/stdio.js');
        sdkTypes = await dynamicImport('@modelcontextprotocol/sdk/types.js');
    } catch (err: any) {
        // Provide helpful error message if module resolution fails
        const errorMsg = err?.message || String(err);
        const isModuleNotFound = errorMsg.includes('Cannot find module') ||
            errorMsg.includes('MODULE_NOT_FOUND') ||
            errorMsg.includes('Cannot resolve module');

        if (isModuleNotFound) {
            const helpfulMsg =
                `GitMaster MCP: Cannot find @modelcontextprotocol/sdk package.\n` +
                `This usually means:\n` +
                `1. The extension's dependencies are not installed (run 'npm install' in the extension directory)\n` +
                `2. The extension was not properly packaged with its dependencies\n` +
                `3. Node.js cannot resolve modules from the script location\n\n` +
                `Debug info:\n` +
                `- Script location: ${scriptDir}\n` +
                `- Node modules found at: ${nodeModulesPath || 'none (searched up from script location)'}\n` +
                `- Current working directory: ${process.cwd()}\n` +
                `- Original error: ${errorMsg}`;

            console.error(helpfulMsg);
            throw new Error(helpfulMsg);
        }
        throw err;
    }

    const { Server } = sdkServer;
    const { StdioServerTransport } = sdkStdio;
    const {
        ListToolsRequestSchema,
        CallToolRequestSchema,
        ListResourcesRequestSchema,
        ReadResourceRequestSchema
    } = sdkTypes;

    const server = new Server(
        { name: 'gitmaster-data', version: '0.0.0' },
        { capabilities: { tools: {}, resources: {} } }
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => {
        return {
            tools: [
                {
                    name: 'gitmaster_shelves_list',
                    description: 'List GitMaster Shelves (git stashes) with their display name and files.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            repoPath: { type: 'string', description: 'Path to the git repo root (defaults to cwd)' },
                            maxShelves: { type: 'number', description: 'Max shelves to return (default 50)' },
                            maxFilesPerShelf: { type: 'number', description: 'Max files per shelf (default 500)' }
                        },
                        required: []
                    }
                }
            ]
        };
    });

    server.setRequestHandler(CallToolRequestSchema, async (request: any) => {
        const name = request.params?.name;
        const args = (request.params?.arguments ?? {}) as ShelvesListInput;

        if (name !== 'gitmaster_shelves_list') {
            throw new Error(`Unknown tool: ${String(name)}`);
        }

        const shelves = await listShelves(args, { gitService: new GitService() });
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(shelves, null, 2)
                }
            ]
        };
    });

    // Resource handlers: expose shelves as MCP resources
    server.setRequestHandler(ListResourcesRequestSchema, async () => {
        const gitService = new GitService();
        const shelves = await listShelves({ maxShelves: 50 }, { gitService });

        return {
            resources: shelves.map(shelf => ({
                uri: `gitmaster://shelves/${encodeURIComponent(shelf.index)}`,
                name: shelf.name || shelf.index,
                description: `Git stash ${shelf.index} from branch ${shelf.branch || 'unknown'} (${shelf.fileCount} files)`,
                mimeType: 'application/json'
            }))
        };
    });

    server.setRequestHandler(ReadResourceRequestSchema, async (request: any) => {
        const uri = request.params?.uri;
        if (!uri || typeof uri !== 'string') {
            throw new Error('Resource URI is required');
        }

        // Parse gitmaster://shelves/{index} URIs
        const match = uri.match(/^gitmaster:\/\/shelves\/(.+)$/);
        if (!match) {
            throw new Error(`Invalid resource URI: ${uri}. Expected format: gitmaster://shelves/{index}`);
        }

        const shelfIndex = decodeURIComponent(match[1]);
        const gitService = new GitService();
        const shelves = await listShelves({ maxShelves: 200 }, { gitService });

        const shelf = shelves.find(s => s.index === shelfIndex);
        if (!shelf) {
            throw new Error(`Shelf not found: ${shelfIndex}`);
        }

        return {
            contents: [
                {
                    uri,
                    mimeType: 'application/json',
                    text: JSON.stringify(shelf, null, 2)
                }
            ]
        };
    });

    const transport = new StdioServerTransport();
    await server.connect(transport);
}

if (require.main === module) {
    // eslint-disable-next-line no-console
    startGitMasterDataMcpServer().catch((err: any) => {
        // eslint-disable-next-line no-console
        console.error('GitMaster MCP (data) server failed to start:', err);
        process.exitCode = 1;
    });
}



