import { GitExecutor } from './git/core';
import { GitUtils } from './git/utils';
import { GitSystemService } from './git/system';
import { GitStatusService } from './git/status';
import { GitLogService } from './git/log';
import { GitCommitService } from './git/commit';
import { GitContentService } from './git/content';
import { GitBranchService } from './git/branch';
import { GitRemoteService } from './git/remote';
import { GitStashService } from './git/stash';
import { GitRebaseService } from './git/rebase';
import { GitWorktreeService } from './git/worktree';
import { GitGraphService } from './git/graph';
import { GitContributorsService } from './git/contributors';
import { CommitInfo, ChangedFile, StashInfo, ReflogEntry, RepositoryCommit, BranchInfo, BlameInfo, GitWorktree, RebaseCommit } from '../types/git';

/**
 * Service for interacting with Git repositories
 * Facade pattern implementation aggregating multiple git services
 */
export class GitService {
    private executor: GitExecutor;
    private systemService: GitSystemService;
    private statusService: GitStatusService;
    private logService: GitLogService;
    private commitService: GitCommitService;
    private contentService: GitContentService;
    private branchService: GitBranchService;
    private remoteService: GitRemoteService;
    private stashService: GitStashService;
    private rebaseService: GitRebaseService;
    private worktreeService: GitWorktreeService;
    private graphService: GitGraphService;
    private contributorsService: GitContributorsService;

    constructor() {
        this.executor = new GitExecutor();
        this.systemService = new GitSystemService(this.executor);
        this.statusService = new GitStatusService(this.executor);
        this.logService = new GitLogService(this.executor, this.statusService);
        this.commitService = new GitCommitService(this.executor);
        this.contentService = new GitContentService(this.executor, this.statusService);
        this.branchService = new GitBranchService(this.executor);
        this.remoteService = new GitRemoteService(this.executor, this.statusService, this.branchService);
        this.stashService = new GitStashService(this.executor);
        this.rebaseService = new GitRebaseService(this.executor, this.branchService);
        this.worktreeService = new GitWorktreeService(this.executor);
        this.graphService = new GitGraphService(this.executor);
        this.contributorsService = new GitContributorsService(this.executor, this.statusService);
    }

    // Cache Delegation
    clearCache(): void {
        this.statusService.clearCache();
    }

    // System Service Delegation
    async setupWindowsGit(): Promise<void> {
        return this.systemService.setupWindowsGit();
    }

    async getGitVersion(): Promise<string> {
        return this.systemService.getGitVersion();
    }

    // Status Service Delegation
    async getRepoRoot(filePath: string, options?: { timeoutMs?: number }): Promise<string | null> {
        return this.statusService.getRepoRoot(filePath, options);
    }

    async isFileTracked(filePath: string): Promise<boolean> {
        return this.statusService.isFileTracked(filePath);
    }

    async getCurrentUserName(repoRoot: string): Promise<string | null> {
        return this.statusService.getCurrentUserName(repoRoot);
    }

    // Log Service Delegation
    async getFileHistory(filePath: string, messageFilter?: string): Promise<CommitInfo[]> {
        return this.logService.getFileHistory(filePath, messageFilter);
    }

    async getRepositoryLog(repoRoot: string, limit: number = 20, messageFilter?: string): Promise<RepositoryCommit[]> {
        return this.logService.getRepositoryLog(repoRoot, limit, messageFilter);
    }

    async getReflog(repoRoot: string, limit: number = 50): Promise<ReflogEntry[]> {
        return this.logService.getReflog(repoRoot, limit);
    }

    // Commit Service Delegation
    async getCommitInfo(
        commitHash: string,
        repoRoot: string,
        options?: { timeoutMs?: number }
    ): Promise<CommitInfo | null> {
        return this.commitService.getCommitInfo(commitHash, repoRoot, options);
    }

    async getCommitDiff(commitHash: string, repoRoot: string): Promise<string> {
        return this.commitService.getCommitDiff(commitHash, repoRoot);
    }

    async getParentCommit(commitHash: string, repoRoot: string): Promise<string | null> {
        return this.commitService.getParentCommit(commitHash, repoRoot);
    }

    async getChangedFilesInCommit(
        commitHash: string,
        repoRoot: string,
        options?: { timeoutMs?: number; detectRenames?: boolean }
    ): Promise<ChangedFile[]> {
        return this.commitService.getChangedFilesInCommit(commitHash, repoRoot, options);
    }

    // Content Service Delegation
    async getFileContentAtCommit(relativePath: string, commitHash: string, repoRoot: string): Promise<string> {
        return this.contentService.getFileContentAtCommit(relativePath, commitHash, repoRoot);
    }

    async getBlameForLine(filePath: string, lineNumber: number, commitHash?: string): Promise<BlameInfo | null> {
        return this.contentService.getBlameForLine(filePath, lineNumber, commitHash);
    }

    // Branch Service Delegation
    async checkoutCommit(commitHash: string, repoRoot: string): Promise<void> {
        return this.branchService.checkoutCommit(commitHash, repoRoot);
    }

    async revertCommitInNewBranch(commitHash: string, branchName: string, repoRoot: string): Promise<string> {
        return this.branchService.revertCommitInNewBranch(commitHash, branchName, repoRoot);
    }

    async cherryPickCommit(commitHash: string, repoRoot: string): Promise<void> {
        return this.branchService.cherryPickCommit(commitHash, repoRoot);
    }

    async createBranchFromCommit(branchName: string, commitHash: string, repoRoot: string): Promise<void> {
        return this.branchService.createBranchFromCommit(branchName, commitHash, repoRoot);
    }

    async checkoutBranch(branchName: string, repoRoot: string): Promise<void> {
        return this.branchService.checkoutBranch(branchName, repoRoot);
    }

    async getBranches(repoRoot: string, limit: number = 20): Promise<BranchInfo[]> {
        return this.branchService.getBranches(repoRoot, limit);
    }

    async deleteBranch(branchName: string, repoRoot: string, force: boolean = false): Promise<void> {
        return this.branchService.deleteBranch(branchName, repoRoot, force);
    }

    async getBranchAuthors(repoRoot: string): Promise<string[]> {
        return this.branchService.getBranchAuthors(repoRoot);
    }

    async getDefaultBranch(repoRoot: string): Promise<string | null> {
        return this.branchService.getDefaultBranch(repoRoot);
    }

    async getCurrentBranch(repoRoot: string): Promise<string | null> {
        return this.branchService.getCurrentBranch(repoRoot);
    }

    async getMergeBase(repoRoot: string, branch1: string, branch2: string): Promise<string | null> {
        return this.branchService.getMergeBase(repoRoot, branch1, branch2);
    }

    // Remote Service Delegation
    async getGitHubRepoUrl(repoRoot: string): Promise<string | null> {
        return this.remoteService.getGitHubRepoUrl(repoRoot);
    }

    async getRemoteUrl(repoRoot: string): Promise<string | null> {
        return this.remoteService.getRemoteUrl(repoRoot);
    }

    async getRemoteFileUrl(filePath: string, startLine: number, endLine?: number): Promise<string | null> {
        return this.remoteService.getRemoteFileUrl(filePath, startLine, endLine);
    }

    async fetchRemote(repoRoot: string, remote: string = 'origin'): Promise<void> {
        return this.remoteService.fetchRemote(repoRoot, remote);
    }

    // Stash Service Delegation
    async getStashes(repoRoot: string): Promise<StashInfo[]> {
        return this.stashService.getStashes(repoRoot);
    }

    async stashHasUntrackedFiles(stashIndex: string, repoRoot: string): Promise<boolean> {
        return this.stashService.stashHasUntrackedFiles(stashIndex, repoRoot);
    }

    async hasChangesToStash(repoRoot: string): Promise<boolean> {
        return this.stashService.hasChangesToStash(repoRoot);
    }

    async hasUntrackedFiles(repoRoot: string): Promise<boolean> {
        return this.stashService.hasUntrackedFiles(repoRoot);
    }

    async hasTrackedChanges(repoRoot: string): Promise<boolean> {
        return this.stashService.hasTrackedChanges(repoRoot);
    }

    async hasStagedChanges(repoRoot: string): Promise<boolean> {
        return this.stashService.hasStagedChanges(repoRoot);
    }

    async hasFilesWithMixedChanges(repoRoot: string): Promise<boolean> {
        return this.stashService.hasFilesWithMixedChanges(repoRoot);
    }

    async getStashPreview(repoRoot: string, includeUntracked: boolean = false): Promise<{
        staged: Array<{ file: string; additions: number; deletions: number }>;
        unstaged: Array<{ file: string; additions: number; deletions: number }>;
        untracked: string[];
    }> {
        return this.stashService.getStashPreview(repoRoot, includeUntracked);
    }

    async createStash(repoRoot: string, message: string, includeUntracked: boolean = false, keepIndex: boolean = false, stagedOnly: boolean = false, specificFiles?: string[]): Promise<void> {
        return this.stashService.createStash(repoRoot, message, includeUntracked, keepIndex, stagedOnly, specificFiles);
    }

    async stashSpecificFiles(repoRoot: string, filePaths: string[]): Promise<void> {
        return this.stashService.stashSpecificFiles(repoRoot, filePaths);
    }

    async stashUntrackedOnly(repoRoot: string, message: string): Promise<void> {
        return this.stashService.stashUntrackedOnly(repoRoot, message);
    }

    async applyStash(stashIndex: string, repoRoot: string): Promise<void> {
        return this.stashService.applyStash(stashIndex, repoRoot);
    }

    async popStash(stashIndex: string, repoRoot: string): Promise<void> {
        return this.stashService.popStash(stashIndex, repoRoot);
    }

    async deleteStash(stashIndex: string, repoRoot: string): Promise<void> {
        return this.stashService.deleteStash(stashIndex, repoRoot);
    }

    async getStashFiles(stashIndex: string, repoRoot: string): Promise<ChangedFile[]> {
        return this.stashService.getStashFiles(stashIndex, repoRoot);
    }

    async getStashFileContent(relativePath: string, stashIndex: string, repoRoot: string): Promise<string> {
        return this.stashService.getStashFileContent(relativePath, stashIndex, repoRoot);
    }

    async getStashFileParentContent(relativePath: string, stashIndex: string, repoRoot: string): Promise<string> {
        return this.stashService.getStashFileParentContent(relativePath, stashIndex, repoRoot);
    }

    // Rebase Service Delegation
    async getCommitsAheadOfBase(repoRoot: string, baseBranch: string, currentBranch?: string): Promise<RebaseCommit[]> {
        return this.rebaseService.getCommitsAheadOfBase(repoRoot, baseBranch, currentBranch);
    }

    async startInteractiveRebase(repoRoot: string, baseBranch: string, commits: RebaseCommit[]): Promise<void> {
        return this.rebaseService.startInteractiveRebase(repoRoot, baseBranch, commits);
    }

    async continueRebase(repoRoot: string): Promise<void> {
        return this.rebaseService.continueRebase(repoRoot);
    }

    async abortRebase(repoRoot: string): Promise<void> {
        return this.rebaseService.abortRebase(repoRoot);
    }

    async isRebaseInProgress(repoRoot: string): Promise<boolean> {
        return this.rebaseService.isRebaseInProgress(repoRoot);
    }

    async getRebaseConflicts(repoRoot: string): Promise<string[]> {
        return this.rebaseService.getRebaseConflicts(repoRoot);
    }

    // Worktree Service Delegation
    async getWorktrees(repoRoot: string): Promise<GitWorktree[]> {
        return this.worktreeService.getWorktrees(repoRoot);
    }

    async addWorktree(repoRoot: string, worktreePath: string, branchName: string, originBranch?: string): Promise<void> {
        return this.worktreeService.addWorktree(repoRoot, worktreePath, branchName, originBranch);
    }

    async removeWorktree(repoRoot: string, worktreePath: string, force: boolean = false): Promise<void> {
        return this.worktreeService.removeWorktree(repoRoot, worktreePath, force);
    }

    async pruneWorktrees(repoRoot: string): Promise<void> {
        return this.worktreeService.pruneWorktrees(repoRoot);
    }

    // Graph Service Delegation
    async getGraphCommits(repoRoot: string, limit: number = 50, skip: number = 0, refs: string[] = []): Promise<any[]> {
        return this.graphService.getGraphCommits(repoRoot, limit, skip, refs);
    }

    // Contributors Service Delegation
    async getFileContributors(filePath: string, limit: number = 3): Promise<{ author: string; lineChanges: number; commitCount: number }[]> {
        return this.contributorsService.getFileContributors(filePath, limit);
    }
}
