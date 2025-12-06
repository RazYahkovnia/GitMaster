import * as path from 'path';
import { GitExecutor } from './core';
import { GitStatusService } from './status';

export class GitContributorsService {
    constructor(
        private executor: GitExecutor,
        private statusService: GitStatusService
    ) {}

    /**
     * Get top contributors for a file based on line changes
     */
    async getFileContributors(filePath: string, limit: number = 3): Promise<{ author: string; lineChanges: number; commitCount: number }[]> {
        try {
            const repoRoot = await this.statusService.getRepoRoot(filePath);
            if (!repoRoot) {
                return [];
            }

            // Get file history with numstat to count line changes
            const { stdout } = await this.executor.exec(
                ['log', '--follow', '--numstat', '--format=%an%x00', '--', path.basename(filePath)],
                { cwd: path.dirname(filePath), maxBuffer: 10 * 1024 * 1024 }
            );

            if (!stdout.trim()) {
                return [];
            }

            // Parse the output to calculate line changes per author
            const contributorStats = new Map<string, { lineChanges: number; commitCount: number }>();
            const lines = stdout.split('\n');
            let currentAuthor = '';

            for (const line of lines) {
                if (line.includes('\x00')) {
                    // Author line
                    currentAuthor = line.replace('\x00', '').trim();
                    if (!contributorStats.has(currentAuthor)) {
                        contributorStats.set(currentAuthor, { lineChanges: 0, commitCount: 0 });
                    }
                    const stats = contributorStats.get(currentAuthor)!;
                    stats.commitCount++;
                } else if (line.trim() && currentAuthor) {
                    // Numstat line: additions deletions filename
                    const parts = line.trim().split(/\s+/);
                    if (parts.length >= 2) {
                        const additions = parseInt(parts[0]) || 0;
                        const deletions = parseInt(parts[1]) || 0;
                        const stats = contributorStats.get(currentAuthor)!;
                        stats.lineChanges += additions + deletions;
                    }
                }
            }

            // Sort by line changes and return top contributors
            return Array.from(contributorStats.entries())
                .map(([author, stats]) => ({ author, ...stats }))
                .sort((a, b) => b.lineChanges - a.lineChanges)
                .slice(0, limit);
        } catch (error) {
            console.error('Error getting file contributors:', error);
            return [];
        }
    }
}
