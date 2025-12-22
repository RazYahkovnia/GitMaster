import { GitStashService } from '../../src/services/git/stash';
import { GitExecutor } from '../../src/services/git/core';

// Mock GitExecutor
jest.mock('../../src/services/git/core');

describe('GitStashService', () => {
    let service: GitStashService;
    let mockExecutor: jest.Mocked<GitExecutor>;

    beforeEach(() => {
        jest.clearAllMocks();
        mockExecutor = {
            exec: jest.fn()
        } as any;
        service = new GitStashService(mockExecutor);
    });

    describe('checkStashConflicts', () => {
        test('returns empty array when no conflicts', async () => {
            // Stash has file1.ts
            mockExecutor.exec
                .mockResolvedValueOnce({ stdout: '5\t2\tfile1.ts', stderr: '' }) // stash show --numstat
                .mockResolvedValueOnce({ stdout: '', stderr: '' }) // staged files
                .mockResolvedValueOnce({ stdout: '', stderr: '' }) // unstaged files
                .mockResolvedValueOnce({ stdout: '', stderr: '' }); // untracked files

            const conflicts = await service.checkStashConflicts('stash@{0}', '/repo');

            expect(conflicts).toEqual([]);
        });

        test('detects conflicts with staged files', async () => {
            // Mock getStashFiles - stash has file1.ts
            mockExecutor.exec
                .mockResolvedValueOnce({ stdout: '5\t2\tfile1.ts', stderr: '' }) // stash show --numstat
                .mockRejectedValueOnce(new Error('no third parent')) // ls-tree for untracked
                .mockResolvedValueOnce({ stdout: 'file1.ts', stderr: '' }) // staged files
                .mockResolvedValueOnce({ stdout: '', stderr: '' }) // unstaged files
                .mockResolvedValueOnce({ stdout: '', stderr: '' }); // untracked files

            const conflicts = await service.checkStashConflicts('stash@{0}', '/repo');

            expect(conflicts).toContain('file1.ts');
        });

        test('detects conflicts with unstaged files', async () => {
            mockExecutor.exec
                .mockResolvedValueOnce({ stdout: '5\t2\tfile1.ts', stderr: '' }) // stash show
                .mockRejectedValueOnce(new Error('no third parent')) // ls-tree
                .mockResolvedValueOnce({ stdout: '', stderr: '' }) // staged files
                .mockResolvedValueOnce({ stdout: 'file1.ts', stderr: '' }) // unstaged files
                .mockResolvedValueOnce({ stdout: '', stderr: '' }); // untracked files

            const conflicts = await service.checkStashConflicts('stash@{0}', '/repo');

            expect(conflicts).toContain('file1.ts');
        });

        test('detects conflicts with untracked files', async () => {
            mockExecutor.exec
                .mockResolvedValueOnce({ stdout: '5\t2\tfile1.ts', stderr: '' }) // stash show
                .mockRejectedValueOnce(new Error('no third parent')) // ls-tree
                .mockResolvedValueOnce({ stdout: '', stderr: '' }) // staged files
                .mockResolvedValueOnce({ stdout: '', stderr: '' }) // unstaged files
                .mockResolvedValueOnce({ stdout: 'file1.ts', stderr: '' }); // untracked files

            const conflicts = await service.checkStashConflicts('stash@{0}', '/repo');

            expect(conflicts).toContain('file1.ts');
        });

        test('handles multiple conflicting files', async () => {
            mockExecutor.exec
                .mockResolvedValueOnce({ stdout: '5\t2\tfile1.ts\n3\t1\tfile2.ts\n10\t0\tfile3.ts', stderr: '' })
                .mockRejectedValueOnce(new Error('no third parent'))
                .mockResolvedValueOnce({ stdout: 'file1.ts\nfile3.ts', stderr: '' }) // staged
                .mockResolvedValueOnce({ stdout: 'file2.ts', stderr: '' }) // unstaged
                .mockResolvedValueOnce({ stdout: '', stderr: '' }); // untracked

            const conflicts = await service.checkStashConflicts('stash@{0}', '/repo');

            expect(conflicts).toHaveLength(3);
            expect(conflicts).toContain('file1.ts');
            expect(conflicts).toContain('file2.ts');
            expect(conflicts).toContain('file3.ts');
        });

        test('returns empty array on error', async () => {
            mockExecutor.exec.mockRejectedValueOnce(new Error('git error'));

            const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => { });
            const conflicts = await service.checkStashConflicts('stash@{0}', '/repo');

            expect(conflicts).toEqual([]);
            consoleSpy.mockRestore();
        });
    });

    describe('getStashes', () => {
        test('returns empty array when no stashes', async () => {
            mockExecutor.exec.mockResolvedValueOnce({ stdout: '', stderr: '' });

            const stashes = await service.getStashes('/repo');

            expect(stashes).toEqual([]);
        });

        test('parses stash list correctly', async () => {
            const stashListOutput = 'stash@{0}|On main: My stash message|2024-01-01 12:00:00 +0000|2 hours ago';
            mockExecutor.exec
                .mockResolvedValueOnce({ stdout: stashListOutput, stderr: '' }) // stash list
                .mockResolvedValueOnce({ stdout: '5\t2\tfile.ts', stderr: '' }) // getStashFileCount - numstat
                .mockRejectedValueOnce(new Error('no third parent')) // getStashFileCount - ls-tree
                .mockResolvedValueOnce({ stdout: '5\t2\tfile.ts', stderr: '' }) // getStashStats - numstat
                .mockRejectedValueOnce(new Error('no third parent')); // getStashStats - ls-tree

            const stashes = await service.getStashes('/repo');

            expect(stashes).toHaveLength(1);
            expect(stashes[0].index).toBe('stash@{0}');
            expect(stashes[0].branch).toBe('main');
            expect(stashes[0].message).toBe('My stash message');
            expect(stashes[0].fileCount).toBe(1);
            expect(stashes[0].additions).toBe(5);
            expect(stashes[0].deletions).toBe(2);
        });

        test('handles WIP prefix in stash message', async () => {
            const stashListOutput = 'stash@{0}|WIP on feature: work in progress|2024-01-01 12:00:00 +0000|1 hour ago';
            mockExecutor.exec
                .mockResolvedValueOnce({ stdout: stashListOutput, stderr: '' })
                .mockResolvedValueOnce({ stdout: '', stderr: '' })
                .mockRejectedValueOnce(new Error('no third parent'))
                .mockResolvedValueOnce({ stdout: '', stderr: '' })
                .mockRejectedValueOnce(new Error('no third parent'));

            const stashes = await service.getStashes('/repo');

            expect(stashes[0].branch).toBe('feature');
            expect(stashes[0].message).toBe('work in progress');
        });

        test('handles multiple stashes', async () => {
            const stashListOutput =
                'stash@{0}|On main: First stash|2024-01-01 14:00:00 +0000|1 hour ago\n' +
                'stash@{1}|On dev: Second stash|2024-01-01 12:00:00 +0000|3 hours ago';

            mockExecutor.exec
                .mockResolvedValueOnce({ stdout: stashListOutput, stderr: '' })
                // First stash counts/stats
                .mockResolvedValueOnce({ stdout: '3\t1\tfile1.ts', stderr: '' })
                .mockRejectedValueOnce(new Error('no third parent'))
                .mockResolvedValueOnce({ stdout: '3\t1\tfile1.ts', stderr: '' })
                .mockRejectedValueOnce(new Error('no third parent'))
                // Second stash counts/stats
                .mockResolvedValueOnce({ stdout: '5\t2\tfile2.ts\n2\t0\tfile3.ts', stderr: '' })
                .mockRejectedValueOnce(new Error('no third parent'))
                .mockResolvedValueOnce({ stdout: '5\t2\tfile2.ts\n2\t0\tfile3.ts', stderr: '' })
                .mockRejectedValueOnce(new Error('no third parent'));

            const stashes = await service.getStashes('/repo');

            expect(stashes).toHaveLength(2);
            expect(stashes[0].message).toBe('First stash');
            expect(stashes[1].message).toBe('Second stash');
        });

        test('returns empty array on error', async () => {
            mockExecutor.exec.mockRejectedValueOnce(new Error('git error'));
            const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => { });

            const stashes = await service.getStashes('/repo');

            expect(stashes).toEqual([]);
            consoleSpy.mockRestore();
        });
    });

    describe('hasChangesToStash', () => {
        test('returns true when there are changes', async () => {
            mockExecutor.exec.mockResolvedValueOnce({ stdout: ' M file.ts', stderr: '' });

            const result = await service.hasChangesToStash('/repo');

            expect(result).toBe(true);
        });

        test('returns false when no changes', async () => {
            mockExecutor.exec.mockResolvedValueOnce({ stdout: '', stderr: '' });

            const result = await service.hasChangesToStash('/repo');

            expect(result).toBe(false);
        });

        test('returns false on error', async () => {
            mockExecutor.exec.mockRejectedValueOnce(new Error('error'));

            const result = await service.hasChangesToStash('/repo');

            expect(result).toBe(false);
        });
    });

    describe('hasUntrackedFiles', () => {
        test('returns true when untracked files exist', async () => {
            mockExecutor.exec.mockResolvedValueOnce({ stdout: '?? newfile.ts\n M tracked.ts', stderr: '' });

            const result = await service.hasUntrackedFiles('/repo');

            expect(result).toBe(true);
        });

        test('returns false when no untracked files', async () => {
            mockExecutor.exec.mockResolvedValueOnce({ stdout: ' M tracked.ts\nA  staged.ts', stderr: '' });

            const result = await service.hasUntrackedFiles('/repo');

            expect(result).toBe(false);
        });

        test('returns false on error', async () => {
            mockExecutor.exec.mockRejectedValueOnce(new Error('error'));

            const result = await service.hasUntrackedFiles('/repo');

            expect(result).toBe(false);
        });
    });

    describe('hasTrackedChanges', () => {
        test('returns true when tracked changes exist', async () => {
            mockExecutor.exec.mockResolvedValueOnce({ stdout: ' M tracked.ts', stderr: '' });

            const result = await service.hasTrackedChanges('/repo');

            expect(result).toBe(true);
        });

        test('returns false when only untracked files', async () => {
            mockExecutor.exec.mockResolvedValueOnce({ stdout: '?? newfile.ts', stderr: '' });

            const result = await service.hasTrackedChanges('/repo');

            expect(result).toBe(false);
        });

        test('returns true with both tracked and untracked', async () => {
            mockExecutor.exec.mockResolvedValueOnce({ stdout: '?? newfile.ts\n M tracked.ts', stderr: '' });

            const result = await service.hasTrackedChanges('/repo');

            expect(result).toBe(true);
        });
    });

    describe('hasStagedChanges', () => {
        test('returns true when staged changes exist', async () => {
            // git diff --cached --quiet exits with error when there are changes
            mockExecutor.exec.mockRejectedValueOnce(new Error('exit code 1'));

            const result = await service.hasStagedChanges('/repo');

            expect(result).toBe(true);
        });

        test('returns false when no staged changes', async () => {
            // git diff --cached --quiet succeeds (exit 0) when no changes
            mockExecutor.exec.mockResolvedValueOnce({ stdout: '', stderr: '' });

            const result = await service.hasStagedChanges('/repo');

            expect(result).toBe(false);
        });
    });

    describe('hasFilesWithMixedChanges', () => {
        test('returns true when file has both staged and unstaged changes', async () => {
            mockExecutor.exec
                .mockResolvedValueOnce({ stdout: 'file1.ts\nfile2.ts', stderr: '' }) // staged
                .mockResolvedValueOnce({ stdout: 'file2.ts\nfile3.ts', stderr: '' }); // unstaged (file2.ts overlaps)

            const result = await service.hasFilesWithMixedChanges('/repo');

            expect(result).toBe(true);
        });

        test('returns false when staged and unstaged are different files', async () => {
            mockExecutor.exec
                .mockResolvedValueOnce({ stdout: 'file1.ts', stderr: '' }) // staged
                .mockResolvedValueOnce({ stdout: 'file2.ts', stderr: '' }); // unstaged

            const result = await service.hasFilesWithMixedChanges('/repo');

            expect(result).toBe(false);
        });

        test('returns false on error', async () => {
            mockExecutor.exec.mockRejectedValueOnce(new Error('error'));
            const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => { });

            const result = await service.hasFilesWithMixedChanges('/repo');

            expect(result).toBe(false);
            consoleSpy.mockRestore();
        });
    });

    describe('getStashPreview', () => {
        test('returns staged and unstaged file info', async () => {
            mockExecutor.exec
                .mockResolvedValueOnce({ stdout: '5\t2\tfile1.ts', stderr: '' }) // staged
                .mockResolvedValueOnce({ stdout: '3\t1\tfile2.ts', stderr: '' }); // unstaged

            const result = await service.getStashPreview('/repo');

            expect(result.staged).toHaveLength(1);
            expect(result.staged[0]).toEqual({ file: 'file1.ts', additions: 5, deletions: 2 });
            expect(result.unstaged).toHaveLength(1);
            expect(result.unstaged[0]).toEqual({ file: 'file2.ts', additions: 3, deletions: 1 });
            expect(result.untracked).toHaveLength(0);
        });

        test('includes untracked files when requested', async () => {
            mockExecutor.exec
                .mockResolvedValueOnce({ stdout: '', stderr: '' }) // staged
                .mockResolvedValueOnce({ stdout: '', stderr: '' }) // unstaged
                .mockResolvedValueOnce({ stdout: 'newfile.ts\nanother.ts', stderr: '' }); // untracked

            const result = await service.getStashPreview('/repo', true);

            expect(result.untracked).toHaveLength(2);
            expect(result.untracked).toContain('newfile.ts');
            expect(result.untracked).toContain('another.ts');
        });

        test('returns empty arrays on error', async () => {
            mockExecutor.exec.mockRejectedValueOnce(new Error('error'));
            const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => { });

            const result = await service.getStashPreview('/repo');

            expect(result).toEqual({ staged: [], unstaged: [], untracked: [] });
            consoleSpy.mockRestore();
        });
    });

    describe('createStash', () => {
        test('creates stash with message', async () => {
            mockExecutor.exec.mockResolvedValueOnce({ stdout: '', stderr: '' });
            const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => { });

            await service.createStash('/repo', 'My stash');

            expect(mockExecutor.exec).toHaveBeenCalledWith(
                ['stash', 'push', '-m', 'My stash'],
                { cwd: '/repo' }
            );
            consoleSpy.mockRestore();
        });

        test('includes untracked files when requested', async () => {
            mockExecutor.exec.mockResolvedValueOnce({ stdout: '', stderr: '' });
            const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => { });

            await service.createStash('/repo', 'My stash', true);

            expect(mockExecutor.exec).toHaveBeenCalledWith(
                ['stash', 'push', '-u', '-m', 'My stash'],
                { cwd: '/repo' }
            );
            consoleSpy.mockRestore();
        });

        test('keeps index when requested', async () => {
            mockExecutor.exec.mockResolvedValueOnce({ stdout: '', stderr: '' });
            const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => { });

            await service.createStash('/repo', 'My stash', false, true);

            expect(mockExecutor.exec).toHaveBeenCalledWith(
                ['stash', 'push', '--keep-index', '-m', 'My stash'],
                { cwd: '/repo' }
            );
            consoleSpy.mockRestore();
        });

        test('creates staged-only stash', async () => {
            mockExecutor.exec.mockResolvedValueOnce({ stdout: '', stderr: '' });
            const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => { });

            await service.createStash('/repo', 'Staged only', false, false, true);

            expect(mockExecutor.exec).toHaveBeenCalledWith(
                ['stash', 'push', '--staged', '-m', 'Staged only'],
                { cwd: '/repo' }
            );
            consoleSpy.mockRestore();
        });

        test('stashes specific files', async () => {
            mockExecutor.exec.mockResolvedValueOnce({ stdout: '', stderr: '' });
            const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => { });

            await service.createStash('/repo', 'Specific files', false, false, false, ['file1.ts', 'file2.ts']);

            expect(mockExecutor.exec).toHaveBeenCalledWith(
                ['stash', 'push', '-m', 'Specific files', '--', 'file1.ts', 'file2.ts'],
                { cwd: '/repo' }
            );
            consoleSpy.mockRestore();
        });

        test('throws error on failure', async () => {
            mockExecutor.exec.mockRejectedValueOnce(new Error('git error'));
            const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => { });

            await expect(service.createStash('/repo', 'My stash'))
                .rejects.toThrow('Failed to create stash');
            consoleSpy.mockRestore();
        });
    });

    describe('applyStash', () => {
        test('applies stash with index flag', async () => {
            mockExecutor.exec.mockResolvedValueOnce({ stdout: '', stderr: '' });

            await service.applyStash('stash@{0}', '/repo');

            expect(mockExecutor.exec).toHaveBeenCalledWith(
                ['stash', 'apply', '--index', 'stash@{0}'],
                { cwd: '/repo' }
            );
        });

        test('throws error on failure', async () => {
            mockExecutor.exec.mockRejectedValueOnce(new Error('conflict'));

            await expect(service.applyStash('stash@{0}', '/repo'))
                .rejects.toThrow('Failed to apply stash');
        });
    });

    describe('popStash', () => {
        test('pops stash with index flag', async () => {
            mockExecutor.exec.mockResolvedValueOnce({ stdout: '', stderr: '' });

            await service.popStash('stash@{0}', '/repo');

            expect(mockExecutor.exec).toHaveBeenCalledWith(
                ['stash', 'pop', '--index', 'stash@{0}'],
                { cwd: '/repo' }
            );
        });

        test('throws error on failure', async () => {
            mockExecutor.exec.mockRejectedValueOnce(new Error('conflict'));

            await expect(service.popStash('stash@{0}', '/repo'))
                .rejects.toThrow('Failed to pop stash');
        });
    });

    describe('deleteStash', () => {
        test('deletes stash', async () => {
            mockExecutor.exec.mockResolvedValueOnce({ stdout: '', stderr: '' });

            await service.deleteStash('stash@{0}', '/repo');

            expect(mockExecutor.exec).toHaveBeenCalledWith(
                ['stash', 'drop', 'stash@{0}'],
                { cwd: '/repo' }
            );
        });

        test('throws error on failure', async () => {
            mockExecutor.exec.mockRejectedValueOnce(new Error('invalid stash'));

            await expect(service.deleteStash('stash@{0}', '/repo'))
                .rejects.toThrow('Failed to delete stash');
        });
    });

    describe('getStashFiles', () => {
        test('returns tracked files from stash', async () => {
            mockExecutor.exec
                .mockResolvedValueOnce({ stdout: '5\t2\tfile1.ts\n3\t1\tfile2.ts', stderr: '' })
                .mockRejectedValueOnce(new Error('no third parent'));

            const files = await service.getStashFiles('stash@{0}', '/repo');

            expect(files).toHaveLength(2);
            expect(files[0]).toEqual({ path: 'file1.ts', status: 'M', additions: 5, deletions: 2 });
            expect(files[1]).toEqual({ path: 'file2.ts', status: 'M', additions: 3, deletions: 1 });
        });

        test('includes untracked files from third parent', async () => {
            mockExecutor.exec
                .mockResolvedValueOnce({ stdout: '', stderr: '' }) // no tracked changes
                .mockResolvedValueOnce({ stdout: 'newfile.ts', stderr: '' }) // ls-tree
                .mockResolvedValueOnce({ stdout: 'line1\nline2\nline3', stderr: '' }); // show file content

            const files = await service.getStashFiles('stash@{0}', '/repo');

            expect(files).toHaveLength(1);
            expect(files[0].path).toBe('newfile.ts');
            expect(files[0].status).toBe('A');
            expect(files[0].additions).toBe(3); // 3 lines
        });

        test('handles binary files in numstat (- for additions/deletions)', async () => {
            mockExecutor.exec
                .mockResolvedValueOnce({ stdout: '-\t-\tbinary.png', stderr: '' })
                .mockRejectedValueOnce(new Error('no third parent'));

            const files = await service.getStashFiles('stash@{0}', '/repo');

            expect(files[0]).toEqual({ path: 'binary.png', status: 'M', additions: 0, deletions: 0 });
        });
    });

    describe('stashHasUntrackedFiles', () => {
        test('returns true when third parent exists', async () => {
            mockExecutor.exec.mockResolvedValueOnce({ stdout: 'abc123', stderr: '' });

            const result = await service.stashHasUntrackedFiles('stash@{0}', '/repo');

            expect(result).toBe(true);
        });

        test('returns false when third parent does not exist', async () => {
            mockExecutor.exec.mockRejectedValueOnce(new Error('bad revision'));

            const result = await service.stashHasUntrackedFiles('stash@{0}', '/repo');

            expect(result).toBe(false);
        });
    });

    describe('stashUntrackedOnly', () => {
        test('directly stashes when no tracked changes', async () => {
            // hasTrackedChanges returns false
            mockExecutor.exec
                .mockResolvedValueOnce({ stdout: '?? newfile.ts', stderr: '' }) // status --porcelain
                .mockResolvedValueOnce({ stdout: '', stderr: '' }); // stash push -u

            await service.stashUntrackedOnly('/repo', 'Untracked only');

            expect(mockExecutor.exec).toHaveBeenLastCalledWith(
                ['stash', 'push', '-u', '-m', 'Untracked only'],
                { cwd: '/repo' }
            );
        });

        test('uses 3-step technique when tracked changes exist', async () => {
            // hasTrackedChanges returns true
            mockExecutor.exec
                .mockResolvedValueOnce({ stdout: ' M tracked.ts\n?? newfile.ts', stderr: '' }) // status
                .mockResolvedValueOnce({ stdout: '', stderr: '' }) // stash tracked
                .mockResolvedValueOnce({ stdout: '', stderr: '' }) // stash all with -u
                .mockResolvedValueOnce({ stdout: '', stderr: '' }); // pop tracked back

            await service.stashUntrackedOnly('/repo', 'Untracked only');

            const calls = mockExecutor.exec.mock.calls;
            expect(calls[1]).toEqual([['stash', 'push', '-m', 'temp-tracked'], { cwd: '/repo' }]);
            expect(calls[2]).toEqual([['stash', 'push', '-u', '-m', 'Untracked only'], { cwd: '/repo' }]);
            expect(calls[3]).toEqual([['stash', 'pop', 'stash@{1}'], { cwd: '/repo' }]);
        });

        test('throws error on failure', async () => {
            mockExecutor.exec
                .mockResolvedValueOnce({ stdout: '', stderr: '' }) // no tracked changes
                .mockRejectedValueOnce(new Error('stash error'));

            await expect(service.stashUntrackedOnly('/repo', 'test'))
                .rejects.toThrow('Failed to stash untracked files');
        });
    });

    describe('getStashFileContent', () => {
        test('gets content from main stash', async () => {
            mockExecutor.exec.mockResolvedValueOnce({ stdout: 'file content here', stderr: '' });

            const content = await service.getStashFileContent('file.ts', 'stash@{0}', '/repo');

            expect(content).toBe('file content here');
            expect(mockExecutor.exec).toHaveBeenCalledWith(
                ['show', 'stash@{0}:file.ts'],
                { cwd: '/repo', maxBuffer: 10 * 1024 * 1024 }
            );
        });

        test('falls back to third parent for untracked files', async () => {
            mockExecutor.exec
                .mockRejectedValueOnce(new Error('path not found')) // main stash
                .mockResolvedValueOnce({ stdout: 'untracked content', stderr: '' }); // third parent

            const content = await service.getStashFileContent('newfile.ts', 'stash@{0}', '/repo');

            expect(content).toBe('untracked content');
            expect(mockExecutor.exec).toHaveBeenLastCalledWith(
                ['show', 'stash@{0}^3:newfile.ts'],
                { cwd: '/repo', maxBuffer: 10 * 1024 * 1024 }
            );
        });

        test('throws error when file not found in either location', async () => {
            mockExecutor.exec
                .mockRejectedValueOnce(new Error('not found'))
                .mockRejectedValueOnce(new Error('not found'));

            await expect(service.getStashFileContent('missing.ts', 'stash@{0}', '/repo'))
                .rejects.toThrow('Failed to get stash file content');
        });
    });

    describe('getStashFileParentContent', () => {
        test('gets content from parent commit', async () => {
            mockExecutor.exec.mockResolvedValueOnce({ stdout: 'parent content', stderr: '' });

            const content = await service.getStashFileParentContent('file.ts', 'stash@{0}', '/repo');

            expect(content).toBe('parent content');
            expect(mockExecutor.exec).toHaveBeenCalledWith(
                ['show', 'stash@{0}^:file.ts'],
                { cwd: '/repo', maxBuffer: 10 * 1024 * 1024 }
            );
        });

        test('returns empty string for new files', async () => {
            mockExecutor.exec.mockRejectedValueOnce(new Error('path not found'));

            const content = await service.getStashFileParentContent('newfile.ts', 'stash@{0}', '/repo');

            expect(content).toBe('');
        });
    });

    describe('stashSpecificFiles', () => {
        test('stashes only specified files', async () => {
            mockExecutor.exec.mockResolvedValueOnce({ stdout: '', stderr: '' });

            await service.stashSpecificFiles('/repo', ['file1.ts', 'file2.ts']);

            expect(mockExecutor.exec).toHaveBeenCalledWith(
                ['stash', 'push', '-m', 'temp-file-stash', '--', 'file1.ts', 'file2.ts'],
                { cwd: '/repo' }
            );
        });

        test('throws error on failure', async () => {
            mockExecutor.exec.mockRejectedValueOnce(new Error('error'));

            await expect(service.stashSpecificFiles('/repo', ['file.ts']))
                .rejects.toThrow('Failed to stash specific files');
        });
    });
});

