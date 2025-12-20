import * as path from 'path';
import { GitExecutor } from './core';
import { GitStatusService } from './status';
import { GitUtils } from './utils';
import { BlameInfo } from '../../types/git';

export class GitContentService {
    constructor(
        private executor: GitExecutor,
        private statusService: GitStatusService,
    ) { }

    /**
     * Get the content of a file at a specific commit
     */
    async getFileContentAtCommit(relativePath: string, commitHash: string, repoRoot: string): Promise<string> {
        try {
            const { stdout } = await this.executor.exec(
                ['show', `${commitHash}:${relativePath}`],
                { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 },
            );
            return stdout;
        } catch (error) {
            throw new Error(`Failed to get file content at commit ${commitHash}: ${error}`);
        }
    }

    /**
     * Get blame information for a specific line
     */
    async getBlameForLine(filePath: string, lineNumber: number, commitHash?: string): Promise<BlameInfo | null> {
        try {
            // Handle git scheme URIs (from diff view)
            let actualFilePath = filePath;
            let blameCommitHash = commitHash;

            if (filePath.startsWith('git:')) {
                // Parse git URI to get real file path and commit
                // Format: git:/path/to/file?{"path":"/path/to/file","ref":"commit-hash"}
                try {
                    const uri = require('vscode').Uri.parse(filePath);
                    if (uri.query) {
                        const query = JSON.parse(uri.query);
                        actualFilePath = query.path;
                        // If we're looking at an older version, blame that version
                        if (query.ref && query.ref !== '' && query.ref !== '~') {
                            blameCommitHash = query.ref;
                        }
                    } else {
                        actualFilePath = uri.fsPath;
                    }
                } catch (e) {
                    // Fallback to fsPath if parsing fails
                    actualFilePath = filePath;
                }
            } else if (filePath.startsWith('gitmaster-diff:')) {
                // Handle gitmaster-diff scheme
                try {
                    const uri = require('vscode').Uri.parse(filePath);
                    actualFilePath = uri.fsPath;

                    // Extract commit hash from query
                    if (uri.query) {
                        // Handle potentially encoded query
                        const rawQuery = uri.query;
                        // Try plain base64 first
                        let decoded = '';
                        try {
                            decoded = Buffer.from(rawQuery, 'base64').toString('utf-8');
                        } catch {
                            decoded = '';
                        }

                        // If that failed or didn't look like JSON, try decoding URI component first
                        if (!decoded || !decoded.startsWith('{')) {
                            try {
                                const unencoded = decodeURIComponent(rawQuery);
                                decoded = Buffer.from(unencoded, 'base64').toString('utf-8');
                            } catch {
                                // Keep previous decoded
                            }
                        }

                        try {
                            const data = JSON.parse(decoded);
                            if (data?.commit) {
                                blameCommitHash = data.commit;
                            }
                        } catch {
                            // Not JSON, assume legacy
                        }
                    }
                } catch (e) {
                    // Fallback
                }
            } else if (filePath.startsWith('file:')) {
                // Handle file: scheme URIs properly
                try {
                    const uri = require('vscode').Uri.parse(filePath);
                    actualFilePath = uri.fsPath;
                } catch (e) {
                    // Fallback if parsing fails
                }
            }

            const repoRoot = await this.statusService.getRepoRoot(actualFilePath);
            if (!repoRoot) {
                return null;
            }

            // Get relative path for git command
            const relativePath = path.relative(repoRoot, actualFilePath);

            // git blame --porcelain -L 12,12 [hash] -- file.ts
            // lineNumber is 1-based
            const args = ['blame', '--porcelain', '-L', `${lineNumber},${lineNumber}`];
            if (blameCommitHash) {
                args.push(blameCommitHash);
            }
            args.push('--', relativePath);

            const { stdout } = await this.executor.exec(args, { cwd: repoRoot });

            if (!stdout.trim()) {
                return null;
            }

            // Parse porcelain output
            const lines = stdout.trim().split('\n');
            const hashLine = lines[0]; // first line contains hash
            const hashParts = hashLine.split(' ');
            const hash = hashParts[0];
            const shortHash = hash.substring(0, 7);

            let author = '';
            let authorEmail = '';
            let authorTimeStr = '';
            let message = '';
            let filename = '';

            for (const line of lines) {
                if (line.startsWith('author ')) {
                    author = line.substring(7).trim();
                } else if (line.startsWith('author-mail ')) {
                    authorEmail = line.substring(12).trim().replace(/[<>]/g, '');
                } else if (line.startsWith('author-time ')) {
                    authorTimeStr = line.substring(12).trim();
                } else if (line.startsWith('summary ')) {
                    message = line.substring(8).trim();
                } else if (line.startsWith('filename ')) {
                    filename = line.substring(9).trim();
                }
            }

            // Format date
            const date = new Date(parseInt(authorTimeStr) * 1000);
            const relativeDate = GitUtils.getRelativeDate(date);
            const formattedDate = date.toLocaleDateString();

            return {
                hash,
                shortHash,
                author,
                authorEmail,
                date: formattedDate,
                relativeDate,
                message,
                filename,
            };
        } catch (error) {
            // Ignore errors (e.g. line out of range, file not tracked)
            return null;
        }
    }
}
