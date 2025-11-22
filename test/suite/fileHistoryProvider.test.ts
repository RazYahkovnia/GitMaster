import * as vscode from 'vscode';
import { FileHistoryProvider } from '../../src/providers/fileHistoryProvider';
import { GitService } from '../../src/services/gitService';

// Mock GitService
jest.mock('../../src/services/gitService');

describe('FileHistoryProvider', () => {
    let provider: FileHistoryProvider;
    let mockGitService: jest.Mocked<GitService>;
    let mockContext: vscode.ExtensionContext;

    beforeEach(() => {
        // Create mock GitService
        mockGitService = new GitService() as jest.Mocked<GitService>;

        // Create mock ExtensionContext
        mockContext = {
            subscriptions: [],
            workspaceState: {
                get: jest.fn(),
                update: jest.fn(),
            },
            globalState: {
                get: jest.fn(),
                update: jest.fn(),
                setKeysForSync: jest.fn(),
            },
            extensionPath: '',
            storagePath: '',
            globalStoragePath: '',
            logPath: '',
            asAbsolutePath: jest.fn(),
        } as unknown as vscode.ExtensionContext;

        provider = new FileHistoryProvider(mockGitService, mockContext);
    });

    test('getChildren returns empty item when no file is open', async () => {
        const items = await provider.getChildren();
        expect(items).toHaveLength(1);
        expect(items[0].label).toBe('Open a file to view its history');
    });

    test('getChildren returns empty item when file is not tracked', async () => {
        provider.setCurrentFile('/path/to/file.ts');
        mockGitService.isFileTracked.mockResolvedValue(false);

        const items = await provider.getChildren();
        expect(items).toHaveLength(1);
        expect(items[0].label).toBe('File is not tracked by Git');
    });

    test('getChildren returns commit items when history is available', async () => {
        provider.setCurrentFile('/path/to/file.ts');
        mockGitService.isFileTracked.mockResolvedValue(true);

        const mockCommits = [
            {
                hash: '1234567',
                shortHash: '1234567',
                message: 'Test commit',
                author: 'Test Author',
                date: '2023-01-01',
                relativeDate: '1 day ago'
            }
        ];
        mockGitService.getFileHistory.mockResolvedValue(mockCommits);

        const items = await provider.getChildren();
        expect(items).toHaveLength(1);
        expect(items[0].label).toBe('Test commit');
    });

    test('getChildren handles errors gracefully', async () => {
        provider.setCurrentFile('/path/to/file.ts');
        mockGitService.isFileTracked.mockRejectedValue(new Error('Git error'));

        const items = await provider.getChildren();
        expect(items).toHaveLength(1);
        expect(items[0].label).toBe('Failed to load file history');
    });

    test('refresh fires onDidChangeTreeData', () => {
        const spy = jest.spyOn(provider['_onDidChangeTreeData'], 'fire');
        provider.refresh();
        expect(spy).toHaveBeenCalled();
    });

    test('setCurrentFile updates file and resets filter', () => {
        const refreshSpy = jest.spyOn(provider, 'refresh');
        provider.setCurrentFile('/path/to/new/file.ts');

        expect(provider.getCurrentFile()).toBe('/path/to/new/file.ts');
        expect(refreshSpy).toHaveBeenCalled();
        expect(provider.hasFilter()).toBe(false);
    });
});
