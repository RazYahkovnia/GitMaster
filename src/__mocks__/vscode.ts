export class TreeItem {
    constructor(public label: string, public collapsibleState?: any) { }
}

export class EventEmitter {
    event = jest.fn();
    fire = jest.fn();
}

export class ThemeIcon {
    constructor(public id: string, public color?: any) { }
}

export class ThemeColor {
    constructor(public id: string) { }
}

export class MarkdownString {
    value = '';
    appendMarkdown(str: string) {
        this.value += str;
    }
}

export enum TreeItemCollapsibleState {
    None = 0,
    Collapsed = 1,
    Expanded = 2,
}

export const window = {
    showInformationMessage: jest.fn(),
    showErrorMessage: jest.fn(),
    createTreeView: jest.fn(),
};

export const commands = {
    registerCommand: jest.fn(),
};

export const workspace = {
    getConfiguration: jest.fn(),
};

export const Uri = {
    file: (path: string) => ({ fsPath: path, scheme: 'file' }),
    parse: (path: string) => ({ fsPath: path, scheme: 'file' }),
};
