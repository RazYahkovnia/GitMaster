import { GitService } from '../../services/gitService';
import { resolveRepoRoot } from '../repoResolver';

export type ShelvesListInput = {
    repoPath?: string;
    maxShelves?: number;
    maxFilesPerShelf?: number;
};

export type ShelfFile = {
    path: string;
    status: string;
    additions: number;
    deletions: number;
};

export type Shelf = {
    index: string;
    name: string;
    branch: string;
    fileCount: number;
    files: ShelfFile[];
};

export async function listShelves(
    input: ShelvesListInput,
    deps?: { gitService?: GitService }
): Promise<Shelf[]> {
    const repoRoot = resolveRepoRoot(input.repoPath);
    const gitService = deps?.gitService ?? new GitService();

    const maxShelves = clamp(input.maxShelves ?? 50, 1, 200);
    const maxFilesPerShelf = clamp(input.maxFilesPerShelf ?? 500, 1, 5000);

    const stashes = await gitService.getStashes(repoRoot);
    const limitedStashes = stashes.slice(0, maxShelves);

    const shelves: Shelf[] = [];
    for (const stash of limitedStashes) {
        const files = await gitService.getStashFiles(stash.index, repoRoot);
        shelves.push({
            index: stash.index,
            name: stash.message, // Matches Shelves view label
            branch: stash.branch,
            fileCount: stash.fileCount,
            files: files.slice(0, maxFilesPerShelf).map(f => ({
                path: f.path,
                status: f.status,
                additions: f.additions,
                deletions: f.deletions
            }))
        });
    }

    return shelves;
}

function clamp(n: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, n));
}


