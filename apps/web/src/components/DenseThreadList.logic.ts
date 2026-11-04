import {
  sortPinnedThreadsByOrderKey,
  toSortableTimestamp,
} from "@t3tools/client-runtime/state/thread-sort";

/** The thread fields the dense list orders by. */
export interface DenseThreadOrderInput {
  readonly id: string;
  readonly environmentId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly latestUserMessageAt: string | null;
  readonly latestRun: {
    readonly requestedAt: string | null;
    readonly startedAt: string | null;
    readonly completedAt: string | null;
  } | null;
  readonly pinnedAt: string | null;
  readonly pinOrderKey: string | null;
}

/**
 * When the last message landed in the thread: the later of the user's last
 * message and the agent's last finished reply. Falls back to when the latest
 * run started, then to the thread's own timestamps.
 */
export function denseThreadLastActivityAt(thread: DenseThreadOrderInput): string {
  const candidates = [
    thread.latestUserMessageAt,
    thread.latestRun?.completedAt ?? null,
    thread.latestRun?.startedAt ?? null,
    thread.latestRun?.requestedAt ?? null,
  ];
  let latest: string | null = null;
  let latestMs = Number.NEGATIVE_INFINITY;
  for (const candidate of candidates) {
    if (candidate === null) continue;
    const ms = toSortableTimestamp(candidate);
    if (ms !== null && ms > latestMs) {
      latest = candidate;
      latestMs = ms;
    }
  }
  return latest ?? thread.createdAt;
}

function denseThreadLastActivityMs(thread: DenseThreadOrderInput): number {
  return toSortableTimestamp(denseThreadLastActivityAt(thread)) ?? Number.NEGATIVE_INFINITY;
}

/**
 * Pinned threads first, in the same manual order as the main sidebar, then
 * every other thread newest-activity first.
 */
export function orderDenseThreads<T extends DenseThreadOrderInput>(
  threads: readonly T[],
): { readonly pinned: T[]; readonly rest: T[] } {
  const pinned: T[] = [];
  const rest: T[] = [];
  for (const thread of threads) {
    (thread.pinnedAt !== null ? pinned : rest).push(thread);
  }
  const activity = new Map(rest.map((thread) => [thread, denseThreadLastActivityMs(thread)]));
  rest.sort(
    (left, right) =>
      activity.get(right)! - activity.get(left)! ||
      left.id.localeCompare(right.id) ||
      left.environmentId.localeCompare(right.environmentId),
  );
  return { pinned: sortPinnedThreadsByOrderKey(pinned), rest };
}

/** Case-insensitive match on every whitespace-separated term. */
export function matchesDenseThreadFilter(
  query: string,
  fields: readonly (string | null | undefined)[],
): boolean {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = fields
    .filter((field): field is string => typeof field === "string")
    .join(" ")
    .toLowerCase();
  return terms.every((term) => haystack.includes(term));
}
