import * as vscode from 'vscode';
import { GitService, CommitInfo } from './gitService';

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
        this.iconPath = new vscode.ThemeIcon('git-commit');

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

export class FileHistoryProvider implements vscode.TreeDataProvider<CommitTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<CommitTreeItem | undefined | null | void> =
        new vscode.EventEmitter<CommitTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<CommitTreeItem | undefined | null | void> =
        this._onDidChangeTreeData.event;

    private gitService: GitService;
    private currentFilePath: string | undefined;

    constructor() {
        this.gitService = new GitService();
    }

    refresh(filePath?: string): void {
        if (filePath) {
            this.currentFilePath = filePath;
        }
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: CommitTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: CommitTreeItem): Promise<CommitTreeItem[]> {
        // Only show top-level items (commits), no children
        if (element) {
            return [];
        }

        if (!this.currentFilePath) {
            return [];
        }

        try {
            // Check if the file is tracked by git
            const isTracked = await this.gitService.isFileTracked(this.currentFilePath);
            if (!isTracked) {
                return [];
            }

            // Get commit history for the current file
            const commits = await this.gitService.getFileHistory(this.currentFilePath);

            if (commits.length === 0) {
                return [];
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
            console.error('Error getting file history:', error);
            return [];
        }
    }

    setCurrentFile(filePath: string | undefined): void {
        this.currentFilePath = filePath;
        this.refresh();
    }

    getCurrentFile(): string | undefined {
        return this.currentFilePath;
    }
}

