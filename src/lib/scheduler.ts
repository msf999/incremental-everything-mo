import { PluginRem, RNPlugin } from '@remnote/plugin-sdk';
import { nextRepDateSlotCode, powerupCode, repHistorySlotCode } from './consts';
import { IncrementalRep } from './incremental_rem';
import { repCountsForScheduling } from './incremental_rem/types';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { getIncrementalRemFromRem } from './incremental_rem';
import { getDailyDocReferenceForDate, tryParseJson } from './utils';
import { getRemSchedulerInfo } from './scheduler_choice';
import {
  automaticRepeatIndexes,
  calendarDaysBetween,
  computeNextInterval,
  getCurrentInterval,
  isSameDayRepeat,
  ResolvedScheduler,
  SchedulerChoice,
  sameDayRepeatIndexes,
} from './scheduler_core';
import { getIESetting } from './settings';
import { ignoreSameDayReviewsId } from './consts';
dayjs.extend(relativeTime);

function removeResponsesBeforeEarlyResponses(history: IncrementalRep[]) {
  const cleansedHistory = [];
  for (let i = 0; i < history.length; i++) {
    // Always preserve event markers - they should never be filtered by early response logic
    const eventType = history[i].eventType;
    if (eventType === 'madeIncremental' ||
      eventType === 'dismissed' ||
      eventType === 'rescheduledInEditor' ||
      eventType === 'manualDateReset') {
      cleansedHistory.push(history[i]);
      continue;
    }

    // The response is the next REVIEW: a reschedule, a date edit or a priority
    // change after a review says nothing about whether it was early, and used to
    // make the review before it drop out of the count.
    let next = i + 1;
    while (next < history.length && !repCountsForScheduling(history[next].eventType)) next++;
    const scheduledTime = timeWhenCardAppearsInQueueFromScheduled(history, next)?.getTime();
    if (
      history[next]?.date != undefined &&
      scheduledTime != undefined &&
      new Date(history[next]?.date).getTime() < scheduledTime
    ) {
      // Skip - this rep was followed by an early response
    } else {
      cleansedHistory.push(history[i]);
    }
  }
  return cleansedHistory;
}

/**
 * Get only the repetitions since the last 'madeIncremental' event.
 * This is used for interval calculation so that after re-activating a dismissed Rem,
 * the interval calculation starts fresh rather than using the full historical count.
 * 
 * Only events that represent actual reviews are counted:
 * - undefined or 'rep': Normal queue review
 * - 'rescheduledInQueue': Reschedule during queue review
 * - 'executeRepetition': Execute repetition command in editor
 * 
 * Events that do NOT count:
 * - 'rescheduledInEditor': Reschedule from editor (no review confirmed)
 * - 'manualDateReset': Manual date change (no review)
 * - 'madeIncremental', 'dismissed': Session markers
 * - 'importedRep': Review imported from a removed flashcard — counts for stats
 *   but never for this rem's own scheduling.
 *
 * The exact predicate lives in repCountsForScheduling (types.ts) so it can't
 * drift from the Study Dashboard's stats predicate.
 *
 * @param history Full cleansed history array (after early-response filtering)
 * @returns Only the events that count for interval after the last 'madeIncremental' marker
 */
function getRepsSinceLastMadeIncremental(history: IncrementalRep[]): IncrementalRep[] {
  // Find the index of the last 'madeIncremental' marker
  let lastSessionStartIndex = -1;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].eventType === 'madeIncremental') {
      lastSessionStartIndex = i;
      break;
    }
  }

  // Get entries after the last session start (or all if no marker found)
  const entriesAfterSessionStart = lastSessionStartIndex >= 0
    ? history.slice(lastSessionStartIndex + 1)
    : history;

  return entriesAfterSessionStart.filter(entry => repCountsForScheduling(entry.eventType));
}

export function timeWhenCardAppearsInQueueFromScheduled(
  history: IncrementalRep[],
  index: number
): Date | null {
  const scheduled = history[index]?.scheduled;
  if (!scheduled) return null;

  const prevInteraction = history[index - 1];

  // FORK (2026-08-14, bug-hunt #40): `new Date(a) == new Date(b)` compares two
  // distinct Date OBJECTS by reference and is therefore always false, so this
  // whole condition was dead and `useRealScheduledTime` collapsed to
  // `!prevInteraction` — every entry past the first was compared at day
  // granularity, changing which reps removeResponsesBeforeEarlyResponses cleanses
  // and so the computed interval. Comparing calendar days is what the name says.
  const interactionOnSameDay =
    !!scheduled &&
    !!prevInteraction?.date &&
    dayjs(scheduled).isSame(dayjs(prevInteraction.date), 'day');

  const useRealScheduledTime = !prevInteraction || interactionOnSameDay;

  return useRealScheduledTime ? new Date(scheduled) : dayjs(scheduled).startOf('day').toDate();
}

export const removeLastInteraction = (history: IncrementalRep[]): IncrementalRep[] => {
  if (history.length === 0) {
    return history;
  }
  return history.slice(0, -1);
};

/**
 * Project what a repetition of this rem would schedule, without writing anything.
 *
 * @param schedulerOverride Compute with this scheduler instead of the rem's own —
 *   the popups use it to preview a switch before it is saved.
 * @param at When the review happened, if not now (a Companion session recorded
 *   after it ended). Decides whether it is a same-day repeat.
 */
export async function getNextSpacingDateForRem(
  plugin: RNPlugin,
  remId: string,
  inLookbackMode: boolean,
  schedulerOverride?: SchedulerChoice,
  at?: number
) {
  const rem = await plugin.rem.findOne(remId);
  if (!rem) {
    return;
  }
  const incrementalRemInfo = await getIncrementalRemFromRem(plugin, rem);
  if (!incrementalRemInfo) {
    return;
  }

  // FORK (2026-10-11, review, reproduced live): lookback mode is never a redo here. Upstream
  // treats an item reached with Previous as being reviewed a second time, and drops its last
  // history entry from the history it saves. In this fork an item already reviewed in the
  // sitting comes back on the already-reviewed row (Deviation 8), whose buttons record nothing,
  // so a review in lookback mode is of an item NOT yet reviewed — skipped, or set aside with 🔄
  // — and the entry dropped was its genuine previous review. Reproduced: Skip, Previous, Next
  // replaced the item's last review with the new one. An item due again right after its
  // review (Rotation 0) now records a second review instead of replacing the first.
  inLookbackMode = false;

  const rawHistory = incrementalRemInfo.history || [];
  // In lookback mode the last interaction is the one being redone, so neither
  // scheduler may see it. It goes first, before the filters below, so they
  // judge the history as it stood before that interaction.
  const effectiveHistory = inLookbackMode ? removeLastInteraction(rawHistory) : rawHistory;
  const ignoreSameDay = await getIESetting(plugin, ignoreSameDayReviewsId);
  // Same-day repeats leave before the early-response filter: each one is early
  // next to the review it repeats, and would otherwise make that one drop out.
  const repeats = ignoreSameDay ? sameDayRepeatIndexes(effectiveHistory) : new Set<number>();
  const cleansedHistory = removeResponsesBeforeEarlyResponses(
    effectiveHistory.filter((_entry, index) => !repeats.has(index))
  );

  // Get only the reps since the last 'madeIncremental' marker for interval calculation
  // This ensures interval calculation restarts after re-activating a dismissed Rem
  const sessionHistory = getRepsSinceLastMadeIncremental(cleansedHistory);

  const schedulerInfo = await getRemSchedulerInfo(plugin, rem);
  const scheduler: ResolvedScheduler = schedulerOverride
    ? { ...schedulerOverride, source: 'item' }
    : schedulerInfo.scheduler;

  const reviewAt = at ?? Date.now();
  // A redo in lookback mode replaces a review, so it is never a repeat itself.
  const sameDayRepeat =
    ignoreSameDay && !inLookbackMode && isSameDayRepeat(rawHistory, reviewAt, incrementalRemInfo.nextRepDate);

  let newInterval: number;
  let newNextRepDate: number;
  if (sameDayRepeat) {
    // The date in force stays, and so does the interval the item is on.
    newNextRepDate = incrementalRemInfo.nextRepDate;
    newInterval = Math.max(0, calendarDaysBetween(reviewAt, newNextRepDate));
  } else {
    newInterval = computeNextInterval({
      scheduler,
      reviewNumber: sessionHistory.length + 1,
      // The multiplier scheduler works from the interval the item is on, read off
      // the unfiltered history: an editor reschedule or a manual date edit counts
      // here even though it never counts as a review. A same-day repeat the
      // scheduler dated by itself does not: it never chose a new interval.
      currentInterval: getCurrentInterval(effectiveHistory, automaticRepeatIndexes(effectiveHistory, repeats)),
      curveFirstInterval: schedulerInfo.settings.curveFirstInterval,
      curveMaxInterval: schedulerInfo.settings.curveMaxInterval,
    });
    newNextRepDate = Date.now() + newInterval * 1000 * 60 * 60 * 24;
  }

  // Calculate if review was early/late and by how many days
  const scheduledDate = inLookbackMode
    ? dayjs().startOf('day').valueOf()
    : incrementalRemInfo.nextRepDate;
  const actualDate = Date.now();
  const daysDifference = (actualDate - scheduledDate) / (1000 * 60 * 60 * 24);
  const wasEarly = daysDifference < 0;
  const daysEarlyOrLate = Math.round(daysDifference * 10) / 10; // Round to 1 decimal

  const newHistory: IncrementalRep[] = [
    // if lookback mode, remove the last interaction but keep responsesBeforeEarlyResponses
    ...(inLookbackMode ? removeLastInteraction(rawHistory) : rawHistory),
    {
      date: actualDate,
      // TODO: wrong in lookbackMode, but no way to compute because the old nextRepDate has been overwritten
      scheduled: scheduledDate,
      interval: newInterval,
      wasEarly: wasEarly,
      daysEarlyOrLate: daysEarlyOrLate,
      // Record priority at time of rep — but only when it is a real value.
      // `prioritySource: 'fallback'` means neither the slot nor the existing
      // history could supply one, so the number is a placeholder. Stamping it
      // here would turn an unreadable slot into a permanent wrong priority, and
      // would overwrite the very history entries the value can be recovered from.
      ...(incrementalRemInfo.prioritySource === 'fallback'
        ? {}
        : { priority: incrementalRemInfo.priority }),
      // reviewTimeSeconds will be added by reviewRem()
    },
  ];
  return {
    newNextRepDate,
    newHistory,
    remId,
    newInterval,
    /**
     * A review on the same day as one that counted, before the item is due:
     * newNextRepDate is the date in force, kept. Ignore Same-Day Reviews only.
     */
    sameDayRepeat,
    /** The scheduler this projection used, and what the settings alone would give. */
    scheduler,
    inheritedScheduler: schedulerInfo.inherited,
  };
}

/**
 * Persists a review: writes the next-rep date reference and the history back to
 * the Rem.
 *
 * FORK (2026-08-14, bug-hunt #9) — returns whether the write actually happened.
 * Upstream returns void and bails silently when the Daily Doc reference cannot be
 * resolved, so callers could not tell a total failure from a success: they patched
 * the session cache with the new date and advanced the queue anyway, and the
 * IncRem left the queue looking reviewed while NOTHING was written to it. Next
 * session it was due again with no record of the repetition, its review time or
 * its interval. The reference failing is not theoretical — `getDailyDocReferenceForDate`
 * goes through `plugin.date.getDailyDoc`, whose concurrent-call race is documented
 * at lib/incremental_rem/index.ts (two in flight, one resolves undefined).
 *
 * The missing-rem case was silent for the same reason: `rem?.setPowerupProperty`
 * no-ops when findOne returned nothing.
 *
 * FORK (2026-08-14, bug-hunt #41): returns the STAMPED history it actually wrote,
 * not just a success flag. `nextRepMs` is added to the last entry here, so a
 * caller returning its own pre-stamp array — as updateReviewRemData did — left
 * the session cache and the rem disagreeing about that field.
 *
 * @returns the persisted history when both slot writes were issued; null when
 *          nothing was written.
 */
/**
 * FORK (2026-11-15, review 3 #2): `history` with the 'priorityChange' entries that are in the
 * slot now but not in `history` and are newer than every entry it took from the slot (all but
 * its last). Each goes before the caller's last entry when it is older than that entry, after
 * it otherwise — and then the new last entry carries the next-rep stamp, the invariant
 * `getIncrementalRemFromRem` falls back on. Never throws: a slot it cannot read changes nothing.
 */
async function keepPriorityChangesWrittenMeanwhile(
  rem: PluginRem,
  history: IncrementalRep[],
  newNextRepDate: number
): Promise<IncrementalRep[]> {
  try {
    const raw = await rem.getPowerupProperty(powerupCode, repHistorySlotCode);
    const parsed = raw ? tryParseJson(raw) : null;
    if (!Array.isArray(parsed)) return history;
    const known = new Set(history.map((e) => `${e?.eventType ?? ''}|${e?.date}`));
    const readNewest = history
      .slice(0, -1)
      .reduce((max, e) => (typeof e?.date === 'number' && e.date > max ? e.date : max), -Infinity);
    const meanwhile = (parsed as IncrementalRep[]).filter(
      (e) =>
        e?.eventType === 'priorityChange' &&
        typeof e.date === 'number' &&
        e.date > readNewest &&
        !known.has(`priorityChange|${e.date}`)
    );
    if (meanwhile.length === 0) return history;
    const last = history[history.length - 1];
    const before = meanwhile.filter((e) => e.date <= last.date);
    const after = meanwhile.filter((e) => e.date > last.date);
    const merged = [...history.slice(0, -1), ...before, last, ...after];
    if (after.length > 0) {
      merged[merged.length - 1] = { ...merged[merged.length - 1], nextRepMs: newNextRepDate };
    }
    console.log(
      `[updateSRSDataForRem] kept ${meanwhile.length} priority change(s) recorded while the review was computed`,
      rem._id
    );
    return merged;
  } catch (e) {
    console.warn('[updateSRSDataForRem] could not re-read the History slot before writing', rem._id, e);
    return history;
  }
}

export async function updateSRSDataForRem(
  plugin: RNPlugin,
  remId: string,
  newNextRepDate: number,
  newHistory: IncrementalRep[],
  /** The rem, when the caller already holds it — saves a findOne. */
  remInHand?: PluginRem
): Promise<IncrementalRep[] | null> {
  const rem = remInHand ?? (await plugin.rem.findOne(remId));
  console.log('updating srs data for rem', remId, newNextRepDate, newHistory);
  console.log('next rep due in ', dayjs(newNextRepDate).fromNow());
  if (!rem) {
    console.error('[updateSRSDataForRem] rem not found — review NOT saved', remId);
    return null;
  }
  const date = new Date(newNextRepDate);
  const dateReference = await getDailyDocReferenceForDate(plugin, date);
  if (!dateReference) {
    console.error(
      '[updateSRSDataForRem] failed to create date reference — review NOT saved',
      date
    );
    return null;
  }

  // Stamp the authoritative scheduling date onto the most-recent history entry. The
  // Daily Doc reference above stays the source of truth on read (so manual date edits
  // win), but some daily-doc rems expose an empty 'Date' property and don't round-trip;
  // this gives the read a reliable fallback without adding a user-visible slot.
  let stampedHistory = newHistory.length > 0
    ? newHistory.map((entry, i) =>
        i === newHistory.length - 1 ? { ...entry, nextRepMs: newNextRepDate } : entry
      )
    : newHistory;

  // FORK (2026-11-15, review 3 #2): keep a priority change recorded while this review was
  // being computed. Since 2026-11-14 every priority write appends a 'priorityChange' entry to
  // this same slot (priorityChangeHistory, for the warm-start cache), from another frame or a
  // tracker drain, and a review writes back the history it read before — so a priority change
  // made a moment before Next was wiped from the history. The slot is read again just before
  // the write, and markers the caller's history lacks and that are newer than everything it
  // read are put back. What remains is a write landing inside this one round trip. (Every
  // caller adds to the history it read; the Repetition History popup's deletions are written
  // by its own `persist`, not here, so nothing deleted on purpose comes back.)
  if (stampedHistory.length > 0) {
    stampedHistory = await keepPriorityChangesWrittenMeanwhile(rem, stampedHistory, newNextRepDate);
  }

  // Set flag to indicate plugin is making the update (prevents manual date reset detection)
  await plugin.storage.setSession('plugin_updating_srs_data', true);

  await rem.setPowerupProperty(powerupCode, nextRepDateSlotCode, dateReference);
  await rem.setPowerupProperty(powerupCode, repHistorySlotCode, [JSON.stringify(stampedHistory)]);

  // Clear flag after a delay longer than the GlobalRemChanged debounce (1000ms)
  // to prevent false-positive manual date reset detection.
  //
  // FORK (2026-08-15, review §2.6): ALSO store the timestamp, because this timeout
  // lives in the calling context and the Open-Editor, Ctrl+G and reschedule.tsx paths
  // all destroy that context before it fires. The flag then stuck true for the rest of
  // the session, and events.ts reads it to skip the manual-date-reset block entirely —
  // so after one Open-Editor review, hand-editing an IncRem's date chip silently
  // stopped recording a manualDateReset entry. Readers can now expire it themselves
  // instead of trusting a timer that may never run.
  await plugin.storage.setSession('plugin_updating_srs_data_at', Date.now());
  setTimeout(async () => {
    await plugin.storage.setSession('plugin_updating_srs_data', false);
  }, 3000);

  return stampedHistory;
}
