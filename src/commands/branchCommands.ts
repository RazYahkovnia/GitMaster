import * as vscode from 'vscode';
import { GitService } from '../services/gitService';
import { BranchesProvider, BranchTreeItem } from '../providers/branchesProvider';
import { BranchInfo } from '../types/git';

/**
 * Commands for branch operations
 */
export class BranchCommands {
    constructor(
        private gitService: GitService,
        private branchesProvider: BranchesProvider,
    ) { }

    /**
     * Checkout to a branch
     */
    async checkoutBranch(branchOrTreeItem: BranchInfo | BranchTreeItem, repoRoot?: string): Promise<void> {
        try {
            const branch = (branchOrTreeItem as BranchTreeItem).branch || (branchOrTreeItem as BranchInfo);
            const actualRepoRoot = repoRoot || (branchOrTreeItem as BranchTreeItem).repoRoot;

            if (!actualRepoRoot) {
                vscode.window.showErrorMessage('No repository found');
                return;
            }

            // Don't checkout if already on this branch
            if (branch.isCurrent) {
                vscode.window.showInformationMessage(`Already on branch "${branch.name}"`);
                return;
            }

            // Check for uncommitted changes
            const hasChanges = await this.gitService.hasChangesToStash(actualRepoRoot);
            if (hasChanges) {
                const action = await vscode.window.showWarningMessage(
                    'You have uncommitted changes. Checking out to a different branch will discard them. Do you want to proceed?',
                    { modal: true },
                    'Checkout Anyway',
                );
                if (action !== 'Checkout Anyway') {
                    return;
                }
            }

            // Handle remote branches
            let branchName = branch.name;
            if (branch.isRemote) {
                // For remote branches, create a local tracking branch
                const localName = branch.name.replace(/^[^/]+\//, '');
                branchName = localName;
            }

            await this.gitService.checkoutBranch(branchName, actualRepoRoot);
            vscode.window.showInformationMessage(`Checked out to branch "${branchName}"`);

            // Refresh the branches view
            this.branchesProvider.refresh();
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to checkout branch: ${error}`);
            console.error('Error checking out branch:', error);
        }
    }

    /**
     * Delete a branch
     */
    async deleteBranch(branchOrTreeItem: BranchInfo | BranchTreeItem, repoRoot?: string): Promise<void> {
        try {
            const branch = (branchOrTreeItem as BranchTreeItem).branch || (branchOrTreeItem as BranchInfo);
            const actualRepoRoot = repoRoot || (branchOrTreeItem as BranchTreeItem).repoRoot;

            if (!actualRepoRoot) {
                vscode.window.showErrorMessage('No repository found');
                return;
            }

            // Can't delete current branch
            if (branch.isCurrent) {
                vscode.window.showErrorMessage('Cannot delete the current branch. Switch to another branch first.');
                return;
            }

            // Can't delete remote branches directly
            if (branch.isRemote) {
                vscode.window.showErrorMessage('Cannot delete remote branches from this view. Use Git commands directly.');
                return;
            }

            // Confirm deletion
            const action = await vscode.window.showWarningMessage(
                `Are you sure you want to delete branch "${branch.name}"?`,
                { modal: true },
                'Delete',
                'Force Delete',
            );

            if (!action) {
                return;
            }

            const force = action === 'Force Delete';
            await this.gitService.deleteBranch(branch.name, actualRepoRoot, force);
            vscode.window.showInformationMessage(`Deleted branch "${branch.name}"`);

            // Refresh the branches view
            this.branchesProvider.refresh();
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to delete branch: ${error}`);
            console.error('Error deleting branch:', error);
        }
    }

    /**
     * Create a new branch
     */
    async createNewBranch(): Promise<void> {
        try {
            if (!this.branchesProvider['currentRepoRoot']) {
                vscode.window.showErrorMessage('No repository opened');
                return;
            }

            const repoRoot = this.branchesProvider['currentRepoRoot'];

            // Prompt for branch name
            const branchName = await vscode.window.showInputBox({
                prompt: 'Enter new branch name',
                placeHolder: 'feature/my-branch',
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

            // Get current commit
            const currentBranch = await this.gitService.getCurrentBranch(repoRoot);
            if (!currentBranch) {
                vscode.window.showErrorMessage('Could not determine current branch');
                return;
            }

            // Create branch from current HEAD
            await this.gitService.createBranchFromCommit(branchName, 'HEAD', repoRoot);

            // Ask if user wants to checkout to the new branch
            const checkoutAction = await vscode.window.showInformationMessage(
                `Branch "${branchName}" created. Do you want to switch to it?`,
                'Switch to Branch',
                'Stay Here',
            );

            if (checkoutAction === 'Switch to Branch') {
                await this.gitService.checkoutBranch(branchName, repoRoot);
                vscode.window.showInformationMessage(`Switched to branch "${branchName}"`);
            }

            // Refresh the branches view
            this.branchesProvider.refresh();
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to create branch: ${error}`);
            console.error('Error creating branch:', error);
        }
    }

    /**
     * Refresh the branches view
     */
    refreshBranches(): void {
        this.branchesProvider.refresh();
    }

    /**
     * Filter branches by current user
     */
    async filterByMyBranches(): Promise<void> {
        try {
            const repoRoot = this.branchesProvider['currentRepoRoot'];
            if (!repoRoot) {
                vscode.window.showErrorMessage('No repository opened');
                return;
            }

            const currentUser = await this.gitService.getCurrentUserName(repoRoot);
            if (!currentUser) {
                vscode.window.showErrorMessage('Could not determine current Git user name');
                return;
            }

            this.branchesProvider.setAuthorFilter(currentUser);
            vscode.window.showInformationMessage(`Showing branches by ${currentUser}`);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to filter branches: ${error}`);
            console.error('Error filtering branches:', error);
        }
    }

    /**
     * Filter branches by specific author
     */
    async filterByAuthor(): Promise<void> {
        try {
            const repoRoot = this.branchesProvider['currentRepoRoot'];
            if (!repoRoot) {
                vscode.window.showErrorMessage('No repository opened');
                return;
            }

            // Get list of authors
            const authors = await this.gitService.getBranchAuthors(repoRoot);
            if (authors.length === 0) {
                vscode.window.showErrorMessage('No authors found in branches');
                return;
            }

            // Show quick pick to select author
            const selectedAuthor = await vscode.window.showQuickPick(authors, {
                placeHolder: 'Select an author to filter branches',
                matchOnDescription: true,
            });

            if (!selectedAuthor) {
                return;
            }

            this.branchesProvider.setAuthorFilter(selectedAuthor);
            vscode.window.showInformationMessage(`Showing branches by ${selectedAuthor}`);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to filter branches: ${error}`);
            console.error('Error filtering branches:', error);
        }
    }

    /**
     * Clear branch filter
     */
    clearBranchFilter(): void {
        this.branchesProvider.setAuthorFilter(null);
        vscode.window.showInformationMessage('Showing all branches');
    }

    /**
     * Pin a branch
     */
    async pinBranch(branchOrTreeItem: BranchInfo | BranchTreeItem): Promise<void> {
        try {
            const branch = (branchOrTreeItem as BranchTreeItem).branch || (branchOrTreeItem as BranchInfo);
            await this.branchesProvider.pinBranch(branch.name);
            vscode.window.showInformationMessage(`Pinned branch "${branch.name}"`);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to pin branch: ${error}`);
            console.error('Error pinning branch:', error);
        }
    }

    /**
     * Unpin a branch
     */
    async unpinBranch(branchOrTreeItem: BranchInfo | BranchTreeItem): Promise<void> {
        try {
            const branch = (branchOrTreeItem as BranchTreeItem).branch || (branchOrTreeItem as BranchInfo);
            await this.branchesProvider.unpinBranch(branch.name);
            vscode.window.showInformationMessage(`Unpinned branch "${branch.name}"`);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to unpin branch: ${error}`);
            console.error('Error unpinning branch:', error);
        }
    }
}
