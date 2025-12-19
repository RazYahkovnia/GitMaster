import { listShelves } from '../../src/mcp/tools/shelves';

describe('GitMaster MCP shelves tool', () => {
    test('returns stash name and files with stats', async () => {
        const gitServiceMock: any = {
            getStashes: async () => [
                { index: 'stash@{0}', branch: 'main', message: 'WIP: test', fileCount: 2 }
            ],
            getStashFiles: async () => [
                { path: 'a.txt', status: 'M', additions: 3, deletions: 1 },
                { path: 'b.txt', status: 'A', additions: 10, deletions: 0 }
            ]
        };

        // Use the repo root of this repository so resolveRepoRoot succeeds in tests.
        const shelves = await listShelves({ repoPath: process.cwd() }, { gitService: gitServiceMock });

        expect(shelves).toEqual([
            {
                index: 'stash@{0}',
                name: 'WIP: test',
                branch: 'main',
                fileCount: 2,
                files: [
                    { path: 'a.txt', status: 'M', additions: 3, deletions: 1 },
                    { path: 'b.txt', status: 'A', additions: 10, deletions: 0 }
                ]
            }
        ]);
    });

    test('applies max limits', async () => {
        const gitServiceMock: any = {
            getStashes: async () => Array.from({ length: 3 }).map((_, i) => ({
                index: `stash@{${i}}`,
                branch: 'main',
                message: `stash ${i}`,
                fileCount: 100
            })),
            getStashFiles: async () => Array.from({ length: 10 }).map((_, i) => ({
                path: `f${i}.txt`,
                status: 'M',
                additions: i,
                deletions: 0
            }))
        };

        const shelves = await listShelves(
            { repoPath: process.cwd(), maxShelves: 1, maxFilesPerShelf: 2 },
            { gitService: gitServiceMock }
        );

        expect(shelves).toHaveLength(1);
        expect(shelves[0].files).toHaveLength(2);
    });
});



