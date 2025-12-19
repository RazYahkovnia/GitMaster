import * as path from 'path';
import { GitExecutor } from './core';

export class GitStatusService {
    private repoRootCache = new Map<string, string | null>();

    constructor(private executor: GitExecutor) { }

    /**
     * Clear the repository root cache
     */
    clearCache(): void {
        this.repoRootCache.clear();
    }

    /**
     * Get the git repository root directory for a given file or folder path
     */
    async getRepoRoot(filePath: string, options?: { timeoutMs?: number }): Promise<string | null> {
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

            // Check cache
            if (this.repoRootCache.has(dirPath)) {
                return this.repoRootCache.get(dirPath)!;
            }

            const { stdout } = await this.executor.exec(['rev-parse', '--show-toplevel'], {
                cwd: dirPath,
                timeout: options?.timeoutMs
            });
            const result = path.normalize(stdout.trim());

            // Cache the result
            this.repoRootCache.set(dirPath, result);

            return result;
        } catch (error) {
            // console.warn('GitMaster: Failed to resolve repo root:', error);
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
            await this.executor.exec(['ls-files', '--error-unmatch', fileName], {
                cwd: dirPath
            });
            return true;
        } catch (error) {
            return false;
        }
    }

    /**
     * Get the current user's git name
     */
    async getCurrentUserName(repoRoot: string): Promise<string | null> {
        try {
            const { stdout } = await this.executor.exec(['config', 'user.name'], { cwd: repoRoot });
            return stdout.trim() || null;
        } catch (error) {
            return null;
        }
    }
}
