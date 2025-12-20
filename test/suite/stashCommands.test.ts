import * as vscode from 'vscode';
import { StashCommands } from '../../src/commands/stashCommands';
import { GitService } from '../../src/services/gitService';
import { DiffService } from '../../src/services/diffService';
import { ShelvesProvider, StashTreeItem } from '../../src/providers/shelvesProvider';
import { StashInfo } from '../../src/types/git';

// Mock modules
jest.mock('../../src/services/gitService');
jest.mock('../../src/services/diffService');
jest.mock('vscode', () => ({
    window: {
        showWarningMessage: jest.fn(),
        showErrorMessage: jest.fn(),
        showInformationMessage: jest.fn()
    },
    TreeItem: class {
        label: string;
        description?: string;
        contextValue?: string;
        constructor(label: string) {
            this.label = label;
        }
    },
    TreeItemCollapsibleState: {
        None: 0,
        Collapsed: 1,
        Expanded: 2
    },
    EventEmitter: class {
        fire() { }
        get event() {
            return () => { };
        }
    },
    ThemeIcon: class {
        constructor(public id: string, public color?: any) { }
    },
    ThemeColor: class {
        constructor(public id: string) { }
    }
}), { virtual: true });

describe('StashCommands - mergeIntoShelf', () => {
    let stashCommands: StashCommands;
    let mockGitService: jest.Mocked<GitService>;
    let mockDiffService: jest.Mocked<DiffService>;
    let mockShelvesProvider: jest.Mocked<ShelvesProvider>;
    let mockStashItem: StashTreeItem;

    beforeEach(() => {
        jest.clearAllMocks();

        mockGitService = new GitService() as jest.Mocked<GitService>;
        mockDiffService = new DiffService(mockGitService) as jest.Mocked<DiffService>;

        const mockContext = {
            workspaceState: {
                get: jest.fn().mockReturnValue({}),
                update: jest.fn().mockResolvedValue(undefined)
            }
        } as any;

        mockShelvesProvider = new ShelvesProvider(mockGitService, mockContext) as jest.Mocked<ShelvesProvider>;
        mockShelvesProvider.refresh = jest.fn();

        stashCommands = new StashCommands(mockGitService, mockDiffService, mockShelvesProvider);

        const mockStash: StashInfo = {
            index: 'stash@{2}',
            branch: 'main',
            message: 'Target shelf',
            fileCount: 3,
            timestamp: '2024-01-01T12:00:00Z',
            relativeTime: '2 hours ago',
            additions: 15,
            deletions: 5
        };

        mockStashItem = new StashTreeItem(
            mockStash,
            '/repo/root',
            false,
            vscode.TreeItemCollapsibleState.Collapsed
        );
    });

    test('should abort when no changes to add', async () => {
        mockGitService.hasChangesToStash = jest.fn().mockResolvedValue(false);

        await stashCommands.mergeIntoShelf(mockStashItem);

        expect(vscode.window.showWarningMessage).toHaveBeenCalledWith('No changes to add to the shelf');
        expect(mockGitService.createStash).not.toHaveBeenCalled();
    });

    test('should abort when user cancels confirmation', async () => {
        mockGitService.hasChangesToStash = jest.fn().mockResolvedValue(true);
        mockGitService.hasUntrackedFiles = jest.fn().mockResolvedValue(false);
        mockGitService.getStashPreview = jest.fn().mockResolvedValue({
            staged: [{ file: 'file1.ts', additions: 5, deletions: 2 }],
            unstaged: [],
            untracked: []
        });

        (vscode.window.showInformationMessage as jest.Mock).mockResolvedValue(undefined);

        await stashCommands.mergeIntoShelf(mockStashItem);

        expect(mockGitService.createStash).not.toHaveBeenCalled();
    });

    test('should successfully merge changes when no conflicts', async () => {
        mockGitService.hasChangesToStash = jest.fn().mockResolvedValue(true);
        mockGitService.hasUntrackedFiles = jest.fn().mockResolvedValue(true);
        mockGitService.getStashPreview = jest.fn().mockResolvedValue({
            staged: [{ file: 'file1.ts', additions: 5, deletions: 2 }],
            unstaged: [{ file: 'file2.ts', additions: 3, deletions: 1 }],
            untracked: ['file3.ts']
        });

        (vscode.window.showInformationMessage as jest.Mock).mockResolvedValue('Add All Changes');

        mockGitService.createStash = jest.fn().mockResolvedValue(undefined);
        mockGitService.applyStash = jest.fn().mockResolvedValue(undefined);
        mockGitService.deleteStash = jest.fn().mockResolvedValue(undefined);
        mockGitService.popStash = jest.fn().mockResolvedValue(undefined);

        await stashCommands.mergeIntoShelf(mockStashItem);

        // Verify the safe merge process
        const createStashCalls = (mockGitService.createStash as jest.Mock).mock.calls;

        // Step 1: Create temp backup
        expect(createStashCalls[0]).toEqual(['/repo/root', 'TEMP-MERGE-BACKUP', true]);

        // Step 2: Apply shifted stash (stash@{2} becomes stash@{3} after temp backup)
        expect(mockGitService.applyStash).toHaveBeenCalledWith('stash@{3}', '/repo/root');

        // Step 3: Delete shifted stash (safe now, apply succeeded)
        expect(mockGitService.deleteStash).toHaveBeenCalledWith('stash@{3}', '/repo/root');

        // Step 4: Pop temp backup to merge changes
        expect(mockGitService.popStash).toHaveBeenCalledWith('stash@{0}', '/repo/root');

        // Step 5: Create new combined shelf
        expect(createStashCalls[1]).toEqual(['/repo/root', 'Target shelf', true]);

        expect(mockShelvesProvider.refresh).toHaveBeenCalled();
        expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
            'Added all changes to shelf "Target shelf"'
        );
    });

    test('should handle conflict and restore original state', async () => {
        mockGitService.hasChangesToStash = jest.fn().mockResolvedValue(true);
        mockGitService.hasUntrackedFiles = jest.fn().mockResolvedValue(false);
        mockGitService.getStashPreview = jest.fn().mockResolvedValue({
            staged: [{ file: 'file1.ts', additions: 5, deletions: 2 }],
            unstaged: [],
            untracked: []
        });

        (vscode.window.showInformationMessage as jest.Mock).mockResolvedValue('Add All Changes');

        // Create temp backup succeeds
        mockGitService.createStash = jest.fn().mockResolvedValue(undefined);

        // Apply stash fails (conflict)
        mockGitService.applyStash = jest.fn().mockRejectedValue(
            new Error('error: Your local changes to the following files would be overwritten')
        );

        // Restore temp backup
        mockGitService.popStash = jest.fn().mockResolvedValue(undefined);

        await stashCommands.mergeIntoShelf(mockStashItem);

        // Verify temp backup was created
        expect(mockGitService.createStash).toHaveBeenCalledWith('/repo/root', 'TEMP-MERGE-BACKUP', false);

        // Verify apply was attempted on shifted index
        expect(mockGitService.applyStash).toHaveBeenCalledWith('stash@{3}', '/repo/root');

        // Verify temp backup was restored (popped)
        expect(mockGitService.popStash).toHaveBeenCalledWith('stash@{0}', '/repo/root');

        // Verify original shelf was NOT deleted
        expect(mockGitService.deleteStash).not.toHaveBeenCalled();

        // Verify no new shelf was created (only temp backup)
        expect(mockGitService.createStash).toHaveBeenCalledTimes(1);

        // Verify error message
        expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
            expect.stringContaining('Cannot add to shelf: Changes conflict with the shelf contents')
        );

        expect(mockShelvesProvider.refresh).toHaveBeenCalled();
    });

    test('should calculate correct shifted index for stash@{0}', async () => {
        const stash0: StashInfo = {
            index: 'stash@{0}',
            branch: 'main',
            message: 'First shelf',
            fileCount: 1,
            timestamp: '2024-01-01T12:00:00Z',
            relativeTime: '1 hour ago',
            additions: 5,
            deletions: 2
        };

        const stash0Item = new StashTreeItem(
            stash0,
            '/repo/root',
            false,
            vscode.TreeItemCollapsibleState.Collapsed
        );

        mockGitService.hasChangesToStash = jest.fn().mockResolvedValue(true);
        mockGitService.hasUntrackedFiles = jest.fn().mockResolvedValue(false);
        mockGitService.getStashPreview = jest.fn().mockResolvedValue({
            staged: [{ file: 'file1.ts', additions: 5, deletions: 2 }],
            unstaged: [],
            untracked: []
        });

        (vscode.window.showInformationMessage as jest.Mock).mockResolvedValue('Add All Changes');

        mockGitService.createStash = jest.fn().mockResolvedValue(undefined);
        mockGitService.applyStash = jest.fn().mockResolvedValue(undefined);
        mockGitService.deleteStash = jest.fn().mockResolvedValue(undefined);
        mockGitService.popStash = jest.fn().mockResolvedValue(undefined);

        await stashCommands.mergeIntoShelf(stash0Item);

        // stash@{0} becomes stash@{1} after temp backup
        expect(mockGitService.applyStash).toHaveBeenCalledWith('stash@{1}', '/repo/root');
        expect(mockGitService.deleteStash).toHaveBeenCalledWith('stash@{1}', '/repo/root');
    });

    test('should handle restore failure gracefully', async () => {
        mockGitService.hasChangesToStash = jest.fn().mockResolvedValue(true);
        mockGitService.hasUntrackedFiles = jest.fn().mockResolvedValue(false);
        mockGitService.getStashPreview = jest.fn().mockResolvedValue({
            staged: [{ file: 'file1.ts', additions: 5, deletions: 2 }],
            unstaged: [],
            untracked: []
        });

        (vscode.window.showInformationMessage as jest.Mock).mockResolvedValue('Add All Changes');

        mockGitService.createStash = jest.fn().mockResolvedValue(undefined);
        mockGitService.applyStash = jest.fn().mockRejectedValue(new Error('conflict'));
        mockGitService.popStash = jest.fn().mockRejectedValue(new Error('restore failed'));

        const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => { });

        await stashCommands.mergeIntoShelf(mockStashItem);

        // Should still show error to user even if restore fails
        expect(vscode.window.showErrorMessage).toHaveBeenCalled();
        expect(consoleSpy).toHaveBeenCalled();

        consoleSpy.mockRestore();
    });

    test('should handle invalid stash index format', async () => {
        const invalidStash: StashInfo = {
            index: 'invalid-format',
            branch: 'main',
            message: 'Invalid',
            fileCount: 1,
            timestamp: '2024-01-01T12:00:00Z',
            relativeTime: '1 hour ago',
            additions: 5,
            deletions: 2
        };

        const invalidItem = new StashTreeItem(
            invalidStash,
            '/repo/root',
            false,
            vscode.TreeItemCollapsibleState.Collapsed
        );

        mockGitService.hasChangesToStash = jest.fn().mockResolvedValue(true);
        mockGitService.hasUntrackedFiles = jest.fn().mockResolvedValue(false);
        mockGitService.getStashPreview = jest.fn().mockResolvedValue({
            staged: [{ file: 'file1.ts', additions: 5, deletions: 2 }],
            unstaged: [],
            untracked: []
        });

        (vscode.window.showInformationMessage as jest.Mock).mockResolvedValue('Add All Changes');

        await stashCommands.mergeIntoShelf(invalidItem);

        expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
            expect.stringContaining('Failed to add to shelf')
        );
    });

    test('should handle conflict during pop temp backup (after successful apply)', async () => {
        mockGitService.hasChangesToStash = jest.fn().mockResolvedValue(true);
        mockGitService.hasUntrackedFiles = jest.fn().mockResolvedValue(false);
        mockGitService.getStashPreview = jest.fn().mockResolvedValue({
            staged: [{ file: 'file1.ts', additions: 5, deletions: 2 }],
            unstaged: [],
            untracked: []
        });

        (vscode.window.showInformationMessage as jest.Mock).mockResolvedValue('Add All Changes');

        // Create temp backup succeeds
        mockGitService.createStash = jest.fn().mockResolvedValue(undefined);

        // Apply stash succeeds
        mockGitService.applyStash = jest.fn().mockResolvedValue(undefined);

        // Delete old shelf succeeds
        mockGitService.deleteStash = jest.fn().mockResolvedValue(undefined);

        // Pop temp backup fails (conflict when merging)
        mockGitService.popStash = jest.fn().mockRejectedValue(
            new Error('error: Your local changes would be overwritten by merge')
        );

        // Cleanup should try to find and delete the temp stash
        mockGitService.getStashes = jest.fn().mockResolvedValue([
            {
                index: 'stash@{0}',
                branch: 'main',
                message: 'TEMP-MERGE-BACKUP',
                fileCount: 1,
                timestamp: '2024-01-01T12:00:00Z',
                relativeTime: 'just now',
                additions: 5,
                deletions: 2
            }
        ]);

        const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => { });

        await stashCommands.mergeIntoShelf(mockStashItem);

        // Verify temp backup was created
        expect(mockGitService.createStash).toHaveBeenCalledWith('/repo/root', 'TEMP-MERGE-BACKUP', false);

        // Verify apply succeeded
        expect(mockGitService.applyStash).toHaveBeenCalledWith('stash@{3}', '/repo/root');

        // Verify delete succeeded (this is the key difference - old shelf was already deleted)
        expect(mockGitService.deleteStash).toHaveBeenCalledWith('stash@{3}', '/repo/root');

        // Verify pop was attempted
        expect(mockGitService.popStash).toHaveBeenCalledWith('stash@{0}', '/repo/root');

        // Verify cleanup attempted to delete temp stash
        expect(mockGitService.getStashes).toHaveBeenCalled();
        expect(mockGitService.deleteStash).toHaveBeenCalledWith('stash@{0}', '/repo/root');

        // Verify error was shown
        expect(vscode.window.showErrorMessage).toHaveBeenCalled();

        consoleSpy.mockRestore();
    });

    test('should handle failure during deleteStash (after apply succeeds)', async () => {
        mockGitService.hasChangesToStash = jest.fn().mockResolvedValue(true);
        mockGitService.hasUntrackedFiles = jest.fn().mockResolvedValue(false);
        mockGitService.getStashPreview = jest.fn().mockResolvedValue({
            staged: [{ file: 'file1.ts', additions: 5, deletions: 2 }],
            unstaged: [],
            untracked: []
        });

        (vscode.window.showInformationMessage as jest.Mock).mockResolvedValue('Add All Changes');

        mockGitService.createStash = jest.fn().mockResolvedValue(undefined);
        mockGitService.applyStash = jest.fn().mockResolvedValue(undefined);

        // Delete fails
        mockGitService.deleteStash = jest.fn().mockRejectedValue(new Error('Failed to delete'));

        // Should still try to pop temp backup
        mockGitService.popStash = jest.fn().mockResolvedValue(undefined);

        await stashCommands.mergeIntoShelf(mockStashItem);

        // Verify temp backup was created and popped (cleanup)
        expect(mockGitService.createStash).toHaveBeenCalledWith('/repo/root', 'TEMP-MERGE-BACKUP', false);
        expect(mockGitService.popStash).toHaveBeenCalledWith('stash@{0}', '/repo/root');

        // Verify error was shown
        expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
            expect.stringContaining('Failed to add to shelf')
        );
    });

    test('should handle failure during final createStash', async () => {
        mockGitService.hasChangesToStash = jest.fn().mockResolvedValue(true);
        mockGitService.hasUntrackedFiles = jest.fn().mockResolvedValue(false);
        mockGitService.getStashPreview = jest.fn().mockResolvedValue({
            staged: [{ file: 'file1.ts', additions: 5, deletions: 2 }],
            unstaged: [],
            untracked: []
        });

        (vscode.window.showInformationMessage as jest.Mock).mockResolvedValue('Add All Changes');

        // All steps succeed except final createStash
        mockGitService.createStash = jest.fn()
            .mockResolvedValueOnce(undefined) // Temp backup succeeds
            .mockRejectedValueOnce(new Error('Failed to create final stash')); // Final stash fails

        mockGitService.applyStash = jest.fn().mockResolvedValue(undefined);
        mockGitService.deleteStash = jest.fn().mockResolvedValue(undefined);
        mockGitService.popStash = jest.fn().mockResolvedValue(undefined);

        await stashCommands.mergeIntoShelf(mockStashItem);

        // Verify all steps were executed
        expect(mockGitService.createStash).toHaveBeenCalledTimes(2);
        expect(mockGitService.applyStash).toHaveBeenCalled();
        expect(mockGitService.deleteStash).toHaveBeenCalled();
        expect(mockGitService.popStash).toHaveBeenCalled();

        // Verify error was shown
        expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
            expect.stringContaining('Failed to add to shelf')
        );
    });

    test('should cleanup temp stash even when pop fails but delete succeeds', async () => {
        mockGitService.hasChangesToStash = jest.fn().mockResolvedValue(true);
        mockGitService.hasUntrackedFiles = jest.fn().mockResolvedValue(false);
        mockGitService.getStashPreview = jest.fn().mockResolvedValue({
            staged: [{ file: 'file1.ts', additions: 5, deletions: 2 }],
            unstaged: [],
            untracked: []
        });

        (vscode.window.showInformationMessage as jest.Mock).mockResolvedValue('Add All Changes');

        mockGitService.createStash = jest.fn().mockResolvedValue(undefined);

        // Apply stash fails with conflict
        mockGitService.applyStash = jest.fn().mockRejectedValue(
            new Error('error: Your local changes would be overwritten')
        );

        // Pop fails during cleanup (trying to restore original state)
        mockGitService.popStash = jest.fn().mockRejectedValue(new Error('pop failed'));

        // But we can find and delete the temp stash
        mockGitService.getStashes = jest.fn().mockResolvedValue([
            {
                index: 'stash@{0}',
                branch: 'main',
                message: 'TEMP-MERGE-BACKUP',
                fileCount: 1,
                timestamp: '2024-01-01T12:00:00Z',
                relativeTime: 'just now',
                additions: 5,
                deletions: 2
            }
        ]);
        mockGitService.deleteStash = jest.fn().mockResolvedValue(undefined);

        const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => { });
        const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => { });

        await stashCommands.mergeIntoShelf(mockStashItem);

        // Verify cleanup was attempted via delete (since pop failed)
        expect(mockGitService.getStashes).toHaveBeenCalled();
        expect(mockGitService.deleteStash).toHaveBeenCalledWith('stash@{0}', '/repo/root');

        // Verify cleanup success was logged
        expect(consoleLogSpy).toHaveBeenCalledWith('Cleaned up temp backup stash');

        // Verify error was shown to user (conflict error, not pop error)
        expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
            expect.stringContaining('Cannot add to shelf: Changes conflict')
        );

        consoleSpy.mockRestore();
        consoleLogSpy.mockRestore();
    });

    test('should handle complete cleanup failure gracefully', async () => {
        mockGitService.hasChangesToStash = jest.fn().mockResolvedValue(true);
        mockGitService.hasUntrackedFiles = jest.fn().mockResolvedValue(false);
        mockGitService.getStashPreview = jest.fn().mockResolvedValue({
            staged: [{ file: 'file1.ts', additions: 5, deletions: 2 }],
            unstaged: [],
            untracked: []
        });

        (vscode.window.showInformationMessage as jest.Mock).mockResolvedValue('Add All Changes');

        mockGitService.createStash = jest.fn().mockResolvedValue(undefined);

        // Apply fails with conflict
        mockGitService.applyStash = jest.fn().mockRejectedValue(
            new Error('error: Your local changes would be overwritten')
        );

        // All cleanup methods fail
        mockGitService.popStash = jest.fn().mockRejectedValue(new Error('pop failed'));
        mockGitService.getStashes = jest.fn().mockRejectedValue(new Error('getStashes failed'));
        mockGitService.deleteStash = jest.fn().mockRejectedValue(new Error('delete failed'));

        const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => { });

        await stashCommands.mergeIntoShelf(mockStashItem);

        // Should still show error to user even if cleanup completely fails
        expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
            expect.stringContaining('Cannot add to shelf: Changes conflict')
        );

        // Should log errors
        expect(consoleSpy).toHaveBeenCalledWith('Failed to restore temporary stash:', expect.any(Error));
        expect(consoleSpy).toHaveBeenCalledWith('Failed to cleanup temp stash:', expect.any(Error));

        consoleSpy.mockRestore();
    });
});

