import * as vscode from 'vscode';

/**
 * Shared filter utility for commit message filtering
 */
export class MessageFilter {
    private filter: string | undefined;

    /**
     * Prompt user to set a filter
     */
    async promptForFilter(currentValue?: string): Promise<string | undefined> {
        const filter = await vscode.window.showInputBox({
            prompt: 'Enter text to filter commit messages',
            placeHolder: 'e.g., "fix bug", "feature", "refactor"',
            value: currentValue || ''
        });

        if (filter !== undefined) {
            this.filter = filter || undefined;
        }

        return this.filter;
    }

    /**
     * Set filter value directly
     */
    setFilter(filter: string | undefined): void {
        this.filter = filter;
    }

    /**
     * Get current filter value
     */
    getFilter(): string | undefined {
        return this.filter;
    }

    /**
     * Clear the filter
     */
    clear(): void {
        this.filter = undefined;
    }

    /**
     * Check if filter is active
     */
    isActive(): boolean {
        return !!this.filter;
    }

    /**
     * Apply filter to commits (generic)
     */
    apply<T extends { message: string }>(items: T[]): T[] {
        if (!this.filter) {
            return items;
        }

        const filterLower = this.filter.toLowerCase();
        return items.filter(item =>
            item.message.toLowerCase().includes(filterLower)
        );
    }

    /**
     * Get "no results" message
     */
    getNoResultsMessage(defaultMessage: string): string {
        return this.filter
            ? `No commits found matching "${this.filter}"`
            : defaultMessage;
    }
}

