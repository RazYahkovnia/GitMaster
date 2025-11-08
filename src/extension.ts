import * as vscode from 'vscode';
import { GitService } from './services/gitService';
import { DiffService } from './services/diffService';
import { FileHistoryProvider } from './providers/fileHistoryProvider';
import { CommitDetailsProvider } from './providers/commitDetailsProvider';
import { ShelvesProvider } from './providers/shelvesProvider';
import { CommitCommands } from './commands/commitCommands';
import { StashCommands } from './commands/stashCommands';

// Global service instances
let gitService: GitService;
let diffService: DiffService;
let fileHistoryProvider: FileHistoryProvider;
let commitDetailsProvider: CommitDetailsProvider;
let shelvesProvider: ShelvesProvider;
let commitCommands: CommitCommands;
let stashCommands: StashCommands;

/**
 * Activate the GitMaster extension
 */
export function activate(context: vscode.ExtensionContext) {
    console.log('GitMaster extension is now active!');

    // Initialize services
    initializeServices();

    // Register tree views
    registerTreeViews(context);

    // Register commands
    registerCommands(context);

    // Register event listeners
    registerEventListeners(context);

    // Initialize with current active editor
    updateFileHistory(vscode.window.activeTextEditor);
}

/**
 * Deactivate the extension
 */
export function deactivate() {
    console.log('GitMaster extension is now deactivated');
}

/**
 * Initialize all services
 */
function initializeServices(): void {
    gitService = new GitService();
    diffService = new DiffService(gitService);
    fileHistoryProvider = new FileHistoryProvider();
    commitDetailsProvider = new CommitDetailsProvider();
    shelvesProvider = new ShelvesProvider();
    commitCommands = new CommitCommands(gitService, diffService, commitDetailsProvider);
    stashCommands = new StashCommands(gitService, diffService, shelvesProvider);
}

/**
 * Register tree views for file history, commit details, and shelves
 */
function registerTreeViews(context: vscode.ExtensionContext): void {
    // File History tree view
    const fileHistoryTreeView = vscode.window.createTreeView('gitmaster.fileHistory', {
        treeDataProvider: fileHistoryProvider,
        showCollapseAll: false
    });
    fileHistoryTreeView.message = 'No file history available';

    // Commit Details tree view
    const commitDetailsTreeView = vscode.window.createTreeView('gitmaster.commitDetails', {
        treeDataProvider: commitDetailsProvider,
        showCollapseAll: false
    });
    commitDetailsTreeView.message = 'Select a commit to view details';

    // Shelves tree view
    const shelvesTreeView = vscode.window.createTreeView('gitmaster.shelves', {
        treeDataProvider: shelvesProvider,
        showCollapseAll: false
    });

    context.subscriptions.push(fileHistoryTreeView, commitDetailsTreeView, shelvesTreeView);
}

/**
 * Register all extension commands
 */
function registerCommands(context: vscode.ExtensionContext): void {
    // Refresh file history command
    const refreshCommand = vscode.commands.registerCommand(
        'gitmaster.refreshFileHistory',
        () => fileHistoryProvider.refresh()
    );

    // Show commit details command
    const showCommitDiffCommand = vscode.commands.registerCommand(
        'gitmaster.showCommitDiff',
        async (commit, filePath) => await commitCommands.showCommitDetails(commit, filePath)
    );

    // Show file diff command
    const showFileDiffCommand = vscode.commands.registerCommand(
        'gitmaster.showFileDiff',
        async (file, commit, repoRoot) => await commitCommands.showFileDiff(file, commit, repoRoot)
    );

    // Open commit in GitHub command
    const openGitHubCommand = vscode.commands.registerCommand(
        'gitmaster.openCommitInGitHub',
        async (githubUrl, commitHash) => await commitCommands.openCommitInGitHub(githubUrl, commitHash)
    );

    // Copy commit ID command
    const copyCommitIdCommand = vscode.commands.registerCommand(
        'gitmaster.copyCommitId',
        async (commit) => await commitCommands.copyCommitId(commit)
    );

    // Stash/Shelf commands
    const createShelfCommand = vscode.commands.registerCommand(
        'gitmaster.createShelf',
        async () => await stashCommands.createShelf()
    );

    const applyShelfCommand = vscode.commands.registerCommand(
        'gitmaster.applyShelf',
        async (stashItem) => await stashCommands.applyShelf(stashItem)
    );

    const popShelfCommand = vscode.commands.registerCommand(
        'gitmaster.popShelf',
        async (stashItem) => await stashCommands.popShelf(stashItem)
    );

    const deleteShelfCommand = vscode.commands.registerCommand(
        'gitmaster.deleteShelf',
        async (stashItem) => await stashCommands.deleteShelf(stashItem)
    );

    const refreshShelvesCommand = vscode.commands.registerCommand(
        'gitmaster.refreshShelves',
        () => stashCommands.refreshShelves()
    );

    const showStashFileDiffCommand = vscode.commands.registerCommand(
        'gitmaster.showStashFileDiff',
        async (file, stashIndex, repoRoot) => await stashCommands.showStashFileDiff(file, stashIndex, repoRoot)
    );

    context.subscriptions.push(
        refreshCommand,
        showCommitDiffCommand,
        showFileDiffCommand,
        openGitHubCommand,
        copyCommitIdCommand,
        createShelfCommand,
        applyShelfCommand,
        popShelfCommand,
        deleteShelfCommand,
        refreshShelvesCommand,
        showStashFileDiffCommand
    );
}

/**
 * Register event listeners for editor changes
 */
function registerEventListeners(context: vscode.ExtensionContext): void {
    // Listen to active editor changes
    const editorChangeDisposable = vscode.window.onDidChangeActiveTextEditor(
        editor => updateFileHistory(editor)
    );

    // Listen to visible text editors changes (for split views)
    const visibleEditorsChangeDisposable = vscode.window.onDidChangeVisibleTextEditors(
        () => updateFileHistory(vscode.window.activeTextEditor)
    );

    context.subscriptions.push(editorChangeDisposable, visibleEditorsChangeDisposable);
}

/**
 * Update the file history view based on the active editor
 */
async function updateFileHistory(editor: vscode.TextEditor | undefined): Promise<void> {
    if (editor && editor.document.uri.scheme === 'file') {
        const filePath = editor.document.uri.fsPath;
        fileHistoryProvider.setCurrentFile(filePath);

        // Update shelves provider with repo root
        const repoRoot = await gitService.getRepoRoot(filePath);
        shelvesProvider.setRepoRoot(repoRoot || undefined);
    } else {
        fileHistoryProvider.setCurrentFile(undefined);
        shelvesProvider.setRepoRoot(undefined);
    }
}
