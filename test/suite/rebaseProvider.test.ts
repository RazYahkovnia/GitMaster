import * as vscode from 'vscode';
import { RebaseProvider, RebaseTreeItem } from '../../src/providers/rebaseProvider';
import { GitService } from '../../src/services/gitService';
import { RebaseCommit, RebaseState } from '../../src/types/git';

// Mock GitService
jest.mock('../../src/services/gitService');
// Mock vscode commands
// jest.spyOn(vscode.commands, 'executeCommand').mockImplementation(() => Promise.resolve());
(vscode.commands.executeCommand as jest.Mock) = jest.fn().mockResolvedValue(undefined);


describe('RebaseProvider', () => {
    let provider: RebaseProvider;
    let mockGitService: jest.Mocked<GitService>;

    beforeEach(() => {
        mockGitService = new GitService() as jest.Mocked<GitService>;
        provider = new RebaseProvider(mockGitService);
        jest.clearAllMocks();
    });

    test('getChildren returns "Open a Git repository" when not initialized', async () => {
        const items = await provider.getChildren();
        expect(items.length).toBe(1);
        expect(items[0].label).toBe('Open a Git repository');
        expect(items[0].contextValue).toBe('rebaseInfo');
    });

    test('setRepoRoot loads commits for current branch', async () => {
        const mockCommits: RebaseCommit[] = [
            {
                hash: '123',
                shortHash: '123',
                message: 'Test Commit',
                author: 'Tester',
                date: '2023-01-01',
                action: 'pick'
            }
        ];

        mockGitService.getCurrentBranch.mockResolvedValue('feature');
        mockGitService.getDefaultBranch.mockResolvedValue('main');
        mockGitService.getCommitsAheadOfBase.mockResolvedValue(mockCommits);

        await provider.setRepoRoot('/root');

        expect(mockGitService.getCurrentBranch).toHaveBeenCalledWith('/root');
        expect(mockGitService.getDefaultBranch).toHaveBeenCalledWith('/root');
        expect(mockGitService.getCommitsAheadOfBase).toHaveBeenCalledWith('/root', 'main', 'feature');
        
        const state = provider.getRebaseState();
        expect(state).toBeDefined();
        expect(state?.commits.length).toBe(1);
    });

    test('getChildren returns status header when rebase in progress', async () => {
        const mockState: RebaseState = {
            repoRoot: '/root',
            currentBranch: 'feature',
            baseBranch: 'main',
            commits: [{
                hash: '123',
                shortHash: '123',
                message: 'WIP',
                author: 'Me',
                date: 'today',
                action: 'pick'
            }],
            isInProgress: true,
            hasConflicts: true,
            conflictMessage: 'Conflict in file.ts'
        };

        await provider.setRebaseState(mockState);
        const items = await provider.getChildren();

        expect(items.length).toBe(3); // Status + Conflict Info + 1 Commit
        expect(items[0].label).toBe('⚠️ Rebase in Progress');
        expect(items[0].contextValue).toBe('rebaseStatus');
        expect(items[1].label).toBe('Conflict in file.ts');
    });

    test('getChildren returns commit items', async () => {
        const mockState: RebaseState = {
            repoRoot: '/root',
            currentBranch: 'feature',
            baseBranch: 'main',
            commits: [
                {
                    hash: '123',
                    shortHash: '123',
                    message: 'Test Commit',
                    author: 'Tester',
                    date: '2023-01-01',
                    action: 'pick'
                }
            ],
            isInProgress: false,
            hasConflicts: false
        };

        await provider.setRebaseState(mockState);
        const items = await provider.getChildren();

        expect(items.length).toBe(2); // Header + 1 Commit
        expect(items[0].contextValue).toBe('rebaseHeader');
        expect(items[1].contextValue).toBe('rebaseCommit');
        expect(items[1].label).toBe('Test Commit');
    });

    test('updateCommitAction updates action and refreshes', async () => {
        const refreshSpy = jest.spyOn(provider, 'refresh');
        const mockState: RebaseState = {
            repoRoot: '/root',
            currentBranch: 'feature',
            baseBranch: 'main',
            commits: [
                {
                    hash: '123',
                    shortHash: '123',
                    message: 'Test Commit',
                    author: 'Tester',
                    date: '2023-01-01',
                    action: 'pick'
                }
            ],
            isInProgress: false,
            hasConflicts: false
        };

        await provider.setRebaseState(mockState);
        refreshSpy.mockClear();

        provider.updateCommitAction('123', 'drop');

        const state = provider.getRebaseState();
        expect(state?.commits[0].action).toBe('drop');
        expect(refreshSpy).toHaveBeenCalled();
        expect(vscode.commands.executeCommand).toHaveBeenCalledWith('setContext', 'gitmaster.rebaseHasChanges', true);
    });

    test('RebaseTreeItem renders correct icons for actions', () => {
        const createItem = (action: any) => new RebaseTreeItem(
            'Test',
            vscode.TreeItemCollapsibleState.None,
            {
                hash: '123',
                shortHash: '123',
                message: 'Test',
                author: 'Tester',
                date: '2023-01-01',
                action: action
            },
            'commit'
        );

        // Access private method via casting or property inspection if possible, 
        // or rely on public properties like iconPath which is set in constructor
        const item = createItem('pick');
        expect((item.iconPath as vscode.ThemeIcon).id).toBe('git-commit');
        
        const dropItem = createItem('drop');
        expect((dropItem.iconPath as vscode.ThemeIcon).id).toBe('trash');
    });
});

