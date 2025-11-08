import * as vscode from 'vscode';
import { GitService } from './services/gitService';
import { DiffService } from './services/diffService';
import { FileHistoryProvider } from './providers/fileHistoryProvider';
import { CommitDetailsProvider } from './providers/commitDetailsProvider';
import { ShelvesProvider } from './providers/shelvesProvider';
import { ReflogProvider } from './providers/reflogProvider';
import { RepositoryLogProvider } from './providers/repositoryLogProvider';
import { BranchesProvider } from './providers/branchesProvider';
import { CommitCommands } from './commands/commitCommands';
import { StashCommands } from './commands/stashCommands';
import { ReflogCommands } from './commands/reflogCommands';
import { RepositoryLogCommands } from './commands/repositoryLogCommands';
import { BranchCommands } from './commands/branchCommands';

// Global service instances
let gitService: GitService;
let diffService: DiffService;
let fileHistoryProvider: FileHistoryProvider;
let commitDetailsProvider: CommitDetailsProvider;
let shelvesProvider: ShelvesProvider;
let reflogProvider: ReflogProvider;
let repositoryLogProvider: RepositoryLogProvider;
let branchesProvider: BranchesProvider;
let commitCommands: CommitCommands;
let stashCommands: StashCommands;
let reflogCommands: ReflogCommands;
let repositoryLogCommands: RepositoryLogCommands;
let branchCommands: BranchCommands;

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
    reflogProvider = new ReflogProvider();
    repositoryLogProvider = new RepositoryLogProvider(gitService);
    branchesProvider = new BranchesProvider(gitService);
    commitCommands = new CommitCommands(gitService, diffService, commitDetailsProvider);
    stashCommands = new StashCommands(gitService, diffService, shelvesProvider);
    reflogCommands = new ReflogCommands(gitService, reflogProvider);
    repositoryLogCommands = new RepositoryLogCommands(gitService, repositoryLogProvider);
    branchCommands = new BranchCommands(gitService, branchesProvider);
}

/**
 * Register tree views for file history, commit details, shelves, reflog, repository log, and branches
 */
function registerTreeViews(context: vscode.ExtensionContext): void {
    // File History tree view
    const fileHistoryTreeView = vscode.window.createTreeView('gitmaster.fileHistory', {
        treeDataProvider: fileHistoryProvider,
        showCollapseAll: false
    });

    // Commit Details tree view
    const commitDetailsTreeView = vscode.window.createTreeView('gitmaster.commitDetails', {
        treeDataProvider: commitDetailsProvider,
        showCollapseAll: false
    });

    // Shelves tree view
    const shelvesTreeView = vscode.window.createTreeView('gitmaster.shelves', {
        treeDataProvider: shelvesProvider,
        showCollapseAll: false
    });

    // Git Operations (Reflog) tree view
    const reflogTreeView = vscode.window.createTreeView('gitmaster.reflog', {
        treeDataProvider: reflogProvider,
        showCollapseAll: false
    });

    // Repository Log tree view
    const repositoryLogTreeView = vscode.window.createTreeView('gitmaster.repositoryLog', {
        treeDataProvider: repositoryLogProvider,
        showCollapseAll: false
    });

    // Branches tree view
    const branchesTreeView = vscode.window.createTreeView('gitmaster.branches', {
        treeDataProvider: branchesProvider,
        showCollapseAll: false
    });

    context.subscriptions.push(
        fileHistoryTreeView,
        commitDetailsTreeView,
        shelvesTreeView,
        reflogTreeView,
        repositoryLogTreeView,
        branchesTreeView
    );
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

    // Reflog commands
    const checkoutFromReflogCommand = vscode.commands.registerCommand(
        'gitmaster.checkoutFromReflog',
        async (entry, repoRoot) => await reflogCommands.checkoutFromReflog(entry, repoRoot)
    );

    const refreshReflogCommand = vscode.commands.registerCommand(
        'gitmaster.refreshReflog',
        () => reflogCommands.refreshReflog()
    );

    // Repository Log commands
    const revertCommitInNewBranchCommand = vscode.commands.registerCommand(
        'gitmaster.revertCommitInNewBranch',
        async (commit, repoRoot) => await repositoryLogCommands.revertCommitInNewBranch(commit, repoRoot)
    );

    const checkoutCommitFromRepoLogCommand = vscode.commands.registerCommand(
        'gitmaster.checkoutCommitFromRepoLog',
        async (commit, repoRoot) => await repositoryLogCommands.checkoutCommit(commit, repoRoot)
    );

    const cherryPickCommitCommand = vscode.commands.registerCommand(
        'gitmaster.cherryPickCommit',
        async (commit, repoRoot) => await repositoryLogCommands.cherryPickCommit(commit, repoRoot)
    );

    const createBranchFromCommitCommand = vscode.commands.registerCommand(
        'gitmaster.createBranchFromCommit',
        async (commit, repoRoot) => await repositoryLogCommands.createBranchFromCommit(commit, repoRoot)
    );

    const refreshRepositoryLogCommand = vscode.commands.registerCommand(
        'gitmaster.refreshRepositoryLog',
        () => repositoryLogCommands.refreshRepositoryLog()
    );

    // Branch commands
    const checkoutBranchCommand = vscode.commands.registerCommand(
        'gitmaster.checkoutBranch',
        async (branch, repoRoot) => await branchCommands.checkoutBranch(branch, repoRoot)
    );

    const deleteBranchCommand = vscode.commands.registerCommand(
        'gitmaster.deleteBranch',
        async (branch, repoRoot) => await branchCommands.deleteBranch(branch, repoRoot)
    );

    const createNewBranchCommand = vscode.commands.registerCommand(
        'gitmaster.createNewBranch',
        async () => await branchCommands.createNewBranch()
    );

    const refreshBranchesCommand = vscode.commands.registerCommand(
        'gitmaster.refreshBranches',
        () => branchCommands.refreshBranches()
    );

    const filterByMyBranchesCommand = vscode.commands.registerCommand(
        'gitmaster.filterByMyBranches',
        async () => await branchCommands.filterByMyBranches()
    );

    const filterByAuthorCommand = vscode.commands.registerCommand(
        'gitmaster.filterByAuthor',
        async () => await branchCommands.filterByAuthor()
    );

    const clearBranchFilterCommand = vscode.commands.registerCommand(
        'gitmaster.clearBranchFilter',
        () => branchCommands.clearBranchFilter()
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
        showStashFileDiffCommand,
        checkoutFromReflogCommand,
        refreshReflogCommand,
        revertCommitInNewBranchCommand,
        checkoutCommitFromRepoLogCommand,
        cherryPickCommitCommand,
        createBranchFromCommitCommand,
        refreshRepositoryLogCommand,
        checkoutBranchCommand,
        deleteBranchCommand,
        createNewBranchCommand,
        refreshBranchesCommand,
        filterByMyBranchesCommand,
        filterByAuthorCommand,
        clearBranchFilterCommand
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

        // Update shelves, reflog, repository log, and branches providers with repo root
        const repoRoot = await gitService.getRepoRoot(filePath);
        shelvesProvider.setRepoRoot(repoRoot || undefined);
        reflogProvider.setRepoRoot(repoRoot || undefined);
        repositoryLogProvider.setRepoRoot(repoRoot || undefined);
        branchesProvider.setRepoRoot(repoRoot || undefined);
    } else {
        fileHistoryProvider.setCurrentFile(undefined);
        shelvesProvider.setRepoRoot(undefined);
        reflogProvider.setRepoRoot(undefined);
        repositoryLogProvider.setRepoRoot(undefined);
        branchesProvider.setRepoRoot(undefined);
    }
}
