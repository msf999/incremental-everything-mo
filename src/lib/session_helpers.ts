import { ReactRNPlugin, RemId } from '@remnote/plugin-sdk';
import {
  seenRemInSessionKey,
  seenCardInSessionKey,
  currentScopeRemIdsKey,
  priorityCalcScopeRemIdsKey,
  currentSubQueueIdKey,
  queueSessionCacheKey,
  incrementalQueueActiveKey,
  currentIncrementalRemTypeKey,
} from './consts';
import { IncrementalRem } from './incremental_rem';
import { QueueSessionCache } from './card_priority';

/**
 * Resets all queue-related session storage keys.
 * Called when exiting the queue or entering a new queue session.
 */
export async function resetQueueSession(plugin: ReactRNPlugin): Promise<void> {
  await plugin.storage.setSession(seenRemInSessionKey, []);
  await plugin.storage.setSession(seenCardInSessionKey, []);
  await plugin.storage.setSession(currentScopeRemIdsKey, null);
  await plugin.storage.setSession(priorityCalcScopeRemIdsKey, null);
  await plugin.storage.setSession(currentSubQueueIdKey, null);
  await plugin.storage.setSession('effectiveScopeId', null);
  await plugin.storage.setSession('originalScopeId', null);
  await plugin.storage.setSession('isPriorityReviewDoc', null);
  await plugin.storage.setSession(queueSessionCacheKey, null);
  await plugin.storage.setSession('skipCardHistorySave', null);
  await plugin.storage.setSession('skipIncRemHistorySave', null);
  await plugin.storage.setSession(incrementalQueueActiveKey, false);
  await plugin.storage.setSession(currentIncrementalRemTypeKey, undefined);
}

/**
 * Clears only the seen items tracking for a new queue session.
 * Called when entering the queue to start with a clean slate.
 */
export async function clearSeenItems(plugin: ReactRNPlugin): Promise<void> {
  await plugin.storage.setSession(seenRemInSessionKey, []);
  await plugin.storage.setSession(seenCardInSessionKey, []);
  await plugin.storage.setSession(currentScopeRemIdsKey, null);
  await plugin.storage.setSession(priorityCalcScopeRemIdsKey, null);
}

/** Counts of due IncRems bucketed by priority: [0-10, 11-30, 31-60, 61-100] (inclusive). */
export type DueIncRemPriorityBuckets = [number, number, number, number];

export interface DueIncRemStats {
  /** Number of due Incremental Rems to display. */
  count: number;
  /** Due IncRems split into priority buckets [0-10, 11-30, 31-60, 61-100]. */
  priorityBuckets: DueIncRemPriorityBuckets;
}

/**
 * Buckets due IncRems by priority into [0-10, 11-30, 31-60, 61-100] (inclusive).
 * Priority is 0-100 (lower = more important).
 */
export function getDueIncRemPriorityBuckets(dueIncRems: IncrementalRem[]): DueIncRemPriorityBuckets {
  const buckets: DueIncRemPriorityBuckets = [0, 0, 0, 0];
  for (const rem of dueIncRems) {
    const p = rem.priority;
    if (p <= 10) buckets[0]++;
    else if (p <= 30) buckets[1]++;
    else if (p <= 60) buckets[2]++;
    else buckets[3]++;
  }
  return buckets;
}

/**
 * Calculates due Incremental Rem stats (count + priority distribution) for the queue
 * counter, based on the current queue context.
 *
 * @param plugin Plugin instance
 * @param allIncRems All incremental rems in the knowledge base
 * @param sessionCache The pre-calculated session cache
 * @param isPriorityReviewDoc Whether this is a Priority Review Document
 * @param scopeForItemSelection The scope being used for item selection
 * @param performanceMode Current performance mode setting
 * @returns Count of due incremental rems plus their priority-bucket distribution
 */
export async function calculateDueIncRemStats(
  plugin: ReactRNPlugin,
  allIncRems: IncrementalRem[],
  sessionCache: QueueSessionCache,
  isPriorityReviewDoc: boolean,
  scopeForItemSelection: RemId | null,
  performanceMode: string
): Promise<DueIncRemStats> {
  const toStats = (dueIncRems: IncrementalRem[]): DueIncRemStats => ({
    count: dueIncRems.length,
    priorityBuckets: getDueIncRemPriorityBuckets(dueIncRems),
  });

  // Priority Review Docs always calculate from scope
  if (isPriorityReviewDoc) {
    const scopeRemIds = (await plugin.storage.getSession<RemId[]>(currentScopeRemIdsKey)) || [];
    return toStats(
      allIncRems.filter((rem) => scopeRemIds.includes(rem.remId) && Date.now() >= rem.nextRepDate)
    );
  }

  // No scope means full KB
  if (!scopeForItemSelection) {
    return toStats(sessionCache.dueIncRemsInKB);
  }

  // Scoped queue - use cache in full mode, calculate in light mode
  if (performanceMode === 'full') {
    return toStats(sessionCache.dueIncRemsInScope);
  }

  // Light mode with scope - calculate manually
  console.log('QUEUE ENTER: Light mode - manually calculating due IncRem stats...');
  const scopeRemIds = (await plugin.storage.getSession<RemId[]>(currentScopeRemIdsKey)) || [];
  const dueIncRems = scopeRemIds.length
    ? allIncRems.filter((rem) => Date.now() >= rem.nextRepDate && scopeRemIds.includes(rem.remId))
    : [];
  console.log(`QUEUE ENTER: Light mode - found ${dueIncRems.length} due IncRems`);
  return toStats(dueIncRems);
}
