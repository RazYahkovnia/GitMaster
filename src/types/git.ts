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
}

