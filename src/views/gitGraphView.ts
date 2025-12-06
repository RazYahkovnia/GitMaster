import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { GitService } from '../services/gitService';

interface GraphCommit {
    hash: string;
    shortHash: string;
    message: string;
    author: string;
    email: string;
    avatarUrl: string;
    date: string;
    parents: string[];
    branches: string[];
    tags: string[];
    refs: string[];
}

export class GitGraphView {
    private panel: vscode.WebviewPanel | undefined;
    private currentRepoRoot: string = '';
    private currentCommits: GraphCommit[] = [];
    private currentSkip: number = 0;
    private readonly batchSize: number = 50;

    constructor(
        private context: vscode.ExtensionContext,
        private gitService: GitService
    ) { }

    async show(repoRoot: string): Promise<void> {
        this.currentRepoRoot = repoRoot;
        this.currentSkip = 0;
        this.currentCommits = [];

        // Create or reveal the webview panel
        if (this.panel) {
            this.panel.reveal();
        } else {
            this.panel = vscode.window.createWebviewPanel(
                'gitGraph',
                'Git Graph',
                vscode.ViewColumn.One,
                {
                    enableScripts: true,
                    retainContextWhenHidden: true
                }
            );

            this.panel.onDidDispose(() => {
                this.panel = undefined;
            });

            // Listen for messages from the webview
            this.panel.webview.onDidReceiveMessage(
                async message => {
                    switch (message.command) {
                        case 'showCommitDetails':
                            await this.showCommitDetails(message.commitHash);
                            break;
                        case 'copyHash':
                            await vscode.env.clipboard.writeText(message.hash);
                            vscode.window.showInformationMessage(`Commit hash copied: ${message.hash}`);
                            break;
                        case 'loadMore':
                            await this.loadMoreCommits();
                            break;
                        case 'showContextMenu':
                            await this.showContextMenu(message.commitHash);
                            break;
                    }
                },
                undefined,
                this.context.subscriptions
            );
        }

        // Initial load
        await this.loadMoreCommits();
    }

    private async loadMoreCommits(): Promise<void> {
        if (!this.panel) {
            return;
        }

        try {
            const refs = await this.getInterestingRefs(this.currentRepoRoot);
            const newCommits = await this.gitService.getGraphCommits(this.currentRepoRoot, this.batchSize, this.currentSkip, refs);

            if (this.currentSkip === 0) {
                // First load
                this.currentCommits = newCommits;
                this.panel.webview.html = this.getWebviewContent(this.currentCommits);
            } else {
                // Append
                if (newCommits.length > 0) {
                    this.currentCommits = [...this.currentCommits, ...newCommits];
                    this.panel.webview.postMessage({
                        command: 'appendCommits',
                        commits: this.processCommits(newCommits),
                        hasMore: newCommits.length === this.batchSize
                    });
                } else {
                    this.panel.webview.postMessage({
                        command: 'noMoreCommits'
                    });
                }
            }

            this.currentSkip += newCommits.length;
        } catch (error) {
            vscode.window.showErrorMessage(`Error loading commits: ${error}`);
        }
    }

    private async getInterestingRefs(repoRoot: string): Promise<string[]> {
        try {
            const currentUser = await this.gitService.getCurrentUserName(repoRoot);
            const branches = await this.gitService.getBranches(repoRoot, 1000);
            const defaultBranch = await this.gitService.getDefaultBranch(repoRoot);

            // Normalize default branch name to avoid duplicates with generic checks
            const defaults = new Set(['main', 'master', 'origin/main', 'origin/master']);
            if (defaultBranch) {
                defaults.add(defaultBranch);
                // Also add the remote tracking version
                defaults.add(`origin/${defaultBranch}`);
            }

            const interestingBranches = branches.filter(b => {
                // Always show current branch
                if (b.isCurrent) {
                    return true;
                }

                // Always show default/main/master (local and remote)
                if (defaults.has(b.name)) {
                    return true;
                }

                // Also show origin/HEAD and its target
                if (b.name.startsWith('origin/HEAD')) {
                    return true;
                }

                // Show branches where last commit author is current user
                if (currentUser && b.lastCommitAuthor && b.lastCommitAuthor.toLowerCase().includes(currentUser.toLowerCase())) {
                    return true;
                }

                return false;
            });

            return interestingBranches.map(b => b.name);
        } catch (error) {
            console.error('Error getting filtered refs:', error);
            return []; // Fallback to all if error
        }
    }

    private async showCommitDetails(commitHash: string): Promise<void> {
        const commitInfo = await this.gitService.getCommitInfo(commitHash, this.currentRepoRoot);
        if (commitInfo) {
            // Show commit details
            await vscode.commands.executeCommand('gitmaster.showRepositoryCommitDetails', commitInfo, this.currentRepoRoot);

            // Focus on the GitMaster sidebar to show the commit details view
            await vscode.commands.executeCommand('workbench.view.extension.gitmaster');

            // Focus specifically on the commit details view
            await vscode.commands.executeCommand('gitmaster.commitDetails.focus');
        }
    }

    private async showContextMenu(commitHash: string): Promise<void> {
        const commit = this.currentCommits.find(c => c.hash === commitHash);
        if (!commit) {
            return;
        }

        // Check for local changes
        const hasChanges = await this.gitService.hasChangesToStash(this.currentRepoRoot);

        const items: { label: string; action: string; description?: string }[] = [
            { label: '$(copy) Copy Hash', action: 'copyHash' },
            { label: '$(copy) Copy Message', action: 'copyMessage' },
        ];

        if (hasChanges) {
            items.push({
                label: '$(warning) Cannot Checkout/Revert (Uncommitted Changes)',
                action: 'disabled',
                description: 'Commit or stash changes first'
            });
            items.push({ label: '$(git-branch) Create Branch', action: 'createBranch' });
        } else {
            items.push({ label: '$(git-commit) Checkout Commit', action: 'checkout' });
            items.push({ label: '$(git-branch) Create Branch', action: 'createBranch' });
            items.push({ label: '$(git-pull-request) Cherry Pick', action: 'cherryPick' });
            items.push({ label: '$(discard) Revert Commit', action: 'revert' });
        }

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: `Actions for ${commit.shortHash}: ${commit.message}`
        });

        if (!selected || selected.action === 'disabled') {
            return;
        }

        try {
            switch (selected.action) {
                case 'copyHash':
                    await vscode.env.clipboard.writeText(commit.hash);
                    break;
                case 'copyMessage':
                    await vscode.env.clipboard.writeText(commit.message);
                    break;
                case 'checkout':
                    await this.gitService.checkoutCommit(commit.hash, this.currentRepoRoot);
                    vscode.window.showInformationMessage(`Checked out commit ${commit.shortHash}`);
                    break;
                case 'createBranch':
                    vscode.commands.executeCommand('gitmaster.createBranchFromCommit', commit, this.currentRepoRoot);
                    break;
                case 'cherryPick':
                    vscode.commands.executeCommand('gitmaster.cherryPickCommit', commit, this.currentRepoRoot);
                    break;
                case 'revert':
                    vscode.commands.executeCommand('gitmaster.revertCommitInNewBranch', commit, this.currentRepoRoot);
                    break;
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Action failed: ${error}`);
        }
    }

    private async getGraphCommits(repoRoot: string, limit: number, skip: number): Promise<GraphCommit[]> {
        try {
            return await this.gitService.getGraphCommits(repoRoot, limit, skip);
        } catch (error) {
            console.error('Error getting graph commits:', error);
            return [];
        }
    }

    private processCommits(commits: GraphCommit[]): GraphCommit[] {
        return commits.map(c => {
            const hash = crypto.createHash('md5').update(c.email ? c.email.trim().toLowerCase() : '').digest('hex');
            return {
                ...c,
                avatarUrl: `https://www.gravatar.com/avatar/${hash}?d=identicon&s=32`
            };
        });
    }

    private getWebviewContent(commits: GraphCommit[]): string {
        const processedCommits = this.processCommits(commits);

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Git Graph</title>
    <style>
        :root {
            --bg-color: var(--vscode-editor-background);
            --text-color: var(--vscode-editor-foreground);
            --line-color: var(--vscode-editor-lineHighlightBorder);
            --hover-bg: var(--vscode-list-hoverBackground);
            --accent-color: var(--vscode-textLink-foreground);
            --tooltip-bg: var(--vscode-editorHoverWidget-background);
            --tooltip-border: var(--vscode-editorHoverWidget-border);
            --shadow-color: rgba(0, 0, 0, 0.35);
            --node-stroke: var(--vscode-editor-background);
            
            /* Modern Premium Color Palette */
            --primary-gradient: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            --secondary-gradient: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
            --success-gradient: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);
            --warning-gradient: linear-gradient(135deg, #fa709a 0%, #fee140 100%);
            --branch-gradient: linear-gradient(135deg, #11998e 0%, #38ef7d 100%);
            --tag-gradient: linear-gradient(135deg, #FFD89B 0%, #19547B 100%);
            --merge-gradient: linear-gradient(135deg, #8E2DE2 0%, #4A00E0 100%);
            --head-gradient: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            --glow-primary: rgba(102, 126, 234, 0.6);
            --glow-secondary: rgba(56, 239, 125, 0.6);
            --glow-head: rgba(118, 75, 162, 0.8);
            --tag-text: #fff;
            --head-color: #667eea;
            --grid-color: rgba(102, 126, 234, 0.05);
        }

        /* Light mode overrides */
        @media (prefers-color-scheme: light) {
            :root {
                --shadow-color: rgba(0, 0, 0, 0.2);
                --node-stroke: #ffffff;
                --tag-text: #fff;
                --grid-color: rgba(102, 126, 234, 0.08);
                --glow-primary: rgba(102, 126, 234, 0.4);
                --glow-secondary: rgba(56, 239, 125, 0.4);
            }
        }

        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
            background: var(--bg-color);
            color: var(--text-color);
            overflow: hidden;
            position: relative;
        }
        
        /* Advanced Animated Grid Background */
        body::before {
            content: '';
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background-image: 
                linear-gradient(90deg, var(--grid-color) 1px, transparent 1px),
                linear-gradient(var(--grid-color) 1px, transparent 1px);
            background-size: 50px 50px;
            pointer-events: none;
            animation: gridFlow 20s linear infinite;
            z-index: 0;
        }
        
        @keyframes gridFlow {
            0% { transform: translate(0, 0); }
            100% { transform: translate(50px, 50px); }
        }

        /* Floating Orbs Background Effect */
        body::after {
            content: '';
            position: fixed;
            top: -50%;
            left: -50%;
            width: 200%;
            height: 200%;
            background: 
                radial-gradient(circle at 20% 30%, var(--glow-primary), transparent 40%),
                radial-gradient(circle at 80% 70%, var(--glow-secondary), transparent 40%),
                radial-gradient(circle at 50% 50%, var(--glow-head), transparent 50%);
            opacity: 0.15;
            pointer-events: none;
            animation: orbsFloat 30s ease-in-out infinite;
            z-index: 0;
        }
        
        @keyframes orbsFloat {
            0%, 100% { transform: translate(0, 0) rotate(0deg); }
            33% { transform: translate(20px, -20px) rotate(120deg); }
            66% { transform: translate(-20px, 20px) rotate(240deg); }
        }

        #zoom-controls {
            position: fixed;
            bottom: 30px;
            right: 30px;
            display: flex;
            flex-direction: column;
            gap: 14px;
            z-index: 1000;
        }

        .zoom-btn {
            width: 52px;
            height: 52px;
            border: none;
            background: rgba(30, 30, 30, 0.75);
            color: var(--text-color);
            border-radius: 16px;
            cursor: pointer;
            font-size: 20px;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
            box-shadow: 
                0 10px 30px rgba(0, 0, 0, 0.3),
                inset 0 1px 0 rgba(255, 255, 255, 0.1);
            border: 1px solid rgba(255, 255, 255, 0.08);
            backdrop-filter: blur(20px) saturate(180%);
            -webkit-backdrop-filter: blur(20px) saturate(180%);
            position: relative;
            overflow: hidden;
        }
        
        .zoom-btn::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: linear-gradient(135deg, rgba(255,255,255,0.1), transparent);
            opacity: 0;
            transition: opacity 0.3s;
        }
        
        .zoom-btn:hover::before {
            opacity: 1;
        }

        .zoom-btn:hover {
            transform: scale(1.12) translateY(-4px) rotateZ(5deg);
            box-shadow: 
                0 16px 40px rgba(102, 126, 234, 0.4),
                inset 0 1px 0 rgba(255, 255, 255, 0.2);
            border-color: rgba(102, 126, 234, 0.6);
        }

        .zoom-btn:active {
            transform: scale(0.98);
        }
        
        /* Special Jump to HEAD button */
        #jump-head-btn {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            box-shadow: 
                0 10px 30px rgba(102, 126, 234, 0.5),
                inset 0 1px 0 rgba(255, 255, 255, 0.2);
            margin-bottom: 12px;
            animation: headButtonPulse 2s ease-in-out infinite;
        }
        
        @keyframes headButtonPulse {
            0%, 100% { box-shadow: 0 10px 30px rgba(102, 126, 234, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.2); }
            50% { box-shadow: 0 10px 40px rgba(102, 126, 234, 0.8), inset 0 1px 0 rgba(255, 255, 255, 0.3); }
        }
        
        #jump-head-btn:hover {
            background: linear-gradient(135deg, #764ba2 0%, #667eea 100%);
            transform: scale(1.15) translateY(-5px);
            animation: none;
        }

        #graph-container {
            width: 100%;
            height: 100vh;
            position: relative;
            overflow: auto;
            cursor: grab;
            scroll-behavior: smooth;
            padding-bottom: 100px;
            z-index: 1;
        }

        #graph-container:active {
            cursor: grabbing;
        }

        svg {
            display: block;
        }

        #badges-overlay {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            z-index: 10;
        }

        .badge {
            position: absolute;
            padding: 2px 8px;
            border-radius: 6px;
            font-size: 11px;
            font-weight: bold;
            color: white;
            white-space: nowrap;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            pointer-events: all;
            cursor: default;
            animation: fadeInUp 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
            opacity: 0;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
            backdrop-filter: blur(8px);
        }

        .badge.head-badge {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            box-shadow: 0 0 20px var(--glow-head);
            color: white;
        }

        .badge.branch-badge {
            background: linear-gradient(135deg, #0d7a6f 0%, #2bc48a 100%);
            color: white;
        }

        .badge.tag-badge {
            background: linear-gradient(135deg, #d4a55a 0%, #1a5a8c 100%);
            font-size: 10px;
            color: white;
        }

        .badge.merge-badge {
            background: linear-gradient(135deg, #7825c7 0%, #3d00b8 100%);
            color: white;
        }

        .badge.more-tags-badge {
            background: linear-gradient(135deg, #d6567a 0%, #e6c632 100%);
            cursor: pointer;
            transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
            color: white;
        }

        .badge.more-tags-badge:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 20px rgba(214, 86, 122, 0.4);
        }

        /* Light theme adjustments */
        @media (prefers-color-scheme: light) {
            .badge {
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
            }

            .badge.head-badge {
                background: linear-gradient(135deg, #5568d3 0%, #6a3c8c 100%);
            }

            .badge.branch-badge {
                background: linear-gradient(135deg, #0a5f56 0%, #22a371 100%);
            }

            .badge.tag-badge {
                background: linear-gradient(135deg, #b8873e 0%, #154870 100%);
            }

            .badge.merge-badge {
                background: linear-gradient(135deg, #6620a8 0%, #32009a 100%);
            }

            .badge.more-tags-badge {
                background: linear-gradient(135deg, #c24166 0%, #d1b025 100%);
            }

            .badge.more-tags-badge:hover {
                box-shadow: 0 6px 20px rgba(194, 65, 102, 0.5);
            }
        }

        /* Ultra-Modern Commit Nodes with 3D Effect */
        .commit-node {
            cursor: pointer;
            transition: all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
            filter: drop-shadow(0 4px 8px var(--shadow-color));
        }
        
        .commit-node:hover {
            filter: drop-shadow(0 8px 24px var(--glow-primary));
        }

        .commit-circle {
            fill: var(--vscode-gitDecoration-addedResourceForeground);
            stroke: var(--node-stroke);
            stroke-width: 3;
            transition: all 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
            filter: 
                drop-shadow(0 0 8px currentColor)
                drop-shadow(0 4px 12px var(--shadow-color));
        }

        .commit-node:hover .commit-circle {
            r: 11;
            stroke-width: 4;
            filter: 
                drop-shadow(0 0 20px currentColor)
                drop-shadow(0 0 40px currentColor)
                drop-shadow(0 4px 16px var(--shadow-color));
        }

        /* Animated Row Highlight with Gradient */
        .commit-row-bg {
            fill: transparent;
            transition: all 0.3s ease;
        }
        
        .commit-node:hover .commit-row-bg {
            fill: url(#rowGradient);
            fill-opacity: 0.15;
        }

        /* HEAD Pulse Animation - Enhanced */
        @keyframes headPulse {
            0% { r: 8; stroke-opacity: 0.8; stroke-width: 0; }
            50% { r: 16; stroke-opacity: 0.4; stroke-width: 6; }
            100% { r: 24; stroke-opacity: 0; stroke-width: 12; }
        }
        
        @keyframes headRotate {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
        }

        .head-indicator {
            fill: none;
            stroke: url(#headGradient);
            stroke-width: 3;
            pointer-events: none;
            animation: headPulse 2.5s infinite;
        }
        
        .head-ring {
            fill: none;
            stroke: url(#headGradient);
            stroke-width: 2;
            opacity: 0.4;
            pointer-events: none;
            transform-origin: center;
            animation: headRotate 10s linear infinite;
        }

        .merge-commit .commit-circle {
            fill: url(#mergeGradient);
            stroke: var(--node-stroke);
            stroke-width: 4;
        }

        .current-branch .commit-circle {
            fill: url(#headGradient);
            stroke: var(--node-stroke);
            stroke-width: 4;
            filter: 
                drop-shadow(0 0 12px var(--glow-head))
                drop-shadow(0 4px 16px var(--shadow-color));
        }
        
        .current-branch:hover .commit-circle {
            stroke-width: 5;
            filter: 
                drop-shadow(0 0 30px var(--glow-head))
                drop-shadow(0 0 50px var(--glow-head))
                drop-shadow(0 8px 24px var(--shadow-color));
        }

        /* Advanced Line Rendering with Glow */
        .commit-line {
            stroke: var(--vscode-editor-foreground);
            stroke-width: 3;
            fill: none;
            opacity: 0.4;
            stroke-linecap: round;
            stroke-linejoin: round;
            transition: all 0.3s ease;
            filter: drop-shadow(0 0 4px currentColor);
        }
        
        .commit-node:hover ~ .commit-line,
        .commit-line:hover {
            opacity: 0.8;
            stroke-width: 4;
            filter: drop-shadow(0 0 10px currentColor);
        }

        .merge-line {
            stroke: url(#mergeGradient);
            stroke-width: 3;
            fill: none;
            opacity: 0.5;
            stroke-dasharray: 8,6;
            stroke-linecap: round;
            animation: dashFlow 1s linear infinite;
            filter: drop-shadow(0 0 6px var(--glow-primary));
        }
        
        @keyframes dashFlow {
            to { stroke-dashoffset: -14; }
        }

        /* Premium Typography */
        .commit-message {
            fill: var(--text-color);
            font-weight: 600;
            font-size: 15px;
            opacity: 0.95;
            transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
            font-family: 'Inter', sans-serif;
            letter-spacing: -0.01em;
        }
        
        .commit-node:hover .commit-message {
            fill: var(--accent-color);
            opacity: 1;
            transform: translateX(6px);
            filter: drop-shadow(0 0 8px var(--glow-primary));
        }

        .commit-meta {
            fill: var(--vscode-descriptionForeground);
            font-size: 12px;
            opacity: 0.7;
            transition: opacity 0.2s;
        }
        
        .commit-node:hover .commit-meta {
            opacity: 0.9;
        }
        
        .commit-hash {
            font-family: 'JetBrains Mono', 'Consolas', 'Courier New', monospace;
            cursor: pointer;
            fill: var(--vscode-textLink-foreground);
            text-decoration: none;
            opacity: 0.8;
            font-weight: 600;
            transition: all 0.2s;
        }
        
        .commit-hash:hover {
            opacity: 1;
            filter: drop-shadow(0 0 6px currentColor);
        }

        /* Premium Glass Badge Design */
        .ref-badge {
            rx: 6;
            opacity: 0.95;
            filter: drop-shadow(0 4px 12px var(--shadow-color));
            cursor: default;
            transition: all 0.3s ease;
        }
        
        .ref-badge:hover {
            filter: drop-shadow(0 6px 20px var(--shadow-color));
            transform: translateY(-2px);
        }

        .ref-text {
            fill: white;
            font-size: 11px;
            font-weight: 700;
            text-shadow: 0 2px 4px rgba(0,0,0,0.3);
            pointer-events: none;
            font-family: 'Inter', sans-serif;
            letter-spacing: 0.02em;
        }
        
        .tag-text {
            fill: var(--tag-text);
            text-shadow: 0 2px 4px rgba(0,0,0,0.4);
        }
        
        .more-tags-btn {
            cursor: pointer;
            transition: all 0.3s ease;
        }

        /* Premium Glassmorphism Tooltip */
        .tooltip {
            position: absolute;
            background: rgba(20, 20, 30, 0.85);
            border: 1px solid rgba(255, 255, 255, 0.15);
            padding: 20px;
            border-radius: 20px;
            font-size: 13px;
            pointer-events: none;
            opacity: 0;
            transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
            max-width: 420px;
            z-index: 2000;
            box-shadow: 
                0 20px 60px rgba(0, 0, 0, 0.5),
                inset 0 1px 0 rgba(255, 255, 255, 0.1);
            transform: translateY(15px) scale(0.95);
            backdrop-filter: blur(30px) saturate(180%);
            -webkit-backdrop-filter: blur(30px) saturate(180%);
        }
        
        @media (prefers-color-scheme: light) {
            .tooltip {
                background: rgba(255, 255, 255, 0.9);
                border: 1px solid rgba(0, 0, 0, 0.12);
                box-shadow: 
                    0 20px 60px rgba(0, 0, 0, 0.2),
                    inset 0 1px 0 rgba(255, 255, 255, 0.8);
            }
        }

        .tooltip.show {
            opacity: 1;
            transform: translateY(0) scale(1);
            pointer-events: auto;
        }

        .tooltip-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 14px;
            gap: 12px;
            border-bottom: 2px solid rgba(102, 126, 234, 0.3);
            padding-bottom: 10px;
        }

        .tooltip-title {
            font-weight: 700;
            color: var(--text-color);
            line-height: 1.5;
            font-size: 14px;
            letter-spacing: -0.01em;
        }

        .tooltip-row {
            display: flex;
            margin: 8px 0;
            color: var(--vscode-descriptionForeground);
            font-size: 12px;
            align-items: baseline;
        }
        
        .tooltip-label {
            min-width: 75px;
            opacity: 0.85;
            font-weight: 600;
        }
        
        .tooltip-value {
            flex: 1;
            word-break: break-all;
            font-family: 'JetBrains Mono', 'Consolas', monospace;
            font-size: 11px;
        }

        .copy-btn {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            border-radius: 10px;
            padding: 8px 16px;
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 8px;
            transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
            white-space: nowrap;
            margin-top: 12px;
            box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
        }

        .copy-btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 20px rgba(102, 126, 234, 0.6);
        }
        
        .copy-btn svg {
            width: 14px;
            height: 14px;
            fill: currentColor;
            display: inline-block;
        }

        /* Load More Trigger (Invisible) */
        #load-more-trigger {
            height: 20px;
            width: 100%;
            margin-bottom: 20px;
        }

        /* Premium Loading Indicator */
        #loading-indicator {
            position: fixed;
            bottom: 30px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(20, 20, 30, 0.85);
            color: var(--text-color);
            padding: 12px 24px;
            border-radius: 30px;
            font-size: 14px;
            font-weight: 600;
            box-shadow: 
                0 8px 32px rgba(0, 0, 0, 0.4),
                inset 0 1px 0 rgba(255, 255, 255, 0.1);
            display: none;
            align-items: center;
            gap: 12px;
            z-index: 100;
            border: 1px solid rgba(255, 255, 255, 0.1);
            backdrop-filter: blur(20px) saturate(180%);
            -webkit-backdrop-filter: blur(20px) saturate(180%);
        }
        
        .spinner {
            width: 18px;
            height: 18px;
            border: 3px solid rgba(102, 126, 234, 0.3);
            border-top: 3px solid #667eea;
            border-radius: 50%;
            animation: spin 0.8s linear infinite;
        }
        
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }

        /* Enhanced Animations */
        @keyframes fadeInUp {
            from { 
                opacity: 0; 
                transform: translateY(30px) scale(0.95); 
            }
            to { 
                opacity: 1; 
                transform: translateY(0) scale(1); 
            }
        }
        
        @keyframes slideInRight {
            from { 
                opacity: 0; 
                transform: translateX(-30px); 
            }
            to { 
                opacity: 1; 
                transform: translateX(0); 
            }
        }
        
        .animate-in {
            animation: fadeInUp 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
        }
        
        .animate-slide {
            animation: slideInRight 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
        }
    </style>
</head>
<body>
    <div id="graph-container">
        <svg id="graph-svg"></svg>
        <div id="badges-overlay"></div>
        <div id="load-more-trigger"></div>
    </div>
    
    <div id="loading-indicator">
        <div class="spinner"></div>
        <span>Loading more commits...</span>
    </div>
    
    <div id="zoom-controls">
        <button class="zoom-btn" id="jump-head-btn" title="Jump to HEAD">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="3"></circle></svg>
        </button>
        <div style="height: 8px;"></div>
        <button class="zoom-btn" id="zoom-in" title="Zoom In">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
        </button>
        <button class="zoom-btn" id="zoom-reset" title="Reset Zoom">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path></svg>
        </button>
        <button class="zoom-btn" id="zoom-out" title="Zoom Out">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line></svg>
        </button>
    </div>

    <div id="tooltip" class="tooltip"></div>

    <script>
        const vscode = acquireVsCodeApi();
        let commits = ${JSON.stringify(processedCommits)};
        let isLoading = false;
        let hasMore = true;
        let headHash = null;
        
        // Configuration
        const CONFIG = {
            RADIUS: 6,
            V_SPACING: 80,
            H_SPACING: 24,
            LABEL_OFFSET: 25,
            COLORS: [
                '#007acc', '#d32f2f', '#2e7d32', '#f9a825', '#6a1b9a', 
                '#00838f', '#ef6c00', '#4527a0', '#c62828', '#283593'
            ]
        };
        
        // State
        const state = {
            zoom: 1,
            isDragging: false,
            startX: 0,
            startY: 0,
            scrollLeft: 0,
            scrollTop: 0,
            tooltipTimeout: null
        };

        function renderGraph(commitsToRender) {
            // Logic to layout graph
            const commitPositions = new Map();
            const commitLanes = new Map();
            let maxLane = 0;
            let nextLane = 0;
            const commitHashSet = new Set(commitsToRender.map(c => c.hash));
            
            // Identify HEAD
            headHash = null;
            console.log('[GitGraph] Rendering', commitsToRender.length, 'commits');
            
            // Assign lanes
            commitsToRender.forEach((commit, index) => {
                // Debug log for first few commits
                if (index < 5) {
                    console.log('[GitGraph] Commit', index, ':', commit.shortHash, 'refs:', commit.refs, 'branches:', commit.branches);
                }
                
                // Check for local HEAD (not origin/HEAD)
                // Check the refs array since branches have 'HEAD -> ' stripped out
                if (commit.refs && commit.refs.some(r => r.startsWith('HEAD ->') && !r.includes('origin/'))) {
                    headHash = commit.hash;
                    console.log('[GitGraph] ✅ Found HEAD at commit:', commit.hash, commit.shortHash, commit.message, 'refs:', commit.refs);
                }

                let lane;
                if (commitLanes.has(commit.hash)) {
                    lane = commitLanes.get(commit.hash);
                } else {
                    lane = nextLane++;
                }
                commitLanes.set(commit.hash, lane);
                if (lane > maxLane) maxLane = lane;
                
                if (commit.parents.length > 0) {
                    const firstParent = commit.parents[0];
                    if (commitHashSet.has(firstParent) && !commitLanes.has(firstParent)) {
                        commitLanes.set(firstParent, lane);
                    }
                    for (let i = 1; i < commit.parents.length; i++) {
                        const parent = commit.parents[i];
                        if (commitHashSet.has(parent) && !commitLanes.has(parent)) {
                            const newLane = nextLane++;
                            commitLanes.set(parent, newLane);
                            if (newLane > maxLane) maxLane = newLane;
                        }
                    }
                }
            });
            
            // Calculate positions
            let currentY = 100;
            commitsToRender.forEach((commit, index) => {
                if (index > 0) {
                    let spacing = CONFIG.V_SPACING;
                    
                    // Add space if current commit has branches (top overlap)
                    if (commit.branches.length > 0) {
                        spacing += 40;
                    }
                    
                    // Add space if previous commit had tags (bottom overlap)
                    const prevCommit = commitsToRender[index - 1];
                    if (prevCommit && prevCommit.tags.length > 0) {
                        spacing += 40;
                    }
                    
                    currentY += spacing;
                }
                
                const lane = commitLanes.get(commit.hash);
                const x = lane * CONFIG.H_SPACING + 30;
                commitPositions.set(commit.hash, { x, y: currentY, lane });
            });
            
            // Calculate dynamic width based on max text length estimation
            let maxTextWidth = 0;
            commitsToRender.forEach(commit => {
                let width = commit.message.length * 8; // Approx char width
                // Add branches/tags width
                commit.branches.forEach(b => width += b.length * 8 + 20);
                commit.tags.forEach(t => width += t.length * 8 + 20);
                if (width > maxTextWidth) maxTextWidth = width;
            });
            
            // Render
            const svg = document.getElementById('graph-svg');
            const badgesOverlay = document.getElementById('badges-overlay');
            const graphWidth = (maxLane + 1) * CONFIG.H_SPACING + 100;
            const totalWidth = Math.max(graphWidth + maxTextWidth + 200, window.innerWidth * 1.5);
            const height = currentY + 150;
            
            // Clear existing content
            svg.innerHTML = '';
            badgesOverlay.innerHTML = '';
            
            svg.setAttribute('width', totalWidth);
            svg.setAttribute('height', height);
            
            // Add Premium Gradients & Effects
            const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
            defs.innerHTML = \`
                <!-- Branch Gradient -->
                <linearGradient id="branchGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" style="stop-color:#11998e;stop-opacity:1" />
                    <stop offset="100%" style="stop-color:#38ef7d;stop-opacity:1" />
                </linearGradient>
                
                <!-- Tag Gradient -->
                <linearGradient id="tagGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" style="stop-color:#FFD89B;stop-opacity:1" />
                    <stop offset="50%" style="stop-color:#19547B;stop-opacity:1" />
                    <stop offset="100%" style="stop-color:#0D2F44;stop-opacity:1" />
                </linearGradient>
                
                <!-- Merge Gradient -->
                <linearGradient id="mergeGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" style="stop-color:#8E2DE2;stop-opacity:1" />
                    <stop offset="100%" style="stop-color:#4A00E0;stop-opacity:1" />
                </linearGradient>
                
                <!-- HEAD Gradient -->
                <linearGradient id="headGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" style="stop-color:#667eea;stop-opacity:1" />
                    <stop offset="100%" style="stop-color:#764ba2;stop-opacity:1" />
                </linearGradient>
                
                <!-- Row Hover Gradient -->
                <linearGradient id="rowGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" style="stop-color:transparent;stop-opacity:0" />
                    <stop offset="10%" style="stop-color:#667eea;stop-opacity:0.15" />
                    <stop offset="90%" style="stop-color:#764ba2;stop-opacity:0.15" />
                    <stop offset="100%" style="stop-color:transparent;stop-opacity:0" />
                </linearGradient>
                
                <!-- Glow Filters -->
                <filter id="glow">
                    <feGaussianBlur stdDeviation="4" result="coloredBlur"/>
                    <feMerge>
                        <feMergeNode in="coloredBlur"/>
                        <feMergeNode in="SourceGraphic"/>
                    </feMerge>
                </filter>
                
                <filter id="strongGlow">
                    <feGaussianBlur stdDeviation="8" result="coloredBlur"/>
                    <feMerge>
                        <feMergeNode in="coloredBlur"/>
                        <feMergeNode in="SourceGraphic"/>
                    </feMerge>
                </filter>
            \`;
            svg.appendChild(defs);
            
            // Helper to get color for lane
            const getLaneColor = (lane) => CONFIG.COLORS[lane % CONFIG.COLORS.length];

            // Draw lines
            commitsToRender.forEach((commit, i) => {
                const pos = commitPositions.get(commit.hash);
                if (!pos) return;
                
                commit.parents.forEach((parentHash, idx) => {
                    const parentPos = commitPositions.get(parentHash);
                    if (!parentPos) return;
                    
                    const isMerge = commit.parents.length > 1 && idx > 0;
                    const lineClass = isMerge ? 'merge-line' : 'commit-line';
                    const color = getLaneColor(isMerge ? parentPos.lane : pos.lane);
                    
                    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                    
                    // Improved Bezier curve for "nice tree branch" look
                    let d = '';
                    if (pos.x === parentPos.x) {
                        d = \`M \${pos.x} \${pos.y} L \${parentPos.x} \${parentPos.y}\`;
                    } else {
                        // Cubic Bezier for smooth branching
                        const midY = pos.y + (parentPos.y - pos.y) / 2;
                        d = \`M \${pos.x} \${pos.y} C \${pos.x} \${midY}, \${parentPos.x} \${midY}, \${parentPos.x} \${parentPos.y}\`;
                    }
                    
                    path.setAttribute('d', d);
                    path.setAttribute('class', lineClass);
                    path.style.stroke = color;
                    svg.appendChild(path);
                });
            });
            
            // Draw nodes and text
            commitsToRender.forEach((commit, i) => {
                const pos = commitPositions.get(commit.hash);
                if (!pos) return;
                
                const isMerge = commit.parents.length > 1;
                // Check refs array for HEAD, not branches (since HEAD -> is stripped from branches)
                const isCurrentBranch = commit.refs && commit.refs.some(r => r.startsWith('HEAD ->') && !r.includes('origin/'));
                const color = getLaneColor(pos.lane);
                
                const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
                g.setAttribute('class', \`commit-node \${isMerge ? 'merge-commit' : ''} \${isCurrentBranch ? 'current-branch' : ''}\`);
                g.setAttribute('data-hash', commit.hash);
                // Ensure opacity is set to 1 for visibility
                g.style.opacity = '1';
                // Add animation class for new items
                g.classList.add('animate-in');
                
                // Row Background (Invisible but for hover)
                // Calculate dynamic height based on content
                let topY = pos.y - 25;
                let bottomY = pos.y + 25;
                
                if (commit.branches.length > 0) {
                    topY -= 30; // More space for branches
                }
                if (commit.tags.length > 0) {
                    bottomY += 35; // More space for tags
                }
                
                const rowHeight = bottomY - topY;
                
                const rowBg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                rowBg.setAttribute('x', 0);
                rowBg.setAttribute('y', topY);
                rowBg.setAttribute('width', totalWidth);
                rowBg.setAttribute('height', rowHeight);
                rowBg.setAttribute('rx', 8);
                rowBg.setAttribute('class', 'commit-row-bg');
                g.appendChild(rowBg);
                
                // HEAD Pulse Ring with Double Effect
                if (isCurrentBranch) {
                    // Outer pulse
                    const pulse = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                    pulse.setAttribute('cx', pos.x);
                    pulse.setAttribute('cy', pos.y);
                    pulse.setAttribute('r', CONFIG.RADIUS + 10);
                    pulse.setAttribute('class', 'head-indicator');
                    g.appendChild(pulse);
                    
                    // Static ring for depth
                    const ring = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                    ring.setAttribute('cx', pos.x);
                    ring.setAttribute('cy', pos.y);
                    ring.setAttribute('r', CONFIG.RADIUS + 4);
                    ring.setAttribute('class', 'head-ring');
                    ring.setAttribute('stroke-dasharray', '4,3');
                    g.appendChild(ring);
                }

                // Circle
                const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                circle.setAttribute('cx', pos.x);
                circle.setAttribute('cy', pos.y);
                circle.setAttribute('r', CONFIG.RADIUS);
                circle.setAttribute('class', 'commit-circle');
                if (!isCurrentBranch) circle.style.fill = color;
                if (isMerge) circle.style.fill = '#fff'; 
                if (isMerge) circle.style.stroke = color;
                
                g.appendChild(circle);
                
                // Text Group
                const textX = (maxLane + 1) * CONFIG.H_SPACING + CONFIG.LABEL_OFFSET;
                
                // --- Layout: Professional Stacked ---
                
                // 1. Branches (Top)
                let currentY = pos.y - 45; // Moved further up for padding
                let currentX = textX;
                
                // Add HEAD badge first if this is the current commit
                if (isCurrentBranch) {
                    const headBadge = document.createElement('div');
                    headBadge.className = 'badge head-badge';
                    headBadge.textContent = 'HEAD';
                    headBadge.style.left = currentX + 'px';
                    headBadge.style.top = (currentY - 10) + 'px';
                    headBadge.style.animationDelay = '0s';
                    badgesOverlay.appendChild(headBadge);
                    
                    // Measure and update currentX
                    setTimeout(() => {
                        const width = headBadge.offsetWidth;
                        // Store for next badge positioning (handled in next iteration)
                    }, 0);
                    currentX += 52; // Approximate width + gap
                }
                
                if (commit.branches.length > 0) {
                    commit.branches.forEach((branch, idx) => {
                        // Skip origin/HEAD - it's just a pointer, not meaningful for display
                        if (branch === 'origin/HEAD' || branch.startsWith('origin/HEAD ->')) {
                            return;
                        }
                        
                        const text = branch.replace('HEAD -> ', '→ ');
                        const branchBadge = document.createElement('div');
                        branchBadge.className = 'badge branch-badge';
                        branchBadge.textContent = text;
                        branchBadge.style.left = currentX + 'px';
                        branchBadge.style.top = (currentY - 10) + 'px';
                        branchBadge.style.animationDelay = \`\${(idx + 1) * 0.05}s\`;
                        badgesOverlay.appendChild(branchBadge);
                        
                        currentX += (text.length * 7) + 16; // Approximate width + gap
                    });
                }
                
                // 2. Message (Primary)
                const messageY = pos.y - 5;
                const message = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                message.setAttribute('x', textX);
                message.setAttribute('y', messageY);
                message.setAttribute('class', 'commit-message');
                message.style.fontSize = '14px';
                message.style.fontWeight = '600';
                message.textContent = commit.message;
                
                // Tooltip interaction for Message (Only title)
                message.addEventListener('mouseenter', (e) => showTooltip(e, commit));
                message.addEventListener('mouseleave', hideTooltip);
                
                g.appendChild(message);
                
                // Merge Badge (Inline with message) - Enhanced
                const mergeMatch = commit.message.match(/^Merge branch '([^']+)'/);
                if (mergeMatch) {
                    const mergedBranch = mergeMatch[1];
                    const badgeText = 'from ' + mergedBranch;
                    const badgeX = textX + (commit.message.length * 8.5) + 12; 
                    
                    const mergeBadge = document.createElement('div');
                    mergeBadge.className = 'badge merge-badge';
                    mergeBadge.textContent = badgeText;
                    mergeBadge.style.left = badgeX + 'px';
                    mergeBadge.style.top = (messageY - 25) + 'px';
                    mergeBadge.style.animationDelay = '0.1s';
                    badgesOverlay.appendChild(mergeBadge);
                }
                
                // 3. Meta: Author • Hash • Date (Bottom line)
                const metaY = pos.y + 16;
                
                // Avatar
                const avatarSize = 16;
                const avatar = document.createElementNS('http://www.w3.org/2000/svg', 'image');
                avatar.setAttribute('x', textX);
                avatar.setAttribute('y', metaY - 11);
                avatar.setAttribute('width', avatarSize);
                avatar.setAttribute('height', avatarSize);
                avatar.setAttribute('href', commit.avatarUrl);
                avatar.setAttribute('style', 'clip-path: circle(50%);');
                g.appendChild(avatar);

                const metaGroup = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                metaGroup.setAttribute('x', textX + avatarSize + 8);
                metaGroup.setAttribute('y', metaY);
                metaGroup.setAttribute('class', 'commit-meta');
                
                // Author
                const authorSpan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
                authorSpan.textContent = commit.author;
                authorSpan.style.fontWeight = '500';
                authorSpan.style.fill = 'var(--vscode-foreground)';
                metaGroup.appendChild(authorSpan);
                
                // Separator
                const sep1 = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
                sep1.textContent = ' • ';
                sep1.style.fill = 'var(--vscode-descriptionForeground)';
                metaGroup.appendChild(sep1);
                
                // Hash
                const hashSpan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
                hashSpan.textContent = commit.shortHash;
                hashSpan.setAttribute('class', 'commit-hash');
                hashSpan.style.fontFamily = 'monospace';
                hashSpan.style.cursor = 'pointer';
                hashSpan.addEventListener('click', (e) => {
                    e.stopPropagation();
                    copyToClipboard(commit.hash);
                });
                metaGroup.appendChild(hashSpan);

                 // Separator
                const sep2 = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
                sep2.textContent = ' • ';
                sep2.style.fill = 'var(--vscode-descriptionForeground)';
                metaGroup.appendChild(sep2);

                // Date
                const dateSpan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
                dateSpan.textContent = commit.date;
                dateSpan.style.fill = 'var(--vscode-descriptionForeground)';
                metaGroup.appendChild(dateSpan);
                
                g.appendChild(metaGroup);
                
                // 4. Tags (Bottom)
                if (commit.tags.length > 0) {
                    let tagX = textX;
                    let tagY = pos.y + 40; // Moved down slightly
                    
                    const maxVisibleTags = 2;
                    const visibleTags = commit.tags.slice(0, maxVisibleTags);
                    const hasMoreTags = commit.tags.length > maxVisibleTags;
                    
                    visibleTags.forEach((tag, idx) => {
                        const tagBadge = document.createElement('div');
                        tagBadge.className = 'badge tag-badge';
                        tagBadge.textContent = tag;
                        tagBadge.style.left = tagX + 'px';
                        tagBadge.style.top = (tagY - 10) + 'px';
                        tagBadge.style.animationDelay = \`\${idx * 0.06}s\`;
                        badgesOverlay.appendChild(tagBadge);
                        
                        tagX += (tag.length * 6) + 16; // Approximate width + gap
                    });
                    
                    if (hasMoreTags) {
                        const remainingTags = commit.tags.slice(maxVisibleTags);
                        const moreText = \`+\${remainingTags.length}\`;
                        
                        const moreBadge = document.createElement('div');
                        moreBadge.className = 'badge more-tags-badge';
                        moreBadge.textContent = moreText;
                        moreBadge.style.left = tagX + 'px';
                        moreBadge.style.top = (tagY - 10) + 'px';
                        moreBadge.style.animationDelay = '0.12s';
                        
                        moreBadge.addEventListener('mouseenter', (e) => {
                            e.stopPropagation();
                            showTagsTooltip(e, remainingTags);
                        });
                        
                        moreBadge.addEventListener('mouseleave', (e) => {
                            e.stopPropagation();
                            hideTooltip();
                        });
                        
                        badgesOverlay.appendChild(moreBadge);
                    }
                }
                
                // Interaction
                g.addEventListener('click', () => {
                    vscode.postMessage({
                        command: 'showCommitDetails',
                        commitHash: commit.hash
                    });
                });
                g.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    vscode.postMessage({
                        command: 'showContextMenu',
                        commitHash: commit.hash
                    });
                });
                
                svg.appendChild(g);
            });
        }
        
        // Initial render
        renderGraph(commits);
        
        // Infinite Scroll Observer
        const loadMoreTrigger = document.getElementById('load-more-trigger');
        const observer = new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting && !isLoading && hasMore) {
                loadMoreCommits();
            }
        }, {
            root: document.getElementById('graph-container'),
            threshold: 0.1
        });
        
        observer.observe(loadMoreTrigger);

        function loadMoreCommits() {
            isLoading = true;
            document.getElementById('loading-indicator').style.display = 'flex';
            vscode.postMessage({
                command: 'loadMore'
            });
        }
        
        // Message Handler
        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.command) {
                case 'appendCommits':
                    commits = [...commits, ...message.commits];
                    renderGraph(commits);
                    isLoading = false;
                    hasMore = message.hasMore;
                    document.getElementById('loading-indicator').style.display = 'none';
                    
                    if (!hasMore) {
                        observer.disconnect();
                    }
                    break;
                case 'noMoreCommits':
                    isLoading = false;
                    hasMore = false;
                    document.getElementById('loading-indicator').style.display = 'none';
                    observer.disconnect();
                    break;
            }
        });

        // Jump to HEAD
        document.getElementById('jump-head-btn').addEventListener('click', () => {
            console.log('[GitGraph] Jump to HEAD clicked. headHash:', headHash);
            
            if (!headHash) {
                console.log('[GitGraph] No HEAD hash found, scrolling to top');
                // If HEAD not found (maybe deep in history?), try scrolling to top first
                container.scrollTo({ top: 0, behavior: 'smooth' });
                return;
            }
            
            const headElement = document.querySelector(\`.commit-node[data-hash="\${headHash}"]\`);
            console.log('[GitGraph] HEAD element found:', !!headElement);
            
            if (headElement) {
                // Calculate position to center it
                const rect = headElement.getBoundingClientRect();
                const containerRect = container.getBoundingClientRect();
                
                // Account for current scroll
                const scrollTop = container.scrollTop;
                const absoluteTop = rect.top + scrollTop - containerRect.top;
                
                // Center in view
                const targetScroll = absoluteTop - (containerRect.height / 2) + 50;
                
                console.log('[GitGraph] Scrolling to HEAD. Target scroll:', targetScroll);
                
                container.scrollTo({
                    top: Math.max(0, targetScroll),
                    behavior: 'smooth'
                });
                
                // Flash effect
                headElement.style.opacity = '0.5';
                setTimeout(() => headElement.style.opacity = '1', 150);
                setTimeout(() => headElement.style.opacity = '0.5', 300);
                setTimeout(() => headElement.style.opacity = '1', 450);
            } else {
                console.log('[GitGraph] HEAD element not found in DOM');
            }
        });

        // Tooltip
        const tooltip = document.getElementById('tooltip');
        
        // Add events to tooltip to prevent hiding when hovering over it
        tooltip.addEventListener('mouseenter', () => {
            if (state.tooltipTimeout) {
                clearTimeout(state.tooltipTimeout);
                state.tooltipTimeout = null;
            }
        });
        
        tooltip.addEventListener('mouseleave', () => {
            hideTooltip();
        });
        
        function showTooltip(e, commit) {
            if (state.tooltipTimeout) {
                clearTimeout(state.tooltipTimeout);
                state.tooltipTimeout = null;
            }
            
            tooltip.innerHTML = \`
                <div class="tooltip-header">
                    <div class="tooltip-title">\${commit.message}</div>
                </div>
                <div class="tooltip-row">
                    <span class="tooltip-label">Commit</span>
                    <span class="tooltip-value">\${commit.hash}</span>
                </div>
                <div class="tooltip-row">
                    <span class="tooltip-label">Author</span>
                    <span class="tooltip-value">\${commit.author}</span>
                </div>
                <div class="tooltip-row">
                    <span class="tooltip-label">Date</span>
                    <span class="tooltip-value">\${commit.date}</span>
                </div>
                <div style="margin-top: 12px;">
                    <button class="copy-btn" onclick="copyToClipboard('\${commit.hash}')">
                        <svg viewBox="0 0 16 16"><path d="M4 1.5H3a2 2 0 0 0-2 2V14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V3.5a2 2 0 0 0-2-2h-1v1h1a1 1 0 0 1 1 1V14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1h1v-1z"/><path d="M9.5 1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5h-3a.5.5 0 0 1-.5-.5v-1a.5.5 0 0 1 .5-.5h3zm-3-1A1.5 1.5 0 0 0 5 1.5v1A1.5 1.5 0 0 0 6.5 4h3A1.5 1.5 0 0 0 11 2.5v-1A1.5 1.5 0 0 0 9.5 0h-3z"/></svg>
                        Copy Hash
                    </button>
                </div>
            \`;
            
            // Position logic
            const rect = tooltip.getBoundingClientRect();
            // Position slightly offset to avoid immediate overlap but close enough
            let top = e.clientY + 15;
            let left = e.clientX + 15;
            
            if (left + rect.width > window.innerWidth) {
                left = window.innerWidth - rect.width - 10;
            }
            if (top + rect.height > window.innerHeight) {
                top = e.clientY - rect.height - 10;
            }
            
            tooltip.style.top = top + 'px';
            tooltip.style.left = left + 'px';
            tooltip.classList.add('show');
        }
        
        function hideTooltip() {
            // Add delay to allow moving to tooltip
            state.tooltipTimeout = setTimeout(() => {
                tooltip.classList.remove('show');
            }, 300);
        }
        
        function showTagsTooltip(e, tags) {
            if (state.tooltipTimeout) {
                clearTimeout(state.tooltipTimeout);
                state.tooltipTimeout = null;
            }
            
            const tagsList = tags.map(t => \`<div style="padding: 4px 0; font-family: 'JetBrains Mono', monospace; font-size: 11px;">🏷️ \${t}</div>\`).join('');
            
            tooltip.innerHTML = \`
                <div class="tooltip-header">
                    <div class="tooltip-title">Additional Tags (\${tags.length})</div>
                </div>
                <div style="max-height: 200px; overflow-y: auto;">
                    \${tagsList}
                </div>
            \`;
            
            const rect = tooltip.getBoundingClientRect();
            let top = e.clientY + 15;
            let left = e.clientX + 15;
            
            if (left + rect.width > window.innerWidth) {
                left = window.innerWidth - rect.width - 10;
            }
            if (top + rect.height > window.innerHeight) {
                top = e.clientY - rect.height - 10;
            }
            
            tooltip.style.top = top + 'px';
            tooltip.style.left = left + 'px';
            tooltip.classList.add('show');
        }
        
        // Copy functionality
        window.copyToClipboard = (text) => {
            vscode.postMessage({
                command: 'copyHash',
                hash: text
            });
        };
        
        // Zoom & Pan
        const container = document.getElementById('graph-container');
        const svgElement = document.getElementById('graph-svg');
        
        function applyZoom(newZoom) {
            state.zoom = Math.max(0.2, Math.min(3, newZoom));
            svgElement.style.transform = \`scale(\${state.zoom})\`;
            svgElement.style.transformOrigin = 'top left';
        }
        
        document.getElementById('zoom-in').addEventListener('click', () => applyZoom(state.zoom + 0.1));
        document.getElementById('zoom-out').addEventListener('click', () => applyZoom(state.zoom - 0.1));
        document.getElementById('zoom-reset').addEventListener('click', () => {
            applyZoom(1);
            container.scrollTo(0, 0);
        });
        
        // Pan
        container.addEventListener('mousedown', e => {
            if (e.target.closest('.commit-node') || e.target.closest('.copy-btn') || e.target.closest('button')) return;
            state.isDragging = true;
            state.startX = e.pageX - container.offsetLeft;
            state.startY = e.pageY - container.offsetTop;
            state.scrollLeft = container.scrollLeft;
            state.scrollTop = container.scrollTop;
            container.style.cursor = 'grabbing';
        });
        
        container.addEventListener('mouseleave', () => {
            state.isDragging = false;
            container.style.cursor = 'grab';
        });
        
        container.addEventListener('mouseup', () => {
            state.isDragging = false;
            container.style.cursor = 'grab';
        });
        
        container.addEventListener('mousemove', e => {
            if (!state.isDragging) return;
            e.preventDefault();
            const x = e.pageX - container.offsetLeft;
            const y = e.pageY - container.offsetTop;
            const walkX = (x - state.startX) * 1; 
            const walkY = (y - state.startY) * 1;
            container.scrollLeft = state.scrollLeft - walkX;
            container.scrollTop = state.scrollTop - walkY;
        });

    </script>
</body>
</html>`;
    }
}
