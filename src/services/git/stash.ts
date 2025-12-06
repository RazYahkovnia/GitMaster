import { GitExecutor } from './core';
import { StashInfo, ChangedFile } from '../../types/git';

export class GitStashService {
    constructor(private executor: GitExecutor) {}

    /**
     * Get all stashes in the repository
     */
    async getStashes(repoRoot: string): Promise<StashInfo[]> {
        try {
            const { stdout } = await this.executor.exec(['stash', 'list'], { cwd: repoRoot });

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
                const { stdout } = await this.executor.exec(
                    ['stash', 'show', '--numstat', stashIndex],
                    { cwd: repoRoot }
                );
                const lines = stdout.trim().split('\n').filter(line => line.trim());
                count += lines.length;
            } catch (error) {
                // Stash might be empty of tracked changes
            }

            // Count untracked files (in third parent)
            try {
                const { stdout } = await this.executor.exec(
                    ['ls-tree', '-r', `${stashIndex}^3`, '--name-only'],
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
            await this.executor.exec(
                ['rev-parse', '--verify', `${stashIndex}^3`],
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
            const { stdout } = await this.executor.exec(['status', '--porcelain'], { cwd: repoRoot });
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
            const { stdout } = await this.executor.exec(['status', '--porcelain'], { cwd: repoRoot });
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
            const { stdout } = await this.executor.exec(['status', '--porcelain'], { cwd: repoRoot });
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
            await this.executor.exec(['diff', '--cached', '--quiet'], { cwd: repoRoot });
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
            const { stdout: stagedFiles } = await this.executor.exec(['diff', '--cached', '--name-only'], { cwd: repoRoot });
            const stagedSet = new Set(stagedFiles.trim().split('\n').filter(f => f.length > 0));

            // Get files with unstaged changes
            const { stdout: unstagedFiles } = await this.executor.exec(['diff', '--name-only'], { cwd: repoRoot });
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
            const { stdout: stagedStats } = await this.executor.exec(['diff', '--cached', '--numstat'], { cwd: repoRoot });
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
            const { stdout: unstagedStats } = await this.executor.exec(['diff', '--numstat'], { cwd: repoRoot });
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
                const { stdout: untrackedFiles } = await this.executor.exec(['ls-files', '--others', '--exclude-standard'], { cwd: repoRoot });
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
            const args = ['stash', 'push'];
            
            if (stagedOnly) {
                // --staged requires Git 2.35+
                args.push('--staged');
            } else {
                if (includeUntracked) {
                    args.push('-u');
                }
                if (keepIndex) {
                    args.push('--keep-index');
                }
            }
            
            args.push('-m', message);

            // Build file path arguments if specific files are provided
            if (specificFiles && specificFiles.length > 0) {
                args.push('--', ...specificFiles);
            }

            console.log('Executing git command:', args.join(' '));

            await this.executor.exec(args, { cwd: repoRoot });
        } catch (error) {
            throw new Error(`Failed to create stash: ${error}`);
        }
    }

    /**
     * Stash specific files only
     */
    async stashSpecificFiles(repoRoot: string, filePaths: string[]): Promise<void> {
        try {
            const args = ['stash', 'push', '-m', 'temp-file-stash', '--', ...filePaths];
            await this.executor.exec(args, { cwd: repoRoot });
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
                await this.executor.exec(['stash', 'push', '-u', '-m', message], { cwd: repoRoot });
            } else {
                // There are tracked changes - use the 3-step technique
                // Step 1: Stash tracked changes temporarily
                await this.executor.exec(['stash', 'push', '-m', 'temp-tracked'], { cwd: repoRoot });

                // Step 2: Stash everything including untracked
                await this.executor.exec(['stash', 'push', '-u', '-m', message], { cwd: repoRoot });

                // Step 3: Pop the tracked changes back
                await this.executor.exec(['stash', 'pop', 'stash@{1}'], { cwd: repoRoot });
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
            await this.executor.exec(['stash', 'apply', '--index', stashIndex], { cwd: repoRoot });
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
            await this.executor.exec(['stash', 'pop', '--index', stashIndex], { cwd: repoRoot });
        } catch (error) {
            throw new Error(`Failed to pop stash: ${error}`);
        }
    }

    /**
     * Delete a stash without applying
     */
    async deleteStash(stashIndex: string, repoRoot: string): Promise<void> {
        try {
            await this.executor.exec(['stash', 'drop', stashIndex], { cwd: repoRoot });
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
                const { stdout } = await this.executor.exec(
                    ['stash', 'show', '--numstat', stashIndex],
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
                const { stdout: untrackedStdout } = await this.executor.exec(
                    ['ls-tree', '-r', `${stashIndex}^3`, '--name-only'],
                    { cwd: repoRoot }
                );

                const untrackedFiles = untrackedStdout.trim().split('\n').filter(line => line.trim());

                for (const filePath of untrackedFiles) {
                    // Get file size for additions count
                    try {
                        const { stdout: content } = await this.executor.exec(
                            ['show', `${stashIndex}^3:${filePath}`],
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
                const { stdout } = await this.executor.exec(
                    ['show', `${stashIndex}:${relativePath}`],
                    { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 }
                );
                return stdout;
            } catch (error) {
                // File might be in untracked files (third parent)
                const { stdout } = await this.executor.exec(
                    ['show', `${stashIndex}^3:${relativePath}`],
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
            const { stdout } = await this.executor.exec(
                ['show', `${stashIndex}^:${relativePath}`],
                { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 }
            );
            return stdout;
        } catch (error) {
            // File might not exist in parent (new file)
            return '';
        }
    }
}
