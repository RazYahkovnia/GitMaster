import * as vscode from 'vscode';
import { GitService } from '../services/gitService';
import { RepositoryCommit } from '../types/git';
import { getAuthorColor } from '../utils/colorUtils';

/**
 * Tree item for a repository commit
 */
export class RepositoryCommitTreeItem extends vscode.TreeItem {
    constructor(
        public readonly commit: RepositoryCommit,
        public readonly repoRoot: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(commit.message, collapsibleState);

        this.description = `${commit.shortHash} • ${commit.author} • ${commit.date}`;
        this.tooltip = this.buildTooltip();
        this.contextValue = 'repositoryCommit';

        // Use author-specific color
        const authorColor = getAuthorColor(commit.author);
        this.iconPath = new vscode.ThemeIcon('git-commit', authorColor);

        // Set command to show commit details when clicked
        this.command = {
            command: 'gitmaster.showRepositoryCommitDetails',
            title: 'Show Commit Details',
            arguments: [this]
        };
    }

    private buildTooltip(): string {
        const lines = [
            `Commit: ${this.commit.hash}`,
            `Author: ${this.commit.author}`,
            `Date: ${this.commit.date}`,
            `Message: ${this.commit.message}`
        ];

        if (this.commit.parentHashes.length > 0) {
            lines.push(`Parents: ${this.commit.parentHashes.join(', ')}`);
        }

        return lines.join('\n');
    }
}

/**
 * Tree item for load more button
 */
export class LoadMoreTreeItem extends vscode.TreeItem {
    constructor() {
        super('Load More Commits...', vscode.TreeItemCollapsibleState.None);
        this.contextValue = 'loadMore';
        this.iconPath = new vscode.ThemeIcon('fold-down');
        this.command = {
            command: 'gitmaster.loadMoreRepositoryLog',
            title: 'Load More Commits'
        };
    }
}

/**
 * Provider for repository commit log tree view
 */
export class RepositoryLogProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | null> =
        new vscode.EventEmitter<vscode.TreeItem | undefined | null>();
    readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | null> =
        this._onDidChangeTreeData.event;

    private currentRepoRoot: string | undefined;
    private commitLimit: number = 50;
    private readonly LOAD_MORE_INCREMENT = 50;

    constructor(private gitService: GitService) { }

    /**
     * Set the current repository root
     */
    setRepoRoot(repoRoot: string | undefined): void {
        this.currentRepoRoot = repoRoot;
        this.commitLimit = 50; // Reset commit limit when changing repos
        this.refresh();
    }

    /**
     * Refresh the tree view
     */
    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    /**
     * Load more commits
     */
    loadMore(): void {
        this.commitLimit += this.LOAD_MORE_INCREMENT;
        this.refresh();
    }

    /**
     * Get tree item for display
     */
    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    /**
     * Get children (commits) for the tree view
     */
    async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
        // Repository log only has root level items (no nested structure)
        if (element) {
            return [];
        }

        if (!this.currentRepoRoot) {
            const emptyItem = new RepositoryCommitTreeItem(
                {
                    hash: '',
                    shortHash: '',
                    author: '',
                    date: '',
                    message: 'No repository opened',
                    parentHashes: []
                },
                '',
                vscode.TreeItemCollapsibleState.None
            );
            emptyItem.contextValue = 'empty';
            return [emptyItem];
        }

        try {
            const commits = await this.gitService.getRepositoryLog(this.currentRepoRoot, this.commitLimit);

            if (commits.length === 0) {
                const emptyItem = new RepositoryCommitTreeItem(
                    {
                        hash: '',
                        shortHash: '',
                        author: '',
                        date: '',
                        message: 'No commits found',
                        parentHashes: []
                    },
                    this.currentRepoRoot,
                    vscode.TreeItemCollapsibleState.None
                );
                emptyItem.contextValue = 'empty';
                return [emptyItem];
            }

            const items: vscode.TreeItem[] = commits.map(commit =>
                new RepositoryCommitTreeItem(
                    commit,
                    this.currentRepoRoot!,
                    vscode.TreeItemCollapsibleState.None
                )
            );

            // Add "Load More" button at the bottom if we have commits equal to the limit
            // (suggesting there might be more commits available)
            if (commits.length === this.commitLimit) {
                items.push(new LoadMoreTreeItem());
            }

            return items;
        } catch (error) {
            console.error('Error getting repository log:', error);
            return [];
        }
    }
}

