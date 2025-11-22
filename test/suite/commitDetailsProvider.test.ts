import * as vscode from 'vscode';
import { CommitDetailsProvider } from '../../src/providers/commitDetailsProvider';
import { GitService } from '../../src/services/gitService';
import { CommitInfo, ChangedFile } from '../../src/types/git';

// Mock GitService
jest.mock('../../src/services/gitService');

describe('CommitDetailsProvider', () => {
    let provider: CommitDetailsProvider;
    let mockGitService: jest.Mocked<GitService>;

    beforeEach(() => {
        mockGitService = new GitService() as jest.Mocked<GitService>;
        provider = new CommitDetailsProvider(mockGitService);
    });

    test('getChildren returns empty array when no commit is set', async () => {
        const items = await provider.getChildren();
        expect(items).toEqual([]);
    });

    test('getChildren returns commit info and files when commit is set', async () => {
        const mockCommit: CommitInfo = {
            hash: '123',
            shortHash: '123',
            message: 'Test Commit',
            author: 'Tester',
            date: '2023-01-01',
            relativeDate: '1 day ago',

        };
        const mockFiles: ChangedFile[] = [
            { path: 'file1.ts', status: 'M', additions: 10, deletions: 5 }
        ];

        mockGitService.getChangedFilesInCommit.mockResolvedValue(mockFiles);
        mockGitService.getGitHubRepoUrl.mockResolvedValue('https://github.com/repo');

        await provider.setCommit(mockCommit, '/root');

        const items = await provider.getChildren();

        // Header + Author + GitHub + Separator + 1 File = 5 items
        expect(items.length).toBe(5);
        expect(items[0].label).toBe('Test Commit');
        expect(items[4].label).toBe('file1.ts');
    });

    test('setCommit fetches changed files and updates view', async () => {
        const refreshSpy = jest.spyOn(provider, 'refresh');
        const mockCommit: CommitInfo = {
            hash: '123',
            shortHash: '123',
            message: 'Test',
            author: 'Tester',
            date: '2023-01-01',
            relativeDate: '1 day ago',

        };

        mockGitService.getChangedFilesInCommit.mockResolvedValue([]);
        mockGitService.getGitHubRepoUrl.mockResolvedValue(null);

        await provider.setCommit(mockCommit, '/root');

        expect(mockGitService.getChangedFilesInCommit).toHaveBeenCalledWith('123', '/root');
        expect(refreshSpy).toHaveBeenCalled();
    });

    test('setCommit handles errors gracefully', async () => {
        const mockCommit: CommitInfo = {
            hash: '123',
            shortHash: '123',
            message: 'Test',
            author: 'Tester',
            date: '2023-01-01',
            relativeDate: '1 day ago',

        };

        mockGitService.getChangedFilesInCommit.mockRejectedValue(new Error('Git error'));
        const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => { });

        await provider.setCommit(mockCommit, '/root');

        expect(consoleSpy).toHaveBeenCalled();
        consoleSpy.mockRestore();
    });

    test('clear resets state and refreshes view', async () => {
        const refreshSpy = jest.spyOn(provider, 'refresh');

        // Set some state first
        const mockCommit: CommitInfo = {
            hash: '123',
            shortHash: '123',
            message: 'Test',
            author: 'Tester',
            date: '2023-01-01',
            relativeDate: '1 day ago'
        };
        mockGitService.getChangedFilesInCommit.mockResolvedValue([]);
        await provider.setCommit(mockCommit, '/root');
        refreshSpy.mockClear();

        provider.clear();

        const items = await provider.getChildren();
        expect(items).toEqual([]);
        expect(refreshSpy).toHaveBeenCalled();
    });
});
