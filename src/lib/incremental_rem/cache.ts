import { ReactRNPlugin, RNPlugin } from '@remnote/plugin-sdk';
import { allIncrementalRemKey, powerupCode } from '../consts';
import { IncrementalRem } from './types';
import { getIncrementalRemFromRem } from './index';

/**
 * Updates one rem in the incremental-rem session cache.
 *
 * MERGES onto the existing entry rather than replacing it, and refuses to write
 * a result that is not a valid `IncrementalRem`.
 *
 * FORK (2026-08-13, issues #3/#8 of the bug hunt) — why both guards exist:
 * this used to be `allRems.filter(...).concat(updatedIncRem)`, a straight
 * replace, with the parameter typed as a complete `IncrementalRem`. One caller
 * (`priority_light.tsx`) cast a `{remId, priority}` literal through `as any` and
 * so replaced a full entry with a two-field object. The cached rem lost
 * `nextRepDate`, and the queue selector's `Date.now() >= x.nextRepDate`
 * (register/callbacks.ts) is a NaN comparison against `undefined` — always
 * false — so the rem silently vanished from the queue and the due counter for
 * the rest of the session, with no error anywhere. `rotation` and `history`
 * went with it.
 *
 * Merging makes a partial update express what it means, so callers may now pass
 * just the fields they changed. The `safeParse` gate is the backstop: if the
 * merged result is still incomplete — a partial update for a rem that is not in
 * the cache yet — the write is skipped rather than poisoning the cache with an
 * entry the queue can never match. Callers passing a complete object (21 of the
 * 22 sites) are unaffected: merge is a no-op for them.
 *
 * @param plugin Plugin instance
 * @param updatedIncRem The rem's changed fields; must carry `remId`
 */
/**
 * Serialises every cache mutation.
 *
 * FORK (2026-08-14, bug-hunt #44). `updateIncrementalRemCache` and
 * `removeIncrementalRemCache` are both read-modify-write over ONE session key,
 * and they are called concurrently from the tracker, the answer buttons, the
 * priority popups, the editor timers and GetNextCard. Interleaved calls lost
 * updates: two rems changed at once, and whichever read first overwrote the
 * other's write — silently, since neither call fails. Chaining them costs a
 * microtask and makes the sequence deterministic.
 *
 * ⚠️ SCOPE, corrected 2026-08-15 (review §2.11) — the original wording above
 * over-claimed. `cacheWriteChain` is MODULE-scoped, and every widget is its own
 * webpack entry running in its own iframe, so each JS context has its own chain.
 * The callers listed above therefore do NOT share this lock: it serialises writes
 * WITHIN one context only. The #44 verification exercised a single context and so
 * could not have caught this. `action_guard.ts` states the same limit honestly
 * ("one flag per JS context") and this is the same class of constraint.
 *
 * There is no cheap correct fix — session storage offers no compare-and-swap — and
 * the merge + safeParse gate below still bounds the damage: a lost update costs one
 * stale field until the next read, not a destroyed entry. `loadIncrementalRemCache`
 * also builds its whole array BEFORE taking the lock, so even in-context the final
 * swap prevents interleaving but not clobbering.
 */
let cacheWriteChain: Promise<unknown> = Promise.resolve();
function withCacheLock<T>(fn: () => Promise<T>): Promise<T> {
  const result = cacheWriteChain.then(fn, fn);
  // Swallow rejections on the CHAIN only (callers still see their own), so one
  // failed write cannot poison every later one.
  cacheWriteChain = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

export async function updateIncrementalRemCache(
  plugin: RNPlugin,
  updatedIncRem: Partial<IncrementalRem> & { remId: string }
): Promise<void> {
  return withCacheLock(async () => {
    const allRems: IncrementalRem[] =
    (await plugin.storage.getSession(allIncrementalRemKey)) || [];

  const existing = allRems.find((r) => r.remId === updatedIncRem.remId);
  const merged = existing ? { ...existing, ...updatedIncRem } : updatedIncRem;

  const parsed = IncrementalRem.safeParse(merged);
  if (!parsed.success) {
    // Not a usable cache entry — most likely a partial update for a rem the
    // cache has not loaded yet. Dropping it is correct: the tracker's next read
    // inserts the real thing, whereas writing this would hide the rem instead.
    console.warn(
      '[IncRemCache] skipped update — merged entry is not a valid IncrementalRem',
      updatedIncRem.remId,
      parsed.error.issues.map((i) => i.path.join('.'))
    );
    return;
  }

  const updatedAllRems = allRems
    .filter((r) => r.remId !== updatedIncRem.remId)
    .concat(parsed.data);
  await plugin.storage.setSession(allIncrementalRemKey, updatedAllRems);
  });
}

/**
 * Removes an incremental rem from the session cache.
 *
 * Use this when a rem is no longer incremental (powerup removed) or deleted.
 *
 * @param plugin Plugin instance
 * @param remId The ID of the rem to remove from cache
 * @returns Promise that resolves when the cache is updated
 */
export async function removeIncrementalRemCache(
  plugin: RNPlugin,
  remId: string
): Promise<void> {
  // FORK (#44): shares the write chain with updateIncrementalRemCache — the two
  // mutate the same key, so serialising only one of them would be pointless.
  return withCacheLock(async () => {
    const allRems: IncrementalRem[] =
      (await plugin.storage.getSession(allIncrementalRemKey)) || [];
    const updatedAllRems = allRems.filter((r) => r.remId !== remId);
    await plugin.storage.setSession(allIncrementalRemKey, updatedAllRems);
  });
}

/**
 * Loads all Rems tagged with the Incremental powerup and caches them in session storage.
 *
 * Processes rems in batches to avoid overwhelming the API. Invalid rems are filtered out.
 *
 * @param plugin Plugin instance with powerup/rem/storage access
 * @param batchSize Number of rems to process per batch (default: 500)
 * @param batchDelayMs Delay in milliseconds between batches (default: 100)
 * @returns Array of successfully loaded IncrementalRem objects
 */
export async function loadIncrementalRemCache(
  plugin: ReactRNPlugin,
  batchSize: number = 500,
  batchDelayMs: number = 100
): Promise<IncrementalRem[]> {

  console.log('[IncRem Cache] Loading started...');
  const startTime = Date.now();
  const powerup = await plugin.powerup.getPowerupByCode(powerupCode);
  const taggedRem = (await powerup?.taggedRem()) || [];


  const updatedAllRem: IncrementalRem[] = [];
  const numBatches = Math.ceil(taggedRem.length / batchSize);

  for (let i = 0; i < taggedRem.length; i += batchSize) {
    const batch = taggedRem.slice(i, i + batchSize);


    const batchInfos = (
      await Promise.all(batch.map((rem) => getIncrementalRemFromRem(plugin, rem)))
    ).filter(Boolean) as IncrementalRem[];

    updatedAllRem.push(...batchInfos);

    await new Promise((resolve) => setTimeout(resolve, batchDelayMs));
  }


  // FORK (#44): take the lock for the final swap too. This runs for seconds over
  // a large KB, and writing the whole collection outside the chain would discard
  // any per-rem update made while it was loading.
  await withCacheLock(async () => {
    await plugin.storage.setSession(allIncrementalRemKey, updatedAllRem);
  });
  await plugin.storage.setSession('inc_rem_cache_fully_loaded', true);
  const elapsed = Date.now() - startTime;
  console.log(`[IncRem Cache] Loading complete: ${updatedAllRem.length} IncRems loaded in ${elapsed}ms`);

  return updatedAllRem;
}
