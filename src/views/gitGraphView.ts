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

    constructor(
        private context: vscode.ExtensionContext,
        private gitService: GitService
    ) { }

    async show(repoRoot: string): Promise<void> {
        this.currentRepoRoot = repoRoot;

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
                    if (message.command === 'showCommitDetails') {
                        // Get full commit info and show commit details
                        const commitInfo = await this.gitService.getCommitInfo(
                            message.commitHash,
                            this.currentRepoRoot
                        );
                        if (commitInfo) {
                            await vscode.commands.executeCommand(
                                'gitmaster.showRepositoryCommitDetails',
                                commitInfo,
                                this.currentRepoRoot
                            );
                        }
                    } else if (message.command === 'copyHash') {
                        await vscode.env.clipboard.writeText(message.hash);
                        vscode.window.showInformationMessage(`Commit hash copied: ${message.hash}`);
                    }
                },
                undefined,
                this.context.subscriptions
            );
        }

        // Get commit data
        const commits = await this.getGraphCommits(repoRoot);

        // Set webview content
        this.panel.webview.html = this.getWebviewContent(commits);
    }

    private async getGraphCommits(repoRoot: string): Promise<GraphCommit[]> {
        try {
            const commits = await this.gitService.getGraphCommits(repoRoot, 50);
            return commits;
        } catch (error) {
            console.error('Error getting graph commits:', error);
            return [];
        }
    }

    private getWebviewContent(commits: GraphCommit[]): string {
        // Process commits to add avatar URLs
        const processedCommits = commits.map(c => {
            const hash = crypto.createHash('md5').update(c.email ? c.email.trim().toLowerCase() : '').digest('hex');
            return {
                ...c,
                avatarUrl: `https://www.gravatar.com/avatar/${hash}?d=identicon&s=32`
            };
        });

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
        }

        #zoom-controls {
            position: fixed;
            bottom: 20px;
            right: 20px;
            display: flex;
            gap: 8px;
            z-index: 1000;
            background: var(--tooltip-bg);
            padding: 8px;
            border-radius: 12px;
            box-shadow: 0 8px 24px var(--shadow-color);
            border: 1px solid var(--tooltip-border);
            backdrop-filter: blur(10px);
        }

        .zoom-btn {
            width: 36px;
            height: 36px;
            border: none;
            background: transparent;
            color: var(--text-color);
            border-radius: 8px;
            cursor: pointer;
            font-size: 18px;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        }

        .zoom-btn:hover {
            background: var(--hover-bg);
            transform: translateY(-2px);
        }

        #graph-container {
            width: 100%;
            height: 100vh;
            position: relative;
            overflow: auto;
            cursor: grab;
            /* Smooth scrolling */
            scroll-behavior: smooth;
        }

        #graph-container:active {
            cursor: grabbing;
        }

        svg {
            display: block;
        }

        .commit-node {
            cursor: pointer;
            transition: opacity 0.3s ease;
        }

        .commit-circle {
            fill: var(--vscode-gitDecoration-addedResourceForeground);
            stroke: var(--node-stroke);
            stroke-width: 3;
            transition: all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
            filter: drop-shadow(0 4px 6px var(--shadow-color));
        }

        .commit-node:hover .commit-circle {
            r: 10;
            stroke-width: 4;
            filter: drop-shadow(0 0 12px var(--accent-color));
        }

        .merge-commit .commit-circle {
            fill: var(--vscode-gitDecoration-modifiedResourceForeground);
        }

        .current-branch .commit-circle {
            fill: var(--vscode-gitDecoration-untrackedResourceForeground);
            stroke: var(--vscode-gitDecoration-untrackedResourceForeground);
            stroke-width: 0;
        }
        
        .current-branch:hover .commit-circle {
             stroke: var(--node-stroke);
             stroke-width: 3;
        }

        .commit-line {
            stroke: var(--vscode-editor-foreground);
            stroke-width: 2;
            fill: none;
            opacity: 0.4;
            stroke-linecap: round;
            stroke-linejoin: round;
            filter: drop-shadow(0 2px 4px rgba(0,0,0,0.1));
        }

        .merge-line {
            stroke: var(--vscode-gitDecoration-modifiedResourceForeground);
            stroke-width: 2;
            fill: none;
            opacity: 0.4;
            stroke-dasharray: 4,4;
        }

        .arrow {
            fill: var(--vscode-editor-foreground);
            opacity: 0.4;
        }

        .commit-message {
            fill: var(--text-color);
            font-weight: 600;
            font-size: 14px;
            opacity: 0.95;
            transition: fill 0.2s;
            font-family: 'Segoe UI', sans-serif;
        }
        
        .commit-node:hover .commit-message {
            fill: var(--accent-color);
        }

        .commit-meta {
            fill: var(--vscode-descriptionForeground);
            font-size: 12px;
            opacity: 0.7;
        }
        
        .commit-hash {
            font-family: 'Consolas', 'Courier New', monospace;
            cursor: pointer;
            fill: var(--vscode-textLink-foreground);
            text-decoration: underline;
            opacity: 0.8;
        }
        
        .commit-hash:hover {
            opacity: 1;
            font-weight: bold;
        }

        /* Badges */
        .ref-badge {
            rx: 6;
            opacity: 1;
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

        /* Tooltip */
        .tooltip {
            position: absolute;
            background: var(--tooltip-bg);
            border: 1px solid var(--tooltip-border);
            padding: 16px;
            border-radius: 12px;
            font-size: 13px;
            pointer-events: none;
            opacity: 0;
            transition: opacity 0.2s, transform 0.2s;
            max-width: 400px;
            z-index: 1000;
            box-shadow: 0 12px 32px var(--shadow-color);
            transform: translateY(10px);
            backdrop-filter: blur(12px);
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

        /* Animations */
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
        }
        
        .animate-in {
            animation: fadeIn 0.5s cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
        }
    </style>
</head>
<body>
    <div id="graph-container">
        <svg id="graph-svg"></svg>
    </div>
    
    <div id="zoom-controls">
        <button class="zoom-btn" id="zoom-in" title="Zoom In">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 4a.5.5 0 0 1 .5.5v3h3a.5.5 0 0 1 0 1h-3v3a.5.5 0 0 1-1 0v-3h-3a.5.5 0 0 1 0-1h3v-3A.5.5 0 0 1 8 4z"/></svg>
        </button>
        <button class="zoom-btn" id="zoom-reset" title="Reset Zoom">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2v1z"/><path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466z"/></svg>
        </button>
        <button class="zoom-btn" id="zoom-out" title="Zoom Out">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M4 8a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1h-7A.5.5 0 0 1 4 8z"/></svg>
        </button>
    </div>

    <div id="tooltip" class="tooltip"></div>

    <script>
        const vscode = acquireVsCodeApi();
        const commits = ${JSON.stringify(processedCommits)};
        
        // Configuration
        const CONFIG = {
            RADIUS: 7,
            V_SPACING: 100,
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

        // Logic to layout graph
        const commitPositions = new Map();
        const commitLanes = new Map();
        let maxLane = 0;
        let nextLane = 0;
        const commitHashSet = new Set(commits.map(c => c.hash));
        
        // Assign lanes
        commits.forEach((commit) => {
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
        commits.forEach((commit, index) => {
            const y = index * CONFIG.V_SPACING + 60;
            const lane = commitLanes.get(commit.hash);
            const x = lane * CONFIG.H_SPACING + 30;
            commitPositions.set(commit.hash, { x, y, lane });
        });
        
        // Calculate dynamic width based on max text length estimation
        // This is a heuristic, but better than fixed width
        let maxTextWidth = 0;
        commits.forEach(commit => {
            let width = commit.message.length * 8; // Approx char width
            // Add branches/tags width
            commit.branches.forEach(b => width += b.length * 8 + 20);
            commit.tags.forEach(t => width += t.length * 8 + 20);
            if (width > maxTextWidth) maxTextWidth = width;
        });
        
        // Render
        const svg = document.getElementById('graph-svg');
        const graphWidth = (maxLane + 1) * CONFIG.H_SPACING + 100;
        const totalWidth = Math.max(graphWidth + maxTextWidth + 200, window.innerWidth * 1.5); // Ensure enough space
        const height = commits.length * CONFIG.V_SPACING + 150;
        
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
        commits.forEach((commit, i) => {
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
                path.style.animationDelay = \`\${i * 0.01}s\`;
                path.classList.add('animate-in');
                svg.appendChild(path);
            });
        });
        
        // Draw nodes and text
        commits.forEach((commit, i) => {
            const pos = commitPositions.get(commit.hash);
            if (!pos) return;
            
            const isMerge = commit.parents.length > 1;
            const isCurrentBranch = commit.branches.some(b => b.includes('HEAD'));
            const color = getLaneColor(pos.lane);
            
            const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            g.setAttribute('class', \`commit-node \${isMerge ? 'merge-commit' : ''} \${isCurrentBranch ? 'current-branch' : ''}\`);
            g.setAttribute('data-hash', commit.hash);
            g.style.animationDelay = \`\${i * 0.01}s\`;
            g.classList.add('animate-in');
            
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
            
            // --- Layout: Stacked ---
            
            // 1. Branches (Top)
            let currentY = pos.y - 30; // Start above the node
            let currentX = textX;
            
            if (commit.branches.length > 0) {
                commit.branches.forEach(branch => {
                    const text = branch.replace('HEAD -> ', '→ ');
                    const textWidth = text.length * 7 + 16;
                    
                    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                    rect.setAttribute('x', currentX);
                    rect.setAttribute('y', currentY);
                    rect.setAttribute('width', textWidth);
                    rect.setAttribute('height', 20);
                    rect.setAttribute('class', 'ref-badge');
                    rect.style.fill = 'url(#branchGradient)';
                    g.appendChild(rect);
                    
                    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                    label.setAttribute('x', currentX + 8);
                    label.setAttribute('y', currentY + 14);
                    label.setAttribute('class', 'ref-text');
                    label.textContent = text;
                    g.appendChild(label);
                    
                    currentX += textWidth + 8;
                });
                currentY += 24; // Move down for message
            } else {
                currentY += 12; // Adjust if no branches
            }
            
            // 2. Message (Middle)
            const message = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            message.setAttribute('x', textX);
            message.setAttribute('y', pos.y + 5); // Centered vertically relative to node
            message.setAttribute('class', 'commit-message');
            message.textContent = commit.message;
            g.appendChild(message);
            
            // Check for Merge Source
            const mergeMatch = commit.message.match(/^Merge branch '([^']+)'/);
            if (mergeMatch) {
                const mergedBranch = mergeMatch[1];
                const badgeWidth = mergedBranch.length * 7 + 16;
                const badgeX = textX + (commit.message.length * 8) + 20; // Approximate position after message
                
                // Draw a "Merged from" badge
                const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                rect.setAttribute('x', badgeX);
                rect.setAttribute('y', pos.y - 10);
                rect.setAttribute('width', badgeWidth);
                rect.setAttribute('height', 20);
                rect.setAttribute('rx', 4);
                rect.setAttribute('class', 'ref-badge');
                rect.setAttribute('fill', 'url(#mergeGradient)');
                g.appendChild(rect);
                
                const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                label.setAttribute('x', badgeX + 8);
                label.setAttribute('y', pos.y + 4);
                label.setAttribute('fill', 'white');
                label.setAttribute('font-size', '11px');
                label.setAttribute('font-weight', 'bold');
                label.textContent = 'from ' + mergedBranch;
                label.style.pointerEvents = 'none';
                g.appendChild(label);
            }
            
            // 3. Meta (Below Message)
            const meta = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            meta.setAttribute('x', textX);
            meta.setAttribute('y', pos.y + 25);
            meta.setAttribute('class', 'commit-meta');
            
            // Avatar
            const avatarSize = 16;
            const avatar = document.createElementNS('http://www.w3.org/2000/svg', 'image');
            avatar.setAttribute('x', textX);
            avatar.setAttribute('y', pos.y + 14);
            avatar.setAttribute('width', avatarSize);
            avatar.setAttribute('height', avatarSize);
            avatar.setAttribute('href', commit.avatarUrl);
            avatar.setAttribute('style', 'clip-path: circle(50%);');
            g.appendChild(avatar);

            const hashSpan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
            hashSpan.textContent = commit.shortHash;
            hashSpan.setAttribute('class', 'commit-hash');
            hashSpan.setAttribute('dx', avatarSize + 6); // Offset for avatar
            hashSpan.addEventListener('click', (e) => {
                e.stopPropagation();
                copyToClipboard(commit.hash);
            });
            meta.appendChild(hashSpan);
            
            const otherMeta = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
            otherMeta.textContent = \` • \${commit.author} • \${commit.date}\`;
            meta.appendChild(otherMeta);
            g.appendChild(meta);
            
            // 4. Tags (Bottom)
            if (commit.tags.length > 0) {
                let tagX = textX;
                let tagY = pos.y + 45;
                
                const maxVisibleTags = 3;
                const visibleTags = commit.tags.slice(0, maxVisibleTags);
                const hasMoreTags = commit.tags.length > maxVisibleTags;
                
                visibleTags.forEach(tag => {
                    const textWidth = tag.length * 7 + 16;
                    
                    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                    rect.setAttribute('x', tagX);
                    rect.setAttribute('y', tagY);
                    rect.setAttribute('width', textWidth);
                    rect.setAttribute('height', 20);
                    rect.setAttribute('class', 'ref-badge');
                    rect.style.fill = 'url(#tagGradient)';
                    g.appendChild(rect);
                    
                    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                    label.setAttribute('x', tagX + 8);
                    label.setAttribute('y', tagY + 14);
                    label.setAttribute('class', 'ref-text tag-text');
                    label.textContent = tag;
                    g.appendChild(label);
                    
                    tagX += textWidth + 8;
                });
                
                if (hasMoreTags) {
                    const moreWidth = 36;
                    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                    rect.setAttribute('x', tagX);
                    rect.setAttribute('y', tagY);
                    rect.setAttribute('width', moreWidth);
                    rect.setAttribute('height', 20);
                    rect.setAttribute('class', 'ref-badge more-tags-btn');
                    rect.style.fill = '#555';
                    rect.addEventListener('click', (e) => {
                        e.stopPropagation();
                        alert('Tags: ' + commit.tags.join(', '));
                    });
                    g.appendChild(rect);
                    
                    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                    label.setAttribute('x', tagX + 8);
                    label.setAttribute('y', tagY + 12);
                    label.setAttribute('class', 'ref-text');
                    label.textContent = '...';
                    label.style.pointerEvents = 'none';
                    g.appendChild(label);
                }
            }
            
            // Interaction
            g.addEventListener('mouseenter', (e) => showTooltip(e, commit));
            g.addEventListener('mouseleave', hideTooltip);
            g.addEventListener('click', () => {
                vscode.postMessage({
                    command: 'showCommitDetails',
                    commitHash: commit.hash
                });
            });
            
            svg.appendChild(g);
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
            if (e.target.closest('.commit-node') || e.target.closest('.copy-btn')) return;
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

