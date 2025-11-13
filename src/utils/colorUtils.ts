import * as vscode from 'vscode';

/**
 * Predefined colors that work well in both light and dark themes
 */
const AUTHOR_COLORS = [
    'charts.red',
    'charts.blue',
    'charts.green',
    'charts.yellow',
    'charts.orange',
    'charts.purple',
    'charts.foreground',
    'debugIcon.breakpointForeground',
    'gitDecoration.modifiedResourceForeground',
    'gitDecoration.addedResourceForeground',
    'gitDecoration.deletedResourceForeground',
    'gitDecoration.untrackedResourceForeground',
    'terminal.ansiBlue',
    'terminal.ansiGreen',
    'terminal.ansiYellow',
    'terminal.ansiMagenta',
    'terminal.ansiCyan',
    'terminal.ansiRed',
];

/**
 * Cache for author colors to ensure consistency
 */
const authorColorCache = new Map<string, vscode.ThemeColor>();

/**
 * Generate a consistent color for an author based on their name
 * @param author The author name
 * @returns A ThemeColor for the author
 */
export function getAuthorColor(author: string): vscode.ThemeColor {
    // Check cache first
    if (authorColorCache.has(author)) {
        return authorColorCache.get(author)!;
    }

    // Generate a hash from the author name
    const hash = hashString(author);
    const colorIndex = hash % AUTHOR_COLORS.length;
    const color = new vscode.ThemeColor(AUTHOR_COLORS[colorIndex]);

    // Cache the color
    authorColorCache.set(author, color);

    return color;
}

/**
 * Simple hash function for strings
 * @param str The string to hash
 * @returns A numeric hash value
 */
function hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
}
