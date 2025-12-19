import * as fs from 'fs';
import * as path from 'path';

export class RepoResolverError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'RepoResolverError';
    }
}

export function resolveRepoRoot(repoPath?: string): string {
    const candidate = repoPath?.trim() ? repoPath.trim() : process.cwd();
    const resolved = path.resolve(candidate);

    let stat: fs.Stats;
    try {
        stat = fs.statSync(resolved);
    } catch {
        throw new RepoResolverError(`repoPath does not exist: ${resolved}`);
    }

    if (!stat.isDirectory()) {
        throw new RepoResolverError(`repoPath is not a directory: ${resolved}`);
    }

    const gitDir = path.join(resolved, '.git');
    try {
        const gitStat = fs.statSync(gitDir);
        if (!gitStat.isDirectory()) {
            throw new RepoResolverError(`repoPath is not a git repo (no .git directory): ${resolved}`);
        }
    } catch {
        throw new RepoResolverError(`repoPath is not a git repo (no .git directory): ${resolved}`);
    }

    return resolved;
}



