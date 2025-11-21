import * as vscode from 'vscode';
import { GitService } from '../services/gitService';

interface FileContributor {
    author: string;
    lineChanges: number;
    commitCount: number;
}

export class FileExpertsView {
    private panel: vscode.WebviewPanel | undefined;

    constructor(
        private context: vscode.ExtensionContext,
        private gitService: GitService
    ) { }

    async show(filePath: string): Promise<void> {
        const fileName = filePath.split('/').pop() || filePath;

        // Get top 5 contributors
        const contributors = await this.gitService.getFileContributors(filePath, 5);

        if (contributors.length === 0) {
            vscode.window.showInformationMessage(`No contributors found for ${fileName}`);
            return;
        }

        // Create or reveal the webview panel
        if (this.panel) {
            this.panel.reveal();
        } else {
            this.panel = vscode.window.createWebviewPanel(
                'fileExperts',
                `File Experts: ${fileName}`,
                vscode.ViewColumn.One,
                {
                    enableScripts: false,
                    retainContextWhenHidden: true
                }
            );

            this.panel.onDidDispose(() => {
                this.panel = undefined;
            });
        }

        // Set webview content
        this.panel.webview.html = this.getWebviewContent(fileName, contributors);
    }

    private getWebviewContent(fileName: string, contributors: FileContributor[]): string {
        const expertRows = contributors.map((c, index) => {
            const medals = ['🥇', '🥈', '🥉', '🏅', '🎖️'];
            const medal = medals[index] || '🏅';
            const rank = index + 1;
            const percentage = contributors.length > 0 ? Math.round((c.lineChanges / contributors[0].lineChanges) * 100) : 100;

            return `
                <div class="expert-card">
                    <div class="expert-rank">
                        <span class="medal">${medal}</span>
                        <span class="rank-number">#${rank}</span>
                    </div>
                    <div class="expert-details">
                        <div class="expert-name">${this.escapeHtml(c.author)}</div>
                        <div class="expert-stats">
                            <div class="stat">
                                <span class="stat-icon">📊</span>
                                <span class="stat-value">${c.lineChanges.toLocaleString()}</span>
                                <span class="stat-label">lines changed</span>
                            </div>
                            <div class="stat">
                                <span class="stat-icon">📝</span>
                                <span class="stat-value">${c.commitCount}</span>
                                <span class="stat-label">commits</span>
                            </div>
                        </div>
                        <div class="progress-bar">
                            <div class="progress-fill" style="width: ${percentage}%"></div>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>File Experts</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
            padding: 30px;
            max-width: 1200px;
            margin: 0 auto;
        }

        .header {
            margin-bottom: 30px;
        }

        .title {
            font-size: 28px;
            font-weight: 600;
            color: var(--vscode-editor-foreground);
            margin-bottom: 8px;
        }

        .subtitle {
            font-size: 14px;
            color: var(--vscode-descriptionForeground);
            margin-bottom: 5px;
        }

        .filename {
            font-size: 16px;
            color: var(--vscode-textLink-foreground);
            font-weight: 500;
            font-family: 'Courier New', monospace;
        }

        .expert-card {
            display: flex;
            gap: 20px;
            padding: 25px;
            margin-bottom: 20px;
            background: var(--vscode-editor-inactiveSelectionBackground);
            border-radius: 8px;
            border: 1px solid var(--vscode-panel-border);
            transition: transform 0.2s, box-shadow 0.2s;
        }

        .expert-card:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
        }

        .expert-rank {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            min-width: 80px;
        }

        .medal {
            font-size: 48px;
            margin-bottom: 8px;
        }

        .rank-number {
            font-size: 18px;
            font-weight: 600;
            color: var(--vscode-descriptionForeground);
        }

        .expert-details {
            flex: 1;
        }

        .expert-name {
            font-size: 20px;
            font-weight: 600;
            color: var(--vscode-editor-foreground);
            margin-bottom: 15px;
        }

        .expert-stats {
            display: flex;
            gap: 30px;
            margin-bottom: 15px;
        }

        .stat {
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .stat-icon {
            font-size: 18px;
        }

        .stat-value {
            font-size: 18px;
            font-weight: 600;
            color: var(--vscode-editor-foreground);
        }

        .stat-label {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            margin-left: 4px;
        }

        .progress-bar {
            width: 100%;
            height: 8px;
            background: var(--vscode-input-background);
            border-radius: 4px;
            overflow: hidden;
            margin-top: 10px;
        }

        .progress-fill {
            height: 100%;
            background: linear-gradient(90deg, 
                var(--vscode-charts-blue) 0%, 
                var(--vscode-charts-green) 100%);
            border-radius: 4px;
            transition: width 0.3s ease;
        }

        .footer {
            margin-top: 30px;
            padding: 20px;
            background: var(--vscode-editor-inactiveSelectionBackground);
            border-radius: 8px;
            text-align: center;
            font-size: 13px;
            color: var(--vscode-descriptionForeground);
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="title">👨‍💻 File Experts</div>
        <div class="subtitle">Top contributors based on total line changes (additions + deletions)</div>
        <div class="filename">${this.escapeHtml(fileName)}</div>
    </div>

    ${expertRows}

    <div class="footer">
        💡 These experts have made the most significant changes to this file and are likely the best people to ask for help or code reviews.
    </div>
</body>
</html>`;
    }

    private escapeHtml(text: string): string {
        const map: { [key: string]: string } = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        };
        return text.replace(/[&<>"']/g, (m) => map[m]);
    }
}

