/**
 * Git-related type definitions
 */

/**
 * Information about a git commit
 */
export interface CommitInfo {
    hash: string;
    shortHash: string;
    message: string;
    author: string;
    date: string;
    relativeDate: string;
}

/**
 * Information about a file changed in a commit
 */
export interface ChangedFile {
    /** Current/new path of the file */
    path: string;
    /** Previous path (for renamed files) */
    oldPath?: string;
    /** File status: A (added), M (modified), D (deleted), R (renamed) */
    status: string;
    /** Number of lines added */
    additions: number;
    /** Number of lines deleted */
    deletions: number;
}

/**
 * Information about a git stash (shelf)
 */
export interface StashInfo {
    /** Stash reference (e.g., "stash@{0}") */
    index: string;
    /** Branch name where stash was created */
    branch: string;
    /** Stash message/description */
    message: string;
    /** Number of files changed in the stash */
    fileCount: number;
    /** Timestamp of when stash was created (ISO format) */
    timestamp: string;
    /** Relative time (e.g., "2 hours ago") */
    relativeTime: string;
    /** Total lines added across all files */
    additions: number;
    /** Total lines deleted across all files */
    deletions: number;
    /** Whether this stash has conflicting files with current changes */
    hasConflicts?: boolean;
    /** List of conflicting file paths */
    conflictingFiles?: string[];
}

/**
 * Information about a git reflog entry (operation)
 */
export interface ReflogEntry {
    /** Commit hash */
    hash: string;
    /** Short commit hash */
    shortHash: string;
    /** Reflog selector (e.g., "HEAD@{0}") */
    selector: string;
    /** Operation description (e.g., "commit", "checkout", "rebase") */
    action: string;
    /** Full message */
    message: string;
    /** Timestamp of the operation (ISO format) */
    timestamp: string;
    /** Relative time (e.g., "2 hours ago") */
    relativeTime: string;
}

/**
 * Information about a repository commit (for full repo log)
 */
export interface RepositoryCommit {
    /** Full commit hash */
    hash: string;
    /** Short commit hash */
    shortHash: string;
    /** Commit author name */
    author: string;
    /** Commit date (short format) */
    date: string;
    /** Commit message (first line) */
    message: string;
    /** Parent commit hashes */
    parentHashes: string[];
}

/**
 * Information about a git branch
 */
export interface BranchInfo {
    /** Branch name */
    name: string;
    /** Whether this is the current branch */
    isCurrent: boolean;
    /** Whether this is a remote branch */
    isRemote: boolean;
    /** Commit hash the branch points to */
    commitHash: string;
    /** Short commit hash */
    shortCommitHash: string;
    /** Last commit message on this branch */
    lastCommitMessage: string;
    /** Last commit author */
    lastCommitAuthor: string;
    /** Last commit date (relative) */
    lastCommitDate: string;
    /** Upstream branch (if tracking) */
    upstream?: string;
}

/**
 * Commit shape used by the Git Graph view
 */
export interface GraphCommit {
    hash: string;
    shortHash: string;
    message: string;
    author: string;
    email: string;
    date: string;
    parents: string[];
    branches: string[];
    tags: string[];
    refs: string[];
}

/**
 * Rebase action type
 */
export type RebaseAction = 'pick' | 'reword' | 'edit' | 'squash' | 'fixup' | 'drop';

/**
 * Information about a commit in an interactive rebase
 */
export interface RebaseCommit {
    /** Full commit hash */
    hash: string;
    /** Short commit hash */
    shortHash: string;
    /** Commit author name */
    author: string;
    /** Commit date (relative) */
    date: string;
    /** Commit message (first line) */
    message: string;
    /** Rebase action to perform */
    action: RebaseAction;
    /** Number of files changed in this commit */
    fileCount?: number;
    /** Number of lines added */
    additions?: number;
    /** Number of lines deleted */
    deletions?: number;
}

/**
 * Current state of an interactive rebase session
 */
export interface RebaseState {
    /** Repository root path */
    repoRoot: string;
    /** Current branch name */
    currentBranch: string;
    /** Base branch to rebase onto */
    baseBranch: string;
    /** List of commits to rebase (in order from oldest to newest) */
    commits: RebaseCommit[];
    /** Whether a rebase is currently in progress */
    isInProgress: boolean;
    /** Whether there are conflicts */
    hasConflicts: boolean;
    /** Conflict message if any */
    conflictMessage?: string;
}

/**
 * Information about a git worktree
 */
export interface GitWorktree {
    /** Absolute path to the worktree */
    path: string;
    /** Commit hash or HEAD reference */
    head: string;
    /** Branch name (if detached, specific status) */
    branch: string;
    /** Whether this is the main worktree */
    isMain: boolean;
    /** Whether this is the currently opened worktree */
    isCurrent: boolean;
}

/**
 * Information about a git blame entry
 */
export interface BlameInfo {
    hash: string;
    shortHash: string;
    author: string;
    authorEmail?: string;
    date: string;
    relativeDate: string;
    message: string;
    filename?: string;
}
