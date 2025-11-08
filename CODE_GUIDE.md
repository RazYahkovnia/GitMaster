# GitMaster Code Guide

Quick reference for understanding the codebase.

## File Structure

```
src/
├── extension.ts                           # 🚀 START HERE - Main entry point
│
├── types/                                 # 📝 Type Definitions
│   └── git.ts                            # CommitInfo, ChangedFile interfaces
│
├── services/                             # ⚙️ Business Logic
│   ├── gitService.ts                     # All Git operations (exec commands)
│   └── diffService.ts                    # Show file diffs in VS Code
│
├── providers/                            # 📊 UI Components (Sidebar)
│   ├── fileHistoryProvider.ts           # "File History" tree view
│   └── commitDetailsProvider.ts         # "Commit Details" tree view
│
└── commands/                             # 🎯 Command Handlers
    └── commitCommands.ts                 # Handles user actions on commits
```

## Quick File Reference

### 🚀 `extension.ts` (150 lines)
**What it does**: Entry point that wires everything together  
**Key functions**:
- `activate()` - Initialize extension
- `registerTreeViews()` - Setup sidebar views
- `registerCommands()` - Register all commands
- `registerEventListeners()` - Listen to file changes

**When to edit**: Adding new views, commands, or services

---

### 📝 `types/git.ts` (30 lines)
**What it does**: Defines data structures  
**Types**:
- `CommitInfo` - Commit data (hash, message, author, date)
- `ChangedFile` - File data (path, status, additions, deletions)

**When to edit**: Adding new Git-related data structures

---

### ⚙️ `services/gitService.ts` (300 lines)
**What it does**: Executes Git commands and parses results  
**Key methods**:
- `getRepoRoot()` - Find Git repo root
- `getFileHistory()` - Get commits for a file
- `getFileContentAtCommit()` - Get file at specific commit
- `getChangedFilesInCommit()` - Get all changed files in commit
- `getGitHubRepoUrl()` - Get GitHub URL

**When to edit**: Adding new Git operations

---

### ⚙️ `services/diffService.ts` (160 lines)
**What it does**: Creates and displays file diffs  
**Key methods**:
- `showFileDiff()` - Main method to show diff
- `getLeftSideContent()` - Get parent commit content
- `getRightSideContent()` - Get current commit content
- `openDiffView()` - Open VS Code diff viewer

**When to edit**: Changing diff display logic

---

### 📊 `providers/fileHistoryProvider.ts` (110 lines)
**What it does**: Shows commit history for active file  
**Key methods**:
- `setCurrentFile()` - Update when file changes
- `getChildren()` - Return commit list
- `refresh()` - Reload the view

**When to edit**: Changing how commits are displayed in sidebar

---

### 📊 `providers/commitDetailsProvider.ts` (145 lines)
**What it does**: Shows details of selected commit  
**Key methods**:
- `setCommit()` - Load commit details
- `getChildren()` - Return commit info + file list

**When to edit**: Changing commit details UI

---

### 🎯 `commands/commitCommands.ts` (90 lines)
**What it does**: Handles user actions (clicking commits/files)  
**Key methods**:
- `showCommitDetails()` - When user clicks a commit
- `showFileDiff()` - When user clicks a file
- `openCommitInGitHub()` - When user clicks GitHub link

**When to edit**: Adding new user interactions

---

## Common Tasks

### Adding a New Git Command

1. Add method to `services/gitService.ts`:
```typescript
async getMyNewData(commitHash: string): Promise<MyType> {
    const { stdout } = await execAsync(`git my-command ${commitHash}`);
    return this.parseMyData(stdout);
}
```

2. Use it in a command or provider

### Adding a New UI View

1. Create provider in `providers/myNewProvider.ts`
2. Register in `extension.ts`:
```typescript
const myView = vscode.window.createTreeView('gitmaster.myView', {
    treeDataProvider: myNewProvider
});
```

3. Add to `package.json`:
```json
"views": {
    "gitmaster": [
        {
            "id": "gitmaster.myView",
            "name": "My View"
        }
    ]
}
```

### Adding a New Command

1. Add method to `commands/commitCommands.ts`
2. Register in `extension.ts`:
```typescript
const myCommand = vscode.commands.registerCommand(
    'gitmaster.myCommand',
    async () => await commitCommands.myAction()
);
```

3. Add to `package.json`:
```json
"commands": [
    {
        "command": "gitmaster.myCommand",
        "title": "My Command"
    }
]
```

## Code Flow Examples

### User Opens a File
```
extension.ts: onDidChangeActiveTextEditor
    ↓
updateFileHistory()
    ↓
fileHistoryProvider.setCurrentFile()
    ↓
gitService.getFileHistory()
    ↓
Sidebar updates with commits
```

### User Clicks a Commit
```
Click commit in sidebar
    ↓
Command: gitmaster.showCommitDiff
    ↓
commitCommands.showCommitDetails()
    ↓
├─ gitService.getChangedFilesInCommit()
│  → commitDetailsProvider.setCommit()
└─ diffService.showFileDiff()
   → Open diff in editor
```

### User Clicks a File in Commit Details
```
Click file in Commit Details
    ↓
Command: gitmaster.showFileDiff
    ↓
commitCommands.showFileDiff()
    ↓
diffService.showFileDiff()
    ↓
├─ gitService.getFileContentAtCommit() (parent)
├─ gitService.getFileContentAtCommit() (current)
└─ VS Code diff view opens
```

## Key Concepts

### File Status Codes
- **A** - Added (new file)
- **M** - Modified (changed file)
- **D** - Deleted (removed file)
- **R** - Renamed (moved/renamed file)

### Handling Renames
When a file is renamed, Git shows it as `oldfile => newfile`.  
We parse this in `gitService.parseRenamedPath()` to extract both paths.

### Diff Display
For different statuses:
- **Added**: Empty file vs new content
- **Modified**: Old content vs new content
- **Deleted**: Old content vs empty file
- **Renamed**: Old file content vs new file content

## Debugging Tips

1. **Check Git commands**: Look at `gitService.ts` to see exact Git commands
2. **Log output**: Add `console.log()` in command handlers
3. **Debug Console**: Check "Debug Console" in VS Code when running extension
4. **Git output**: Test Git commands manually in terminal first

## Best Practices

1. ✅ Keep services pure (no VS Code API calls)
2. ✅ Handle errors in command handlers
3. ✅ Use TypeScript types everywhere
4. ✅ Add JSDoc comments for public methods
5. ✅ Keep functions small and focused
6. ✅ Use descriptive variable names
7. ✅ Extract magic strings/numbers to constants

