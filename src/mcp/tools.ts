/* eslint-disable @typescript-eslint/no-explicit-any */
import { GitService } from '../services/gitService';
import * as vscode from 'vscode';

export type ShelvesInput = {
    repoPath?: string;
    maxShelves?: number;
    maxFilesPerShelf?: number;
};

export type CommitExplainInput = {
    repoPath?: string;
    commitId: string;
    maxFiles?: number;
};

export type ShelfFile = {
    path: string;
    status: string;
    additions: number;
    deletions: number;
    oldPath?: string;
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
        name: 'gitmaster_commit_explain',
        description:
            'Open/focus GitMaster Commit Details for a commit and return commit metadata + changed files so the agent can summarize the change.',
        inputSchema: {
            type: 'object',
            properties: {
                repoPath: {
                    type: 'string',
                    description: 'Path to a file/folder in the git repo (defaults to workspace/active editor)'
                },
                commitId: { type: 'string', description: 'Commit hash (full or short)' },
                maxFiles: { type: 'number', description: 'Max changed files to return (default 200)' }
            },
            required: ['commitId']
        }
    },
    {
        name: 'gitmaster_show_git_graph',
        description: 'Open/focus GitMaster Git Graph view in VS Code.',
        inputSchema: {
            type: 'object',
            properties: {
                repoPath: { type: 'string', description: 'Path to a file/folder in the git repo (defaults to workspace/active editor)' }
            },
            required: []
        }
    },
    {
        name: 'gitmaster_shelves',
        description: 'Open/focus GitMaster Shelves view in VS Code and return shelves (git stashes) with their files.',
        inputSchema: {
            type: 'object',
            properties: {
                repoPath: { type: 'string', description: 'Path to a file/folder in the git repo (defaults to workspace/active editor)' },
                maxShelves: { type: 'number', description: 'Max shelves to return (default 50)' },
                maxFilesPerShelf: { type: 'number', description: 'Max files per shelf (default 500)' }
            },
            required: []
        }
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
    /**
     * Optional UI action only available inside the extension host.
     */
    openGitGraph?: (repoRoot: string) => Promise<void>;
    /**
     * Optional UI action only available inside the extension host.
     */
    openCommitDetails?: (commitInfo: any, repoRoot: string) => Promise<void>;
};

export async function handleGitMasterMcpToolCall(
    name: string,
    args: any,
    deps: GitMasterMcpDeps
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
    if (name === 'gitmaster_commit_explain') {
        const payload = await getCommitExplainPayload(
            {
                repoPath: args?.repoPath,
                commitId: String(args?.commitId ?? ''),
                maxFiles: args?.maxFiles
            },
            deps
        );

        if (deps.openCommitDetails) {
            await deps.openCommitDetails(payload.commit, payload.repoRoot);
        }

        return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
    }

    if (name === 'gitmaster_show_git_graph') {
        if (!deps.openGitGraph) {
            throw new Error('gitmaster_show_git_graph is only available inside the VS Code extension host');
        }
        const repoRoot = await resolveRepoRoot(args?.repoPath ?? deps.defaultRepoPath, deps.gitService);
        await deps.openGitGraph(repoRoot);
        return { content: [{ type: 'text', text: 'ok' }] };
    }

    if (name === 'gitmaster_shelves') {
        if (!deps.openShelvesView) {
            throw new Error('gitmaster_shelves is only available inside the VS Code extension host');
        }
        const shelves = await listShelves(
            {
                repoPath: args?.repoPath,
                maxShelves: args?.maxShelves,
                maxFilesPerShelf: args?.maxFilesPerShelf
            },
            deps
        );
        await deps.openShelvesView();
        return { content: [{ type: 'text', text: JSON.stringify(shelves, null, 2) }] };
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
    input: ShelvesInput,
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
                deletions: f.deletions,
                oldPath: (f as any).oldPath
            }))
        });
    }

    return shelves;
}

async function getCommitExplainPayload(
    input: CommitExplainInput,
    deps: Omit<GitMasterMcpDeps, 'openShelvesView'>
): Promise<{
    repoRoot: string;
    commit: any;
    files: Array<any>;
    totals: { fileCount: number; totalAdditions: number; totalDeletions: number };
    agentInstruction: string;
    warning?: string;
}> {
    const commitId = input.commitId?.trim();
    if (!commitId) {
        throw new Error('commitId is required');
    }

    const repoRoot = await resolveRepoRoot(input.repoPath ?? deps.defaultRepoPath, deps.gitService);
    // MCP should be responsive even on very large repos/commits.
    // Use shorter timeouts than the general GitExecutor default.
    const commitInfo = await deps.gitService.getCommitInfo(commitId, repoRoot, { timeoutMs: 10_000 });
    if (!commitInfo) {
        throw new Error(`Commit not found in repo: ${commitId}`);
    }

    const maxFiles = clamp(input.maxFiles ?? 200, 1, 2000);
    // Rename detection (-M) can be extremely expensive on big commits; it's not required for an "explain".
    let warning: string | undefined;
    let changedFiles: any[] = [];
    try {
        changedFiles = await deps.gitService.getChangedFilesInCommit(commitInfo.hash, repoRoot, {
            timeoutMs: 15_000,
            detectRenames: false
        });
    } catch (err: any) {
        warning =
            `Failed to compute changed files within time limits. ` +
            `Commit metadata is returned, but file list is empty. ` +
            `Error: ${err?.message ?? String(err)}`;
        changedFiles = [];
    }

    const files = changedFiles.slice(0, maxFiles).map(f => ({
        path: (f as any).path,
        oldPath: (f as any).oldPath,
        status: (f as any).status,
        additions: (f as any).additions ?? 0,
        deletions: (f as any).deletions ?? 0
    }));

    const totals = files.reduce(
        (acc, f) => {
            acc.fileCount += 1;
            acc.totalAdditions += Number(f.additions) || 0;
            acc.totalDeletions += Number(f.deletions) || 0;
            return acc;
        },
        { fileCount: 0, totalAdditions: 0, totalDeletions: 0 }
    );

    const agentInstruction =
        'GitMaster Commit Details view has been opened/focused. Inspect the changed files and diff, then summarize what the commit did using both the commit message and the actual file changes.';

    return {
        repoRoot,
        commit: {
            hash: commitInfo.hash,
            shortHash: commitInfo.shortHash,
            message: commitInfo.message,
            author: commitInfo.author,
            date: commitInfo.date,
            relativeDate: (commitInfo as any).relativeDate ?? commitInfo.date
        },
        files,
        totals,
        agentInstruction,
        ...(warning ? { warning } : {})
    };
}

async function resolveRepoRoot(repoPath: string | undefined, gitService: GitService): Promise<string> {
    const candidate = repoPath?.trim() ? repoPath.trim() : (vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd());
    const resolved = await gitService.getRepoRoot(candidate, { timeoutMs: 5_000 });
    if (!resolved) {
        throw new Error(`repoPath is not inside a git repository: ${candidate}`);
    }
    return resolved;
}

function clamp(n: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, n));
}

