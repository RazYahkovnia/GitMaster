import * as vscode from 'vscode';
import { BranchesProvider } from '../../src/providers/branchesProvider';
import { GitService } from '../../src/services/gitService';
import { BranchInfo } from '../../src/types/git';

jest.mock('../../src/services/gitService');

describe('BranchesProvider', () => {
    let provider: BranchesProvider;
    let mockGitService: jest.Mocked<GitService>;

    const makeContext = (pinned: Record<string, string[]>) =>
    ({
        workspaceState: {
            get: jest.fn().mockReturnValue(pinned),
            update: jest.fn().mockResolvedValue(undefined),
        },
    } as any);

    const makeBranch = (overrides: Partial<BranchInfo>): BranchInfo => ({
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
        ...overrides,
    });

    beforeEach(() => {
        jest.clearAllMocks();
        mockGitService = new GitService() as jest.Mocked<GitService>;
    });

    test('getChildren returns "No repository opened" when no repo root is set', async () => {
        provider = new BranchesProvider(mockGitService, makeContext({}));
        const items = await provider.getChildren();
        expect(items.length).toBe(1);
        expect(items[0].label).toBe('No repository opened');
        expect(items[0].contextValue).toBe('empty');
    });

    test('toggleGroupByDate groups branches and adds date separators (pinned stays at top)', async () => {
        const repoRoot = '/repo';
        provider = new BranchesProvider(
            mockGitService,
            makeContext({ [repoRoot]: ['pinned-branch'] }),
        );

        const pinnedBranch = makeBranch({
            name: 'pinned-branch',
            lastCommitTimestamp: '2024-01-02T10:00:00+00:00',
        });

        const todayBranch = makeBranch({
            name: 'today-branch',
            lastCommitTimestamp: new Date().toISOString(),
        });

        mockGitService.getLocalBranches.mockResolvedValue([
            pinnedBranch,
            todayBranch,
        ]);

        provider.setRepoRoot(repoRoot);
        provider.toggleGroupByDate();

        const rootItems = await provider.getChildren();

        // First item should be the pinned branch tree item
        expect(rootItems[0].label).toBe('pinned-branch');

        // Should include a date separator for the unpinned branches
        const separator = rootItems.find(i => i instanceof vscode.TreeItem && i.contextValue === 'dateSeparator');
        expect(separator?.label).toBe('Today');

        // Expanding the separator should return only unpinned branches in that group
        const children = await provider.getChildren(separator);
        expect(children.map(c => c.label)).toEqual(['today-branch']);
    });
});


