import { GitBranchService } from '../../src/services/git/branch';
import { GitExecutor } from '../../src/services/git/core';

jest.mock('../../src/services/git/core');

describe('GitBranchService', () => {
    let service: GitBranchService;
    let mockExecutor: jest.Mocked<GitExecutor>;

    beforeEach(() => {
        jest.clearAllMocks();
        mockExecutor = {
            exec: jest.fn(),
            execShell: jest.fn(),
        } as any;
        service = new GitBranchService(mockExecutor);
    });

    describe('getLocalBranches', () => {
        test('returns only local branches and parses upstream', async () => {
            const stdout =
                'refs/heads/master|master|*|aaaaaaaa|aaaaaaa|Initial commit|Alice|1 day ago|\n' +
                'refs/heads/feature/x|feature/x||bbbbbbbb|bbbbbbb|Add feature|Bob|2 hours ago|origin/feature/x\n';

            mockExecutor.execShell.mockResolvedValueOnce({ stdout, stderr: '' } as any);

            const branches = await service.getLocalBranches('/repo', 50);

            expect(branches).toHaveLength(2);
            expect(branches[0]).toEqual(expect.objectContaining({
                name: 'master',
                isCurrent: true,
                isRemote: false,
                upstream: undefined,
            }));
            expect(branches[1]).toEqual(expect.objectContaining({
                name: 'feature/x',
                isCurrent: false,
                isRemote: false,
                upstream: 'origin/feature/x',
            }));
        });
    });
});


