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
     * Format stash preview for display in dialogs
     */
    private formatStashPreview(preview: {
        staged: Array<{ file: string; additions: number; deletions: number }>;
        unstaged: Array<{ file: string; additions: number; deletions: number }>;
        untracked: string[];
    }, showStaged: boolean = true, showUnstaged: boolean = true, showUntracked: boolean = true): string {
        const lines: string[] = [];
        let totalFiles = 0;
        let totalAdditions = 0;
        let totalDeletions = 0;

        if (showStaged && preview.staged.length > 0) {
            lines.push('📋 Staged:');
            preview.staged.forEach(f => {
                lines.push(`   ✓ ${f.file} (+${f.additions} -${f.deletions})`);
                totalFiles++;
                totalAdditions += f.additions;
                totalDeletions += f.deletions;
            });
            lines.push('');
        }

        if (showUnstaged && preview.unstaged.length > 0) {
            lines.push('📝 Unstaged:');
            preview.unstaged.forEach(f => {
                lines.push(`   • ${f.file} (+${f.additions} -${f.deletions})`);
                totalFiles++;
                totalAdditions += f.additions;
                totalDeletions += f.deletions;
            });
            lines.push('');
        }

        if (showUntracked && preview.untracked.length > 0) {
            lines.push('🆕 Untracked:');
            preview.untracked.forEach(f => {
                lines.push(`   + ${f}`);
                totalFiles++;
            });
            lines.push('');
        }

        // Add summary
        if (totalFiles > 0) {
            lines.push(`Total: ${totalFiles} file(s), +${totalAdditions} -${totalDeletions}`);
        }

        return lines.join('\n');
    }

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

            // Get preview of what will be stashed
            const hasUntracked = await this.gitService.hasUntrackedFiles(repoRoot);
            const preview = await this.gitService.getStashPreview(repoRoot, hasUntracked);
            const previewText = this.formatStashPreview(preview);

            // Show confirmation with preview
            const confirmMessage = 'Create Shelf\n\n' + previewText +
                (hasUntracked ? '\n\nInclude untracked files?' : '');

            let includeUntracked = false;
            if (hasUntracked) {
                const choice = await vscode.window.showInformationMessage(
                    confirmMessage,
                    { modal: true },
                    'Shelve (without untracked)',
                    'Shelve All (with untracked)'
                );

                if (!choice) {
                    return; // User cancelled
                }

                includeUntracked = choice === 'Shelve All (with untracked)';
            } else {
                const proceed = await vscode.window.showInformationMessage(
                    confirmMessage,
                    { modal: true },
                    'Create Shelf'
                );

                if (!proceed) {
                    return; // User cancelled
                }
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

            await this.gitService.createStash(repoRoot, message, includeUntracked);
            this.shelvesProvider.refresh();
            vscode.window.showInformationMessage(`Shelf "${message}" created`);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to create shelf: ${error}`);
            console.error('Error creating shelf:', error);
        }
    }

    /**
     * Create a new stash with --keep-index flag
     * This keeps staged changes in the index while stashing everything
     */
    async createShelfKeepIndex(): Promise<void> {
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

            // Get preview of what will be stashed
            const hasUntracked = await this.gitService.hasUntrackedFiles(repoRoot);
            const preview = await this.gitService.getStashPreview(repoRoot, hasUntracked);
            const previewText = this.formatStashPreview(preview);

            // Show confirmation with preview and explanation
            const confirmMessage = 'Shelf All (Keep Staged)\n\n' +
                'What this does:\n' +
                '• Stash ALL changes as a backup\n' +
                '• Keep staged changes in working directory\n' +
                '• Staged files remain ready to commit\n\n' +
                previewText +
                (hasUntracked ? '\n\nInclude untracked files?' : '');

            let includeUntracked = false;
            if (hasUntracked) {
                const choice = await vscode.window.showInformationMessage(
                    confirmMessage,
                    { modal: true },
                    'Shelve (without untracked)',
                    'Shelve All (with untracked)'
                );

                if (!choice) {
                    return; // User cancelled
                }

                includeUntracked = choice === 'Shelve All (with untracked)';
            } else {
                const proceed = await vscode.window.showInformationMessage(
                    confirmMessage,
                    { modal: true },
                    'Create Shelf'
                );

                if (!proceed) {
                    return; // User cancelled
                }
            }

            // Ask for shelf name/message
            const message = await vscode.window.showInputBox({
                prompt: 'Enter shelf name (all changes will be stashed, but staged ones will remain)',
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

            await this.gitService.createStash(repoRoot, message, includeUntracked, true);
            this.shelvesProvider.refresh();
            vscode.window.showInformationMessage(`Shelf "${message}" created\n\nAll changes backed up in shelf, staged changes remain in working directory`);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to create shelf: ${error}`);
            console.error('Error creating shelf:', error);
        }
    }

    /**
     * Create a new stash with only staged changes
     * This stashes only what's in the index, leaving unstaged changes in working directory
     */
    async createShelfStagedOnly(): Promise<void> {
        try {
            const repoRoot = this.shelvesProvider.getRepoRoot();
            if (!repoRoot) {
                vscode.window.showErrorMessage('Not in a git repository');
                return;
            }

            // Check if there are staged changes
            const hasStagedChanges = await this.gitService.hasStagedChanges(repoRoot);
            if (!hasStagedChanges) {
                vscode.window.showErrorMessage('No staged changes to shelve');
                return;
            }

            // Get preview of what will be stashed
            const preview = await this.gitService.getStashPreview(repoRoot, false);

            // Check for files with both staged and unstaged changes
            const hasMixedChanges = await this.gitService.hasFilesWithMixedChanges(repoRoot);
            if (hasMixedChanges) {
                // Find which files have mixed changes
                const stagedFiles = new Set(preview.staged.map(f => f.file));
                const unstagedFiles = new Set(preview.unstaged.map(f => f.file));
                const mixedFiles = Array.from(stagedFiles).filter(f => unstagedFiles.has(f));

                const mixedFilesText = mixedFiles.map(f => `  • ${f}`).join('\n');

                const action = await vscode.window.showWarningMessage(
                    'Cannot Shelf Only Staged\n\n' +
                    'These files have BOTH staged and unstaged changes:\n\n' +
                    mixedFilesText + '\n\n' +
                    'The --staged flag cannot handle this situation.\n\n' +
                    'Try "Shelf All (Keep Staged)" instead?\n' +
                    'This stashes everything but keeps staged changes in your working directory.',
                    { modal: true },
                    'Use "Shelf All (Keep Staged)"'
                );

                if (action === 'Use "Shelf All (Keep Staged)"') {
                    // Call the keep-index method instead
                    await this.createShelfKeepIndex();
                }
                return;
            }

            // Show confirmation with preview - only staged files
            const previewText = this.formatStashPreview(preview, true, false, false);
            const confirmMessage = 'Shelf Only Staged\n\n' +
                'What this does:\n' +
                '• Stash ONLY staged changes\n' +
                '• Unstaged changes remain in working directory\n\n' +
                previewText;

            const proceed = await vscode.window.showInformationMessage(
                confirmMessage,
                { modal: true },
                'Create Shelf'
            );

            if (!proceed) {
                return;
            }

            // Ask for shelf name/message
            const message = await vscode.window.showInputBox({
                prompt: 'Enter shelf name (only staged changes will be stashed)',
                placeHolder: 'e.g., Ready to deploy',
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

            await this.gitService.createStash(repoRoot, message, false, false, true);
            this.shelvesProvider.refresh();
            vscode.window.showInformationMessage(`Shelf "${message}" created\n\nStaged changes shelved, unstaged changes remain in working directory`);
        } catch (error) {
            const errorMsg = String(error);

            // Handle Git version error (Git < 2.35 doesn't support --staged)
            if (errorMsg.includes('--staged') && errorMsg.includes('unknown option')) {
                vscode.window.showErrorMessage('Failed to create shelf: Git 2.35+ required for --staged flag');
            }
            // Generic error
            else {
                vscode.window.showErrorMessage(`Failed to create shelf: ${error}`);
            }

            console.error('Error creating shelf with staged only:', error);
            this.shelvesProvider.refresh();
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
     * Shelve specific file(s) to an existing shelf
     */
    async shelveFileTo(...resources: vscode.SourceControlResourceState[]): Promise<void> {
        try {
            // Get repository root
            const repoRoot = this.shelvesProvider.getRepoRoot();
            if (!repoRoot) {
                vscode.window.showErrorMessage('Not in a git repository');
                return;
            }

            // Get file paths from resources
            if (!resources || resources.length === 0) {
                vscode.window.showWarningMessage('No files selected');
                return;
            }

            const filePaths = resources.map(r => r.resourceUri.fsPath);
            const relativeFilePaths = filePaths.map(fp => {
                return fp.replace(repoRoot + path.sep, '');
            });

            // Get list of shelves
            const stashes = await this.gitService.getStashes(repoRoot);
            if (stashes.length === 0) {
                vscode.window.showWarningMessage('No shelves available. Create a shelf first.');
                return;
            }

            // Show quick pick to choose shelf
            const shelfItems = stashes.map(stash => ({
                label: stash.message,
                description: `${stash.fileCount} files • ${stash.branch}`,
                detail: stash.index,
                stash: stash
            }));

            const selected = await vscode.window.showQuickPick(shelfItems, {
                placeHolder: `Shelve ${relativeFilePaths.length} file(s) to...`,
                title: 'Select Shelf'
            });

            if (!selected) {
                return;
            }

            const targetStash = selected.stash;
            const fileNames = relativeFilePaths.map(p => path.basename(p)).join(', ');

            // Confirm the action
            const confirm = await vscode.window.showWarningMessage(
                `Add ${relativeFilePaths.length} file(s) to shelf "${targetStash.message}"?\n\nFiles: ${fileNames}`,
                { modal: true },
                'Add to Shelf'
            );

            if (confirm !== 'Add to Shelf') {
                return;
            }

            // Check if target stash has untracked files
            const stashHasUntracked = await this.gitService.stashHasUntrackedFiles(targetStash.index, repoRoot);

            // Stash the specific files temporarily
            await this.gitService.stashSpecificFiles(repoRoot, relativeFilePaths);

            // Pop the target shelf
            await this.gitService.popStash(targetStash.index, repoRoot);

            // Pop the temporary stash we just created (combines the changes)
            await this.gitService.popStash('stash@{0}', repoRoot);

            // Create a new stash with the combined changes
            await this.gitService.createStash(repoRoot, targetStash.message, stashHasUntracked);

            this.shelvesProvider.refresh();
            vscode.window.showInformationMessage(`Added ${relativeFilePaths.length} file(s) to shelf "${targetStash.message}"`);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to shelve file: ${error}`);
            console.error('Error shelving file to shelf:', error);
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

