import * as vscode from 'vscode';
import { CommitCommands } from '../../src/commands/commitCommands';
import { GitService } from '../../src/services/gitService';
import { DiffService } from '../../src/services/diffService';
import { CommitDetailsProvider } from '../../src/providers/commitDetailsProvider';
import { CommitInfo } from '../../src/types/git';

// Mock dependencies
jest.mock('../../src/services/gitService');
jest.mock('../../src/services/diffService');
jest.mock('../../src/providers/commitDetailsProvider');

describe('CommitCommands', () => {
    let commitCommands: CommitCommands;
    let mockGitService: jest.Mocked<GitService>;
    let mockDiffService: jest.Mocked<DiffService>;
    let mockCommitDetailsProvider: jest.Mocked<CommitDetailsProvider>;

    beforeEach(() => {
        // Reset all mocks
        jest.clearAllMocks();

        mockGitService = new GitService() as jest.Mocked<GitService>;
        mockDiffService = new DiffService(mockGitService) as jest.Mocked<DiffService>;
        mockCommitDetailsProvider = new CommitDetailsProvider(mockGitService) as jest.Mocked<CommitDetailsProvider>;

        commitCommands = new CommitCommands(
            mockGitService,
            mockDiffService,
            mockCommitDetailsProvider
        );

        // Mock vscode APIs
        (vscode.commands.executeCommand as jest.Mock) = jest.fn().mockResolvedValue(undefined);
        (vscode.window.showErrorMessage as jest.Mock) = jest.fn().mockResolvedValue(undefined);
        (vscode.window.showInformationMessage as jest.Mock) = jest.fn().mockResolvedValue(undefined);
        (vscode.env.clipboard.writeText as jest.Mock) = jest.fn().mockResolvedValue(undefined);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('showCommitDetails', () => {
        const mockRepoRoot = '/test/repo';
        const mockFilePath = '/test/repo/src/file.ts';

        beforeEach(() => {
            mockGitService.getRepoRoot.mockResolvedValue(mockRepoRoot);
        });

        test('handles regular committed changes', async () => {
            const mockCommit: CommitInfo = {
                hash: 'abc123def456',
                shortHash: 'abc123d',
                message: 'Test commit',
                author: 'Test Author',
                date: '2023-01-01',
                relativeDate: '1 day ago',
            };

            mockGitService.getChangedFilesInCommit.mockResolvedValue([
                { path: 'src/file.ts', status: 'M', additions: 10, deletions: 5 }
            ]);

            await commitCommands.showCommitDetails(mockCommit, mockFilePath, 10);

            expect(mockCommitDetailsProvider.setCommit).toHaveBeenCalledWith(mockCommit, mockRepoRoot);
            expect(mockDiffService.showFileDiff).toHaveBeenCalled();
            expect(vscode.commands.executeCommand).toHaveBeenCalledWith('setContext', 'gitmaster.commitSelected', true);
        });

        test('handles uncommitted changes with all-zero hash', async () => {
            const mockCommit: CommitInfo = {
                hash: '0000000000000000000000000000000000000000',
                shortHash: '0000000',
                message: 'Uncommitted changes',
                author: 'Not Committed Yet',
                date: '',
                relativeDate: '',
            };

            await commitCommands.showCommitDetails(mockCommit, mockFilePath, 10);

            // Should NOT call setCommit or showFileDiff for uncommitted changes
            expect(mockCommitDetailsProvider.setCommit).not.toHaveBeenCalled();
            expect(mockDiffService.showFileDiff).not.toHaveBeenCalled();

            // Should call vscode.diff to show working directory changes
            expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
                'vscode.diff',
                expect.objectContaining({ scheme: 'git', fsPath: expect.stringContaining('/test/repo/src/file.ts') }),
                expect.objectContaining({ scheme: 'file', fsPath: mockFilePath }),
                expect.stringContaining('Working Directory Changes'),
                expect.any(Object)
            );
        });

        test('handles uncommitted changes with short zero hash', async () => {
            const mockCommit: CommitInfo = {
                hash: '00000000',
                shortHash: '0000000',
                message: 'Uncommitted changes',
                author: 'Not Committed Yet',
                date: '',
                relativeDate: '',
            };

            await commitCommands.showCommitDetails(mockCommit, mockFilePath, 5);

            // Should recognize as uncommitted and use VS Code's built-in diff
            expect(mockCommitDetailsProvider.setCommit).not.toHaveBeenCalled();
            expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
                'vscode.diff',
                expect.any(Object),
                expect.any(Object),
                expect.stringContaining('Working Directory Changes'),
                expect.any(Object)
            );
        });

        test('handles file URI schemes correctly', async () => {
            const mockCommit: CommitInfo = {
                hash: 'abc123def456',
                shortHash: 'abc123d',
                message: 'Test commit',
                author: 'Test Author',
                date: '2023-01-01',
                relativeDate: '1 day ago',
            };

            const fileUri = `file://${mockFilePath}`;

            mockGitService.getChangedFilesInCommit.mockResolvedValue([]);

            await commitCommands.showCommitDetails(mockCommit, fileUri, 10);

            // The URI is parsed and fsPath is extracted
            expect(mockGitService.getRepoRoot).toHaveBeenCalled();
            expect(mockCommitDetailsProvider.setCommit).toHaveBeenCalled();
        });

        test('shows error message when not in a git repository', async () => {
            mockGitService.getRepoRoot.mockResolvedValue(null);

            const mockCommit: CommitInfo = {
                hash: 'abc123def456',
                shortHash: 'abc123d',
                message: 'Test commit',
                author: 'Test Author',
                date: '2023-01-01',
                relativeDate: '1 day ago',
            };

            await commitCommands.showCommitDetails(mockCommit, mockFilePath);

            expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('Not a git repository');
            expect(mockCommitDetailsProvider.setCommit).not.toHaveBeenCalled();
        });

        test('handles errors gracefully', async () => {
            const mockCommit: CommitInfo = {
                hash: 'abc123def456',
                shortHash: 'abc123d',
                message: 'Test commit',
                author: 'Test Author',
                date: '2023-01-01',
                relativeDate: '1 day ago',
            };

            mockGitService.getChangedFilesInCommit.mockRejectedValue(new Error('Git error'));
            const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => { });

            await commitCommands.showCommitDetails(mockCommit, mockFilePath);

            expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('Failed to show commit details'));
            expect(consoleErrorSpy).toHaveBeenCalled();

            consoleErrorSpy.mockRestore();
        });
    });

    describe('copyCommitId', () => {
        test('copies commit hash to clipboard', async () => {
            const mockCommit: CommitInfo = {
                hash: 'abc123def456',
                shortHash: 'abc123d',
                message: 'Test commit',
                author: 'Test Author',
                date: '2023-01-01',
                relativeDate: '1 day ago',
            };

            await commitCommands.copyCommitId(mockCommit);

            expect(vscode.env.clipboard.writeText).toHaveBeenCalledWith('abc123def456');
            expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(expect.stringContaining('abc123d'));
        });

        test('handles missing commit information', async () => {
            await commitCommands.copyCommitId(null);

            expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('No commit information available');
        });
    });
});

