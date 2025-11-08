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
            const { stdout } = await execAsync(
                `git stash show --numstat ${stashIndex}`,
                { cwd: repoRoot }
            );
            const lines = stdout.trim().split('\n').filter(line => line.trim());
            return lines.length;
        } catch (error) {
            return 0;
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
     * Create a new stash with a custom message
     */
    async createStash(repoRoot: string, message: string, includeUntracked: boolean = false): Promise<void> {
        try {
            const flags = includeUntracked ? '-u' : '';
            await execAsync(
                `git stash push ${flags} -m "${message}"`,
                { cwd: repoRoot }
            );
        } catch (error) {
            throw new Error(`Failed to create stash: ${error}`);
        }
    }

    /**
     * Apply a stash (keeps it in the stash list)
     */
    async applyStash(stashIndex: string, repoRoot: string): Promise<void> {
        try {
            await execAsync(`git stash apply ${stashIndex}`, { cwd: repoRoot });
        } catch (error) {
            throw new Error(`Failed to apply stash: ${error}`);
        }
    }

    /**
     * Pop a stash (applies and removes from stash list)
     */
    async popStash(stashIndex: string, repoRoot: string): Promise<void> {
        try {
            await execAsync(`git stash pop ${stashIndex}`, { cwd: repoRoot });
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
            const { stdout } = await execAsync(
                `git stash show --numstat ${stashIndex}`,
                { cwd: repoRoot }
            );

            const files: ChangedFile[] = [];
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
            const { stdout } = await execAsync(
                `git show ${stashIndex}:"${relativePath}"`,
                { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 }
            );
            return stdout;
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
     * Get the current branch name
     */
    async getCurrentBranch(repoRoot: string): Promise<string | null> {
        try {
            const { stdout } = await execAsync('git branch --show-current', { cwd: repoRoot });
            return stdout.trim() || null;
        } catch (error) {
            return null;
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
}

