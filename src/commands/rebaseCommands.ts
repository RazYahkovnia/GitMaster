import * as vscode from 'vscode';
import { GitService } from '../services/gitService';
import { RebaseProvider, RebaseTreeItem } from '../providers/rebaseProvider';
import { CommitDetailsProvider } from '../providers/commitDetailsProvider';
import { RebaseState, CommitInfo } from '../types/git';

/**
 * Command handlers for interactive rebase operations
 */
export class RebaseCommands {
    constructor(
        private gitService: GitService,
        private rebaseProvider: RebaseProvider,
        private commitDetailsProvider: CommitDetailsProvider
    ) { }

    /**
     * Start interactive rebase - prompt for base branch
     */
    async startRebase(): Promise<void> {
        try {
            const repoRoot = await this.getRepoRoot();
            if (!repoRoot) {
                return;
            }

            // Get current branch
            const currentBranch = await this.gitService.getCurrentBranch(repoRoot);
            if (!currentBranch) {
                vscode.window.showErrorMessage('Not currently on a branch');
                return;
            }

            // Check for uncommitted changes
            const hasChanges = await this.gitService.hasChangesToStash(repoRoot);
            if (hasChanges) {
                vscode.window.showWarningMessage(
                    'You have uncommitted changes. Please commit or stash them before rebasing.'
                );
                return;
            }

            // Get all branches to let user choose
            const branches = await this.gitService.getBranches(repoRoot);
            const branchItems = branches
                .filter(b => !b.isCurrent && b.name !== currentBranch)
                .map(b => ({
                    label: b.name,
                    description: b.isRemote ? '(remote)' : '(local)',
                    detail: b.lastCommitMessage,
                    branch: b
                }));

            // Add default branch suggestions at the top
            const defaultBranch = await this.gitService.getDefaultBranch(repoRoot);
            if (defaultBranch) {
                // Find and move default branch to top
                const defaultIndex = branchItems.findIndex(item => item.label === defaultBranch);
                if (defaultIndex > 0) {
                    const defaultItem = branchItems.splice(defaultIndex, 1)[0];
                    defaultItem.description = '(default)';
                    branchItems.unshift(defaultItem);
                }
            }

            const selectedItem = await vscode.window.showQuickPick(branchItems, {
                placeHolder: `Select base branch to rebase ${currentBranch} onto`,
                matchOnDescription: true,
                matchOnDetail: true
            });

            if (!selectedItem) {
                return;
            }

            await this.initializeRebase(repoRoot, selectedItem.label, currentBranch);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to start rebase: ${error}`);
            console.error('Error starting rebase:', error);
        }
    }

    /**
     * Quick rebase on default branch (main/master)
     */
    async startRebaseOnDefault(): Promise<void> {
        try {
            const repoRoot = await this.getRepoRoot();
            if (!repoRoot) {
                return;
            }

            // Get current branch
            const currentBranch = await this.gitService.getCurrentBranch(repoRoot);
            if (!currentBranch) {
                vscode.window.showErrorMessage('Not currently on a branch');
                return;
            }

            // Check for uncommitted changes
            const hasChanges = await this.gitService.hasChangesToStash(repoRoot);
            if (hasChanges) {
                vscode.window.showWarningMessage(
                    'You have uncommitted changes. Please commit or stash them before rebasing.'
                );
                return;
            }

            // Get default branch
            const defaultBranch = await this.gitService.getDefaultBranch(repoRoot);
            if (!defaultBranch) {
                vscode.window.showErrorMessage('Could not detect default branch (main/master)');
                return;
            }

            await this.initializeRebase(repoRoot, defaultBranch, currentBranch);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to start rebase: ${error}`);
            console.error('Error starting rebase on default:', error);
        }
    }

    /**
     * Fetch and then rebase
     */
    async fetchAndRebase(): Promise<void> {
        try {
            const repoRoot = await this.getRepoRoot();
            if (!repoRoot) {
                return;
            }

            // Show progress
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "Fetching from remote...",
                cancellable: false
            }, async (progress) => {
                await this.gitService.fetchRemote(repoRoot);
            });

            vscode.window.showInformationMessage('Fetch completed. Starting rebase...');

            // Now start rebase on default
            await this.startRebaseOnDefault();
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to fetch and rebase: ${error}`);
            console.error('Error fetching and rebasing:', error);
        }
    }

    /**
     * Change commit action (pick, reword, squash, fixup, drop)
     */
    async changeCommitAction(item: RebaseTreeItem): Promise<void> {
        try {
            if (!item.commit) {
                return;
            }

            const currentAction = item.commit.action;
            const rebaseState = this.rebaseProvider.getRebaseState();

            // Check if this is the oldest commit (can't squash/fixup)
            let canSquashOrFixup = true;
            if (rebaseState) {
                const commitIndex = rebaseState.commits.findIndex(c => c.hash === item.commit!.hash);
                // If it's the last commit (oldest in descending order) or only one commit, can't squash/fixup
                canSquashOrFixup = commitIndex < rebaseState.commits.length - 1 && rebaseState.commits.length > 1;
            }

            const actions = [
                {
                    label: '$(edit) Reword',
                    description: 'Change the commit message',
                    detail: 'Keep the changes but write a new commit message',
                    action: 'reword' as const,
                    picked: currentAction === 'reword'
                },
                ...(canSquashOrFixup ? [
                    {
                        label: '$(arrow-down) Squash',
                        description: 'Merge into the commit below (keep both messages)',
                        detail: 'Combines this commit with the one below it, keeping both commit messages',
                        action: 'squash' as const,
                        picked: currentAction === 'squash'
                    },
                    {
                        label: '$(arrow-down) Fixup',
                        description: 'Merge into the commit below (discard this message)',
                        detail: 'Combines this commit with the one below it, but discards this commit message',
                        action: 'fixup' as const,
                        picked: currentAction === 'fixup'
                    }
                ] : []),
                {
                    label: '$(trash) Drop',
                    description: 'Remove this commit entirely',
                    detail: 'The changes in this commit will be discarded',
                    action: 'drop' as const,
                    picked: currentAction === 'drop'
                },
                {
                    label: '$(debug-pause) Edit',
                    description: 'Pause to modify this commit (advanced)',
                    detail: 'Rebase will pause here so you can amend the commit manually',
                    action: 'edit' as const,
                    picked: currentAction === 'edit'
                }
            ];

            const selected = await vscode.window.showQuickPick(actions, {
                placeHolder: `Action for: ${item.commit.message} (${item.commit.shortHash})`,
                matchOnDescription: true,
                matchOnDetail: true
            });

            if (!selected) {
                return;
            }

            // If reword is selected, immediately ask for the new message
            if (selected.action === 'reword') {
                const newMessage = await vscode.window.showInputBox({
                    prompt: 'Enter new commit message',
                    value: item.commit.message,
                    placeHolder: 'Commit message...',
                    validateInput: (value) => {
                        if (!value || value.trim().length === 0) {
                            return 'Commit message cannot be empty';
                        }
                        return null;
                    }
                });

                if (!newMessage) {
                    return; // User cancelled
                }

                // Update both action and message
                item.commit.message = newMessage;
                this.rebaseProvider.updateCommitAction(item.commit.hash, 'reword');
                this.rebaseProvider.refresh();
                vscode.window.showInformationMessage(
                    `✓ Commit message updated. Click Execute to apply rebase.`,
                    'Execute Now'
                ).then(choice => {
                    if (choice === 'Execute Now') {
                        this.executeRebase();
                    }
                });
                return;
            }

            // Update the action
            this.rebaseProvider.updateCommitAction(item.commit.hash, selected.action);

            // Show contextual message based on action
            const messages = {
                'reword': '✎ Commit message will be changed',
                'edit': '⏸ Rebase will pause at this commit for editing',
                'squash': '⬇ Commit will merge into the one below it (both messages kept)',
                'fixup': '⬇ Commit will merge into the one below it (this message discarded)',
                'drop': '✗ Commit will be removed'
            };

            const message = messages[selected.action];
            vscode.window.showInformationMessage(
                `${message}. Click Execute when ready.`,
                'Execute Now',
                'Configure More'
            ).then(choice => {
                if (choice === 'Execute Now') {
                    this.executeRebase();
                }
            });

        } catch (error) {
            vscode.window.showErrorMessage(`Failed to change action: ${error}`);
            console.error('Error changing commit action:', error);
        }
    }

    /**
     * Reword a commit message
     */
    async rewordCommit(item: RebaseTreeItem): Promise<void> {
        try {
            if (!item.commit) {
                return;
            }

            const newMessage = await vscode.window.showInputBox({
                prompt: 'Enter new commit message',
                value: item.commit.message,
                placeHolder: 'Commit message...',
                validateInput: (value) => {
                    if (!value || value.trim().length === 0) {
                        return 'Commit message cannot be empty';
                    }
                    return null;
                }
            });

            if (!newMessage || newMessage === item.commit.message) {
                return; // User cancelled or no change
            }

            item.commit.message = newMessage;
            this.rebaseProvider.updateCommitAction(item.commit.hash, 'reword');
            this.rebaseProvider.refresh();

            vscode.window.showInformationMessage(
                '✓ Commit message updated. Click Execute to apply.',
                'Execute Now',
                'Configure More'
            ).then(choice => {
                if (choice === 'Execute Now') {
                    this.executeRebase();
                }
            });
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to reword commit: ${error}`);
            console.error('Error rewording commit:', error);
        }
    }

    /**
     * Execute the rebase
     */
    async executeRebase(): Promise<void> {
        try {
            const rebaseState = this.rebaseProvider.getRebaseState();
            if (!rebaseState || rebaseState.commits.length === 0) {
                vscode.window.showWarningMessage('No rebase to execute');
                return;
            }

            // Confirm execution
            const action = await vscode.window.showWarningMessage(
                `Execute rebase of ${rebaseState.commits.length} commit(s) based on ${rebaseState.baseBranch}?`,
                { modal: true },
                'Execute Rebase',
                'Cancel'
            );

            if (action !== 'Execute Rebase') {
                return;
            }

            // Execute with progress
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "Executing rebase...",
                cancellable: false
            }, async (progress) => {
                try {
                    // Reverse commits back to ascending order (oldest first) for Git
                    const commitsForGit = [...rebaseState.commits].reverse();

                    await this.gitService.startInteractiveRebase(
                        rebaseState.repoRoot,
                        rebaseState.baseBranch,
                        commitsForGit
                    );

                    // Check if rebase completed or needs interaction
                    const isInProgress = await this.gitService.isRebaseInProgress(rebaseState.repoRoot);

                    if (isInProgress) {
                        // Check for conflicts
                        const conflicts = await this.gitService.getRebaseConflicts(rebaseState.repoRoot);

                        if (conflicts.length > 0) {
                            rebaseState.isInProgress = true;
                            rebaseState.hasConflicts = true;
                            rebaseState.conflictMessage = `${conflicts.length} file(s) have conflicts`;
                            await this.rebaseProvider.setRebaseState(rebaseState);

                            vscode.window.showWarningMessage(
                                `⚠️ Rebase paused: ${conflicts.length} file(s) have conflicts. Resolve them and continue.`,
                                'Show Conflicts',
                                'Abort'
                            ).then(choice => {
                                if (choice === 'Show Conflicts') {
                                    vscode.commands.executeCommand('workbench.view.scm');
                                } else if (choice === 'Abort') {
                                    this.abortRebase();
                                }
                            });
                        } else {
                            // Rebase is paused but no conflicts (e.g., for 'edit' action)
                            rebaseState.isInProgress = true;
                            rebaseState.hasConflicts = false;
                            await this.rebaseProvider.setRebaseState(rebaseState);

                            vscode.window.showInformationMessage(
                                '⏸ Rebase paused for editing. Make changes and continue when ready.',
                                'Continue',
                                'Abort'
                            ).then(choice => {
                                if (choice === 'Continue') {
                                    this.continueRebase();
                                } else if (choice === 'Abort') {
                                    this.abortRebase();
                                }
                            });
                        }
                    } else {
                        // Rebase completed successfully - reload commits to show updated state
                        vscode.window.showInformationMessage('✓ Rebase completed successfully!');
                        await this.rebaseProvider.setRepoRoot(rebaseState.repoRoot);
                    }
                } catch (error) {
                    throw error;
                }
            });
        } catch (error) {
            vscode.window.showErrorMessage(`Rebase failed: ${error}`);
            console.error('Error executing rebase:', error);

            // Update state to show error
            const rebaseState = this.rebaseProvider.getRebaseState();
            if (rebaseState) {
                rebaseState.isInProgress = true;
                rebaseState.hasConflicts = true;
                rebaseState.conflictMessage = `Error: ${error}`;
                await this.rebaseProvider.setRebaseState(rebaseState);
            }
        }
    }

    /**
     * Continue rebase after resolving conflicts
     */
    async continueRebase(): Promise<void> {
        try {
            const rebaseState = this.rebaseProvider.getRebaseState();
            if (!rebaseState) {
                vscode.window.showWarningMessage('No rebase session found');
                return;
            }

            // First check if rebase is actually in progress
            const isInProgressBefore = await this.gitService.isRebaseInProgress(rebaseState.repoRoot);
            if (!isInProgressBefore) {
                vscode.window.showInformationMessage('Rebase has already completed');
                await this.rebaseProvider.setRepoRoot(rebaseState.repoRoot);
                return;
            }

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "Continuing rebase...",
                cancellable: false
            }, async (progress) => {
                try {
                    await this.gitService.continueRebase(rebaseState.repoRoot);

                    // Check if still in progress
                    const isInProgress = await this.gitService.isRebaseInProgress(rebaseState.repoRoot);

                    if (isInProgress) {
                        const conflicts = await this.gitService.getRebaseConflicts(rebaseState.repoRoot);

                        if (conflicts.length > 0) {
                            rebaseState.hasConflicts = true;
                            rebaseState.conflictMessage = `${conflicts.length} file(s) have conflicts`;
                            await this.rebaseProvider.setRebaseState(rebaseState);
                            vscode.window.showWarningMessage('Still have conflicts. Please resolve and continue again.');
                        } else {
                            rebaseState.hasConflicts = false;
                            await this.rebaseProvider.setRebaseState(rebaseState);
                        }
                    } else {
                        // Completed! Reload commits to show updated state
                        vscode.window.showInformationMessage('✓ Rebase completed successfully!');
                        await this.rebaseProvider.setRepoRoot(rebaseState.repoRoot);
                    }
                } catch (error) {
                    throw error;
                }
            });
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to continue rebase: ${error}`);
            console.error('Error continuing rebase:', error);
        }
    }

    /**
     * Abort rebase operation
     */
    async abortRebase(): Promise<void> {
        try {
            const rebaseState = this.rebaseProvider.getRebaseState();
            if (!rebaseState) {
                vscode.window.showWarningMessage('No rebase to abort');
                return;
            }

            const action = await vscode.window.showWarningMessage(
                'Are you sure you want to abort the rebase? All changes will be lost.',
                { modal: true },
                'Abort Rebase',
                'Cancel'
            );

            if (action !== 'Abort Rebase') {
                return;
            }

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "Aborting rebase...",
                cancellable: false
            }, async (progress) => {
                await this.gitService.abortRebase(rebaseState.repoRoot);
            });

            vscode.window.showInformationMessage('Rebase aborted');
            await this.rebaseProvider.setRebaseState(undefined);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to abort rebase: ${error}`);
            console.error('Error aborting rebase:', error);
        }
    }

    /**
     * Refresh rebase view
     */
    refreshRebase(): void {
        this.rebaseProvider.refresh();
    }

    /**
     * Reset all commit actions back to pick
     */
    async resetRebase(): Promise<void> {
        try {
            const rebaseState = this.rebaseProvider.getRebaseState();
            if (!rebaseState) {
                vscode.window.showWarningMessage('No rebase session active');
                return;
            }

            const action = await vscode.window.showWarningMessage(
                'Reset all changes and start over?',
                { modal: true },
                'Reset',
                'Cancel'
            );

            if (action !== 'Reset') {
                return;
            }

            // Reset all commits back to pick action and original messages
            await this.initializeRebase(rebaseState.repoRoot, rebaseState.baseBranch, rebaseState.currentBranch);

            vscode.window.showInformationMessage('Rebase configuration reset. All commits set to pick.');
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to reset rebase: ${error}`);
            console.error('Error resetting rebase:', error);
        }
    }

    /**
     * Change the base branch for rebase
     */
    async changeBaseBranch(): Promise<void> {
        try {
            const rebaseState = this.rebaseProvider.getRebaseState();
            if (!rebaseState) {
                vscode.window.showWarningMessage('No rebase session active');
                return;
            }

            // Get all branches to let user choose
            const branches = await this.gitService.getBranches(rebaseState.repoRoot);
            const currentBranch = rebaseState.currentBranch;

            const branchItems = branches
                .filter(b => b.name !== currentBranch)
                .map(b => ({
                    label: b.name,
                    description: b.isRemote ? '(remote)' : '(local)',
                    detail: b.lastCommitMessage,
                    branch: b
                }));

            // Highlight current base branch
            const currentBaseIndex = branchItems.findIndex(item => item.label === rebaseState.baseBranch);
            if (currentBaseIndex >= 0) {
                branchItems[currentBaseIndex].description = '(current base)';
            }

            const selectedItem = await vscode.window.showQuickPick(branchItems, {
                placeHolder: `Select new base branch (currently: ${rebaseState.baseBranch})`,
                matchOnDescription: true,
                matchOnDetail: true
            });

            if (!selectedItem) {
                return;
            }

            // Reload commits with new base branch
            await this.initializeRebase(rebaseState.repoRoot, selectedItem.label, currentBranch);

            vscode.window.showInformationMessage(
                `Base branch changed to ${selectedItem.label}. Configure and execute when ready.`
            );
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to change base branch: ${error}`);
            console.error('Error changing base branch:', error);
        }
    }

    /**
     * Initialize rebase state
     */
    private async initializeRebase(repoRoot: string, baseBranch: string, currentBranch: string): Promise<void> {
        try {
            // Get commits ahead of base
            const commits = await this.gitService.getCommitsAheadOfBase(repoRoot, baseBranch, currentBranch);

            if (commits.length === 0) {
                vscode.window.showInformationMessage(
                    `No commits to rebase. ${currentBranch} is up to date with ${baseBranch}.`
                );
                return;
            }

            // Reverse commits to show latest first (descending order for display)
            const commitsDescending = [...commits].reverse();

            // Create rebase state
            const rebaseState: RebaseState = {
                repoRoot,
                currentBranch,
                baseBranch,
                commits: commitsDescending,
                isInProgress: false,
                hasConflicts: false
            };

            await this.rebaseProvider.setRebaseState(rebaseState);

            vscode.window.showInformationMessage(
                `Ready to rebase ${commits.length} commit(s) based on ${baseBranch}. Configure and execute when ready.`
            );
        } catch (error) {
            throw new Error(`Failed to initialize rebase: ${error}`);
        }
    }

    /**
     * Get repository root from active editor or workspace
     */
    private async getRepoRoot(): Promise<string | null> {
        // Try active editor first
        if (vscode.window.activeTextEditor) {
            const filePath = vscode.window.activeTextEditor.document.uri.fsPath;
            const repoRoot = await this.gitService.getRepoRoot(filePath);
            if (repoRoot) {
                return repoRoot;
            }
        }

        // Try workspace folders
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            for (const folder of workspaceFolders) {
                const repoRoot = await this.gitService.getRepoRoot(folder.uri.fsPath);
                if (repoRoot) {
                    return repoRoot;
                }
            }
        }

        vscode.window.showErrorMessage('No Git repository found');
        return null;
    }

    /**
     * Show commit details from rebase view
     */
    async showCommitDetails(treeItem: RebaseTreeItem): Promise<void> {
        try {
            if (!treeItem.commit || !treeItem.repoRoot) {
                vscode.window.showErrorMessage('No commit information available');
                return;
            }

            const commit = treeItem.commit;
            const repoRoot = treeItem.repoRoot;

            // Convert RebaseCommit to CommitInfo
            const commitInfo: CommitInfo = {
                hash: commit.hash,
                shortHash: commit.shortHash,
                message: commit.message,
                author: commit.author,
                date: commit.date,
                relativeDate: commit.date // Use same date as relative for now
            };

            // Update the commit details view in sidebar
            await this.commitDetailsProvider.setCommit(commitInfo, repoRoot);

            // Show the commit details view
            vscode.commands.executeCommand('setContext', 'gitmaster.commitSelected', true);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to show commit details: ${error}`);
            console.error('Error showing commit details:', error);
        }
    }
}

