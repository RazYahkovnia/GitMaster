# GitMaster Extension - Development Rules

## File Structure
```
src/
├── types/          # Interfaces only (no logic)
├── services/       # Business logic (NO VS Code API except diffService)
├── providers/      # TreeDataProvider (use services for data)
├── commands/       # Orchestration (catch errors, show messages)
└── extension.ts    # Registration only (NO business logic)
```

## Layer Responsibilities

| Layer | Do | Don't |
|-------|----|----|
| **types/** | Define interfaces with JSDoc | Add implementation |
| **services/** | Execute Git, throw errors | Use VS Code API (except diffService) |
| **providers/** | Display data, fire refresh | Execute Git directly |
| **commands/** | Catch errors, show messages | Contain business logic |
| **extension.ts** | Register views/commands | Add business logic |

---

## Adding Features

### New Git Operation
1. Add type to `types/git.ts` (if needed) with JSDoc
2. Add method to `services/gitService.ts` with JSDoc
3. Add unit test in `tests/unit/gitService.test.ts`
4. Use in commands/providers
5. Update `CODE_GUIDE.md` feature matrix

### New Tree View
1. Create provider in `providers/myProvider.ts` with JSDoc
2. Register in `extension.ts` → `registerTreeViews()`
3. Add to `package.json` → `contributes.views`
4. Add e2e test in `tests/e2e/myFeature.test.ts`
5. Update `CODE_GUIDE.md` provider section
6. Update `README.md` with user workflow

### New Command
1. Add to `commands/myCommands.ts` with JSDoc
2. Register in `extension.ts` → `registerCommands()`
3. Add to `package.json` → `contributes.commands` & menus
4. Add unit test in `tests/unit/commands/myCommands.test.ts`
5. Update `README.md` if user-facing

---

## Documentation Rules

### Always Update
- **JSDoc** - All public methods and interfaces
- **CODE_GUIDE.md** - New patterns, architecture changes
- **README.md** - User-facing features only
- **package.json** - All UI elements (commands/views/menus)

### JSDoc Template
```typescript
/**
 * Brief description of what it does
 * @param paramName - What this parameter is
 * @returns What it returns
 * @throws Error description
 */
```

---

## Testing Rules

### When to Add Tests

**Unit Tests** (Mock dependencies):
- ✅ All new service methods in `gitService.ts`
- ✅ All command handlers with complex logic
- ✅ Utility functions in `utils/`
- ❌ Simple getters/setters
- ❌ VS Code API calls (mock them instead)

**E2E Tests** (Real Git repos):
- ✅ New tree view providers
- ✅ Critical user workflows
- ✅ Git operations with side effects
- ❌ Every minor UI change

### Test Structure

```typescript
// Unit Test - tests/unit/services/gitService.test.ts
describe('GitService', () => {
    it('should parse commit history correctly', async () => {
        // Arrange: Mock exec
        // Act: Call method
        // Assert: Check result
    });
});

// E2E Test - tests/e2e/myFeature.test.ts
describe('MyFeature', () => {
    it('should display data correctly', async () => {
        // Arrange: Create temp git repo
        // Act: Trigger provider
        // Assert: Check tree items
    });
});
```

---

## Code Standards

- **Error Handling**: Services throw, commands catch
- **Async/Await**: For all I/O operations
- **Naming**: camelCase files, PascalCase classes/interfaces
- **Buffer Size**: `maxBuffer: 10 * 1024 * 1024` for Git commands
- **Imports**: Relative paths, group by layer

## Common Patterns

```typescript
// Service method
async myGitOperation(): Promise<Data> {
    const { stdout } = await execAsync('git command', { 
        cwd: await this.getRepoRoot(),
        maxBuffer: 10 * 1024 * 1024 
    });
    return this.parseOutput(stdout);
}

// Command handler
async myAction(): Promise<void> {
    try {
        const result = await this.service.getData();
        this.provider.refresh();
        vscode.window.showInformationMessage('Success!');
    } catch (error) {
        vscode.window.showErrorMessage(`Failed: ${error}`);
    }
}

// Provider refresh
refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
}
```

---

## Pre-Commit Checklist

When making changes, ensure:
- [ ] Code compiles (`npm run compile`)
- [ ] All public methods have JSDoc
- [ ] Added appropriate tests (unit/e2e)
- [ ] Tests pass (`npm test`)
- [ ] Updated CODE_GUIDE.md (if architecture/patterns changed)
- [ ] Updated README.md (if user-facing)
- [ ] Updated package.json (if new UI elements)
- [ ] No business logic in extension.ts
- [ ] Services don't use VS Code API (except diffService)

---

## Don't

- ❌ Business logic in `extension.ts`
- ❌ VS Code API in services (except diffService)
- ❌ Duplicate types across files
- ❌ Silent error catching
- ❌ Direct Git calls in providers
- ❌ Add tests without running them
- ❌ Skip documentation for public APIs

---

## Reference Files

- **CODE_GUIDE.md** - Complete developer reference
- **README.md** - User documentation
- **documentation/BUILD.md** - Build & test commands
