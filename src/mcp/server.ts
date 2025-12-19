/* eslint-disable @typescript-eslint/no-explicit-any */
import { GitService } from '../services/gitService';
import { listShelves, ShelvesListInput } from './tools/shelves';

/**
 * GitMaster MCP (data) server — stdio transport.
 *
 * Notes:
 * - We keep SDK imports dynamic so this file is resilient if the SDK changes import paths slightly.
 * - This file is intended to be executed via `node out/mcp/server.js`.
 */
export async function startGitMasterDataMcpServer(): Promise<void> {
    // Dynamic import to avoid hard-coupling compile-time to ESM/CJS nuances.
    const sdkServer: any = await import('@modelcontextprotocol/sdk/server/index.js');
    const sdkStdio: any = await import('@modelcontextprotocol/sdk/server/stdio.js');
    const sdkTypes: any = await import('@modelcontextprotocol/sdk/types.js');

    const { Server } = sdkServer;
    const { StdioServerTransport } = sdkStdio;
    const { ListToolsRequestSchema, CallToolRequestSchema } = sdkTypes;

    const server = new Server(
        { name: 'gitmaster', version: '0.0.0' },
        { capabilities: { tools: {} } }
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



