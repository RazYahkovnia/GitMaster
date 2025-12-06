import { GitExecutor } from './core';
import { GitStatusService } from './status';
import { CommitInfo, RepositoryCommit, ReflogEntry } from '../../types/git';
import { GitUtils } from './utils';

export class GitLogService {
    constructor(
        private executor: GitExecutor,
        private statusService: GitStatusService
    ) { }

    /**
     * Get the commit history for a specific file
     */
    async getFileHistory(filePath: string, messageFilter?: string): Promise<CommitInfo[]> {
        try {
            const repoRoot = await this.statusService.getRepoRoot(filePath);
            if (!repoRoot) {
                return [];
            }

            const format = '%H|%h|%an|%ai|%ar|%s';
            const args = ['log', '--follow', `--format=${format}`];

            if (messageFilter) {
                args.push(`--grep=${messageFilter}`, '-i');
            }

            args.push('--', filePath);

            const { stdout } = await this.executor.exec(
                args,
                { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 }
            );

            if (!stdout.trim()) {
                return [];
            }

            return GitUtils.parseCommitLog(stdout);
        } catch (error) {
            console.error('Error getting file history:', error);
            return [];
        }
    }

    /**
     * Get repository commit log (all commits, not file-specific)
     */
    async getRepositoryLog(repoRoot: string, limit: number = 20, messageFilter?: string): Promise<RepositoryCommit[]> {
        try {
            const format = '%H|%h|%an|%ad|%s|%P';
            const args = ['log', `--format=${format}`, '--date=short', '-n', limit.toString()];

            if (messageFilter) {
                args.push(`--grep=${messageFilter}`, '-i');
            }

            const { stdout } = await this.executor.exec(
                args,
                { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 }
            );

            if (!stdout.trim()) {
                return [];
            }

            const commits: RepositoryCommit[] = [];
            const lines = stdout.trim().split('\n');

            for (const line of lines) {
                const parts = line.split('|');
                if (parts.length >= 5) {
                    const [hash, shortHash, author, date, ...messageParts] = parts;
                    // The rest after the 5th element is the parent hashes
                    const message = messageParts.slice(0, -1).join('|'); // Message is everything except last part
                    const parentHashesStr = messageParts[messageParts.length - 1] || '';
                    const parentHashes = parentHashesStr.trim() ? parentHashesStr.split(' ') : [];

                    commits.push({
                        hash,
                        shortHash,
                        author,
                        date,
                        message,
                        parentHashes
                    });
                }
            }

            return commits;
        } catch (error) {
            console.error('Error getting repository log:', error);
            return [];
        }
    }

    /**
     * Get reflog entries (git operations history)
     */
    async getReflog(repoRoot: string, limit: number = 50): Promise<ReflogEntry[]> {
        try {
            // Format: hash|shortHash|selector|message|timestamp|relativeTime
            const { stdout } = await this.executor.exec(
                ['reflog', '--format=%H|%h|%gd|%gs|%ci|%cr', '-n', limit.toString()],
                { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 }
            );

            if (!stdout.trim()) {
                return [];
            }

            const entries: ReflogEntry[] = [];
            const lines = stdout.trim().split('\n');

            for (const line of lines) {
                const parts = line.split('|');
                if (parts.length >= 6) {
                    const hash: string = parts[0];
                    const shortHash: string = parts[1];
                    const selector: string = parts[2];
                    const message: string = parts[3];
                    const timestamp: string = parts[4];
                    const relativeTime: string = parts.slice(5).join('|'); // In case relative time contains |

                    // Extract action from message (e.g., "commit", "checkout", "pull")
                    const actionMatch = message.match(/^(\w+):/);
                    const action: string = actionMatch ? actionMatch[1] : 'other';

                    const entry: ReflogEntry = {
                        hash,
                        shortHash,
                        selector,
                        action,
                        message,
                        timestamp,
                        relativeTime
                    };

                    entries.push(entry);
                }
            }

            return entries;
        } catch (error) {
            console.error('Error getting reflog:', error);
            return [];
        }
    }
}
