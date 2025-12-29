# Change Log

## [0.0.16] - 2025-12-24
### 📌 Shelf Management
- **Pin/Unpin Shelves**: Pin your favorite or important shelves to keep them at the top of the list.
  - 📍 **Visual Indicator**: Pinned shelves show a pin icon with blue color.
  - 🔒 **Persistent State**: Pin state is saved per repository and persists across sessions.
  - 🔄 **Smart Sorting**: Pinned shelves always appear first, followed by newest shelves.
### ⚡ Performance
- **Shelves view**: Reduced total git operations by reusing parsed stash `--numstat` results, caching stash file lists, and using a single `git status --porcelain` call for conflict detection.
- **Inline Git Blame**: Fixed error when clicking "View Commit Details" on uncommitted changes. Now properly shows working directory diff using VS Code's built-in diff view instead of trying to fetch an invalid commit.

### ⚠️ Conflict Detection
- **Smart Conflict Warnings**: Automatically detects when a shelf would conflict with your current working directory changes.
  - ⚠️ **Visual Warning**: Conflicting shelves display a warning icon (highest priority).
  - 📝 **Conflict Details**: Tooltip shows list of conflicting files (up to 5 files displayed).
  - 🛡️ **Prevent Data Loss**: Helps avoid failed operations and unexpected overwrites.

### 📊 Enhanced Shelf Information
- **Detailed Statistics**: Each shelf now displays comprehensive change information.
  - ➕➖ **Line Stats**: Shows additions and deletions (+X -Y) for all changes.
  - ⏰ **Relative Time**: Displays human-readable time (e.g., "2 hours ago").
  - 🎨 **Age-Based Icons**: Visual indicators based on shelf age:
    - 📥 Fresh (<24h): Green inbox icon
    - 📦 Recent (<7d): Blue archive icon
    - 📦 Week-old (<30d): Yellow package icon
    - 📦 Old (≥30d): Orange archive icon

## [0.0.15] - 2025-12-21
### ✨ New Features
- **MCP (Cursor integration)**: Added 2 new MCP tools for agents:
  - `gitmaster_file_experts` - Find top contributors/experts for any file based on commit history
  - `gitmaster_show_file_history` - Open the File History view for a specific file

### 🔧 Changes
- **MCP server disabled by default**: The MCP server is now off by default for better security and resource usage. To enable it:
  1. Open VS Code Settings (**Cmd+,** or **Ctrl+,**)
  2. Search for `gitmaster.mcp.enabled`
  3. Check the box to enable MCP
  4. Run **GitMaster: Install MCP in Cursor** command to configure Cursor

## [0.0.14] - 2025-12-20
### ✨ New Features
- **MCP (Cursor integration)**: Added 3 MCP tools for agents:
  - `gitmaster_commit_explain`
  - `gitmaster_show_git_graph`
  - `gitmaster_shelves`

### 📚 Documentation
- Added a short README section explaining how to configure and use **MCP (Cursor integration)**.

## [0.0.13] - 2025-12-06
### 🚀 Improved Git Graph
- **Overhauled Visualization**: A stunning new UI with glassmorphism, infinite scroll, smart layout, unique author colors, and enhanced interactions for the best git history experience.

### ✨ New Features
- **Git Operations - Group by Date**: Toggle button to group reflog entries by time periods (Today, Yesterday, Last Week, etc.) for easier navigation.
- **Git Operations - Dangerous Operation Highlighting**: Reset and force push operations are now highlighted in red for better visibility.

## [0.0.12] - 2025-12-05
### ✨ New Features
- **Explain with AI**: Investigate commits faster with AI.
  - 🤖 **Context-Aware**: Automatically copies the commit message and full code diff to your clipboard.
  - 🚀 **Universal Support**: Works with GitHub Copilot, Cursor AI, and ChatGPT.
  - 🧠 **Smart Prompt**: Generates a prompt that asks for an explanation of "why" and "what" changed.

### 🚀 Improvements
- **Inline Git Blame**: Clicking on blame annotation now opens the diff and automatically scrolls to the relevant line.
- **Commit Details**: Added "Copy Commit ID" action to the view title for quick access.

### 🐛 Bug Fixes
- **Windows Compatibility**: Automatically detects Git executable in standard installation paths if not found in system PATH.

## [0.0.11] - 2025-11-27
### ✨ New Features
- **Inline Git Blame**: See who changed a line right in your editor.
  - 👤 **Inline Annotations**: View author, relative time, and message for the current line.
  - 🖼️ **Author Avatars**: Hover to see the contributor's avatar (Gravatar).
  - 🖱️ **Interactive**: Click to view detailed commit info and full diff.
  - 🔄 **History Navigation**: Works seamlessly in diff views to trace changes back in time.
  - 🏷️ **Rename Tracking**: Correctly follows files through renames.
  - ⚙️ **Configurable**: Toggle blame inline annotations via settings.

### ⚙️ Configuration
- **gitmaster.blame.enabled**: Toggle inline blame annotations (default: `true`).
- **gitmaster.views.showGitOperations**: Toggle Git Operations (Reflog) view visibility (default: `true`).

## [0.0.10] - 2025-11-26
### ✨ New Features
- **Git Worktrees Support**: Complete workflow for managing git worktrees.
  - 🌳 **Visual View**: See all worktrees (Main, Current, Linked) in the side panel.
  - ➕ **Create Worktree**: Easily create new worktrees with automatic folder naming.
  - 📂 **Open in New Window**: One-click access to switch contexts.
  - 🗑️ **Safe Removal**: Delete worktrees with built-in protection for the main/active worktree.
  - 🧹 **Prune**: Clean up stale worktree references.

### 🔧 Improvements
- Improved "Open Worktree" visibility logic (hidden for current worktree).
- Streamlined worktree creation workflow (auto-detects parent folder).

## [0.0.9] - Initial Release
### 🚀 Features
- **File History**: Track changes per file with syntax-highlighted diffs.
- **Git Graph**: Interactive visualization of branches and merges.
- **Shelves**: WebStorm-style named stashes for better WIP management.
- **Git Log**: Searchable repository history with author filtering.
- **Reflog**: Visual history of all git operations (time travel).
- **Branch Management**: Create, delete, and filter branches by author.
- **Interactive Rebase**: Visual tool for squashing, rewording, and managing commits.
- **Author Tracking**: Color-coded visualization of contributors across all views.

