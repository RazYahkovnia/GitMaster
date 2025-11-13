import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import { CommitInfo, ChangedFile, StashInfo, ReflogEntry, RepositoryCommit, BranchInfo } from '../types/git';

const execAsync = promisify(exec);

/**
 * Service for interacting with Git repositories
 */
export class GitService {
    /**
     * Get the git repository root directory for a given file or folder path
     */
    async getRepoRoot(filePath: string): Promise<string | null> {
        try {
            const fs = await import('fs');
            // Check if path is a directory or file
            let dirPath: string;
            try {
                const stats = fs.statSync(filePath);
                dirPath = stats.isDirectory() ? filePath : path.dirname(filePath);
            } catch {
                // If stat fails, assume it's a file path
                dirPath = path.dirname(filePath);
            }

            const { stdout } = await execAsync('git rev-parse --show-toplevel', {
                cwd: dirPath
            });
            return stdout.trim();
        } catch (error) {
            return null;
        }
    }

    /**
     * Check if a file is tracked by git
     */
    async isFileTracked(filePath: string): Promise<boolean> {
        try {
            const dirPath = path.dirname(filePath);
            const fileName = path.basename(filePath);
            await execAsync(`git ls-files --error-unmatch "${fileName}"`, {
                cwd: dirPath
            });
            return true;
        } catch (error) {
            return false;
        }
    }

    /**
     * Get the commit history for a specific file
     */
    async getFileHistory(filePath: string): Promise<CommitInfo[]> {
        try {
            const repoRoot = await this.getRepoRoot(filePath);
            if (!repoRoot) {
                return [];
            }

            const format = '%H|%h|%an|%ai|%ar|%s';
            const { stdout } = await execAsync(
                `git log --follow --format="${format}" -- "${filePath}"`,
                { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 }
            );

            if (!stdout.trim()) {
                return [];
            }

            return this.parseCommitLog(stdout);
        } catch (error) {
            console.error('Error getting file history:', error);
            return [];
        }
    }

    /**
     * Get the content of a file at a specific commit
     */
    async getFileContentAtCommit(relativePath: string, commitHash: string, repoRoot: string): Promise<string> {
        try {
            const { stdout } = await execAsync(
                `git show ${commitHash}:"${relativePath}"`,
                { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 }
            );
            return stdout;
        } catch (error) {
            throw new Error(`Failed to get file content at commit ${commitHash}: ${error}`);
        }
    }

    /**
     * Get the parent commit hash
     */
    async getParentCommit(commitHash: string, repoRoot: string): Promise<string | null> {
        try {
            const { stdout } = await execAsync(
                `git rev-parse ${commitHash}^`,
                { cwd: repoRoot }
            );
            return stdout.trim();
        } catch (error) {
            return null;
        }
    }

    /**
     * Get all files changed in a specific commit
     */
    async getChangedFilesInCommit(commitHash: string, repoRoot: string): Promise<ChangedFile[]> {
        try {
            const files = await this.getChangedFilesStats(commitHash, repoRoot);
            const statusMap = await this.getFileStatuses(commitHash, repoRoot);

            // Update file statuses
            return files.map(file => ({
                ...file,
                status: statusMap.get(file.path)?.status || file.status,
                oldPath: statusMap.get(file.path)?.oldPath || file.oldPath
            }));
        } catch (error) {
            throw new Error(`Failed to get changed files: ${error}`);
        }
    }

    /**
     * Get the GitHub repository URL from remote origin
     */
    async getGitHubRepoUrl(repoRoot: string): Promise<string | null> {
        try {
            const { stdout } = await execAsync(
                'git config --get remote.origin.url',
                { cwd: repoRoot }
            );

            const url = stdout.trim();
            return this.normalizeGitHubUrl(url);
        } catch (error) {
            return null;
        }
    }

    /**
     * Parse commit log output into CommitInfo objects
     */
    private parseCommitLog(stdout: string): CommitInfo[] {
        const commits: CommitInfo[] = [];
        const lines = stdout.trim().split('\n');

        for (const line of lines) {
            const parts = line.split('|');
            if (parts.length >= 6) {
                commits.push({
                    hash: parts[0],
                    shortHash: parts[1],
                    author: parts[2],
                    date: parts[3],
                    relativeDate: parts[4],
                    message: parts.slice(5).join('|') // In case message contains |
                });
            }
        }

        return commits;
    }

    /**
     * Get file statistics (additions/deletions) for a commit
     */
    private async getChangedFilesStats(commitHash: string, repoRoot: string): Promise<ChangedFile[]> {
        const { stdout } = await execAsync(
            `git diff-tree --no-commit-id --numstat -M -r ${commitHash}`,
            { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 }
        );

        const files: ChangedFile[] = [];
        const lines = stdout.trim().split('\n').filter(line => line.trim());

        for (const line of lines) {
            const parts = line.split('\t');
            if (parts.length >= 3) {
                const additions = parts[0] === '-' ? 0 : parseInt(parts[0]) || 0;
                const deletions = parts[1] === '-' ? 0 : parseInt(parts[1]) || 0;
                const { path: filePath, oldPath } = this.parseRenamedPath(parts[2]);

                files.push({
                    path: filePath,
                    oldPath,
                    status: 'M',
                    additions,
                    deletions
                });
            }
        }

        return files;
    }

    /**
     * Get file statuses (A, M, D, R) for a commit
     */
    private async getFileStatuses(commitHash: string, repoRoot: string): Promise<Map<string, { status: string, oldPath?: string }>> {
        const { stdout } = await execAsync(
            `git diff-tree --no-commit-id --name-status -M -r ${commitHash}`,
            { cwd: repoRoot }
        );

        const statusMap = new Map<string, { status: string, oldPath?: string }>();
        const statusLines = stdout.trim().split('\n');

        for (const line of statusLines) {
            const parts = line.split('\t');
            const rawStatus = parts[0];
            let filePath = parts[parts.length - 1];
            let oldPath: string | undefined = undefined;

            // Handle renames (R100, R095, etc.) and copies (C100, etc.)
            if (rawStatus.startsWith('R') || rawStatus.startsWith('C')) {
                if (parts.length >= 3) {
                    oldPath = parts[1];
                    filePath = parts[2];
                }
            }

            const status = rawStatus.startsWith('R') ? 'R' :
                rawStatus.startsWith('A') ? 'A' :
                    rawStatus.startsWith('D') ? 'D' :
                        rawStatus.startsWith('M') ? 'M' : rawStatus;

            statusMap.set(filePath, { status, oldPath });
        }

        return statusMap;
    }

    /**
     * Parse renamed file paths from git output
     * Handles formats like "oldfile => newfile" or "path/{old => new}/file"
     */
    private parseRenamedPath(filePath: string): { path: string, oldPath?: string } {
        if (!filePath.includes(' => ')) {
            return { path: filePath };
        }

        // Check for brace pattern: "path/{old => new}/file"
        const braceMatch = filePath.match(/^(.+)\{(.+)\s*=>\s*(.+)\}(.+)$/);
        if (braceMatch) {
            const prefix = braceMatch[1];
            const oldPart = braceMatch[2];
            const newPart = braceMatch[3];
            const suffix = braceMatch[4];

            return {
                path: (prefix + newPart + suffix).trim(),
                oldPath: (prefix + oldPart + suffix).trim()
            };
        }

        // Simple rename: "oldfile => newfile"
        const parts = filePath.split(' => ');
        if (parts.length === 2) {
            return {
                path: parts[1].trim(),
                oldPath: parts[0].trim()
            };
        }

        return { path: filePath };
    }

    /**
     * Normalize GitHub URL to HTTPS format
     */
    private normalizeGitHubUrl(url: string): string | null {
        // Convert git@github.com:user/repo.git to https://github.com/user/repo
        if (url.startsWith('git@github.com:')) {
            return url
                .replace('git@github.com:', 'https://github.com/')
                .replace(/\.git$/, '');
        }

        // Handle https://github.com/user/repo.git
        if (url.includes('github.com')) {
            return url.replace(/\.git$/, '');
        }

        return null;
    }

    /**
     * Get remote URL (GitHub, GitLab, Bitbucket, etc.)
     */
    async getRemoteUrl(repoRoot: string): Promise<string | null> {
        try {
            const { stdout } = await execAsync(
                'git config --get remote.origin.url',
                { cwd: repoRoot }
            );

            const url = stdout.trim();
            return this.normalizeRemoteUrl(url);
        } catch (error) {
            return null;
        }
    }

    /**
     * Normalize remote URL to HTTPS format
     */
    private normalizeRemoteUrl(url: string): string | null {
        // GitHub SSH: git@github.com:user/repo.git -> https://github.com/user/repo
        if (url.startsWith('git@github.com:')) {
            return url
                .replace('git@github.com:', 'https://github.com/')
                .replace(/\.git$/, '');
        }

        // GitLab SSH: git@gitlab.com:user/repo.git -> https://gitlab.com/user/repo
        if (url.startsWith('git@gitlab.com:')) {
            return url
                .replace('git@gitlab.com:', 'https://gitlab.com/')
                .replace(/\.git$/, '');
        }

        // Bitbucket SSH: git@bitbucket.org:user/repo.git -> https://bitbucket.org/user/repo
        if (url.startsWith('git@bitbucket.org:')) {
            return url
                .replace('git@bitbucket.org:', 'https://bitbucket.org/')
                .replace(/\.git$/, '');
        }

        // Handle HTTPS URLs
        if (url.startsWith('https://')) {
            return url.replace(/\.git$/, '');
        }

        return null;
    }

    /**
     * Get remote file URL with line numbers
     */
    async getRemoteFileUrl(
        filePath: string,
        startLine: number,
        endLine?: number
    ): Promise<string | null> {
        try {
            const repoRoot = await this.getRepoRoot(filePath);
            if (!repoRoot) {
                return null;
            }

            // Get remote URL
            const remoteUrl = await this.getRemoteUrl(repoRoot);
            if (!remoteUrl) {
                return null;
            }

            // Get current branch or commit
            const branch = await this.getCurrentBranch(repoRoot);
            const ref = branch || 'HEAD';

            // Get relative path from repo root
            const relativePath = path.relative(repoRoot, filePath);

            // Build URL based on platform
            return this.buildRemoteFileUrl(remoteUrl, ref, relativePath, startLine, endLine);
        } catch (error) {
            console.error('Error getting remote file URL:', error);
            return null;
        }
    }

    /**
     * Build remote file URL for different platforms
     */
    private buildRemoteFileUrl(
        remoteUrl: string,
        ref: string,
        relativePath: string,
        startLine: number,
        endLine?: number
    ): string {
        // Normalize path separators to forward slashes
        const normalizedPath = relativePath.replace(/\\/g, '/');

        if (remoteUrl.includes('github.com')) {
            // GitHub format: /blob/branch/path#L42 or #L42-L45
            const lineFragment = endLine && endLine !== startLine
                ? `#L${startLine}-L${endLine}`
                : `#L${startLine}`;
            return `${remoteUrl}/blob/${ref}/${normalizedPath}${lineFragment}`;
        }

        if (remoteUrl.includes('gitlab.com')) {
            // GitLab format: /-/blob/branch/path#L42 or #L42-45
            const lineFragment = endLine && endLine !== startLine
                ? `#L${startLine}-${endLine}`
                : `#L${startLine}`;
            return `${remoteUrl}/-/blob/${ref}/${normalizedPath}${lineFragment}`;
        }

        if (remoteUrl.includes('bitbucket.org')) {
            // Bitbucket format: /src/branch/path#lines-42 or #lines-42:45
            const lineFragment = endLine && endLine !== startLine
                ? `#lines-${startLine}:${endLine}`
                : `#lines-${startLine}`;
            return `${remoteUrl}/src/${ref}/${normalizedPath}${lineFragment}`;
        }

        // Default to GitHub format for unknown platforms
        const lineFragment = endLine && endLine !== startLine
            ? `#L${startLine}-L${endLine}`
            : `#L${startLine}`;
        return `${remoteUrl}/blob/${ref}/${normalizedPath}${lineFragment}`;
    }

    /**
     * Get all stashes in the repository
     */
    async getStashes(repoRoot: string): Promise<StashInfo[]> {
        try {
            const { stdout } = await execAsync('git stash list', { cwd: repoRoot });

            if (!stdout.trim()) {
                return [];
            }

            const stashes: StashInfo[] = [];
            const lines = stdout.trim().split('\n');

            for (const line of lines) {
                const match = line.match(/^(stash@\{(\d+)\}):\s+(?:WIP on|On)\s+(\S+):\s+(.+)$/);
                if (match) {
                    const [, index, , branch, message] = match;
                    const fileCount = await this.getStashFileCount(index, repoRoot);

                    stashes.push({
                        index,
                        branch,
                        message,
                        fileCount
                    });
                }
            }

            return stashes;
        } catch (error) {
            console.error('Error getting stashes:', error);
            return [];
        }
    }

    /**
     * Get the number of files in a stash
     */
    private async getStashFileCount(stashIndex: string, repoRoot: string): Promise<number> {
        try {
            let count = 0;

            // Count tracked files
            try {
                const { stdout } = await execAsync(
                    `git stash show --numstat ${stashIndex}`,
                    { cwd: repoRoot }
                );
                const lines = stdout.trim().split('\n').filter(line => line.trim());
                count += lines.length;
            } catch (error) {
                // Stash might be empty of tracked changes
            }

            // Count untracked files (in third parent)
            try {
                const { stdout } = await execAsync(
                    `git ls-tree -r ${stashIndex}^3 --name-only`,
                    { cwd: repoRoot }
                );
                const untrackedFiles = stdout.trim().split('\n').filter(line => line.trim());
                count += untrackedFiles.length;
            } catch (error) {
                // No third parent means no untracked files
            }

            return count;
        } catch (error) {
            return 0;
        }
    }

    /**
     * Check if a stash has untracked files (third parent exists)
     */
    async stashHasUntrackedFiles(stashIndex: string, repoRoot: string): Promise<boolean> {
        try {
            await execAsync(
                `git rev-parse --verify ${stashIndex}^3`,
                { cwd: repoRoot }
            );
            return true;
        } catch (error) {
            // Third parent doesn't exist, no untracked files
            return false;
        }
    }

    /**
     * Check if there are changes to stash
     */
    async hasChangesToStash(repoRoot: string): Promise<boolean> {
        try {
            const { stdout } = await execAsync('git status --porcelain', { cwd: repoRoot });
            return stdout.trim().length > 0;
        } catch (error) {
            return false;
        }
    }

    /**
     * Check if there are untracked files
     */
    async hasUntrackedFiles(repoRoot: string): Promise<boolean> {
        try {
            const { stdout } = await execAsync('git status --porcelain', { cwd: repoRoot });
            const lines = stdout.trim().split('\n');
            // Untracked files start with '??'
            return lines.some(line => line.startsWith('??'));
        } catch (error) {
            return false;
        }
    }

    /**
     * Check if there are tracked changes (staged or unstaged, excluding untracked files)
     */
    async hasTrackedChanges(repoRoot: string): Promise<boolean> {
        try {
            const { stdout } = await execAsync('git status --porcelain', { cwd: repoRoot });
            const lines = stdout.trim().split('\n').filter(line => line.length > 0);
            // Tracked changes are any lines that DON'T start with '??'
            return lines.some(line => !line.startsWith('??'));
        } catch (error) {
            return false;
        }
    }

    /**
     * Check if there are staged changes
     */
    async hasStagedChanges(repoRoot: string): Promise<boolean> {
        try {
            // git diff --cached --quiet exits with 1 if there are staged changes, 0 if none
            await execAsync('git diff --cached --quiet', { cwd: repoRoot });
            return false; // Exit code 0 means no staged changes
        } catch (error) {
            return true; // Exit code 1 means there are staged changes
        }
    }

    /**
     * Check if any files have both staged and unstaged changes
     * Returns true if there are files that cannot be stashed with --staged
     */
    async hasFilesWithMixedChanges(repoRoot: string): Promise<boolean> {
        try {
            // Get files with staged changes
            const { stdout: stagedFiles } = await execAsync('git diff --cached --name-only', { cwd: repoRoot });
            const stagedSet = new Set(stagedFiles.trim().split('\n').filter(f => f.length > 0));

            // Get files with unstaged changes
            const { stdout: unstagedFiles } = await execAsync('git diff --name-only', { cwd: repoRoot });
            const unstagedSet = new Set(unstagedFiles.trim().split('\n').filter(f => f.length > 0));

            // Check for intersection - files in both sets have mixed changes
            for (const file of stagedSet) {
                if (unstagedSet.has(file)) {
                    return true;
                }
            }

            return false;
        } catch (error) {
            console.error('Error checking for mixed changes:', error);
            return false;
        }
    }

    /**
     * Get detailed file status for stash preview
     * Returns information about files to be stashed with their changes and status
     */
    async getStashPreview(repoRoot: string, includeUntracked: boolean = false): Promise<{
        staged: Array<{ file: string; additions: number; deletions: number }>;
        unstaged: Array<{ file: string; additions: number; deletions: number }>;
        untracked: string[];
    }> {
        try {
            const result = {
                staged: [] as Array<{ file: string; additions: number; deletions: number }>,
                unstaged: [] as Array<{ file: string; additions: number; deletions: number }>,
                untracked: [] as string[]
            };

            // Get staged files with stats
            const { stdout: stagedStats } = await execAsync('git diff --cached --numstat', { cwd: repoRoot });
            if (stagedStats.trim()) {
                stagedStats.trim().split('\n').forEach(line => {
                    const parts = line.split('\t');
                    if (parts.length >= 3) {
                        result.staged.push({
                            file: parts[2],
                            additions: parseInt(parts[0]) || 0,
                            deletions: parseInt(parts[1]) || 0
                        });
                    }
                });
            }

            // Get unstaged files with stats
            const { stdout: unstagedStats } = await execAsync('git diff --numstat', { cwd: repoRoot });
            if (unstagedStats.trim()) {
                unstagedStats.trim().split('\n').forEach(line => {
                    const parts = line.split('\t');
                    if (parts.length >= 3) {
                        result.unstaged.push({
                            file: parts[2],
                            additions: parseInt(parts[0]) || 0,
                            deletions: parseInt(parts[1]) || 0
                        });
                    }
                });
            }

            // Get untracked files if requested
            if (includeUntracked) {
                const { stdout: untrackedFiles } = await execAsync('git ls-files --others --exclude-standard', { cwd: repoRoot });
                if (untrackedFiles.trim()) {
                    result.untracked = untrackedFiles.trim().split('\n').filter(f => f.length > 0);
                }
            }

            return result;
        } catch (error) {
            console.error('Error getting stash preview:', error);
            return { staged: [], unstaged: [], untracked: [] };
        }
    }

    /**
     * Create a new stash with a custom message
     */
    async createStash(repoRoot: string, message: string, includeUntracked: boolean = false, keepIndex: boolean = false, stagedOnly: boolean = false, specificFiles?: string[]): Promise<void> {
        try {
            const flags: string[] = [];
            if (stagedOnly) {
                // --staged requires Git 2.35+
                flags.push('--staged');
            } else {
                if (includeUntracked) {
                    flags.push('-u');
                }
                if (keepIndex) {
                    flags.push('--keep-index');
                }
            }
            const flagsStr = flags.join(' ');

            // Build file path arguments if specific files are provided
            let fileArgs = '';
            if (specificFiles && specificFiles.length > 0) {
                const quotedPaths = specificFiles.map(p => `"${p}"`).join(' ');
                fileArgs = ` -- ${quotedPaths}`;
            }

            const command = `git stash push ${flagsStr} -m "${message}"${fileArgs}`;
            console.log('Executing git command:', command);

            await execAsync(command, { cwd: repoRoot });
        } catch (error) {
            throw new Error(`Failed to create stash: ${error}`);
        }
    }

    /**
     * Stash specific files only
     */
    async stashSpecificFiles(repoRoot: string, filePaths: string[]): Promise<void> {
        try {
            // Quote each file path to handle spaces
            const quotedPaths = filePaths.map(p => `"${p}"`).join(' ');
            await execAsync(`git stash push -m "temp-file-stash" -- ${quotedPaths}`, { cwd: repoRoot });
        } catch (error) {
            throw new Error(`Failed to stash specific files: ${error}`);
        }
    }

    /**
     * Stash only untracked files using the stash-untracked technique
     * This works by: stash tracked, stash all with -u, pop tracked back
     */
    async stashUntrackedOnly(repoRoot: string, message: string): Promise<void> {
        try {
            // Check if there are any tracked changes (staged or unstaged)
            const hasTracked = await this.hasTrackedChanges(repoRoot);

            if (!hasTracked) {
                // No tracked changes - can directly stash untracked files with -u flag
                await execAsync(`git stash push -u -m "${message}"`, { cwd: repoRoot });
            } else {
                // There are tracked changes - use the 3-step technique
                // Step 1: Stash tracked changes temporarily
                await execAsync(`git stash push -m "temp-tracked"`, { cwd: repoRoot });

                // Step 2: Stash everything including untracked
                await execAsync(`git stash push -u -m "${message}"`, { cwd: repoRoot });

                // Step 3: Pop the tracked changes back
                await execAsync(`git stash pop stash@{1}`, { cwd: repoRoot });
            }
        } catch (error) {
            throw new Error(`Failed to stash untracked files: ${error}`);
        }
    }

    /**
     * Apply a stash (keeps it in the stash list)
     * Uses --index to restore the staging state
     */
    async applyStash(stashIndex: string, repoRoot: string): Promise<void> {
        try {
            await execAsync(`git stash apply --index ${stashIndex}`, { cwd: repoRoot });
        } catch (error) {
            throw new Error(`Failed to apply stash: ${error}`);
        }
    }

    /**
     * Pop a stash (applies and removes from stash list)
     * Uses --index to restore the staging state
     */
    async popStash(stashIndex: string, repoRoot: string): Promise<void> {
        try {
            await execAsync(`git stash pop --index ${stashIndex}`, { cwd: repoRoot });
        } catch (error) {
            throw new Error(`Failed to pop stash: ${error}`);
        }
    }

    /**
     * Delete a stash without applying
     */
    async deleteStash(stashIndex: string, repoRoot: string): Promise<void> {
        try {
            await execAsync(`git stash drop ${stashIndex}`, { cwd: repoRoot });
        } catch (error) {
            throw new Error(`Failed to delete stash: ${error}`);
        }
    }

    /**
     * Get files changed in a stash
     */
    async getStashFiles(stashIndex: string, repoRoot: string): Promise<ChangedFile[]> {
        try {
            const files: ChangedFile[] = [];

            // Get tracked changes (modified, deleted files)
            try {
                const { stdout } = await execAsync(
                    `git stash show --numstat ${stashIndex}`,
                    { cwd: repoRoot }
                );

                const lines = stdout.trim().split('\n').filter(line => line.trim());

                for (const line of lines) {
                    const parts = line.split('\t');
                    if (parts.length >= 3) {
                        const additions = parts[0] === '-' ? 0 : parseInt(parts[0]) || 0;
                        const deletions = parts[1] === '-' ? 0 : parseInt(parts[1]) || 0;
                        const filePath = parts[2];

                        files.push({
                            path: filePath,
                            status: 'M',
                            additions,
                            deletions
                        });
                    }
                }
            } catch (error) {
                // Stash might be empty of tracked changes
            }

            // Check for untracked files (stored in third parent)
            try {
                const { stdout: untrackedStdout } = await execAsync(
                    `git ls-tree -r ${stashIndex}^3 --name-only`,
                    { cwd: repoRoot }
                );

                const untrackedFiles = untrackedStdout.trim().split('\n').filter(line => line.trim());

                for (const filePath of untrackedFiles) {
                    // Get file size for additions count
                    try {
                        const { stdout: content } = await execAsync(
                            `git show ${stashIndex}^3:"${filePath}"`,
                            { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 }
                        );
                        const lineCount = content.split('\n').length;

                        files.push({
                            path: filePath,
                            status: 'A', // Untracked files shown as Added
                            additions: lineCount,
                            deletions: 0
                        });
                    } catch {
                        // If we can't read the file, still show it
                        files.push({
                            path: filePath,
                            status: 'A',
                            additions: 0,
                            deletions: 0
                        });
                    }
                }
            } catch (error) {
                // No third parent means no untracked files were stashed
            }

            return files;
        } catch (error) {
            throw new Error(`Failed to get stash files: ${error}`);
        }
    }

    /**
     * Get content of a file in a stash (after applying stash)
     */
    async getStashFileContent(relativePath: string, stashIndex: string, repoRoot: string): Promise<string> {
        try {
            // Try to get from main stash (tracked changes)
            try {
                const { stdout } = await execAsync(
                    `git show ${stashIndex}:"${relativePath}"`,
                    { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 }
                );
                return stdout;
            } catch (error) {
                // File might be in untracked files (third parent)
                const { stdout } = await execAsync(
                    `git show ${stashIndex}^3:"${relativePath}"`,
                    { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 }
                );
                return stdout;
            }
        } catch (error) {
            throw new Error(`Failed to get stash file content: ${error}`);
        }
    }

    /**
     * Get content of a file before stash (parent of stash)
     */
    async getStashFileParentContent(relativePath: string, stashIndex: string, repoRoot: string): Promise<string> {
        try {
            const { stdout } = await execAsync(
                `git show ${stashIndex}^:"${relativePath}"`,
                { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 }
            );
            return stdout;
        } catch (error) {
            // File might not exist in parent (new file)
            return '';
        }
    }

    /**
     * Get reflog entries (git operations history)
     */
    async getReflog(repoRoot: string, limit: number = 50): Promise<ReflogEntry[]> {
        try {
            const { stdout } = await execAsync(
                `git reflog --format="%H|%h|%gd|%gs" -n ${limit}`,
                { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 }
            );

            if (!stdout.trim()) {
                return [];
            }

            const entries: ReflogEntry[] = [];
            const lines = stdout.trim().split('\n');

            for (const line of lines) {
                const parts = line.split('|');
                if (parts.length >= 4) {
                    const [hash, shortHash, selector, message] = parts;

                    // Extract action from message (e.g., "commit", "checkout", "pull")
                    const actionMatch = message.match(/^(\w+):/);
                    const action = actionMatch ? actionMatch[1] : 'other';

                    entries.push({
                        hash,
                        shortHash,
                        selector,
                        action,
                        message
                    });
                }
            }

            return entries;
        } catch (error) {
            console.error('Error getting reflog:', error);
            return [];
        }
    }

    /**
     * Checkout to a specific commit
     */
    async checkoutCommit(commitHash: string, repoRoot: string): Promise<void> {
        try {
            await execAsync(`git checkout ${commitHash}`, { cwd: repoRoot });
        } catch (error) {
            throw new Error(`Failed to checkout commit: ${error}`);
        }
    }

    /**
     * Get repository commit log (all commits, not file-specific)
     */
    async getRepositoryLog(repoRoot: string, limit: number = 20): Promise<RepositoryCommit[]> {
        try {
            const format = '%H|%h|%an|%ad|%s|%P';
            const { stdout } = await execAsync(
                `git log --format="${format}" --date=short -n ${limit}`,
                { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 }
            );

            if (!stdout.trim()) {
                return [];
            }

            const commits: RepositoryCommit[] = [];
            const lines = stdout.trim().split('\n');

            for (const line of lines) {
                const parts = line.split('|');
                if (parts.length >= 5) {
                    const [hash, shortHash, author, date, ...messageParts] = parts;
                    // The rest after the 5th element is the parent hashes
                    const message = messageParts.slice(0, -1).join('|'); // Message is everything except last part
                    const parentHashesStr = messageParts[messageParts.length - 1] || '';
                    const parentHashes = parentHashesStr.trim() ? parentHashesStr.split(' ') : [];

                    commits.push({
                        hash,
                        shortHash,
                        author,
                        date,
                        message,
                        parentHashes
                    });
                }
            }

            return commits;
        } catch (error) {
            console.error('Error getting repository log:', error);
            return [];
        }
    }

    /**
     * Revert a commit in a new branch
     * Creates a new branch from HEAD and applies the revert
     */
    async revertCommitInNewBranch(commitHash: string, branchName: string, repoRoot: string): Promise<string> {
        try {
            // Create new branch from current HEAD
            await execAsync(`git checkout -b ${branchName}`, { cwd: repoRoot });

            // Revert the commit
            await execAsync(`git revert ${commitHash} --no-edit`, { cwd: repoRoot });

            return branchName;
        } catch (error) {
            throw new Error(`Failed to revert commit in new branch: ${error}`);
        }
    }

    /**
     * Cherry-pick a commit onto current branch
     */
    async cherryPickCommit(commitHash: string, repoRoot: string): Promise<void> {
        try {
            await execAsync(`git cherry-pick ${commitHash}`, { cwd: repoRoot });
        } catch (error) {
            throw new Error(`Failed to cherry-pick commit: ${error}`);
        }
    }

    /**
     * Create a new branch from a specific commit
     */
    async createBranchFromCommit(branchName: string, commitHash: string, repoRoot: string): Promise<void> {
        try {
            await execAsync(`git branch ${branchName} ${commitHash}`, { cwd: repoRoot });
        } catch (error) {
            throw new Error(`Failed to create branch: ${error}`);
        }
    }

    /**
     * Checkout to a branch
     */
    async checkoutBranch(branchName: string, repoRoot: string): Promise<void> {
        try {
            await execAsync(`git checkout ${branchName}`, { cwd: repoRoot });
        } catch (error) {
            throw new Error(`Failed to checkout branch: ${error}`);
        }
    }

    /**
     * Get all branches (local and remote) sorted by most recent activity
     */
    async getBranches(repoRoot: string, limit: number = 20): Promise<BranchInfo[]> {
        try {
            // Get branches sorted by most recent commit
            const format = '%(refname:short)|%(HEAD)|%(objectname)|%(objectname:short)|%(subject)|%(authorname)|%(committerdate:relative)|%(upstream:short)';
            const { stdout } = await execAsync(
                `git branch -a --sort=-committerdate --format="${format}" | head -n ${limit}`,
                { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 }
            );

            if (!stdout.trim()) {
                return [];
            }

            const branches: BranchInfo[] = [];
            const lines = stdout.trim().split('\n');
            const seenBranches = new Set<string>(); // To avoid duplicate remotes

            for (const line of lines) {
                const parts = line.split('|');
                if (parts.length >= 7) {
                    let branchName = parts[0].trim();
                    const isCurrent = parts[1].trim() === '*';
                    const commitHash = parts[2].trim();
                    const shortCommitHash = parts[3].trim();
                    const lastCommitMessage = parts[4].trim();
                    const lastCommitAuthor = parts[5].trim();
                    const lastCommitDate = parts[6].trim();
                    const upstream = parts[7]?.trim() || undefined;

                    // Skip remote tracking refs that are duplicates
                    const isRemote = branchName.startsWith('remotes/');
                    if (isRemote) {
                        branchName = branchName.replace('remotes/', '');
                        // Skip if we already have the local version
                        const localName = branchName.replace(/^[^/]+\//, '');
                        if (seenBranches.has(localName)) {
                            continue;
                        }
                    }

                    seenBranches.add(isRemote ? branchName.replace(/^[^/]+\//, '') : branchName);

                    branches.push({
                        name: branchName,
                        isCurrent,
                        isRemote,
                        commitHash,
                        shortCommitHash,
                        lastCommitMessage,
                        lastCommitAuthor,
                        lastCommitDate,
                        upstream
                    });
                }
            }

            return branches;
        } catch (error) {
            console.error('Error getting branches:', error);
            return [];
        }
    }

    /**
     * Delete a branch (local or remote)
     */
    async deleteBranch(branchName: string, repoRoot: string, force: boolean = false): Promise<void> {
        try {
            const flag = force ? '-D' : '-d';
            await execAsync(`git branch ${flag} ${branchName}`, { cwd: repoRoot });
        } catch (error) {
            throw new Error(`Failed to delete branch: ${error}`);
        }
    }

    /**
     * Get the current user's git name
     */
    async getCurrentUserName(repoRoot: string): Promise<string | null> {
        try {
            const { stdout } = await execAsync('git config user.name', { cwd: repoRoot });
            return stdout.trim() || null;
        } catch (error) {
            return null;
        }
    }

    /**
     * Get unique list of authors from branches
     */
    async getBranchAuthors(repoRoot: string): Promise<string[]> {
        try {
            const { stdout } = await execAsync(
                'git for-each-ref --format="%(authorname)" refs/heads refs/remotes | sort -u',
                { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 }
            );

            if (!stdout.trim()) {
                return [];
            }

            return stdout.trim().split('\n').filter(author => author.length > 0);
        } catch (error) {
            console.error('Error getting branch authors:', error);
            return [];
        }
    }

    /**
     * Get the default branch (main or master)
     */
    async getDefaultBranch(repoRoot: string): Promise<string | null> {
        try {
            // Try to detect default branch from remote HEAD
            try {
                const { stdout } = await execAsync('git symbolic-ref refs/remotes/origin/HEAD', {
                    cwd: repoRoot
                });
                const match = stdout.trim().match(/refs\/remotes\/origin\/(.+)/);
                if (match) {
                    return match[1];
                }
            } catch {
                // Remote HEAD not set, continue with fallback
            }

            // Check if origin/main exists
            try {
                await execAsync('git rev-parse --verify origin/main', { cwd: repoRoot });
                return 'origin/main';
            } catch {
                // origin/main doesn't exist
            }

            // Check if origin/master exists
            try {
                await execAsync('git rev-parse --verify origin/master', { cwd: repoRoot });
                return 'origin/master';
            } catch {
                // origin/master doesn't exist
            }

            // Check if main exists locally
            try {
                await execAsync('git rev-parse --verify main', { cwd: repoRoot });
                return 'main';
            } catch {
                // main doesn't exist
            }

            // Check if master exists locally
            try {
                await execAsync('git rev-parse --verify master', { cwd: repoRoot });
                return 'master';
            } catch {
                // master doesn't exist
            }

            return null;
        } catch (error) {
            console.error('Error getting default branch:', error);
            return null;
        }
    }

    /**
     * Get the current branch name
     */
    async getCurrentBranch(repoRoot: string): Promise<string | null> {
        try {
            const { stdout } = await execAsync('git rev-parse --abbrev-ref HEAD', {
                cwd: repoRoot
            });
            const branch = stdout.trim();
            // Check if in detached HEAD state
            if (branch === 'HEAD') {
                return null;
            }
            return branch;
        } catch (error) {
            console.error('Error getting current branch:', error);
            return null;
        }
    }

    /**
     * Get commits ahead of base branch
     */
    async getCommitsAheadOfBase(repoRoot: string, baseBranch: string, currentBranch?: string): Promise<import('../types/git').RebaseCommit[]> {
        try {
            const branch = currentBranch || await this.getCurrentBranch(repoRoot);
            if (!branch) {
                throw new Error('Not on a branch');
            }

            // Get the merge base
            const mergeBase = await this.getMergeBase(repoRoot, baseBranch, branch);
            if (!mergeBase) {
                throw new Error(`Could not find common ancestor between ${branch} and ${baseBranch}`);
            }

            // Get commits from merge base to current branch
            const format = '%H|%h|%an|%ar|%s';
            const { stdout } = await execAsync(
                `git log --format="${format}" ${mergeBase}..${branch}`,
                { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 }
            );

            if (!stdout.trim()) {
                return [];
            }

            const lines = stdout.trim().split('\n');
            const commits: import('../types/git').RebaseCommit[] = [];

            // Process in reverse order (oldest first for rebase)
            for (let i = lines.length - 1; i >= 0; i--) {
                const line = lines[i];
                const [hash, shortHash, author, date, ...messageParts] = line.split('|');
                const message = messageParts.join('|');

                // Get file count and stats for this commit
                try {
                    const { stdout: statOutput } = await execAsync(
                        `git show --stat --format="" ${hash}`,
                        { cwd: repoRoot }
                    );
                    const statLines = statOutput.trim().split('\n');
                    const fileCount = statLines.filter(l => l.includes('|')).length;

                    // Parse additions and deletions from summary line
                    const summaryLine = statLines[statLines.length - 1];
                    const addMatch = summaryLine.match(/(\d+) insertion/);
                    const delMatch = summaryLine.match(/(\d+) deletion/);
                    const additions = addMatch ? parseInt(addMatch[1]) : 0;
                    const deletions = delMatch ? parseInt(delMatch[1]) : 0;

                    commits.push({
                        hash,
                        shortHash,
                        author,
                        date,
                        message,
                        action: 'pick',
                        fileCount,
                        additions,
                        deletions
                    });
                } catch {
                    commits.push({
                        hash,
                        shortHash,
                        author,
                        date,
                        message,
                        action: 'pick'
                    });
                }
            }

            return commits;
        } catch (error) {
            throw new Error(`Failed to get commits ahead of base: ${error}`);
        }
    }

    /**
     * Fetch from remote
     */
    async fetchRemote(repoRoot: string, remote: string = 'origin'): Promise<void> {
        try {
            await execAsync(`git fetch ${remote}`, {
                cwd: repoRoot,
                maxBuffer: 10 * 1024 * 1024
            });
        } catch (error) {
            throw new Error(`Failed to fetch from ${remote}: ${error}`);
        }
    }

    /**
     * Get merge base between two branches
     */
    async getMergeBase(repoRoot: string, branch1: string, branch2: string): Promise<string | null> {
        try {
            const { stdout } = await execAsync(
                `git merge-base ${branch1} ${branch2}`,
                { cwd: repoRoot }
            );
            return stdout.trim();
        } catch (error) {
            console.error('Error getting merge base:', error);
            return null;
        }
    }

    /**
     * Start interactive rebase
     */
    async startInteractiveRebase(repoRoot: string, baseBranch: string, commits: import('../types/git').RebaseCommit[]): Promise<void> {
        try {
            if (commits.length === 0) {
                throw new Error('No commits to rebase');
            }

            const fs = await import('fs');
            const path = await import('path');
            const os = await import('os');

            // Build the rebase todo list
            const todoLines = commits.map(commit => {
                return `${commit.action} ${commit.hash} ${commit.message}`;
            });
            const todoContent = todoLines.join('\n') + '\n';

            // Create a map of commit hashes to new messages for reword actions
            const rewordMessages = new Map<string, string>();
            commits.forEach(commit => {
                if (commit.action === 'reword') {
                    rewordMessages.set(commit.hash, commit.message);
                }
            });

            // Create temporary editor script if there are reword actions
            let editorScript: string | undefined;
            if (rewordMessages.size > 0) {
                const tmpDir = os.tmpdir();
                editorScript = path.join(tmpDir, `gitmaster-editor-${Date.now()}.sh`);

                // Build the editor script that will use the new commit messages
                const scriptContent = `#!/bin/sh
COMMIT_MSG_FILE="$1"
COMMIT_HASH=$(git rev-parse HEAD 2>/dev/null || echo "")

# Map of commit hashes to new messages
${Array.from(rewordMessages.entries()).map(([hash, msg]) =>
                    `if [ "$COMMIT_HASH" = "${hash}" ]; then
    echo "${msg.replace(/"/g, '\\"').replace(/\n/g, '\\n')}" > "$COMMIT_MSG_FILE"
    exit 0
fi`
                ).join('\n')}

# If no match found, keep original message (shouldn't happen)
exit 0
`;

                fs.writeFileSync(editorScript, scriptContent, { mode: 0o755 });
            }

            // Get the oldest commit's parent (the base)
            const oldestCommit = commits[0];
            const { stdout: parentHash } = await execAsync(
                `git rev-parse ${oldestCommit.hash}^`,
                { cwd: repoRoot }
            );
            const base = parentHash.trim();

            // Start the interactive rebase
            try {
                await execAsync(
                    `git rebase -i ${base}`,
                    {
                        cwd: repoRoot,
                        env: {
                            ...process.env,
                            GIT_SEQUENCE_EDITOR: `sh -c 'echo "${todoContent.replace(/"/g, '\\"')}" > "$1"' --`,
                            GIT_EDITOR: editorScript || 'true',
                            EDITOR: editorScript || 'true'
                        }
                    }
                );
            } finally {
                // Clean up the temporary editor script
                if (editorScript && fs.existsSync(editorScript)) {
                    try {
                        fs.unlinkSync(editorScript);
                    } catch (err) {
                        console.error('Failed to delete temporary editor script:', err);
                    }
                }
            }
        } catch (error) {
            throw new Error(`Failed to start interactive rebase: ${error}`);
        }
    }

    /**
     * Continue rebase after resolving conflicts
     */
    async continueRebase(repoRoot: string): Promise<void> {
        try {
            await execAsync('git rebase --continue', {
                cwd: repoRoot,
                maxBuffer: 10 * 1024 * 1024,
                env: {
                    ...process.env,
                    GIT_EDITOR: 'true',
                    EDITOR: 'true'
                }
            });
        } catch (error) {
            throw new Error(`Failed to continue rebase: ${error}`);
        }
    }

    /**
     * Abort rebase operation
     */
    async abortRebase(repoRoot: string): Promise<void> {
        try {
            await execAsync('git rebase --abort', {
                cwd: repoRoot
            });
        } catch (error) {
            throw new Error(`Failed to abort rebase: ${error}`);
        }
    }

    /**
     * Check if rebase is in progress
     */
    async isRebaseInProgress(repoRoot: string): Promise<boolean> {
        try {
            const fs = await import('fs');
            const path = await import('path');
            const rebaseMergeDir = path.join(repoRoot, '.git', 'rebase-merge');
            const rebaseApplyDir = path.join(repoRoot, '.git', 'rebase-apply');

            return fs.existsSync(rebaseMergeDir) || fs.existsSync(rebaseApplyDir);
        } catch (error) {
            return false;
        }
    }

    /**
     * Get rebase conflict files
     */
    async getRebaseConflicts(repoRoot: string): Promise<string[]> {
        try {
            const { stdout } = await execAsync('git diff --name-only --diff-filter=U', {
                cwd: repoRoot
            });

            if (!stdout.trim()) {
                return [];
            }

            return stdout.trim().split('\n');
        } catch (error) {
            console.error('Error getting rebase conflicts:', error);
            return [];
        }
    }
}

