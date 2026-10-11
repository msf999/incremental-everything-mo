import { ReactRNPlugin, RemId } from '@remnote/plugin-sdk';
import {
  seenRemInSessionKey,
  seenCardInSessionKey,
  currentScopeRemIdsKey,
  priorityCalcScopeRemIdsKey,
  priorityCalcScopeCompletenessKey,
  currentSubQueueIdKey,
  queueSessionCacheKey,
  incrementalQueueActiveKey,
  incremReviewStartTimeKey,
  incremNotesSidebarRemIdKey,
  currentIncrementalRemTypeKey,
} from './consts';
import { urgentPriorityLimit } from './consts'; // FORK (Deviation 9)
import { queueSlotSwapKey, queueSwapRequestKey } from './consts'; // FORK (Deviation 16)
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
  // Describes the scope above; must never outlive it.
  await plugin.storage.setSession(priorityCalcScopeCompletenessKey, null);
  await plugin.storage.setSession(currentSubQueueIdKey, null);
  await plugin.storage.setSession('effectiveScopeId', null);
  await plugin.storage.setSession('originalScopeId', null);
  await plugin.storage.setSession('isPriorityReviewDoc', null);
  await plugin.storage.setSession(queueSessionCacheKey, null);
  await plugin.storage.setSession('skipCardHistorySave', null);
  await plugin.storage.setSession('skipIncRemHistorySave', null);
  await plugin.storage.setSession(incrementalQueueActiveKey, false);
  // FORK (Deviation 16): a 🔄 swap never outlives its queue session.
  await plugin.storage.setSession(queueSlotSwapKey, null);
  await plugin.storage.setSession(queueSwapRequestKey, null);
  await plugin.storage.setSession(currentIncrementalRemTypeKey, undefined);

  // FORK (2026-08-14, bug-hunt #17): the review clock must not survive the
  // session. It is set when an IncRem appears in the queue (widgets/queue.tsx; until
  // 2026-10-11, when GetNextCard served it) and consumed by
  // updateReviewRemData as `now - startTime`, with no clamp and no check that we
  // are still in the queue — so reviewing at 09:00, leaving, and running
  // Review-in-Editor at 14:00 stamped a five-hour reviewTimeSeconds into history
  // and inflated the Study Dashboard. reschedule.tsx already nulls this key for
  // exactly this reason; QueueExit did not.
  await plugin.storage.setSession(incremReviewStartTimeKey, null);

  // FORK (2026-08-14, bug-hunt #19): the ✎ notes-sidebar target doubles as its
  // open-flag, and nothing else clears it on the way out — clearStaleIncRemSignals
  // only runs on flashcard turns, which an all-IncRem queue may never have. Left
  // set, re-entering the queue showed that rem's ExtractViewer stuck in the
  // "editing in the sidebar" hint with no sidebar open.
  await plugin.storage.setSession(incremNotesSidebarRemIdKey, null);
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
  // Describes the scope above; must never outlive it.
  await plugin.storage.setSession(priorityCalcScopeCompletenessKey, null);
}

/** Counts of due IncRems bucketed by priority: [0-10, 11-30, 31-60, 61-100] (inclusive). */
export type DueIncRemPriorityBuckets = [number, number, number, number];

export interface DueIncRemStats {
  /** Number of due Incremental Rems to display. */
  count: number;
  /** Due IncRems split into priority buckets [0-10, 11-30, 31-60, 61-100]. */
  priorityBuckets: DueIncRemPriorityBuckets;
  /** FORK (Deviation 9): due IncRems with priority below `urgentPriorityLimit` (10) — the bar's 0-band. */
  urgentCount: number;
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
    urgentCount: dueIncRems.filter((rem) => rem.priority < urgentPriorityLimit).length,
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
