import { exec, execFile } from 'child_process';
import { promisify } from 'util';

export const execAsync = promisify(exec);
export const execFileAsync = promisify(execFile);

export async function gitExec(args: string[], options: any = {}): Promise<{ stdout: string, stderr: string }> {
    return new Promise((resolve, reject) => {
        execFile('git', args, options, (error, stdout, stderr) => {
            if (error) {
                reject(error);
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
            exec(command, options, (error, stdout, stderr) => {
                if (error) {
                    reject(error);
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

