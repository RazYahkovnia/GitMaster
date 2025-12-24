/**
 * MCP Command Router - enables cross-window UI commands.
 *
 * Problem: MCP server runs in one window, but UI commands need to execute
 * in the window that owns the target workspace.
 *
 * Solution: File-based IPC
 * 1. MCP server writes command files to a shared directory
 * 2. Each window watches for commands targeting its workspace
 * 3. When a command file appears, the owning window executes it
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// ============================================================================
// Types
// ============================================================================

/** A routed UI command */
export interface RoutedCommand {
    /** Unique command ID */
    id: string;
    /** Command type */
    type: 'openCommitDetails' | 'openGitGraph' | 'openShelvesView' | 'openFileHistory';
    /** Target repository root path */
    repoRoot: string;
    /** Command-specific payload */
    payload: Record<string, unknown>;
    /** Timestamp when command was created */
    timestamp: number;
}

/** Callback to execute a command */
export type CommandExecutor = (command: RoutedCommand) => Promise<void>;

// ============================================================================
// Constants
// ============================================================================

/** Directory name for command files */
const COMMANDS_DIR_NAME = 'mcp-commands';

/** How often to check for stale commands (ms) */
const STALE_CHECK_INTERVAL = 60_000;

/** Commands older than this are considered stale (ms) */
const STALE_THRESHOLD = 30_000;

// ============================================================================
// Command Router
// ============================================================================

/**
 * Routes MCP UI commands to the correct VS Code window.
 */
export class McpCommandRouter implements vscode.Disposable {
    private commandsDir: string;
    private watcher: vscode.FileSystemWatcher | undefined;
    private executor: CommandExecutor | undefined;
    private myWorkspaceHashes: Set<string> = new Set();
    private staleCheckInterval: NodeJS.Timeout | undefined;
    private disposed = false;

    constructor() {
        // Use VS Code's global storage path for cross-window communication
        this.commandsDir = this.getCommandsDirectory();
        this.ensureDirectoryExists();
    }

    /**
     * Get the shared commands directory path.
     */
    private getCommandsDirectory(): string {
        // Use a directory in the user's home folder for cross-window access
        const homeDir = process.env.HOME || process.env.USERPROFILE || '/tmp';
        return path.join(homeDir, '.gitmaster', COMMANDS_DIR_NAME);
    }

    /**
     * Ensure the commands directory exists.
     */
    private ensureDirectoryExists(): void {
        try {
            fs.mkdirSync(this.commandsDir, { recursive: true });
        } catch (err) {
            console.error('Failed to create commands directory:', err);
        }
    }

    /**
     * Start watching for commands targeting the given workspaces.
     * Call this when the extension activates.
     *
     * @param workspaceRoots - Array of workspace root paths this window owns
     * @param executor - Callback to execute received commands
     */
    startWatching(workspaceRoots: string[], executor: CommandExecutor): void {
        this.executor = executor;

        // Compute hashes for our workspaces
        this.myWorkspaceHashes.clear();
        for (const root of workspaceRoots) {
            const hash = this.hashWorkspace(root);
            this.myWorkspaceHashes.add(hash);
        }

        // Watch the commands directory
        const pattern = new vscode.RelativePattern(this.commandsDir, '*.json');
        this.watcher = vscode.workspace.createFileSystemWatcher(pattern);

        this.watcher.onDidCreate(uri => this.handleCommandFile(uri.fsPath));
        this.watcher.onDidChange(uri => this.handleCommandFile(uri.fsPath));

        // Check for any existing commands (in case we started after they were written)
        this.checkExistingCommands();

        // Periodically clean up stale commands
        this.staleCheckInterval = setInterval(() => {
            this.cleanupStaleCommands();
        }, STALE_CHECK_INTERVAL);
    }

    /**
     * Update the workspaces this window is watching.
     * Call this when workspaces change.
     */
    updateWorkspaces(workspaceRoots: string[]): void {
        this.myWorkspaceHashes.clear();
        for (const root of workspaceRoots) {
            const hash = this.hashWorkspace(root);
            this.myWorkspaceHashes.add(hash);
        }
        // Check for any pending commands for the new workspaces
        this.checkExistingCommands();
    }

    /**
     * Route a command to the appropriate window.
     * If the target workspace is in this window, execute immediately.
     * Otherwise, write a command file for the owning window to pick up.
     *
     * @param command - The command to route
     * @returns true if executed locally, false if routed to another window
     */
    async routeCommand(command: RoutedCommand): Promise<boolean> {
        const targetHash = this.hashWorkspace(command.repoRoot);

        // Check if this window owns the target workspace
        if (this.myWorkspaceHashes.has(targetHash) && this.executor) {
            // Execute locally
            await this.executor(command);
            return true;
        }

        // Route to another window via file
        await this.writeCommandFile(command);
        return false;
    }

    /**
     * Write a command file for another window to pick up.
     */
    private async writeCommandFile(command: RoutedCommand): Promise<void> {
        const hash = this.hashWorkspace(command.repoRoot);
        const filename = `${hash}-${command.id}.json`;
        const filepath = path.join(this.commandsDir, filename);

        try {
            const content = JSON.stringify(command, null, 2);
            await fs.promises.writeFile(filepath, content, 'utf-8');
        } catch (err) {
            console.error('Failed to write command file:', err);
        }
    }

    /**
     * Handle a command file (check if it's for us and execute).
     */
    private async handleCommandFile(filepath: string): Promise<void> {
        if (this.disposed) {
            return;
        }

        const filename = path.basename(filepath);
        // Filename format: {workspace-hash}-{command-id}.json
        const hash = filename.split('-')[0];

        // Check if this command is for one of our workspaces
        if (!this.myWorkspaceHashes.has(hash)) {
            return; // Not for us
        }

        try {
            const content = await fs.promises.readFile(filepath, 'utf-8');
            const command: RoutedCommand = JSON.parse(content);

            // Verify the command is valid and not too old
            if (Date.now() - command.timestamp > STALE_THRESHOLD) {
                // Command is stale, delete it
                await this.deleteCommandFile(filepath);
                return;
            }

            // Execute the command
            if (this.executor) {
                await this.executor(command);
            }

            // Delete the command file after execution
            await this.deleteCommandFile(filepath);
        } catch (err) {
            // File might have been deleted by another instance, or invalid JSON
            // Just ignore and continue
        }
    }

    /**
     * Check for existing command files on startup.
     */
    private checkExistingCommands(): void {
        try {
            const files = fs.readdirSync(this.commandsDir);
            for (const file of files) {
                if (file.endsWith('.json')) {
                    const filepath = path.join(this.commandsDir, file);
                    this.handleCommandFile(filepath);
                }
            }
        } catch (err) {
            // Directory might not exist yet
        }
    }

    /**
     * Clean up stale command files.
     */
    private cleanupStaleCommands(): void {
        try {
            const files = fs.readdirSync(this.commandsDir);
            const now = Date.now();

            for (const file of files) {
                if (!file.endsWith('.json')) {
                    continue;
                }

                const filepath = path.join(this.commandsDir, file);
                try {
                    const content = fs.readFileSync(filepath, 'utf-8');
                    const command: RoutedCommand = JSON.parse(content);

                    if (now - command.timestamp > STALE_THRESHOLD) {
                        this.deleteCommandFile(filepath);
                    }
                } catch {
                    // Invalid file, delete it
                    this.deleteCommandFile(filepath);
                }
            }
        } catch {
            // Ignore errors during cleanup
        }
    }

    /**
     * Delete a command file.
     */
    private async deleteCommandFile(filepath: string): Promise<void> {
        try {
            await fs.promises.unlink(filepath);
        } catch {
            // File might already be deleted
        }
    }

    /**
     * Create a hash of a workspace path for file naming.
     */
    private hashWorkspace(workspacePath: string): string {
        // Normalize the path for consistent hashing
        const normalized = path.normalize(workspacePath).toLowerCase();
        return crypto.createHash('md5').update(normalized).digest('hex').substring(0, 12);
    }

    /**
     * Generate a unique command ID.
     */
    static generateCommandId(): string {
        return crypto.randomUUID();
    }

    /**
     * Dispose of the router and stop watching.
     */
    dispose(): void {
        this.disposed = true;
        this.watcher?.dispose();
        if (this.staleCheckInterval) {
            clearInterval(this.staleCheckInterval);
        }
    }
}
