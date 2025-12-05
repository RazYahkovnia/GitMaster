import * as vscode from 'vscode';
import { WorktreesProvider, WorktreeTreeItem } from '../../src/providers/worktreesProvider';
import { GitService } from '../../src/services/gitService';
import { GitWorktree } from '../../src/types/git';

// Mock GitService
jest.mock('../../src/services/gitService');

describe('WorktreesProvider', () => {
    let provider: WorktreesProvider;
    let mockGitService: jest.Mocked<GitService>;

    beforeEach(() => {
        mockGitService = new GitService() as jest.Mocked<GitService>;
        provider = new WorktreesProvider(mockGitService);
    });

    test('getChildren returns "No repository opened" when no repo root is set', async () => {
        const items = await provider.getChildren();
        expect(items.length).toBe(1);
        expect(items[0].label).toBe('No repository opened');
        expect(items[0].contextValue).toBe('empty');
    });

    test('getChildren returns "No worktrees found" when list is empty', async () => {
        mockGitService.getWorktrees.mockResolvedValue([]);
        
        provider.setRepoRoot('/root');
        const items = await provider.getChildren();
        
        expect(items.length).toBe(1);
        expect(items[0].label).toBe('No worktrees found');
        expect(items[0].contextValue).toBe('empty');
    });

    test('getChildren returns worktree items', async () => {
        const mockWorktrees: GitWorktree[] = [
            {
                path: '/root',
                head: '123',
                branch: 'main',
                isMain: true,
                isCurrent: true
            },
            {
                path: '/root/worktree',
                head: '456',
                branch: 'feature',
                isMain: false,
                isCurrent: false
            }
        ];

        mockGitService.getWorktrees.mockResolvedValue(mockWorktrees);
        
        provider.setRepoRoot('/root');
        const items = await provider.getChildren();
        
        expect(items.length).toBe(2);
        
        // Main/Current worktree
        expect(items[0]).toBeInstanceOf(WorktreeTreeItem);
        expect(items[0].contextValue).toBe('worktreeCurrent'); // Current takes precedence or specific check?
        // Note: Code sets 'worktreeCurrent' if isCurrent is true, else 'worktreeMain' if isMain
        
        // Linked worktree
        expect(items[1]).toBeInstanceOf(WorktreeTreeItem);
        expect(items[1].contextValue).toBe('worktreeLinked');
        expect(items[1].label).toBe('worktree'); // basename of path
    });

    test('WorktreeTreeItem properties are set correctly', () => {
        const worktree: GitWorktree = {
            path: '/root/my-worktree',
            head: '1234567',
            branch: 'feature-branch',
            isMain: false,
            isCurrent: false
        };

        const item = new WorktreeTreeItem(worktree, '/root');
        
        expect(item.label).toBe('my-worktree');
        expect(item.resourceUri?.fsPath).toBe('/root/my-worktree');
        expect(item.contextValue).toBe('worktreeLinked');
        expect((item.iconPath as vscode.ThemeIcon).id).toBe('folder');
        
        // Tooltip check (basic existence check)
        expect(typeof item.tooltip).toBe('string');
        expect(item.tooltip).toContain('Path: /root/my-worktree');
        expect(item.tooltip).toContain('Branch: feature-branch');
    });

    test('getChildren handles errors gracefully', async () => {
        mockGitService.getWorktrees.mockRejectedValue(new Error('Git error'));
        const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => { });

        provider.setRepoRoot('/root');
        const items = await provider.getChildren();

        expect(items.length).toBe(1);
        expect(items[0].label).toBe('Failed to load worktrees');
        expect(items[0].contextValue).toBe('empty');
        expect(consoleSpy).toHaveBeenCalled();
        consoleSpy.mockRestore();
    });
});

