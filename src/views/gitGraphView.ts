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
            }

            const interestingBranches = branches.filter(b => {
                // Always show current branch
                if (b.isCurrent) {
                    return true;
                }

                // Always show default/main/master
                if (defaults.has(b.name)) {
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
            await vscode.commands.executeCommand('gitmaster.showRepositoryCommitDetails', commitInfo, this.currentRepoRoot);
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
            --shadow-color: rgba(0, 0, 0, 0.25);
            --node-stroke: var(--vscode-editor-background);
            
            /* Gradients & Colors */
            --branch-gradient: linear-gradient(135deg, #2e7d32 0%, #1b5e20 100%);
            --tag-gradient: linear-gradient(135deg, #f9a825 0%, #f57f17 100%);
            --merge-gradient: linear-gradient(135deg, #6a1b9a 0%, #4a148c 100%);
            --tag-text: #000;
            --head-color: #007acc;
        }

        /* Light mode overrides */
        @media (prefers-color-scheme: light) {
            :root {
                --shadow-color: rgba(0, 0, 0, 0.15);
                --node-stroke: #ffffff;
                --tag-text: #333;
                --branch-gradient: linear-gradient(135deg, #4caf50 0%, #2e7d32 100%);
                --tag-gradient: linear-gradient(135deg, #fbc02d 0%, #f9a825 100%);
                --merge-gradient: linear-gradient(135deg, #8e24aa 0%, #6a1b9a 100%);
            }
        }

        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: var(--bg-color);
            color: var(--text-color);
            overflow: hidden;
            position: relative;
            /* Subtle Pattern */
            background-image: radial-gradient(var(--line-color) 1px, transparent 1px);
            background-size: 30px 30px;
        }

        #zoom-controls {
            position: fixed;
            bottom: 30px;
            right: 30px;
            display: flex;
            flex-direction: column;
            gap: 12px;
            z-index: 1000;
        }

        .zoom-btn {
            width: 44px;
            height: 44px;
            border: none;
            background: var(--tooltip-bg);
            color: var(--text-color);
            border-radius: 50%;
            cursor: pointer;
            font-size: 18px;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            box-shadow: 0 8px 24px var(--shadow-color);
            border: 1px solid var(--tooltip-border);
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
        }

        .zoom-btn:hover {
            background: var(--hover-bg);
            transform: scale(1.1) translateY(-2px);
            color: var(--accent-color);
            box-shadow: 0 12px 32px var(--shadow-color);
        }

        .zoom-btn:active {
            transform: scale(0.95);
        }
        
        /* Special Jump to HEAD button */
        #jump-head-btn {
            color: var(--head-color);
            margin-bottom: 8px;
        }
        
        #jump-head-btn:hover {
            color: #fff;
            background: var(--head-color);
        }

        #graph-container {
            width: 100%;
            height: 100vh;
            position: relative;
            overflow: auto;
            cursor: grab;
            scroll-behavior: smooth;
            padding-bottom: 100px; /* Space for infinite scroll trigger */
        }

        #graph-container:active {
            cursor: grabbing;
        }

        svg {
            display: block;
        }

            /* Modern Glow Effects */
            .commit-node {
                cursor: pointer;
                transition: all 0.3s ease;
            }

            .commit-circle {
                fill: var(--vscode-gitDecoration-addedResourceForeground);
                stroke: var(--node-stroke);
                stroke-width: 2;
                transition: all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
                filter: drop-shadow(0 2px 4px var(--shadow-color));
            }

            .commit-node:hover .commit-circle {
                r: 10;
                stroke-width: 3;
                filter: drop-shadow(0 0 12px var(--accent-color));
            }

            /* Row Highlight Effect */
            .commit-row-bg {
                fill: transparent;
                transition: fill 0.2s;
            }
            
            .commit-node:hover .commit-row-bg {
                fill: var(--hover-bg);
                fill-opacity: 0.4;
            }

        /* HEAD Pulse Animation */
        @keyframes headPulse {
            0% { r: 7; stroke-opacity: 1; stroke-width: 0; }
            50% { r: 14; stroke-opacity: 0.4; stroke-width: 4; }
            100% { r: 18; stroke-opacity: 0; stroke-width: 8; }
        }

        .head-indicator {
            fill: none;
            stroke: var(--head-color);
            stroke-width: 2;
            pointer-events: none;
            animation: headPulse 2s infinite;
        }

        .merge-commit .commit-circle {
            fill: var(--vscode-gitDecoration-modifiedResourceForeground);
        }

        .current-branch .commit-circle {
            fill: var(--head-color);
            stroke: var(--node-stroke);
            stroke-width: 3;
        }
        
        .current-branch:hover .commit-circle {
             stroke: var(--node-stroke);
             stroke-width: 4;
             filter: drop-shadow(0 0 20px var(--head-color));
        }

        .commit-line {
            stroke: var(--vscode-editor-foreground);
            stroke-width: 2;
            fill: none;
            opacity: 0.3;
            stroke-linecap: round;
            stroke-linejoin: round;
        }

        .merge-line {
            stroke: var(--vscode-gitDecoration-modifiedResourceForeground);
            stroke-width: 2;
            fill: none;
            opacity: 0.3;
            stroke-dasharray: 4,4;
        }

        .commit-message {
            fill: var(--text-color);
            font-weight: 600;
            font-size: 14px;
            opacity: 0.9;
            transition: fill 0.2s, transform 0.2s;
            font-family: 'Segoe UI', sans-serif;
        }
        
        .commit-node:hover .commit-message {
            fill: var(--accent-color);
            opacity: 1;
            transform: translateX(4px);
        }

        .commit-meta {
            fill: var(--vscode-descriptionForeground);
            font-size: 12px;
            opacity: 0.6;
        }
        
        .commit-hash {
            font-family: 'Consolas', 'Courier New', monospace;
            cursor: pointer;
            fill: var(--vscode-textLink-foreground);
            text-decoration: none;
            opacity: 0.7;
            font-weight: 500;
        }
        
        .commit-hash:hover {
            opacity: 1;
            text-decoration: underline;
        }

        /* Badges - Modernized */
        .ref-badge {
            rx: 4;
            opacity: 0.9;
            filter: drop-shadow(0 2px 4px var(--shadow-color));
            cursor: default;
        }

        .ref-text {
            fill: white;
            font-size: 11px;
            font-weight: 600;
            text-shadow: 0 1px 2px rgba(0,0,0,0.3);
            pointer-events: none;
            font-family: 'Segoe UI', sans-serif;
        }
        
        .tag-text {
            fill: var(--tag-text);
            text-shadow: none;
        }
        
        .more-tags-btn {
            cursor: pointer;
            transition: opacity 0.2s;
        }
        
        .more-tags-btn:hover {
            opacity: 0.8;
        }

        /* Glassmorphism Tooltip */
        .tooltip {
            position: absolute;
            background: rgba(30, 30, 30, 0.85);
            border: 1px solid rgba(255, 255, 255, 0.1);
            padding: 16px;
            border-radius: 16px;
            font-size: 13px;
            pointer-events: none;
            opacity: 0;
            transition: opacity 0.2s, transform 0.2s;
            max-width: 400px;
            z-index: 2000;
            box-shadow: 0 16px 40px rgba(0, 0, 0, 0.4);
            transform: translateY(10px);
            backdrop-filter: blur(20px);
            -webkit-backdrop-filter: blur(20px);
        }
        
        @media (prefers-color-scheme: light) {
            .tooltip {
                background: rgba(255, 255, 255, 0.85);
                border: 1px solid rgba(0, 0, 0, 0.1);
            }
        }

        .tooltip.show {
            opacity: 1;
            transform: translateY(0);
            pointer-events: auto;
        }

        .tooltip-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 12px;
            gap: 10px;
            border-bottom: 1px solid var(--line-color);
            padding-bottom: 8px;
        }

        .tooltip-title {
            font-weight: 600;
            color: var(--text-color);
            line-height: 1.4;
            font-size: 14px;
        }

        .tooltip-row {
            display: flex;
            margin: 6px 0;
            color: var(--vscode-descriptionForeground);
            font-size: 12px;
            align-items: baseline;
        }
        
        .tooltip-label {
            min-width: 70px;
            opacity: 0.8;
            font-weight: 500;
        }
        
        .tooltip-value {
            flex: 1;
            word-break: break-all;
            font-family: 'Consolas', monospace;
        }

        .copy-btn {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: none;
            border-radius: 6px;
            padding: 6px 12px;
            font-size: 12px;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 6px;
            transition: all 0.2s;
            white-space: nowrap;
            font-weight: 500;
            margin-top: 8px;
        }

        .copy-btn:hover {
            background: var(--vscode-button-secondaryHoverBackground);
            transform: translateY(-1px);
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

        /* Loading Indicator */
        #loading-indicator {
            position: fixed;
            bottom: 30px;
            left: 50%;
            transform: translateX(-50%);
            background: var(--tooltip-bg);
            color: var(--text-color);
            padding: 10px 20px;
            border-radius: 20px;
            font-size: 14px;
            box-shadow: 0 4px 12px var(--shadow-color);
            display: none;
            align-items: center;
            gap: 10px;
            z-index: 100;
            border: 1px solid var(--tooltip-border);
            backdrop-filter: blur(10px);
        }
        
        .spinner {
            width: 16px;
            height: 16px;
            border: 2px solid var(--text-color);
            border-top: 2px solid transparent;
            border-radius: 50%;
            animation: spin 1s linear infinite;
        }
        
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }

        /* Animations */
        @keyframes fadeInUp {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
        }
        
        .animate-in {
            animation: fadeInUp 0.6s cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
        }
    </style>
</head>
<body>
    <div id="graph-container">
        <svg id="graph-svg"></svg>
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
            
            // Assign lanes
            commitsToRender.forEach((commit) => {
                // Check for HEAD
                if (commit.branches.some(b => b.includes('HEAD'))) {
                    headHash = commit.hash;
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
            const graphWidth = (maxLane + 1) * CONFIG.H_SPACING + 100;
            const totalWidth = Math.max(graphWidth + maxTextWidth + 200, window.innerWidth * 1.5);
            const height = currentY + 150;
            
            // Clear existing svg content
            svg.innerHTML = '';
            
            svg.setAttribute('width', totalWidth);
            svg.setAttribute('height', height);
            
            // Add Gradients
            const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
            defs.innerHTML = \`
                <linearGradient id="branchGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" style="stop-color:#2e7d32;stop-opacity:1" />
                    <stop offset="100%" style="stop-color:#1b5e20;stop-opacity:1" />
                </linearGradient>
                <linearGradient id="tagGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" style="stop-color:#f9a825;stop-opacity:1" />
                    <stop offset="100%" style="stop-color:#f57f17;stop-opacity:1" />
                </linearGradient>
                <linearGradient id="mergeGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" style="stop-color:#6a1b9a;stop-opacity:1" />
                    <stop offset="100%" style="stop-color:#4a148c;stop-opacity:1" />
                </linearGradient>
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
                const isCurrentBranch = commit.branches.some(b => b.includes('HEAD'));
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
                
                // HEAD Pulse Ring
                if (isCurrentBranch) {
                    const pulse = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                    pulse.setAttribute('cx', pos.x);
                    pulse.setAttribute('cy', pos.y);
                    pulse.setAttribute('r', CONFIG.RADIUS + 10);
                    pulse.setAttribute('class', 'head-indicator');
                    g.appendChild(pulse);
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
                
                if (commit.branches.length > 0) {
                    commit.branches.forEach(branch => {
                        const text = branch.replace('HEAD -> ', '→ ');
                        const textWidth = text.length * 7 + 20;
                        
                        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                        rect.setAttribute('x', currentX);
                        rect.setAttribute('y', currentY);
                        rect.setAttribute('width', textWidth);
                        rect.setAttribute('height', 18);
                        rect.setAttribute('rx', 3);
                        rect.setAttribute('class', 'ref-badge');
                        rect.style.fill = 'url(#branchGradient)';
                        g.appendChild(rect);
                        
                        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                        label.setAttribute('x', currentX + 8);
                        label.setAttribute('y', currentY + 12);
                        label.setAttribute('class', 'ref-text');
                        label.style.fontWeight = 'bold';
                        label.textContent = text;
                        g.appendChild(label);
                        
                        currentX += textWidth + 8;
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
                
                // Merge Badge (Inline with message)
                const mergeMatch = commit.message.match(/^Merge branch '([^']+)'/);
                if (mergeMatch) {
                    const mergedBranch = mergeMatch[1];
                    const badgeWidth = mergedBranch.length * 7 + 16;
                    const badgeX = textX + (commit.message.length * 8.5) + 10; 
                    
                    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                    rect.setAttribute('x', badgeX);
                    rect.setAttribute('y', messageY - 14);
                    rect.setAttribute('width', badgeWidth);
                    rect.setAttribute('height', 18);
                    rect.setAttribute('rx', 4);
                    rect.setAttribute('class', 'ref-badge');
                    rect.setAttribute('fill', 'url(#mergeGradient)');
                    g.appendChild(rect);
                    
                    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                    label.setAttribute('x', badgeX + 8);
                    label.setAttribute('y', messageY - 1);
                    label.setAttribute('fill', 'white');
                    label.setAttribute('font-size', '10px');
                    label.setAttribute('font-weight', 'bold');
                    label.textContent = 'from ' + mergedBranch;
                    label.style.pointerEvents = 'none';
                    g.appendChild(label);
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
                    
                    const maxVisibleTags = 4;
                    const visibleTags = commit.tags.slice(0, maxVisibleTags);
                    const hasMoreTags = commit.tags.length > maxVisibleTags;
                    
                    visibleTags.forEach(tag => {
                        const textWidth = tag.length * 6 + 16;
                        
                        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                        rect.setAttribute('x', tagX);
                        rect.setAttribute('y', tagY);
                        rect.setAttribute('width', textWidth);
                        rect.setAttribute('height', 18);
                        rect.setAttribute('rx', 3);
                        rect.setAttribute('class', 'ref-badge');
                        rect.style.fill = 'url(#tagGradient)';
                        g.appendChild(rect);
                        
                        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                        label.setAttribute('x', tagX + 8);
                        label.setAttribute('y', tagY + 12);
                        label.setAttribute('class', 'ref-text tag-text');
                        label.textContent = tag;
                        g.appendChild(label);
                        
                        tagX += textWidth + 6;
                    });
                    
                    if (hasMoreTags) {
                        const moreWidth = 28;
                        const remainingTags = commit.tags.slice(maxVisibleTags);
                        
                        const grp = document.createElementNS('http://www.w3.org/2000/svg', 'g');
                        grp.style.cursor = 'pointer';
                        
                        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                        rect.setAttribute('x', tagX);
                        rect.setAttribute('y', tagY);
                        rect.setAttribute('width', moreWidth);
                        rect.setAttribute('height', 18);
                        rect.setAttribute('rx', 3);
                        rect.setAttribute('class', 'ref-badge more-tags-btn');
                        rect.style.fill = 'var(--vscode-badge-background)';
                        rect.style.stroke = 'var(--vscode-widget-border)';
                        rect.style.strokeWidth = '1px';
                        grp.appendChild(rect);
                        
                        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                        label.setAttribute('x', tagX + 6);
                        label.setAttribute('y', tagY + 10);
                        label.setAttribute('class', 'ref-text');
                        label.style.fill = 'var(--vscode-badge-foreground)';
                        label.textContent = '...';
                        label.style.pointerEvents = 'none';
                        grp.appendChild(label);

                        grp.addEventListener('mouseenter', (e) => {
                            e.stopPropagation();
                            showTagsTooltip(e, remainingTags);
                        });
                        
                        grp.addEventListener('mouseleave', (e) => {
                            e.stopPropagation();
                            hideTooltip();
                        });
                        
                        g.appendChild(grp);
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
            if (!headHash) {
                // If HEAD not found (maybe deep in history?), try scrolling to top first
                container.scrollTo({ top: 0, behavior: 'smooth' });
                return;
            }
            
            const headElement = document.querySelector(\`.commit-node[data-hash="\${headHash}"]\`);
            if (headElement) {
                // Calculate position to center it
                const rect = headElement.getBoundingClientRect();
                const containerRect = container.getBoundingClientRect();
                
                // Account for current scroll
                const scrollTop = container.scrollTop;
                const absoluteTop = rect.top + scrollTop - containerRect.top;
                
                // Center in view
                const targetScroll = absoluteTop - (containerRect.height / 2) + 50;
                
                container.scrollTo({
                    top: Math.max(0, targetScroll),
                    behavior: 'smooth'
                });
                
                // Flash effect
                headElement.style.opacity = '0.5';
                setTimeout(() => headElement.style.opacity = '1', 150);
                setTimeout(() => headElement.style.opacity = '0.5', 300);
                setTimeout(() => headElement.style.opacity = '1', 450);
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
