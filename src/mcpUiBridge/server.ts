/* eslint-disable @typescript-eslint/no-explicit-any */
import * as http from 'http';
import * as vscode from 'vscode';
import { GitService } from '../services/gitService';
import { listShelves } from '../mcp/tools/shelves';

export type GitMasterUiMcpBridgeOptions = {
    host?: string;
    port?: number;
};

/**
 * Starts a minimal MCP server (SSE over localhost) inside the VS Code extension host.
 *
 * Why: This runs inside the extension host, so it:
 * - Doesn't need Node.js in PATH
 * - Has access to vscode.commands and other extension APIs
 * - Can access git services directly
 * - Starts automatically with the extension
 */
export async function startGitMasterUiMcpBridge(
    context: vscode.ExtensionContext,
    options: GitMasterUiMcpBridgeOptions = {}
): Promise<{ host: string; port: number }> {
    // Dynamic import keeps this resilient to ESM/CJS nuances in the MCP SDK.
    const sdkServer: any = await import('@modelcontextprotocol/sdk/server/index.js');
    const sdkSse: any = await import('@modelcontextprotocol/sdk/server/sse.js');
    const sdkTypes: any = await import('@modelcontextprotocol/sdk/types.js');

    const { Server } = sdkServer;
    const { SSEServerTransport } = sdkSse;
    const {
        ListToolsRequestSchema,
        CallToolRequestSchema,
        ListResourcesRequestSchema,
        ReadResourceRequestSchema
    } = sdkTypes;

    const mcpServer = new Server(
        { name: 'gitmaster', version: '0.0.0' },
        { capabilities: { tools: {}, resources: {} } }
    );

    // Tools handler
    mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
        return {
            tools: [
                {
                    name: 'gitmaster_shelves_list',
                    description: 'List GitMaster Shelves (git stashes) with their display name and files.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            repoPath: { type: 'string', description: 'Path to the git repo root (defaults to workspace)' },
                            maxShelves: { type: 'number', description: 'Max shelves to return (default 50)' },
                            maxFilesPerShelf: { type: 'number', description: 'Max files per shelf (default 500)' }
                        },
                        required: []
                    }
                },
                {
                    name: 'gitmaster_open_shelves_view',
                    description: 'Open/focus GitMaster Shelves view in VS Code.',
                    inputSchema: { type: 'object', properties: {}, required: [] }
                }
            ]
        };
    });

    mcpServer.setRequestHandler(CallToolRequestSchema, async (request: any) => {
        const name = request.params?.name;
        const args = request.params?.arguments ?? {};

        if (name === 'gitmaster_shelves_list') {
            const gitService = new GitService();
            // Use workspace folder if available, otherwise use cwd
            const repoPath = args.repoPath || (vscode.workspace.workspaceFolders?.[0]?.uri.fsPath);
            const shelves = await listShelves({ ...args, repoPath }, { gitService });

            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify(shelves, null, 2)
                    }
                ]
            };
        }

        if (name === 'gitmaster_open_shelves_view') {
            await vscode.commands.executeCommand('gitmaster.openShelvesView');
            return {
                content: [
                    {
                        type: 'text',
                        text: 'ok'
                    }
                ]
            };
        }

        throw new Error(`Unknown tool: ${String(name)}`);
    });

    // Resources handler: expose shelves as MCP resources
    mcpServer.setRequestHandler(ListResourcesRequestSchema, async () => {
        const gitService = new GitService();
        const repoPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        const shelves = await listShelves({ maxShelves: 50, repoPath }, { gitService });

        return {
            resources: shelves.map(shelf => ({
                uri: `gitmaster://shelves/${encodeURIComponent(shelf.index)}`,
                name: shelf.name || shelf.index,
                description: `Git stash ${shelf.index} from branch ${shelf.branch || 'unknown'} (${shelf.fileCount} files)`,
                mimeType: 'application/json'
            }))
        };
    });

    mcpServer.setRequestHandler(ReadResourceRequestSchema, async (request: any) => {
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
        const repoPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        const shelves = await listShelves({ maxShelves: 200, repoPath }, { gitService });

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

    const host = options.host ?? '127.0.0.1';
    const port = options.port ?? 8765;
    const ssePath = '/sse';
    const postPath = '/message';

    let transport: any | undefined;

    const server = http.createServer(async (req, res) => {
        try {
            const url = new URL(req.url ?? '/', `http://${req.headers.host ?? host}`);

            if (req.method === 'GET' && url.pathname === ssePath) {
                transport = new SSEServerTransport(postPath, res);
                await mcpServer.connect(transport);
                return;
            }

            if (req.method === 'POST' && url.pathname === postPath) {
                if (!transport) {
                    res.statusCode = 409;
                    res.end('No active SSE transport');
                    return;
                }
                await transport.handlePostMessage(req, res);
                return;
            }

            res.statusCode = 404;
            res.end('Not found');
        } catch (err: any) {
            res.statusCode = 500;
            res.end(`Error: ${err?.message ?? String(err)}`);
        }
    });

    const startedPort = await new Promise<number>((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
            const addr = server.address();
            if (addr && typeof addr === 'object') {
                resolve(addr.port);
            } else {
                resolve(port);
            }
        });
    });

    context.subscriptions.push(
        new vscode.Disposable(() => {
            try {
                server.close();
            } catch {
                // ignore
            }
        })
    );

    console.log(`GitMaster UI MCP bridge listening on http://${host}:${startedPort}${ssePath}`);
    return { host, port: startedPort };
}



