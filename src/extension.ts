import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { FileHistoryProvider } from './fileHistoryProvider';
import { CommitDetailsProvider } from './commitDetailsProvider';
import { GitService, CommitInfo, ChangedFile } from './gitService';

let fileHistoryProvider: FileHistoryProvider;
let commitDetailsProvider: CommitDetailsProvider;
let gitService: GitService;

export function activate(context: vscode.ExtensionContext) {
    console.log('GitMaster extension is now active!');

    // Initialize services
    gitService = new GitService();
    fileHistoryProvider = new FileHistoryProvider();
    commitDetailsProvider = new CommitDetailsProvider();

    // Register the file history tree view
    const treeView = vscode.window.createTreeView('gitmaster.fileHistory', {
        treeDataProvider: fileHistoryProvider,
        showCollapseAll: false
    });

    // Set tree view message for empty state
    treeView.message = 'No file history available';

    // Register the commit details tree view
    const commitDetailsTreeView = vscode.window.createTreeView('gitmaster.commitDetails', {
        treeDataProvider: commitDetailsProvider,
        showCollapseAll: false
    });

    commitDetailsTreeView.message = 'Select a commit to view details';

    // Register refresh command
    const refreshCommand = vscode.commands.registerCommand('gitmaster.refreshFileHistory', () => {
        fileHistoryProvider.refresh();
    });

    // Register show commit diff command (now shows commit details in sidebar)
    const showDiffCommand = vscode.commands.registerCommand(
        'gitmaster.showCommitDiff',
        async (commit: CommitInfo, filePath: string) => {
            await showCommitDetails(commit, filePath);
        }
    );

    // Register show file diff command (for clicking files in commit details)
    const showFileDiffCommand = vscode.commands.registerCommand(
        'gitmaster.showFileDiff',
        async (file: ChangedFile, commit: CommitInfo, repoRoot: string) => {
            await openFileDiff(file.path, commit, repoRoot, file.oldPath, file.status);
        }
    );

    // Register open in GitHub command
    const openGitHubCommand = vscode.commands.registerCommand(
        'gitmaster.openCommitInGitHub',
        async (githubUrl: string, commitHash: string) => {
            vscode.env.openExternal(vscode.Uri.parse(`${githubUrl}/commit/${commitHash}`));
        }
    );

    // Listen to active editor changes
    const editorChangeDisposable = vscode.window.onDidChangeActiveTextEditor(editor => {
        updateFileHistory(editor);
    });

    // Listen to visible text editors changes (for split views)
    const visibleEditorsChangeDisposable = vscode.window.onDidChangeVisibleTextEditors(() => {
        updateFileHistory(vscode.window.activeTextEditor);
    });

    // Initialize with current active editor
    updateFileHistory(vscode.window.activeTextEditor);

    // Add all disposables to context
    context.subscriptions.push(
        treeView,
        commitDetailsTreeView,
        refreshCommand,
        showDiffCommand,
        showFileDiffCommand,
        openGitHubCommand,
        editorChangeDisposable,
        visibleEditorsChangeDisposable
    );
}

/**
 * Update the file history view based on the active editor
 */
function updateFileHistory(editor: vscode.TextEditor | undefined) {
    if (editor && editor.document.uri.scheme === 'file') {
        const filePath = editor.document.uri.fsPath;
        fileHistoryProvider.setCurrentFile(filePath);
    } else {
        fileHistoryProvider.setCurrentFile(undefined);
    }
}

/**
 * Show the commit details in the sidebar
 */
async function showCommitDetails(commit: CommitInfo, filePath: string) {
    try {
        const repoRoot = await gitService.getRepoRoot(filePath);
        if (!repoRoot) {
            vscode.window.showErrorMessage('Not a git repository');
            return;
        }

        // Update the commit details view
        await commitDetailsProvider.setCommit(commit, repoRoot);
        
        // Set context to show the commit details view
        vscode.commands.executeCommand('setContext', 'gitmaster.commitSelected', true);

        // Also open the diff for the current file
        const relativePath = path.relative(repoRoot, filePath);
        
        // Get the file's status in this commit
        const changedFiles = await gitService.getChangedFilesInCommit(commit.hash, repoRoot);
        const currentFile = changedFiles.find(f => 
            f.path === relativePath || 
            f.oldPath === relativePath
        );
        
        await openFileDiff(
            currentFile?.path || relativePath, 
            commit, 
            repoRoot, 
            currentFile?.oldPath, 
            currentFile?.status
        );

    } catch (error) {
        vscode.window.showErrorMessage(`Failed to show commit details: ${error}`);
        console.error('Error showing commit details:', error);
    }
}


/**
 * Content provider for diff views
 */
class DiffContentProvider implements vscode.TextDocumentContentProvider {
    provideTextDocumentContent(uri: vscode.Uri): string {
        // Decode the content from the query parameter
        try {
            const base64Content = uri.query;
            return Buffer.from(base64Content, 'base64').toString('utf-8');
        } catch (error) {
            return '';
        }
    }
}

/**
 * Open a file diff for a specific file in a commit
 */
async function openFileDiff(relativePath: string, commit: CommitInfo, repoRoot: string, oldPath?: string, status?: string) {
    try {
        const fileName = path.basename(relativePath);
        const parentCommit = await gitService.getParentCommit(commit.hash, repoRoot);

        let leftContent = '';
        let leftTitle = `${fileName} (empty)`;
        let leftFileName = fileName;

        let rightContent = '';
        let rightTitle = `${fileName} (${commit.shortHash})`;

        // Handle different file statuses
        const isDeleted = status === 'D';
        const isAdded = status === 'A';
        const isRenamed = status === 'R';

        if (parentCommit) {
            try {
                // For renamed/deleted files, use the old path in the parent commit
                const pathToUse = oldPath || relativePath;
                leftContent = await gitService.getFileContentAtCommit(pathToUse, parentCommit, repoRoot);
                leftFileName = path.basename(pathToUse);
                leftTitle = `${leftFileName} (${parentCommit.substring(0, 7)})`;
            } catch (error) {
                // File might not exist in parent commit (e.g., it was added)
                leftContent = '';
                leftTitle = `${fileName} (empty)`;
            }
        }

        // Get the right side content (current commit)
        if (!isDeleted) {
            try {
                rightContent = await gitService.getFileContentAtCommit(relativePath, commit.hash, repoRoot);
            } catch (error) {
                // If file doesn't exist in current commit, it's deleted
                rightContent = '';
                rightTitle = `${fileName} (deleted)`;
            }
        } else {
            // File was deleted, right side is empty
            rightContent = '';
            rightTitle = `${fileName} (deleted)`;
        }

        const leftUri = vscode.Uri.parse(`gitmaster-diff:${leftTitle}`).with({
            query: Buffer.from(leftContent).toString('base64')
        });

        const rightUri = vscode.Uri.parse(`gitmaster-diff:${rightTitle}`).with({
            query: Buffer.from(rightContent).toString('base64')
        });

        const provider = new DiffContentProvider();
        const providerDisposable = vscode.workspace.registerTextDocumentContentProvider('gitmaster-diff', provider);

        let title = `${fileName}: ${commit.message}`;
        if (isRenamed && oldPath) {
            title = `${oldPath} → ${relativePath}`;
        } else if (isDeleted) {
            title = `${relativePath} (deleted)`;
        } else if (isAdded) {
            title = `${relativePath} (added)`;
        }

        await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title);

        setTimeout(() => {
            providerDisposable.dispose();
        }, 1000);

    } catch (error) {
        vscode.window.showErrorMessage(`Failed to show diff: ${error}`);
    }
}


export function deactivate() {
    console.log('GitMaster extension is now deactivated');
}

