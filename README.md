# GitMaster

**GitMaster** is a powerful VS Code extension that provides advanced Git visualization and management features to supercharge your development workflow.

## ✨ Features

### 📜 **File History**
- View complete commit history for any open file
- See commit messages, authors, dates, and hashes
- Click any commit to view the diff
- **Author Color Coding**: Each author's commits appear in a unique color
- Copy commit IDs with one click
- Automatically updates when switching files

### 📋 **Commit Details**
- View all files changed in a selected commit
- See file status (Added, Modified, Deleted, Renamed)
- View additions/deletions count per file
- Click files to see their diffs
- Open commit in GitHub directly
- Smart handling of renamed and deleted files

### 📦 **Shelves (Stash Management)**
- Create named stashes (shelves) for your changes
- Apply or pop shelves with one click
- Delete unwanted shelves
- View file count for each shelf
- See what changed in stashed files
- Warns about uncommitted changes before operations
- Option to include untracked files

### 🌿 **Branches**
- View all branches sorted by recent activity
- **Author Filtering**: 
  - Filter by your branches
  - Filter by any author
  - Show all branches
- Visual indicators:
  - ✓ Current branch
  - 🌿 Local branches
  - ☁️ Remote branches
- **Author Color Coding**: Branch icons colored by last commit author
- Quick checkout to any branch
- Delete local branches (with force option)
- Create new branches
- Smart remote branch handling

### 📊 **Git Log**
- View last 20 repository commits
- **Author Color Coding**: Commits colored by author
- Revert commit in new branch
- Checkout to any commit
- Cherry-pick commits
- Create branch from commit
- Branch name validation
- Conflict detection for cherry-picks

### 🔄 **Git Operations (Reflog)**
- View git reflog (operation history)
- Smart icons for different operations:
  - 📝 Commit, 🌿 Checkout, ☁️ Pull, 🔀 Merge
  - 📚 Rebase, ❌ Reset, 🍒 Cherry-pick
- Checkout to any point in history
- Uncommitted changes warnings

## 🎨 Visual Features

- **Consistent Author Colors**: Same author = same color across all views
- **Theme-Aware**: Colors adapt to your VS Code theme (light/dark)
- **Smart Icons**: Different icons for different states and operations
- **Collapsible Sections**: Keep your sidebar organized

## 🚀 Getting Started

1. Install the extension from the VS Code Marketplace
2. Open any Git repository in VS Code
3. Click the **Git Master** icon in the Activity Bar
4. Start exploring your repository!

## 📖 Usage Guide

### Viewing File History
1. Open any file in a Git repository
2. The File History section shows all commits that modified this file
3. Click a commit to see what changed
4. Right-click to copy commit ID

### Managing Shelves
1. Make some changes in your working directory
2. Click the **+** button in Shelves section
3. Enter a descriptive name for your shelf
4. Apply (keeps the shelf) or Pop (applies and removes)
5. Click any file in a shelf to see what changed

### Filtering Branches
1. Expand the Branches section
2. Click the **👤** icon to see only your branches
3. Click the **🔍** icon to filter by any author
4. Click the **❌** icon to show all branches

### Working with Git Log
1. Expand the Git Log section
2. Click any commit to:
   - Revert it in a new branch
   - Checkout to that commit
   - Cherry-pick it
   - Create a branch from it

## ⚙️ Requirements

- **Git**: Must be installed and accessible from command line
- **VS Code**: Version 1.85.0 or higher
- **Repository**: Must be working within a Git repository

## 🎯 Keyboard-Free Operations

All operations are accessible via mouse clicks:
- Click commits to view diffs
- Right-click for context menus
- Toolbar buttons for common actions
- No need to remember Git commands!

## 🛡️ Safety Features

- Warns before operations that might lose work
- Prevents deleting current branch
- Confirms destructive operations
- Shows conflict warnings
- Validates branch names
- Smart handling of remote branches

## 🏗️ Architecture

GitMaster follows a clean, modular architecture:
- **Types**: Shared interfaces
- **Services**: Business logic (Git operations)
- **Providers**: Tree view data providers
- **Commands**: User action handlers
- **Extension**: Registration and orchestration

See `ARCHITECTURE.md` for detailed documentation.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

## 📝 License

MIT License - see [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

Built with ❤️ for developers who love Git but want a better visual experience.

---

**Enjoy using GitMaster!** If you find it useful, please ⭐ star the repository and leave a review!
