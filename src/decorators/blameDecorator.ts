import * as vscode from 'vscode';
import { GitService } from '../services/gitService';
import { BlameInfo } from '../types/git';

export class BlameDecorator implements vscode.Disposable {
    private disposables: vscode.Disposable[] = [];
    private decorationType: vscode.TextEditorDecorationType;
    private gitService: GitService;
    private updateTimeout: NodeJS.Timeout | undefined;

    constructor(gitService: GitService) {
        this.gitService = gitService;

        this.decorationType = vscode.window.createTextEditorDecorationType({
            after: {
                margin: '0 0 0 3em',
                color: new vscode.ThemeColor('gitDecoration.ignoredResourceForeground'),
                fontStyle: 'italic'
            }
        });

        this.disposables.push(this.decorationType);

        this.disposables.push(vscode.window.onDidChangeActiveTextEditor(editor => {
            this.triggerUpdate(editor);
        }));

        this.disposables.push(vscode.window.onDidChangeTextEditorSelection(e => {
            this.triggerUpdate(e.textEditor);
        }));

        this.disposables.push(vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('gitmaster.blame.enabled')) {
                this.triggerUpdate(vscode.window.activeTextEditor);
            }
        }));

        // Initial update
        if (vscode.window.activeTextEditor) {
            this.triggerUpdate(vscode.window.activeTextEditor);
        }
    }

    private triggerUpdate(editor: vscode.TextEditor | undefined) {
        if (this.updateTimeout) {
            clearTimeout(this.updateTimeout);
        }

        this.updateTimeout = setTimeout(() => {
            this.updateBlame(editor);
        }, 200); // 200ms debounce
    }

    private async updateBlame(editor: vscode.TextEditor | undefined) {
        if (!editor) {
            return;
        }

        // Check if blame is enabled in settings
        const config = vscode.workspace.getConfiguration('gitmaster');
        if (!config.get<boolean>('blame.enabled', true)) {
            editor.setDecorations(this.decorationType, []);
            return;
        }

        const doc = editor.document;
        // Support file scheme, git scheme (for built-in git diff), and gitmaster-diff scheme (for custom diff)
        if (doc.uri.scheme !== 'file' && doc.uri.scheme !== 'git' && doc.uri.scheme !== 'gitmaster-diff') {
            editor.setDecorations(this.decorationType, []);
            return;
        }

        const position = editor.selection.active;
        const line = position.line; // 0-based
        const lineNumber = line + 1; // 1-based for git

        // Clear decorations if we are updating (optional, avoids showing old blame on new line)
        // editor.setDecorations(this.decorationType, []);

        const blame: BlameInfo | null = await this.gitService.getBlameForLine(doc.uri.toString(), lineNumber);

        // Check if editor is still active and selection is still on the same line
        if (vscode.window.activeTextEditor === editor && editor.selection.active.line === line) {
            if (blame) {
                const contentText = `     ${blame.author}, ${blame.relativeDate} • ${blame.message}`;

                // Construct CommitInfo-like object for the command
                const commitInfo = {
                    hash: blame.hash,
                    shortHash: blame.shortHash,
                    message: blame.message,
                    author: blame.author,
                    date: blame.date,
                    relativeDate: blame.relativeDate,
                    path: blame.filename // Pass the filename from blame (might be different from current if renamed)
                };

                // Argument for command: [commitInfo, filePath]
                // Use the original URI string to handle git: scheme correctly
                // For gitmaster-diff, we strip the query (content) to avoid huge URIs and potential command parsing issues
                let uriString = doc.uri.toString();
                if (doc.uri.scheme === 'gitmaster-diff') {
                    uriString = doc.uri.with({ query: '' }).toString();
                }

                const args = [commitInfo, uriString];
                const commandUri = vscode.Uri.parse(
                    `command:gitmaster.showCommitDiff?${encodeURIComponent(JSON.stringify(args))}`
                );

                const hoverMessage = new vscode.MarkdownString(
                    `**${blame.author}** committed ${blame.relativeDate}\n\n` +
                    `${blame.message}\n\n` +
                    `[View Commit Details](${commandUri})`
                );
                hoverMessage.isTrusted = true;

                const decoration: vscode.DecorationOptions = {
                    range: new vscode.Range(line, Number.MAX_SAFE_INTEGER, line, Number.MAX_SAFE_INTEGER),
                    renderOptions: {
                        after: {
                            contentText,
                        }
                    },
                    hoverMessage
                };

                editor.setDecorations(this.decorationType, [decoration]);
            } else {
                editor.setDecorations(this.decorationType, []);
            }
        }
    }

    dispose() {
        this.disposables.forEach(d => d.dispose());
        if (this.updateTimeout) {
            clearTimeout(this.updateTimeout);
        }
    }
}

