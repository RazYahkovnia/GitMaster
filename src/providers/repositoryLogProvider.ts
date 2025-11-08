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
 * Provider for repository commit log tree view
 */
export class RepositoryLogProvider implements vscode.TreeDataProvider<RepositoryCommitTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<RepositoryCommitTreeItem | undefined | null> = 
        new vscode.EventEmitter<RepositoryCommitTreeItem | undefined | null>();
    readonly onDidChangeTreeData: vscode.Event<RepositoryCommitTreeItem | undefined | null> = 
        this._onDidChangeTreeData.event;

    private currentRepoRoot: string | undefined;

    constructor(private gitService: GitService = new GitService()) {}

    /**
     * Set the current repository root
     */
    setRepoRoot(repoRoot: string | undefined): void {
        this.currentRepoRoot = repoRoot;
        this.refresh();
    }

    /**
     * Refresh the tree view
     */
    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    /**
     * Get tree item for display
     */
    getTreeItem(element: RepositoryCommitTreeItem): vscode.TreeItem {
        return element;
    }

    /**
     * Get children (commits) for the tree view
     */
    async getChildren(element?: RepositoryCommitTreeItem): Promise<RepositoryCommitTreeItem[]> {
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
            const commits = await this.gitService.getRepositoryLog(this.currentRepoRoot, 20);

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

            return commits.map(commit => 
                new RepositoryCommitTreeItem(
                    commit, 
                    this.currentRepoRoot!, 
                    vscode.TreeItemCollapsibleState.None
                )
            );
        } catch (error) {
            console.error('Error getting repository log:', error);
            return [];
        }
    }
}

