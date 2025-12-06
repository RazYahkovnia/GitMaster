import * as vscode from 'vscode';
import { GitService } from '../services/gitService';
import { ReflogProvider } from '../providers/reflogProvider';
import { CommitDetailsProvider } from '../providers/commitDetailsProvider';
import { ReflogEntry, CommitInfo } from '../types/git';

/**
 * Command handlers for reflog (git operations) operations
 */
export class ReflogCommands {
    constructor(
        private gitService: GitService,
        private reflogProvider: ReflogProvider,
        private commitDetailsProvider: CommitDetailsProvider
    ) { }

    /**
     * Checkout to a commit from reflog
     */
    async checkoutFromReflog(entryOrTreeItem: any, repoRoot?: string): Promise<void> {
        try {
            // Extract entry and repoRoot from tree item if needed
            const entry: ReflogEntry = entryOrTreeItem.entry || entryOrTreeItem;
            const actualRepoRoot = repoRoot || entryOrTreeItem.repoRoot;

            if (!actualRepoRoot) {
                vscode.window.showErrorMessage('No repository found');
                return;
            }

            // Check if there are uncommitted changes
            const hasChanges = await this.gitService.hasChangesToStash(actualRepoRoot);

            if (hasChanges) {
                vscode.window.showErrorMessage(
                    'Cannot checkout: You have uncommitted changes. Please commit or stash your changes first.'
                );
                return;
            }

            // Show confirmation dialog
            const message = `Checkout to commit ${entry.shortHash}?\n\n${entry.message}\n\nThis will put you in a "detached HEAD" state.`;
            const action = await vscode.window.showWarningMessage(
                message,
                { modal: true },
                'Checkout'
            );

            if (action !== 'Checkout') {
                return;
            }

            // Perform checkout
            await this.gitService.checkoutCommit(entry.hash, actualRepoRoot);

            vscode.window.showInformationMessage(
                `Checked out to ${entry.shortHash}. You are now in detached HEAD state.`
            );

            // Refresh views
            this.reflogProvider.refresh();

        } catch (error) {
            vscode.window.showErrorMessage(`Failed to checkout: ${error}`);
            console.error('Error checking out from reflog:', error);
        }
    }

    /**
     * Refresh the reflog view
     */
    refreshReflog(): void {
        this.reflogProvider.refresh();
    }

    /**
     * Load more reflog entries
     */
    loadMoreReflog(): void {
        this.reflogProvider.loadMore();
    }

    /**
     * Toggle grouping by date
     */
    toggleReflogGroupByDate(): void {
        this.reflogProvider.toggleGroupByDate();
    }

    /**
     * Show commit details from reflog entry
     */
    async showReflogCommitDetails(entryOrTreeItem: any, repoRoot?: string): Promise<void> {
        try {
            // Extract entry and repoRoot from tree item if needed
            const entry: ReflogEntry = entryOrTreeItem.entry || entryOrTreeItem;
            const actualRepoRoot = repoRoot || entryOrTreeItem.repoRoot;

            if (!actualRepoRoot) {
                vscode.window.showErrorMessage('No repository found');
                return;
            }

            // Convert ReflogEntry to CommitInfo
            const commitInfo: CommitInfo = {
                hash: entry.hash,
                shortHash: entry.shortHash,
                message: entry.message,
                author: '', // Will be fetched from git
                date: '',
                relativeDate: ''
            };

            // Get full commit details including author and date
            const fullCommitInfo = await this.gitService.getCommitInfo(entry.hash, actualRepoRoot);
            if (fullCommitInfo) {
                commitInfo.author = fullCommitInfo.author;
                commitInfo.date = fullCommitInfo.date;
                commitInfo.relativeDate = fullCommitInfo.relativeDate;
            }

            // Update the commit details view in sidebar
            await this.commitDetailsProvider.setCommit(commitInfo, actualRepoRoot);

            // Show the commit details view
            vscode.commands.executeCommand('setContext', 'gitmaster.commitSelected', true);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to show commit details: ${error}`);
            console.error('Error showing commit details from reflog:', error);
        }
    }
}

