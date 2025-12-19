/* eslint-disable @typescript-eslint/no-explicit-any */
import * as http from 'http';
import * as vscode from 'vscode';
import { GitService } from '../services/gitService';
import {
    GITMASTER_MCP_TOOLS,
    handleGitMasterMcpToolCall,
    listGitMasterMcpResources,
    readGitMasterMcpResource
} from '../mcp/tools';

export type GitMasterUiMcpBridgeOptions = {
    host?: string;
    port?: number;
    /**
     * Optional logger for diagnostics. In the extension host we usually pass an OutputChannel logger.
     */
    log?: (message: string) => void;
    /**
     * Optional UI helpers (extension-host only). MCP tools can remain usable without these,
     * but any tool that needs UI will throw if its callback isn't provided.
     */
    openShelvesView?: () => Promise<void>;
    openGitGraph?: (repoRoot: string) => Promise<void>;
    openCommitDetails?: (commitInfo: any, repoRoot: string) => Promise<void>;
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

    const defaultRepoPath =
        vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ??
        vscode.window.activeTextEditor?.document.uri.fsPath;

    // Tools handler
    mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
        return {
            tools: [...GITMASTER_MCP_TOOLS]
        };
    });

    mcpServer.setRequestHandler(CallToolRequestSchema, async (request: any) => {
        const name = request.params?.name;
        const args = request.params?.arguments ?? {};

        const startedAt = Date.now();
        const toolName = String(name);
        const logger = options.log ?? ((msg: string) => console.log(msg));
        logger(`[MCP] callTool start: ${toolName}`);

        try {
            return await handleGitMasterMcpToolCall(toolName, args, {
                gitService: new GitService(),
            defaultRepoPath,
            openShelvesView: options.openShelvesView,
            openGitGraph: options.openGitGraph,
            openCommitDetails: options.openCommitDetails
            });
        } finally {
            const ms = Date.now() - startedAt;
            if (ms >= 2000) {
                logger(`[MCP] callTool done: ${toolName} (${ms}ms)`);
            }
        }
    });

    // Resources handler: expose shelves as MCP resources
    mcpServer.setRequestHandler(ListResourcesRequestSchema, async () => {
        return listGitMasterMcpResources({
            gitService: new GitService(),
            defaultRepoPath
        });
    });

    mcpServer.setRequestHandler(ReadResourceRequestSchema, async (request: any) => {
        const uri = request.params?.uri;
        if (!uri || typeof uri !== 'string') {
            throw new Error('Resource URI is required');
        }
        return readGitMasterMcpResource(uri, {
            gitService: new GitService(),
            defaultRepoPath
        });
    });

    const host = options.host ?? '127.0.0.1';
    const port = options.port ?? 8765;
    const ssePath = '/sse';
    const postPath = '/message';

    let transport: any | undefined;
    let isConnected = false;

    const server = http.createServer(async (req, res) => {
        try {
            const url = new URL(req.url ?? '/', `http://${req.headers.host ?? host}`);

            if (req.method === 'GET' && url.pathname === ssePath) {
                // If a previous SSE connection exists, drop it so reconnects don't wedge the bridge.
                // (Cursor typically maintains a single connection, but reconnects can happen.)
                try {
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
                    transport?.close?.();
                } catch {
                    // ignore
                }
                transport = undefined;
                isConnected = false;

                transport = new SSEServerTransport(postPath, res);
                res.on('close', () => {
                    transport = undefined;
                    isConnected = false;
                });

                if (!isConnected) {
                    await mcpServer.connect(transport);
                    isConnected = true;
                }
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



