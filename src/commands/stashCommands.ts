import * as vscode from 'vscode';
import * as path from 'path';
import { GitService } from '../services/gitService';
import { DiffService } from '../services/diffService';
import { DiffContentProvider } from '../services/diffService';
import { ShelvesProvider, StashTreeItem } from '../providers/shelvesProvider';
import { ChangedFile } from '../types/git';

/**
 * Command handlers for stash (shelf) operations
 */
export class StashCommands {
    constructor(
        private gitService: GitService,
        private diffService: DiffService,
        private shelvesProvider: ShelvesProvider
    ) { }

    /**
     * Create a new stash with a custom message
     */
    async createShelf(): Promise<void> {
        try {
            const repoRoot = this.shelvesProvider.getRepoRoot();
            if (!repoRoot) {
                vscode.window.showErrorMessage('Not in a git repository');
                return;
            }

            // Check if there are changes to stash
            const hasChanges = await this.gitService.hasChangesToStash(repoRoot);
            if (!hasChanges) {
                vscode.window.showErrorMessage('No changes to shelve');
                return;
            }

            // Ask for shelf name/message
            const message = await vscode.window.showInputBox({
                prompt: 'Enter shelf name',
                placeHolder: 'e.g., Work in progress on feature X',
                validateInput: (value) => {
                    if (!value || value.trim().length === 0) {
                        return 'Shelf name cannot be empty';
                    }
                    return null;
                }
            });

            if (!message) {
                return; // User cancelled
            }

            // Check if there are untracked files
            const hasUntracked = await this.gitService.hasUntrackedFiles(repoRoot);
            let includeUntracked = false;

            // Only ask about untracked files if they exist
            if (hasUntracked) {
                const includeUntrackedChoice = await vscode.window.showQuickPick(
                    ['No', 'Yes'],
                    {
                        placeHolder: 'Include untracked files?',
                        canPickMany: false
                    }
                );

                if (includeUntrackedChoice === undefined) {
                    return; // User cancelled
                }

                includeUntracked = includeUntrackedChoice === 'Yes';
            }

            await this.gitService.createStash(repoRoot, message, includeUntracked);
            this.shelvesProvider.refresh();
            vscode.window.showInformationMessage(`Shelf "${message}" created`);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to create shelf: ${error}`);
            console.error('Error creating shelf:', error);
        }
    }

    /**
     * Apply a stash (keeps it in the list)
     */
    async applyShelf(stashItem: StashTreeItem): Promise<void> {
        try {
            // Check if there are uncommitted changes
            const hasChanges = await this.gitService.hasChangesToStash(stashItem.repoRoot);
            if (hasChanges) {
                const action = await vscode.window.showWarningMessage(
                    'You have uncommitted changes. Applying this shelf may cause conflicts.',
                    { modal: true },
                    'Apply Anyway'
                );

                if (action !== 'Apply Anyway') {
                    return;
                }
            }

            await this.gitService.applyStash(stashItem.stash.index, stashItem.repoRoot);
            vscode.window.showInformationMessage(`Applied shelf "${stashItem.stash.message}"`);
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            if (errorMsg.includes('would be overwritten')) {
                vscode.window.showErrorMessage(
                    'Cannot apply shelf: Your local changes would be overwritten. Please commit or stash your current changes first.'
                );
            } else {
                vscode.window.showErrorMessage(`Failed to apply shelf: ${error}`);
            }
            console.error('Error applying shelf:', error);
        }
    }

    /**
     * Pop a stash (applies and removes from list)
     */
    async popShelf(stashItem: StashTreeItem): Promise<void> {
        try {
            // Check if there are uncommitted changes
            const hasChanges = await this.gitService.hasChangesToStash(stashItem.repoRoot);
            if (hasChanges) {
                const action = await vscode.window.showWarningMessage(
                    'You have uncommitted changes. Popping this shelf may cause conflicts.',
                    { modal: true },
                    'Pop Anyway'
                );

                if (action !== 'Pop Anyway') {
                    return;
                }
            }

            await this.gitService.popStash(stashItem.stash.index, stashItem.repoRoot);
            this.shelvesProvider.refresh();
            vscode.window.showInformationMessage(`Popped shelf "${stashItem.stash.message}"`);
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            if (errorMsg.includes('would be overwritten')) {
                vscode.window.showErrorMessage(
                    'Cannot pop shelf: Your local changes would be overwritten. Please commit or stash your current changes first.'
                );
            } else {
                vscode.window.showErrorMessage(`Failed to pop shelf: ${error}`);
            }
            console.error('Error popping shelf:', error);
        }
    }

    /**
     * Delete a stash without applying
     */
    async deleteShelf(stashItem: StashTreeItem): Promise<void> {
        try {
            const confirm = await vscode.window.showWarningMessage(
                `Delete shelf "${stashItem.stash.message}"?`,
                { modal: true },
                'Delete'
            );

            if (confirm !== 'Delete') {
                return;
            }

            await this.gitService.deleteStash(stashItem.stash.index, stashItem.repoRoot);
            this.shelvesProvider.refresh();
            vscode.window.showInformationMessage(`Deleted shelf "${stashItem.stash.message}"`);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to delete shelf: ${error}`);
            console.error('Error deleting shelf:', error);
        }
    }

    /**
     * Merge current changes into an existing shelf
     */
    async mergeIntoShelf(stashItem: StashTreeItem): Promise<void> {
        try {
            const repoRoot = stashItem.repoRoot;

            // Check if there are uncommitted changes
            const hasChanges = await this.gitService.hasChangesToStash(repoRoot);
            if (!hasChanges) {
                vscode.window.showWarningMessage('No changes to add to the shelf');
                return;
            }

            // Check if the original stash has untracked files
            const stashHasUntracked = await this.gitService.stashHasUntrackedFiles(stashItem.stash.index, repoRoot);

            // Confirm the action
            const confirm = await vscode.window.showWarningMessage(
                `Add your current changes to "${stashItem.stash.message}"?\n\nThis will:\n1. Pop the existing shelf\n2. Combine with your current changes\n3. Create a new shelf with the combined changes`,
                { modal: true },
                'Add Changes'
            );

            if (confirm !== 'Add Changes') {
                return;
            }

            const originalMessage = stashItem.stash.message;
            const stashIndex = stashItem.stash.index;

            // Pop the existing stash to combine with current changes
            await this.gitService.popStash(stashIndex, repoRoot);

            // Determine if we should include untracked files
            // If the original stash had untracked files, always include them
            // Otherwise, ask the user if there are new untracked files
            let includeUntracked = stashHasUntracked;

            if (!includeUntracked) {
                const hasUntracked = await this.gitService.hasUntrackedFiles(repoRoot);
                if (hasUntracked) {
                    const untrackedChoice = await vscode.window.showQuickPick(
                        ['No', 'Yes'],
                        {
                            placeHolder: 'Include untracked files in the shelf?',
                            title: 'Untracked Files Detected'
                        }
                    );

                    if (!untrackedChoice) {
                        // User cancelled, revert by re-stashing
                        await this.gitService.createStash(repoRoot, originalMessage, stashHasUntracked);
                        this.shelvesProvider.refresh();
                        return;
                    }

                    includeUntracked = untrackedChoice === 'Yes';
                }
            }

            // Now create a new stash with the combined changes
            await this.gitService.createStash(repoRoot, originalMessage, includeUntracked);

            this.shelvesProvider.refresh();
            vscode.window.showInformationMessage(`Added current changes to shelf "${originalMessage}"`);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to merge into shelf: ${error}`);
            console.error('Error merging into shelf:', error);
        }
    }

    /**
     * Refresh the shelves view
     */
    refreshShelves(): void {
        this.shelvesProvider.refresh();
    }

    /**
     * Show diff for a file in a stash
     */
    async showStashFileDiff(file: ChangedFile, stashIndex: string, repoRoot: string): Promise<void> {
        try {
            const fileName = path.basename(file.path);

            // Get file content before and after stash
            let leftContent = '';
            let leftTitle = `${fileName} (before stash)`;

            try {
                leftContent = await this.gitService.getStashFileParentContent(file.path, stashIndex, repoRoot);
            } catch (error) {
                // File might be new
                leftContent = '';
                leftTitle = `${fileName} (new file)`;
            }

            const rightContent = await this.gitService.getStashFileContent(file.path, stashIndex, repoRoot);
            const rightTitle = `${fileName} (in stash)`;

            // Create URIs for diff
            const leftUri = vscode.Uri.parse(`gitmaster-diff:${leftTitle}`).with({
                query: Buffer.from(leftContent).toString('base64')
            });

            const rightUri = vscode.Uri.parse(`gitmaster-diff:${rightTitle}`).with({
                query: Buffer.from(rightContent).toString('base64')
            });

            // Register content provider
            const provider = new DiffContentProvider();
            const providerDisposable = vscode.workspace.registerTextDocumentContentProvider('gitmaster-diff', provider);

            // Show diff
            const title = `${fileName} (stash changes)`;
            await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title);

            // Clean up after a delay
            setTimeout(() => {
                providerDisposable.dispose();
            }, 1000);

        } catch (error) {
            vscode.window.showErrorMessage(`Failed to show stash file diff: ${error}`);
            console.error('Error showing stash file diff:', error);
        }
    }
}

