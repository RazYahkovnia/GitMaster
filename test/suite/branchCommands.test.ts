import * as vscode from 'vscode';
import { BranchCommands } from '../../src/commands/branchCommands';
import { BranchInfo } from '../../src/types/git';

describe('BranchCommands', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('deleteBranch can delete local and then remote (based on upstream)', async () => {
        const gitService: any = {
            deleteBranch: jest.fn().mockResolvedValue(undefined),
            deleteRemoteBranch: jest.fn().mockResolvedValue(undefined),
            getRemoteTrackingBranches: jest.fn().mockResolvedValue([]),
        };
        const branchesProvider: any = { refresh: jest.fn() };

        const commands = new BranchCommands(gitService, branchesProvider);

        const branch: BranchInfo = {
            name: 'feature/x',
            isCurrent: false,
            isRemote: false,
            commitHash: 'aaaaaaaa',
            shortCommitHash: 'aaaaaaa',
            lastCommitMessage: 'msg',
            lastCommitAuthor: 'me',
            lastCommitDate: 'now',
            lastCommitTimestamp: '2024-01-02T10:00:00+00:00',
            upstream: 'origin/feature/x',
        };

        // First confirm: choose Delete Local + Remote
        (vscode.window.showWarningMessage as jest.Mock)
            .mockResolvedValueOnce('Delete Local + Remote')
            // Remote confirm: confirm delete
            .mockResolvedValueOnce('Delete Remote Branch');

        await commands.deleteBranch(branch, '/repo');

        expect(gitService.deleteBranch).toHaveBeenCalledWith('feature/x', '/repo', false);
        expect(gitService.deleteRemoteBranch).toHaveBeenCalledWith('origin', 'feature/x', '/repo');
        expect(branchesProvider.refresh).toHaveBeenCalled();
    });

    test('deleteBranch offers remote delete even without upstream when matching remote-tracking branch exists', async () => {
        const gitService: any = {
            deleteBranch: jest.fn().mockResolvedValue(undefined),
            deleteRemoteBranch: jest.fn().mockResolvedValue(undefined),
            getRemoteTrackingBranches: jest.fn().mockResolvedValue(['origin/feature/x']),
        };
        const branchesProvider: any = { refresh: jest.fn() };

        const commands = new BranchCommands(gitService, branchesProvider);

        const branch: BranchInfo = {
            name: 'feature/x',
            isCurrent: false,
            isRemote: false,
            commitHash: 'aaaaaaaa',
            shortCommitHash: 'aaaaaaa',
            lastCommitMessage: 'msg',
            lastCommitAuthor: 'me',
            lastCommitDate: 'now',
            lastCommitTimestamp: '2024-01-02T10:00:00+00:00',
            upstream: undefined,
        };

        (vscode.window.showWarningMessage as jest.Mock)
            .mockResolvedValueOnce('Delete Local + Remote')
            .mockResolvedValueOnce('Delete Remote Branch');

        await commands.deleteBranch(branch, '/repo');

        expect(gitService.deleteBranch).toHaveBeenCalledWith('feature/x', '/repo', false);
        expect(gitService.deleteRemoteBranch).toHaveBeenCalledWith('origin', 'feature/x', '/repo');
    });
});


