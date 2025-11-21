import * as vscode from 'vscode';
import { GitService } from '../services/gitService';

interface GraphCommit {
    hash: string;
    shortHash: string;
    message: string;
    author: string;
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
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Git Graph</title>
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
            overflow: hidden;
            position: relative;
        }

        #zoom-controls {
            position: fixed;
            top: 20px;
            right: 20px;
            display: flex;
            gap: 10px;
            z-index: 1000;
        }

        .zoom-btn {
            width: 40px;
            height: 40px;
            border: none;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border-radius: 4px;
            cursor: pointer;
            font-size: 20px;
            font-weight: bold;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s;
        }

        .zoom-btn:hover {
            background: var(--vscode-button-hoverBackground);
            transform: scale(1.1);
        }

        .zoom-btn:active {
            transform: scale(0.95);
        }

        #graph-container {
            width: 100%;
            height: 100vh;
            position: relative;
            overflow: auto;
        }

        svg {
            display: block;
        }

        .commit-node {
            cursor: pointer;
            transition: all 0.2s ease;
        }

        .commit-node:hover .commit-circle {
            r: 16;
            stroke-width: 4;
        }

        .commit-circle {
            fill: var(--vscode-button-background);
            stroke: var(--vscode-button-foreground);
            stroke-width: 2.5;
            transition: all 0.2s ease;
        }

        .merge-commit .commit-circle {
            fill: var(--vscode-charts-purple);
            stroke: var(--vscode-charts-purple);
        }

        .current-branch .commit-circle {
            fill: var(--vscode-charts-green);
            stroke: var(--vscode-charts-green);
        }

        .commit-line {
            stroke: var(--vscode-button-foreground);
            stroke-width: 3;
            fill: none;
            opacity: 0.6;
        }

        .merge-line {
            stroke: var(--vscode-charts-purple);
            stroke-width: 3;
            fill: none;
            opacity: 0.6;
            stroke-dasharray: 8,8;
        }

        .arrow {
            fill: var(--vscode-button-foreground);
            opacity: 0.6;
        }

        .commit-info {
            font-size: 15px;
            pointer-events: none;
        }

        .commit-message {
            fill: var(--vscode-editor-foreground);
            font-weight: 600;
            font-size: 15px;
            letter-spacing: 0.3px;
        }

        .commit-meta {
            fill: var(--vscode-descriptionForeground);
            font-size: 13px;
            opacity: 0.9;
        }

        .branch-label {
            fill: var(--vscode-charts-green);
            font-size: 12px;
            font-weight: 700;
        }

        .tag-label {
            fill: var(--vscode-charts-yellow);
            font-size: 12px;
            font-weight: 700;
        }

        .ref-badge {
            fill: var(--vscode-badge-background);
            stroke: none;
            rx: 4;
            opacity: 0.95;
        }

        .ref-text {
            fill: white;
            font-size: 12px;
            font-weight: 700;
            letter-spacing: 0.2px;
            text-shadow: 0 1px 2px rgba(0,0,0,0.3);
        }

        .tooltip {
            position: absolute;
            background: var(--vscode-editorHoverWidget-background);
            border: 1px solid var(--vscode-editorHoverWidget-border);
            padding: 10px;
            border-radius: 4px;
            font-size: 12px;
            pointer-events: none;
            opacity: 0;
            transition: opacity 0.2s;
            max-width: 400px;
            z-index: 1000;
        }

        .tooltip.show {
            opacity: 1;
        }

        .tooltip-title {
            font-weight: bold;
            margin-bottom: 5px;
            color: var(--vscode-editor-foreground);
        }

        .tooltip-detail {
            color: var(--vscode-descriptionForeground);
            margin: 2px 0;
        }
    </style>
</head>
<body>
    <div id="zoom-controls">
        <button class="zoom-btn" id="zoom-in" title="Zoom In">+</button>
        <button class="zoom-btn" id="zoom-reset" title="Reset Zoom">⟲</button>
        <button class="zoom-btn" id="zoom-out" title="Zoom Out">−</button>
    </div>
    <div id="graph-container">
        <svg id="graph-svg"></svg>
    </div>
    <div id="tooltip" class="tooltip"></div>

    <script>
        const vscode = acquireVsCodeApi();
        const commits = ${JSON.stringify(commits)};
        
        // Constants (circle size reduced by 20%)
        const COMMIT_RADIUS = 13;
        const VERTICAL_SPACING = 120;
        const HORIZONTAL_SPACING = 150;
        const LABEL_OFFSET = 30; // Closer to the circle
        
        // Create commit position map - simple and clean algorithm
        const commitPositions = new Map();
        const commitLanes = new Map();
        let maxLane = 0;
        let nextLane = 0;
        
        // Create a set of all commit hashes for quick lookup
        const commitHashSet = new Set(commits.map(c => c.hash));
        
        // First pass: assign lanes
        commits.forEach((commit, index) => {
            let lane;
            
            // If this commit was pre-assigned a lane (as a parent), use it
            if (commitLanes.has(commit.hash)) {
                lane = commitLanes.get(commit.hash);
            } else {
                // Not pre-assigned, use next available lane
                lane = nextLane++;
            }
            
            // Update lane for this commit
            commitLanes.set(commit.hash, lane);
            
            // Track max
            if (lane > maxLane) {
                maxLane = lane;
            }
            
            // Pre-assign lanes for parents ONLY if they're in the visible commit list
            if (commit.parents.length > 0) {
                // First parent continues in same lane (straight down)
                const firstParent = commit.parents[0];
                if (commitHashSet.has(firstParent) && !commitLanes.has(firstParent)) {
                    commitLanes.set(firstParent, lane);
                }
                
                // Additional parents get new lanes (merge branches)
                for (let i = 1; i < commit.parents.length; i++) {
                    const parent = commit.parents[i];
                    if (commitHashSet.has(parent) && !commitLanes.has(parent)) {
                        const newLane = nextLane++;
                        commitLanes.set(parent, newLane);
                        if (newLane > maxLane) {
                            maxLane = newLane;
                        }
                    }
                }
            }
        });
        
        // Second pass: create positions
        commits.forEach((commit, index) => {
            const y = index * VERTICAL_SPACING + 50;
            const lane = commitLanes.get(commit.hash);
            const x = lane * HORIZONTAL_SPACING + 50;
            commitPositions.set(commit.hash, { x, y, lane });
        });
        
        // Create SVG
        const svg = document.getElementById('graph-svg');
        const width = (maxLane + 1) * HORIZONTAL_SPACING + LABEL_OFFSET + 1500; // More space for text
        const height = commits.length * VERTICAL_SPACING + 100;
        svg.setAttribute('width', width);
        svg.setAttribute('height', height);
        svg.setAttribute('viewBox', \`0 0 \${width} \${height}\`);
        
        // Draw lines first (so they appear behind circles)
        commits.forEach(commit => {
            const pos = commitPositions.get(commit.hash);
            if (!pos) return;
            
            commit.parents.forEach((parentHash, idx) => {
                const parentPos = commitPositions.get(parentHash);
                if (!parentPos) return;
                
                const isMerge = commit.parents.length > 1 && idx > 0;
                const lineClass = isMerge ? 'merge-line' : 'commit-line';
                
                // Draw line
                const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                const path = \`M \${pos.x} \${pos.y} L \${parentPos.x} \${parentPos.y}\`;
                line.setAttribute('d', path);
                line.setAttribute('class', lineClass);
                svg.appendChild(line);
                
                // Draw arrow
                const angle = Math.atan2(parentPos.y - pos.y, parentPos.x - pos.x);
                const arrowSize = 8;
                const arrowX = parentPos.x - Math.cos(angle) * (COMMIT_RADIUS + 2);
                const arrowY = parentPos.y - Math.sin(angle) * (COMMIT_RADIUS + 2);
                
                const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
                const points = [
                    [arrowX, arrowY],
                    [arrowX - arrowSize * Math.cos(angle - Math.PI / 6), arrowY - arrowSize * Math.sin(angle - Math.PI / 6)],
                    [arrowX - arrowSize * Math.cos(angle + Math.PI / 6), arrowY - arrowSize * Math.sin(angle + Math.PI / 6)]
                ].map(p => p.join(',')).join(' ');
                arrow.setAttribute('points', points);
                arrow.setAttribute('class', 'arrow');
                svg.appendChild(arrow);
            });
        });
        
        // Draw commits
        commits.forEach(commit => {
            const pos = commitPositions.get(commit.hash);
            if (!pos) return;
            
            const isMerge = commit.parents.length > 1;
            const isCurrentBranch = commit.branches.some(b => b.includes('HEAD'));
            
            // Create group for commit
            const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            g.setAttribute('class', \`commit-node \${isMerge ? 'merge-commit' : ''} \${isCurrentBranch ? 'current-branch' : ''}\`);
            g.setAttribute('data-hash', commit.hash);
            
            // Draw circle
            const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('cx', pos.x);
            circle.setAttribute('cy', pos.y);
            circle.setAttribute('r', COMMIT_RADIUS);
            circle.setAttribute('class', 'commit-circle');
            g.appendChild(circle);
            
            // Line 1: Draw branches at the top
            let badgeX = pos.x + LABEL_OFFSET;
            const branchY = pos.y - 30;
            
            commit.branches.forEach(branch => {
                const text = branch.replace('HEAD -> ', '→ ');
                const textWidth = text.length * 7.5 + 16;
                
                const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                rect.setAttribute('x', badgeX);
                rect.setAttribute('y', branchY - 10);
                rect.setAttribute('width', textWidth);
                rect.setAttribute('height', 22);
                rect.setAttribute('class', 'ref-badge');
                rect.style.fill = '#22863a';
                rect.style.stroke = '#28a745';
                rect.style.strokeWidth = '1.5';
                g.appendChild(rect);
                
                const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                label.setAttribute('x', badgeX + 8);
                label.setAttribute('y', branchY + 5);
                label.setAttribute('class', 'ref-text');
                label.textContent = text;
                g.appendChild(label);
                
                badgeX += textWidth + 10;
            });
            
            // Line 2: Draw commit message
            const message = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            message.setAttribute('x', pos.x + LABEL_OFFSET);
            message.setAttribute('y', pos.y);
            message.setAttribute('class', 'commit-message');
            message.setAttribute('dominant-baseline', 'middle');
            message.textContent = commit.message.length > 65 ? commit.message.substring(0, 65) + '...' : commit.message;
            g.appendChild(message);
            
            // Line 3: Draw meta info (commit ID, author, date)
            const meta = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            meta.setAttribute('x', pos.x + LABEL_OFFSET);
            meta.setAttribute('y', pos.y + 18);
            meta.setAttribute('class', 'commit-meta');
            meta.setAttribute('dominant-baseline', 'middle');
            meta.textContent = \`\${commit.shortHash} • \${commit.author} • \${commit.date}\`;
            g.appendChild(meta);
            
            // Line 4: Draw tags (max 3, then "..." button)
            const maxVisibleTags = 3;
            const visibleTags = commit.tags.slice(0, maxVisibleTags);
            const hasMoreTags = commit.tags.length > maxVisibleTags;
            
            let tagX = pos.x + LABEL_OFFSET;
            const tagY = pos.y + 38;
            
            visibleTags.forEach(tag => {
                const textWidth = tag.length * 7.5 + 16;
                
                const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                rect.setAttribute('x', tagX);
                rect.setAttribute('y', tagY - 10);
                rect.setAttribute('width', textWidth);
                rect.setAttribute('height', 22);
                rect.setAttribute('class', 'ref-badge');
                rect.style.fill = '#b08800';
                rect.style.stroke = '#ffd700';
                rect.style.strokeWidth = '1.5';
                g.appendChild(rect);
                
                const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                label.setAttribute('x', tagX + 8);
                label.setAttribute('y', tagY + 5);
                label.setAttribute('class', 'ref-text');
                label.textContent = tag;
                g.appendChild(label);
                
                tagX += textWidth + 10;
            });
            
            // Add "..." button if there are more tags
            if (hasMoreTags) {
                const moreWidth = 40;
                
                const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                rect.setAttribute('x', tagX);
                rect.setAttribute('y', tagY - 10);
                rect.setAttribute('width', moreWidth);
                rect.setAttribute('height', 22);
                rect.setAttribute('class', 'ref-badge more-tags-btn');
                rect.style.fill = '#555';
                rect.style.stroke = '#888';
                rect.style.strokeWidth = '1.5';
                rect.style.cursor = 'pointer';
                g.appendChild(rect);
                
                const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                label.setAttribute('x', tagX + 12);
                label.setAttribute('y', tagY + 5);
                label.setAttribute('class', 'ref-text');
                label.style.cursor = 'pointer';
                label.textContent = '...';
                g.appendChild(label);
                
                // Add click handler to show all tags
                const commitTags = commit.tags;
                const showAllTags = () => {
                    const allTagsText = commitTags.join(', ');
                    alert('All tags (' + commitTags.length + '):\\n\\n' + allTagsText);
                };
                rect.addEventListener('click', showAllTags);
                label.addEventListener('click', showAllTags);
            }
            
            // Add tooltip on hover
            g.addEventListener('mouseenter', (e) => showTooltip(e, commit, pos));
            g.addEventListener('mouseleave', hideTooltip);
            
            // Add click handler to show commit details
            g.style.cursor = 'pointer';
            g.addEventListener('click', () => {
                // Send message to VS Code to show commit details
                vscode.postMessage({
                    command: 'showCommitDetails',
                    commitHash: commit.hash
                });
            });
            
            svg.appendChild(g);
        });
        
        // Tooltip functions
        const tooltip = document.getElementById('tooltip');
        
        function showTooltip(e, commit, pos) {
            tooltip.innerHTML = \`
                <div class="tooltip-title">\${commit.message}</div>
                <div class="tooltip-detail">Commit: \${commit.hash}</div>
                <div class="tooltip-detail">Author: \${commit.author}</div>
                <div class="tooltip-detail">Date: \${commit.date}</div>
                \${commit.parents.length > 0 ? \`<div class="tooltip-detail">Parents: \${commit.parents.map(p => p.substring(0, 7)).join(', ')}</div>\` : ''}
                \${commit.branches.length > 0 ? \`<div class="tooltip-detail">Branches: \${commit.branches.join(', ')}</div>\` : ''}
                \${commit.tags.length > 0 ? \`<div class="tooltip-detail">Tags: \${commit.tags.join(', ')}</div>\` : ''}
            \`;
            tooltip.style.left = (e.pageX + 10) + 'px';
            tooltip.style.top = (e.pageY + 10) + 'px';
            tooltip.classList.add('show');
        }
        
        function hideTooltip() {
            tooltip.classList.remove('show');
        }
        
        // Zoom controls
        let currentZoom = 1;
        const zoomStep = 0.2;
        const minZoom = 0.5;
        const maxZoom = 3;
        
        const container = document.getElementById('graph-container');
        const svgElement = document.getElementById('graph-svg');
        
        function applyZoom(zoom) {
            currentZoom = Math.max(minZoom, Math.min(maxZoom, zoom));
            svgElement.style.transform = \`scale(\${currentZoom})\`;
            svgElement.style.transformOrigin = 'top left';
        }
        
        document.getElementById('zoom-in').addEventListener('click', () => {
            applyZoom(currentZoom + zoomStep);
        });
        
        document.getElementById('zoom-out').addEventListener('click', () => {
            applyZoom(currentZoom - zoomStep);
        });
        
        document.getElementById('zoom-reset').addEventListener('click', () => {
            applyZoom(1);
            container.scrollTop = 0;
            container.scrollLeft = 0;
        });
        
        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey || e.metaKey) {
                if (e.key === '=' || e.key === '+') {
                    e.preventDefault();
                    applyZoom(currentZoom + zoomStep);
                } else if (e.key === '-' || e.key === '_') {
                    e.preventDefault();
                    applyZoom(currentZoom - zoomStep);
                } else if (e.key === '0') {
                    e.preventDefault();
                    applyZoom(1);
                }
            }
        });
    </script>
</body>
</html>`;
    }
}

