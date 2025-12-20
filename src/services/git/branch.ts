import { GitExecutor } from './core';
import { BranchInfo } from '../../types/git';

export class GitBranchService {
    constructor(private executor: GitExecutor) {}

    /**
     * Checkout to a specific commit
     */
    async checkoutCommit(commitHash: string, repoRoot: string): Promise<void> {
        try {
            await this.executor.exec(['checkout', commitHash], { cwd: repoRoot });
        } catch (error) {
            throw new Error(`Failed to checkout commit: ${error}`);
        }
    }

    /**
     * Revert a commit in a new branch
     * Creates a new branch from HEAD and applies the revert
     */
    async revertCommitInNewBranch(commitHash: string, branchName: string, repoRoot: string): Promise<string> {
        try {
            // Create new branch from current HEAD
            await this.executor.exec(['checkout', '-b', branchName], { cwd: repoRoot });

            // Revert the commit
            await this.executor.exec(['revert', commitHash, '--no-edit'], { cwd: repoRoot });

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
            await this.executor.exec(['cherry-pick', commitHash], { cwd: repoRoot });
        } catch (error) {
            throw new Error(`Failed to cherry-pick commit: ${error}`);
        }
    }

    /**
     * Create a new branch from a specific commit
     */
    async createBranchFromCommit(branchName: string, commitHash: string, repoRoot: string): Promise<void> {
        try {
            await this.executor.exec(['branch', branchName, commitHash], { cwd: repoRoot });
        } catch (error) {
            throw new Error(`Failed to create branch: ${error}`);
        }
    }

    /**
     * Checkout to a branch
     */
    async checkoutBranch(branchName: string, repoRoot: string): Promise<void> {
        try {
            await this.executor.exec(['checkout', branchName], { cwd: repoRoot });
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
            const { stdout } = await this.executor.execShell(
                `git branch -a --sort=-committerdate --format="${format}" | head -n ${limit}`,
                { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 },
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
                        upstream,
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
            await this.executor.exec(['branch', flag, branchName], { cwd: repoRoot });
        } catch (error) {
            throw new Error(`Failed to delete branch: ${error}`);
        }
    }

    /**
     * Get unique list of authors from branches
     */
    async getBranchAuthors(repoRoot: string): Promise<string[]> {
        try {
            const { stdout } = await this.executor.execShell(
                'git for-each-ref --format="%(authorname)" refs/heads refs/remotes | sort -u',
                { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 },
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
                const { stdout } = await this.executor.exec(['symbolic-ref', 'refs/remotes/origin/HEAD'], {
                    cwd: repoRoot,
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
                await this.executor.exec(['rev-parse', '--verify', 'origin/main'], { cwd: repoRoot });
                return 'origin/main';
            } catch {
                // origin/main doesn't exist
            }

            // Check if origin/master exists
            try {
                await this.executor.exec(['rev-parse', '--verify', 'origin/master'], { cwd: repoRoot });
                return 'origin/master';
            } catch {
                // origin/master doesn't exist
            }

            // Check if main exists locally
            try {
                await this.executor.exec(['rev-parse', '--verify', 'main'], { cwd: repoRoot });
                return 'main';
            } catch {
                // main doesn't exist
            }

            // Check if master exists locally
            try {
                await this.executor.exec(['rev-parse', '--verify', 'master'], { cwd: repoRoot });
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
            const { stdout } = await this.executor.exec(['rev-parse', '--abbrev-ref', 'HEAD'], {
                cwd: repoRoot,
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
     * Get merge base between two branches
     */
    async getMergeBase(repoRoot: string, branch1: string, branch2: string): Promise<string | null> {
        try {
            const { stdout } = await this.executor.exec(
                ['merge-base', branch1, branch2],
                { cwd: repoRoot },
            );
            return stdout.trim();
        } catch (error) {
            console.error('Error getting merge base:', error);
            return null;
        }
    }
}
