import { exec, execFile } from 'child_process';
import { promisify } from 'util';

export const execAsync = promisify(exec);
export const execFileAsync = promisify(execFile);

export async function gitExec(args: string[], options: any = {}): Promise<{ stdout: string, stderr: string }> {
    return new Promise((resolve, reject) => {
        // Default timeout of 60s to prevent hangs, unless overridden
        const finalOptions = { timeout: 60000, maxBuffer: 10 * 1024 * 1024, ...options };
        execFile('git', args, finalOptions, (error, stdout, stderr) => {
            if (error) {
                // Enhance error message for timeouts
                if (error.killed && error.signal === 'SIGTERM') {
                    reject(new Error(`Git command timed out after ${finalOptions.timeout}ms: git ${args.join(' ')}`));
                } else {
                    reject(error);
                }
            } else {
                resolve({
                    stdout: typeof stdout === 'string' ? stdout : stdout.toString(),
                    stderr: typeof stderr === 'string' ? stderr : stderr.toString()
                });
            }
        });
    });
}

export class GitExecutor {
    async exec(args: string[], options: any = {}): Promise<{ stdout: string, stderr: string }> {
        return gitExec(args, options);
    }

    async execShell(command: string, options: any = {}): Promise<{ stdout: string, stderr: string }> {
        return new Promise((resolve, reject) => {
            const finalOptions = { timeout: 60000, maxBuffer: 10 * 1024 * 1024, ...options };
            exec(command, finalOptions, (error, stdout, stderr) => {
                if (error) {
                    if (error.killed && error.signal === 'SIGTERM') {
                        reject(new Error(`Git command timed out after ${finalOptions.timeout}ms: ${command}`));
                    } else {
                        reject(error);
                    }
                } else {
                    resolve({
                        stdout: typeof stdout === 'string' ? stdout : stdout.toString(),
                        stderr: typeof stderr === 'string' ? stderr : stderr.toString()
                    });
                }
            });
        });
    }
}

