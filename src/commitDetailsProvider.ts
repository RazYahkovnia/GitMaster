import * as vscode from 'vscode';
import { GitService, CommitInfo, ChangedFile } from './gitService';

export class CommitFileTreeItem extends vscode.TreeItem {
    constructor(
        public readonly file: ChangedFile,
        public readonly commit: CommitInfo,
        public readonly repoRoot: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(file.path, collapsibleState);

        this.tooltip = this.createTooltip();
        this.description = this.getStatusDescription();
        this.contextValue = 'commitFile';
        this.iconPath = this.getIcon();

        // Set the command to execute when the item is clicked
        this.command = {
            command: 'gitmaster.showFileDiff',
            title: 'Show File Diff',
            arguments: [this.file.path, this.commit, this.repoRoot]
        };
    }

    private createTooltip(): string {
        return `${this.file.path}\n${this.file.status}: +${this.file.additions} -${this.file.deletions}`;
    }

    private getStatusDescription(): string {
        return `+${this.file.additions} -${this.file.deletions}`;
    }

    private getIcon(): vscode.ThemeIcon {
        switch (this.file.status) {
            case 'A':
                return new vscode.ThemeIcon('diff-added', new vscode.ThemeColor('gitDecoration.addedResourceForeground'));
            case 'M':
                return new vscode.ThemeIcon('diff-modified', new vscode.ThemeColor('gitDecoration.modifiedResourceForeground'));
            case 'D':
                return new vscode.ThemeIcon('diff-removed', new vscode.ThemeColor('gitDecoration.deletedResourceForeground'));
            default:
                return new vscode.ThemeIcon('file');
        }
    }
}

export class CommitInfoTreeItem extends vscode.TreeItem {
    constructor(
        label: string,
        description: string
    ) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.description = description;
        this.contextValue = 'commitInfo';
        this.iconPath = new vscode.ThemeIcon('info');
    }
}

export class CommitDetailsProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | null | void> =
        new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | null | void> =
        this._onDidChangeTreeData.event;

    private gitService: GitService;
    private currentCommit: CommitInfo | undefined;
    private currentRepoRoot: string | undefined;
    private changedFiles: ChangedFile[] = [];
    private githubUrl: string | null = null;

    constructor() {
        this.gitService = new GitService();
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
        if (!this.currentCommit || !this.currentRepoRoot) {
            return [];
        }

        // Root level - show commit info and files
        if (!element) {
            const items: vscode.TreeItem[] = [];

            // Add commit info header
            const headerItem = new vscode.TreeItem(
                this.currentCommit.message,
                vscode.TreeItemCollapsibleState.None
            );
            headerItem.description = `${this.currentCommit.shortHash} • ${this.currentCommit.relativeDate}`;
            headerItem.iconPath = new vscode.ThemeIcon('git-commit');
            headerItem.contextValue = 'commitHeader';
            items.push(headerItem);

            // Add author info
            const authorItem = new CommitInfoTreeItem('Author', this.currentCommit.author);
            items.push(authorItem);

            // Add GitHub link if available
            if (this.githubUrl) {
                const githubItem = new vscode.TreeItem('Open in GitHub', vscode.TreeItemCollapsibleState.None);
                githubItem.iconPath = new vscode.ThemeIcon('github');
                githubItem.contextValue = 'githubLink';
                githubItem.command = {
                    command: 'gitmaster.openCommitInGitHub',
                    title: 'Open in GitHub',
                    arguments: [this.githubUrl, this.currentCommit.hash]
                };
                items.push(githubItem);
            }

            // Add separator
            const separatorItem = new vscode.TreeItem(
                `${this.changedFiles.length} file(s) changed`,
                vscode.TreeItemCollapsibleState.None
            );
            separatorItem.iconPath = new vscode.ThemeIcon('files');
            separatorItem.contextValue = 'separator';
            items.push(separatorItem);

            // Add changed files
            for (const file of this.changedFiles) {
                items.push(new CommitFileTreeItem(
                    file,
                    this.currentCommit,
                    this.currentRepoRoot,
                    vscode.TreeItemCollapsibleState.None
                ));
            }

            return items;
        }

        return [];
    }

    async setCommit(commit: CommitInfo, repoRoot: string): Promise<void> {
        this.currentCommit = commit;
        this.currentRepoRoot = repoRoot;

        try {
            // Get changed files
            this.changedFiles = await this.gitService.getChangedFilesInCommit(commit.hash, repoRoot);
            
            // Get GitHub URL
            this.githubUrl = await this.gitService.getGitHubRepoUrl(repoRoot);

            this.refresh();
        } catch (error) {
            console.error('Error loading commit details:', error);
            vscode.window.showErrorMessage(`Failed to load commit details: ${error}`);
        }
    }

    clear(): void {
        this.currentCommit = undefined;
        this.currentRepoRoot = undefined;
        this.changedFiles = [];
        this.githubUrl = null;
        this.refresh();
    }
}

