import * as vscode from 'vscode';
import { GitService } from '../services/gitService';
import { BranchInfo } from '../types/git';
import { getAuthorColor } from '../utils/colorUtils';
import { DateSeparatorTreeItem } from './shared/dateSeparatorTreeItem';
import { groupItemsByDate, getDateGroupLabel } from '../utils/dateGrouping';

/**
 * Tree item for a branch
 */
export class BranchTreeItem extends vscode.TreeItem {
    constructor(
        public readonly branch: BranchInfo,
        public readonly repoRoot: string,
        public readonly isPinned: boolean,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    ) {
        super(branch.name, collapsibleState);

        this.description = this.buildDescription();
        this.tooltip = this.buildTooltip();

        // Set context value based on state
        let contextValue = this.branch.isCurrent ? 'currentBranch' : (this.branch.isRemote ? 'remoteBranch' : 'localBranch');
        if (this.isPinned) {
            contextValue += 'Pinned';
        }
        this.contextValue = contextValue;

        // Use author-specific color for the icon
        const authorColor = getAuthorColor(this.branch.lastCommitAuthor);

        if (this.isPinned) {
            this.iconPath = new vscode.ThemeIcon('pinned', authorColor);
        } else if (this.branch.isCurrent) {
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
            this.branch.lastCommitDate,
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
            `Date: ${this.branch.lastCommitDate}`,
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
    private readonly pinnedBranchesKey = 'gitmaster.pinnedBranches';
    private groupByDate: boolean = false;

    constructor(
        private gitService: GitService,
        private context: vscode.ExtensionContext,
    ) { }

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
     * Get pinned branches for current repo
     */
    private getPinnedBranches(): Set<string> {
        if (!this.currentRepoRoot) {
            return new Set();
        }
        const allPinned = this.context.workspaceState.get<Record<string, string[]>>(this.pinnedBranchesKey, {});
        return new Set(allPinned[this.currentRepoRoot] || []);
    }

    /**
     * Save pinned branches for current repo
     */
    private async savePinnedBranches(pinnedBranches: Set<string>): Promise<void> {
        if (!this.currentRepoRoot) {
            return;
        }
        const allPinned = this.context.workspaceState.get<Record<string, string[]>>(this.pinnedBranchesKey, {});
        allPinned[this.currentRepoRoot] = Array.from(pinnedBranches);
        await this.context.workspaceState.update(this.pinnedBranchesKey, allPinned);
    }

    /**
     * Pin a branch
     */
    async pinBranch(branchName: string): Promise<void> {
        const pinned = this.getPinnedBranches();
        pinned.add(branchName);
        await this.savePinnedBranches(pinned);
        this.refresh();
    }

    /**
     * Unpin a branch
     */
    async unpinBranch(branchName: string): Promise<void> {
        const pinned = this.getPinnedBranches();
        pinned.delete(branchName);
        await this.savePinnedBranches(pinned);
        this.refresh();

    }

    /**
     * Check if a branch is pinned
     */
    isBranchPinned(branchName: string): boolean {
        return this.getPinnedBranches().has(branchName);
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
        if (!this.currentRepoRoot) {
            const emptyItem = new vscode.TreeItem('No repository opened');
            emptyItem.contextValue = 'empty';
            emptyItem.iconPath = new vscode.ThemeIcon('info');
            return [emptyItem];
        }

        try {
            // Branches view is intentionally local-only (no `origin/*` remote-tracking branches).
            let branches = await this.gitService.getLocalBranches(this.currentRepoRoot, 50);

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

            // Get pinned branches
            const pinnedBranches = this.getPinnedBranches();

            // If element is provided and grouping is enabled, return branches for that date group
            if (element && element instanceof DateSeparatorTreeItem && this.groupByDate) {
                const dateLabel = element.label as string;
                const groupBranches = this.getBranchesForDateGroup(branches, pinnedBranches, dateLabel);
                return groupBranches.map(branch =>
                    new BranchTreeItem(
                        branch,
                        this.currentRepoRoot!,
                        pinnedBranches.has(branch.name),
                        vscode.TreeItemCollapsibleState.None,
                    ),
                );
            }

            // Root level
            if (!element) {
                if (this.groupByDate) {
                    return this.createGroupedView(branches, pinnedBranches);
                }
                return this.createFlatView(branches, pinnedBranches);
            }

            return [];
        } catch (error) {
            console.error('Error getting branches:', error);
            const errorItem = new vscode.TreeItem('Failed to load branches');
            errorItem.contextValue = 'empty';
            errorItem.iconPath = new vscode.ThemeIcon('error');
            return [errorItem];
        }
    }

    private createFlatView(branches: BranchInfo[], pinnedBranches: Set<string>): vscode.TreeItem[] {
        // Sort branches: pinned first, then by current, then alphabetically
        const sortedBranches = branches.sort((a, b) => {
            const aIsPinned = pinnedBranches.has(a.name);
            const bIsPinned = pinnedBranches.has(b.name);

            // Pinned branches come first
            if (aIsPinned && !bIsPinned) { return -1; }
            if (!aIsPinned && bIsPinned) { return 1; }

            // Current branch comes next
            if (a.isCurrent && !b.isCurrent) { return -1; }
            if (!a.isCurrent && b.isCurrent) { return 1; }

            // Otherwise alphabetically
            return a.name.localeCompare(b.name);
        });

        return sortedBranches.map(branch =>
            new BranchTreeItem(
                branch,
                this.currentRepoRoot!,
                pinnedBranches.has(branch.name),
                vscode.TreeItemCollapsibleState.None,
            ),
        );
    }

    private createGroupedView(branches: BranchInfo[], pinnedBranches: Set<string>): vscode.TreeItem[] {
        const items: vscode.TreeItem[] = [];

        // Keep pinned branches always visible at the top (not duplicated inside groups)
        const pinned = branches
            .filter(b => pinnedBranches.has(b.name))
            .sort((a, b) => {
                if (a.isCurrent && !b.isCurrent) { return -1; }
                if (!a.isCurrent && b.isCurrent) { return 1; }
                return a.name.localeCompare(b.name);
            });

        items.push(...pinned.map(branch =>
            new BranchTreeItem(
                branch,
                this.currentRepoRoot!,
                true,
                vscode.TreeItemCollapsibleState.None,
            ),
        ));

        const unpinned = branches.filter(b => !pinnedBranches.has(b.name));
        const groups = groupItemsByDate(unpinned, b => new Date(b.lastCommitTimestamp), new Date());

        for (const [label, groupBranches] of groups) {
            const separator = new DateSeparatorTreeItem(label);
            separator.description = `${groupBranches.length} branch${groupBranches.length !== 1 ? 'es' : ''}`;
            items.push(separator);
        }

        return items;
    }

    private getBranchesForDateGroup(branches: BranchInfo[], pinnedBranches: Set<string>, dateLabel: string): BranchInfo[] {
        const now = new Date();
        return branches
            .filter(b => !pinnedBranches.has(b.name))
            .filter(b => getDateGroupLabel(new Date(b.lastCommitTimestamp), now) === dateLabel)
            .sort((a, b) => {
                if (a.isCurrent && !b.isCurrent) { return -1; }
                if (!a.isCurrent && b.isCurrent) { return 1; }
                return a.name.localeCompare(b.name);
            });
    }

    /**
     * Toggle grouping by date
     */
    toggleGroupByDate(): void {
        this.groupByDate = !this.groupByDate;
        this.refresh();
    }

    /**
     * Get current grouping state
     */
    isGroupedByDate(): boolean {
        return this.groupByDate;
    }
}
