import * as vscode from 'vscode';
import * as path from 'path';
import { GitService } from '../services/gitService';
import { DiffService } from '../services/diffService';
import { CommitDetailsProvider } from '../providers/commitDetailsProvider';
import { CommitInfo, ChangedFile, RepositoryCommit } from '../types/git';

/**
 * Command handlers for commit-related operations
 */
export class CommitCommands {
    constructor(
        private gitService: GitService,
        private diffService: DiffService,
        private commitDetailsProvider: CommitDetailsProvider,
    ) { }

    /**
     * Show detailed information about a commit
     * Displays commit details in sidebar and opens diff for the current file
     */
    async showCommitDetails(commit: CommitInfo & { path?: string }, filePath: string, line?: number): Promise<void> {
        try {
            let actualFilePath = filePath;

            // Handle URI strings (file:, git:, or gitmaster-diff: schemes)
            if (filePath.startsWith('file:') || filePath.startsWith('git:') || filePath.startsWith('gitmaster-diff:')) {
                try {
                    const uri = vscode.Uri.parse(filePath);
                    if (uri.scheme === 'git' && uri.query) {
                        // Parse git URI to get real file path
                        const query = JSON.parse(uri.query);
                        actualFilePath = query.path;
                    } else if (uri.scheme === 'gitmaster-diff') {
                        // gitmaster-diff scheme uses absolute path in path component
                        actualFilePath = uri.fsPath;
                    } else {
                        actualFilePath = uri.fsPath;
                    }
                } catch (e) {
                    // Fallback to original path if parsing fails
                    console.error('Error parsing URI in showCommitDetails:', e);
                }
            }

            const repoRoot = await this.gitService.getRepoRoot(actualFilePath);
            if (!repoRoot) {
                vscode.window.showErrorMessage('Not a git repository');
                return;
            }

            // Check if this is uncommitted changes (git blame returns hash of all zeros)
            const isUncommitted = /^0+$/.test(commit.hash);

            if (isUncommitted) {
                // For uncommitted changes, show the working directory diff using VS Code's built-in diff
                await this.showUncommittedChanges(actualFilePath, line);
                return;
            }

            // Update the commit details view in sidebar
            await this.commitDetailsProvider.setCommit(commit, repoRoot);

            // Show the commit details view
            vscode.commands.executeCommand('setContext', 'gitmaster.commitSelected', true);

            // Determine the path to use for diff
            // If the commit object has a path property (from blame info), use that as it represents the historic path
            let relativePath: string;
            if (commit.path) {
                // commit.path is likely relative to repo root (from git blame --porcelain)
                relativePath = commit.path;
            } else {
                // Otherwise use the current file path
                relativePath = path.relative(repoRoot, actualFilePath);
            }

            const changedFiles = await this.gitService.getChangedFilesInCommit(commit.hash, repoRoot);
            const currentFile = this.findFileInCommit(changedFiles, relativePath);

            await this.diffService.showFileDiff(
                currentFile?.path || relativePath,
                commit,
                repoRoot,
                currentFile?.oldPath,
                currentFile?.status,
                line,
            );
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to show commit details: ${error}`);
            console.error('Error showing commit details:', error);
        }
    }

    /**
     * Show uncommitted changes for a file using VS Code's built-in diff
     */
    private async showUncommittedChanges(filePath: string, line?: number): Promise<void> {
        try {
            const fileUri = vscode.Uri.file(filePath);
            const repoRoot = await this.gitService.getRepoRoot(filePath);

            if (!repoRoot) {
                vscode.window.showErrorMessage('Not a git repository');
                return;
            }

            // Create git URI for HEAD version of the file
            const headUri = vscode.Uri.parse(`git:${filePath}?${JSON.stringify({ path: filePath, ref: 'HEAD' })}`);

            const title = `${path.basename(filePath)} (Working Directory Changes)`;

            const options: vscode.TextDocumentShowOptions = {};
            if (typeof line === 'number') {
                options.selection = new vscode.Range(line, 0, line, 0);
            }

            // Use VS Code's built-in diff view to compare HEAD vs working directory
            await vscode.commands.executeCommand('vscode.diff', headUri, fileUri, title, options);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to show uncommitted changes: ${error}`);
            console.error('Error showing uncommitted changes:', error);
        }
    }

    /**
     * Show diff for a specific file in a commit
     */
    async showFileDiff(file: ChangedFile, commit: CommitInfo, repoRoot: string): Promise<void> {
        await this.diffService.showFileDiff(file.path, commit, repoRoot, file.oldPath, file.status);
    }

    /**
     * Open a commit in GitHub
     */
    async openCommitInGitHub(githubUrl: string, commitHash: string): Promise<void> {
        const url = `${githubUrl}/commit/${commitHash}`;
        vscode.env.openExternal(vscode.Uri.parse(url));
    }

    /**
     * Show detailed information about a commit from repository log
     * Displays commit details in sidebar without opening a specific file diff
     */
    async showRepositoryCommitDetails(commitOrTreeItem: RepositoryCommit | any, repoRoot: string): Promise<void> {
        try {
            // Extract commit from tree item if needed
            const repoCommit = commitOrTreeItem.commit || commitOrTreeItem;
            const actualRepoRoot = commitOrTreeItem.repoRoot || repoRoot;

            if (!actualRepoRoot) {
                vscode.window.showErrorMessage('No repository found');
                return;
            }

            // Convert RepositoryCommit to CommitInfo
            const commitInfo: CommitInfo = {
                hash: repoCommit.hash,
                shortHash: repoCommit.shortHash,
                message: repoCommit.message,
                author: repoCommit.author,
                date: repoCommit.date,
                relativeDate: repoCommit.date, // Use date as relative date for now
            };

            // Update the commit details view in sidebar
            await this.commitDetailsProvider.setCommit(commitInfo, actualRepoRoot);

            // Show the commit details view
            vscode.commands.executeCommand('setContext', 'gitmaster.commitSelected', true);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to show commit details: ${error}`);
            console.error('Error showing commit details:', error);
        }
    }

    /**
     * Copy commit hash to clipboard
     * @param commitOrTreeItem Either a CommitInfo or a TreeItem with commit property
     */
    async copyCommitId(commitOrTreeItem: any): Promise<void> {
        try {
            // Handle both CommitInfo and CommitTreeItem
            let commit = commitOrTreeItem?.commit || commitOrTreeItem;

            // Fallback to current commit in provider if no argument provided (e.g. from view title)
            if (!commit && this.commitDetailsProvider.currentCommitInfo) {
                commit = this.commitDetailsProvider.currentCommitInfo;
            }

            if (!commit?.hash) {
                vscode.window.showErrorMessage('No commit information available');
                return;
            }

            await vscode.env.clipboard.writeText(commit.hash);
            vscode.window.showInformationMessage(`Copied commit ${commit.shortHash} to clipboard`);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to copy commit ID: ${error}`);
        }
    }

    /**
     * Copy file relative path to clipboard
     * @param treeItem CommitFileTreeItem
     */
    async copyCommitFileRelativePath(treeItem: any): Promise<void> {
        try {
            const file = treeItem.file;
            if (!file) {
                vscode.window.showErrorMessage('No file information available');
                return;
            }
            await vscode.env.clipboard.writeText(file.path);
            vscode.window.showInformationMessage(`Copied "${file.path}" to clipboard`);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to copy file path: ${error}`);
        }
    }

    /**
     * Find a file in the list of changed files
     * Handles both current path and old path (for renamed files)
     */
    private findFileInCommit(changedFiles: ChangedFile[], relativePath: string): ChangedFile | undefined {
        return changedFiles.find(f =>
            f.path === relativePath ||
            f.oldPath === relativePath,
        );
    }
}
