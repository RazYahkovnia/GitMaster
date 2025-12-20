import { CommitInfo } from '../../types/git';

export class GitUtils {
    /**
     * Parse commit log output into CommitInfo objects
     */
    static parseCommitLog(stdout: string): CommitInfo[] {
        const commits: CommitInfo[] = [];
        const lines = stdout.trim().split('\n');

        for (const line of lines) {
            const parts = line.split('|');
            if (parts.length >= 6) {
                commits.push({
                    hash: parts[0],
                    shortHash: parts[1],
                    author: parts[2],
                    date: parts[3],
                    relativeDate: parts[4],
                    message: parts.slice(5).join('|'), // In case message contains |
                });
            }
        }

        return commits;
    }

    static getRelativeDate(date: Date): string {
        const now = new Date();
        const diff = now.getTime() - date.getTime();

        const seconds = Math.floor(diff / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);
        const months = Math.floor(days / 30);
        const years = Math.floor(days / 365);

        if (years > 0) { return `${years} year${years > 1 ? 's' : ''} ago`; }
        if (months > 0) { return `${months} month${months > 1 ? 's' : ''} ago`; }
        if (days > 0) { return `${days} day${days > 1 ? 's' : ''} ago`; }
        if (hours > 0) { return `${hours} hour${hours > 1 ? 's' : ''} ago`; }
        if (minutes > 0) { return `${minutes} min${minutes > 1 ? 's' : ''} ago`; }
        return 'Just now';
    }

    /**
     * Parse renamed file paths from git output
     * Handles formats like "oldfile => newfile" or "path/{old => new}/file"
     */
    static parseRenamedPath(filePath: string): { path: string; oldPath?: string } {
        if (!filePath.includes(' => ')) {
            return { path: filePath };
        }

        // Check for brace pattern: "path/{old => new}/file"
        const braceMatch = filePath.match(/^(.+)\{(.+)\s*=>\s*(.+)\}(.+)$/);
        if (braceMatch) {
            const prefix = braceMatch[1];
            const oldPart = braceMatch[2];
            const newPart = braceMatch[3];
            const suffix = braceMatch[4];

            return {
                path: (prefix + newPart + suffix).trim(),
                oldPath: (prefix + oldPart + suffix).trim(),
            };
        }

        // Simple rename: "oldfile => newfile"
        const parts = filePath.split(' => ');
        if (parts.length === 2) {
            return {
                path: parts[1].trim(),
                oldPath: parts[0].trim(),
            };
        }

        return { path: filePath };
    }
}
