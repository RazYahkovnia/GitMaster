/**
 * Constants for MCP server configuration and tool defaults.
 */

// ============================================================================
// Server Configuration
// ============================================================================

/** Default host for the MCP server */
export const DEFAULT_HOST = '127.0.0.1';

/** Default port for the MCP server */
export const DEFAULT_PORT = 8765;

/** HTTP endpoints */
export const ENDPOINTS = {
    /** StreamableHTTP endpoint (preferred) */
    MCP: '/mcp',
    /** SSE endpoint (deprecated fallback) */
    SSE: '/sse',
    /** SSE message endpoint */
    MESSAGE: '/message',
} as const;

// ============================================================================
// Tool Limits
// ============================================================================

/** Shelves tool limits */
export const SHELVES_LIMITS = {
    DEFAULT_MAX_SHELVES: 50,
    MIN_SHELVES: 1,
    MAX_SHELVES: 200,
    DEFAULT_MAX_FILES_PER_SHELF: 500,
    MIN_FILES_PER_SHELF: 1,
    MAX_FILES_PER_SHELF: 5000,
} as const;

/** Commit explain tool limits */
export const COMMIT_EXPLAIN_LIMITS = {
    DEFAULT_MAX_FILES: 200,
    MIN_FILES: 1,
    MAX_FILES: 2000,
} as const;

/** File experts tool limits */
export const FILE_EXPERTS_LIMITS = {
    DEFAULT_LIMIT: 5,
    MIN_LIMIT: 1,
    MAX_LIMIT: 20,
} as const;

// ============================================================================
// Timeouts
// ============================================================================

/** Timeout values in milliseconds */
export const TIMEOUTS = {
    /** Timeout for resolving repository root */
    REPO_ROOT: 5_000,
    /** Timeout for fetching commit info */
    COMMIT_INFO: 10_000,
    /** Timeout for fetching changed files */
    CHANGED_FILES: 15_000,
} as const;

// ============================================================================
// Logging
// ============================================================================

/** Minimum duration (ms) before logging slow tool calls */
export const SLOW_TOOL_THRESHOLD_MS = 2000;
