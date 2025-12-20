import { GitExecutor } from './core';
import { GitWorktree } from '../../types/git';

export class GitWorktreeService {
    constructor(private executor: GitExecutor) { }

    /**
     * Get list of git worktrees
     */
    async getWorktrees(repoRoot: string): Promise<GitWorktree[]> {
        try {
            const { stdout } = await this.executor.exec(['worktree', 'list', '--porcelain'], {
                cwd: repoRoot,
            });

            if (!stdout.trim()) {
                return [];
            }

            const worktrees: GitWorktree[] = [];
            const entries = stdout.trim().split('\n\n');

            // Normalize repo root for comparison
            const path = await import('path');
            const normalizedRepoRoot = path.normalize(repoRoot);

            for (const entry of entries) {
                if (!entry.trim()) {
                    continue;
                }

                const lines = entry.trim().split('\n');
                let wtPath = '';
                let head = '';
                let branch = '';
                let isMain = false; // The porcelain format doesn't explicitly say main, but usually first one or we can infer

                for (const line of lines) {
                    if (line.startsWith('worktree ')) {
                        wtPath = line.substring(9).trim();
                    } else if (line.startsWith('HEAD ')) {
                        head = line.substring(5).trim();
                    } else if (line.startsWith('branch ')) {
                        branch = line.substring(7).replace('refs/heads/', '').trim();
                    }
                }

                // If branch is empty, it might be detached
                if (!branch) {
                    branch = '(detached)';
                }

                // Check if this is the current worktree (repoRoot)
                // We need to be careful with path normalization
                // On macOS /private/var... vs /var... can be tricky, so we use realpath if possible or just string compare
                const normalizedWtPath = path.normalize(wtPath);

                // Usually the first worktree listed is the main one (bare repo or main worktree)
                // A better check for main worktree might be checking if .git is a directory inside it vs a file
                // But simply assuming the first one is main is common heuristic,
                // OR we can check if the worktree path contains the .git directory directly.
                // For now, let's treat the first entry as main if we can't determine otherwise.
                if (worktrees.length === 0) {
                    isMain = true;
                }

                worktrees.push({
                    path: wtPath,
                    head,
                    branch,
                    isMain,
                    isCurrent: normalizedWtPath === normalizedRepoRoot || normalizedRepoRoot.startsWith(normalizedWtPath), // Approximate check
                });
            }

            // Refine isCurrent check: compare standard paths
            const fs = await import('fs');
            let currentRealRoot = repoRoot;
            try {
                currentRealRoot = fs.realpathSync(repoRoot);
            } catch (e) { }

            for (const wt of worktrees) {
                let wtReal = wt.path;
                try {
                    wtReal = fs.realpathSync(wt.path);
                } catch (e) { }
                wt.isCurrent = (wtReal === currentRealRoot);
            }

            return worktrees;
        } catch (error) {
            console.error('Error getting worktrees:', error);
            // Fallback to non-porcelain if porcelain fails (older git versions)
            return this.getWorktreesLegacy(repoRoot);
        }
    }

    private async getWorktreesLegacy(repoRoot: string): Promise<GitWorktree[]> {
        try {
            const { stdout } = await this.executor.exec(['worktree', 'list'], { cwd: repoRoot });
            if (!stdout.trim()) { return []; }

            const worktrees: GitWorktree[] = [];
            const fs = await import('fs');

            let currentRealRoot = repoRoot;
            try { currentRealRoot = fs.realpathSync(repoRoot); } catch (e) { }

            for (const line of stdout.trim().split('\n')) {
                // Format: /path/to/wt  hash [branch]
                // or:    /path/to/wt  hash (detached HEAD)
                const parts = line.split(/\s+/);
                if (parts.length >= 2) {
                    const wtPath = parts[0];
                    const head = parts[1];
                    const branchPart = parts.slice(2).join(' ');
                    const branch = branchPart.replace('[', '').replace(']', '');

                    let wtReal = wtPath;
                    try { wtReal = fs.realpathSync(wtPath); } catch (e) { }

                    worktrees.push({
                        path: wtPath,
                        head,
                        branch,
                        isMain: worktrees.length === 0,
                        isCurrent: wtReal === currentRealRoot,
                    });
                }
            }
            return worktrees;
        } catch (e) {
            console.error('Error in legacy worktree list:', e);
            return [];
        }
    }

    /**
     * Add a new worktree
     */
    async addWorktree(repoRoot: string, worktreePath: string, branchName: string, originBranch?: string): Promise<void> {
        try {
            const args = ['worktree', 'add', worktreePath, '-b', branchName];
            if (originBranch) {
                args.push(originBranch);
            }
            await this.executor.exec(args, { cwd: repoRoot });
        } catch (error) {
            throw new Error(`Failed to add worktree: ${error}`);
        }
    }

    /**
     * Remove a worktree
     */
    async removeWorktree(repoRoot: string, worktreePath: string, force: boolean = false): Promise<void> {
        try {
            const args = ['worktree', 'remove'];
            if (force) {
                args.push('--force');
            }
            args.push(worktreePath);
            await this.executor.exec(args, { cwd: repoRoot });
        } catch (error) {
            throw new Error(`Failed to remove worktree: ${error}`);
        }
    }

    /**
     * Prune worktree information
     */
    async pruneWorktrees(repoRoot: string): Promise<void> {
        try {
            await this.executor.exec(['worktree', 'prune'], { cwd: repoRoot });
        } catch (error) {
            throw new Error(`Failed to prune worktrees: ${error}`);
        }
    }
}
