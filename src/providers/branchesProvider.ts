import * as vscode from 'vscode';
import { GitService } from '../services/gitService';
import { BranchInfo } from '../types/git';
import { getAuthorColor } from '../utils/colorUtils';

/**
 * Tree item for a branch
 */
export class BranchTreeItem extends vscode.TreeItem {
    constructor(
        public readonly branch: BranchInfo,
        public readonly repoRoot: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(branch.name, collapsibleState);

        this.description = this.buildDescription();
        this.tooltip = this.buildTooltip();
        this.contextValue = this.branch.isCurrent ? 'currentBranch' : (this.branch.isRemote ? 'remoteBranch' : 'localBranch');

        // Use author-specific color for the icon
        const authorColor = getAuthorColor(this.branch.lastCommitAuthor);

        if (this.branch.isCurrent) {
            this.iconPath = new vscode.ThemeIcon('check', authorColor);
        } else if (this.branch.isRemote) {
            this.iconPath = new vscode.ThemeIcon('cloud', authorColor);
        } else {
            this.iconPath = new vscode.ThemeIcon('git-branch', authorColor);
        }
    }

    private buildDescription(): string {
        const parts = [
            this.branch.shortCommitHash,
            this.branch.lastCommitDate
        ];

        if (this.branch.isCurrent) {
            parts.unshift('current');
        }

        return parts.join(' • ');
    }

    private buildTooltip(): string {
        const lines = [
            `Branch: ${this.branch.name}`,
            `Commit: ${this.branch.commitHash}`,
            `Last Commit: ${this.branch.lastCommitMessage}`,
            `Author: ${this.branch.lastCommitAuthor}`,
            `Date: ${this.branch.lastCommitDate}`
        ];

        if (this.branch.upstream) {
            lines.push(`Tracking: ${this.branch.upstream}`);
        }

        if (this.branch.isCurrent) {
            lines.push('(Current Branch)');
        }

        return lines.join('\n');
    }
}

/**
 * Provider for branches tree view
 */
export class BranchesProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | null> =
        new vscode.EventEmitter<vscode.TreeItem | undefined | null>();
    readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | null> =
        this._onDidChangeTreeData.event;

    private currentRepoRoot: string | undefined;
    private filterAuthor: string | null = null;

    constructor(private gitService: GitService = new GitService()) { }

    /**
     * Set the current repository root
     */
    setRepoRoot(repoRoot: string | undefined): void {
        this.currentRepoRoot = repoRoot;
        this.refresh();
    }

    /**
     * Set author filter
     */
    setAuthorFilter(author: string | null): void {
        this.filterAuthor = author;
        this.refresh();
    }

    /**
     * Get current author filter
     */
    getAuthorFilter(): string | null {
        return this.filterAuthor;
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
     * Get children (branches) for the tree view
     */
    async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
        // Branches view only has root level items (no nested structure)
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
            let branches = await this.gitService.getBranches(this.currentRepoRoot, 50);

            // Apply author filter if set
            if (this.filterAuthor) {
                branches = branches.filter(branch => branch.lastCommitAuthor === this.filterAuthor);
            }

            if (branches.length === 0) {
                const message = this.filterAuthor
                    ? `No branches found for ${this.filterAuthor}`
                    : 'No branches found';
                const emptyItem = new vscode.TreeItem(message);
                emptyItem.contextValue = 'empty';
                emptyItem.iconPath = new vscode.ThemeIcon('info');
                return [emptyItem];
            }

            return branches.map(branch =>
                new BranchTreeItem(
                    branch,
                    this.currentRepoRoot!,
                    vscode.TreeItemCollapsibleState.None
                )
            );
        } catch (error) {
            console.error('Error getting branches:', error);
            const errorItem = new vscode.TreeItem('Failed to load branches');
            errorItem.contextValue = 'empty';
            errorItem.iconPath = new vscode.ThemeIcon('error');
            return [errorItem];
        }
    }
}

