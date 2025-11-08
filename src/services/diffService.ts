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
        status?: string
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
            await this.openDiffView(leftContent, leftTitle, rightContent, rightTitle, title);
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
        title: string
    ): Promise<void> {
        const leftUri = vscode.Uri.parse(`gitmaster-diff:${leftTitle}`).with({
            query: Buffer.from(leftContent).toString('base64')
        });

        const rightUri = vscode.Uri.parse(`gitmaster-diff:${rightTitle}`).with({
            query: Buffer.from(rightContent).toString('base64')
        });

        const provider = new DiffContentProvider();
        const providerDisposable = vscode.workspace.registerTextDocumentContentProvider('gitmaster-diff', provider);

        await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title);

        // Clean up after a delay
        setTimeout(() => {
            providerDisposable.dispose();
        }, 1000);
    }
}

/**
 * Content provider for diff views
 * Decodes base64 content from URI query parameters
 */
export class DiffContentProvider implements vscode.TextDocumentContentProvider {
    provideTextDocumentContent(uri: vscode.Uri): string {
        try {
            const base64Content = uri.query;
            return Buffer.from(base64Content, 'base64').toString('utf-8');
        } catch (error) {
            return '';
        }
    }
}

