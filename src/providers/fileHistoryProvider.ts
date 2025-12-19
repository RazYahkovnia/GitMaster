import * as vscode from 'vscode';
import { GitService } from '../services/gitService';
import { CommitInfo } from '../types/git';
import { getAuthorColor } from '../utils/colorUtils';
import { MessageFilter } from '../utils/filterUtils';
import { FileExpertsView } from '../views/fileExpertsView';

export class CommitTreeItem extends vscode.TreeItem {
    constructor(
        public readonly commit: CommitInfo,
        public readonly filePath: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(commit.message, collapsibleState);

        this.tooltip = this.createTooltip();
        this.description = `${commit.shortHash} • ${commit.relativeDate}`;
        this.contextValue = 'commit';

        // Use author-specific color
        const authorColor = getAuthorColor(commit.author);
        this.iconPath = new vscode.ThemeIcon('git-commit', authorColor);

        // Set the command to execute when the item is clicked
        this.command = {
            command: 'gitmaster.showCommitDiff',
            title: 'Show Commit Diff',
            arguments: [this.commit, this.filePath]
        };
    }

    private createTooltip(): vscode.MarkdownString {
        const tooltip = new vscode.MarkdownString();
        tooltip.appendMarkdown(`**${this.commit.message}**\n\n`);
        tooltip.appendMarkdown(`---\n\n`);
        tooltip.appendMarkdown(`**Commit:** ${this.commit.hash}\n\n`);
        tooltip.appendMarkdown(`**Author:** ${this.commit.author}\n\n`);
        tooltip.appendMarkdown(`**Date:** ${this.commit.date}\n\n`);
        tooltip.appendMarkdown(`**Relative:** ${this.commit.relativeDate}\n\n`);
        return tooltip;
    }
}

export class FileHistoryProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | null | void> =
        new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | null | void> =
        this._onDidChangeTreeData.event;

    private currentFilePath: string | undefined;
    private messageFilter = new MessageFilter();
    private fileExpertsView: FileExpertsView;

    constructor(
        private gitService: GitService,
        private context: vscode.ExtensionContext
    ) {
        this.fileExpertsView = new FileExpertsView(context, gitService);
    }

    refresh(filePath?: string): void {
        if (filePath) {
            this.currentFilePath = filePath;
        }
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
        // Only show top-level items (commits), no children
        if (element) {
            return [];
        }

        if (!this.currentFilePath) {
            const emptyItem = new vscode.TreeItem('Open a file to view its history');
            emptyItem.contextValue = 'empty';
            emptyItem.iconPath = new vscode.ThemeIcon('info');
            return [emptyItem];
        }

        try {
            // Check if the file is tracked by git
            const isTracked = await this.gitService.isFileTracked(this.currentFilePath);
            if (!isTracked) {
                const emptyItem = new vscode.TreeItem('File is not tracked by Git');
                emptyItem.contextValue = 'empty';
                emptyItem.iconPath = new vscode.ThemeIcon('warning');
                return [emptyItem];
            }

            // Get commit history for the current file (with filter applied at git level)
            const commits = await this.gitService.getFileHistory(
                this.currentFilePath,
                this.messageFilter.getFilter()
            );

            if (commits.length === 0) {
                const message = this.messageFilter.getNoResultsMessage('No commits found for this file');
                const emptyItem = new vscode.TreeItem(message);
                emptyItem.contextValue = 'empty';
                emptyItem.iconPath = new vscode.ThemeIcon('info');
                return [emptyItem];
            }

            // Convert commits to tree items
            return commits.map(commit =>
                new CommitTreeItem(
                    commit,
                    this.currentFilePath!,
                    vscode.TreeItemCollapsibleState.None
                )
            );
        } catch (error) {
            const errorItem = new vscode.TreeItem('Failed to load file history');
            errorItem.contextValue = 'empty';
            errorItem.iconPath = new vscode.ThemeIcon('error');
            return [errorItem];
        }
    }

    setCurrentFile(filePath: string | undefined): void {
        this.currentFilePath = filePath;
        this.messageFilter.clear(); // Reset filter when file changes
        this.refresh();
    }

    getCurrentFile(): string | undefined {
        return this.currentFilePath;
    }

    /**
     * Set commit message filter
     */
    async setMessageFilter(): Promise<void> {
        const result = await this.messageFilter.promptForFilter(this.messageFilter.getFilter());
        if (result !== undefined) {
            this.refresh();
        }
    }

    /**
     * Clear commit message filter
     */
    clearMessageFilter(): void {
        this.messageFilter.clear();
        this.refresh();
    }

    /**
     * Check if filter is active
     */
    hasFilter(): boolean {
        return this.messageFilter.isActive();
    }

    /**
     * Show top contributors/experts for the current file
     */
    async showFileExperts(): Promise<void> {
        if (!this.currentFilePath) {
            vscode.window.showInformationMessage('No file is currently open in the history view');
            return;
        }

        try {
            await this.fileExpertsView.show(this.currentFilePath);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to get file experts: ${error}`);
            console.error('Error showing file experts:', error);
        }
    }
}

