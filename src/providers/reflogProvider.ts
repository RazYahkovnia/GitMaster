import * as vscode from 'vscode';
import { GitService } from '../services/gitService';
import { ReflogEntry } from '../types/git';

/**
 * Tree item for a date separator in grouped view
 */
export class DateSeparatorTreeItem extends vscode.TreeItem {
    constructor(label: string) {
        super(label, vscode.TreeItemCollapsibleState.Expanded);
        this.contextValue = 'dateSeparator';
        this.iconPath = new vscode.ThemeIcon('calendar');
    }
}

/**
 * Tree item for a reflog entry (git operation)
 */
export class ReflogTreeItem extends vscode.TreeItem {
    constructor(
        public readonly entry: ReflogEntry,
        public readonly repoRoot: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    ) {
        super(entry.message, collapsibleState);

        this.tooltip = this.createTooltip();
        this.description = `${entry.shortHash} • ${entry.relativeTime}`;
        this.contextValue = 'reflogEntry';
        this.iconPath = this.getIcon();

        // Set command to show commit details when clicked
        this.command = {
            command: 'gitmaster.showReflogCommitDetails',
            title: 'Show Commit Details',
            arguments: [this.entry, this.repoRoot],
        };
    }

    private createTooltip(): string {
        return `${this.entry.message}\nCommit: ${this.entry.hash}\nSelector: ${this.entry.selector}\nTime: ${this.entry.relativeTime}`;
    }

    private getIcon(): vscode.ThemeIcon {
        const isDangerous = this.isDangerousOperation();

        // Different icons for different operations
        let icon: string;
        let color: vscode.ThemeColor | undefined;

        switch (this.entry.action) {
            case 'commit':
                icon = 'git-commit';
                break;
            case 'checkout':
                icon = 'git-branch';
                break;
            case 'pull':
                icon = 'cloud-download';
                break;
            case 'merge':
                icon = 'git-merge';
                break;
            case 'rebase':
                icon = 'versions';
                break;
            case 'reset':
                icon = 'discard';
                color = new vscode.ThemeColor('errorForeground');
                break;
            case 'cherry-pick':
                icon = 'git-pull-request';
                break;
            default:
                icon = 'history';
        }

        // Highlight dangerous operations in red
        if (isDangerous && !color) {
            color = new vscode.ThemeColor('errorForeground');
        }

        return new vscode.ThemeIcon(icon, color);
    }

    private isDangerousOperation(): boolean {
        const dangerousPatterns = [
            /reset.*--hard/i,
            /push.*--force/i,
            /push.*-f\b/i,
            /rebase.*--force/i,
        ];

        return dangerousPatterns.some(pattern => pattern.test(this.entry.message));
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
            title: 'Load More Operations',
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
    private groupByDate: boolean = false;

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

        try {
            const entries = await this.gitService.getReflog(this.currentRepoRoot, this.entryLimit);

            if (entries.length === 0) {
                const emptyItem = new vscode.TreeItem('No git operations found');
                emptyItem.contextValue = 'empty';
                return [emptyItem];
            }

            // If element is provided and grouping is enabled, return entries for that date group
            if (element && element instanceof DateSeparatorTreeItem && this.groupByDate) {
                const dateLabel = element.label as string;
                const groupEntries = this.getEntriesForDateGroup(entries, dateLabel);
                return groupEntries.map(entry =>
                    new ReflogTreeItem(
                        entry,
                        this.currentRepoRoot!,
                        vscode.TreeItemCollapsibleState.None,
                    ),
                );
            }

            // Root level - either show grouped by date or flat list
            if (!element) {
                if (this.groupByDate) {
                    return this.createGroupedView(entries);
                } else {
                    return this.createFlatView(entries);
                }
            }

            return [];
        } catch (error) {
            console.error('Error getting reflog:', error);
            return [];
        }
    }

    private createFlatView(entries: ReflogEntry[]): vscode.TreeItem[] {
        const items: vscode.TreeItem[] = entries.map(entry =>
            new ReflogTreeItem(
                entry,
                this.currentRepoRoot!,
                vscode.TreeItemCollapsibleState.None,
            ),
        );

        // Add "Load More" button at the bottom if we have entries equal to the limit
        if (entries.length === this.entryLimit) {
            items.push(new LoadMoreReflogTreeItem());
        }

        return items;
    }

    private createGroupedView(entries: ReflogEntry[]): vscode.TreeItem[] {
        const groups = this.groupEntriesByDate(entries);
        const items: vscode.TreeItem[] = [];

        // Add date separators with count badges
        for (const [label, groupEntries] of groups) {
            const separator = new DateSeparatorTreeItem(label);
            separator.description = `${groupEntries.length} operation${groupEntries.length !== 1 ? 's' : ''}`;
            items.push(separator);
        }

        // Add "Load More" button at the bottom if we have entries equal to the limit
        if (entries.length === this.entryLimit) {
            items.push(new LoadMoreReflogTreeItem());
        }

        return items;
    }

    private groupEntriesByDate(entries: ReflogEntry[]): Map<string, ReflogEntry[]> {
        const groups = new Map<string, ReflogEntry[]>();
        const now = new Date();

        for (const entry of entries) {
            const entryDate = new Date(entry.timestamp);
            const label = this.getDateLabel(entryDate, now);

            if (!groups.has(label)) {
                groups.set(label, []);
            }
            groups.get(label)!.push(entry);
        }

        return groups;
    }

    private getEntriesForDateGroup(entries: ReflogEntry[], dateLabel: string): ReflogEntry[] {
        const now = new Date();
        return entries.filter(entry => {
            const entryDate = new Date(entry.timestamp);
            return this.getDateLabel(entryDate, now) === dateLabel;
        });
    }

    private getDateLabel(date: Date, now: Date): string {
        const diffMs = now.getTime() - date.getTime();
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

        if (diffDays === 0) {
            return 'Today';
        } else if (diffDays === 1) {
            return 'Yesterday';
        } else if (diffDays < 7) {
            return 'Last Week';
        } else if (diffDays < 30) {
            return 'Last Month';
        } else if (diffDays < 90) {
            return 'Last 3 Months';
        } else if (diffDays < 180) {
            return 'Last 6 Months';
        } else {
            return 'Older';
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

    getRepoRoot(): string | undefined {
        return this.currentRepoRoot;
    }
}
