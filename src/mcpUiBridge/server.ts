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

        return handleGitMasterMcpToolCall(String(name), args, {
            gitService: new GitService(),
            defaultRepoPath,
            openShelvesView: async () => {
                await vscode.commands.executeCommand('gitmaster.openShelvesView');
            }
        });
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



