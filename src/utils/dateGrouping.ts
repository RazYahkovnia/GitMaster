export type DateGroupLabel =
    | 'Today'
    | 'Yesterday'
    | 'Last Week'
    | 'Last Month'
    | 'Last 3 Months'
    | 'Last 6 Months'
    | 'Older';

function safeDate(input: Date): Date | null {
    return Number.isNaN(input.getTime()) ? null : input;
}

/**
 * Map a date into a relative bucket label.
 *
 * Buckets match the Git Operations (reflog) view:
 * Today / Yesterday / Last Week / Last Month / Last 3 Months / Last 6 Months / Older
 */
export function getDateGroupLabel(date: Date, now: Date = new Date()): DateGroupLabel {
    const d = safeDate(date);
    const n = safeDate(now) ?? new Date();

    if (!d) {
        return 'Older';
    }

    const diffMs = n.getTime() - d.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
        return 'Today';
    } else if (diffDays === 1) {
        return 'Yesterday';
    } else if (diffDays < 7) {
        return 'Last Week';
    } else if (diffDays < 30) {
        return 'Last Month';
    } else if (diffDays < 90) {
        return 'Last 3 Months';
    } else if (diffDays < 180) {
        return 'Last 6 Months';
    } else {
        return 'Older';
    }
}

/**
 * Group ordered items into relative date buckets, preserving the first-seen bucket order.
 * Assumes input is typically already sorted newest → oldest (e.g. from git).
 */
export function groupItemsByDate<T>(
    items: readonly T[],
    getDate: (item: T) => Date,
    now: Date = new Date(),
): Map<DateGroupLabel, T[]> {
    const groups = new Map<DateGroupLabel, T[]>();

    for (const item of items) {
        const label = getDateGroupLabel(getDate(item), now);
        if (!groups.has(label)) {
            groups.set(label, []);
        }
        groups.get(label)!.push(item);
    }

    return groups;
}
