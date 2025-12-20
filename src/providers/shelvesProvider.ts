import * as vscode from 'vscode';
import { GitService } from '../services/gitService';
import { StashInfo, ChangedFile } from '../types/git';

/**
 * Tree item for a stash (shelf)
 */
export class StashTreeItem extends vscode.TreeItem {
    constructor(
        public readonly stash: StashInfo,
        public readonly repoRoot: string,
        public readonly isPinned: boolean,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    ) {
        super(stash.message, collapsibleState);

        this.tooltip = this.createTooltip();
        this.description = this.createDescription();

        // Set context value based on state
        if (this.stash.hasConflicts) {
            this.contextValue = this.isPinned ? 'stashPinnedConflict' : 'stashConflict';
        } else {
            this.contextValue = this.isPinned ? 'stashPinned' : 'stash';
        }

        this.iconPath = this.getIcon();
    }

    private createDescription(): string {
        const parts: string[] = [];

        // Add conflict warning if present
        if (this.stash.hasConflicts && this.stash.conflictingFiles && this.stash.conflictingFiles.length > 0) {
            parts.push(`⚠️ ${this.stash.conflictingFiles.length} conflict${this.stash.conflictingFiles.length !== 1 ? 's' : ''}`);
        }

        // Add line stats
        if (this.stash.additions > 0 || this.stash.deletions > 0) {
            parts.push(`+${this.stash.additions} -${this.stash.deletions}`);
        }

        // Add file count
        parts.push(`${this.stash.fileCount} file${this.stash.fileCount !== 1 ? 's' : ''}`);

        // Add relative time
        if (this.stash.relativeTime) {
            parts.push(this.stash.relativeTime);
        }

        return parts.join(' • ');
    }

    private createTooltip(): string {
        let tooltip = `${this.stash.message}\n+${this.stash.additions} -${this.stash.deletions}`;

        if (this.stash.hasConflicts && this.stash.conflictingFiles && this.stash.conflictingFiles.length > 0) {
            tooltip += `\n\n⚠️  ${this.stash.conflictingFiles.length} conflicting file(s):\n`;
            const displayFiles = this.stash.conflictingFiles.slice(0, 5);
            tooltip += displayFiles.map(f => `  • ${f}`).join('\n');
            if (this.stash.conflictingFiles.length > 5) {
                tooltip += `\n  ... and ${this.stash.conflictingFiles.length - 5} more`;
            }
        }

        return tooltip;
    }

    private getIcon(): vscode.ThemeIcon {
        // Conflict warning takes highest priority
        if (this.stash.hasConflicts) {
            return new vscode.ThemeIcon('warning', new vscode.ThemeColor('editorWarning.foreground'));
        }

        // Pinned shelves always show pinned icon
        if (this.isPinned) {
            return new vscode.ThemeIcon('pinned', new vscode.ThemeColor('charts.blue'));
        }

        if (!this.stash.timestamp) {
            return new vscode.ThemeIcon('archive');
        }

        try {
            const stashDate = new Date(this.stash.timestamp);
            const now = new Date();
            const ageInHours = (now.getTime() - stashDate.getTime()) / (1000 * 60 * 60);
            const ageInDays = ageInHours / 24;

            // Fresh shelf (< 24 hours)
            if (ageInHours < 24) {
                return new vscode.ThemeIcon('inbox', new vscode.ThemeColor('charts.green'));
            } else if (ageInDays < 7) {
                // Recent shelf (< 7 days)
                return new vscode.ThemeIcon('archive', new vscode.ThemeColor('charts.blue'));
            } else if (ageInDays < 30) {
                // Week-old shelf (< 30 days)
                return new vscode.ThemeIcon('package', new vscode.ThemeColor('charts.yellow'));
            } else {
                // Old shelf (>= 30 days)
                return new vscode.ThemeIcon('archive', new vscode.ThemeColor('charts.orange'));
            }
        } catch (error) {
            return new vscode.ThemeIcon('archive');
        }
    }
}

/**
 * Tree item for a file in a stash
 */
export class StashFileTreeItem extends vscode.TreeItem {
    constructor(
        public readonly file: ChangedFile,
        public readonly stashIndex: string,
        public readonly repoRoot: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    ) {
        super(file.path, collapsibleState);

        this.description = `+${file.additions} -${file.deletions}`;
        this.contextValue = 'stashFile';
        this.iconPath = new vscode.ThemeIcon('file');

        // Set command to show diff when clicked
        this.command = {
            command: 'gitmaster.showStashFileDiff',
            title: 'Show Stash File Diff',
            arguments: [this.file, this.stashIndex, this.repoRoot],
        };
    }
}

/**
 * Provider for the Shelves (Stashes) tree view
 */
export class ShelvesProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | null | void> =
        new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | null | void> =
        this._onDidChangeTreeData.event;

    private currentRepoRoot: string | undefined;
    private readonly pinnedShelvesKey = 'gitmaster.pinnedShelves';

    constructor(
        private gitService: GitService,
        private context: vscode.ExtensionContext,
    ) { }

    /**
     * Get pinned shelves for current repo
     */
    private getPinnedShelves(): Set<string> {
        if (!this.currentRepoRoot) {
            return new Set();
        }
        const allPinned = this.context.workspaceState.get<Record<string, string[]>>(this.pinnedShelvesKey, {});
        return new Set(allPinned[this.currentRepoRoot] || []);
    }

    /**
     * Save pinned shelves for current repo
     */
    private async savePinnedShelves(pinnedShelves: Set<string>): Promise<void> {
        if (!this.currentRepoRoot) {
            return;
        }
        const allPinned = this.context.workspaceState.get<Record<string, string[]>>(this.pinnedShelvesKey, {});
        allPinned[this.currentRepoRoot] = Array.from(pinnedShelves);
        await this.context.workspaceState.update(this.pinnedShelvesKey, allPinned);
    }

    /**
     * Pin a shelf by its index
     */
    async pinShelf(shelfIndex: string): Promise<void> {
        const pinned = this.getPinnedShelves();
        pinned.add(shelfIndex);
        await this.savePinnedShelves(pinned);
        this.refresh();
    }

    /**
     * Unpin a shelf by its index
     */
    async unpinShelf(shelfIndex: string): Promise<void> {
        const pinned = this.getPinnedShelves();
        pinned.delete(shelfIndex);
        await this.savePinnedShelves(pinned);
        this.refresh();
    }

    /**
     * Check if a shelf is pinned
     */
    isShelfPinned(shelfIndex: string): boolean {
        return this.getPinnedShelves().has(shelfIndex);
    }

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

        // Root level - show stashes
        if (!element) {
            try {
                const stashes = await this.gitService.getStashes(this.currentRepoRoot);

                if (stashes.length === 0) {
                    const emptyItem = new vscode.TreeItem('No shelves available');
                    emptyItem.description = 'Click + to create a shelf';
                    emptyItem.contextValue = 'empty';
                    return [emptyItem];
                }

                // Check for conflicts in parallel
                const conflictChecks = stashes.map(async (stash) => {
                    const conflicts = await this.gitService.checkStashConflicts(stash.index, this.currentRepoRoot!);
                    stash.hasConflicts = conflicts.length > 0;
                    stash.conflictingFiles = conflicts;
                    return stash;
                });

                const stashesWithConflicts = await Promise.all(conflictChecks);

                // Get pinned shelves
                const pinnedShelves = this.getPinnedShelves();

                // Sort stashes: pinned first, then by age (newest first)
                const sortedStashes = stashesWithConflicts.sort((a, b) => {
                    const aIsPinned = pinnedShelves.has(a.index);
                    const bIsPinned = pinnedShelves.has(b.index);

                    // Pinned shelves come first
                    if (aIsPinned && !bIsPinned) { return -1; }
                    if (!aIsPinned && bIsPinned) { return 1; }

                    // Otherwise keep git's order (newest first by default)
                    return 0;
                });

                return sortedStashes.map(stash =>
                    new StashTreeItem(
                        stash,
                        this.currentRepoRoot!,
                        pinnedShelves.has(stash.index),
                        vscode.TreeItemCollapsibleState.Collapsed,
                    ),
                );
            } catch (error) {
                console.error('Error getting stashes:', error);
                return [];
            }
        }

        // Stash level - show files
        if (element instanceof StashTreeItem) {
            try {
                const files = await this.gitService.getStashFiles(
                    element.stash.index,
                    element.repoRoot,
                );
                return files.map(file =>
                    new StashFileTreeItem(
                        file,
                        element.stash.index,
                        element.repoRoot,
                        vscode.TreeItemCollapsibleState.None,
                    ),
                );
            } catch (error) {
                console.error('Error getting stash files:', error);
                return [];
            }
        }

        return [];
    }

    setRepoRoot(repoRoot: string | undefined): void {
        this.currentRepoRoot = repoRoot;
        this.refresh();
    }

    getRepoRoot(): string | undefined {
        return this.currentRepoRoot;
    }
}
