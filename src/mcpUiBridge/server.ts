/* eslint-disable @typescript-eslint/no-explicit-any */
import * as http from 'http';
import * as crypto from 'crypto';
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
 * Starts a minimal MCP server inside the VS Code extension host.
 * Supports both StreamableHTTP (preferred) and SSE (deprecated fallback) transports.
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
    const sdkStreamableHttp: any = await import('@modelcontextprotocol/sdk/server/streamableHttp.js');
    const sdkSse: any = await import('@modelcontextprotocol/sdk/server/sse.js');
    const sdkTypes: any = await import('@modelcontextprotocol/sdk/types.js');

    const { Server } = sdkServer;
    const { StreamableHTTPServerTransport } = sdkStreamableHttp;
    const { SSEServerTransport } = sdkSse;
    const {
        ListToolsRequestSchema,
        CallToolRequestSchema,
        ListResourcesRequestSchema,
        ReadResourceRequestSchema
    } = sdkTypes;

    const defaultRepoPath =
        vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ??
        vscode.window.activeTextEditor?.document.uri.fsPath;

    const logger = options.log ?? ((msg: string) => console.log(msg));

    // Helper to create and configure an MCP server with all handlers
    function createConfiguredMcpServer(): any {
        const mcpServer = new Server(
            { name: 'gitmaster', version: '0.0.0' },
            { capabilities: { tools: {}, resources: {} } }
        );

        mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
            return { tools: [...GITMASTER_MCP_TOOLS] };
        });

        mcpServer.setRequestHandler(CallToolRequestSchema, async (request: any) => {
            const name = request.params?.name;
            const args = request.params?.arguments ?? {};
            const startedAt = Date.now();
            const toolName = String(name);
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

        return mcpServer;
    }

    const host = options.host ?? '127.0.0.1';
    const port = options.port ?? 8765;

    // Paths
    const mcpPath = '/mcp';  // StreamableHTTP endpoint (preferred)
    const ssePath = '/sse';  // SSE endpoint (deprecated fallback)
    const postPath = '/message';  // SSE message endpoint

    // StreamableHTTP transport state (per session)
    const streamableTransports = new Map<string, any>();

    // SSE transport state (single connection)
    let sseTransport: any | undefined;
    let sseConnectPromise: Promise<void> | undefined;

    const server = http.createServer(async (req, res) => {
        try {
            const url = new URL(req.url ?? '/', `http://${req.headers.host ?? host}`);

            // ========================================
            // StreamableHTTP transport (preferred)
            // ========================================
            if (url.pathname === mcpPath) {
                const sessionId = req.headers['mcp-session-id'] as string | undefined;

                // Reuse existing transport for the session, or create new one
                let transport = sessionId ? streamableTransports.get(sessionId) : undefined;

                if (!transport) {
                    transport = new StreamableHTTPServerTransport({
                        sessionIdGenerator: () => crypto.randomUUID() as string,
                        onsessioninitialized: (id: string) => {
                            logger(`[MCP] StreamableHTTP session initialized: ${id}`);
                            streamableTransports.set(id, transport);
                        }
                    });

                    // Clean up when transport closes
                    transport.onclose = () => {
                        if (sessionId) {
                            streamableTransports.delete(sessionId);
                        }
                    };

                    // Connect MCP server to transport
                    const mcpServer = createConfiguredMcpServer();
                    await mcpServer.connect(transport);
                }

                // Read request body for POST requests
                let body: any = undefined;
                if (req.method === 'POST') {
                    const chunks: Buffer[] = [];
                    for await (const chunk of req) {
                        chunks.push(chunk);
                    }
                    const rawBody = Buffer.concat(chunks).toString('utf-8');
                    if (rawBody) {
                        try {
                            body = JSON.parse(rawBody);
                        } catch {
                            body = rawBody;
                        }
                    }
                }

                await transport.handleRequest(req, res, body);
                return;
            }

            // ========================================
            // SSE transport (deprecated fallback)
            // ========================================
            if (req.method === 'GET' && url.pathname === ssePath) {
                // If a previous SSE connection exists, drop it so reconnects don't wedge the bridge.
                try {
                    sseTransport?.close?.();
                } catch {
                    // ignore
                }
                sseTransport = undefined;
                sseConnectPromise = undefined;

                sseTransport = new SSEServerTransport(postPath, res);
                res.on('close', () => {
                    sseTransport = undefined;
                    sseConnectPromise = undefined;
                });

                const mcpServer = createConfiguredMcpServer();
                sseConnectPromise = mcpServer.connect(sseTransport);
                await sseConnectPromise;
                return;
            }

            if (req.method === 'POST' && url.pathname === postPath) {
                // Wait for SSE connection to be established if in progress
                if (sseConnectPromise) {
                    try {
                        await sseConnectPromise;
                    } catch {
                        // ignore - transport may have closed
                    }
                }
                if (!sseTransport) {
                    res.statusCode = 409;
                    res.end('No active SSE transport');
                    return;
                }
                await sseTransport.handlePostMessage(req, res);
                return;
            }

            res.statusCode = 404;
            res.end('Not found');
        } catch (err: any) {
            logger(`[MCP] Error handling request: ${err?.message ?? String(err)}`);
            if (!res.headersSent) {
                res.statusCode = 500;
                res.end(`Error: ${err?.message ?? String(err)}`);
            }
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
                // Clean up all transports
                for (const transport of streamableTransports.values()) {
                    try {
                        transport?.close?.();
                    } catch {
                        // ignore
                    }
                }
                streamableTransports.clear();
                try {
                    sseTransport?.close?.();
                } catch {
                    // ignore
                }
                server.close();
            } catch {
                // ignore
            }
        })
    );

    logger(`GitMaster MCP server listening on http://${host}:${startedPort}${mcpPath}`);
    return { host, port: startedPort };
}
