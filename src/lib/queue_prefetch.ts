import { PluginRem, ReactRNPlugin, RemId } from '@remnote/plugin-sdk';
import * as _ from 'remeda';
import {
  allIncrementalRemKey,
  allIncrementalRemSlimKey,
  currentScopeRemIdsKey,
  currentIncRemKey,
  seenRemInSessionKey,
  noIncRemTimerKey,
  incRemDisabledDeviceKey,
  deferSpoilerIncRemsId,
} from './consts';
import { urgentPriorityLimit } from './consts'; // FORK (Deviation 9)
import { queueLeftAfterReviewKey, QueueLeftAfterReview, queueReviewedInSessionKey } from './consts'; // FORK (2026-11-14)
import { queueSwapRequestKey, queueSlotSwapKey, incremReviewStartTimeKey, QueueSwapRequest, QueueSlotSwap } from './consts'; // FORK (Deviation 16)
import { queueRepeatSkippedKey } from './consts'; // FORK (2026-11-14)
import { getIESetting } from './settings';
import { getIncrementalRemFromRem, IncrementalRem, SlimIncRem } from './incremental_rem';
import {
  CardsPerRem,
  DEFAULT_CARDS_PER_REM,
  getCardsPerRem,
  getSortingRandomness,
  getWeightSelectionK,
  applyPriorityWeightedLottery,
} from './sorting';
import { recordQueueEvent, formatQueueDiagnostics } from './queue_diagnostics'; // FORK (2026-11-14)
import { writeQueueCounterCss } from './ui_helpers'; // FORK (2026-11-14)
import { bumpQueueTurn } from './queue_turn'; // FORK (2026-11-15, review 3 #1)

/**
 * Off-critical-path preparation of the next Incremental Rem to inject into the
 * queue.
 *
 * WHY THIS EXISTS
 * ---------------
 * RemNote awaits the GetNextCard callback with an internal deadline of roughly
 * one second. Past it, RemNote stops waiting and loads a flashcard of its own;
 * whatever the plugin returns afterwards is discarded silently.
 *
 * Instrumented sessions on a 5,525-IncRem KB showed injections landing at 623ms,
 * 863ms, 969ms and 993ms, and one dropped at 1088ms. The plugin was not slow at
 * anything it *computed* — sorting and filtering all 5,525 entries measured
 * 0–3ms every single call. The entire cost was SDK round-trips, and the largest
 * single phase was two trivial scalar reads that ranged from 13ms to 631ms
 * depending only on how busy the plugin bridge happened to be. That is queueing
 * delay, and no amount of shaving round-trips makes it predictable.
 *
 * So this module removes them instead. Everything GetNextCard needs — the
 * blocking gates, the interval setting, and a small buffer of already-verified
 * candidates — is held in plain module state, and the callback answers from
 * memory with zero awaits. The work that used to sit on the critical path now
 * runs in the gap while the user is reading the current item, where taking 400ms
 * costs nothing.
 *
 * WHY MODULE STATE IS SAFE HERE
 * -----------------------------
 * `registerCallbacks` and `registerIncrementalRemTracker` are both invoked from
 * `index.tsx`'s `onActivate`, so they share one JS realm with this module. A
 * module-level variable is a direct memory read from the callback — no bridge,
 * no serialization. (It is deliberately NOT session storage: reading that is the
 * very cost we are removing.)
 */

/**
 * Per-turn tracing for queue injection: the selection decision, the outcome of
 * each call, and every buffer rebuild. Roughly five console lines per queue
 * item, which drowns out everything else during a study session, so it ships
 * off.
 *
 * Flip to `true` to get a full session trace back — the diagnostic that found
 * the dropped-injection bug in the first place. Deliberately a flag rather than
 * deleted code: this subsystem has a failure mode (RemNote silently discarding
 * a late answer) that produces no symptom whatsoever, so the next investigation
 * should not have to start by rebuilding the instrumentation.
 *
 * Genuine problems are NOT gated on this. The dropped-injection warning and the
 * slow-call warning always print, and every console.error stays unconditional.
 */
export const VERBOSE_QUEUE_INJECTION = false;

export type QueueMode = 'practice-all' | 'in-order' | 'normal';

export type PrefetchQueueInfo = {
  mode: QueueMode;
  subQueueId: string | undefined;
};

/**
 * How many verified candidates to keep ready. More than one because a candidate
 * can go stale between preparation and serving (the rem gets un-incrementalised,
 * deleted, or reviewed elsewhere), and because a dropped injection is pushed
 * back onto the buffer rather than discarded.
 */
const BUFFER_TARGET = 3;

/**
 * How many rounds of "take a window, verify it in parallel" the builder will run
 * before giving up. Bounds the work when a scope contains many stale entries.
 */
const MAX_VERIFY_ROUNDS = 4;

/**
 * Delay before the background rebuild starts after a GetNextCard call.
 *
 * The rebuild reads the slim IncRem cache and verifies a few candidates, so it
 * is far from free even after that projection landed. It used to happen *inside*
 * GetNextCard, i.e. before the queue widget mounted. Firing it immediately after
 * the return would instead put it in direct contention with that mount, which is
 * already slow enough to be visible (slow enough, in fact, to make an earlier
 * mount-based drop detector report false positives). Waiting about a second
 * hands the bridge to the widget first and still finishes long before the user
 * rates the item.
 */
const REFILL_DELAY_MS = 1200;
/**
 * FORK (2026-11-14): how long a rolled-back candidate waits for the queue widget's report
 * before it counts as "not shown" (see `held`). The report normally arrives about half a
 * second after the item appears, later when the bridge is busy.
 */
const HELD_GRACE_MS = 3000;

type PrefetchState = {
  /** `${mode}|${subQueueId}` the buffer was built for; null when never built. */
  buildKey: string | null;
  /** FORK (Deviation 16): the info the current buffer was built for, for swap refills. */
  info: PrefetchQueueInfo | null;
  /** Verified candidates, best-first. */
  buffer: SlimIncRem[];
  /**
   * Verified candidates held back by spoiler protection: the rem is a genuine
   * IncRem, but it also owns a flashcard that RemNote would schedule right now,
   * and showing the extract first would give the answer away.
   *
   * Deliberately a second buffer rather than a filter — see `cleanExhausted`.
   */
  deferredBuffer: SlimIncRem[];
  /**
   * True when the last build walked the entire eligible list and everything that
   * survived verification was a spoiler.
   *
   * This is what makes the deferral safe. Without it, "buffer is empty" would be
   * ambiguous — it is also what an exhausted MAX_VERIFY_ROUNDS looks like — and
   * falling through to the deferred list on that would weaken the protection to
   * nothing on a busy build. With it, a deferred IncRem is served only when
   * there is genuinely no unspoiled one left to serve instead.
   */
  cleanExhausted: boolean;
  /**
   * Due, in scope and not yet served. Upstream showed this number in the queue counter; the
   * fork shows `stillDue` instead (below) and keeps this one for its own bookkeeping — the
   * 🔄 swap asks it whether anything is left to verify.
   */
  dueCount: number;
  /**
   * FORK (2026-11-14, owner request): what the queue counter SHOWS — the Incremental Rems in
   * this session's scope that are still due, whether or not the queue has served them — and
   * how many of those have a priority below urgentPriorityLimit (the parenthesised figure,
   * Deviation 9).
   *
   * Serving an item does not change them, so neither does setting one aside with 🔄 or
   * leaving one with Skip: such an item is still due. They fall when an item stops being due
   * (a review, a reschedule, a dismissal — read off the cache) and for an item reviewed in
   * this session that stays due all the same (Rotation 0; `reviewedThisSession`).
   * Recounted by every build and by the trackers in registerPrefetchTrackers.
   */
  stillDue: number;
  stillDueUrgent: number;
  /** FORK (2026-11-14): the scope the last build read, for the recounts between builds. */
  scopeSet: Set<RemId> | null;
  cardsPerRem: CardsPerRem;
  /** Mirror of noIncRemTimerKey: ms timestamp, or null when no timer is set. */
  timerEndsAt: number | null;
  /** Mirror of incRemDisabledDeviceKey. */
  deviceDisabled: boolean;
  /**
   * Rems already served this session. Authoritative in memory; written through
   * to session storage (which QueueExit reads for the Priority Shield history)
   * only once an injection is CONFIRMED to have been displayed.
   */
  seen: Set<RemId>;
  /**
   * Served but not yet confirmed on screen. Excluded from selection so it cannot
   * be served twice, but not yet burned into `seen` — if RemNote dropped it, it
   * goes back on the buffer intact.
   */
  pending: SlimIncRem | null;
  /**
   * FORK (2026-11-14): candidates that a GetNextCard verdict rolled back ("same slot asked
   * again", "dropped") wait here instead of going straight back to the head of the buffer.
   *
   * The verdict is read off RemNote's counters at the moment an item is popped — before
   * the queue widget can report what is on screen — and when it is wrong, the rolled-back
   * rem IS on screen. Putting it at the head of the buffer made the very same call serve it
   * again: RemNote then held the item the user was reading as the next one too, and it came
   * back right after Next as "Already reviewed" (the owner's report of 2026-11-14,
   * reproduced live by forcing the verdict). A returned item cannot be taken back, so the
   * only safe moment to decide is before it is returned.
   *
   * While a rem waits here it is not served. The widget's report burns it
   * (noteIncRemDisplayed); if HELD_GRACE_MS pass without one, it was not shown after all
   * and goes back to the head of the buffer (releaseHeld).
   */
  held: { rem: SlimIncRem; at: number }[];
  ready: boolean;
};

/**
 * Clears the SESSION-scoped fields, carrying the rest forward.
 *
 * `cardsPerRem` and the two gate mirrors describe the KB and the device, not the
 * queue session, so resetting them to defaults on every queue enter/exit was
 * wrong: until the first background build completed, `readCardsPerRem` handed
 * out DEFAULT_CARDS_PER_REM instead of the user's setting, and the first calls
 * of a session computed their injection interval from it. A session with
 * cardsPerRem 2 opened with `(0+1) % 7` instead of `(0+1) % 3`.
 *
 * These three are seeded at activation (see registerPrefetchTrackers) and
 * refreshed on every build, so carrying them across a reset is strictly more
 * accurate than re-defaulting.
 */
const emptyState = (previous?: PrefetchState): PrefetchState => ({
  buildKey: null,
  info: null,
  buffer: [],
  deferredBuffer: [],
  cleanExhausted: false,
  dueCount: 0,
  stillDue: 0,
  stillDueUrgent: 0,
  scopeSet: null,
  cardsPerRem: previous?.cardsPerRem ?? DEFAULT_CARDS_PER_REM,
  timerEndsAt: previous?.timerEndsAt ?? null,
  deviceDisabled: previous?.deviceDisabled ?? false,
  seen: new Set<RemId>(),
  pending: null,
  held: [],
  ready: false,
});

let state: PrefetchState = emptyState();
let buildInFlight = false;
/** Set when a build is requested while one is already running; see buildQueuePrefetch. */
let rebuildRequested: PrefetchQueueInfo | null = null;
/**
 * Bumped by every reset. A build that started before a reset captures the old
 * value and throws its results away rather than writing them into the new
 * session's state — otherwise a build kicked off just before queue entry could
 * land afterwards and publish a buffer computed against the previous scope.
 */
let generation = 0;
let refillTimer: ReturnType<typeof setTimeout> | null = null;
/**
 * True once primeQueuePrefetch has run for the current session, i.e. once the
 * buffer is built against the session's real document scope. Before that, a
 * build triggered from GetNextCard selects from the whole KB (see
 * buildQueuePrefetch), which is fine for a turn the user may never notice but
 * not for the empty-queue rescue, which must only ever show an in-scope IncRem.
 */
let primed = false;
/** The sub-queue the session was primed for, so a wait from another session never matches. */
let primedSubQueueId: string | undefined;
/**
 * FORK (2026-11-14): the rems reviewed in this queue session. Only the counter reads it, and
 * only for a rem that is still due after its review (Rotation 0): the cache cannot tell such
 * a rem from one not reviewed yet. Mirrors the session key `queueReviewedInSessionKey`, which
 * the QueueEnter listener and resetQueueSession empty — so it survives a plugin restart in
 * the middle of a session, which module memory would not. Not part of PrefetchState for the
 * same reason: the restart's bootstrap resets that.
 */
let reviewedThisSession = new Set<RemId>();
/**
 * FORK (2026-11-15, review): the slim cache as tracker (a) last read it — it reads it on
 * every cache write anyway. The counter is recounted from this, so that a review costs this
 * frame one transfer of the cache instead of three, and a build publishes today's count, not
 * the one of the cache it read when it started. Null until the cache has been written once.
 */
let latestSlim: SlimIncRem[] | null = null;
/** FORK (2026-11-14): the rem of the last 'displayed' line in the queue's event record. */
let lastDisplayedRecorded: RemId | null = null;
/** A review mark older than this was not written just now (the first tracker run after a restart). */
const REVIEW_MARK_MAX_AGE_MS = 10_000;
/** The same for the queue widget's "I skipped a repeat" report. */
const REPEAT_REPORT_MAX_AGE_MS = 10_000;

const makeBuildKey = (info: PrefetchQueueInfo) => `${info.mode}|${info.subQueueId ?? ''}`;

/**
 * Drops all prefetched state. Called on queue enter and queue exit — the seen
 * set, the scope and the candidate buffer are all per-session.
 */
export function resetQueuePrefetch() {
  if (refillTimer) {
    clearTimeout(refillTimer);
    refillTimer = null;
  }
  rebuildRequested = null;
  generation++;
  primed = false;
  state = emptyState(state);
}

// ---------------------------------------------------------------------------
// Synchronous accessors — these are what GetNextCard actually calls
// ---------------------------------------------------------------------------

/** Blocking-gate snapshot. Zero cost: plain memory reads. */
export function readGates(): { blocked: boolean; reason: 'timer-active' | 'device-disabled' | null } {
  if (state.deviceDisabled) return { blocked: true, reason: 'device-disabled' };
  if (state.timerEndsAt !== null && state.timerEndsAt > Date.now()) {
    return { blocked: true, reason: 'timer-active' };
  }
  return { blocked: false, reason: null };
}

export function readCardsPerRem(): CardsPerRem {
  return state.cardsPerRem;
}

// FORK (2026-11-14): the counter shows what is still due, not what is still unserved.
export function readDueCount(): number {
  return state.stillDue;
}

// FORK (Deviation 9): the parenthesised figure of the queue counter.
export function readUrgentDueCount(): number {
  return state.stillDueUrgent;
}

/**
 * FORK (2026-11-14): the counter's two numbers for a cache snapshot — see `stillDue`.
 * The scope applies as it does to selection: only in a document queue, and only once the
 * scope has been resolved.
 */
function countStillDue(
  all: SlimIncRem[],
  subQueueId: string | undefined,
  scopeSet: Set<RemId> | null
): { due: number; urgent: number } {
  const scoped = !!subQueueId && !!scopeSet;
  const now = Date.now();
  let due = 0;
  let urgent = 0;
  for (const x of all) {
    if (now < x.nextRepDate) continue;
    if (scoped && !scopeSet!.has(x.remId)) continue;
    if (reviewedThisSession.has(x.remId)) continue;
    due++;
    if (x.priority < urgentPriorityLimit) urgent++;
  }
  return { due, urgent };
}

/** FORK (2026-11-14): store the counter's numbers and rewrite the counter when they moved. */
function applyStillDue(plugin: ReactRNPlugin, counts: { due: number; urgent: number }, force = false) {
  const changed = counts.due !== state.stillDue || counts.urgent !== state.stillDueUrgent;
  state.stillDue = counts.due;
  state.stillDueUrgent = counts.urgent;
  if (changed || force) void publishQueueCounter(plugin);
}

/**
 * FORK (2026-11-14): write the counter between GetNextCard calls. GetNextCard writes it on
 * every call, but a review lowers the number before the queue moves on, and a reschedule or
 * a dismissal by command is saved a moment AFTER it has (review jobs) — without this the
 * counter would run one item behind. Never while a gate hides Incremental Rems (GetNextCard
 * clears the counter then), and never outside the queue: leaving it by navigation fires no
 * QueueExit, so this module's state can outlive the queue it was built for.
 */
async function publishQueueCounter(plugin: ReactRNPlugin) {
  if (!state.ready || readGates().blocked) return;
  const forGeneration = generation;
  try {
    const url = await plugin.window.getURL();
    if (forGeneration !== generation || !state.ready || !url.includes('/flashcards')) return;
    writeQueueCounterCss(plugin, state.stillDue, state.stillDueUrgent);
  } catch (e) {
    console.error('[prefetch] counter write failed:', e);
  }
}

/** FORK (2026-11-14): recount from the cache as it is now. */
async function recountStillDue(plugin: ReactRNPlugin) {
  if (!state.ready) return;
  const forGeneration = generation;
  const slim = latestSlim ?? (await plugin.storage.getSession<SlimIncRem[]>(allIncrementalRemSlimKey));
  if (!slim || forGeneration !== generation || !state.ready) return;
  applyStillDue(plugin, countStillDue(slim, state.info?.subQueueId, state.scopeSet));
}

/**
 * FORK (2026-11-15, review): do the counter's numbers hold for `info`? They say what is
 * still due in the session's scope, whatever the queue's mode — so a buffer built for
 * another mode of the SAME queue (QueueEnter primes 'normal'; a document's Practice All and
 * Practice in Order then ask for theirs) leaves them right, and GetNextCard must not blank
 * the counter while it rebuilds.
 */
export function stillDueCountsHoldFor(info: PrefetchQueueInfo): boolean {
  return state.ready && !!state.info && (state.info.subQueueId ?? '') === (info.subQueueId ?? '');
}

export function isPrefetchReadyFor(info: PrefetchQueueInfo): boolean {
  return state.ready && state.buildKey === makeBuildKey(info);
}

/** True when there is something left to serve, deferred spoilers included. */
export function hasPrefetchedCandidate(info: PrefetchQueueInfo): boolean {
  if (!isPrefetchReadyFor(info)) return false;
  const unseen = (list: SlimIncRem[]) => list.some((c) => !state.seen.has(c.remId));
  // FORK (2026-11-15): a held candidate counts — when nothing else is left it is served
  // without waiting (takeHeldEarly), and this is asked by the empty-queue rescue.
  return unseen(state.buffer) || unseen(state.deferredBuffer) || state.held.some((h) => !state.seen.has(h.rem.remId));
}

/**
 * Resolves true once the session is primed and the buffer is built for `info`,
 * false on timeout. Polls module memory only — no bridge traffic. When the
 * primed buffer was built for another mode (QueueEnter primes 'normal'), it
 * requests the build for the real one.
 */
export async function waitForPrimedPrefetch(
  plugin: ReactRNPlugin,
  info: PrefetchQueueInfo,
  timeoutMs: number
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (primed && primedSubQueueId === info.subQueueId) {
      if (isPrefetchReadyFor(info)) return true;
      if (!buildInFlight) void buildQueuePrefetch(plugin, info);
    }
    if (Date.now() >= deadline) return false;
    await new Promise((r) => setTimeout(r, 50));
  }
}

/** FORK (2026-11-14): true while `remId` waits in `held` — it must not be served. */
const isHeld = (remId: RemId) => state.held.some((h) => h.rem.remId === remId);

/**
 * FORK (2026-11-14): the next candidate of `list` that may be served. A seen rem is dropped
 * from the list on the way, as before; a held one is passed over and stays where it is (a
 * rebuild can put it back into a buffer while it waits).
 */
function takeUnseenFrom(list: SlimIncRem[]): SlimIncRem | undefined {
  for (let i = 0; i < list.length; ) {
    const c = list[i];
    if (state.seen.has(c.remId)) {
      list.splice(i, 1);
      continue;
    }
    if (isHeld(c.remId)) {
      i++;
      continue;
    }
    list.splice(i, 1);
    return c;
  }
  return undefined;
}

/**
 * FORK (2026-11-14): held candidates whose grace period ran out without a display report
 * were not shown after all — back to the head of the buffer, in the order they were held.
 */
function releaseHeld() {
  if (state.held.length === 0) return;
  const now = Date.now();
  const expired = state.held.filter((h) => now - h.at >= HELD_GRACE_MS);
  if (expired.length === 0) return;
  state.held = state.held.filter((h) => now - h.at < HELD_GRACE_MS);
  for (const h of expired.reverse()) {
    if (state.seen.has(h.rem.remId)) continue;
    state.buffer = state.buffer.filter((c) => c.remId !== h.rem.remId);
    state.deferredBuffer = state.deferredBuffer.filter((c) => c.remId !== h.rem.remId);
    state.buffer.unshift(h.rem);
    recordQueueEvent('held:released', h.rem.remId);
  }
}

/**
 * FORK (2026-11-15, review): the oldest held candidate, before its grace period is over —
 * for the two moments at which waiting would cost more than it protects:
 *  - RemNote has no flashcards left and nothing else can be served: answering "nothing"
 *    would end the session with a due Incremental Rem never shown. Should the verdict that
 *    held it have been wrong (it IS on screen), it comes back once after its review and the
 *    queue widget's repeat check moves on by itself;
 *  - a 🔄 swap: the rem on screen has just been consumed by the swap, so a held rem is by
 *    definition not the one on screen.
 */
function takeHeldEarly(): SlimIncRem | undefined {
  while (state.held.length > 0) {
    const h = state.held.shift()!;
    state.buffer = state.buffer.filter((c) => c.remId !== h.rem.remId);
    state.deferredBuffer = state.deferredBuffer.filter((c) => c.remId !== h.rem.remId);
    if (state.seen.has(h.rem.remId)) continue;
    recordQueueEvent('held:served-early', h.rem.remId);
    return h.rem;
  }
  return undefined;
}

/**
 * Pops the next verified candidate, or null when the buffer is empty or was
 * built for a different queue (mode or sub-queue changed).
 *
 * The candidate becomes `pending` rather than `seen`: see confirmServed /
 * rollbackServed. Purely synchronous — no awaits anywhere on this path.
 */
export function takePrefetchedCandidate(
  info: PrefetchQueueInfo,
  options?: { allowDeferred?: boolean }
): SlimIncRem | null {
  if (!isPrefetchReadyFor(info)) return null;
  releaseHeld(); // FORK (2026-11-14)
  // A rem can be burned while it sits in a buffer (see noteIncRemDisplayed), and
  // the buffers are only rebuilt later. Skipping it here is the last guard
  // against showing the same IncRem twice in one session.
  const takeUnseen = takeUnseenFrom;
  let next = takeUnseen(state.buffer);
  // FORK (2026-11-15): no flashcards left and nothing else unspoiled — the held one, now.
  if (!next && options?.allowDeferred) next = takeHeldEarly();
  if (!next && (state.cleanExhausted || options?.allowDeferred)) {
    // Nothing unspoiled is left to show instead, so the protection has done all
    // it usefully can: serving the held-back IncRem now beats withholding it for
    // a card that this session is not going to reach anyway.
    next = takeUnseen(state.deferredBuffer);
    if (next && VERBOSE_QUEUE_INJECTION) {
      console.log(
        `🎭 Spoiler protection released ${next.remId} — ` +
          (state.cleanExhausted ? 'no unspoiled candidate remains' : 'no flashcards remain') +
          '.'
      );
    }
  }
  if (!next) return null;
  state.pending = next;
  // Keep the queue counter honest between rebuilds; the next build recomputes it.
  if (state.dueCount > 0) state.dueCount--;
  return next;
}

/**
 * The pending item was confirmed on screen. Burn it: it must not be offered
 * again this session.
 *
 * The session-storage write is fire-and-forget on purpose. It is read by
 * QueueExit (Priority Shield history) and by the weighted-shield precompute,
 * neither of which runs anywhere near this moment, so nothing needs to await it.
 */
export function confirmServed(plugin: ReactRNPlugin) {
  const served = state.pending;
  if (!served) return;
  state.pending = null;
  burn(plugin, served.remId);
}

/**
 * FORK (2026-10-10): true when the pending candidate has been reported on screen by
 * the queue widget (and so burned by noteIncRemDisplayed). verifyPreviousDecision
 * treats such a candidate as shown regardless of what RemNote's counters say.
 */
export function pendingWasDisplayed(): boolean {
  return !!state.pending && state.seen.has(state.pending.remId);
}

/**
 * FORK (Deviation 16, 2026-10-10): the 🔄 "another item" swap. Pops the next unseen
 * verified candidate WITHOUT touching `pending` (RemNote's lookahead for the next
 * slot stays what it is) and burns it immediately — the widgets display it at once,
 * in the slot RemNote is currently showing. Counts drop as for a served item and a
 * refill is scheduled. Returns null when nothing else is due.
 */
export function takeCandidateForSwap(plugin: ReactRNPlugin): SlimIncRem | null {
  if (!state.ready) return null;
  releaseHeld(); // FORK (2026-11-14)
  const takeUnseen = (list: SlimIncRem[]) => takeUnseenFrom(list) ?? null;
  // Spoiler protection's rule, as in takePrefetchedCandidate: a held-back IncRem is
  // only served once no unspoiled candidate is left.
  const next =
    takeUnseen(state.buffer) ??
    takeHeldEarly() ?? // FORK (2026-11-15): a held rem is not the one on screen — see takeHeldEarly
    (state.cleanExhausted ? takeUnseen(state.deferredBuffer) : null);
  if (!next) return null;
  burn(plugin, next.remId);
  if (state.dueCount > 0) state.dueCount--;
  // FORK (2026-11-15, R-039): a run of 🔄 presses can empty the buffer too.
  if (state.info && !refillNowIfDry(plugin, state.info)) scheduleQueuePrefetchRefill(plugin, state.info);
  return next;
}

function burn(plugin: ReactRNPlugin, remId: RemId) {
  state.seen.add(remId);
  void plugin.storage
    .setSession(seenRemInSessionKey, Array.from(state.seen))
    .catch((e) => console.error('[prefetch] seen write-through failed:', e));
}

/**
 * Late confirmation: the queue widget reported that `remId` is on screen.
 *
 * GetNextCard verification runs from RemNote's preload, which fires as soon as
 * an item is popped — before our widget has even mounted — and it can only read
 * queue counters. So a rem judged "dropped" there may in fact be on screen a
 * moment later. If it is sitting in a buffer (rolled back), it goes out of it
 * now and is burned, instead of being served a second time.
 *
 * `pending` is left alone: a rem that is pending AND displayed is the one the
 * user is reading while RemNote already holds it for the next slot, and a
 * returned item cannot be taken back.
 */
function noteIncRemDisplayed(plugin: ReactRNPlugin, remId: RemId) {
  // FORK (2026-11-14): display reports go into the queue's event record — once per item: the
  // widget writes the key again whenever it re-renders, and repeats would crowd the record.
  if (remId !== lastDisplayedRecorded) {
    lastDisplayedRecorded = remId;
    recordQueueEvent('displayed', remId, {
      seen: state.seen.has(remId),
      pending: state.pending?.remId === remId,
    });
  }
  if (state.seen.has(remId)) return;
  if (state.pending?.remId === remId) {
    // FORK (2026-10-10): the pending candidate is on screen — it is consumed, whatever
    // RemNote's counters say at the next GetNextCard. Burn it now (it stays `pending`
    // so the confirm/rollback bookkeeping completes normally), so that neither a
    // "same slot asked again" nor a "dropped" verdict can roll a rem the user is
    // already reading back onto the buffer and serve it a second time — the
    // "Already reviewed right after Next" symptom. See pendingWasDisplayed.
    burn(plugin, remId);
    return;
  }
  // FORK (2026-11-14): a rolled-back candidate that is on screen after all. The verdict
  // that rolled it back was wrong; it was shown, so it is consumed. Its count comes off
  // again (the rollback had put it back).
  if (isHeld(remId)) {
    state.held = state.held.filter((h) => h.rem.remId !== remId);
    state.buffer = state.buffer.filter((c) => c.remId !== remId);
    state.deferredBuffer = state.deferredBuffer.filter((c) => c.remId !== remId);
    if (state.dueCount > 0) state.dueCount--;
    burn(plugin, remId);
    recordQueueEvent('held:on-screen', remId);
    return;
  }
  const inBuffer = (list: SlimIncRem[]) => list.some((c) => c.remId === remId);
  const wasBuffered = inBuffer(state.buffer) || inBuffer(state.deferredBuffer);
  if (!wasBuffered) {
    // FORK (2026-11-15, reproduced live): on screen, and unknown to the prefetch — a reset
    // (queue entry, a restart) forgot that RemNote held it. Upstream let it be, and the next
    // build could serve it again: the same item twice in one session. Displayed ⇒ seen.
    burn(plugin, remId);
    recordQueueEvent('displayed:unknown', remId);
    return;
  }
  state.buffer = state.buffer.filter((c) => c.remId !== remId);
  state.deferredBuffer = state.deferredBuffer.filter((c) => c.remId !== remId);
  if (state.dueCount > 0) state.dueCount--;
  burn(plugin, remId);
  console.log(
    `🩹 IncRem ${remId} was on screen after all — removed from the prefetch buffer so it is not served again.`
  );
}

/**
 * FORK (2026-10-11, review, reproduced live): mark rems as seen that were on screen in this
 * session before the plugin restarted. The activation bootstrap re-runs queue entry, which
 * empties the seen list and rebuilds the buffers (Deviation 15's re-activation residue), so
 * such a rem could be served once more. That residue became visible with a 🔄 swap, which now
 * survives the restart: the set-aside rem was served again, and the surviving swap showed the
 * swapped-in rem in its place, already reviewed. Takes each rem out of the buffers and counts
 * as noteIncRemDisplayed does, and burns it even when no buffer holds it.
 */
export function markShownThisSession(plugin: ReactRNPlugin, remIds: RemId[]) {
  for (const remId of remIds) {
    if (state.seen.has(remId)) continue;
    state.held = state.held.filter((h) => h.rem.remId !== remId); // FORK (2026-11-14)
    const wasBuffered =
      state.buffer.some((c) => c.remId === remId) || state.deferredBuffer.some((c) => c.remId === remId);
    if (wasBuffered) {
      state.buffer = state.buffer.filter((c) => c.remId !== remId);
      state.deferredBuffer = state.deferredBuffer.filter((c) => c.remId !== remId);
      if (state.dueCount > 0) state.dueCount--;
    }
    burn(plugin, remId);
  }
}

/**
 * Commits any still-unconfirmed item at queue exit.
 *
 * Confirmation normally arrives on the FOLLOWING GetNextCard call, which never
 * comes for the last item of a session. Without this, an IncRem reviewed as the
 * final item would be missing from the seen list that QueueExit reads to save
 * the Priority Shield history. Awaited, unlike the in-session write-through,
 * because QueueExit reads that key moments later.
 *
 * If that last injection was in fact dropped, this marks a rem seen that was
 * never displayed — harmless, since the session is over and the list has no
 * remaining gatekeeping role.
 */
/**
 * FORK (2026-11-15, reproduced live): the rems this queue visit has handed to RemNote — seen
 * (confirmed, or reported on screen) and the one RemNote holds for its next slot. QueueEnter's
 * handler resets the prefetch and primes it again, and RemNote can ask for items before it gets
 * there; the handler takes these before each reset and marks them seen after it
 * (register/events.ts, runQueueEnter). A visit ends when the URL leaves the queue or QueueExit
 * fires, both of which reset this state, so nothing of an earlier visit is in it.
 */
export function shownInThisVisit(): RemId[] {
  const ids = new Set(state.seen);
  if (state.pending) ids.add(state.pending.remId);
  return Array.from(ids);
}

export async function flushPendingServed(plugin: ReactRNPlugin): Promise<void> {
  if (!state.pending) return;
  state.seen.add(state.pending.remId);
  state.pending = null;
  try {
    await plugin.storage.setSession(seenRemInSessionKey, Array.from(state.seen));
  } catch (e) {
    console.error('[prefetch] final seen flush failed:', e);
  }
}

/**
 * The pending item never reached the screen — RemNote consumed a flashcard
 * instead. Put it back at the head of the buffer so the next injection
 * opportunity retries it.
 *
 * Before this existed, a dropped injection still wrote the rem into the seen
 * list, permanently removing a due IncRem from the session that the user never
 * laid eyes on. That was visible in the logs as `filtered` counting down 8 → 7 →
 * 6 while `seenRemIds` climbed, and it is what turned an occasional timeout into
 * "incremental rems have stopped appearing".
 */
export function rollbackServed(): SlimIncRem | null {
  const served = state.pending;
  if (!served) return null;
  state.pending = null;
  // FORK (2026-10-10): a candidate the queue widget has displayed is burned
  // (noteIncRemDisplayed) and must never go back on the buffer — it was shown,
  // so the counter bookkeeping that already dropped it stands.
  if (state.seen.has(served.remId)) return null;
  recordQueueEvent('rollback', served.remId); // FORK (2026-11-14)
  // FORK (2026-11-14): not straight back to the head of the buffer — see `held`. The call
  // that rolled it back serves the candidate after it; this one returns when its grace
  // period ends, unless the queue widget reports it on screen first.
  state.held.push({ rem: served, at: Date.now() });
  state.dueCount++;
  return served;
}

// ---------------------------------------------------------------------------
// Background preparation — everything below runs off the critical path
// ---------------------------------------------------------------------------

/**
 * Refreshes the blocking-gate mirrors.
 *
 * `incRemDisabledDeviceKey` lives in LOCAL storage, which `plugin.track` does
 * not treat as a reactive dependency (only getSession/getSynced are), so it
 * cannot be kept live by subscription — it is refreshed here on every rebuild
 * instead, leaving it at most one queue item stale. Toggling the device switch
 * mid-queue therefore takes effect from the following item, which is well within
 * what that control implies.
 */
async function refreshGates(plugin: ReactRNPlugin) {
  const [timerEnd, deviceDisabled] = await Promise.all([
    plugin.storage.getSynced<number>(noIncRemTimerKey),
    plugin.storage.getLocal<boolean>(incRemDisabledDeviceKey),
  ]);

  state.deviceDisabled = !!deviceDisabled;

  if (timerEnd && timerEnd > Date.now()) {
    state.timerEndsAt = timerEnd;
  } else {
    state.timerEndsAt = null;
    if (timerEnd) {
      // Expired — clear it, as the old inline gate check did. Fire-and-forget:
      // the in-memory mirror is already correct, so nothing waits on this.
      void plugin.storage
        .setSynced(noIncRemTimerKey, null)
        .catch((e) => console.error('[prefetch] timer clear failed:', e));
    }
  }
}

type Verdict =
  /** A genuine IncRem with nothing of its own due in the flashcard queue. */
  | 'ok'
  /** A genuine IncRem, but one of its own cards is due — hold it back. */
  | 'spoiler'
  /** No longer an IncRem (un-incrementalised, deleted), or the read threw. */
  | 'invalid';

/**
 * Resolves the `cloze-extract` tag Rem, or null when the KB has none yet.
 *
 * It is a plain named Rem, not a powerup — `register/commands.ts` creates it
 * lazily the first time "Extract as cloze" runs — so a user who has never used
 * Alt+Z simply has no such tag and the child check is skipped entirely. Resolved
 * once per build rather than per candidate: it is one round-trip on a path that
 * already issues dozens, and re-reading it each build means a tag created (or
 * recreated) mid-session is picked up by the next rebuild without any cache to
 * invalidate.
 */
async function resolveClozeExtractTagId(plugin: ReactRNPlugin): Promise<RemId | null> {
  try {
    const tag = await plugin.rem.findByName(['cloze-extract'], null);
    return tag?._id ?? null;
  } catch (e) {
    console.error('[prefetch] cloze-extract tag lookup failed:', e);
    return null;
  }
}

/**
 * True when a DIRECT child of `rem` carries the `cloze-extract` tag and owns a
 * card RemNote would schedule right now.
 *
 * Membership is read per child (`getTagRems`) rather than from the tag's
 * `taggedRem()` member list, for two independent reasons.
 *
 * CORRECTNESS first: `taggedRem()` under-reports. On a KB holding thousands of
 * Extra Card Detail Rems it enumerated THREE while `hasPowerup` returned true on
 * those same Rems — see the finding recorded in lib/empty_ecd_scan.ts. A gate
 * built on it would silently stop protecting most of the graph, and silence is
 * the one failure mode this subsystem cannot afford. The under-reporting is a
 * BUILT-IN POWERUP problem, though, and `cloze-extract` is neither built-in nor
 * a powerup — register/commands.ts creates it as a plain Rem and attaches it
 * with addTag() — which is precisely the case that same finding says
 * `getTagRems()` reports correctly. Confirmed on a real dual-extract parent: the
 * probe found both tagged children.
 *
 * COST second: the member list would be one call instead of many, but it returns
 * every cloze extract in the KB — thousands of Rems on a mature graph —
 * deserialized across the bridge on every rebuild, which is the kind of cost
 * this module exists to keep out of a study session. A candidate's children are
 * a handful of Rems and they are read concurrently, so the wall time is one
 * round-trip deep regardless of fan-out.
 *
 * Fails OPEN, like the own-cards gate: a read that throws reports "no spoiler"
 * and the IncRem is shown, rather than being silently withheld.
 */
async function hasDueClozeExtractChild(
  rem: PluginRem,
  clozeExtractTagId: RemId,
  now: number
): Promise<boolean> {
  try {
    const children = (await rem.getChildrenRem()) || [];
    if (children.length === 0) return false;
    const spoils = await Promise.all(
      children.map(async (child: PluginRem) => {
        const tags = await child.getTagRems();
        if (!tags?.some((t: PluginRem) => t._id === clozeExtractTagId)) return false;
        const cards = await child.getCards();
        // Same predicate as the own-cards gate, for the same reasons: a disabled
        // direction is absent from getCards() entirely, and a never-practiced
        // cloze carries a real nextRepetitionTime, so a freshly extracted cloze
        // counts as due — the case that matters most, since the extract would be
        // giving away an answer the user has never recalled.
        return cards.some((c) => (c.nextRepetitionTime ?? Infinity) <= now);
      })
    );
    return spoils.some(Boolean);
  } catch (e) {
    console.error('[prefetch] cloze-extract child check failed for', rem._id, e);
    return false;
  }
}

/**
 * Decides whether a candidate is still a genuine Incremental Rem, and — when
 * spoiler protection is on — whether showing it now would give away a flashcard
 * the queue still owes the user.
 *
 * This is the expensive part — roughly eleven serial SDK round-trips per
 * candidate (hasPowerup, two Daily-Doc resolutions of three calls each, the
 * history slot, and the priority slot plus its rich-text conversion), measured
 * at 114–231ms. It used to run inside GetNextCard, between the decision and the
 * return. Here it runs while the user is reading.
 *
 * Both spoiler reads — the rem's own cards, and the cloze-extract child walk —
 * are issued CONCURRENTLY with the IncRem verification rather than after it, so
 * protection costs no additional wall time, only more in-flight requests on a
 * path that already has eleven.
 *
 * SCOPE: the rem's own cards, PLUS the cards of its direct children tagged
 * `cloze-extract` — the clozes that "Extract as cloze" (Alt+Z) carves out of an
 * extract and files directly underneath it. Those children quote the parent's
 * sentence verbatim with one span blanked out, so the parent spoils them exactly
 * as it spoils its own cards; before this, an IncRem with no cards of its own
 * sailed through the gate and gave away every cloze extracted from it.
 *
 * Deeper descendants and untagged children remain out of scope. The tag is what
 * makes this affordable: it identifies the spoiling children without walking the
 * subtree, which would need getDescendants() per candidate — a different order
 * of cost that wants a cache of its own.
 */
async function verifyCandidate(
  plugin: ReactRNPlugin,
  candidate: SlimIncRem,
  checkSpoiler: boolean,
  clozeExtractTagId: RemId | null
): Promise<Verdict> {
  try {
    const rem = await plugin.rem.findOne(candidate.remId);
    if (!rem) return 'invalid';
    const now = Date.now();
    const [incRem, cards, clozeChildSpoils] = await Promise.all([
      getIncrementalRemFromRem(plugin, rem),
      checkSpoiler ? rem.getCards() : Promise.resolve([]),
      checkSpoiler && clozeExtractTagId
        ? hasDueClozeExtractChild(rem, clozeExtractTagId, now)
        : Promise.resolve(false),
    ]);
    if (!incRem) return 'invalid';
    if (!checkSpoiler) return 'ok';
    if (clozeChildSpoils) return 'spoiler';

    // Two things had to be true for this gate to be safe, and both were measured
    // on real rems (debug widget → "Probe Spoiler State") rather than assumed:
    //
    // 1. A DISABLED direction cannot strand its IncRem. Turning a two-way card
    //    down to forward-only removes the backward card from getCards()
    //    ENTIRELY — a rem that reported 3 cards reported 2 afterwards, and the
    //    dropped one kept its 7 reps and its 2029 due date. So the disabled card
    //    is never seen by the predicate at all; it cannot hold the rem back in
    //    session after session with no card ever appearing to release it. Note
    //    this is a stronger guarantee than the "disabled cards have a null
    //    nextRepetitionTime" convention documented in lib/card_priority — the
    //    card is absent, not null — but the `?? Infinity` below keeps the two in
    //    agreement either way, and divergence would mean the queue and the
    //    shields disagreed about what "due" means.
    //
    // 2. A NEW card DOES trigger protection. Never-practiced cards carry a real
    //    nextRepetitionTime (their creation instant), not null, so a fresh
    //    flashcard on the same rem counts as due and its extract is held back —
    //    which is the case that matters most, since nothing has been recalled
    //    yet for the extract to spoil.
    //
    // `?? Infinity` therefore covers only genuinely unscheduled cards, and it
    // fails OPEN: an unrecognised state shows the IncRem rather than hiding it.
    return cards.some((c) => (c.nextRepetitionTime ?? Infinity) <= now) ? 'spoiler' : 'ok';
  } catch (e) {
    console.error('[prefetch] verify failed for', candidate.remId, e);
    return 'invalid';
  }
}

/**
 * Rebuilds the candidate buffer from scratch: read caches, sort, filter, run the
 * priority-weighted lottery, then verify the top candidates in parallel.
 *
 * The selection semantics are deliberately identical to the old inline
 * implementation — same sort key, same lottery, same exclusion of already-seen
 * rems — so this is a change of WHEN the work happens, not WHAT it decides.
 * (FORK, 2026-10-11: one difference since — only due rems, in every mode; see the
 * filter below.)
 */
export async function buildQueuePrefetch(
  plugin: ReactRNPlugin,
  info: PrefetchQueueInfo
): Promise<void> {
  if (buildInFlight) {
    // Don't drop the request. Queue-entry priming in particular arrives while an
    // opportunistic build may still be running against a not-yet-resolved scope;
    // silently discarding it would leave the session on that stale buffer.
    rebuildRequested = info;
    return;
  }
  buildInFlight = true;
  const builtForGeneration = generation;
  const startedAt = Date.now();
  try {
    await refreshGates(plugin);

    const [slimRaw, scopeRaw, cardsPerRem, sortingRandomness, weightK, deferSpoilers] =
      await Promise.all([
        plugin.storage.getSession<SlimIncRem[]>(allIncrementalRemSlimKey),
        plugin.storage.getSession<RemId[] | null>(currentScopeRemIdsKey),
        getCardsPerRem(plugin),
        getSortingRandomness(plugin),
        getWeightSelectionK(plugin),
        getIESetting(plugin, deferSpoilerIncRemsId),
      ]);

    state.cardsPerRem = cardsPerRem;

    // Selection reads the slim projection — remId/nextRepDate/priority only —
    // which is roughly a tenth of the full cache's 7.99MB. The full key is the
    // fallback for the window before the first cache load under this version has
    // written the slim one; `IncrementalRem` is structurally a `SlimIncRem`, so
    // no mapping is needed.
    let allIncRems: SlimIncRem[];
    if (slimRaw) {
      allIncRems = slimRaw;
    } else {
      allIncRems = (await plugin.storage.getSession<IncrementalRem[]>(allIncrementalRemKey)) || [];
    }
    // Same fallback the inline version used: while QueueEnter is still resolving
    // a document scope, select from the full KB rather than blocking. The scope
    // lands within a few seconds and later rebuilds pick it up.
    const scope = scopeRaw;
    const scopeSet = scope ? new Set(scope) : null;

    // FORK (bug-hunt #15): hoist the scope position lookup out of
    // the sort projection. `_` is remeda, which re-runs projections per comparison
    // with no memoisation, so `scope.indexOf(...)` inside made this ~2·N·log₂N
    // linear scans of the scope array.
    const scopeIndex = scope ? new Map(scope.map((id, i) => [id, i])) : null;

    // FORK (Deviation 10): `nextRepDate` ASCENDING as the secondary key, so that
    // among equal priorities the MOST OVERDUE item comes first. Without it, ties
    // fall back to arbitrary KB load order.
    //
    // ⚠️ `_` is REMEDA, not lodash: projections are passed as SEPARATE ARGUMENTS.
    // `_.sortBy(arr, [f1, f2])` makes remeda read the array as a [projection, order]
    // pair and throw "comparator is not a function", crashing selection so that NO
    // IncRems appear in the queue. That was the 9e2a2bb bug — do not reintroduce it.
    //
    // In 'in-order' mode the scope index is unique per rem, so the tiebreak never
    // engages there.
    const sorted = _.sortBy(
      allIncRems,
      (incRem) => {
        if (info.mode === 'in-order' && scopeIndex) {
          return scopeIndex.get(incRem.remId) ?? Infinity;
        }
        return incRem.priority;
      },
      (incRem) => incRem.nextRepDate
    );

    const now = Date.now();
    const excluded = state.pending ? new Set([...state.seen, state.pending.remId]) : state.seen;
    // FORK (2026-10-11, owner decision, reproduced live): only due Incremental Rems, in
    // every mode. Upstream served every Incremental Rem in scope in a document's Practice
    // All and Practice in Order, due or not — and the fork shows an item that is not due
    // with its already-reviewed row (Deviation 8), so those items could not be reviewed at
    // all. 'in-order' keeps its document order (the sort above).
    const filtered = sorted.filter((x) => {
      if (info.subQueueId && scopeSet && !scopeSet.has(x.remId)) return false;
      if (excluded.has(x.remId)) return false;
      return now >= x.nextRepDate;
    });

    // In 'in-order' mode `filtered` is in document order, not priority order, so
    // the lottery must not touch it — same carve-out as before.
    if (info.mode !== 'in-order') {
      applyPriorityWeightedLottery(filtered, sortingRandomness, weightK);
    }

    // Spoiler protection applies to the normal queue only. In practice-all and
    // in-order every card in scope is going to be shown regardless of its due
    // date, so "has a due card" is true of every dual-type rem at once and the
    // gate would demote all of them for the whole session — a filter with no
    // release condition. Those modes also aren't where the measurement matters:
    // the user is drilling, not being scored by the scheduler.
    const checkSpoiler = deferSpoilers && info.mode === 'normal';

    // Resolved here, once, so the per-candidate child check is a tag-id compare
    // rather than a lookup. Null when the KB has no cloze-extract tag yet, which
    // switches the child check off without costing anything per candidate.
    const clozeExtractTagId = checkSpoiler ? await resolveClozeExtractTagId(plugin) : null;

    // Verify from the front in windows, keeping order, until the buffer is full
    // or we run out of candidates. Parallel within a window because these are
    // independent reads and this is off the critical path anyway.
    const verified: SlimIncRem[] = [];
    const deferred: SlimIncRem[] = [];
    let cursor = 0;
    let cleanExhausted = false;
    for (let round = 0; round < MAX_VERIFY_ROUNDS && verified.length < BUFFER_TARGET; round++) {
      const window = filtered.slice(cursor, cursor + (BUFFER_TARGET - verified.length));
      if (window.length === 0) {
        // Walked the whole eligible list. Anything sitting in `deferred` is now
        // the best there is; takePrefetchedCandidate is allowed to fall through
        // to it.
        cleanExhausted = true;
        break;
      }
      cursor += window.length;
      const results = await Promise.all(
        window.map((c) => verifyCandidate(plugin, c, checkSpoiler, clozeExtractTagId))
      );
      window.forEach((candidate, i) => {
        if (results[i] === 'ok') verified.push(candidate);
        else if (results[i] === 'spoiler') deferred.push(candidate);
      });
    }

    if (builtForGeneration !== generation) {
      if (VERBOSE_QUEUE_INJECTION) {
        console.log('🧰 Prefetch build discarded — the queue session changed while it ran.');
      }
      return;
    }

    state.buffer = verified;
    state.deferredBuffer = deferred;
    state.cleanExhausted = cleanExhausted;
    // Deferred rems ARE still due — they are postponed within the session, not
    // excluded from it — so they stay in the counter.
    state.dueCount = filtered.length;
    // FORK (2026-11-15): the first build of a session, and a build for another queue than
    // the last one, always write the counter (GetNextCard may have cleared it meanwhile).
    const mustPublish = !state.ready || state.buildKey !== makeBuildKey(info);
    state.buildKey = makeBuildKey(info);
    state.info = info; // FORK (Deviation 16)
    state.ready = true;
    // FORK (2026-11-14): the counter's numbers — every due rem in scope, served or not.
    // Counted from the cache as it is NOW (2026-11-15, review): this build read the cache
    // when it started, and a Skip with an offset, a reschedule or a dismissal saved while it
    // ran was recounted by tracker (a) and then overwritten here with the older number.
    state.scopeSet = scopeSet;
    applyStillDue(plugin, countStillDue(latestSlim ?? allIncRems, info.subQueueId, scopeSet), mustPublish);

    if (VERBOSE_QUEUE_INJECTION) {
      console.log(
        `🧰 Prefetch built for [${state.buildKey}] in ${Date.now() - startedAt}ms: ` +
          `${verified.length} verified of ${filtered.length} eligible (${allIncRems.length} cached)` +
          (checkSpoiler
            ? `, ${deferred.length} held back as spoilers` +
              (deferred.length ? ` [${deferred.map((d) => d.remId).join(', ')}]` : '') +
              (cleanExhausted ? ' (no unspoiled candidate left)' : '')
            : '') +
          '.'
      );
    }
  } catch (e) {
    console.error('[prefetch] build failed:', e);
  } finally {
    buildInFlight = false;
    const queued = rebuildRequested;
    if (queued) {
      rebuildRequested = null;
      void buildQueuePrefetch(plugin, queued);
    }
  }
}

/**
 * Queues a rebuild after REFILL_DELAY_MS. Repeated calls collapse into one, so a
 * burst of queue activity does not stack rebuilds.
 */
export function scheduleQueuePrefetchRefill(plugin: ReactRNPlugin, info: PrefetchQueueInfo) {
  if (refillTimer) clearTimeout(refillTimer);
  refillTimer = setTimeout(() => {
    refillTimer = null;
    void buildQueuePrefetch(plugin, info);
  }, REFILL_DELAY_MS);
}

/**
 * FORK (2026-11-15, R-039, reproduced live): refill at once when the buffer has run dry while
 * more Incremental Rems are due, instead of REFILL_DELAY_MS after the LAST GetNextCard call.
 *
 * The scheduled refill waits for a pause, and every call restarts the wait. Skipping (or 🔄)
 * faster than that — one item per half second in a document with eight due Incremental Rems
 * and no flashcards — emptied the three-candidate buffer after three items: the next answer
 * was "nothing", RemNote showed its finished screen with five still due, and the refill that
 * came a moment later reached nobody. A refill when the buffer is dry costs no more than the
 * scheduled one it replaces; at a reading pace the scheduled refill has topped the buffer up
 * long before it can run dry, so this does not fire.
 *
 * Returns true when it started a build (or queued one behind a build in flight).
 */
export function refillNowIfDry(plugin: ReactRNPlugin, info: PrefetchQueueInfo): boolean {
  if (!isPrefetchReadyFor(info)) return false;
  // `dueCount` is upstream's count: due, in scope, not yet served — what a build could still find.
  if (state.dueCount <= 0) return false;
  if (state.buffer.some((c) => !state.seen.has(c.remId) && !isHeld(c.remId))) return false;
  if (refillTimer) {
    clearTimeout(refillTimer);
    refillTimer = null;
  }
  recordQueueEvent('refill:now', null, { dueCount: state.dueCount });
  void buildQueuePrefetch(plugin, info);
  return true;
}

/**
 * Primes state at queue entry, before the first GetNextCard call arrives.
 *
 * Called from the QueueEnter handler as soon as the document scope is in session
 * storage — the build reads nothing else that QueueEnter computes, so it does not
 * wait for the priority and shield calculations that follow. The queue mode is not part
 * of the QueueEnter payload, so this primes for 'normal'; if the session turns
 * out to be practice-all or in-order, the first GetNextCard sees the build-key
 * mismatch and triggers a rebuild for the real mode.
 */
export async function primeQueuePrefetch(plugin: ReactRNPlugin, subQueueId: string | undefined) {
  resetQueuePrefetch();
  const primedGeneration = generation;
  await buildQueuePrefetch(plugin, { mode: 'normal', subQueueId });
  // Marked even when the build was queued behind one in flight rather than run:
  // the scope is in session storage by now, so every build from here on is
  // scoped. waitForPrimedPrefetch still waits for `ready` before trusting it.
  if (primedGeneration === generation) {
    primed = true;
    primedSubQueueId = subQueueId;
  }
}

/**
 * Keeps the no-IncRem timer mirror live. Synced storage IS a reactive dependency
 * for plugin.track, so setting the timer from anywhere updates the gate at once
 * rather than waiting for the next rebuild.
 */
export function registerPrefetchTrackers(plugin: ReactRNPlugin) {
  plugin.track(async (rp) => {
    const timerEnd = await rp.storage.getSynced<number>(noIncRemTimerKey);
    state.timerEndsAt = timerEnd && timerEnd > Date.now() ? timerEnd : null;
  });

  // The queue widget writes this key when it mounts (only the widget writes it;
  // QueueExit clears it). The tracker fires on change only, so the same rem
  // shown twice in a row is not reported — which is fine: by then it is burned.
  plugin.track(async (rp) => {
    const remId = await rp.storage.getSession<RemId>(currentIncRemKey);
    if (remId) {
      bumpQueueTurn(); // FORK (2026-11-15, review 3 #1): see lib/queue_turn.ts
      noteIncRemDisplayed(plugin, remId);
    }
  });

  // FORK (2026-11-14): the counter shows what is still due (see `stillDue`). Three things
  // move it between builds.
  // (a) The cache changed: a review, a reschedule, a dismissal, a new or re-dated Incremental
  //     Rem, a priority crossing the urgent limit. The read is the subscription; outside a
  //     queue session nothing is computed.
  plugin.track(async (rp) => {
    const slim = await rp.storage.getSession<SlimIncRem[]>(allIncrementalRemSlimKey);
    latestSlim = slim || null; // FORK (2026-11-15): what the other recounts count from
    if (!slim || !state.ready) return;
    applyStillDue(plugin, countStillDue(slim, state.info?.subQueueId, state.scopeSet));
  });
  // (b) A review was recorded (updateReviewRemData and the offset picker write this mark).
  //     The rem joins the session's reviewed list, which this widget alone writes.
  plugin.track(async (rp) => {
    const left = await rp.storage.getSession<QueueLeftAfterReview | null>(queueLeftAfterReviewKey);
    if (!left || Date.now() - left.at > REVIEW_MARK_MAX_AGE_MS || reviewedThisSession.has(left.remId)) return;
    // FORK (2026-11-15, review): add to the list as STORED, not only as remembered. Right
    // after a plugin restart memory is empty while the session key still holds the list, and
    // a mark young enough to count then wrote a list of one over it — before (c) had read it
    // back. (`plugin`, not `rp`: this tracker must not subscribe to the list.)
    const stored = await plugin.storage.getSession<RemId[] | null>(queueReviewedInSessionKey);
    for (const remId of stored || []) reviewedThisSession.add(remId);
    reviewedThisSession.add(left.remId);
    void plugin.storage
      .setSession(queueReviewedInSessionKey, Array.from(reviewedThisSession))
      .catch((e) => console.error('[prefetch] reviewed-list write failed:', e));
    await recountStillDue(plugin);
  });
  // (c) The reviewed list itself: emptied when a queue session starts or ends, and read back
  //     here after a plugin restart.
  plugin.track(async (rp) => {
    const list = await rp.storage.getSession<RemId[] | null>(queueReviewedInSessionKey);
    reviewedThisSession = new Set(list || []);
    await recountStillDue(plugin);
  });

  // FORK (2026-11-14): the queue widget skipped a repeat (widgets/queue.tsx). That should
  // not happen any more — say so in the console, once, with what the queue did before it.
  let lastRepeatAt = 0;
  plugin.track(async (rp) => {
    const hit = await rp.storage.getSession<{ remId: RemId; at: number } | null>(queueRepeatSkippedKey);
    // The key is never cleared, so the first run after a plugin restart sees an old hit:
    // only one that is fresh is news (review, 2026-11-15).
    if (!hit || hit.at === lastRepeatAt || Date.now() - hit.at > REPEAT_REPORT_MAX_AGE_MS) return;
    lastRepeatAt = hit.at;
    recordQueueEvent('repeat:reported', hit.remId);
    console.warn(
      `[IncRem queue] ${hit.remId} was shown again right after its review, and the repeat was skipped. ` +
        `Recent queue events ("Incremental: Copy Queue Diagnostics" copies them):\n` +
        (await formatQueueDiagnostics(plugin))
    );
  });

  // FORK (Deviation 16, 2026-10-10): the 🔄 "another item" request. The widgets cannot
  // reach this module's buffer, so they post a request key; this answers it by
  // serving the next verified candidate into the slot RemNote is currently showing.
  // `slotRemId` is RemNote's own rem for that slot: if the slot was already swapped,
  // the request names the rem currently shown, and the slot is read off the
  // existing override. The request is the ONLY reactive read here — the answer key
  // is read and written through `plugin.storage`, so answering does not re-run this
  // tracker; the nonce guard covers a re-run that sees the same request again.
  let lastSwapNonce: string | null = null;
  plugin.track(async (rp) => {
    const req = await rp.storage.getSession<QueueSwapRequest | null>(queueSwapRequestKey);
    if (!req || req.nonce === lastSwapNonce) return;
    lastSwapNonce = req.nonce;
    const current = await plugin.storage.getSession<QueueSlotSwap | null>(queueSlotSwapKey);
    // FORK (2026-10-11, review, reproduced live): an answered request stays in session storage,
    // and lastSwapNonce starts empty again when the plugin restarts — so the tracker's first run
    // after a restart answered the old request once more, replacing the swap on screen (there:
    // with "none", putting the set-aside item back). The answer carries its request's nonce.
    if (current?.nonce === req.nonce) return;
    const slotRemId =
      current && current.showRemId === req.currentRemId ? current.slotRemId : req.currentRemId;
    // The rem being set aside is on screen: consume it for the session BEFORE taking a
    // candidate. Normally it already is (served → confirmed → seen), but a rem can reach
    // the screen without that bookkeeping — the plugin re-activating mid-item resets the
    // session and rebuilds the buffer with the displayed rem in it, unseen. Without this
    // it could be "swapped in" for itself (observed in-app 2026-10-10). noteIncRemDisplayed
    // also takes it out of the buffers and the counts if it is sitting there.
    noteIncRemDisplayed(plugin, req.currentRemId);
    for (const id of [req.currentRemId, slotRemId]) {
      if (!state.seen.has(id)) burn(plugin, id);
    }
    let next = takeCandidateForSwap(plugin);
    // The buffer holds only a few verified candidates. Empty while more are due
    // (dueCount counts eligible, unseen rems) means "not verified yet", not "none":
    // rebuild and wait for one rather than answer "nothing else due". The caller
    // waits up to 3 s; this gives the build 2 s.
    if (!next && state.info && state.dueCount > 0) {
      void buildQueuePrefetch(plugin, state.info);
      const until = Date.now() + 2000;
      while (!next && Date.now() < until) {
        await new Promise((r) => setTimeout(r, 100));
        next = takeCandidateForSwap(plugin);
      }
    }
    if (next) void plugin.storage.setSession(incremReviewStartTimeKey, Date.now());
    await plugin.storage.setSession(queueSlotSwapKey, {
      slotRemId,
      showRemId: next?.remId ?? null,
      nonce: req.nonce,
    });
    if (VERBOSE_QUEUE_INJECTION) {
      console.log(`🔄 swap request for slot ${slotRemId}: ${next ? 'serving ' + next.remId : 'nothing else due'}`);
    }
  });

  // Seed the non-session mirrors at activation so the very first GetNextCard of
  // the very first queue already reads real values rather than defaults.
  //
  // Deliberately NOT inside a plugin.track: getCardsPerRem calls
  // kb.getCurrentKnowledgeBaseData(), and subscribing the tracker to that would
  // re-run this on unrelated KB churn. A one-shot read at activation plus the
  // refresh inside every build keeps it current — the setting only changes by
  // deliberate user action, and a change mid-queue lands on the next rebuild.
  void (async () => {
    try {
      const [cardsPerRem, deviceDisabled] = await Promise.all([
        getCardsPerRem(plugin),
        plugin.storage.getLocal<boolean>(incRemDisabledDeviceKey),
      ]);
      state.cardsPerRem = cardsPerRem;
      state.deviceDisabled = !!deviceDisabled;
    } catch (e) {
      console.error('[prefetch] activation seed failed:', e);
    }
  })();
}
