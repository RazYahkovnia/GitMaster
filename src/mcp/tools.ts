/**
 * MCP Tool definitions and handlers for GitMaster.
 *
 * This module defines the available MCP tools and implements their handlers.
 * Tools allow AI agents to interact with GitMaster features programmatically.
 */

import * as vscode from 'vscode';
import { ChangedFile, CommitInfo } from '../types/git';
import { GitService } from '../services/gitService';
import {
    ShelvesInput,
    CommitExplainInput,
    FileExpertsInput,
    ShowFileHistoryInput,
    Shelf,
    ShelfFile,
    CommitExplainPayload,
    FileExpertsPayload,
    FileExpert,
    McpToolResponse,
    McpResourcesResponse,
    McpResourceReadResponse,
    McpDependencies,
    McpCoreDependencies,
} from './types';
import {
    SHELVES_LIMITS,
    COMMIT_EXPLAIN_LIMITS,
    FILE_EXPERTS_LIMITS,
    TIMEOUTS,
} from './constants';

// ============================================================================
// Tool Definitions
// ============================================================================

/**
 * MCP tool schemas defining available tools and their parameters.
 * These follow the MCP specification for tool definitions.
 */
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
                    description: 'Path to a file/folder in the git repo (defaults to workspace/active editor)',
                },
                commitId: {
                    type: 'string',
                    description: 'Commit hash (full or short)',
                },
                maxFiles: {
                    type: 'number',
                    description: `Max changed files to return (default ${COMMIT_EXPLAIN_LIMITS.DEFAULT_MAX_FILES})`,
                },
            },
            required: ['commitId'],
        },
    },
    {
        name: 'gitmaster_show_git_graph',
        description: 'Open/focus GitMaster Git Graph view in VS Code.',
        inputSchema: {
            type: 'object',
            properties: {
                repoPath: {
                    type: 'string',
                    description: 'Path to a file/folder in the git repo (defaults to workspace/active editor)',
                },
            },
            required: [],
        },
    },
    {
        name: 'gitmaster_shelves',
        description: 'Open/focus GitMaster Shelves view in VS Code and return shelves (git stashes) with their files.',
        inputSchema: {
            type: 'object',
            properties: {
                repoPath: {
                    type: 'string',
                    description: 'Path to a file/folder in the git repo (defaults to workspace/active editor)',
                },
                maxShelves: {
                    type: 'number',
                    description: `Max shelves to return (default ${SHELVES_LIMITS.DEFAULT_MAX_SHELVES})`,
                },
                maxFilesPerShelf: {
                    type: 'number',
                    description: `Max files per shelf (default ${SHELVES_LIMITS.DEFAULT_MAX_FILES_PER_SHELF})`,
                },
            },
            required: [],
        },
    },
    {
        name: 'gitmaster_file_experts',
        description: 'Get the top contributors/experts for a file based on commit history and line changes. Returns authors sorted by contribution with commit counts and line change statistics. Useful for finding who to ask about a file or who should review changes.',
        inputSchema: {
            type: 'object',
            properties: {
                filePath: {
                    type: 'string',
                    description: 'Path to the file to analyze (absolute or relative to workspace)',
                },
                limit: {
                    type: 'number',
                    description: `Max experts to return (default ${FILE_EXPERTS_LIMITS.DEFAULT_LIMIT}, max ${FILE_EXPERTS_LIMITS.MAX_LIMIT})`,
                },
            },
            required: ['filePath'],
        },
    },
    {
        name: 'gitmaster_show_file_history',
        description: 'Open/focus GitMaster File History view in VS Code for a specific file. Shows the commit history timeline for the file.',
        inputSchema: {
            type: 'object',
            properties: {
                filePath: {
                    type: 'string',
                    description: 'Path to the file to show history for (absolute or relative to workspace)',
                },
            },
            required: ['filePath'],
        },
    },
] as const;

/** Type for valid tool names */
export type GitMasterMcpToolName = (typeof GITMASTER_MCP_TOOLS)[number]['name'];

// ============================================================================
// Main Handler
// ============================================================================

/**
 * Route an MCP tool call to the appropriate handler.
 *
 * @param name - The tool name to execute
 * @param args - Tool arguments from the MCP request
 * @param deps - Dependencies (git service, UI callbacks)
 * @returns Tool response with text content
 * @throws Error if tool is unknown or required dependencies are missing
 */
export async function handleGitMasterMcpToolCall(
    name: string,
    args: Record<string, unknown>,
    deps: McpDependencies,
): Promise<McpToolResponse> {
    switch (name) {
        case 'gitmaster_commit_explain':
            return handleCommitExplain(args, deps);

        case 'gitmaster_show_git_graph':
            return handleShowGitGraph(args, deps);

        case 'gitmaster_shelves':
            return handleShelves(args, deps);

        case 'gitmaster_file_experts':
            return handleFileExperts(args, deps);

        case 'gitmaster_show_file_history':
            return handleShowFileHistory(args, deps);

        default:
            throw new Error(`Unknown tool: ${name}`);
    }
}

// ============================================================================
// Tool Handlers
// ============================================================================

/**
 * Handle the commit_explain tool: fetch commit info and open the details view.
 */
async function handleCommitExplain(
    args: Record<string, unknown>,
    deps: McpDependencies,
): Promise<McpToolResponse> {
    const input = parseCommitExplainArgs(args);
    const payload = await buildCommitExplainPayload(input, deps);

    // Open UI if callback is provided
    if (deps.openCommitDetails) {
        // Convert payload.commit to CommitInfo for the callback
        const commitInfo: CommitInfo = {
            ...payload.commit,
            relativeDate: payload.commit.relativeDate,
        };
        await deps.openCommitDetails(commitInfo, payload.repoRoot);
    }

    return createTextResponse(payload);
}

/**
 * Handle the show_git_graph tool: open the Git Graph webview.
 */
async function handleShowGitGraph(
    args: Record<string, unknown>,
    deps: McpDependencies,
): Promise<McpToolResponse> {
    if (!deps.openGitGraph) {
        throw new Error('gitmaster_show_git_graph is only available inside the VS Code extension host');
    }

    const repoPath = parseStringArg(args.repoPath);
    const repoRoot = await resolveRepoRoot(repoPath ?? deps.defaultRepoPath, deps.gitService);
    await deps.openGitGraph(repoRoot);

    return createTextResponse('ok');
}

/**
 * Handle the shelves tool: list stashes and open the Shelves view.
 */
async function handleShelves(
    args: Record<string, unknown>,
    deps: McpDependencies,
): Promise<McpToolResponse> {
    if (!deps.openShelvesView) {
        throw new Error('gitmaster_shelves is only available inside the VS Code extension host');
    }

    const input = parseShelvesArgs(args);
    const shelves = await fetchShelves(input, deps);
    await deps.openShelvesView();

    return createTextResponse(shelves);
}

/**
 * Handle the file_experts tool: get top contributors for a file.
 */
async function handleFileExperts(
    args: Record<string, unknown>,
    deps: McpDependencies,
): Promise<McpToolResponse> {
    const input = parseFileExpertsArgs(args);
    const payload = await buildFileExpertsPayload(input, deps);
    return createTextResponse(payload);
}

/**
 * Handle the show_file_history tool: open the File History view for a file.
 */
async function handleShowFileHistory(
    args: Record<string, unknown>,
    deps: McpDependencies,
): Promise<McpToolResponse> {
    if (!deps.openFileHistory) {
        throw new Error('gitmaster_show_file_history is only available inside the VS Code extension host');
    }

    const input = parseShowFileHistoryArgs(args);
    const filePath = await resolveFilePath(input.filePath, deps);
    await deps.openFileHistory(filePath);

    return createTextResponse({
        filePath,
        agentInstruction: 'GitMaster File History view has been opened/focused for this file. ' +
            'The user can now see the commit timeline and click on commits to view details.',
    });
}

// ============================================================================
// Resource Handlers
// ============================================================================

/**
 * List available MCP resources (exposes shelves as browsable resources).
 */
export async function listGitMasterMcpResources(
    deps: McpCoreDependencies,
): Promise<McpResourcesResponse> {
    const shelves = await fetchShelves({ maxShelves: SHELVES_LIMITS.DEFAULT_MAX_SHELVES }, deps);

    return {
        resources: shelves.map(shelf => ({
            uri: buildShelfUri(shelf.index),
            name: shelf.name || shelf.index,
            description: `Git stash ${shelf.index} from branch ${shelf.branch || 'unknown'} (${shelf.fileCount} files)`,
            mimeType: 'application/json',
        })),
    };
}

/**
 * Read a specific MCP resource by URI.
 *
 * @param uri - Resource URI (format: gitmaster://shelves/{index})
 * @param deps - Core dependencies
 * @throws Error if URI format is invalid or resource not found
 */
export async function readGitMasterMcpResource(
    uri: string,
    deps: McpCoreDependencies,
): Promise<McpResourceReadResponse> {
    const shelfIndex = parseShelfUri(uri);
    const shelves = await fetchShelves({ maxShelves: SHELVES_LIMITS.MAX_SHELVES }, deps);
    const shelf = shelves.find(s => s.index === shelfIndex);

    if (!shelf) {
        throw new Error(`Shelf not found: ${shelfIndex}`);
    }

    return {
        contents: [{
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(shelf, null, 2),
        }],
    };
}

// ============================================================================
// Data Fetching
// ============================================================================

/**
 * Fetch shelves (git stashes) with their files.
 */
async function fetchShelves(
    input: ShelvesInput,
    deps: McpCoreDependencies,
): Promise<Shelf[]> {
    const { gitService } = deps;
    const repoRoot = await resolveRepoRoot(input.repoPath ?? deps.defaultRepoPath, gitService);

    const maxShelves = clamp(
        input.maxShelves ?? SHELVES_LIMITS.DEFAULT_MAX_SHELVES,
        SHELVES_LIMITS.MIN_SHELVES,
        SHELVES_LIMITS.MAX_SHELVES,
    );
    const maxFilesPerShelf = clamp(
        input.maxFilesPerShelf ?? SHELVES_LIMITS.DEFAULT_MAX_FILES_PER_SHELF,
        SHELVES_LIMITS.MIN_FILES_PER_SHELF,
        SHELVES_LIMITS.MAX_FILES_PER_SHELF,
    );

    const stashes = await gitService.getStashes(repoRoot);

    return Promise.all(
        stashes.slice(0, maxShelves).map(async (stash) => {
            const files = await gitService.getStashFiles(stash.index, repoRoot);
            return {
                index: stash.index,
                name: stash.message,
                branch: stash.branch,
                fileCount: stash.fileCount,
                files: files.slice(0, maxFilesPerShelf).map(toShelfFile),
            };
        }),
    );
}

/**
 * Build the file experts payload with contributor statistics.
 */
async function buildFileExpertsPayload(
    input: FileExpertsInput,
    deps: McpCoreDependencies,
): Promise<FileExpertsPayload> {
    const { gitService } = deps;
    const filePath = await resolveFilePath(input.filePath, deps);
    const repoRoot = await resolveRepoRoot(filePath, gitService);

    const limit = clamp(
        input.limit ?? FILE_EXPERTS_LIMITS.DEFAULT_LIMIT,
        FILE_EXPERTS_LIMITS.MIN_LIMIT,
        FILE_EXPERTS_LIMITS.MAX_LIMIT,
    );

    // Get contributors from git service
    const contributors = await gitService.getFileContributors(filePath, limit);

    if (contributors.length === 0) {
        return {
            filePath,
            repoRoot,
            experts: [],
            totalLinesChanged: 0,
            agentInstruction: 'No commit history found for this file. ' +
                'The file may be new, untracked, or have no git history.',
        };
    }

    // Calculate total lines changed for percentage
    const totalLinesChanged = contributors.reduce((sum, c) => sum + c.lineChanges, 0);

    // Build experts list with percentages
    const experts: FileExpert[] = contributors.map(c => ({
        author: c.author,
        linesChanged: c.lineChanges,
        commitCount: c.commitCount,
        percentage: totalLinesChanged > 0
            ? Math.round((c.lineChanges / totalLinesChanged) * 100)
            : 0,
    }));

    return {
        filePath,
        repoRoot,
        experts,
        totalLinesChanged,
        agentInstruction: `Found ${experts.length} expert(s) for this file. ` +
            `The top contributor is ${experts[0].author} with ${experts[0].percentage}% of changes. ` +
            'Consider consulting these experts for code reviews or questions about this file.',
    };
}

/**
 * Build the commit explain payload with metadata and changed files.
 */
async function buildCommitExplainPayload(
    input: CommitExplainInput,
    deps: McpCoreDependencies,
): Promise<CommitExplainPayload> {
    const commitId = input.commitId.trim();
    if (!commitId) {
        throw new Error('commitId is required');
    }

    const { gitService } = deps;
    const repoRoot = await resolveRepoRoot(input.repoPath ?? deps.defaultRepoPath, gitService);

    // Fetch commit info with timeout for responsiveness
    const commitInfo = await gitService.getCommitInfo(commitId, repoRoot, {
        timeoutMs: TIMEOUTS.COMMIT_INFO,
    });
    if (!commitInfo) {
        throw new Error(`Commit not found in repo: ${commitId}`);
    }

    // Fetch changed files with timeout (may fail on large commits)
    const { files, warning } = await fetchChangedFilesSafely(
        commitInfo.hash,
        repoRoot,
        input.maxFiles ?? COMMIT_EXPLAIN_LIMITS.DEFAULT_MAX_FILES,
        gitService,
    );

    const totals = calculateTotals(files);

    return {
        repoRoot,
        commit: {
            hash: commitInfo.hash,
            shortHash: commitInfo.shortHash,
            message: commitInfo.message,
            author: commitInfo.author,
            date: commitInfo.date,
            relativeDate: commitInfo.relativeDate ?? commitInfo.date,
        },
        files,
        totals,
        agentInstruction: 'GitMaster Commit Details view has been opened/focused. ' +
            'Inspect the changed files and diff, then summarize what the commit did ' +
            'using both the commit message and the actual file changes.',
        ...(warning ? { warning } : {}),
    };
}

/**
 * Fetch changed files with graceful timeout handling.
 * Returns empty array with warning if operation times out.
 */
async function fetchChangedFilesSafely(
    commitHash: string,
    repoRoot: string,
    maxFiles: number,
    gitService: GitService,
): Promise<{ files: CommitExplainPayload['files']; warning?: string }> {
    const limit = clamp(maxFiles, COMMIT_EXPLAIN_LIMITS.MIN_FILES, COMMIT_EXPLAIN_LIMITS.MAX_FILES);

    try {
        // Skip rename detection for speed - not needed for "explain" use case
        const changedFiles = await gitService.getChangedFilesInCommit(commitHash, repoRoot, {
            timeoutMs: TIMEOUTS.CHANGED_FILES,
            detectRenames: false,
        });

        const files = changedFiles.slice(0, limit).map(f => ({
            path: f.path,
            oldPath: f.oldPath,
            status: f.status,
            additions: f.additions ?? 0,
            deletions: f.deletions ?? 0,
        }));

        return { files };
    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        return {
            files: [],
            warning: 'Failed to compute changed files within time limits. ' +
                'Commit metadata is returned, but file list is empty. ' +
                `Error: ${errorMessage}`,
        };
    }
}

// ============================================================================
// Argument Parsing
// ============================================================================

/** Parse and validate commit explain arguments */
function parseCommitExplainArgs(args: Record<string, unknown>): CommitExplainInput {
    return {
        repoPath: parseStringArg(args.repoPath),
        commitId: String(args.commitId ?? ''),
        maxFiles: parseNumberArg(args.maxFiles),
    };
}

/** Parse and validate shelves arguments */
function parseShelvesArgs(args: Record<string, unknown>): ShelvesInput {
    return {
        repoPath: parseStringArg(args.repoPath),
        maxShelves: parseNumberArg(args.maxShelves),
        maxFilesPerShelf: parseNumberArg(args.maxFilesPerShelf),
    };
}

/** Parse and validate file experts arguments */
function parseFileExpertsArgs(args: Record<string, unknown>): FileExpertsInput {
    const filePath = parseStringArg(args.filePath);
    if (!filePath) {
        throw new Error('filePath is required');
    }
    return {
        filePath,
        limit: parseNumberArg(args.limit),
    };
}

/** Parse and validate show file history arguments */
function parseShowFileHistoryArgs(args: Record<string, unknown>): ShowFileHistoryInput {
    const filePath = parseStringArg(args.filePath);
    if (!filePath) {
        throw new Error('filePath is required');
    }
    return { filePath };
}

/** Safely parse a string argument */
function parseStringArg(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
}

/** Safely parse a number argument */
function parseNumberArg(value: unknown): number | undefined {
    return typeof value === 'number' ? value : undefined;
}

// ============================================================================
// URI Helpers
// ============================================================================

const SHELF_URI_PREFIX = 'gitmaster://shelves/';
const SHELF_URI_PATTERN = /^gitmaster:\/\/shelves\/(.+)$/;

/** Build a resource URI for a shelf */
function buildShelfUri(shelfIndex: string): string {
    return `${SHELF_URI_PREFIX}${encodeURIComponent(shelfIndex)}`;
}

/** Parse a shelf URI and extract the index */
function parseShelfUri(uri: string): string {
    const match = uri.match(SHELF_URI_PATTERN);
    if (!match) {
        throw new Error(`Invalid resource URI: ${uri}. Expected format: ${SHELF_URI_PREFIX}{index}`);
    }
    return decodeURIComponent(match[1]);
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Resolve the git repository root from a path.
 * Falls back to workspace folder or current directory.
 */
async function resolveRepoRoot(
    repoPath: string | undefined,
    gitService: GitService,
): Promise<string> {
    const candidate = repoPath?.trim()
        || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
        || process.cwd();

    const resolved = await gitService.getRepoRoot(candidate, { timeoutMs: TIMEOUTS.REPO_ROOT });
    if (!resolved) {
        throw new Error(`Path is not inside a git repository: ${candidate}`);
    }

    return resolved;
}

/**
 * Resolve a file path, supporting both absolute and relative paths.
 * Relative paths are resolved against the workspace folder.
 */
async function resolveFilePath(
    filePath: string,
    deps: McpCoreDependencies,
): Promise<string> {
    const trimmed = filePath.trim();
    if (!trimmed) {
        throw new Error('filePath cannot be empty');
    }

    // If absolute path, use as-is
    if (trimmed.startsWith('/') || /^[a-zA-Z]:/.test(trimmed)) {
        return trimmed;
    }

    // Relative path - resolve against workspace or default repo path
    const basePath = deps.defaultRepoPath
        || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    if (!basePath) {
        throw new Error('Cannot resolve relative path: no workspace folder open');
    }

    // Use path.join equivalent
    return basePath.endsWith('/') || basePath.endsWith('\\')
        ? `${basePath}${trimmed}`
        : `${basePath}/${trimmed}`;
}

/** Convert a ChangedFile to a ShelfFile */
function toShelfFile(file: ChangedFile): ShelfFile {
    return {
        path: file.path,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
        oldPath: file.oldPath,
    };
}

/** Calculate totals for a list of file changes */
function calculateTotals(files: CommitExplainPayload['files']): CommitExplainPayload['totals'] {
    return files.reduce(
        (acc, f) => ({
            fileCount: acc.fileCount + 1,
            totalAdditions: acc.totalAdditions + (f.additions || 0),
            totalDeletions: acc.totalDeletions + (f.deletions || 0),
        }),
        { fileCount: 0, totalAdditions: 0, totalDeletions: 0 },
    );
}

/** Create a standard MCP text response */
function createTextResponse(data: unknown): McpToolResponse {
    const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    return { content: [{ type: 'text', text }] };
}

/** Clamp a number between min and max values */
function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}
