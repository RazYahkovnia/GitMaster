# Publishing GitMaster

Quick reference for building, testing, and publishing the extension.

---

## 🔨 Build & Package

```bash
# Compile TypeScript
npm run compile

# Create .vsix package
npm run package
# Creates: gitmaster-X.X.X.vsix
```

---

## 🧪 Test Locally

```bash
# Install in Cursor/VS Code
code --install-extension gitmaster-0.0.7.vsix

# Or in Cursor specifically
cursor --install-extension gitmaster-0.0.7.vsix

# Uninstall if needed
code --uninstall-extension razyahkovnia.gitmaster
```
