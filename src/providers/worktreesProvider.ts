import * as vscode from 'vscode';
import * as path from 'path';
import { GitService } from '../services/gitService';
import { GitWorktree } from '../types/git';

/**
 * Tree item for a worktree
 */
export class WorktreeTreeItem extends vscode.TreeItem {
    constructor(
        public readonly worktree: GitWorktree,
        public readonly repoRoot: string,
    ) {
        super(path.basename(worktree.path), vscode.TreeItemCollapsibleState.None);

        this.description = this.buildDescription();
        this.tooltip = this.buildTooltip();
        this.resourceUri = vscode.Uri.file(worktree.path);

        // Set context value
        if (this.worktree.isCurrent) {
            this.contextValue = 'worktreeCurrent';
        } else if (this.worktree.isMain) {
            this.contextValue = 'worktreeMain';
        } else {
            this.contextValue = 'worktreeLinked';
        }

        // Set icon
        if (this.worktree.isCurrent) {
            this.iconPath = new vscode.ThemeIcon('check');
        } else if (this.worktree.isMain) {
            this.iconPath = new vscode.ThemeIcon('home');
        } else {
            this.iconPath = new vscode.ThemeIcon('folder');
        }

        // Add command to open worktree on click
        this.command = {
            command: 'gitmaster.openWorktree',
            title: 'Open Worktree',
            arguments: [this],
        };
    }

    private buildDescription(): string {
        const parts = [this.worktree.branch];

        if (this.worktree.isMain) {
            parts.push('(main)');
        }

        return parts.join(' ');
    }

    private buildTooltip(): string {
        const lines = [
            `Path: ${this.worktree.path}`,
            `Branch: ${this.worktree.branch}`,
            `HEAD: ${this.worktree.head}`,
        ];

        if (this.worktree.isMain) {
            lines.push('Main Worktree');
        }

        if (this.worktree.isCurrent) {
            lines.push('Current Worktree');
        }

        return lines.join('\n');
    }
}

/**
 * Provider for worktrees tree view
 */
export class WorktreesProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | null> =
        new vscode.EventEmitter<vscode.TreeItem | undefined | null>();
    readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | null> =
        this._onDidChangeTreeData.event;

    private currentRepoRoot: string | undefined;

    constructor(
        private gitService: GitService,
    ) { }

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
    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    /**
     * Get children (worktrees) for the tree view
     */
    async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
        if (element) {
            return [];
        }

        if (!this.currentRepoRoot) {
            const emptyItem = new vscode.TreeItem('No repository opened');
            emptyItem.contextValue = 'empty';
            emptyItem.iconPath = new vscode.ThemeIcon('info');
            return [emptyItem];
        }

        try {
            const worktrees = await this.gitService.getWorktrees(this.currentRepoRoot);

            if (worktrees.length === 0) {
                const emptyItem = new vscode.TreeItem('No worktrees found');
                emptyItem.contextValue = 'empty';
                emptyItem.iconPath = new vscode.ThemeIcon('info');
                return [emptyItem];
            }

            return worktrees.map((wt: GitWorktree) => new WorktreeTreeItem(wt, this.currentRepoRoot!));
        } catch (error) {
            console.error('Error getting worktrees:', error);
            const errorItem = new vscode.TreeItem('Failed to load worktrees');
            errorItem.contextValue = 'empty';
            errorItem.iconPath = new vscode.ThemeIcon('error');
            return [errorItem];
        }
    }
}
