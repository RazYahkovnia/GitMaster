# GitMaster Extension Architecture

## Overview

GitMaster is a VS Code extension that provides advanced Git features, including file history visualization and commit details viewing. The codebase is organized into clear, modular layers for maintainability and testability.

## Project Structure

```
src/
├── extension.ts              # Main entry point (registration only)
├── types/
│   └── git.ts               # Shared type definitions
├── services/
│   ├── gitService.ts        # Git operations (exec git commands)
│   └── diffService.ts       # Diff operations (show file diffs)
├── providers/
│   ├── fileHistoryProvider.ts    # File History tree view provider
│   └── commitDetailsProvider.ts  # Commit Details tree view provider
└── commands/
    └── commitCommands.ts    # Command handlers for commit operations
```

## Architecture Layers

### 1. Types (`types/`)

**Purpose**: Define shared interfaces and types used across the extension.

**Files**:
- `git.ts`: Git-related types
  - `CommitInfo`: Information about a git commit
  - `ChangedFile`: Information about a file changed in a commit

### 2. Services (`services/`)

**Purpose**: Handle business logic and external interactions (Git operations, diff generation).

**Files**:

#### `gitService.ts`
Handles all Git repository operations:
- `getRepoRoot()`: Find the git repository root
- `isFileTracked()`: Check if a file is tracked by Git
- `getFileHistory()`: Get commit history for a file
- `getFileContentAtCommit()`: Get file content at a specific commit
- `getParentCommit()`: Get the parent commit hash
- `getChangedFilesInCommit()`: Get all files changed in a commit
- `getGitHubRepoUrl()`: Get the GitHub URL from remote origin

**Key Features**:
- Handles renamed files with proper path parsing
- Detects file statuses (Added, Modified, Deleted, Renamed)
- Normalizes GitHub URLs to HTTPS format

#### `diffService.ts`
Handles diff view generation:
- `showFileDiff()`: Main entry point to show a diff
- Handles different file statuses (added, modified, deleted, renamed)
- Creates VS Code diff views with proper titles
- Uses `DiffContentProvider` for content rendering

### 3. Providers (`providers/`)

**Purpose**: Implement VS Code tree view providers for the sidebar UI.

**Files**:

#### `fileHistoryProvider.ts`
Displays commit history for the currently active file:
- Shows list of commits that touched the file
- Updates automatically when switching files
- Each item is clickable to show commit details

#### `commitDetailsProvider.ts`
Displays detailed information about a selected commit:
- Shows commit metadata (message, author, date, hash)
- Lists all files changed in the commit
- Shows file statistics (+additions, -deletions)
- Displays "Open in GitHub" link if available
- Color-coded icons for file statuses

### 4. Commands (`commands/`)

**Purpose**: Handle VS Code command execution and orchestrate services.

**Files**:

#### `commitCommands.ts`
Handles commit-related commands:
- `showCommitDetails()`: Show commit info in sidebar + open diff
- `showFileDiff()`: Show diff for a specific file
- `openCommitInGitHub()`: Open commit in GitHub

### 5. Extension Entry Point (`extension.ts`)

**Purpose**: Register all components and initialize the extension.

**Structure**:
1. `activate()`: Extension activation entry point
2. `initializeServices()`: Create service instances
3. `registerTreeViews()`: Register sidebar tree views
4. `registerCommands()`: Register all commands
5. `registerEventListeners()`: Listen to editor changes
6. `deactivate()`: Cleanup on deactivation

## Data Flow

### Viewing Commit History

```
User opens a file
    ↓
extension.ts: updateFileHistory()
    ↓
fileHistoryProvider.setCurrentFile()
    ↓
gitService.getFileHistory()
    ↓
Display commits in sidebar
```

### Viewing Commit Details

```
User clicks commit in File History
    ↓
Command: gitmaster.showCommitDiff
    ↓
commitCommands.showCommitDetails()
    ↓
├─→ gitService.getChangedFilesInCommit()
│   ↓
│   commitDetailsProvider.setCommit()
│   (Update sidebar with commit details)
│
└─→ diffService.showFileDiff()
    ↓
    ├─→ gitService.getFileContentAtCommit() (parent)
    ├─→ gitService.getFileContentAtCommit() (current)
    └─→ Show VS Code diff view
```

### Viewing File Diff from Commit Details

```
User clicks file in Commit Details
    ↓
Command: gitmaster.showFileDiff
    ↓
commitCommands.showFileDiff()
    ↓
diffService.showFileDiff()
    ↓
Show VS Code diff view
```

## Key Design Decisions

### 1. Separation of Concerns
- **Services**: Pure business logic, no VS Code UI dependencies
- **Providers**: VS Code tree view implementations
- **Commands**: Orchestration layer connecting UI to services

### 2. Type Safety
- Centralized type definitions in `types/`
- All Git-related data structures are strongly typed
- Prevents type duplication across files

### 3. Error Handling
- Services throw errors with descriptive messages
- Commands catch errors and show user-friendly notifications
- Git command failures are handled gracefully

### 4. File Status Handling
Special handling for:
- **Renamed files** (R): Parse both old and new paths
- **Deleted files** (D): Show content from parent commit only
- **Added files** (A): Show empty content for parent
- **Modified files** (M): Show both versions

### 5. Performance Considerations
- File history updates only on active editor change
- Lazy loading of commit details (only when clicked)
- Efficient Git commands with appropriate flags (`--follow`, `-M` for renames)

## Adding New Features

### To add a new Git operation:
1. Add method to `GitService` (`services/gitService.ts`)
2. Add types if needed (`types/git.ts`)
3. Update relevant provider or create new one
4. Register command in `extension.ts`

### To add a new command:
1. Add method to `CommitCommands` (`commands/commitCommands.ts`)
2. Register in `extension.ts` (`registerCommands()`)
3. Add to `package.json` `contributes.commands`

### To add a new view:
1. Create provider in `providers/`
2. Register in `extension.ts` (`registerTreeViews()`)
3. Add to `package.json` `contributes.views`

## Testing Strategy

### Unit Tests (Recommended)
- Test `GitService` methods with mock exec
- Test `DiffService` with mock GitService
- Test command handlers with mock services

### Integration Tests (Recommended)
- Test complete flows with real Git repository
- Test UI interactions with VS Code test framework

## Dependencies

- **VS Code API**: UI components, commands, tree views
- **Node.js**: `child_process` for executing Git commands
- **TypeScript**: Type safety and modern JavaScript features

## Future Improvements

1. **Caching**: Cache commit history to reduce Git calls
2. **Batch Operations**: Load multiple commits at once
3. **Search**: Search through commit history
4. **Filters**: Filter commits by author, date, message
5. **Branch Comparison**: Compare branches visually
6. **Stash Management**: View and manage stashes
7. **Tests**: Add comprehensive unit and integration tests

