import * as vscode from 'vscode';
import { GitService } from '../services/gitService';
import { RepositoryLogProvider, RepositoryCommitTreeItem } from '../providers/repositoryLogProvider';
import { RepositoryCommit } from '../types/git';

/**
 * Commands for repository log operations
 */
export class RepositoryLogCommands {
    constructor(
        private gitService: GitService,
        private repositoryLogProvider: RepositoryLogProvider
    ) {}

    /**
     * Revert a commit in a new branch
     */
    async revertCommitInNewBranch(commitOrTreeItem: RepositoryCommit | RepositoryCommitTreeItem, repoRoot?: string): Promise<void> {
        try {
            const commit = (commitOrTreeItem as RepositoryCommitTreeItem).commit || (commitOrTreeItem as RepositoryCommit);
            const actualRepoRoot = repoRoot || (commitOrTreeItem as RepositoryCommitTreeItem).repoRoot;

            if (!actualRepoRoot) {
                vscode.window.showErrorMessage('No repository found');
                return;
            }

            // Check for uncommitted changes
            const hasChanges = await this.gitService.hasChangesToStash(actualRepoRoot);
            if (hasChanges) {
                const action = await vscode.window.showWarningMessage(
                    'You have uncommitted changes. Creating a new branch will keep these changes. Do you want to proceed?',
                    { modal: true },
                    'Continue'
                );
                if (action !== 'Continue') {
                    return;
                }
            }

            // Prompt for branch name
            const defaultBranchName = `revert-${commit.shortHash}`;
            const branchName = await vscode.window.showInputBox({
                prompt: 'Enter branch name for the revert',
                value: defaultBranchName,
                validateInput: (value) => {
                    if (!value || value.trim().length === 0) {
                        return 'Branch name cannot be empty';
                    }
                    // Basic branch name validation
                    if (!/^[a-zA-Z0-9/_-]+$/.test(value)) {
                        return 'Branch name contains invalid characters';
                    }
                    return null;
                }
            });

            if (!branchName) {
                return;
            }

            // Perform the revert in new branch
            await this.gitService.revertCommitInNewBranch(commit.hash, branchName, actualRepoRoot);
            
            vscode.window.showInformationMessage(
                `Successfully reverted commit ${commit.shortHash} in branch "${branchName}"`
            );
            
            // Refresh the repository log
            this.repositoryLogProvider.refresh();
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to revert commit: ${error}`);
            console.error('Error reverting commit:', error);
        }
    }

    /**
     * Checkout to a commit from repository log
     */
    async checkoutCommit(commitOrTreeItem: RepositoryCommit | RepositoryCommitTreeItem, repoRoot?: string): Promise<void> {
        try {
            const commit = (commitOrTreeItem as RepositoryCommitTreeItem).commit || (commitOrTreeItem as RepositoryCommit);
            const actualRepoRoot = repoRoot || (commitOrTreeItem as RepositoryCommitTreeItem).repoRoot;

            if (!actualRepoRoot) {
                vscode.window.showErrorMessage('No repository found');
                return;
            }

            // Check for uncommitted changes
            const hasChanges = await this.gitService.hasChangesToStash(actualRepoRoot);
            if (hasChanges) {
                const action = await vscode.window.showWarningMessage(
                    'You have uncommitted changes. Checking out to a different commit will discard them. Do you want to proceed?',
                    { modal: true },
                    'Checkout Anyway'
                );
                if (action !== 'Checkout Anyway') {
                    return;
                }
            }

            await this.gitService.checkoutCommit(commit.hash, actualRepoRoot);
            vscode.window.showInformationMessage(`Checked out to commit ${commit.shortHash}`);
            
            // Refresh the repository log
            this.repositoryLogProvider.refresh();
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to checkout commit: ${error}`);
            console.error('Error checking out commit:', error);
        }
    }

    /**
     * Cherry-pick a commit
     */
    async cherryPickCommit(commitOrTreeItem: RepositoryCommit | RepositoryCommitTreeItem, repoRoot?: string): Promise<void> {
        try {
            const commit = (commitOrTreeItem as RepositoryCommitTreeItem).commit || (commitOrTreeItem as RepositoryCommit);
            const actualRepoRoot = repoRoot || (commitOrTreeItem as RepositoryCommitTreeItem).repoRoot;

            if (!actualRepoRoot) {
                vscode.window.showErrorMessage('No repository found');
                return;
            }

            // Check for uncommitted changes
            const hasChanges = await this.gitService.hasChangesToStash(actualRepoRoot);
            if (hasChanges) {
                const action = await vscode.window.showWarningMessage(
                    'You have uncommitted changes. Cherry-picking may cause conflicts. Do you want to proceed?',
                    { modal: true },
                    'Continue'
                );
                if (action !== 'Continue') {
                    return;
                }
            }

            await this.gitService.cherryPickCommit(commit.hash, actualRepoRoot);
            vscode.window.showInformationMessage(
                `Successfully cherry-picked commit ${commit.shortHash}`
            );
            
            // Refresh the repository log
            this.repositoryLogProvider.refresh();
        } catch (error) {
            // Check if it's a conflict error
            const errorMsg = String(error);
            if (errorMsg.includes('conflict') || errorMsg.includes('CONFLICT')) {
                vscode.window.showWarningMessage(
                    `Cherry-pick resulted in conflicts. Please resolve conflicts and complete the cherry-pick manually.`
                );
            } else {
                vscode.window.showErrorMessage(`Failed to cherry-pick commit: ${error}`);
            }
            console.error('Error cherry-picking commit:', error);
        }
    }

    /**
     * Create a branch from a commit
     */
    async createBranchFromCommit(commitOrTreeItem: RepositoryCommit | RepositoryCommitTreeItem, repoRoot?: string): Promise<void> {
        try {
            const commit = (commitOrTreeItem as RepositoryCommitTreeItem).commit || (commitOrTreeItem as RepositoryCommit);
            const actualRepoRoot = repoRoot || (commitOrTreeItem as RepositoryCommitTreeItem).repoRoot;

            if (!actualRepoRoot) {
                vscode.window.showErrorMessage('No repository found');
                return;
            }

            // Prompt for branch name
            const branchName = await vscode.window.showInputBox({
                prompt: 'Enter branch name',
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
                }
            });

            if (!branchName) {
                return;
            }

            // Create the branch
            await this.gitService.createBranchFromCommit(branchName, commit.hash, actualRepoRoot);
            
            // Ask if user wants to checkout to the new branch
            const checkoutAction = await vscode.window.showInformationMessage(
                `Branch "${branchName}" created from commit ${commit.shortHash}. Do you want to switch to it?`,
                'Switch to Branch',
                'Stay Here'
            );

            if (checkoutAction === 'Switch to Branch') {
                // Check for uncommitted changes before checkout
                const hasChanges = await this.gitService.hasChangesToStash(actualRepoRoot);
                if (hasChanges) {
                    const action = await vscode.window.showWarningMessage(
                        'You have uncommitted changes. Switching branches will discard them. Do you want to proceed?',
                        { modal: true },
                        'Switch Anyway'
                    );
                    if (action !== 'Switch Anyway') {
                        return;
                    }
                }

                await this.gitService.checkoutBranch(branchName, actualRepoRoot);
                vscode.window.showInformationMessage(`Switched to branch "${branchName}"`);
            }
            
            // Refresh the repository log
            this.repositoryLogProvider.refresh();
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to create branch: ${error}`);
            console.error('Error creating branch:', error);
        }
    }

    /**
     * Refresh the repository log
     */
    refreshRepositoryLog(): void {
        this.repositoryLogProvider.refresh();
    }
}

