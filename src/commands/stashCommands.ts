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
     * Create a new stash with a custom message - Preset approach
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

            // Build preset options
            interface StashPreset extends vscode.QuickPickItem {
                id: 'save-all' | 'keep-staged' | 'tracked-only' | 'untracked-only' | 'advanced';
            }

            const presets: StashPreset[] = [];
            const totalFiles = preview.staged.length + preview.unstaged.length + preview.untracked.length;
            const trackedFiles = preview.staged.length + preview.unstaged.length;
            const unstagedAndUntracked = preview.unstaged.length + preview.untracked.length;

            // Determine recommended preset
            let recommendedId: string | null = null;
            const hasMixedChanges = await this.gitService.hasFilesWithMixedChanges(repoRoot);

            if (hasMixedChanges) {
                // Files have both staged and unstaged changes - can't use keep-staged
                recommendedId = 'save-all';
            } else if (preview.unstaged.length > 0 && preview.staged.length === 0) {
                recommendedId = 'keep-staged'; // Only unstaged, no mixed changes
            } else if (preview.untracked.length > trackedFiles && trackedFiles > 0) {
                recommendedId = 'tracked-only'; // Mostly untracked
            } else if (trackedFiles === 0 && preview.untracked.length > 0) {
                recommendedId = 'untracked-only'; // Only untracked
            } else {
                recommendedId = 'save-all'; // Default safe option
            }

            // Preset 1: Save All Changes (only if there are tracked files)
            if (totalFiles > 0 && trackedFiles > 0) {
                presets.push({
                    id: 'save-all',
                    label: `$(package) Save All Changes${recommendedId === 'save-all' ? ' ⭐' : ''}`,
                    description: `${totalFiles} file(s)`,
                    detail: 'Stash everything for a clean workspace'
                });
            }

            // Preset 2: Keep Staged Work (only if there are staged files and no mixed changes)
            if (preview.staged.length > 0 && unstagedAndUntracked > 0 && !hasMixedChanges) {
                presets.push({
                    id: 'keep-staged',
                    label: `$(sync) Keep Staged Work${recommendedId === 'keep-staged' ? ' ⭐' : ''}`,
                    description: `${unstagedAndUntracked} file(s)`,
                    detail: 'Stash unstaged/untracked, keep staged changes'
                });
            }

            // Preset 3: Tracked Only
            if (trackedFiles > 0 && preview.untracked.length > 0) {
                presets.push({
                    id: 'tracked-only',
                    label: `$(file-code) Tracked Only${recommendedId === 'tracked-only' ? ' ⭐' : ''}`,
                    description: `${trackedFiles} file(s)`,
                    detail: 'Stash tracked files, leave untracked'
                });
            }

            // Preset 4: Untracked Only (only if ONLY untracked files exist)
            if (trackedFiles === 0 && preview.untracked.length > 0) {
                presets.push({
                    id: 'untracked-only',
                    label: `$(new-file) Untracked Only${recommendedId === 'untracked-only' ? ' ⭐' : ''}`,
                    description: `${preview.untracked.length} file(s)`,
                    detail: 'Stash only untracked files'
                });
            }

            // Advanced options separator
            presets.push({
                id: 'advanced',
                label: '$(gear) Advanced Options...',
                description: '',
                detail: 'Custom selection of what to stash'
            });

            if (presets.length === 1) { // Only "Advanced" option
                vscode.window.showErrorMessage('No changes to shelve');
                return;
            }

            // Show preset picker
            const selectedPreset = await vscode.window.showQuickPick(presets, {
                placeHolder: 'Choose what to stash',
                title: 'Create Shelf'
            });

            if (!selectedPreset) {
                return; // User cancelled
            }

            // If advanced selected, show old UI (we'll implement advanced mode later)
            if (selectedPreset.id === 'advanced') {
                vscode.window.showInformationMessage('Advanced mode coming soon! Please use a preset for now.');
                return;
            }

            // Ask for shelf name
            const message = await vscode.window.showInputBox({
                prompt: 'Enter shelf name',
                placeHolder: 'e.g., Work in progress on feature X',
                validateInput: (value) => value?.trim() ? null : 'Shelf name cannot be empty'
            });

            if (!message) {
                return; // User cancelled
            }

            // Execute the appropriate stash command based on preset
            switch (selectedPreset.id) {
                case 'save-all':
                    // Stash everything with -u flag
                    await this.gitService.createStash(repoRoot, message, true, false, false);
                    break;

                case 'keep-staged':
                    // Stash all but keep staged in working directory
                    await this.gitService.createStash(repoRoot, message, true, true, false);
                    break;

                case 'tracked-only':
                    // Stash only tracked files (no -u flag)
                    await this.gitService.createStash(repoRoot, message, false, false, false);
                    break;

                case 'untracked-only':
                    // Special technique for untracked only
                    await this.gitService.stashUntrackedOnly(repoRoot, message);
                    break;
            }

            this.shelvesProvider.refresh();
            vscode.window.showInformationMessage(`Shelf "${message}" created successfully`);
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
     * This adds ALL current changes to the selected shelf
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

            // Get preview of current changes
            const hasUntracked = await this.gitService.hasUntrackedFiles(repoRoot);
            const preview = await this.gitService.getStashPreview(repoRoot, hasUntracked);

            // Count totals for summary
            let totalFiles = preview.staged.length + preview.unstaged.length + preview.untracked.length;
            let totalAdditions = preview.staged.reduce((sum, f) => sum + f.additions, 0) +
                preview.unstaged.reduce((sum, f) => sum + f.additions, 0);
            let totalDeletions = preview.staged.reduce((sum, f) => sum + f.deletions, 0) +
                preview.unstaged.reduce((sum, f) => sum + f.deletions, 0);

            // Build modal message with better formatting
            const modalLines: string[] = [];
            modalLines.push(`📦 Add Changes to Shelf`);
            modalLines.push('');
            modalLines.push(`Target: "${stashItem.stash.message}"`);
            modalLines.push('');
            modalLines.push(`📊 Changes to Add: ${totalFiles} file(s) • +${totalAdditions} -${totalDeletions}`);
            modalLines.push('');

            // Add file details (limit to first 8 files for readability)
            const maxFilesToShow = 8;
            let filesShown = 0;

            if (preview.staged.length > 0) {
                modalLines.push('📋 Staged Changes:');
                for (const f of preview.staged.slice(0, maxFilesToShow - filesShown)) {
                    modalLines.push(`   ✓ ${f.file} (+${f.additions} -${f.deletions})`);
                    filesShown++;
                }
                if (filesShown >= maxFilesToShow) {
                    const remaining = totalFiles - filesShown;
                    if (remaining > 0) {
                        modalLines.push(`   ... and ${remaining} more file(s)`);
                    }
                } else {
                    modalLines.push('');
                }
            }

            if (filesShown < maxFilesToShow && preview.unstaged.length > 0) {
                modalLines.push('📝 Unstaged Changes:');
                for (const f of preview.unstaged.slice(0, maxFilesToShow - filesShown)) {
                    modalLines.push(`   • ${f.file} (+${f.additions} -${f.deletions})`);
                    filesShown++;
                    if (filesShown >= maxFilesToShow) break;
                }
                if (filesShown >= maxFilesToShow) {
                    const remaining = totalFiles - filesShown;
                    if (remaining > 0) {
                        modalLines.push(`   ... and ${remaining} more file(s)`);
                    }
                } else {
                    modalLines.push('');
                }
            }

            if (filesShown < maxFilesToShow && preview.untracked.length > 0) {
                modalLines.push('🆕 Untracked Files:');
                for (const f of preview.untracked.slice(0, maxFilesToShow - filesShown)) {
                    modalLines.push(`   + ${f}`);
                    filesShown++;
                    if (filesShown >= maxFilesToShow) break;
                }
                const remaining = totalFiles - filesShown;
                if (remaining > 0) {
                    modalLines.push(`   ... and ${remaining} more file(s)`);
                }
            }

            // Confirm the action
            const confirm = await vscode.window.showInformationMessage(
                modalLines.join('\n'),
                { modal: true },
                'Add All Changes'
            );

            if (confirm !== 'Add All Changes') {
                return;
            }

            const originalMessage = stashItem.stash.message;
            const stashIndex = stashItem.stash.index;

            // Step 1: Apply the target shelf to working directory
            await this.gitService.applyStash(stashIndex, repoRoot);

            // Step 2: Delete the old shelf
            await this.gitService.deleteStash(stashIndex, repoRoot);

            // Step 3: Create new shelf with all combined changes (current + applied)
            await this.gitService.createStash(repoRoot, originalMessage, hasUntracked);

            this.shelvesProvider.refresh();
            vscode.window.showInformationMessage(`Added all changes to shelf "${originalMessage}"`);
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            if (errorMsg.includes('would be overwritten') || errorMsg.includes('conflicts')) {
                vscode.window.showErrorMessage(
                    'Cannot add to shelf: Changes conflict with the shelf contents. ' +
                    'Please resolve conflicts manually or create a new shelf instead.'
                );
            } else {
                vscode.window.showErrorMessage(`Failed to add to shelf: ${error}`);
            }
            console.error('Error adding to shelf:', error);
            this.shelvesProvider.refresh();
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

