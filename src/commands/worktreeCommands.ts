import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { GitService } from '../services/gitService';
import { WorktreesProvider, WorktreeTreeItem } from '../providers/worktreesProvider';
import { GitWorktree } from '../types/git';

/**
 * Commands for worktree operations
 */
export class WorktreeCommands {
    constructor(
        private gitService: GitService,
        private worktreesProvider: WorktreesProvider,
    ) { }

    /**
     * Open a worktree in a new VS Code window
     */
    async openWorktree(item: WorktreeTreeItem | GitWorktree): Promise<void> {
        const worktreePath = item instanceof WorktreeTreeItem ? item.worktree.path : item.path;

        // check if path exists
        if (!fs.existsSync(worktreePath)) {
            const action = await vscode.window.showErrorMessage(
                `Worktree path does not exist: ${worktreePath}. Do you want to prune worktrees?`,
                'Prune Worktrees',
                'Cancel',
            );

            if (action === 'Prune Worktrees') {
                await this.pruneWorktrees();
            }
            return;
        }

        const uri = vscode.Uri.file(worktreePath);
        await vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: true });
    }

    /**
     * Add a new worktree
     */
    async addWorktree(): Promise<void> {
        const repoRoot = this.worktreesProvider['currentRepoRoot'];

        if (!repoRoot) {
            vscode.window.showErrorMessage('No active repository to create worktree from');
            return;
        }

        const parentDir = path.dirname(repoRoot);

        // 1. Enter folder name
        const folderName = await vscode.window.showInputBox({
            prompt: 'Enter folder name for the new worktree',
            placeHolder: 'my-feature-worktree',
            validateInput: (value) => {
                if (!value || value.trim().length === 0) {
                    return 'Folder name cannot be empty';
                }
                if (fs.existsSync(path.join(parentDir, value))) {
                    return 'Directory already exists';
                }
                return null;
            },
        });

        if (!folderName) {
            return;
        }

        const worktreePath = path.join(parentDir, folderName);

        // 2. Enter new branch name
        const branchName = await vscode.window.showInputBox({
            prompt: 'Enter new branch name for the worktree',
            placeHolder: 'feature/new-branch',
            validateInput: (value) => {
                if (!value || value.trim().length === 0) {
                    return 'Branch name cannot be empty';
                }
                // Basic branch name validation
                if (!/^[a-zA-Z0-9/_-]+$/.test(value)) {
                    return 'Branch name contains invalid characters';
                }
                return null;
            },
        });

        if (!branchName) {
            return;
        }

        // 3. (Optional) Select source branch
        // For simplicity, we can just branch from HEAD for now, or fetch branches to pick from.
        // Let's rely on default behavior (HEAD) or ask user if they want to base it on a specific branch?
        // Let's list branches to select base from.

        // Get branches to pick origin
        const branches = await this.gitService.getBranches(repoRoot);
        const branchItems = branches.map(b => ({
            label: b.name,
            description: b.isCurrent ? '(current)' : '',
            detail: b.lastCommitMessage,
        }));

        const selectedOrigin = await vscode.window.showQuickPick(branchItems, {
            placeHolder: 'Select base branch (optional, defaults to HEAD)',
            canPickMany: false,
        });

        const originBranch = selectedOrigin ? selectedOrigin.label : undefined;

        try {
            await this.gitService.addWorktree(repoRoot, worktreePath, branchName, originBranch);
            vscode.window.showInformationMessage(`Worktree created at ${worktreePath}`);

            // Ask to open
            const openAction = await vscode.window.showInformationMessage(
                'Worktree created. Open it now?',
                'Open in New Window',
                'Not Now',
            );

            if (openAction === 'Open in New Window') {
                const uri = vscode.Uri.file(worktreePath);
                await vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: true });
            }

            this.worktreesProvider.refresh();
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to create worktree: ${error}`);
        }
    }

    /**
     * Remove a worktree
     */
    async removeWorktree(item: WorktreeTreeItem): Promise<void> {
        if (item.worktree.isMain) {
            vscode.window.showErrorMessage('Cannot remove the main worktree');
            return;
        }

        if (item.worktree.isCurrent) {
            vscode.window.showErrorMessage('Cannot remove the currently open worktree. Please close it first.');
            return;
        }

        const confirm = await vscode.window.showWarningMessage(
            `Are you sure you want to remove worktree at "${item.worktree.path}"? This will delete the directory.`,
            { modal: true },
            'Delete Worktree',
        );

        if (confirm !== 'Delete Worktree') {
            return;
        }

        try {
            await this.gitService.removeWorktree(item.repoRoot, item.worktree.path);
            vscode.window.showInformationMessage('Worktree removed');
            this.worktreesProvider.refresh();
        } catch (error) {
            // Check if force is needed
            const forceConfirm = await vscode.window.showErrorMessage(
                `Failed to remove worktree: ${error}. Force removal?`,
                'Force Remove',
                'Cancel',
            );

            if (forceConfirm === 'Force Remove') {
                try {
                    await this.gitService.removeWorktree(item.repoRoot, item.worktree.path, true);
                    vscode.window.showInformationMessage('Worktree force removed');
                    this.worktreesProvider.refresh();
                } catch (forceError) {
                    vscode.window.showErrorMessage(`Failed to force remove worktree: ${forceError}`);
                }
            }
        }
    }

    /**
     * Prune worktrees
     */
    async pruneWorktrees(): Promise<void> {
        const repoRoot = this.worktreesProvider['currentRepoRoot'];
        if (!repoRoot) {
            return;
        }

        try {
            await this.gitService.pruneWorktrees(repoRoot);
            vscode.window.showInformationMessage('Pruned stale worktrees');
            this.worktreesProvider.refresh();
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to prune worktrees: ${error}`);
        }
    }

    /**
     * Refresh worktrees
     */
    refresh(): void {
        this.worktreesProvider.refresh();
    }
}
