/* eslint-disable @typescript-eslint/no-explicit-any */
import { GitService } from '../services/gitService';
import * as vscode from 'vscode';

export type ShelvesListInput = {
    repoPath?: string;
    maxShelves?: number;
    maxFilesPerShelf?: number;
};

export type ShelfFile = {
    path: string;
    status: string;
    additions: number;
    deletions: number;
};

export type Shelf = {
    index: string;
    name: string;
    branch: string;
    fileCount: number;
    files: ShelfFile[];
};

export const GITMASTER_MCP_TOOLS = [
    {
        name: 'gitmaster_shelves_list',
        description: 'List GitMaster Shelves (git stashes) with their display name and files.',
        inputSchema: {
            type: 'object',
            properties: {
                repoPath: { type: 'string', description: 'Path to a file/folder in the git repo (defaults to workspace/active editor)' },
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
] as const;

export type GitMasterMcpToolName = (typeof GITMASTER_MCP_TOOLS)[number]['name'];

export type GitMasterMcpDeps = {
    gitService: GitService;
    /**
     * Default path to resolve repo root from when the caller didn't provide repoPath.
     * In the extension host, this should be workspace folder or active editor path.
     */
    defaultRepoPath?: string;
    /**
     * Optional UI action only available inside the extension host.
     */
    openShelvesView?: () => Promise<void>;
};

export async function handleGitMasterMcpToolCall(
    name: string,
    args: any,
    deps: GitMasterMcpDeps
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
    if (name === 'gitmaster_shelves_list') {
        const shelves = await listShelves(
            {
                repoPath: args?.repoPath,
                maxShelves: args?.maxShelves,
                maxFilesPerShelf: args?.maxFilesPerShelf
            },
            deps
        );
        return { content: [{ type: 'text', text: JSON.stringify(shelves, null, 2) }] };
    }

    if (name === 'gitmaster_open_shelves_view') {
        if (!deps.openShelvesView) {
            throw new Error('gitmaster_open_shelves_view is only available inside the VS Code extension host');
        }
        await deps.openShelvesView();
        return { content: [{ type: 'text', text: 'ok' }] };
    }

    throw new Error(`Unknown tool: ${String(name)}`);
}

export async function listGitMasterMcpResources(
    deps: Omit<GitMasterMcpDeps, 'openShelvesView'>
): Promise<{
    resources: Array<{
        uri: string;
        name: string;
        description?: string;
        mimeType?: string;
    }>;
}> {
    const shelves = await listShelves({ maxShelves: 50 }, deps);
    return {
        resources: shelves.map(shelf => ({
            uri: `gitmaster://shelves/${encodeURIComponent(shelf.index)}`,
            name: shelf.name || shelf.index,
            description: `Git stash ${shelf.index} from branch ${shelf.branch || 'unknown'} (${shelf.fileCount} files)`,
            mimeType: 'application/json'
        }))
    };
}

export async function readGitMasterMcpResource(
    uri: string,
    deps: Omit<GitMasterMcpDeps, 'openShelvesView'>
): Promise<{
    contents: Array<{
        uri: string;
        mimeType?: string;
        text: string;
    }>;
}> {
    const match = uri.match(/^gitmaster:\/\/shelves\/(.+)$/);
    if (!match) {
        throw new Error(`Invalid resource URI: ${uri}. Expected format: gitmaster://shelves/{index}`);
    }

    const shelfIndex = decodeURIComponent(match[1]);
    const shelves = await listShelves({ maxShelves: 200 }, deps);
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
}

async function listShelves(
    input: ShelvesListInput,
    deps: Omit<GitMasterMcpDeps, 'openShelvesView'>
): Promise<Shelf[]> {
    const gitService = deps.gitService;
    const repoRoot = await resolveRepoRoot(input.repoPath ?? deps.defaultRepoPath, gitService);

    const maxShelves = clamp(input.maxShelves ?? 50, 1, 200);
    const maxFilesPerShelf = clamp(input.maxFilesPerShelf ?? 500, 1, 5000);

    const stashes = await gitService.getStashes(repoRoot);
    const limitedStashes = stashes.slice(0, maxShelves);

    const shelves: Shelf[] = [];
    for (const stash of limitedStashes) {
        const files = await gitService.getStashFiles(stash.index, repoRoot);
        shelves.push({
            index: stash.index,
            name: stash.message, // Matches Shelves view label
            branch: stash.branch,
            fileCount: stash.fileCount,
            files: files.slice(0, maxFilesPerShelf).map(f => ({
                path: f.path,
                status: f.status,
                additions: f.additions,
                deletions: f.deletions
            }))
        });
    }

    return shelves;
}

async function resolveRepoRoot(repoPath: string | undefined, gitService: GitService): Promise<string> {
    const candidate = repoPath?.trim() ? repoPath.trim() : (vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd());
    const resolved = await gitService.getRepoRoot(candidate);
    if (!resolved) {
        throw new Error(`repoPath is not inside a git repository: ${candidate}`);
    }
    return resolved;
}

function clamp(n: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, n));
}

