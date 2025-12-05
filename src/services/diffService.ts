import * as vscode from 'vscode';
import * as path from 'path';
import { GitService } from './gitService';
import { CommitInfo } from '../types/git';

/**
 * Service for handling file diffs
 */
export class DiffService {
    constructor(private gitService: GitService) { }

    /**
     * Show a diff for a specific file in a commit
     */
    async showFileDiff(
        relativePath: string,
        commit: CommitInfo,
        repoRoot: string,
        oldPath?: string,
        status?: string,
        line?: number
    ): Promise<void> {
        try {
            const parentCommit = await this.gitService.getParentCommit(commit.hash, repoRoot);
            const { leftContent, leftTitle } = await this.getLeftSideContent(
                relativePath,
                commit,
                repoRoot,
                parentCommit,
                oldPath
            );
            const { rightContent, rightTitle } = await this.getRightSideContent(
                relativePath,
                commit,
                repoRoot,
                status
            );

            const title = this.getDiffTitle(relativePath, commit, oldPath, status);
            const leftPath = oldPath || relativePath;
            const rightPath = relativePath;
            // We can try to pass absolute paths if possible, but we only have relative paths and repoRoot
            const leftAbsolutePath = path.join(repoRoot, leftPath);
            const rightAbsolutePath = path.join(repoRoot, rightPath);

            await this.openDiffView(
                leftContent,
                leftTitle,
                rightContent,
                rightTitle,
                title,
                leftAbsolutePath,
                rightAbsolutePath,
                repoRoot,
                parentCommit || undefined,
                commit.hash,
                line
            );
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to show diff: ${error}`);
        }
    }

    /**
     * Get content and title for the left side (parent commit) of the diff
     */
    private async getLeftSideContent(
        relativePath: string,
        commit: CommitInfo,
        repoRoot: string,
        parentCommit: string | null,
        oldPath?: string
    ): Promise<{ leftContent: string; leftTitle: string }> {
        const fileName = path.basename(relativePath);
        let leftContent = '';
        let leftTitle = `${fileName} (empty)`;

        if (parentCommit) {
            try {
                const pathToUse = oldPath || relativePath;
                leftContent = await this.gitService.getFileContentAtCommit(pathToUse, parentCommit, repoRoot);
                const leftFileName = path.basename(pathToUse);
                leftTitle = `${leftFileName} (${parentCommit.substring(0, 7)})`;
            } catch (error) {
                // File might not exist in parent commit (e.g., it was added)
                leftContent = '';
                leftTitle = `${fileName} (empty)`;
            }
        }

        return { leftContent, leftTitle };
    }

    /**
     * Get content and title for the right side (current commit) of the diff
     */
    private async getRightSideContent(
        relativePath: string,
        commit: CommitInfo,
        repoRoot: string,
        status?: string
    ): Promise<{ rightContent: string; rightTitle: string }> {
        const fileName = path.basename(relativePath);
        let rightContent = '';
        let rightTitle = `${fileName} (${commit.shortHash})`;

        const isDeleted = status === 'D';

        if (!isDeleted) {
            try {
                rightContent = await this.gitService.getFileContentAtCommit(relativePath, commit.hash, repoRoot);
            } catch (error) {
                rightContent = '';
                rightTitle = `${fileName} (deleted)`;
            }
        } else {
            rightContent = '';
            rightTitle = `${fileName} (deleted)`;
        }

        return { rightContent, rightTitle };
    }

    /**
     * Generate an appropriate title for the diff view
     */
    private getDiffTitle(
        relativePath: string,
        commit: CommitInfo,
        oldPath?: string,
        status?: string
    ): string {
        const fileName = path.basename(relativePath);

        if (status === 'R' && oldPath) {
            return `${oldPath} → ${relativePath}`;
        }
        if (status === 'D') {
            return `${relativePath} (deleted)`;
        }
        if (status === 'A') {
            return `${relativePath} (added)`;
        }

        return `${fileName}: ${commit.message}`;
    }

    /**
     * Open VS Code's diff view with the provided content
     */
    private async openDiffView(
        leftContent: string,
        leftTitle: string,
        rightContent: string,
        rightTitle: string,
        title: string,
        leftPath: string,
        rightPath: string,
        repoRoot?: string,
        leftCommit?: string,
        rightCommit?: string,
        line?: number
    ): Promise<void> {
        const leftData = {
            content: leftContent,
            commit: leftCommit
        };

        const rightData = {
            content: rightContent,
            commit: rightCommit
        };

        // Use vscode.Uri.file to properly handle paths (Windows/Unix), then change scheme
        const leftUri = vscode.Uri.file(leftPath).with({
            scheme: 'gitmaster-diff',
            query: Buffer.from(JSON.stringify(leftData)).toString('base64')
        });

        const rightUri = vscode.Uri.file(rightPath).with({
            scheme: 'gitmaster-diff',
            query: Buffer.from(JSON.stringify(rightData)).toString('base64')
        });

        const provider = new DiffContentProvider();
        const providerDisposable = vscode.workspace.registerTextDocumentContentProvider('gitmaster-diff', provider);

        const options: vscode.TextDocumentShowOptions = {};
        if (typeof line === 'number') {
            options.selection = new vscode.Range(line, 0, line, 0);
        }

        await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title, options);

        // Clean up after a delay
        setTimeout(() => {
            providerDisposable.dispose();
        }, 1000);
    }
}

/**
 * Content provider for diff views
 * Decodes base64 content from URI query parameters
 * Handles both legacy (raw content) and new (JSON with metadata) formats
 */
export class DiffContentProvider implements vscode.TextDocumentContentProvider {
    provideTextDocumentContent(uri: vscode.Uri): string {
        try {
            const base64Content = uri.query;
            const decoded = Buffer.from(base64Content, 'base64').toString('utf-8');

            // Try to parse as JSON (new format)
            try {
                const data = JSON.parse(decoded);
                if (data && typeof data.content === 'string') {
                    return data.content;
                }
            } catch {
                // Not JSON, assume legacy raw content
            }

            return decoded;
        } catch (error) {
            return '';
        }
    }
}

