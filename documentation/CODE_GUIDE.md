# GitMaster Developer Guide

Quick reference for developers. Read this first, then explore the code.

---

## 🏗️ Architecture

```
src/
├── extension.ts           # Registration only (NO business logic)
├── types/git.ts           # All interfaces (11 types)
├── services/              # Git operations (throw errors)
│   ├── gitService.ts      # Facade aggregating all Git services
│   ├── diffService.ts     # Diff views
│   └── git/               # Modular Git service implementations
│       ├── core.ts        # GitExecutor (command execution)
│       ├── system.ts      # Git version, Windows setup
│       ├── status.ts      # Repo root, file tracking, cache
│       ├── log.ts         # File history, repo log, reflog
│       ├── commit.ts      # Commit info, diffs, changed files
│       ├── content.ts     # File content at commit, blame
│       ├── branch.ts      # Branch operations
│       ├── remote.ts      # Remote URLs, GitHub integration
│       ├── stash.ts       # Stash/shelf operations
│       ├── rebase.ts      # Interactive rebase
│       ├── worktree.ts    # Git worktrees
│       ├── graph.ts       # Commit graph visualization
│       ├── contributors.ts # File contributors
│       └── utils.ts       # Shared parsing utilities
├── providers/             # TreeDataProvider (UI, use services)
│   ├── fileHistoryProvider.ts
│   ├── commitDetailsProvider.ts
│   ├── shelvesProvider.ts
│   ├── branchesProvider.ts
│   ├── repositoryLogProvider.ts
│   ├── reflogProvider.ts
│   ├── rebaseProvider.ts
│   └── worktreesProvider.ts
├── commands/              # Orchestration (catch errors, show messages)
│   ├── commitCommands.ts
│   ├── stashCommands.ts
│   ├── branchCommands.ts
│   ├── repositoryLogCommands.ts
│   ├── reflogCommands.ts
│   ├── rebaseCommands.ts
│   ├── worktreeCommands.ts
│   └── aiCommands.ts
├── decorators/
│   └── blameDecorator.ts  # Editor blame annotations
├── views/
│   ├── gitGraphView.ts    # Webview for commit graph
│   └── fileExpertsView.ts # File experts quick pick
├── mcp/                   # MCP (Model Context Protocol) integration
│   ├── server.ts          # HTTP server for MCP transport
│   ├── tools.ts           # MCP tool definitions and handlers
│   ├── types.ts           # MCP-specific type definitions
│   └── constants.ts       # Configuration constants and limits
└── utils/
    ├── colorUtils.ts      # Author colors
    └── filterUtils.ts     # Filter utilities
```

### Data Flow
```
User Action → Command → Service → Git → Parse → Provider → UI
```

### Layer Rules

| Layer | Do | Don't |
|-------|----|----|
| **types/** | Define interfaces | Add implementation |
| **services/** | Execute Git, throw errors | Use VS Code API (except diffService) |
| **services/git/** | Modular Git operations | Depend on VS Code |
| **providers/** | Display data, use services | Execute Git directly |
| **commands/** | Catch errors, show messages | Contain business logic |
| **mcp/** | Handle MCP protocol, use services | Add Git logic |
| **extension.ts** | Register components | Add business logic |

---

## 📊 Feature Matrix

| Feature | Provider | Commands | Service |
|---------|----------|----------|---------|
| File History | fileHistoryProvider | commitCommands | getFileHistory |
| Commit Details | commitDetailsProvider | commitCommands | getChangedFilesInCommit |
| Shelves | shelvesProvider | stashCommands | getStashes, createStash |
| Branches | branchesProvider | branchCommands | getBranches, checkoutBranch |
| Repository Log | repositoryLogProvider | repositoryLogCommands | getRepositoryLog |
| Reflog | reflogProvider | reflogCommands | getReflog |
| Rebase | rebaseProvider | rebaseCommands | getCommitsAheadOfBase |
| Worktrees | worktreesProvider | worktreeCommands | getWorktrees |
| Git Graph | gitGraphView | (inline) | getGraphCommits |
| File Experts | fileExpertsView | (inline) | getFileContributors |

---

## 🎯 Adding Features

### New Git Operation

The `services/git/` folder contains modular git services. Add operations to the appropriate service file:

```typescript
// 1. Add to appropriate service (e.g., services/git/commit.ts)
async getCommitAuthor(hash: string, repoRoot: string): Promise<string> {
    const result = await this.executor.exec(
        ['show', '-s', '--format=%an', hash],
        { cwd: repoRoot }
    );
    return result.stdout.trim();
}

// 2. Expose through GitService facade (services/gitService.ts)
async getCommitAuthor(hash: string, repoRoot: string): Promise<string> {
    return this.commitService.getCommitAuthor(hash, repoRoot);
}

// 3. Use in command/provider
```

### New Tree View
```typescript
// 1. Create providers/myProvider.ts
export class MyProvider implements vscode.TreeDataProvider<MyItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<MyItem | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
    
    refresh() { this._onDidChangeTreeData.fire(undefined); }
    getTreeItem(element: MyItem) { return element; }
    async getChildren() { return await this.gitService.getMyData(); }
}

// 2. Register in extension.ts
const myProvider = new MyProvider(gitService);
vscode.window.createTreeView('gitmaster.myView', { treeDataProvider: myProvider });

// 3. Add to package.json
"views": { "gitmaster": [{ "id": "gitmaster.myView", "name": "My View" }] }
```

### New Command
```typescript
// 1. Add to commands/myCommands.ts
async myAction(): Promise<void> {
    try {
        await this.gitService.doSomething();
        vscode.window.showInformationMessage('Success!');
    } catch (error) {
        vscode.window.showErrorMessage(`Failed: ${error}`);
    }
}

// 2. Register in extension.ts
vscode.commands.registerCommand('gitmaster.myAction', () => myCommands.myAction());

// 3. Add to package.json
"commands": [{ "command": "gitmaster.myAction", "title": "My Action" }]
```

### New Type
```typescript
// Add to types/git.ts
export interface TagInfo {
    name: string;
    commitHash: string;
    message?: string;
}
```

### New MCP Tool
```typescript
// 1. Add input type to mcp/types.ts (if needed)
export interface MyToolInput {
    param: string;
    optionalParam?: number;
}

// 2. Add tool definition to mcp/tools.ts GITMASTER_MCP_TOOLS array
{
    name: 'gitmaster_my_tool',
    description: 'What the tool does',
    inputSchema: {
        type: 'object',
        properties: {
            param: { type: 'string', description: 'Description' }
        },
        required: ['param']
    }
}

// 3. Add handler function in mcp/tools.ts
async function handleMyTool(
    args: Record<string, unknown>,
    deps: McpDependencies
): Promise<McpToolResponse> {
    const param = parseStringArg(args.param);
    // ... implementation
    return createTextResponse(result);
}

// 4. Add case in handleGitMasterMcpToolCall switch
case 'gitmaster_my_tool':
    return handleMyTool(args, deps);
```

---

## 🎨 Common Patterns

### Author Colors
```typescript
import { getAuthorColor } from '../utils/colorUtils';
const color = getAuthorColor(commit.author);
this.iconPath = new vscode.ThemeIcon('git-commit', color);
```

### Tree Item with Command
```typescript
this.command = {
    command: 'gitmaster.showCommitDiff',
    title: 'Show Commit',
    arguments: [this]
};
```

### Context Values (for menus)
```typescript
this.contextValue = 'commit';        // Regular commit
this.contextValue = 'stash';         // Stash item
this.contextValue = 'localBranch';   // Local branch
```

### Error Handling
```typescript
// Service: throw
async getData(): Promise<Data> {
    try {
        // ... git command
    } catch {
        throw new Error('Operation failed');
    }
}

// Command: catch and show
async action(): Promise<void> {
    try {
        await this.service.getData();
    } catch (error) {
        vscode.window.showErrorMessage(`Failed: ${error}`);
    }
}
```

### User Confirmations
```typescript
const answer = await vscode.window.showWarningMessage(
    'Delete branch?',
    { modal: true },
    'Delete'
);
if (answer !== 'Delete') return;
```

---

## 🔍 Quick Reference

### Most Edited Files
1. `services/git/*.ts` - Adding Git operations
2. `services/gitService.ts` - Exposing new Git operations via facade
3. `extension.ts` - Registering new features
4. `package.json` - Adding commands/views/menus

### Rarely Changed
- `types/git.ts` - Only for new data structures
- `utils/colorUtils.ts` - Stable utility
- `services/diffService.ts` - Stable diff logic
- `services/git/core.ts` - Git executor is stable

### Core Types (11)
`CommitInfo`, `ChangedFile`, `StashInfo`, `ReflogEntry`, `RepositoryCommit`, `BranchInfo`, `RebaseCommit`, `RebaseState`, `RebaseAction`, `GitWorktree`, `BlameInfo`

### Key Service Methods
- **File**: `getFileHistory`, `getFileContentAtCommit`, `isFileTracked`
- **Commit**: `getChangedFilesInCommit`, `getParentCommit`, `getCommitInfo`
- **Stash**: `getStashes`, `createStash`, `applyStash`, `popStash`, `deleteStash`
- **Branch**: `getBranches`, `checkoutBranch`, `createBranchFromCommit`, `deleteBranch`
- **Rebase**: `getCommitsAheadOfBase`, `isRebaseInProgress`, `continueRebase`, `abortRebase`
- **Worktree**: `getWorktrees`, `addWorktree`, `removeWorktree`, `pruneWorktrees`
- **Graph**: `getGraphCommits`
- **Contributors**: `getFileContributors`

---

## 💡 Development Tips

1. **Test Manually First**: Run Git commands in terminal before coding
2. **Use Large Buffers**: `maxBuffer: 10 * 1024 * 1024` for big repos
3. **Hot Reload**: Press F5 to test, Ctrl+R to reload
4. **Debug Console**: Check VS Code Debug Console for errors
5. **Edge Cases**: Test with empty repos, conflicts, detached HEAD

### Commands
```bash
npm run compile    # Build
npm run watch      # Auto-build
npm run package    # Create .vsix
npm run publish    # Publish to marketplace
npm test           # Run tests
```

---

## ✅ Pre-Commit Checklist

- [ ] Code compiles (`npm run compile`)
- [ ] All public methods have JSDoc
- [ ] Tested in real Git repository
- [ ] Updated README.md (if user-facing)
- [ ] Updated this file (if new patterns)
- [ ] Updated package.json (if new UI)

---

## 📚 Documentation Files

- **CODE_GUIDE.md** (this file) - Developer reference
- **README.md** - User documentation
- **BUILD.md** - Build, test, and publish commands
- **package.json** - VS Code configuration
- **.cursorrules** - AI development rules

---

**Remember**: Follow layer rules, document as you go, keep it simple!
