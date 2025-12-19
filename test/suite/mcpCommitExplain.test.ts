import { handleGitMasterMcpToolCall } from '../../src/mcp/tools';

describe('GitMaster MCP commit explain tool', () => {
    test('returns commit metadata, changed files, totals, and opens commit details when available', async () => {
        const gitServiceMock: any = {
            getRepoRoot: async (p: string) => p,
            getCommitInfo: async (commitId: string) => ({
                hash: commitId.length === 40 ? commitId : 'a'.repeat(40),
                shortHash: 'aaaaaaa',
                message: 'feat: test',
                author: 'Test Author',
                date: '2025-01-01'
            }),
            getChangedFilesInCommit: async () => [
                { path: 'a.txt', status: 'M', additions: 3, deletions: 1 },
                { path: 'b.txt', status: 'A', additions: 10, deletions: 0 }
            ]
        };

        let opened = false;
        const result = await handleGitMasterMcpToolCall(
            'gitmaster_commit_explain',
            { repoPath: process.cwd(), commitId: 'abc123', maxFiles: 1 },
            {
                gitService: gitServiceMock,
                openCommitDetails: async () => {
                    opened = true;
                }
            }
        );

        const payload = JSON.parse(result.content[0].text);
        expect(opened).toBe(true);
        expect(payload.commit.hash).toBeTruthy();
        expect(payload.commit.message).toBe('feat: test');
        expect(payload.files).toHaveLength(1); // maxFiles applied
        expect(payload.totals.fileCount).toBe(1);
        expect(typeof payload.agentInstruction).toBe('string');
        expect(payload.agentInstruction.length).toBeGreaterThan(10);
    });
});




