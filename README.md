# GitMaster 🎯

> **Advanced Git visualization and management for VS Code**

Stop wrestling with Git commands in the terminal. GitMaster brings powerful Git features directly into your VS Code sidebar with beautiful visualizations, intuitive controls, and author color-coding across all views.

Perfect for developers who want to understand their repository's history, manage branches efficiently, and work with stashes visually.

## ✨ Key Features

### 📜 **File History - Know Your Code's Story**

Ever wonder when a line was changed or who modified a file? Open any file and instantly see its complete commit history.

- 🎨 **Color-coded by author** - spot patterns at a glance
- 🔍 **Click any commit** to view the exact changes
- 📋 **Copy commit IDs** with one click
- ⚡ **Auto-updates** when switching files
- 🕐 **Relative dates** - "2 hours ago" is clearer than timestamps

### 📦 **Shelves - Stash with Style**

WebStorm-inspired stash management. Save your work-in-progress changes with meaningful names.

- ✍️ **Named stashes** - no more "stash@{0}" confusion
- 👁️ **Preview changes** - see what's in each shelf before applying
- 📊 **File counts** - know how much is stashed
- ⚠️ **Smart warnings** - won't let you lose work
- 🗂️ **Include untracked** - stash those new files too

### 🌿 **Branches - Your Way**

Tired of seeing everyone's branches? Filter to show only what matters to you.

- 👤 **"My Branches" filter** - one click to see only yours
- 🔍 **Filter by any author** - focus on specific team members
- 🎨 **Color-coded by author** - visual organization
- ✓ **Current branch** highlighted
- ☁️ **Remote branches** with smart checkout
- ➕ **Create & delete** branches visually
- 📅 **Sorted by activity** - recent work first

### 📊 **Git Log - Repository Timeline**

View your repository's recent history and perform advanced Git operations without typing commands.

- 🎨 **Author colors** throughout
- 🔄 **Revert in new branch** - safe commit reversal
- 🍒 **Cherry-pick** with conflict detection
- 🌿 **Create branches** from any commit
- ⏪ **Checkout** to any point in history
- 🛡️ **Uncommitted changes** warnings

### 🔄 **Git Operations - Time Travel**

View your Git reflog (every action you've taken) with beautiful icons and descriptions.

- 📝 Commits
- 🌿 Checkouts  
- ☁️ Pulls
- 🔀 Merges
- 📚 Rebases
- ❌ Resets
- 🍒 Cherry-picks

Jump back to any point in your repository's history with one click.

## 🎨 Why GitMaster?

**🌈 Author Color-Coding Everywhere**  
The same author gets the same color across File History, Branches, and Git Log. Spot who did what instantly.

**🎭 Theme-Aware**  
Works beautifully in both light and dark themes. Colors automatically adapt.

**🖱️ Mouse-Driven Workflow**  
Stop memorizing Git commands. Everything is point-and-click.

**🛡️ Safe by Default**  
Warns before destructive operations. Validates inputs. Shows what will happen.

## 🚀 Quick Start

1. **Install** GitMaster from the Extensions panel
2. **Open** any Git repository
3. **Click** the Git Master icon in the sidebar (Activity Bar)
4. **Explore!** All your Git data is now visual and interactive

> **💡 Tip:** No configuration needed. GitMaster works out of the box with any Git repository.

## 📖 Common Workflows

### 🔍 "When was this line changed?"
1. Open the file
2. Click a commit in File History
3. See the exact diff with that change highlighted

### 📦 "Save my work but switch branches"
1. Click **+** in Shelves
2. Name it (e.g., "WIP: login feature")
3. Switch branches freely
4. Come back and click **Pop** to restore

### 🌿 "Show me only my branches"
1. Expand Branches
2. Click the **👤** (My Branches) icon
3. Work without distraction from 50 team branches

### 🔄 "Undo that commit, but safely"
1. Find the commit in Git Log
2. Right-click → "Revert in New Branch"
3. Name your revert branch
4. Review the revert, then merge when ready

### 🍒 "I need just that one commit"
1. Find it in Git Log
2. Click "Cherry Pick"
3. GitMaster applies it and warns if there are conflicts

## 💻 System Requirements

- **Git** installed and in your PATH
- **VS Code** 1.85.0 or newer
- Any **Git repository**

That's it! GitMaster works with any Git repo - no additional setup required.

## ❓ FAQ

**Q: Will this work with GitHub/GitLab/Bitbucket?**  
A: Yes! GitMaster works with any Git repository, regardless of where it's hosted.

**Q: Does it support mono-repos?**  
A: Absolutely. GitMaster works great with large repositories.

**Q: Can I use it with Git worktrees?**  
A: Yes, each worktree is treated as its own repository.

**Q: Does it work with VS Code's built-in Git features?**  
A: Yes! GitMaster complements (doesn't replace) VS Code's Git features. Use both together.

**Q: Is my Git history safe?**  
A: Yes. GitMaster only reads your Git data for most operations. For write operations (like creating branches or stashing), it asks for confirmation first.

## 🆚 GitMaster vs. Git Command Line

| Feature | Command Line | GitMaster |
|---------|-------------|-----------|
| View file history | `git log --follow <file>` | Click file → see history |
| Stash with name | `git stash push -m "name"` | Click + → type name |
| Filter branches by author | `git branch -a \| grep ...` + bash scripting | Click 👤 icon |
| Cherry-pick safely | `git cherry-pick` + check conflicts | Click commit → auto conflict detection |
| View reflog | `git reflog` → parse output | Beautiful timeline with icons |

**GitMaster makes Git visual, intuitive, and safe.**

## 🐛 Found a Bug?

Please [open an issue](https://github.com/yourusername/gitmaster/issues) with:
- What you were trying to do
- What happened instead
- Your VS Code version
- Your Git version (`git --version`)

## 🌟 Love GitMaster?

- ⭐ **Star** the repository
- ✍️ **Leave a review** on the marketplace
- 📢 **Tell your team** about it
- 🐦 **Tweet** about your favorite feature

## 📝 License

MIT License - Free to use in personal and commercial projects.

---

<div align="center">

**Made with ❤️ for developers who love Git**

*Because visual Git is better Git*

[Report Bug](https://github.com/yourusername/gitmaster/issues) • [Request Feature](https://github.com/yourusername/gitmaster/issues) • [Discussions](https://github.com/yourusername/gitmaster/discussions)

</div>
