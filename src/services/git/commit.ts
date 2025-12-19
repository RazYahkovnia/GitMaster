import { GitExecutor } from './core';
import { CommitInfo, ChangedFile } from '../../types/git';
import { GitUtils } from './utils';

export class GitCommitService {
    constructor(private executor: GitExecutor) { }

    /**
     * Get detailed information about a single commit
     */
    async getCommitInfo(
        commitHash: string,
        repoRoot: string,
        options?: { timeoutMs?: number }
    ): Promise<CommitInfo | null> {
        try {
            const format = '%H|%h|%an|%ai|%ar|%s';
            const { stdout } = await this.executor.exec(
                ['show', '--no-patch', `--format=${format}`, commitHash],
                { cwd: repoRoot, timeout: options?.timeoutMs }
            );

            if (!stdout.trim()) {
                return null;
            }

            const commits = GitUtils.parseCommitLog(stdout);
            return commits.length > 0 ? commits[0] : null;
        } catch (error) {
            console.error('Error getting commit info:', error);
            return null;
        }
    }

    /**
     * Get the full diff of a specific commit
     */
    async getCommitDiff(commitHash: string, repoRoot: string): Promise<string> {
        try {
            // git show provides the commit message and the diff
            const { stdout } = await this.executor.exec(['show', commitHash], {
                cwd: repoRoot,
                maxBuffer: 10 * 1024 * 1024
            });
            return stdout;
        } catch (error) {
            // Fallback if git show fails or is too large, just return message
            console.error('Error getting commit diff:', error);
            return '';
        }
    }

    /**
     * Get the parent commit hash
     */
    async getParentCommit(commitHash: string, repoRoot: string): Promise<string | null> {
        try {
            const { stdout } = await this.executor.exec(
                ['rev-parse', `${commitHash}^`],
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
    async getChangedFilesInCommit(
        commitHash: string,
        repoRoot: string,
        options?: { timeoutMs?: number; detectRenames?: boolean }
    ): Promise<ChangedFile[]> {
        try {
            const files = await this.getChangedFilesStats(commitHash, repoRoot, options);
            const statusMap = await this.getFileStatuses(commitHash, repoRoot, options);

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
     * Get file statistics (additions/deletions) for a commit
     */
    private async getChangedFilesStats(
        commitHash: string,
        repoRoot: string,
        options?: { timeoutMs?: number; detectRenames?: boolean }
    ): Promise<ChangedFile[]> {
        // Add --root flag to handle the initial commit (which has no parent)
        const detectRenames = options?.detectRenames ?? true;
        const { stdout } = await this.executor.exec(
            [
                'diff-tree',
                '--root',
                '--no-commit-id',
                '--numstat',
                ...(detectRenames ? ['-M'] : []),
                '-r',
                commitHash
            ],
            { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024, timeout: options?.timeoutMs }
        );

        const files: ChangedFile[] = [];
        const lines = stdout.trim().split('\n').filter(line => line.trim());

        for (const line of lines) {
            const parts = line.split('\t');
            if (parts.length >= 3) {
                const additions = parts[0] === '-' ? 0 : parseInt(parts[0]) || 0;
                const deletions = parts[1] === '-' ? 0 : parseInt(parts[1]) || 0;
                const { path: filePath, oldPath } = GitUtils.parseRenamedPath(parts[2]);

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
    private async getFileStatuses(
        commitHash: string,
        repoRoot: string,
        options?: { timeoutMs?: number; detectRenames?: boolean }
    ): Promise<Map<string, { status: string, oldPath?: string }>> {
        // Add --root flag to handle the initial commit (which has no parent)
        const detectRenames = options?.detectRenames ?? true;
        const { stdout } = await this.executor.exec(
            [
                'diff-tree',
                '--root',
                '--no-commit-id',
                '--name-status',
                ...(detectRenames ? ['-M'] : []),
                '-r',
                commitHash
            ],
            { cwd: repoRoot, timeout: options?.timeoutMs }
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
}
