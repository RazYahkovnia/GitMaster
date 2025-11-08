import * as vscode from 'vscode';
import * as path from 'path';
import { GitService } from '../services/gitService';
import { DiffService } from '../services/diffService';
import { CommitDetailsProvider } from '../providers/commitDetailsProvider';
import { CommitInfo, ChangedFile } from '../types/git';

/**
 * Command handlers for commit-related operations
 */
export class CommitCommands {
    constructor(
        private gitService: GitService,
        private diffService: DiffService,
        private commitDetailsProvider: CommitDetailsProvider
    ) { }

    /**
     * Show detailed information about a commit
     * Displays commit details in sidebar and opens diff for the current file
     */
    async showCommitDetails(commit: CommitInfo, filePath: string): Promise<void> {
        try {
            const repoRoot = await this.gitService.getRepoRoot(filePath);
            if (!repoRoot) {
                vscode.window.showErrorMessage('Not a git repository');
                return;
            }

            // Update the commit details view in sidebar
            await this.commitDetailsProvider.setCommit(commit, repoRoot);

            // Show the commit details view
            vscode.commands.executeCommand('setContext', 'gitmaster.commitSelected', true);

            // Open diff for the current file
            const relativePath = path.relative(repoRoot, filePath);
            const changedFiles = await this.gitService.getChangedFilesInCommit(commit.hash, repoRoot);
            const currentFile = this.findFileInCommit(changedFiles, relativePath);

            await this.diffService.showFileDiff(
                currentFile?.path || relativePath,
                commit,
                repoRoot,
                currentFile?.oldPath,
                currentFile?.status
            );
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to show commit details: ${error}`);
            console.error('Error showing commit details:', error);
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
     * Copy commit hash to clipboard
     * @param commitOrTreeItem Either a CommitInfo or a TreeItem with commit property
     */
    async copyCommitId(commitOrTreeItem: any): Promise<void> {
        try {
            // Handle both CommitInfo and CommitTreeItem
            const commit = commitOrTreeItem.commit || commitOrTreeItem;
            await vscode.env.clipboard.writeText(commit.hash);
            vscode.window.showInformationMessage(`Copied commit ${commit.shortHash} to clipboard`);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to copy commit ID: ${error}`);
        }
    }

    /**
     * Find a file in the list of changed files
     * Handles both current path and old path (for renamed files)
     */
    private findFileInCommit(changedFiles: ChangedFile[], relativePath: string): ChangedFile | undefined {
        return changedFiles.find(f =>
            f.path === relativePath ||
            f.oldPath === relativePath
        );
    }
}

