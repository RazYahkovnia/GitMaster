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

        // Set command to show commit details when clicked
        this.command = {
            command: 'gitmaster.showReflogCommitDetails',
            title: 'Show Commit Details',
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
 * Tree item for load more button
 */
export class LoadMoreReflogTreeItem extends vscode.TreeItem {
    constructor() {
        super('Load More Operations...', vscode.TreeItemCollapsibleState.None);
        this.contextValue = 'loadMoreReflog';
        this.iconPath = new vscode.ThemeIcon('fold-down');
        this.command = {
            command: 'gitmaster.loadMoreReflog',
            title: 'Load More Operations'
        };
    }
}

/**
 * Provider for the Git Operations (Reflog) tree view
 */
export class ReflogProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | null | void> =
        new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | null | void> =
        this._onDidChangeTreeData.event;

    private currentRepoRoot: string | undefined;
    private entryLimit: number = 50;
    private readonly LOAD_MORE_INCREMENT = 50;

    constructor(private gitService: GitService) { }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
        if (!this.currentRepoRoot) {
            const emptyItem = new vscode.TreeItem('No repository opened');
            emptyItem.contextValue = 'empty';
            return [emptyItem];
        }

        // Only show root level items (no children)
        if (element) {
            return [];
        }

        try {
            const entries = await this.gitService.getReflog(this.currentRepoRoot, this.entryLimit);

            if (entries.length === 0) {
                const emptyItem = new vscode.TreeItem('No git operations found');
                emptyItem.contextValue = 'empty';
                return [emptyItem];
            }

            const items: vscode.TreeItem[] = entries.map(entry =>
                new ReflogTreeItem(
                    entry,
                    this.currentRepoRoot!,
                    vscode.TreeItemCollapsibleState.None
                )
            );

            // Add "Load More" button at the bottom if we have entries equal to the limit
            // (suggesting there might be more entries available)
            if (entries.length === this.entryLimit) {
                items.push(new LoadMoreReflogTreeItem());
            }

            return items;
        } catch (error) {
            console.error('Error getting reflog:', error);
            return [];
        }
    }

    setRepoRoot(repoRoot: string | undefined): void {
        this.currentRepoRoot = repoRoot;
        this.entryLimit = 50; // Reset entry limit when changing repos
        this.refresh();
    }

    /**
     * Load more reflog entries
     */
    loadMore(): void {
        this.entryLimit += this.LOAD_MORE_INCREMENT;
        this.refresh();
    }

    getRepoRoot(): string | undefined {
        return this.currentRepoRoot;
    }
}

