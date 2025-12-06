import * as path from 'path';
import { GitExecutor } from './core';

export class GitSystemService {
    constructor(private executor: GitExecutor) { }

    /**
     * Try to set up Git if not found in PATH (Windows fallback)
     */
    async setupWindowsGit(): Promise<void> {
        if (process.platform !== 'win32') {
            return;
        }

        try {
            await this.executor.exec(['--version']);
            // Working fine
        } catch (e) {
            // Git not found, try fallback
            const fs = await import('fs');
            const possiblePaths = [
                'C:\\Program Files\\Git\\cmd',
                'C:\\Program Files (x86)\\Git\\cmd',
                process.env['ProgramW6432'] ? path.join(process.env['ProgramW6432'], 'Git', 'cmd') : '',
                process.env['ProgramFiles'] ? path.join(process.env['ProgramFiles'], 'Git', 'cmd') : ''
            ].filter(p => p); // Filter empty

            for (const p of possiblePaths) {
                try {
                    const gitPath = path.join(p, 'git.exe');
                    if (fs.existsSync(gitPath)) {
                        // Update PATH for this process
                        process.env.PATH = `${p}${path.delimiter}${process.env.PATH}`;
                        break;
                    }
                } catch {
                    // Ignore access errors
                }
            }
        }
    }

    /**
     * Check if git is installed and accessible
     */
    async getGitVersion(): Promise<string> {
        try {
            const { stdout } = await this.executor.exec(['--version']);
            return stdout.trim();
        } catch (error) {
            throw new Error('Git not found');
        }
    }
}
