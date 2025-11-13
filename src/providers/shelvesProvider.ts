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
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(stash.message, collapsibleState);

        this.tooltip = this.createTooltip();
        this.description = `${stash.fileCount} file${stash.fileCount !== 1 ? 's' : ''}`;
        this.contextValue = 'stash';
        this.iconPath = new vscode.ThemeIcon('archive');
    }

    private createTooltip(): string {
        return `${this.stash.message}\nBranch: ${this.stash.branch}\nFiles: ${this.stash.fileCount}\nStash: ${this.stash.index}`;
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
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(file.path, collapsibleState);

        this.tooltip = `${file.path}\n+${file.additions} -${file.deletions}`;
        this.description = `+${file.additions} -${file.deletions}`;
        this.contextValue = 'stashFile';
        this.iconPath = new vscode.ThemeIcon('file');

        // Set command to show diff when clicked
        this.command = {
            command: 'gitmaster.showStashFileDiff',
            title: 'Show Stash File Diff',
            arguments: [this.file, this.stashIndex, this.repoRoot]
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

                return stashes.map(stash =>
                    new StashTreeItem(
                        stash,
                        this.currentRepoRoot!,
                        vscode.TreeItemCollapsibleState.Collapsed
                    )
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
                    element.repoRoot
                );
                return files.map(file =>
                    new StashFileTreeItem(
                        file,
                        element.stash.index,
                        element.repoRoot,
                        vscode.TreeItemCollapsibleState.None
                    )
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

