import * as vscode from 'vscode';
import { ShelvesProvider, StashTreeItem, StashFileTreeItem } from '../../src/providers/shelvesProvider';
import { GitService } from '../../src/services/gitService';
import { StashInfo, ChangedFile } from '../../src/types/git';

// Mock GitService
jest.mock('../../src/services/gitService');

describe('ShelvesProvider', () => {
    let provider: ShelvesProvider;
    let mockGitService: jest.Mocked<GitService>;

    beforeEach(() => {
        mockGitService = new GitService() as jest.Mocked<GitService>;
        provider = new ShelvesProvider(mockGitService);
    });

    test('getChildren returns "No repository opened" when no repo root is set', async () => {
        const items = await provider.getChildren();
        expect(items.length).toBe(1);
        expect(items[0].label).toBe('No repository opened');
        expect(items[0].contextValue).toBe('empty');
    });

    test('getChildren returns "No shelves available" when no stashes exist', async () => {
        mockGitService.getStashes.mockResolvedValue([]);
        
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
                fileCount: 2 
            },
            { 
                index: 'stash@{1}', 
                branch: 'dev', 
                message: 'WIP: fix', 
                fileCount: 1 
            }
        ];

        mockGitService.getStashes.mockResolvedValue(mockStashes);
        
        provider.setRepoRoot('/root');
        const items = await provider.getChildren();
        
        expect(items.length).toBe(2);
        expect(items[0]).toBeInstanceOf(StashTreeItem);
        expect(items[0].label).toBe('WIP: feature');
        expect((items[0] as StashTreeItem).stash).toEqual(mockStashes[0]);
    });

    test('getChildren returns file items for a stash', async () => {
        const mockStash: StashInfo = {
            index: 'stash@{0}',
            branch: 'master',
            message: 'WIP',
            fileCount: 1
        };
        const mockFiles: ChangedFile[] = [
            { path: 'file.ts', status: 'M', additions: 5, deletions: 2 }
        ];

        mockGitService.getStashFiles.mockResolvedValue(mockFiles);
        
        provider.setRepoRoot('/root');
        const stashItem = new StashTreeItem(mockStash, '/root', vscode.TreeItemCollapsibleState.Expanded);
        const items = await provider.getChildren(stashItem);
        
        expect(items.length).toBe(1);
        expect(items[0]).toBeInstanceOf(StashFileTreeItem);
        expect(items[0].label).toBe('file.ts');
        expect((items[0] as StashFileTreeItem).file).toEqual(mockFiles[0]);
    });

    test('getChildren handles errors when fetching stashes', async () => {
        mockGitService.getStashes.mockRejectedValue(new Error('Git error'));
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
            fileCount: 1
        };

        mockGitService.getStashFiles.mockRejectedValue(new Error('Git error'));
        const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => { });

        provider.setRepoRoot('/root');
        const stashItem = new StashTreeItem(mockStash, '/root', vscode.TreeItemCollapsibleState.Expanded);
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
});

