import * as vscode from 'vscode';
import { GitService } from '../services/gitService';
import { CommitInfo } from '../types/git';

export class AICommands {
    constructor(private gitService: GitService) { }

    /**
     * Explain a commit using AI (GitHub Copilot or Cursor)
     */
    async explainCommit(commit: CommitInfo, repoRoot?: string): Promise<void> {
        if (!commit) {
            vscode.window.showErrorMessage('No commit selected to explain.');
            return;
        }

        let diff = '';
        if (repoRoot) {
            try {
                // Get the actual diff content to give the AI context
                diff = await this.gitService.getCommitDiff(commit.hash, repoRoot);
            } catch (e) {
                console.error('Failed to get commit diff for explanation:', e);
            }
        }

        // Limit diff size to avoid prompt issues (approx 200 lines or 8000 chars)
        const diffContext = diff
            ? `\n\nCommit Details & Diff:\n${diff.substring(0, 8000)}${diff.length > 8000 ? '\n... (truncated)' : ''}`
            : '';

        const prompt = `Explain this commit ${commit.hash}: "${commit.message}"${diffContext}\n\nAnalyze the changes and explain what was modified and why.`;

        await this.openAIInterface(prompt);
    }

    /**
     * Open available AI interface (Copilot Chat or standard Chat)
     */
    private async openAIInterface(prompt: string): Promise<void> {
        // Always copy to clipboard first as a fallback/convenience
        await vscode.env.clipboard.writeText(prompt);

        // List of commands to try - Prioritize Cursor specific ones
        const commandsToTry = [
            'aichat.newchataction', // Cursor: New Chat (most likely)
            'aichat.focus', // Cursor: Focus Chat
            'cursor.ai.newChat', // Potential Cursor
            'workbench.action.chat.open', // VS Code Standard / Copilot
            'workbench.panel.chat.view.focus', // Generic Focus
        ];

        for (const command of commandsToTry) {
            try {
                // Some commands take arguments, others don't.
                if (command === 'workbench.action.chat.open') {
                    await vscode.commands.executeCommand(command, { query: prompt });
                } else {
                    await vscode.commands.executeCommand(command);
                }

                // If we get here, the command existed and executed without throwing.
                // We still continue to show the notification because we can't be sure
                // if the command actually opened the specific AI window we wanted.
                break;
            } catch (e) {
                // Command not found or failed, try next
            }
        }

        // Detect if running in Cursor
        const isCursor = vscode.env.appName?.toLowerCase().includes('cursor');

        const message = isCursor
            ? 'Prompt copied! Press Cmd+L (or Ctrl+L) to open Cursor AI, then Paste.'
            : 'Prompt copied! Open your AI Assistant and Paste.';

        // Always notify user so they know what happened
        await vscode.window.showInformationMessage(message, 'OK');
    }
}
