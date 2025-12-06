import * as vscode from 'vscode';
import { ReflogProvider, ReflogTreeItem, LoadMoreReflogTreeItem } from '../../src/providers/reflogProvider';
import { GitService } from '../../src/services/gitService';
import { ReflogEntry } from '../../src/types/git';

// Mock GitService
jest.mock('../../src/services/gitService');

describe('ReflogProvider', () => {
    let provider: ReflogProvider;
    let mockGitService: jest.Mocked<GitService>;

    beforeEach(() => {
        mockGitService = new GitService() as jest.Mocked<GitService>;
        provider = new ReflogProvider(mockGitService);
    });

    test('getChildren returns "No repository opened" when no repo root is set', async () => {
        const items = await provider.getChildren();
        expect(items.length).toBe(1);
        expect(items[0].label).toBe('No repository opened');
        expect(items[0].contextValue).toBe('empty');
    });

    test('getChildren returns "No git operations found" when reflog is empty', async () => {
        mockGitService.getReflog.mockResolvedValue([]);

        provider.setRepoRoot('/root');
        const items = await provider.getChildren();

        expect(items.length).toBe(1);
        expect(items[0].label).toBe('No git operations found');
        expect(items[0].contextValue).toBe('empty');
    });

    test('getChildren returns reflog entries', async () => {
        const mockEntries: ReflogEntry[] = [
            {
                hash: '123',
                shortHash: '123',
                selector: 'HEAD@{0}',
                message: 'commit: Test',
                action: 'commit',
                timestamp: '2024-01-01 10:00:00 +0000',
                relativeTime: '2 hours ago'
            },
            {
                hash: '456',
                shortHash: '456',
                selector: 'HEAD@{1}',
                message: 'checkout: moving from master to dev',
                action: 'checkout',
                timestamp: '2024-01-01 09:00:00 +0000',
                relativeTime: '3 hours ago'
            }
        ];

        mockGitService.getReflog.mockResolvedValue(mockEntries);

        provider.setRepoRoot('/root');
        const items = await provider.getChildren();

        expect(items.length).toBe(2);
        expect(items[0]).toBeInstanceOf(ReflogTreeItem);
        expect(items[0].label).toBe('commit: Test');
        expect((items[0] as ReflogTreeItem).entry).toEqual(mockEntries[0]);
    });

    test('getChildren adds "Load More" item when limit is reached', async () => {
        // Create 50 entries (default limit)
        const mockEntries: ReflogEntry[] = Array(50).fill(null).map((_, i) => ({
            hash: `${i}`,
            shortHash: `${i}`,
            selector: `HEAD@{${i}}`,
            message: `Entry ${i}`,
            action: 'commit',
            timestamp: '2024-01-01 10:00:00 +0000',
            relativeTime: `${i} hours ago`
        }));

        mockGitService.getReflog.mockResolvedValue(mockEntries);

        provider.setRepoRoot('/root');
        const items = await provider.getChildren();

        // Should have 50 entries + 1 "Load More" item
        expect(items.length).toBe(51);
        expect(items[50]).toBeInstanceOf(LoadMoreReflogTreeItem);
        expect(items[50].label).toBe('Load More Operations...');
    });

    test('loadMore increases limit and refreshes', async () => {
        const refreshSpy = jest.spyOn(provider, 'refresh');
        const mockEntries: ReflogEntry[] = Array(50).fill(null).map((_, i) => ({
            hash: `${i}`,
            shortHash: `${i}`,
            selector: `HEAD@{${i}}`,
            message: `Entry ${i}`,
            action: 'commit',
            timestamp: '2024-01-01 10:00:00 +0000',
            relativeTime: `${i} hours ago`
        }));

        mockGitService.getReflog.mockResolvedValue(mockEntries);

        provider.setRepoRoot('/root');
        provider.loadMore();

        expect(refreshSpy).toHaveBeenCalled();

        // Verify subsequent call uses higher limit (internal implementation check via mock)
        await provider.getChildren();
        // The second call to getReflog should have limit 100 (50 + 50)
        expect(mockGitService.getReflog).toHaveBeenLastCalledWith('/root', 100);
    });

    test('ReflogTreeItem has correct icons for actions', () => {
        const createItem = (action: string) => new ReflogTreeItem(
            {
                hash: '123',
                shortHash: '123',
                selector: 'HEAD@{0}',
                message: 'Test',
                action,
                timestamp: '2024-01-01 10:00:00 +0000',
                relativeTime: '2 hours ago'
            },
            '/root',
            vscode.TreeItemCollapsibleState.None
        );

        expect((createItem('commit').iconPath as vscode.ThemeIcon).id).toBe('git-commit');
        expect((createItem('checkout').iconPath as vscode.ThemeIcon).id).toBe('git-branch');
        expect((createItem('pull').iconPath as vscode.ThemeIcon).id).toBe('cloud-download');
        expect((createItem('merge').iconPath as vscode.ThemeIcon).id).toBe('git-merge');
        expect((createItem('rebase').iconPath as vscode.ThemeIcon).id).toBe('versions');
        expect((createItem('reset').iconPath as vscode.ThemeIcon).id).toBe('discard');
        expect((createItem('cherry-pick').iconPath as vscode.ThemeIcon).id).toBe('git-pull-request');
        expect((createItem('unknown').iconPath as vscode.ThemeIcon).id).toBe('history');
    });

    test('getChildren handles errors gracefully', async () => {
        mockGitService.getReflog.mockRejectedValue(new Error('Git error'));
        const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => { });

        provider.setRepoRoot('/root');
        const items = await provider.getChildren();

        expect(items).toEqual([]);
        expect(consoleSpy).toHaveBeenCalled();
        consoleSpy.mockRestore();
    });
});

