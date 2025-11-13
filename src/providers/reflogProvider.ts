import * as vscode from 'vscode';
import { GitService } from '../services/gitService';
import { ReflogEntry } from '../types/git';

/**
 * Tree item for a reflog entry (git operation)
 */
export class ReflogTreeItem extends vscode.TreeItem {
    constructor(
        public readonly entry: ReflogEntry,
        public readonly repoRoot: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(entry.message, collapsibleState);

        this.tooltip = this.createTooltip();
        this.description = `${entry.shortHash} • ${entry.selector}`;
        this.contextValue = 'reflogEntry';
        this.iconPath = this.getIcon();

        // Set command to checkout when clicked
        this.command = {
            command: 'gitmaster.checkoutFromReflog',
            title: 'Checkout to Commit',
            arguments: [this.entry, this.repoRoot]
        };
    }

    private createTooltip(): string {
        return `${this.entry.message}\nCommit: ${this.entry.hash}\nSelector: ${this.entry.selector}`;
    }

    private getIcon(): vscode.ThemeIcon {
        // Different icons for different operations
        switch (this.entry.action) {
            case 'commit':
                return new vscode.ThemeIcon('git-commit');
            case 'checkout':
                return new vscode.ThemeIcon('git-branch');
            case 'pull':
                return new vscode.ThemeIcon('cloud-download');
            case 'merge':
                return new vscode.ThemeIcon('git-merge');
            case 'rebase':
                return new vscode.ThemeIcon('versions');
            case 'reset':
                return new vscode.ThemeIcon('discard');
            case 'cherry-pick':
                return new vscode.ThemeIcon('git-pull-request');
            default:
                return new vscode.ThemeIcon('history');
        }
    }
}

/**
 * Provider for the Git Operations (Reflog) tree view
 */
export class ReflogProvider implements vscode.TreeDataProvider<ReflogTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<ReflogTreeItem | undefined | null | void> =
        new vscode.EventEmitter<ReflogTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<ReflogTreeItem | undefined | null | void> =
        this._onDidChangeTreeData.event;

    private currentRepoRoot: string | undefined;

    constructor(private gitService: GitService) { }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: ReflogTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: ReflogTreeItem): Promise<ReflogTreeItem[]> {
        if (!this.currentRepoRoot) {
            const emptyItem = new vscode.TreeItem('No repository opened');
            emptyItem.contextValue = 'empty';
            return [emptyItem as any];
        }

        // Only show root level items (no children)
        if (element) {
            return [];
        }

        try {
            const entries = await this.gitService.getReflog(this.currentRepoRoot);

            if (entries.length === 0) {
                const emptyItem = new vscode.TreeItem('No git operations found');
                emptyItem.contextValue = 'empty';
                return [emptyItem as any];
            }

            return entries.map(entry =>
                new ReflogTreeItem(
                    entry,
                    this.currentRepoRoot!,
                    vscode.TreeItemCollapsibleState.None
                )
            );
        } catch (error) {
            console.error('Error getting reflog:', error);
            return [];
        }
    }

    setRepoRoot(repoRoot: string | undefined): void {
        this.currentRepoRoot = repoRoot;
        this.refresh();
    }

    getRepoRoot(): string | undefined {
        return this.currentRepoRoot;
    }
}

