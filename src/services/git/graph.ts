import { GitExecutor } from './core';

export class GitGraphService {
    constructor(private executor: GitExecutor) { }

    /**
     * Get commits for graph visualization with parent and ref information
     */
    async getGraphCommits(repoRoot: string, limit: number = 50, skip: number = 0, refs: string[] = []): Promise<any[]> {
        try {
            const args = ['log'];

            if (refs.length > 0) {
                args.push(...refs);
            } else {
                args.push('--all');
            }

            // Get commits with branch/tag decorations
            // Use null byte as delimiter to avoid issues with | in commit messages
            args.push(`--format=%H%x00%h%x00%s%x00%an%x00%ae%x00%ad%x00%P%x00%D%x00`, '--date=short', `--skip=${skip}`, `-n`, limit.toString());

            // Add '--' to separate refs from file paths (fixes ambiguous argument error)
            // This must come AFTER all git options, not before
            if (refs.length > 0) {
                args.push('--');
            }

            const { stdout } = await this.executor.exec(
                args,
                { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 }
            );

            if (!stdout.trim()) {
                return [];
            }

            const commits: any[] = [];
            const rawCommits = stdout.split('\x00\n');

            for (const rawCommit of rawCommits) {
                if (!rawCommit.trim()) {
                    continue;
                }

                const parts = rawCommit.split('\x00');
                // Expected parts: hash, shortHash, message, author, email, date, parents, refs
                if (parts.length >= 8) {
                    const hash = parts[0];
                    const shortHash = parts[1];
                    const message = parts[2];
                    const author = parts[3];
                    const email = parts[4];
                    const date = parts[5];
                    const parents = parts[6] ? parts[6].split(' ') : [];
                    const refs = parts[7] ? parts[7].split(', ') : [];

                    // Skip stash entries (WIP on, index on)
                    if (message.startsWith('WIP on ') || message.startsWith('index on ')) {
                        continue;
                    }

                    const branches = refs.filter(r => {
                        // Include HEAD refs
                        if (r.includes('HEAD')) {
                            return true;
                        }
                        
                        // Exclude tags
                        if (r.startsWith('tag: ')) {
                            return false;
                        }
                        
                        // Include all branches (local and remote)
                        return true;
                    }).map(r => r.replace('HEAD -> ', ''));
                    const tags = refs.filter(r => r.startsWith('tag:')).map(r => r.replace('tag: ', ''));

                    commits.push({
                        hash,
                        shortHash,
                        message,
                        author,
                        email,
                        date,
                        parents,
                        branches,
                        tags,
                        refs
                    });
                }
            }

            return commits;
        } catch (error) {
            console.error('Error getting graph commits:', error);
            return [];
        }
    }
}
