import * as vscode from 'vscode';
import { GitService } from '../services/gitService';
import { RebaseCommit, RebaseState } from '../types/git';
import { getAuthorColor } from '../utils/colorUtils';

/**
 * Tree item for rebase view
 */
export class RebaseTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly commit?: RebaseCommit,
        public readonly type?: 'header' | 'commit' | 'info' | 'status',
        public readonly repoRoot?: string
    ) {
        super(label, collapsibleState);

        if (type === 'commit' && commit) {
            this.contextValue = 'rebaseCommit';
            this.tooltip = this.createTooltip(commit);
            this.description = this.createDescription(commit);
            this.iconPath = this.getIconForAction(commit.action);

            // Set the command to execute when the item is clicked
            this.command = {
                command: 'gitmaster.showRebaseCommitDetails',
                title: 'Show Commit Details',
                arguments: [this]
            };
        } else if (type === 'header') {
            this.contextValue = 'rebaseHeader';
        } else if (type === 'status') {
            this.contextValue = 'rebaseStatus';
        } else if (type === 'info') {
            this.contextValue = 'rebaseInfo';
        }
    }

    private createTooltip(commit: RebaseCommit): string {
        let tooltip = `${commit.message}\n\n`;
        tooltip += `Commit: ${commit.shortHash}\n`;
        tooltip += `Author: ${commit.author}\n`;
        tooltip += `Date: ${commit.date}\n`;
        tooltip += `Action: ${commit.action.toUpperCase()}\n`;

        if (commit.fileCount !== undefined) {
            tooltip += `Files: ${commit.fileCount}`;
            if (commit.additions !== undefined || commit.deletions !== undefined) {
                tooltip += ` (+${commit.additions || 0} -${commit.deletions || 0})`;
            }
        }

        return tooltip;
    }

    private createDescription(commit: RebaseCommit): string {
        const actionBadge = this.getActionBadge(commit.action);
        let desc = `${actionBadge} ${commit.author}`;

        if (commit.fileCount !== undefined) {
            desc += ` • ${commit.fileCount} file${commit.fileCount !== 1 ? 's' : ''}`;
        }

        return desc;
    }

    private getActionBadge(action: string): string {
        const badges = {
            'pick': '✓',
            'reword': '✎',
            'edit': '✋',
            'squash': '⬆',
            'fixup': '⬆',
            'drop': '✗'
        };
        return badges[action as keyof typeof badges] || '?';
    }

    private getIconForAction(action: string): vscode.ThemeIcon {
        const icons = {
            'pick': new vscode.ThemeIcon('git-commit', new vscode.ThemeColor('gitDecoration.addedResourceForeground')),
            'reword': new vscode.ThemeIcon('edit', new vscode.ThemeColor('gitDecoration.modifiedResourceForeground')),
            'edit': new vscode.ThemeIcon('debug-pause', new vscode.ThemeColor('gitDecoration.modifiedResourceForeground')),
            'squash': new vscode.ThemeIcon('arrow-down', new vscode.ThemeColor('charts.orange')),
            'fixup': new vscode.ThemeIcon('arrow-down', new vscode.ThemeColor('charts.purple')),
            'drop': new vscode.ThemeIcon('trash', new vscode.ThemeColor('gitDecoration.deletedResourceForeground'))
        };
        return icons[action as keyof typeof icons] || new vscode.ThemeIcon('circle-outline');
    }
}

/**
 * Provider for the interactive rebase tree view
 */
export class RebaseProvider implements vscode.TreeDataProvider<RebaseTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<RebaseTreeItem | undefined | null | void> = new vscode.EventEmitter<RebaseTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<RebaseTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private rebaseState: RebaseState | undefined;
    private repoRoot: string | undefined;

    constructor(private gitService: GitService) { }

    /**
     * Refresh the tree view
     */
    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    /**
     * Set the repository root and auto-load commits
     */
    async setRepoRoot(repoRoot: string | undefined): Promise<void> {
        this.repoRoot = repoRoot;

        if (repoRoot) {
            await this.loadCommitsForCurrentBranch(repoRoot);
        } else {
            this.rebaseState = undefined;
        }

        this.refresh();
    }

    /**
     * Automatically load commits for the current branch
     */
    private async loadCommitsForCurrentBranch(repoRoot: string): Promise<void> {
        try {
            // Get current branch
            const currentBranch = await this.gitService.getCurrentBranch(repoRoot);
            if (!currentBranch) {
                this.rebaseState = undefined;
                return;
            }

            // Get default branch
            const defaultBranch = await this.gitService.getDefaultBranch(repoRoot);
            if (!defaultBranch) {
                this.rebaseState = undefined;
                return;
            }

            // Get commits ahead of base (always try, even if 0 commits)
            const commits = await this.gitService.getCommitsAheadOfBase(repoRoot, defaultBranch, currentBranch);

            // Reverse the commits to show latest first (descending order)
            const commitsDescending = [...commits].reverse();

            // Create rebase state (showing current state, even if no commits)
            this.rebaseState = {
                repoRoot,
                currentBranch,
                baseBranch: defaultBranch,
                commits: commitsDescending,
                isInProgress: false,
                hasConflicts: false
            };

            if (commits.length > 0) {
                await vscode.commands.executeCommand('setContext', 'gitmaster.hasRebaseCommits', true);
            } else {
                await vscode.commands.executeCommand('setContext', 'gitmaster.hasRebaseCommits', false);
            }
        } catch (error) {
            console.error('Error loading commits for rebase:', error);
            this.rebaseState = undefined;
            await vscode.commands.executeCommand('setContext', 'gitmaster.hasRebaseCommits', false);
        }
    }

    /**
     * Set the current rebase state
     */
    async setRebaseState(state: RebaseState | undefined): Promise<void> {
        this.rebaseState = state;

        // Update context for view visibility
        if (state && state.commits.length > 0) {
            await vscode.commands.executeCommand('setContext', 'gitmaster.hasRebaseCommits', true);
        } else {
            await vscode.commands.executeCommand('setContext', 'gitmaster.hasRebaseCommits', false);
        }

        if (state?.isInProgress) {
            await vscode.commands.executeCommand('setContext', 'gitmaster.rebaseInProgress', true);
        } else {
            await vscode.commands.executeCommand('setContext', 'gitmaster.rebaseInProgress', false);
        }

        this.updateHasChangesContext();
        this.refresh();
    }

    /**
     * Check if there are any changes from the default state and update context
     */
    private updateHasChangesContext(): void {
        if (!this.rebaseState) {
            vscode.commands.executeCommand('setContext', 'gitmaster.rebaseHasChanges', false);
            return;
        }

        // Check if any commit has a non-pick action
        const hasChanges = this.rebaseState.commits.some(commit => commit.action !== 'pick');
        vscode.commands.executeCommand('setContext', 'gitmaster.rebaseHasChanges', hasChanges);
    }

    /**
     * Get the current rebase state
     */
    getRebaseState(): RebaseState | undefined {
        return this.rebaseState;
    }

    /**
     * Update a commit's action
     */
    updateCommitAction(commitHash: string, action: 'pick' | 'reword' | 'edit' | 'squash' | 'fixup' | 'drop'): void {
        if (!this.rebaseState) {
            return;
        }

        const commit = this.rebaseState.commits.find(c => c.hash === commitHash);
        if (commit) {
            commit.action = action;
            this.updateHasChangesContext();
            this.refresh();
        }
    }

    /**
     * Move a commit up in the list
     */
    moveCommitUp(commitHash: string): void {
        if (!this.rebaseState) {
            return;
        }

        const index = this.rebaseState.commits.findIndex(c => c.hash === commitHash);
        if (index > 0) {
            const temp = this.rebaseState.commits[index];
            this.rebaseState.commits[index] = this.rebaseState.commits[index - 1];
            this.rebaseState.commits[index - 1] = temp;
            this.updateHasChangesContext();
            this.refresh();
        }
    }

    /**
     * Move a commit down in the list
     */
    moveCommitDown(commitHash: string): void {
        if (!this.rebaseState) {
            return;
        }

        const index = this.rebaseState.commits.findIndex(c => c.hash === commitHash);
        if (index >= 0 && index < this.rebaseState.commits.length - 1) {
            const temp = this.rebaseState.commits[index];
            this.rebaseState.commits[index] = this.rebaseState.commits[index + 1];
            this.rebaseState.commits[index + 1] = temp;
            this.updateHasChangesContext();
            this.refresh();
        }
    }

    getTreeItem(element: RebaseTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: RebaseTreeItem): Promise<RebaseTreeItem[]> {
        if (!element) {
            // Root level
            return this.getRootItems();
        }

        return [];
    }

    private async getRootItems(): Promise<RebaseTreeItem[]> {
        if (!this.rebaseState) {
            return [
                new RebaseTreeItem(
                    'Open a Git repository',
                    vscode.TreeItemCollapsibleState.None,
                    undefined,
                    'info'
                )
            ];
        }

        const items: RebaseTreeItem[] = [];

        // Show rebase status header
        if (this.rebaseState.isInProgress) {
            const statusItem = new RebaseTreeItem(
                `⚠️ Rebase in Progress`,
                vscode.TreeItemCollapsibleState.None,
                undefined,
                'status'
            );
            statusItem.description = this.rebaseState.hasConflicts ? 'Conflicts!' : 'Working...';
            statusItem.iconPath = new vscode.ThemeIcon(
                this.rebaseState.hasConflicts ? 'warning' : 'sync~spin',
                new vscode.ThemeColor(this.rebaseState.hasConflicts ? 'errorForeground' : 'charts.blue')
            );
            items.push(statusItem);

            if (this.rebaseState.hasConflicts && this.rebaseState.conflictMessage) {
                const conflictItem = new RebaseTreeItem(
                    this.rebaseState.conflictMessage,
                    vscode.TreeItemCollapsibleState.None,
                    undefined,
                    'info'
                );
                conflictItem.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('errorForeground'));
                items.push(conflictItem);
            }
        } else {
            // Show base branch info
            const headerItem = new RebaseTreeItem(
                `Based on: ${this.rebaseState.baseBranch}`,
                vscode.TreeItemCollapsibleState.None,
                undefined,
                'header'
            );
            headerItem.iconPath = new vscode.ThemeIcon('git-branch', new vscode.ThemeColor('charts.blue'));
            headerItem.description = `${this.rebaseState.commits.length} commit${this.rebaseState.commits.length !== 1 ? 's' : ''} ahead`;
            items.push(headerItem);
        }

        // Show commits (already in descending order - latest first)
        if (this.rebaseState.commits.length === 0) {
            items.push(
                new RebaseTreeItem(
                    'Up to date with base branch',
                    vscode.TreeItemCollapsibleState.None,
                    undefined,
                    'info'
                )
            );
        } else {
            for (const commit of this.rebaseState.commits) {
                const item = new RebaseTreeItem(
                    commit.message,
                    vscode.TreeItemCollapsibleState.None,
                    commit,
                    'commit',
                    this.rebaseState.repoRoot
                );

                // Add color coding by author
                const color = getAuthorColor(commit.author);
                item.iconPath = new vscode.ThemeIcon(
                    this.getIconNameForAction(commit.action),
                    color
                );

                items.push(item);
            }
        }

        return items;
    }

    private getIconNameForAction(action: string): string {
        const icons = {
            'pick': 'git-commit',
            'reword': 'edit',
            'edit': 'debug-pause',
            'squash': 'arrow-down',
            'fixup': 'arrow-down',
            'drop': 'trash'
        };
        return icons[action as keyof typeof icons] || 'circle-outline';
    }
}
