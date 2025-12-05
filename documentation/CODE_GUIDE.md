# GitMaster Developer Guide

Quick reference for developers. Read this first, then explore the code.

---

## 🏗️ Architecture

```
src/
├── extension.ts           # Registration only (NO business logic)
├── types/git.ts          # All interfaces (9 types)
├── services/             # Git operations (throw errors)
│   ├── gitService.ts     # All Git commands
│   └── diffService.ts    # Diff views
├── providers/            # TreeDataProvider (UI, use services)
│   ├── fileHistoryProvider.ts
│   ├── commitDetailsProvider.ts
│   ├── shelvesProvider.ts
│   ├── branchesProvider.ts
│   ├── repositoryLogProvider.ts
│   ├── reflogProvider.ts
│   └── rebaseProvider.ts
├── commands/             # Orchestration (catch errors, show messages)
│   ├── commitCommands.ts
│   ├── stashCommands.ts
│   ├── branchCommands.ts
│   ├── repositoryLogCommands.ts
│   ├── reflogCommands.ts
│   └── rebaseCommands.ts
└── utils/
    └── colorUtils.ts     # Author colors
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
| **providers/** | Display data, use services | Execute Git directly |
| **commands/** | Catch errors, show messages | Contain business logic |
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
| Rebase | rebaseProvider | rebaseCommands | getRebaseCommits |

---

## 🎯 Adding Features

### New Git Operation
```typescript
// 1. Add to services/gitService.ts
async getCommitAuthor(hash: string): Promise<string> {
    const { stdout } = await execAsync(
        `git show -s --format=%an ${hash}`,
        { cwd: await this.getRepoRoot() }
    );
    return stdout.trim();
}

// 2. Use in command/provider
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
1. `services/gitService.ts` - Adding Git operations
2. `extension.ts` - Registering new features
3. `package.json` - Adding commands/views/menus

### Rarely Changed
- `types/git.ts` - Only for new data structures
- `utils/colorUtils.ts` - Stable utility
- `services/diffService.ts` - Stable diff logic

### Core Types (9)
`CommitInfo`, `ChangedFile`, `StashInfo`, `ReflogEntry`, `RepositoryCommit`, `BranchInfo`, `RebaseCommit`, `RebaseState`, `RebaseAction`

### Key Service Methods
- **File**: `getFileHistory`, `getFileContentAtCommit`, `isFileTracked`
- **Commit**: `getChangedFilesInCommit`, `getParentCommit`, `getCommitDetails`
- **Stash**: `getStashes`, `createStash`, `applyStash`, `popStash`, `dropStash`
- **Branch**: `getBranches`, `checkoutBranch`, `createBranch`, `deleteBranch`
- **Rebase**: `getRebaseCommits`, `isRebaseInProgress`, `continueRebase`, `abortRebase`

---

## 💡 Development Tips

1. **Test Manually First**: Run Git commands in terminal before coding
2. **Use Large Buffers**: `maxBuffer: 10 * 1024 * 1024` for big repos
3. **Hot Reload**: Press F5 to test, Ctrl+R to reload
4. **Debug Console**: Check VS Code Debug Console for errors
5. **Edge Cases**: Test with empty repos, conflicts, detached HEAD

### Commands
```bash
npm run build      # Build
npm run watch      # Auto-build
npm run package    # Create .vsix
npm run publish    # Publish to marketplace
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
