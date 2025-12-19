# Change Log

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

