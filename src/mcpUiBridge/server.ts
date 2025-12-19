/* eslint-disable @typescript-eslint/no-explicit-any */
import * as http from 'http';
import * as vscode from 'vscode';

export type GitMasterUiMcpBridgeOptions = {
    host?: string;
    port?: number;
};

/**
 * Starts a minimal MCP server (SSE over localhost) inside the VS Code extension host.
 *
 * Why: UI actions (like focusing views) require `vscode.commands`, which an external stdio MCP
 * process cannot access.
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
    const { ListToolsRequestSchema, CallToolRequestSchema } = sdkTypes;

    const mcpServer = new Server(
        { name: 'gitmaster-ui', version: '0.0.0' },
        { capabilities: { tools: {} } }
    );

    mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
        return {
            tools: [
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
        if (name !== 'gitmaster_open_shelves_view') {
            throw new Error(`Unknown tool: ${String(name)}`);
        }

        await vscode.commands.executeCommand('gitmaster.openShelvesView');

        return {
            content: [
                {
                    type: 'text',
                    text: 'ok'
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



