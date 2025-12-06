import { GitExecutor } from './core';
import { GitBranchService } from './branch';
import { RebaseCommit } from '../../types/git';

export class GitRebaseService {
    constructor(
        private executor: GitExecutor,
        private branchService: GitBranchService
    ) {}

    /**
     * Get commits ahead of base branch
     */
    async getCommitsAheadOfBase(repoRoot: string, baseBranch: string, currentBranch?: string): Promise<RebaseCommit[]> {
        try {
            const branch = currentBranch || await this.branchService.getCurrentBranch(repoRoot);
            if (!branch) {
                throw new Error('Not on a branch');
            }

            // Get the merge base
            const mergeBase = await this.branchService.getMergeBase(repoRoot, baseBranch, branch);
            if (!mergeBase) {
                throw new Error(`Could not find common ancestor between ${branch} and ${baseBranch}`);
            }

            // Get commits from merge base to current branch
            const format = '%H|%h|%an|%ar|%s';
            const { stdout } = await this.executor.exec(
                ['log', `--format=${format}`, `${mergeBase}..${branch}`],
                { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 }
            );

            if (!stdout.trim()) {
                return [];
            }

            const lines = stdout.trim().split('\n');
            const commits: RebaseCommit[] = [];

            // Process in reverse order (oldest first for rebase)
            for (let i = lines.length - 1; i >= 0; i--) {
                const line = lines[i];
                const [hash, shortHash, author, date, ...messageParts] = line.split('|');
                const message = messageParts.join('|');

                // Get file count and stats for this commit
                try {
                    const { stdout: statOutput } = await this.executor.exec(
                        ['show', '--stat', '--format=', hash],
                        { cwd: repoRoot }
                    );
                    const statLines = statOutput.trim().split('\n');
                    const fileCount = statLines.filter(l => l.includes('|')).length;

                    // Parse additions and deletions from summary line
                    const summaryLine = statLines[statLines.length - 1];
                    const addMatch = summaryLine.match(/(\d+) insertion/);
                    const delMatch = summaryLine.match(/(\d+) deletion/);
                    const additions = addMatch ? parseInt(addMatch[1]) : 0;
                    const deletions = delMatch ? parseInt(delMatch[1]) : 0;

                    commits.push({
                        hash,
                        shortHash,
                        author,
                        date,
                        message,
                        action: 'pick',
                        fileCount,
                        additions,
                        deletions
                    });
                } catch {
                    commits.push({
                        hash,
                        shortHash,
                        author,
                        date,
                        message,
                        action: 'pick'
                    });
                }
            }

            return commits;
        } catch (error) {
            throw new Error(`Failed to get commits ahead of base: ${error}`);
        }
    }

    /**
     * Start interactive rebase
     */
    async startInteractiveRebase(repoRoot: string, baseBranch: string, commits: RebaseCommit[]): Promise<void> {
        try {
            if (commits.length === 0) {
                throw new Error('No commits to rebase');
            }

            const fs = await import('fs');
            const path = await import('path');
            const os = await import('os');

            // Build the rebase todo list
            const todoLines = commits.map(commit => {
                return `${commit.action} ${commit.hash} ${commit.message}`;
            });
            const todoContent = todoLines.join('\n') + '\n';

            // Create a map of commit hashes to new messages for reword actions
            const rewordMessages = new Map<string, string>();
            commits.forEach(commit => {
                if (commit.action === 'reword') {
                    rewordMessages.set(commit.hash, commit.message);
                }
            });

            // Create temporary editor script if there are reword actions
            let editorScript: string | undefined;
            if (rewordMessages.size > 0) {
                const tmpDir = os.tmpdir();
                editorScript = path.join(tmpDir, `gitmaster-editor-${Date.now()}.sh`);

                // Build the editor script that will use the new commit messages
                const scriptContent = `#!/bin/sh
COMMIT_MSG_FILE="$1"
COMMIT_HASH=$(git rev-parse HEAD 2>/dev/null || echo "")

# Map of commit hashes to new messages
${Array.from(rewordMessages.entries()).map(([hash, msg]) =>
                    `if [ "$COMMIT_HASH" = "${hash}" ]; then
    echo "${msg.replace(/"/g, '\\"').replace(/\n/g, '\\n')}" > "$COMMIT_MSG_FILE"
    exit 0
fi`
                ).join('\n')}

# If no match found, keep original message (shouldn't happen)
exit 0
`;

                fs.writeFileSync(editorScript, scriptContent, { mode: 0o755 });
            }

            // Get the oldest commit's parent (the base)
            const oldestCommit = commits[0];
            const { stdout: parentHash } = await this.executor.exec(
                ['rev-parse', `${oldestCommit.hash}^`],
                { cwd: repoRoot }
            );
            const base = parentHash.trim();

            // Start the interactive rebase
            try {
                await this.executor.exec(
                    ['rebase', '-i', base],
                    {
                        cwd: repoRoot,
                        env: {
                            ...process.env,
                            GIT_SEQUENCE_EDITOR: `sh -c 'echo "${todoContent.replace(/"/g, '\\"')}" > "$1"' --`,
                            GIT_EDITOR: editorScript || 'true',
                            EDITOR: editorScript || 'true'
                        }
                    }
                );
            } finally {
                // Clean up the temporary editor script
                if (editorScript && fs.existsSync(editorScript)) {
                    try {
                        fs.unlinkSync(editorScript);
                    } catch (err) {
                        console.error('Failed to delete temporary editor script:', err);
                    }
                }
            }
        } catch (error) {
            throw new Error(`Failed to start interactive rebase: ${error}`);
        }
    }

    /**
     * Continue rebase after resolving conflicts
     */
    async continueRebase(repoRoot: string): Promise<void> {
        try {
            await this.executor.exec(['rebase', '--continue'], {
                cwd: repoRoot,
                maxBuffer: 10 * 1024 * 1024,
                env: {
                    ...process.env,
                    GIT_EDITOR: 'true',
                    EDITOR: 'true'
                }
            });
        } catch (error) {
            throw new Error(`Failed to continue rebase: ${error}`);
        }
    }

    /**
     * Abort rebase operation
     */
    async abortRebase(repoRoot: string): Promise<void> {
        try {
            await this.executor.exec(['rebase', '--abort'], {
                cwd: repoRoot
            });
        } catch (error) {
            throw new Error(`Failed to abort rebase: ${error}`);
        }
    }

    /**
     * Check if rebase is in progress
     */
    async isRebaseInProgress(repoRoot: string): Promise<boolean> {
        try {
            const fs = await import('fs');
            const path = await import('path');
            const rebaseMergeDir = path.join(repoRoot, '.git', 'rebase-merge');
            const rebaseApplyDir = path.join(repoRoot, '.git', 'rebase-apply');

            return fs.existsSync(rebaseMergeDir) || fs.existsSync(rebaseApplyDir);
        } catch (error) {
            return false;
        }
    }

    /**
     * Get rebase conflict files
     */
    async getRebaseConflicts(repoRoot: string): Promise<string[]> {
        try {
            const { stdout } = await this.executor.exec(['diff', '--name-only', '--diff-filter=U'], {
                cwd: repoRoot
            });

            if (!stdout.trim()) {
                return [];
            }

            return stdout.trim().split('\n');
        } catch (error) {
            console.error('Error getting rebase conflicts:', error);
            return [];
        }
    }
}
