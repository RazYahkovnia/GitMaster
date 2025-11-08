import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';

const execAsync = promisify(exec);

export interface CommitInfo {
    hash: string;
    shortHash: string;
    message: string;
    author: string;
    date: string;
    relativeDate: string;
}

export interface ChangedFile {
    path: string;
    status: string; // A (added), M (modified), D (deleted), R (renamed)
    additions: number;
    deletions: number;
}

export class GitService {
    /**
     * Get the git repository root directory for a given file path
     */
    async getRepoRoot(filePath: string): Promise<string | null> {
        try {
            const dirPath = path.dirname(filePath);
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

            // Format: hash|short-hash|author|date|relative-date|message
            const format = '%H|%h|%an|%ai|%ar|%s';
            const { stdout } = await execAsync(
                `git log --follow --format="${format}" -- "${filePath}"`,
                { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 }
            );

            if (!stdout.trim()) {
                return [];
            }

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
            // No parent (initial commit)
            return null;
        }
    }

    /**
     * Get the diff for a file between two commits
     */
    async getFileDiff(filePath: string, commitHash: string, parentHash: string | null): Promise<string> {
        try {
            const repoRoot = await this.getRepoRoot(filePath);
            if (!repoRoot) {
                throw new Error('Not a git repository');
            }

            const compareHash = parentHash || '4b825dc642cb6eb9a060e54bf8d69288fbee4904'; // Empty tree hash for initial commit
            const { stdout } = await execAsync(
                `git diff ${compareHash} ${commitHash} -- "${filePath}"`,
                { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 }
            );

            return stdout;
        } catch (error) {
            throw new Error(`Failed to get diff: ${error}`);
        }
    }

    /**
     * Get all files changed in a specific commit
     */
    async getChangedFilesInCommit(commitHash: string, repoRoot: string): Promise<ChangedFile[]> {
        try {
            const { stdout } = await execAsync(
                `git show --pretty="" --numstat ${commitHash}`,
                { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 }
            );

            const files: ChangedFile[] = [];
            const lines = stdout.trim().split('\n').filter(line => line.trim());

            for (const line of lines) {
                const parts = line.split('\t');
                if (parts.length >= 3) {
                    const additions = parseInt(parts[0]) || 0;
                    const deletions = parseInt(parts[1]) || 0;
                    const filePath = parts[2];

                    // Determine status
                    let status = 'M'; // Modified by default
                    if (parts[0] === '-' && parts[1] === '-') {
                        status = 'Binary';
                    } else if (additions > 0 && deletions === 0) {
                        // Could be added, but we'll check properly
                        status = 'M';
                    }

                    files.push({
                        path: filePath,
                        status,
                        additions,
                        deletions
                    });
                }
            }

            // Get proper status using diff-tree
            const { stdout: statusOutput } = await execAsync(
                `git diff-tree --no-commit-id --name-status -r ${commitHash}`,
                { cwd: repoRoot }
            );

            const statusLines = statusOutput.trim().split('\n');
            for (const line of statusLines) {
                const [status, filePath] = line.split('\t');
                const file = files.find(f => f.path === filePath);
                if (file) {
                    file.status = status;
                }
            }

            return files;
        } catch (error) {
            throw new Error(`Failed to get changed files: ${error}`);
        }
    }

    /**
     * Get the GitHub repository URL
     */
    async getGitHubRepoUrl(repoRoot: string): Promise<string | null> {
        try {
            const { stdout } = await execAsync(
                'git config --get remote.origin.url',
                { cwd: repoRoot }
            );

            const url = stdout.trim();

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
        } catch (error) {
            return null;
        }
    }

    /**
     * Get detailed commit information
     */
    async getCommitDetails(commitHash: string, repoRoot: string): Promise<CommitInfo> {
        try {
            const format = '%H|%h|%an|%ae|%ai|%ar|%s|%b';
            const { stdout } = await execAsync(
                `git show --quiet --format="${format}" ${commitHash}`,
                { cwd: repoRoot }
            );

            const parts = stdout.trim().split('|');
            return {
                hash: parts[0],
                shortHash: parts[1],
                author: parts[2],
                date: parts[4],
                relativeDate: parts[5],
                message: parts[6]
            };
        } catch (error) {
            throw new Error(`Failed to get commit details: ${error}`);
        }
    }
}

