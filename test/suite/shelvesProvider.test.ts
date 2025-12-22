import * as vscode from 'vscode';
import { ShelvesProvider, StashTreeItem, StashFileTreeItem } from '../../src/providers/shelvesProvider';
import { GitService } from '../../src/services/gitService';
import { StashInfo, ChangedFile } from '../../src/types/git';

// Mock GitService
jest.mock('../../src/services/gitService');

describe('ShelvesProvider', () => {
    let provider: ShelvesProvider;
    let mockGitService: jest.Mocked<GitService>;
    let mockContext: vscode.ExtensionContext;

    beforeEach(() => {
        mockGitService = new GitService() as jest.Mocked<GitService>;
        mockContext = {
            workspaceState: {
                get: jest.fn().mockReturnValue({}),
                update: jest.fn().mockResolvedValue(undefined)
            }
        } as any;
        provider = new ShelvesProvider(mockGitService, mockContext);
    });

    test('getChildren returns "No repository opened" when no repo root is set', async () => {
        const items = await provider.getChildren();
        expect(items.length).toBe(1);
        expect(items[0].label).toBe('No repository opened');
        expect(items[0].contextValue).toBe('empty');
    });

    test('getChildren returns "No shelves available" when no stashes exist', async () => {
        mockGitService.getStashes.mockResolvedValue([]);
        mockGitService.checkStashConflicts = jest.fn().mockResolvedValue([]);

        provider.setRepoRoot('/root');
        const items = await provider.getChildren();

        expect(items.length).toBe(1);
        expect(items[0].label).toBe('No shelves available');
        expect(items[0].contextValue).toBe('empty');
    });

    test('getChildren returns stash items when stashes exist', async () => {
        const mockStashes: StashInfo[] = [
            {
                index: 'stash@{0}',
                branch: 'master',
                message: 'WIP: feature',
                fileCount: 2,
                timestamp: '2024-01-01T12:00:00Z',
                relativeTime: '2 hours ago',
                additions: 10,
                deletions: 5
            },
            {
                index: 'stash@{1}',
                branch: 'dev',
                message: 'WIP: fix',
                fileCount: 1,
                timestamp: '2024-01-01T10:00:00Z',
                relativeTime: '4 hours ago',
                additions: 3,
                deletions: 1
            }
        ];

        mockGitService.getStashes.mockResolvedValue(mockStashes);
        mockGitService.checkStashConflicts = jest.fn().mockResolvedValue([]);

        provider.setRepoRoot('/root');
        const items = await provider.getChildren();

        expect(items.length).toBe(2);
        expect(items[0]).toBeInstanceOf(StashTreeItem);
        expect(items[0].label).toBe('WIP: feature');
        expect((items[0] as StashTreeItem).stash.message).toBe('WIP: feature');
    });

    test('getChildren returns file items for a stash', async () => {
        const mockStash: StashInfo = {
            index: 'stash@{0}',
            branch: 'master',
            message: 'WIP',
            fileCount: 1,
            timestamp: '2024-01-01T12:00:00Z',
            relativeTime: '2 hours ago',
            additions: 5,
            deletions: 2
        };
        const mockFiles: ChangedFile[] = [
            { path: 'file.ts', status: 'M', additions: 5, deletions: 2 }
        ];

        mockGitService.getStashFiles.mockResolvedValue(mockFiles);

        provider.setRepoRoot('/root');
        const stashItem = new StashTreeItem(mockStash, '/root', false, vscode.TreeItemCollapsibleState.Expanded);
        const items = await provider.getChildren(stashItem);

        expect(items.length).toBe(1);
        expect(items[0]).toBeInstanceOf(StashFileTreeItem);
        expect(items[0].label).toBe('file.ts');
        expect((items[0] as StashFileTreeItem).file).toEqual(mockFiles[0]);
    });

    test('getChildren handles errors when fetching stashes', async () => {
        mockGitService.getStashes.mockRejectedValue(new Error('Git error'));
        mockGitService.checkStashConflicts = jest.fn().mockResolvedValue([]);
        const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => { });

        provider.setRepoRoot('/root');
        const items = await provider.getChildren();

        expect(items).toEqual([]);
        expect(consoleSpy).toHaveBeenCalled();
        consoleSpy.mockRestore();
    });

    test('getChildren handles errors when fetching stash files', async () => {
        const mockStash: StashInfo = {
            index: 'stash@{0}',
            branch: 'master',
            message: 'WIP',
            fileCount: 1,
            timestamp: '2024-01-01T12:00:00Z',
            relativeTime: '2 hours ago',
            additions: 5,
            deletions: 2
        };

        mockGitService.getStashFiles.mockRejectedValue(new Error('Git error'));
        const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => { });

        provider.setRepoRoot('/root');
        const stashItem = new StashTreeItem(mockStash, '/root', false, vscode.TreeItemCollapsibleState.Expanded);
        const items = await provider.getChildren(stashItem);

        expect(items).toEqual([]);
        expect(consoleSpy).toHaveBeenCalled();
        consoleSpy.mockRestore();
    });

    test('setRepoRoot updates root and refreshes', () => {
        const refreshSpy = jest.spyOn(provider, 'refresh');

        provider.setRepoRoot('/new/root');

        expect(provider.getRepoRoot()).toBe('/new/root');
        expect(refreshSpy).toHaveBeenCalled();
    });

    test('pinShelf adds shelf to pinned set', async () => {
        mockGitService.checkStashConflicts = jest.fn().mockResolvedValue([]);
        provider.setRepoRoot('/root');

        await provider.pinShelf('stash@{0}');

        expect(provider.isShelfPinned('stash@{0}')).toBe(true);
        expect(mockContext.workspaceState.update).toHaveBeenCalled();
    });

    test('unpinShelf removes shelf from pinned set', async () => {
        mockGitService.checkStashConflicts = jest.fn().mockResolvedValue([]);
        provider.setRepoRoot('/root');

        await provider.pinShelf('stash@{0}');
        await provider.unpinShelf('stash@{0}');

        expect(provider.isShelfPinned('stash@{0}')).toBe(false);
    });

    test('pinned shelves appear first in list', async () => {
        const mockStashes: StashInfo[] = [
            {
                index: 'stash@{0}',
                branch: 'master',
                message: 'Regular shelf',
                fileCount: 1,
                timestamp: '2024-01-01T14:00:00Z',
                relativeTime: '1 hour ago',
                additions: 5,
                deletions: 2
            },
            {
                index: 'stash@{1}',
                branch: 'dev',
                message: 'Pinned shelf',
                fileCount: 2,
                timestamp: '2024-01-01T10:00:00Z',
                relativeTime: '5 hours ago',
                additions: 10,
                deletions: 3
            }
        ];

        mockGitService.getStashes.mockResolvedValue(mockStashes);
        mockGitService.checkStashConflicts = jest.fn().mockResolvedValue([]);

        provider.setRepoRoot('/root');
        await provider.pinShelf('stash@{1}');

        const items = await provider.getChildren();

        // Pinned shelf should be first even though it's older
        expect((items[0] as StashTreeItem).stash.message).toBe('Pinned shelf');
        expect((items[0] as StashTreeItem).isPinned).toBe(true);
        expect((items[1] as StashTreeItem).stash.message).toBe('Regular shelf');
        expect((items[1] as StashTreeItem).isPinned).toBe(false);
    });

    test('shelves with conflicts show warning icon and conflict info', async () => {
        const mockStashes: StashInfo[] = [
            {
                index: 'stash@{0}',
                branch: 'master',
                message: 'Clean shelf',
                fileCount: 1,
                timestamp: '2024-01-01T14:00:00Z',
                relativeTime: '1 hour ago',
                additions: 5,
                deletions: 2
            },
            {
                index: 'stash@{1}',
                branch: 'dev',
                message: 'Conflicting shelf',
                fileCount: 2,
                timestamp: '2024-01-01T10:00:00Z',
                relativeTime: '5 hours ago',
                additions: 10,
                deletions: 3
            }
        ];

        mockGitService.getStashes.mockResolvedValue(mockStashes);

        // First stash has no conflicts, second has 2 conflicting files
        mockGitService.checkStashConflicts = jest.fn()
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce(['src/file1.ts', 'src/file2.ts']);

        provider.setRepoRoot('/root');
        const items = await provider.getChildren();

        expect(items.length).toBe(2);

        // First item should have no conflicts
        const cleanShelf = items[0] as StashTreeItem;
        expect(cleanShelf.stash.hasConflicts).toBe(false);
        expect(cleanShelf.contextValue).toBe('stash');

        // Second item should have conflicts
        const conflictingShelf = items[1] as StashTreeItem;
        expect(conflictingShelf.stash.hasConflicts).toBe(true);
        expect(conflictingShelf.stash.conflictingFiles).toEqual(['src/file1.ts', 'src/file2.ts']);
        expect(conflictingShelf.contextValue).toBe('stashConflict');
    });

    test('conflict detection is called for all shelves', async () => {
        const mockStashes: StashInfo[] = [
            {
                index: 'stash@{0}',
                branch: 'master',
                message: 'Shelf 1',
                fileCount: 1,
                timestamp: '2024-01-01T12:00:00Z',
                relativeTime: '1 hour ago',
                additions: 5,
                deletions: 2
            },
            {
                index: 'stash@{1}',
                branch: 'dev',
                message: 'Shelf 2',
                fileCount: 1,
                timestamp: '2024-01-01T10:00:00Z',
                relativeTime: '3 hours ago',
                additions: 3,
                deletions: 1
            }
        ];

        mockGitService.getStashes.mockResolvedValue(mockStashes);
        mockGitService.checkStashConflicts = jest.fn().mockResolvedValue([]);

        provider.setRepoRoot('/root');
        await provider.getChildren();

        // Should check conflicts for both stashes
        expect(mockGitService.checkStashConflicts).toHaveBeenCalledTimes(2);
        expect(mockGitService.checkStashConflicts).toHaveBeenCalledWith('stash@{0}', '/root');
        expect(mockGitService.checkStashConflicts).toHaveBeenCalledWith('stash@{1}', '/root');
    });

    test('pinned shelf with conflict has stashPinnedConflict contextValue', async () => {
        const mockStashes: StashInfo[] = [
            {
                index: 'stash@{0}',
                branch: 'master',
                message: 'Pinned conflicting shelf',
                fileCount: 2,
                timestamp: '2024-01-01T12:00:00Z',
                relativeTime: '1 hour ago',
                additions: 10,
                deletions: 5
            }
        ];

        mockGitService.getStashes.mockResolvedValue(mockStashes);
        mockGitService.checkStashConflicts = jest.fn().mockResolvedValue(['file1.ts', 'file2.ts']);

        provider.setRepoRoot('/root');
        await provider.pinShelf('stash@{0}');
        const items = await provider.getChildren();

        const shelf = items[0] as StashTreeItem;
        expect(shelf.contextValue).toBe('stashPinnedConflict');
        expect(shelf.isPinned).toBe(true);
        expect(shelf.stash.hasConflicts).toBe(true);
    });

    test('pinned shelves persist across provider instances', async () => {
        // Setup initial state with pinned shelf
        const pinnedData: Record<string, string[]> = {
            '/root': ['stash@{0}']
        };
        (mockContext.workspaceState.get as jest.Mock).mockReturnValue(pinnedData);

        // Create new provider instance (simulates reload)
        const newProvider = new ShelvesProvider(mockGitService, mockContext);
        newProvider.setRepoRoot('/root');

        expect(newProvider.isShelfPinned('stash@{0}')).toBe(true);
        expect(newProvider.isShelfPinned('stash@{1}')).toBe(false);
    });

    test('unpinning non-existent shelf does not throw', async () => {
        mockGitService.checkStashConflicts = jest.fn().mockResolvedValue([]);
        provider.setRepoRoot('/root');

        // Should not throw
        await expect(provider.unpinShelf('stash@{99}')).resolves.not.toThrow();
    });

    test('pinning same shelf twice is idempotent', async () => {
        mockGitService.checkStashConflicts = jest.fn().mockResolvedValue([]);
        provider.setRepoRoot('/root');

        await provider.pinShelf('stash@{0}');
        await provider.pinShelf('stash@{0}');

        expect(provider.isShelfPinned('stash@{0}')).toBe(true);
        // Should only save once (Set behavior)
        const updateCalls = (mockContext.workspaceState.update as jest.Mock).mock.calls;
        const lastCall = updateCalls[updateCalls.length - 1];
        const savedPins = lastCall[1]['/root'];
        expect(savedPins.filter((p: string) => p === 'stash@{0}').length).toBe(1);
    });
});

describe('StashTreeItem', () => {
    const createStash = (overrides: Partial<StashInfo> = {}): StashInfo => ({
        index: 'stash@{0}',
        branch: 'main',
        message: 'Test shelf',
        fileCount: 3,
        timestamp: new Date().toISOString(),
        relativeTime: '1 hour ago',
        additions: 10,
        deletions: 5,
        ...overrides
    });

    describe('description formatting', () => {
        test('shows line stats and file count', () => {
            const stash = createStash({ additions: 15, deletions: 8, fileCount: 3 });
            const item = new StashTreeItem(stash, '/root', false, vscode.TreeItemCollapsibleState.Collapsed);

            expect(item.description).toContain('+15 -8');
            expect(item.description).toContain('3 files');
        });

        test('shows singular file for single file', () => {
            const stash = createStash({ fileCount: 1 });
            const item = new StashTreeItem(stash, '/root', false, vscode.TreeItemCollapsibleState.Collapsed);

            expect(item.description).toContain('1 file');
            expect(item.description).not.toContain('1 files');
        });

        test('shows relative time', () => {
            const stash = createStash({ relativeTime: '3 days ago' });
            const item = new StashTreeItem(stash, '/root', false, vscode.TreeItemCollapsibleState.Collapsed);

            expect(item.description).toContain('3 days ago');
        });

        test('shows conflict warning in description', () => {
            const stash = createStash({
                hasConflicts: true,
                conflictingFiles: ['file1.ts', 'file2.ts']
            });
            const item = new StashTreeItem(stash, '/root', false, vscode.TreeItemCollapsibleState.Collapsed);

            expect(item.description).toContain('⚠️');
            expect(item.description).toContain('2 conflicts');
        });

        test('shows singular conflict for single file', () => {
            const stash = createStash({
                hasConflicts: true,
                conflictingFiles: ['file1.ts']
            });
            const item = new StashTreeItem(stash, '/root', false, vscode.TreeItemCollapsibleState.Collapsed);

            expect(item.description).toContain('1 conflict');
            expect(item.description).not.toContain('1 conflicts');
        });
    });

    describe('tooltip content', () => {
        test('includes message and line stats', () => {
            const stash = createStash({ message: 'My stash message', additions: 20, deletions: 10 });
            const item = new StashTreeItem(stash, '/root', false, vscode.TreeItemCollapsibleState.Collapsed);

            expect(item.tooltip).toContain('My stash message');
            expect(item.tooltip).toContain('+20 -10');
        });

        test('includes conflicting files in tooltip', () => {
            const stash = createStash({
                hasConflicts: true,
                conflictingFiles: ['src/file1.ts', 'src/file2.ts', 'src/file3.ts']
            });
            const item = new StashTreeItem(stash, '/root', false, vscode.TreeItemCollapsibleState.Collapsed);

            expect(item.tooltip).toContain('3 conflicting file(s)');
            expect(item.tooltip).toContain('src/file1.ts');
            expect(item.tooltip).toContain('src/file2.ts');
            expect(item.tooltip).toContain('src/file3.ts');
        });

        test('truncates conflict list at 5 files', () => {
            const stash = createStash({
                hasConflicts: true,
                conflictingFiles: ['f1.ts', 'f2.ts', 'f3.ts', 'f4.ts', 'f5.ts', 'f6.ts', 'f7.ts']
            });
            const item = new StashTreeItem(stash, '/root', false, vscode.TreeItemCollapsibleState.Collapsed);

            expect(item.tooltip).toContain('f1.ts');
            expect(item.tooltip).toContain('f5.ts');
            expect(item.tooltip).not.toContain('f6.ts');
            expect(item.tooltip).toContain('and 2 more');
        });
    });

    describe('icon selection', () => {
        test('uses warning icon for conflicting shelf', () => {
            const stash = createStash({ hasConflicts: true, conflictingFiles: ['file.ts'] });
            const item = new StashTreeItem(stash, '/root', false, vscode.TreeItemCollapsibleState.Collapsed);

            expect((item.iconPath as vscode.ThemeIcon).id).toBe('warning');
        });

        test('uses pinned icon for pinned shelf (without conflicts)', () => {
            const stash = createStash();
            const item = new StashTreeItem(stash, '/root', true, vscode.TreeItemCollapsibleState.Collapsed);

            expect((item.iconPath as vscode.ThemeIcon).id).toBe('pinned');
        });

        test('conflict icon takes priority over pinned', () => {
            const stash = createStash({ hasConflicts: true, conflictingFiles: ['file.ts'] });
            const item = new StashTreeItem(stash, '/root', true, vscode.TreeItemCollapsibleState.Collapsed);

            // Conflict takes highest priority
            expect((item.iconPath as vscode.ThemeIcon).id).toBe('warning');
        });

        test('uses inbox icon for fresh shelf (<24h)', () => {
            const now = new Date();
            const stash = createStash({ timestamp: now.toISOString() });
            const item = new StashTreeItem(stash, '/root', false, vscode.TreeItemCollapsibleState.Collapsed);

            expect((item.iconPath as vscode.ThemeIcon).id).toBe('inbox');
        });

        test('uses archive icon for recent shelf (1-7 days)', () => {
            const threeDaysAgo = new Date();
            threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
            const stash = createStash({ timestamp: threeDaysAgo.toISOString() });
            const item = new StashTreeItem(stash, '/root', false, vscode.TreeItemCollapsibleState.Collapsed);

            expect((item.iconPath as vscode.ThemeIcon).id).toBe('archive');
        });

        test('uses package icon for week-old shelf (7-30 days)', () => {
            const twoWeeksAgo = new Date();
            twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
            const stash = createStash({ timestamp: twoWeeksAgo.toISOString() });
            const item = new StashTreeItem(stash, '/root', false, vscode.TreeItemCollapsibleState.Collapsed);

            expect((item.iconPath as vscode.ThemeIcon).id).toBe('package');
        });

        test('uses archive icon for old shelf (>30 days)', () => {
            const twoMonthsAgo = new Date();
            twoMonthsAgo.setDate(twoMonthsAgo.getDate() - 60);
            const stash = createStash({ timestamp: twoMonthsAgo.toISOString() });
            const item = new StashTreeItem(stash, '/root', false, vscode.TreeItemCollapsibleState.Collapsed);

            expect((item.iconPath as vscode.ThemeIcon).id).toBe('archive');
        });

        test('uses default archive icon when timestamp is missing', () => {
            const stash = createStash({ timestamp: '' });
            const item = new StashTreeItem(stash, '/root', false, vscode.TreeItemCollapsibleState.Collapsed);

            expect((item.iconPath as vscode.ThemeIcon).id).toBe('archive');
        });
    });

    describe('contextValue', () => {
        test('is "stash" for normal shelf', () => {
            const stash = createStash();
            const item = new StashTreeItem(stash, '/root', false, vscode.TreeItemCollapsibleState.Collapsed);

            expect(item.contextValue).toBe('stash');
        });

        test('is "stashPinned" for pinned shelf', () => {
            const stash = createStash();
            const item = new StashTreeItem(stash, '/root', true, vscode.TreeItemCollapsibleState.Collapsed);

            expect(item.contextValue).toBe('stashPinned');
        });

        test('is "stashConflict" for conflicting shelf', () => {
            const stash = createStash({ hasConflicts: true, conflictingFiles: ['f.ts'] });
            const item = new StashTreeItem(stash, '/root', false, vscode.TreeItemCollapsibleState.Collapsed);

            expect(item.contextValue).toBe('stashConflict');
        });

        test('is "stashPinnedConflict" for pinned conflicting shelf', () => {
            const stash = createStash({ hasConflicts: true, conflictingFiles: ['f.ts'] });
            const item = new StashTreeItem(stash, '/root', true, vscode.TreeItemCollapsibleState.Collapsed);

            expect(item.contextValue).toBe('stashPinnedConflict');
        });
    });
});

