import * as vscode from 'vscode';

/**
 * Tree item for a group separator (used for date grouping in views).
 */
export class DateSeparatorTreeItem extends vscode.TreeItem {
    constructor(label: string) {
        super(label, vscode.TreeItemCollapsibleState.Expanded);
        this.contextValue = 'dateSeparator';
        this.iconPath = new vscode.ThemeIcon('calendar');
    }
}
