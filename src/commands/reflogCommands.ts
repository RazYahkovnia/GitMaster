import * as vscode from 'vscode';
import { GitService } from '../services/gitService';
import { ReflogProvider } from '../providers/reflogProvider';
import { ReflogEntry } from '../types/git';

/**
 * Command handlers for reflog (git operations) operations
 */
export class ReflogCommands {
    constructor(
        private gitService: GitService,
        private reflogProvider: ReflogProvider
    ) { }

    /**
     * Checkout to a commit from reflog
     */
    async checkoutFromReflog(entry: ReflogEntry, repoRoot: string): Promise<void> {
        try {
            // Check if there are uncommitted changes
            const hasChanges = await this.gitService.hasChangesToStash(repoRoot);

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
            await this.gitService.checkoutCommit(entry.hash, repoRoot);

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
}

