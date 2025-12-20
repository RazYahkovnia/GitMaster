/**
 * MCP (Model Context Protocol) type definitions for GitMaster.
 * These types define the interfaces for MCP tools, resources, and responses.
 */

import { CommitInfo } from '../types/git';
import { GitService } from '../services/gitService';

// ============================================================================
// Tool Input Types
// ============================================================================

/** Input parameters for the shelves listing tool */
export interface ShelvesInput {
    /** Path to a file/folder in the git repo (defaults to workspace) */
    repoPath?: string;
    /** Maximum number of shelves to return (default: 50, max: 200) */
    maxShelves?: number;
    /** Maximum files per shelf to return (default: 500, max: 5000) */
    maxFilesPerShelf?: number;
}

/** Input parameters for the commit explain tool */
export interface CommitExplainInput {
    /** Path to a file/folder in the git repo (defaults to workspace) */
    repoPath?: string;
    /** Commit hash (full or short) - required */
    commitId: string;
    /** Maximum changed files to return (default: 200, max: 2000) */
    maxFiles?: number;
}

// ============================================================================
// Domain Types
// ============================================================================

/** A file within a shelf (stash) */
export interface ShelfFile {
    /** File path relative to repo root */
    path: string;
    /** File status: A (added), M (modified), D (deleted), R (renamed) */
    status: string;
    /** Lines added */
    additions: number;
    /** Lines deleted */
    deletions: number;
    /** Original path for renamed files */
    oldPath?: string;
}

/** A shelf (git stash) with its files */
export interface Shelf {
    /** Stash reference (e.g., "stash@{0}") */
    index: string;
    /** Stash message/name */
    name: string;
    /** Branch where stash was created */
    branch: string;
    /** Total number of files in the stash */
    fileCount: number;
    /** List of changed files */
    files: ShelfFile[];
}

/** Commit information in the explain payload */
export interface CommitSummary {
    hash: string;
    shortHash: string;
    message: string;
    author: string;
    date: string;
    relativeDate: string;
}

/** File change information in the explain payload */
export interface FileChange {
    path: string;
    oldPath?: string;
    status: string;
    additions: number;
    deletions: number;
}

/** Statistics for changed files */
export interface ChangeTotals {
    fileCount: number;
    totalAdditions: number;
    totalDeletions: number;
}

/** Full payload returned by the commit explain tool */
export interface CommitExplainPayload {
    repoRoot: string;
    commit: CommitSummary;
    files: FileChange[];
    totals: ChangeTotals;
    agentInstruction: string;
    warning?: string;
}

// ============================================================================
// MCP Response Types
// ============================================================================

/** Standard MCP tool response with text content */
export interface McpToolResponse {
    content: Array<{ type: 'text'; text: string }>;
}

/** MCP resource listing response */
export interface McpResourcesResponse {
    resources: Array<{
        uri: string;
        name: string;
        description?: string;
        mimeType?: string;
    }>;
}

/** MCP resource read response */
export interface McpResourceReadResponse {
    contents: Array<{
        uri: string;
        mimeType?: string;
        text: string;
    }>;
}

// ============================================================================
// Dependency Types
// ============================================================================

/** UI callbacks available only in VS Code extension host */
export interface McpUiCallbacks {
    /** Open the Shelves view in the sidebar */
    openShelvesView?: () => Promise<void>;
    /** Open the Git Graph webview */
    openGitGraph?: (repoRoot: string) => Promise<void>;
    /** Open Commit Details for a specific commit */
    openCommitDetails?: (commitInfo: CommitInfo, repoRoot: string) => Promise<void>;
}

/** Dependencies required for MCP tool execution */
export interface McpDependencies extends McpUiCallbacks {
    /** Git service instance for repository operations */
    gitService: GitService;
    /** Default path to resolve repo root when not provided */
    defaultRepoPath?: string;
}

/** Dependencies for operations that don't need UI (resources, data queries) */
export type McpCoreDependencies = Pick<McpDependencies, 'gitService' | 'defaultRepoPath'>;

