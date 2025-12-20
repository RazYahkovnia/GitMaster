/**
 * MCP Server for GitMaster.
 *
 * Runs an HTTP server inside the VS Code extension host that implements
 * the Model Context Protocol (MCP). Supports both StreamableHTTP (preferred)
 * and SSE (deprecated fallback) transports.
 *
 * Benefits of running in extension host:
 * - No Node.js PATH dependency
 * - Direct access to VS Code APIs
 * - Direct access to git services
 * - Starts automatically with the extension
 */

import * as http from 'http';
import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { CommitInfo } from '../types/git';
import { GitService } from '../services/gitService';
import {
    GITMASTER_MCP_TOOLS,
    handleGitMasterMcpToolCall,
    listGitMasterMcpResources,
    readGitMasterMcpResource,
} from './tools';
import { McpDependencies } from './types';
import {
    DEFAULT_HOST,
    DEFAULT_PORT,
    ENDPOINTS,
    SLOW_TOOL_THRESHOLD_MS,
} from './constants';

// ============================================================================
// Types
// ============================================================================

/** Options for configuring the MCP server */
export interface McpServerOptions {
    /** Host to bind to (default: 127.0.0.1) */
    host?: string;
    /** Port to listen on (default: 8765) */
    port?: number;
    /** Logger function for diagnostics */
    log?: (message: string) => void;
    /** UI callback: open the Shelves view */
    openShelvesView?: () => Promise<void>;
    /** UI callback: open the Git Graph view */
    openGitGraph?: (repoRoot: string) => Promise<void>;
    /** UI callback: open Commit Details view */
    openCommitDetails?: (commitInfo: CommitInfo, repoRoot: string) => Promise<void>;
}

/** Logger function type */
type Logger = (message: string) => void;

/**
 * MCP SDK modules - dynamically imported to handle ESM/CJS differences.
 * Using 'any' here because SDK types are complex and we only need a subset.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type McpSdkModules = Record<string, any>;

// ============================================================================
// Public API
// ============================================================================

/**
 * Start the GitMaster MCP server.
 *
 * @param context - VS Code extension context for lifecycle management
 * @param options - Server configuration options
 * @returns The host and port the server is listening on
 */
export async function startGitMasterMcpServer(
    context: vscode.ExtensionContext,
    options: McpServerOptions = {},
): Promise<{ host: string; port: number }> {
    const host = options.host ?? DEFAULT_HOST;
    const port = options.port ?? DEFAULT_PORT;
    const log: Logger = options.log ?? console.log;

    // Load MCP SDK dynamically (handles ESM/CJS nuances)
    const sdk = await loadMcpSdk();

    // Create server factory with dependencies
    const deps = createDependencies(options);
    const createMcpServer = () => createConfiguredServer(sdk, deps, log);

    // Create transport state managers
    const transportState = createTransportState();

    // Create and start HTTP server
    const httpServer = createHttpServer(sdk, createMcpServer, transportState, log, host);
    const startedPort = await startServer(httpServer, host, port);

    // Register cleanup on extension deactivation
    registerCleanup(context, httpServer, transportState);

    log(`GitMaster MCP server listening on http://${host}:${startedPort}${ENDPOINTS.MCP}`);
    return { host, port: startedPort };
}

// ============================================================================
// SDK Loading
// ============================================================================

/**
 * Dynamically import MCP SDK modules.
 * Using dynamic import handles ESM/CJS module format differences.
 */
async function loadMcpSdk(): Promise<McpSdkModules> {
    const [sdkServer, sdkStreamableHttp, sdkSse, sdkTypes] = await Promise.all([
        import('@modelcontextprotocol/sdk/server/index.js'),
        import('@modelcontextprotocol/sdk/server/streamableHttp.js'),
        import('@modelcontextprotocol/sdk/server/sse.js'),
        import('@modelcontextprotocol/sdk/types.js'),
    ]);

    return {
        Server: sdkServer.Server,
        StreamableHTTPServerTransport: sdkStreamableHttp.StreamableHTTPServerTransport,
        SSEServerTransport: sdkSse.SSEServerTransport,
        ListToolsRequestSchema: sdkTypes.ListToolsRequestSchema,
        CallToolRequestSchema: sdkTypes.CallToolRequestSchema,
        ListResourcesRequestSchema: sdkTypes.ListResourcesRequestSchema,
        ReadResourceRequestSchema: sdkTypes.ReadResourceRequestSchema,
    };
}

// ============================================================================
// MCP Server Configuration
// ============================================================================

/**
 * Create MCP dependencies from server options.
 */
function createDependencies(options: McpServerOptions): McpDependencies {
    return {
        gitService: new GitService(),
        defaultRepoPath: getDefaultRepoPath(),
        openShelvesView: options.openShelvesView,
        openGitGraph: options.openGitGraph,
        openCommitDetails: options.openCommitDetails,
    };
}

/**
 * Get the default repository path from workspace or active editor.
 */
function getDefaultRepoPath(): string | undefined {
    return (
        vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ??
        vscode.window.activeTextEditor?.document.uri.fsPath
    );
}

/**
 * Create a fully configured MCP server with all handlers registered.
 */
function createConfiguredServer(
    sdk: McpSdkModules,
    deps: McpDependencies,
    log: Logger,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
    const { Server } = sdk;
    const server = new Server(
        { name: 'gitmaster', version: '0.0.0' },
        { capabilities: { tools: {}, resources: {} } },
    );

    // Register tool handlers
    server.setRequestHandler(sdk.ListToolsRequestSchema, async () => ({
        tools: [...GITMASTER_MCP_TOOLS],
    }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    server.setRequestHandler(sdk.CallToolRequestSchema, async (request: any) => {
        const toolName = String(request.params?.name ?? '');
        const args = request.params?.arguments ?? {};
        return executeToolWithTiming(toolName, args, deps, log);
    });

    // Register resource handlers
    server.setRequestHandler(sdk.ListResourcesRequestSchema, async () => {
        return listGitMasterMcpResources({
            gitService: deps.gitService,
            defaultRepoPath: deps.defaultRepoPath,
        });
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    server.setRequestHandler(sdk.ReadResourceRequestSchema, async (request: any) => {
        const uri = request.params?.uri;
        if (!uri || typeof uri !== 'string') {
            throw new Error('Resource URI is required');
        }
        return readGitMasterMcpResource(uri, {
            gitService: deps.gitService,
            defaultRepoPath: deps.defaultRepoPath,
        });
    });

    return server;
}

/**
 * Execute a tool call with timing instrumentation.
 */
async function executeToolWithTiming(
    toolName: string,
    args: Record<string, unknown>,
    deps: McpDependencies,
    log: Logger,
): Promise<unknown> {
    const startTime = Date.now();
    log(`[MCP] callTool start: ${toolName}`);

    try {
        return await handleGitMasterMcpToolCall(toolName, args, deps);
    } finally {
        const duration = Date.now() - startTime;
        if (duration >= SLOW_TOOL_THRESHOLD_MS) {
            log(`[MCP] callTool done: ${toolName} (${duration}ms)`);
        }
    }
}

// ============================================================================
// Transport State Management
// ============================================================================

/** State for managing MCP transports */
interface TransportState {
    /** StreamableHTTP transports keyed by session ID */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    streamable: Map<string, any>;
    /** Current SSE transport (only one allowed) */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sse: { transport?: any; connectPromise?: Promise<void> };
}

/**
 * Create initial transport state.
 */
function createTransportState(): TransportState {
    return {
        streamable: new Map(),
        sse: {},
    };
}

/**
 * Clean up all transports.
 */
function cleanupTransports(state: TransportState): void {
    // Clean up streamable transports
    for (const transport of state.streamable.values()) {
        safeClose(transport);
    }
    state.streamable.clear();

    // Clean up SSE transport
    safeClose(state.sse.transport);
    state.sse.transport = undefined;
    state.sse.connectPromise = undefined;
}

// ============================================================================
// HTTP Server
// ============================================================================

/**
 * Create the HTTP server with route handlers for MCP transports.
 */
function createHttpServer(
    sdk: McpSdkModules,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    createMcpServer: () => any,
    state: TransportState,
    log: Logger,
    host: string,
): http.Server {
    return http.createServer(async (req, res) => {
        try {
            const url = new URL(req.url ?? '/', `http://${req.headers.host ?? host}`);

            // Route to appropriate handler
            if (url.pathname === ENDPOINTS.MCP) {
                await handleStreamableRequest(req, res, sdk, createMcpServer, state.streamable, log);
            } else if (req.method === 'GET' && url.pathname === ENDPOINTS.SSE) {
                await handleSseConnect(res, sdk, createMcpServer, state.sse);
            } else if (req.method === 'POST' && url.pathname === ENDPOINTS.MESSAGE) {
                await handleSseMessage(req, res, state.sse);
            } else {
                res.statusCode = 404;
                res.end('Not found');
            }
        } catch (err) {
            handleRequestError(err, res, log);
        }
    });
}

/**
 * Handle StreamableHTTP transport requests (preferred transport).
 */
async function handleStreamableRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    sdk: McpSdkModules,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    createMcpServer: () => any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    transports: Map<string, any>,
    log: Logger,
): Promise<void> {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    // Reuse existing transport for session, or create new one
    let transport = sessionId ? transports.get(sessionId) : undefined;

    if (!transport) {
        const { StreamableHTTPServerTransport } = sdk;
        transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => crypto.randomUUID(),
            onsessioninitialized: (id: string) => {
                log(`[MCP] StreamableHTTP session initialized: ${id}`);
                transports.set(id, transport);
            },
        });

        // Clean up on transport close
        transport.onclose = () => {
            if (sessionId) {
                transports.delete(sessionId);
            }
        };

        // Connect MCP server to transport
        const mcpServer = createMcpServer();
        await mcpServer.connect(transport);
    }

    // Parse request body for POST requests
    const body = req.method === 'POST' ? await parseRequestBody(req) : undefined;
    await transport.handleRequest(req, res, body);
}

/**
 * Handle SSE transport connection (deprecated fallback).
 */
async function handleSseConnect(
    res: http.ServerResponse,
    sdk: McpSdkModules,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    createMcpServer: () => any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    state: { transport?: any; connectPromise?: Promise<void> },
): Promise<void> {
    // Close existing connection to allow reconnects
    safeClose(state.transport);
    state.transport = undefined;
    state.connectPromise = undefined;

    const { SSEServerTransport } = sdk;
    state.transport = new SSEServerTransport(ENDPOINTS.MESSAGE, res);

    res.on('close', () => {
        state.transport = undefined;
        state.connectPromise = undefined;
    });

    const mcpServer = createMcpServer();
    state.connectPromise = mcpServer.connect(state.transport);
    await state.connectPromise;
}

/**
 * Handle SSE message POST requests.
 */
async function handleSseMessage(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    state: { transport?: any; connectPromise?: Promise<void> },
): Promise<void> {
    // Wait for SSE connection if in progress
    if (state.connectPromise) {
        try {
            await state.connectPromise;
        } catch {
            // Transport may have closed
        }
    }

    if (!state.transport) {
        res.statusCode = 409;
        res.end('No active SSE transport');
        return;
    }

    await state.transport.handlePostMessage(req, res);
}

/**
 * Handle request errors with logging.
 */
function handleRequestError(
    err: unknown,
    res: http.ServerResponse,
    log: Logger,
): void {
    const message = err instanceof Error ? err.message : String(err);
    log(`[MCP] Error handling request: ${message}`);

    if (!res.headersSent) {
        res.statusCode = 500;
        res.end(`Error: ${message}`);
    }
}

// ============================================================================
// Server Lifecycle
// ============================================================================

/**
 * Start the HTTP server and return the actual port.
 */
function startServer(
    server: http.Server,
    host: string,
    port: number,
): Promise<number> {
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
            const addr = server.address();
            const actualPort = addr && typeof addr === 'object' ? addr.port : port;
            resolve(actualPort);
        });
    });
}

/**
 * Register cleanup handlers for extension deactivation.
 */
function registerCleanup(
    context: vscode.ExtensionContext,
    server: http.Server,
    state: TransportState,
): void {
    context.subscriptions.push(
        new vscode.Disposable(() => {
            cleanupTransports(state);
            try {
                server.close();
            } catch {
                // Ignore cleanup errors
            }
        }),
    );
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Parse HTTP request body as JSON.
 */
async function parseRequestBody(req: http.IncomingMessage): Promise<unknown> {
    const chunks: Uint8Array[] = [];
    for await (const chunk of req) {
        chunks.push(chunk as Uint8Array);
    }

    const rawBody = Buffer.concat(chunks).toString('utf-8');
    if (!rawBody) {
        return undefined;
    }

    try {
        return JSON.parse(rawBody);
    } catch {
        return rawBody;
    }
}

/**
 * Safely close a transport, ignoring errors.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function safeClose(transport: any): void {
    try {
        transport?.close?.();
    } catch {
        // Ignore close errors
    }
}
