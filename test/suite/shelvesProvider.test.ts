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
});

