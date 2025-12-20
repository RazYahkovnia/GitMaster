import * as vscode from 'vscode';
import { GitService } from './services/gitService';
import { DiffService } from './services/diffService';
import { FileHistoryProvider } from './providers/fileHistoryProvider';
import { CommitDetailsProvider } from './providers/commitDetailsProvider';
import { ShelvesProvider } from './providers/shelvesProvider';
import { ReflogProvider } from './providers/reflogProvider';
import { RepositoryLogProvider } from './providers/repositoryLogProvider';
import { BranchesProvider } from './providers/branchesProvider';
import { RebaseProvider } from './providers/rebaseProvider';
import { WorktreesProvider } from './providers/worktreesProvider';
import { CommitCommands } from './commands/commitCommands';
import { StashCommands } from './commands/stashCommands';
import { ReflogCommands } from './commands/reflogCommands';
import { RepositoryLogCommands } from './commands/repositoryLogCommands';
import { BranchCommands } from './commands/branchCommands';
import { RebaseCommands } from './commands/rebaseCommands';
import { WorktreeCommands } from './commands/worktreeCommands';
import { AICommands } from './commands/aiCommands';
import { GitGraphView } from './views/gitGraphView';
import { BlameDecorator } from './decorators/blameDecorator';
import { startGitMasterUiMcpBridge } from './mcpUiBridge/server';

// Global service instances
let gitService: GitService;
let diffService: DiffService;
let fileHistoryProvider: FileHistoryProvider;
let commitDetailsProvider: CommitDetailsProvider;
let shelvesProvider: ShelvesProvider;
let reflogProvider: ReflogProvider;
let repositoryLogProvider: RepositoryLogProvider;
let branchesProvider: BranchesProvider;
let rebaseProvider: RebaseProvider;
let worktreesProvider: WorktreesProvider;
let commitCommands: CommitCommands;
let stashCommands: StashCommands;
let reflogCommands: ReflogCommands;
let repositoryLogCommands: RepositoryLogCommands;
let branchCommands: BranchCommands;
let rebaseCommands: RebaseCommands;
let worktreeCommands: WorktreeCommands;
let aiCommands: AICommands;
let gitGraphView: GitGraphView;
let blameDecorator: BlameDecorator;

/**
 * Activate the GitMaster extension
 */
export async function activate(context: vscode.ExtensionContext) {
    console.log('GitMaster extension is now active!');

    // Initialize services
    initializeServices(context);

    const mcpOutput = vscode.window.createOutputChannel('GitMaster MCP');
    context.subscriptions.push(mcpOutput);

    // Try to resolve Git path on Windows if missing
    await gitService.setupWindowsGit();

    // Check if Git is installed
    gitService.getGitVersion().catch(() => {
        vscode.window.showErrorMessage('GitMaster: Git not found in PATH. Please install Git or check your environment variables.');
    });

    // Register tree views
    registerTreeViews(context);

    // Register commands
    registerCommands(context);

    // Start MCP server on localhost if enabled (runs inside extension host, no Node.js PATH needed)
    const mcpEnabled = vscode.workspace.getConfiguration('gitmaster').get<boolean>('mcp.enabled', true);
    if (mcpEnabled) {
        // Port can be set via config or env var (config takes precedence)
        const configPort = vscode.workspace.getConfiguration('gitmaster').get<number>('mcp.port', 8765);
        const uiPortStr = process.env.GITMASTER_MCP_UI_PORT;
        const port = uiPortStr && uiPortStr.trim() ? parseInt(uiPortStr, 10) : configPort;
        const finalPort = Number.isFinite(port) && port >= 1024 && port <= 65535 ? port : 8765;

        mcpOutput.appendLine(`Starting MCP server on 127.0.0.1:${finalPort}...`);
        startGitMasterUiMcpBridge(context, {
            port: finalPort,
            log: (message: string) => mcpOutput.appendLine(message),
            openShelvesView: async () => {
                await vscode.commands.executeCommand('gitmaster.openShelvesView');
            },
            openGitGraph: async (repoRoot: string) => {
                await gitGraphView.show(repoRoot);
            },
            openCommitDetails: async (commitInfo: any, repoRoot: string) => {
                await vscode.commands.executeCommand('gitmaster.showRepositoryCommitDetails', commitInfo, repoRoot);
                await vscode.commands.executeCommand('workbench.view.extension.gitmaster');
                await vscode.commands.executeCommand('gitmaster.commitDetails.focus');
            }
        }).then(({ port: startedPort }) => {
            const url = `http://127.0.0.1:${startedPort}/mcp`;
            console.log(`GitMaster MCP server started on ${url}`);
            mcpOutput.appendLine(`MCP server started: ${url}`);
        }).catch(err => {
            console.warn('GitMaster: failed to start MCP server:', err);
            mcpOutput.appendLine(`Failed to start MCP server: ${err?.message ?? String(err)}`);
            vscode.window.showWarningMessage(
                `GitMaster MCP failed to start on port ${finalPort}. Check Output → "GitMaster MCP" for details.`
            );
        });
    } else {
        console.log('GitMaster MCP server is disabled (gitmaster.mcp.enabled = false)');
        mcpOutput.appendLine('MCP server disabled (gitmaster.mcp.enabled = false).');
    }

    // Register event listeners
    registerEventListeners(context);

    // Initialize with current active editor or workspace
    initializeFromWorkspace();
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
function initializeServices(context: vscode.ExtensionContext): void {
    gitService = new GitService();
    diffService = new DiffService(gitService);
    fileHistoryProvider = new FileHistoryProvider(gitService, context);
    commitDetailsProvider = new CommitDetailsProvider(gitService);
    shelvesProvider = new ShelvesProvider(gitService);
    reflogProvider = new ReflogProvider(gitService);
    repositoryLogProvider = new RepositoryLogProvider(gitService);
    branchesProvider = new BranchesProvider(gitService, context);
    rebaseProvider = new RebaseProvider(gitService);
    worktreesProvider = new WorktreesProvider(gitService);
    commitCommands = new CommitCommands(gitService, diffService, commitDetailsProvider);
    stashCommands = new StashCommands(gitService, diffService, shelvesProvider);
    reflogCommands = new ReflogCommands(gitService, reflogProvider, commitDetailsProvider);
    repositoryLogCommands = new RepositoryLogCommands(gitService, repositoryLogProvider);
    branchCommands = new BranchCommands(gitService, branchesProvider);
    rebaseCommands = new RebaseCommands(gitService, rebaseProvider, commitDetailsProvider);
    worktreeCommands = new WorktreeCommands(gitService, worktreesProvider);
    aiCommands = new AICommands(gitService);
    gitGraphView = new GitGraphView(context, gitService);
    blameDecorator = new BlameDecorator(gitService);
    context.subscriptions.push(blameDecorator);
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

    // Interactive Rebase tree view
    const rebaseTreeView = vscode.window.createTreeView('gitmaster.rebase', {
        treeDataProvider: rebaseProvider,
        showCollapseAll: false
    });

    // Worktrees tree view
    const worktreesTreeView = vscode.window.createTreeView('gitmaster.worktrees', {
        treeDataProvider: worktreesProvider,
        showCollapseAll: false
    });

    context.subscriptions.push(
        fileHistoryTreeView,
        commitDetailsTreeView,
        shelvesTreeView,
        reflogTreeView,
        repositoryLogTreeView,
        branchesTreeView,
        rebaseTreeView,
        worktreesTreeView
    );
}

/**
 * Register all extension commands
 */
function registerCommands(context: vscode.ExtensionContext): void {
    // File History commands
    const refreshCommand = vscode.commands.registerCommand(
        'gitmaster.refreshFileHistory',
        () => fileHistoryProvider.refresh()
    );

    const filterFileHistoryByMessageCommand = vscode.commands.registerCommand(
        'gitmaster.filterFileHistoryByMessage',
        async () => await fileHistoryProvider.setMessageFilter()
    );

    const clearFileHistoryFilterCommand = vscode.commands.registerCommand(
        'gitmaster.clearFileHistoryFilter',
        () => fileHistoryProvider.clearMessageFilter()
    );

    const showFileExpertsCommand = vscode.commands.registerCommand(
        'gitmaster.showFileExperts',
        async () => await fileHistoryProvider.showFileExperts()
    );

    // Show commit details command
    const showCommitDiffCommand = vscode.commands.registerCommand(
        'gitmaster.showCommitDiff',
        async (commit, filePath, line) => await commitCommands.showCommitDetails(commit, filePath, line)
    );

    // Show repository commit details command
    const showRepositoryCommitDetailsCommand = vscode.commands.registerCommand(
        'gitmaster.showRepositoryCommitDetails',
        async (commitOrTreeItem, repoRoot) => await commitCommands.showRepositoryCommitDetails(commitOrTreeItem, repoRoot)
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

    // Copy commit file relative path command
    const copyCommitFileRelativePathCommand = vscode.commands.registerCommand(
        'gitmaster.copyCommitFileRelativePath',
        async (treeItem) => await commitCommands.copyCommitFileRelativePath(treeItem)
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

    const mergeIntoShelfCommand = vscode.commands.registerCommand(
        'gitmaster.mergeIntoShelf',
        async (stashItem) => await stashCommands.mergeIntoShelf(stashItem)
    );

    const refreshShelvesCommand = vscode.commands.registerCommand(
        'gitmaster.refreshShelves',
        () => stashCommands.refreshShelves()
    );

    const showStashFileDiffCommand = vscode.commands.registerCommand(
        'gitmaster.showStashFileDiff',
        async (file, stashIndex, repoRoot) => await stashCommands.showStashFileDiff(file, stashIndex, repoRoot)
    );

    const shelveFileToCommand = vscode.commands.registerCommand(
        'gitmaster.shelveFileTo',
        async (...resources) => await stashCommands.shelveFileTo(...resources)
    );

    // Reflog commands
    const checkoutFromReflogCommand = vscode.commands.registerCommand(
        'gitmaster.checkoutFromReflog',
        async (entryOrTreeItem, repoRoot) => await reflogCommands.checkoutFromReflog(entryOrTreeItem, repoRoot)
    );

    const refreshReflogCommand = vscode.commands.registerCommand(
        'gitmaster.refreshReflog',
        () => reflogCommands.refreshReflog()
    );

    const loadMoreReflogCommand = vscode.commands.registerCommand(
        'gitmaster.loadMoreReflog',
        () => reflogCommands.loadMoreReflog()
    );

    const showReflogCommitDetailsCommand = vscode.commands.registerCommand(
        'gitmaster.showReflogCommitDetails',
        async (entryOrTreeItem, repoRoot) => await reflogCommands.showReflogCommitDetails(entryOrTreeItem, repoRoot)
    );

    const toggleReflogGroupByDateCommand = vscode.commands.registerCommand(
        'gitmaster.toggleReflogGroupByDate',
        () => reflogCommands.toggleReflogGroupByDate()
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

    const loadMoreRepositoryLogCommand = vscode.commands.registerCommand(
        'gitmaster.loadMoreRepositoryLog',
        () => repositoryLogCommands.loadMoreRepositoryLog()
    );

    const filterRepositoryLogByMessageCommand = vscode.commands.registerCommand(
        'gitmaster.filterRepositoryLogByMessage',
        async () => await repositoryLogProvider.setMessageFilter()
    );

    const clearRepositoryLogFilterCommand = vscode.commands.registerCommand(
        'gitmaster.clearRepositoryLogFilter',
        () => repositoryLogProvider.clearMessageFilter()
    );

    const showGitGraphCommand = vscode.commands.registerCommand(
        'gitmaster.showGitGraph',
        async () => {
            const repoRoot = repositoryLogProvider['currentRepoRoot'];
            if (!repoRoot) {
                vscode.window.showErrorMessage('No repository opened');
                return;
            }
            await gitGraphView.show(repoRoot);
        }
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

    const pinBranchCommand = vscode.commands.registerCommand(
        'gitmaster.pinBranch',
        async (branchOrTreeItem) => await branchCommands.pinBranch(branchOrTreeItem)
    );

    const unpinBranchCommand = vscode.commands.registerCommand(
        'gitmaster.unpinBranch',
        async (branchOrTreeItem) => await branchCommands.unpinBranch(branchOrTreeItem)
    );

    // Rebase commands
    const startRebaseCommand = vscode.commands.registerCommand(
        'gitmaster.startRebase',
        async () => await rebaseCommands.startRebase()
    );

    const startRebaseOnDefaultCommand = vscode.commands.registerCommand(
        'gitmaster.startRebaseOnDefault',
        async () => await rebaseCommands.startRebaseOnDefault()
    );

    const fetchAndRebaseCommand = vscode.commands.registerCommand(
        'gitmaster.fetchAndRebase',
        async () => await rebaseCommands.fetchAndRebase()
    );

    const changeRebaseActionCommand = vscode.commands.registerCommand(
        'gitmaster.changeRebaseAction',
        async (item) => await rebaseCommands.changeCommitAction(item)
    );

    const rewordCommitCommand = vscode.commands.registerCommand(
        'gitmaster.rewordCommit',
        async (item) => await rebaseCommands.rewordCommit(item)
    );

    const executeRebaseCommand = vscode.commands.registerCommand(
        'gitmaster.executeRebase',
        async () => await rebaseCommands.executeRebase()
    );

    const continueRebaseCommand = vscode.commands.registerCommand(
        'gitmaster.continueRebase',
        async () => await rebaseCommands.continueRebase()
    );

    const abortRebaseCommand = vscode.commands.registerCommand(
        'gitmaster.abortRebase',
        async () => await rebaseCommands.abortRebase()
    );

    const refreshRebaseCommand = vscode.commands.registerCommand(
        'gitmaster.refreshRebase',
        () => rebaseCommands.refreshRebase()
    );

    const changeBaseBranchCommand = vscode.commands.registerCommand(
        'gitmaster.changeBaseBranch',
        async () => await rebaseCommands.changeBaseBranch()
    );

    const resetRebaseCommand = vscode.commands.registerCommand(
        'gitmaster.resetRebase',
        async () => await rebaseCommands.resetRebase()
    );

    const showRebaseCommitDetailsCommand = vscode.commands.registerCommand(
        'gitmaster.showRebaseCommitDetails',
        async (treeItem) => await rebaseCommands.showCommitDetails(treeItem)
    );

    // Worktree commands
    const addWorktreeCommand = vscode.commands.registerCommand(
        'gitmaster.addWorktree',
        async () => await worktreeCommands.addWorktree()
    );

    const removeWorktreeCommand = vscode.commands.registerCommand(
        'gitmaster.removeWorktree',
        async (item) => await worktreeCommands.removeWorktree(item)
    );

    const openWorktreeCommand = vscode.commands.registerCommand(
        'gitmaster.openWorktree',
        async (item) => await worktreeCommands.openWorktree(item)
    );

    const pruneWorktreesCommand = vscode.commands.registerCommand(
        'gitmaster.pruneWorktrees',
        async () => await worktreeCommands.pruneWorktrees()
    );

    const refreshWorktreesCommand = vscode.commands.registerCommand(
        'gitmaster.refreshWorktrees',
        () => worktreeCommands.refresh()
    );

    // AI Commands
    const explainCommitWithAICommand = vscode.commands.registerCommand(
        'gitmaster.explainCommitWithAI',
        async (commit) => {
            let repoRoot: string | undefined;

            // Fallback to current commit in provider if no argument provided
            if (!commit && commitDetailsProvider.currentCommitInfo) {
                commit = commitDetailsProvider.currentCommitInfo;
                repoRoot = commitDetailsProvider.currentRepoRootPath;
            } else if (commit) {
                // Try to determine repo root for passed commit
                if (vscode.window.activeTextEditor) {
                    repoRoot = await gitService.getRepoRoot(vscode.window.activeTextEditor.document.uri.fsPath) || undefined;
                }
            }

            await aiCommands.explainCommit(commit, repoRoot);
        }
    );

    // Copy remote line URL command
    const copyRemoteLineUrlCommand = vscode.commands.registerCommand(
        'gitmaster.copyRemoteLineUrl',
        async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showErrorMessage('No active editor');
                return;
            }

            const filePath = editor.document.uri.fsPath;
            const selection = editor.selection;
            const startLine = selection.start.line + 1; // Convert to 1-based
            const endLine = selection.end.line + 1;

            // Get the remote URL with line numbers
            const url = await gitService.getRemoteFileUrl(
                filePath,
                startLine,
                selection.isEmpty ? undefined : endLine
            );

            if (!url) {
                vscode.window.showErrorMessage('Could not generate remote URL. Make sure the file is in a Git repository with a remote.');
                return;
            }

            // Copy to clipboard
            await vscode.env.clipboard.writeText(url);

            const lineInfo = selection.isEmpty
                ? `line ${startLine}`
                : `lines ${startLine}-${endLine}`;
            vscode.window.showInformationMessage(`Copied remote URL for ${lineInfo} to clipboard`);
        }
    );

    // Open Shelves view command (for agents / quick navigation)
    const openShelvesViewCommand = vscode.commands.registerCommand(
        'gitmaster.openShelvesView',
        async () => {
            await vscode.commands.executeCommand('workbench.view.extension.gitmaster');
            await vscode.commands.executeCommand('gitmaster.shelves.focus');
        }
    );

    // Setup MCP in Cursor using deep link (recommended)
    const setupCursorMcpCommand = vscode.commands.registerCommand(
        'gitmaster.setupCursorMcp',
        async () => {
            const deepLink = buildCursorMcpDeepLink(context);

            // Try to open the deep link directly
            try {
                await vscode.env.openExternal(vscode.Uri.parse(deepLink));
                vscode.window.showInformationMessage(
                    'GitMaster: Opening Cursor MCP installer. Click "Install" to set up the MCP server automatically.'
                );
            } catch (err) {
                // If opening fails, copy to clipboard as fallback
                await vscode.env.clipboard.writeText(deepLink);
                vscode.window.showInformationMessage(
                    'GitMaster: MCP installer link copied to clipboard. Paste it in your browser or Cursor to install.'
                );
            }
        }
    );

    // Open GitMaster settings
    const openSettingsCommand = vscode.commands.registerCommand(
        'gitmaster.openSettings',
        async () => {
            // Open settings filtered to GitMaster extension
            await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:razyahkovnia.gitmaster');
        }
    );

    context.subscriptions.push(
        refreshCommand,
        filterFileHistoryByMessageCommand,
        clearFileHistoryFilterCommand,
        showFileExpertsCommand,
        showCommitDiffCommand,
        showRepositoryCommitDetailsCommand,
        showFileDiffCommand,
        openGitHubCommand,
        copyCommitIdCommand,
        copyCommitFileRelativePathCommand,
        createShelfCommand,
        applyShelfCommand,
        popShelfCommand,
        deleteShelfCommand,
        mergeIntoShelfCommand,
        refreshShelvesCommand,
        showStashFileDiffCommand,
        shelveFileToCommand,
        checkoutFromReflogCommand,
        refreshReflogCommand,
        loadMoreReflogCommand,
        showReflogCommitDetailsCommand,
        toggleReflogGroupByDateCommand,
        revertCommitInNewBranchCommand,
        checkoutCommitFromRepoLogCommand,
        cherryPickCommitCommand,
        createBranchFromCommitCommand,
        refreshRepositoryLogCommand,
        loadMoreRepositoryLogCommand,
        filterRepositoryLogByMessageCommand,
        clearRepositoryLogFilterCommand,
        showGitGraphCommand,
        checkoutBranchCommand,
        deleteBranchCommand,
        createNewBranchCommand,
        refreshBranchesCommand,
        filterByMyBranchesCommand,
        filterByAuthorCommand,
        clearBranchFilterCommand,
        pinBranchCommand,
        unpinBranchCommand,
        startRebaseCommand,
        startRebaseOnDefaultCommand,
        fetchAndRebaseCommand,
        changeRebaseActionCommand,
        rewordCommitCommand,
        executeRebaseCommand,
        continueRebaseCommand,
        abortRebaseCommand,
        refreshRebaseCommand,
        changeBaseBranchCommand,
        resetRebaseCommand,
        showRebaseCommitDetailsCommand,
        addWorktreeCommand,
        removeWorktreeCommand,
        openWorktreeCommand,
        pruneWorktreesCommand,
        refreshWorktreesCommand,
        explainCommitWithAICommand,
        copyRemoteLineUrlCommand,
        openShelvesViewCommand,
        setupCursorMcpCommand,
        openSettingsCommand
    );
}

function buildCursorMcpDeepLink(context: vscode.ExtensionContext): string {
    // Use localhost URL instead of stdio - simpler and no Node.js PATH issues
    // Get port from config or env var (config takes precedence)
    const configPort = vscode.workspace.getConfiguration('gitmaster').get<number>('mcp.port', 8765);
    const uiPortStr = process.env.GITMASTER_MCP_UI_PORT;
    const port = uiPortStr && uiPortStr.trim() ? parseInt(uiPortStr, 10) : configPort;
    const finalPort = Number.isFinite(port) && port >= 1024 && port <= 65535 ? port : 8765;
    const mcpUrl = `http://127.0.0.1:${finalPort}/mcp`;

    // Build the MCP server config (just the server config, not the full mcpServers object)
    const mcpConfig = {
        url: mcpUrl
    };

    // Base64 encode the config and URL encode it for the deep link
    const configJson = JSON.stringify(mcpConfig);
    const configBase64 = Buffer.from(configJson).toString('base64');
    const configEncoded = encodeURIComponent(configBase64);

    // Build the deep link following Cursor's format:
    // cursor://anysphere.cursor-deeplink/mcp/install?name=<Name>&config=<Base64EncodedConfig>
    const deepLink = `cursor://anysphere.cursor-deeplink/mcp/install?name=GitMaster&config=${configEncoded}`;

    return deepLink;
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

    // Listen to workspace folder changes
    const workspaceFoldersChangeDisposable = vscode.workspace.onDidChangeWorkspaceFolders(
        () => {
            gitService.clearCache();
            initializeFromWorkspace();
        }
    );

    // Listen to Git repository changes (commits, checkouts, etc.)
    const gitChangeDisposable = vscode.workspace.onDidChangeTextDocument(async (event) => {
        // Check if the changed file is in .git directory or is a git-related operation
        if (event.document.uri.path.includes('.git/')) {
            // Git state changed, refresh providers
            const repoRoot = await gitService.getRepoRoot(event.document.uri.fsPath);
            if (repoRoot) {
                await rebaseProvider.setRepoRoot(repoRoot);
                worktreesProvider.refresh();
            }
        }
    });

    // Listen to file system changes for better git detection
    const fsWatcher = vscode.workspace.createFileSystemWatcher('**/.git/refs/heads/**');
    fsWatcher.onDidChange(async () => {
        // Branch or commit changed, refresh rebase view
        if (vscode.window.activeTextEditor) {
            const repoRoot = await gitService.getRepoRoot(vscode.window.activeTextEditor.document.uri.fsPath);
            if (repoRoot) {
                await rebaseProvider.setRepoRoot(repoRoot);
                worktreesProvider.refresh();
            }
        }
    });
    fsWatcher.onDidCreate(async () => {
        // New branch created, refresh rebase view
        if (vscode.window.activeTextEditor) {
            const repoRoot = await gitService.getRepoRoot(vscode.window.activeTextEditor.document.uri.fsPath);
            if (repoRoot) {
                await rebaseProvider.setRepoRoot(repoRoot);
                worktreesProvider.refresh();
            }
        }
    });

    context.subscriptions.push(
        editorChangeDisposable,
        visibleEditorsChangeDisposable,
        workspaceFoldersChangeDisposable,
        gitChangeDisposable,
        fsWatcher
    );
}

/**
 * Initialize providers from workspace or active editor
 */
async function initializeFromWorkspace(): Promise<void> {
    // Try to use active editor first
    if (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.uri.scheme === 'file') {
        await updateFileHistory(vscode.window.activeTextEditor);
        return;
    }

    // If no active editor, try to find git repo from workspace folders
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
        // Try each workspace folder to find a git repo
        for (const folder of workspaceFolders) {
            const folderPath = folder.uri.fsPath;
            try {
                const repoRoot = await gitService.getRepoRoot(folderPath);

                if (repoRoot) {
                    // Found a git repo, initialize all providers
                    shelvesProvider.setRepoRoot(repoRoot);
                    reflogProvider.setRepoRoot(repoRoot);
                    repositoryLogProvider.setRepoRoot(repoRoot);
                    branchesProvider.setRepoRoot(repoRoot);
                    await rebaseProvider.setRepoRoot(repoRoot);
                    worktreesProvider.setRepoRoot(repoRoot);
                    return;
                }
            } catch (e) {
                console.warn('GitMaster: Error checking workspace folder:', folderPath, e);
            }
        }
    }

    // No git repo found, clear everything
    fileHistoryProvider.setCurrentFile(undefined);
    shelvesProvider.setRepoRoot(undefined);
    reflogProvider.setRepoRoot(undefined);
    repositoryLogProvider.setRepoRoot(undefined);
    branchesProvider.setRepoRoot(undefined);
    await rebaseProvider.setRepoRoot(undefined);
    worktreesProvider.setRepoRoot(undefined);
}

/**
 * Update the file history view based on the active editor
 */
async function updateFileHistory(editor: vscode.TextEditor | undefined): Promise<void> {
    if (editor && editor.document.uri.scheme === 'file') {
        const filePath = editor.document.uri.fsPath;
        fileHistoryProvider.setCurrentFile(filePath);

        // Update shelves, reflog, repository log, branches, and rebase providers with repo root
        const repoRoot = await gitService.getRepoRoot(filePath);
        shelvesProvider.setRepoRoot(repoRoot || undefined);
        reflogProvider.setRepoRoot(repoRoot || undefined);
        repositoryLogProvider.setRepoRoot(repoRoot || undefined);
        branchesProvider.setRepoRoot(repoRoot || undefined);
        await rebaseProvider.setRepoRoot(repoRoot || undefined);
        worktreesProvider.setRepoRoot(repoRoot || undefined);
    } else {
        // No active editor, fall back to workspace initialization
        await initializeFromWorkspace();
    }
}
