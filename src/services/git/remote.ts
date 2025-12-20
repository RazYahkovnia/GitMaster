import * as path from 'path';
import { GitExecutor } from './core';
import { GitStatusService } from './status';
import { GitBranchService } from './branch';

export class GitRemoteService {
    constructor(
        private executor: GitExecutor,
        private statusService: GitStatusService,
        private branchService: GitBranchService,
    ) { }

    /**
     * Get the GitHub repository URL from remote origin
     */
    async getGitHubRepoUrl(repoRoot: string): Promise<string | null> {
        try {
            const { stdout } = await this.executor.exec(
                ['config', '--get', 'remote.origin.url'],
                { cwd: repoRoot },
            );

            const url = stdout.trim();
            return this.normalizeRemoteUrl(url);
        } catch (error) {
            return null;
        }
    }

    /**
     * Get remote URL (GitHub, GitLab, Bitbucket, etc.)
     */
    async getRemoteUrl(repoRoot: string): Promise<string | null> {
        try {
            const { stdout } = await this.executor.exec(
                ['config', '--get', 'remote.origin.url'],
                { cwd: repoRoot },
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
        endLine?: number,
    ): Promise<string | null> {
        try {
            const repoRoot = await this.statusService.getRepoRoot(filePath);
            if (!repoRoot) {
                return null;
            }

            // Get remote URL
            const remoteUrl = await this.getRemoteUrl(repoRoot);
            if (!remoteUrl) {
                return null;
            }

            // Get current branch or commit
            const branch = await this.branchService.getCurrentBranch(repoRoot);
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
        endLine?: number,
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
     * Fetch from remote
     */
    async fetchRemote(repoRoot: string, remote: string = 'origin'): Promise<void> {
        try {
            await this.executor.exec(['fetch', remote], {
                cwd: repoRoot,
                maxBuffer: 10 * 1024 * 1024,
            });
        } catch (error) {
            throw new Error(`Failed to fetch from ${remote}: ${error}`);
        }
    }
}
