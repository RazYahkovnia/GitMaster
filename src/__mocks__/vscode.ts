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

export const env = {
    clipboard: {
        writeText: jest.fn(),
    },
};

export const commands = {
    registerCommand: jest.fn(),
    executeCommand: jest.fn(),
};

export const workspace = {
    getConfiguration: jest.fn(),
};

export const Uri = {
    file: (pathString: string) => ({
        fsPath: pathString,
        scheme: 'file',
        query: '',
        with: function (change: any) {
            return {
                ...this,
                ...change,
            };
        },
    }),
    parse: (uriString: string) => {
        // Parse scheme from URI string
        let scheme = 'file';
        let fsPath = uriString;
        let query = '';

        // Extract scheme (e.g., "git:", "file:", "gitmaster-diff:")
        const schemeMatch = uriString.match(/^([a-z-]+):/i);
        if (schemeMatch) {
            scheme = schemeMatch[1];
            // Remove scheme and colon from path
            fsPath = uriString.substring(scheme.length + 1);
        }

        // Extract query if present
        const queryIndex = fsPath.indexOf('?');
        if (queryIndex !== -1) {
            query = fsPath.substring(queryIndex + 1);
            fsPath = fsPath.substring(0, queryIndex);
        }

        // For file:// URIs, remove the leading slashes
        if (scheme === 'file' && fsPath.startsWith('//')) {
            fsPath = fsPath.substring(2);
        }

        return {
            fsPath,
            scheme,
            query,
            with: function (change: any) {
                return {
                    ...this,
                    ...change,
                };
            },
        };
    },
};

export class Range {
    constructor(
        public startLine: number,
        public startCharacter: number,
        public endLine: number,
        public endCharacter: number,
    ) { }
}
