// lib/incremental_rem/review_jobs.ts
//
// Writing the outcome of an IncRem review — from the queue (Next, Cmd+→, the
// Today/Tomorrow drag, Dismiss, Ctrl+D), Reschedule (Ctrl+J, queue or editor),
// the Execute Repetition popup
// (Ctrl+Shift+J) and the Editor Review Timer (End Review, Next Review,
// Dismiss).
//
// WHY JOBS
//
// Every one of these used to run its writes itself and let the user move on
// only when the last one returned: priority + band sync, reading time,
// note/context snapshot, the SRS slots, the synced history list, a re-read of
// the IncRem, and a read-modify-write of the entire IncRem session cache (~8MB
// on a large KB). That held the card, popup or timer bar for seconds — up to
// 15 when GlobalRemChanged in the index was pulling the same cache once per
// slot write.
//
// Now the surface captures what only it knows at the moment of the click (the
// review's duration, the page on screen, the lookback state), appends a job to
// `pendingReviewJobQueueKey`, and moves on. The tracker (register/tracker.ts)
// drains the queue in the persistent index widget, which survives the
// surface's teardown, runs the writes under `plugin_operation_active` so
// GlobalRemChanged stands down for them, and patches the IncRem cache once per
// drain however many jobs it ran.
//
// The queue can advance before the writes land because queue_prefetch keeps
// every IncRem it served this session in `seen`: the rem just reviewed is not
// offered again even while the cache still lists it as due.
//
// This file must stay free of widget imports: the tracker imports it
// statically (see the import.meta note at the top of tracker.ts). Nor is it
// re-exported from ./index: it imports the scheduler, which imports ./index.
//
// FORK (10297b3 sync, 2026-11-14) — upstream file, fork-edited in runReviewJob. In this fork
// the queue's own Next / Open / offset picker / Skip-with-offset do NOT use jobs: they still
// save first and advance after (handleNextRepetitionClick & co. in ./index, which upstream
// deleted and the fork keeps). Jobs reach here from upstream's own surfaces — Reschedule,
// the Dismiss command and the Opt+X toggle, and (while enabled) the editor review popups.
// The fork's guards on those writes are marked FORK below:
//   - a failed save THROWS (updateSRSDataForRem returns null here), so the tracker's
//     "not saved" dialog reports it instead of the cache being patched as if saved (#1/#9);
//   - history entries take their priority through priorityStampFor — never the
//     unreadable-priority placeholder — and an untouched placeholder is never written to
//     the priority slot (#3/#13);
//   - the card-priority step runs only with FORK_FEATURES.cardSurface, and the PDF
//     reading-position writes only with FORK_FEATURES.pdfReader (Deviation 13);
//   - a job with no interval and no date keeps the date in force (#60);
//   - a dismissal of a Rem that still carries the powerup but cannot be read is carried out,
//     with its raw history, instead of being reported as done and skipped;
//   - reviewJobStateFor (below enqueueReviewJob) tells the queue's keyboard shortcuts that a
//     Rem has a job waiting, running or just finished, so they do not act on it.

import { RNPlugin } from '@remnote/plugin-sdk';
import dayjs from 'dayjs';
import {
  getIncrementalRemFromRem,
  setIncRemPriority,
  updateReviewRemData,
  requestQueueDashboardRefocus,
  readRemHistory, // FORK (10297b3 sync): the raw History slot, for an unreadable Rem's dismissal
} from './index';
import { IncrementalRem, IncrementalRep, priorityStampFor } from './types'; // FORK (#13): priorityStampFor
import { FORK_FEATURES } from '../fork_gates'; // FORK (Deviation 13)
import { updateSRSDataForRem } from '../scheduler';
import {
  getActivePdfForIncRem,
  getIncrementalReadingPosition,
  addPageToHistory,
  resolveSessionBookmarkCarry,
} from '../pdfUtils';
import { addToIncrementalHistory, addDismissalToIncrementalHistory } from '../history_utils';
import { stampNoteAndContext, consumePendingReviewNote, buildRepContext } from '../history_notes';
import { recordIncRemRep } from '../queue_session';
import { transferToDismissed } from '../dismissed';
import { handleCardPriorityInheritance } from '../card_priority/card_priority_inheritance';
import { applySchedulerChoice } from '../scheduler_choice';
import { SchedulerChoice } from '../scheduler_core';
import { pendingReviewJobQueueKey, incremReviewStartTimeKey, powerupCode } from '../consts';
import { updateHistoryEntry } from '../history_edit';
import { companionSessionInTurn, queueSecondsBefore, takeCompanionHandoff } from '../companion/handoff';

interface ReviewJobBase {
  /** Unique per click, so a job the drain sees twice is applied once. */
  id: string;
  remId: string;
  /** For the failure dialog only. */
  remName?: string;
  /** When the user clicked — the date written into history, not when the job ran. */
  confirmedAt: number;
}

/** A reading host to log time against, as the surface shows it right now. */
export type ReviewHost = { remId: string; page: number | null };

/** Execute Repetition popup, and the Editor Review Timer's End/Next Review. */
export interface EditorReviewJob extends ReviewJobBase {
  /**
   * 'new' appends an executeRepetition entry and schedules the next rep.
   * 'amendLast' is the timer after a queue handoff: the handoff already wrote
   * the repetition, so only its duration, note and context are filled in and
   * the date stays where it is.
   */
  kind: 'new' | 'amendLast';
  /** 'new' only. */
  intervalDays?: number;
  /** 'new' only. When set, written as nextRepDate instead of the computed one. */
  overrideNextRepDate?: number;
  /** Left unset to keep the priority as it is. */
  newPriority?: number;
  /**
   * The slot's priority when the review began. When the slot holds something
   * else by the time the job runs, the priority was changed during the review
   * (Set Priority, the editor) and newPriority — a copy taken at the start — is
   * dropped instead of reverting that change.
   */
  basePriority?: number;
  reviewTimeSeconds: number;
  /** Optional explicit note; a note parked for the rem is consumed either way. */
  note?: string;
  /**
   * The timer's host and page. Unset: the rem's active PDF at its saved
   * position, and only when time was recorded — the popup's behaviour.
   */
  host?: ReviewHost;
  /**
   * Count the rep for Practiced Queues. The popup does; the timer does not,
   * because its own engagement tracking already counts the item.
   */
  recordRep: boolean;
}

/** The queue's Next button and Cmd+→: the scheduler picks the next date. */
export interface QueueNextJob extends ReviewJobBase {
  kind: 'queueNext';
  /** null when the queue recorded no start time for this item. */
  reviewTimeSeconds: number | null;
  inLookbackMode: boolean;
  /** A PDF IncRem: log the reading time against its active PDF's current page. */
  syncPdfPage: boolean;
  /** When the queue began showing the item, for the Chrome Companion's hand-off. */
  turnStartedAt?: number | null;
  /** When Open URL (Use Companion) was clicked during this turn. */
  companionHandoffAt?: number;
}

/** The queue's drag to Today / Tomorrow: a fixed day, interval kept. */
export interface ManualOffsetJob extends ReviewJobBase {
  kind: 'manualOffset';
  offsetDays: number;
}

/** Dismiss from the queue, Ctrl+D (queue or editor), or the timer. */
export interface DismissJob extends ReviewJobBase {
  kind: 'dismiss';
  /** Set when a review is ending with the dismissal: appends a 'rep' entry. */
  rep?: { reviewTimeSeconds: number };
  /** Hand the IncRem's priority to its own cards first (queue and timer do). */
  cardPriorityInheritance: boolean;
  /** The timer logs its reading time against the host before dismissing. */
  host?: ReviewHost;
}

/** Reschedule (button or Ctrl+J): a chosen interval and priority, not a review. */
export interface RescheduleJob extends ReviewJobBase {
  kind: 'reschedule';
  intervalDays: number;
  newPriority: number;
  /** 'queue' records a rescheduledInQueue entry with the turn's duration. */
  context: 'queue' | 'editor';
  /** Queue only; null when the queue recorded no start time for this item. */
  reviewTimeSeconds: number | null;
  note?: string;
  /** Only set when the user changed the scheduler in the popup. */
  schedulerChoice?: SchedulerChoice;
}

export type ReviewJob = EditorReviewJob | QueueNextJob | ManualOffsetJob | DismissJob | RescheduleJob;

/** IncRem cache changes collected over a drain: an entry to upsert, or null to remove. */
export type IncRemCacheChanges = Map<string, IncrementalRem | null>;

/** The next-rep date a 'new' job will write — also what the toasts show. */
export const editorReviewNextRepDate = (
  job: Pick<EditorReviewJob, 'intervalDays' | 'overrideNextRepDate' | 'confirmedAt'>
): number => job.overrideNextRepDate ?? job.confirmedAt + (job.intervalDays ?? 0) * 1000 * 60 * 60 * 24;

/** A job id unique per click. */
export const newReviewJobId = (remId: string): string =>
  `${remId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * Appends jobs for the tracker. A plain read-modify-write on a session key:
 * the writers are user clicks, and an append would have to land in the single
 * round-trip between the drain's read and its clear to be lost.
 */
export async function enqueueReviewJobs(plugin: RNPlugin, jobs: ReviewJob[]): Promise<void> {
  if (jobs.length === 0) return;
  const queue = (await plugin.storage.getSession<ReviewJob[]>(pendingReviewJobQueueKey)) || [];
  await plugin.storage.setSession(pendingReviewJobQueueKey, [...queue, ...jobs]);
}

export const enqueueReviewJob = (plugin: RNPlugin, job: ReviewJob) => enqueueReviewJobs(plugin, [job]);

// FORK (10297b3 sync, adversarial review) — which Rems have a review job that is not finished,
// or finished a moment ago.
//
// A surface that queues a job leaves its item at once (Reschedule and the Dismiss command
// advance the queue before anything is written), while `currentIncRemKey` goes on naming that
// item until the next one's widget has loaded, about half a second later. The queue's keyboard
// shortcuts take their item from that key (incRemIdForQueueShortcut, register/commands.ts), so
// a press in between used to act on the Rem that was just left: Opt+T recorded a review that
// raced the job's own write to the same History slot, and then dropped the item on screen.
// Before the sync those surfaces wrote first and advanced after, so the same press found a
// Rem already dismissed or already rescheduled.
//
// The marks live in this module's memory: the tracker that runs the jobs and the commands that
// ask are both in the index widget. A job another frame has queued and the tracker has not
// picked up yet is found in the session key itself.
const REVIEW_JOB_TRACE_MS = 1500; // as long as waitForNextQueueItem waits for the next item
const reviewJobsInFlight = new Map<string, number>(); // remId -> jobs picked up, not finished
const reviewJobFinishedAt = new Map<string, number>(); // remId -> when its last job finished

/** Tracker: the jobs of a drain round, marked BEFORE the round clears them from the session key. */
export function noteReviewJobsPickedUp(jobs: ReviewJob[]): void {
  for (const job of jobs) reviewJobsInFlight.set(job.remId, (reviewJobsInFlight.get(job.remId) ?? 0) + 1);
}

/** Tracker: one job has run, saved or not. */
export function noteReviewJobFinished(job: ReviewJob): void {
  const left = (reviewJobsInFlight.get(job.remId) ?? 1) - 1;
  if (left > 0) reviewJobsInFlight.set(job.remId, left);
  else reviewJobsInFlight.delete(job.remId);
  const now = Date.now();
  for (const [remId, at] of reviewJobFinishedAt) {
    if (now - at > REVIEW_JOB_TRACE_MS) reviewJobFinishedAt.delete(remId);
  }
  reviewJobFinishedAt.set(job.remId, now);
}

/** 'unfinished': a job is waiting or running; 'justFinished': one ended within the last 1.5 s. */
export async function reviewJobStateFor(
  plugin: RNPlugin,
  remId: string
): Promise<'unfinished' | 'justFinished' | 'none'> {
  if (reviewJobsInFlight.has(remId)) return 'unfinished';
  const queued = (await plugin.storage.getSession<ReviewJob[]>(pendingReviewJobQueueKey)) || [];
  if (queued.some((job) => job.remId === remId)) return 'unfinished';
  const finishedAt = reviewJobFinishedAt.get(remId);
  return finishedAt !== undefined && Date.now() - finishedAt < REVIEW_JOB_TRACE_MS ? 'justFinished' : 'none';
}

// ─── Click side ─────────────────────────────────────────────────────────────

/**
 * Seconds since the queue started showing the current IncRem, or null when no
 * start was recorded. Read at the click: the key is restamped as soon as the
 * next item loads.
 */
export async function captureQueueReviewSeconds(plugin: RNPlugin): Promise<number | null> {
  const startTime = await plugin.storage.getSession<number>(incremReviewStartTimeKey);
  return startTime ? dayjs().diff(dayjs(startTime), 'second') : null;
}

/**
 * Next (button or Cmd+→): queue the review and advance at once.
 *
 * The dashboard refocus is flagged BEFORE advancing: removeCurrentCardFromQueue
 * tears down the calling widget's sandbox, so the refocus itself is done by the
 * persistent QueueLoadCard listener in register/events.ts.
 */
export async function queueNextRepetition(
  plugin: RNPlugin,
  remId: string,
  options: { syncPdfPage: boolean }
): Promise<void> {
  const [reviewTimeSeconds, inLookbackMode, turnStartedAt] = await Promise.all([
    captureQueueReviewSeconds(plugin),
    plugin.queue.inLookbackMode().then((v) => !!v),
    plugin.storage.getSession<number>(incremReviewStartTimeKey).then((v) => v ?? null),
  ]);
  const companionHandoffAt = await takeCompanionHandoff(plugin, remId, turnStartedAt);
  await enqueueReviewJob(plugin, {
    id: newReviewJobId(remId),
    kind: 'queueNext',
    remId,
    reviewTimeSeconds,
    inLookbackMode,
    syncPdfPage: options.syncPdfPage,
    turnStartedAt,
    companionHandoffAt,
    confirmedAt: Date.now(),
  });
  await requestQueueDashboardRefocus(plugin, 'handleNextRepetitionClick');
  await plugin.queue.removeCurrentCardFromQueue();
}

/** The Today / Tomorrow drag: queue the reschedule and advance at once. */
export async function queueManualOffset(plugin: RNPlugin, remId: string, offsetDays: number): Promise<void> {
  await enqueueReviewJob(plugin, {
    id: newReviewJobId(remId),
    kind: 'manualOffset',
    remId,
    offsetDays,
    confirmedAt: Date.now(),
  });
  await requestQueueDashboardRefocus(plugin, 'handleNextRepetitionManualOffset');
  await plugin.queue.removeCurrentCardFromQueue();
}

// ─── Tracker side ───────────────────────────────────────────────────────────

/** Logs reading time against a host the surface named, carrying its bookmark. */
async function logHostReadingTime(plugin: RNPlugin, remId: string, host: ReviewHost, seconds: number) {
  // Carry a session bookmark forward so this reading-time entry does not bury
  // it and make the Scroll button appear stale.
  const carryHighlightId = await resolveSessionBookmarkCarry(plugin, remId, host.remId, host.page);
  await addPageToHistory(plugin, remId, host.remId, host.page, seconds, carryHighlightId);
}

/** Stamps the next-rep date on the last entry, as updateSRSDataForRem does on the slot. */
const withNextRepStamp = (history: IncrementalRep[], nextRepMs: number): IncrementalRep[] =>
  history.length === 0
    ? history
    : [...history.slice(0, -1), { ...history[history.length - 1], nextRepMs }];

/**
 * The cache entry after a review, built from what was just written instead of
 * re-reading the rem. The nextRepDate is day-aligned because that is what a
 * re-read resolves from the Daily Doc reference — a raw epoch would make the
 * item due at the time of day it was reviewed rather than at midnight.
 */
const reviewedEntry = (
  incRem: IncrementalRem,
  nextRepDate: number,
  history: IncrementalRep[],
  priority?: number
): IncrementalRem => ({
  ...incRem,
  ...(priority !== undefined ? { priority, prioritySource: 'slot' as const } : {}),
  nextRepDate: dayjs(nextRepDate).startOf('day').valueOf(),
  history: withNextRepStamp(history, nextRepDate),
});

/**
 * Runs one job. Cache changes go into `cache` for the caller to write once;
 * the returned `cascadeRemId` asks for the inheritance cascade (priority changed).
 *
 * Throws when the rem is gone or no longer incremental — the caller reports it,
 * since the surface that could have said so is already gone. A dismissal of a
 * rem that is no longer incremental is not an error: it was dismissed already.
 */
export async function runReviewJob(
  plugin: RNPlugin,
  job: ReviewJob,
  cache: IncRemCacheChanges
): Promise<{ cascadeRemId?: string }> {
  const { remId } = job;
  const rem = await plugin.rem.findOne(remId);
  if (!rem) throw new Error('The Rem no longer exists.');

  const incRem = await getIncrementalRemFromRem(plugin, rem);
  if (!incRem) {
    if (job.kind === 'dismiss') {
      // FORK (10297b3 sync, review): null also means "still tagged, but unreadable" (its data
      // fails the schema). Upstream returns here for both, so the command toasted "Incremental
      // Rem dismissed." and the Rem stayed incremental, press after press. Only a Rem that no
      // longer carries the powerup was dismissed already. An unreadable one is dismissed as
      // before the sync — and with its history, which the old code dropped: the raw slot goes
      // to the Dismissed powerup before the Incremental one takes its slots away.
      if (!(await rem.hasPowerup(powerupCode))) return {};
      const rawHistory = await readRemHistory(plugin, remId);
      await transferToDismissed(plugin, rem, rawHistory ?? []);
      await addDismissalToIncrementalHistory(plugin, remId);
      await rem.removePowerup(powerupCode);
      cache.set(remId, null);
      return {};
    }
    throw new Error('The Rem is no longer an Incremental Rem.');
  }

  switch (job.kind) {
    case 'queueNext': {
      // The Chrome Companion recorded this sitting already: the queue adds its own
      // minutes to that session instead of a second review and reschedule.
      const companionSession = !job.inLookbackMode && companionSessionInTurn(incRem.history, job.turnStartedAt ?? null);
      if (companionSession && job.turnStartedAt) {
        const added = queueSecondsBefore(companionSession, job.turnStartedAt, job.companionHandoffAt);
        if (added > 0) {
          await updateHistoryEntry(plugin, remId, companionSession, {
            reviewTimeSeconds: (companionSession.reviewTimeSeconds ?? 0) + added,
            context: { queueSeconds: (companionSession.context?.queueSeconds ?? 0) + added },
          });
        }
        const at = dayjs(companionSession.date).format('HH:mm');
        void plugin.app.toast(
          `Already recorded from the Companion at ${at}${added >= 60 ? `: added ${Math.round(added / 60)} min from the queue` : ''}`
        );
        return {};
      }
      if (FORK_FEATURES.pdfReader && job.syncPdfPage) { // FORK (Deviation 13): no pdfState writes with the reader off
        const pdfRem = await getActivePdfForIncRem(plugin, rem);
        if (pdfRem) {
          const page = await getIncrementalReadingPosition(plugin, remId, pdfRem._id);
          if (page) {
            const carryHighlightId = await resolveSessionBookmarkCarry(plugin, remId, pdfRem._id, page);
            await addPageToHistory(plugin, remId, pdfRem._id, page, job.reviewTimeSeconds ?? undefined, carryHighlightId);
          }
        }
      }
      const result = await updateReviewRemData(plugin, incRem, undefined, {
        reviewTimeSeconds: job.reviewTimeSeconds,
        inLookbackMode: job.inLookbackMode,
        ...(job.companionHandoffAt ? { context: { companionHandoffAt: job.companionHandoffAt } } : {}),
      });
      if (!result) throw new Error('The scheduler could not compute the next repetition.');
      cache.set(remId, reviewedEntry(incRem, result.newNextRepDate, result.newHistory));
      if (result.sameDayRepeat) {
        void plugin.app.toast(
          `Same-day review: the next review stays on ${dayjs(result.newNextRepDate).format('MMM D')}`
        );
      }
      return {};
    }

    case 'manualOffset': {
      const offset = Math.max(job.offsetDays, 0);
      const targetDay = dayjs(job.confirmedAt).startOf('day').add(offset, 'day').valueOf();
      const manualEntry: IncrementalRep = {
        date: job.confirmedAt,
        scheduled: targetDay,
        interval: offset,
        // A "carry on today / tomorrow" gesture, not a new rhythm for the item.
        keepsInterval: true,
        ...priorityStampFor(incRem), // FORK (#42 / #13)
      };
      // Same note/context stamping as the regular review funnel.
      await stampNoteAndContext(plugin, rem, manualEntry);
      const history = [...(incRem.history || []), manualEntry];
      // FORK (#1/#9): a failed write is reported, not cached as a review.
      const saved = await updateSRSDataForRem(plugin, remId, targetDay, history, rem);
      if (!saved) throw new Error('The next repetition date could not be written.');
      cache.set(remId, reviewedEntry(incRem, targetDay, saved));
      return {};
    }

    case 'dismiss': {
      // FORK (Deviation 13, T4): the card-priority engine is disabled in this fork — a
      // dismissal must not leave a CardPriority tag behind, whatever the caller asked for.
      if (FORK_FEATURES.cardSurface && job.cardPriorityInheritance) {
        await handleCardPriorityInheritance(plugin, rem, incRem);
      }
      // FORK (Deviation 13): the timer's reading-time entry is a pdfState write.
      if (FORK_FEATURES.pdfReader && job.host) {
        await logHostReadingTime(plugin, remId, job.host, job.rep?.reviewTimeSeconds ?? 0);
      }
      const history = [...(incRem.history || [])];
      if (job.rep) {
        history.push({
          date: job.confirmedAt,
          scheduled: incRem.nextRepDate,
          reviewTimeSeconds: job.rep.reviewTimeSeconds,
          eventType: 'rep',
          // FORK (#13): never stamp a placeholder priority — least of all into the Dismissed
          // powerup's preserved history, where no live slot survives to recover the real one.
          ...priorityStampFor(incRem),
        });
      }
      // The history goes to the Dismissed powerup BEFORE the Incremental one
      // is removed, which takes its slots with it.
      await transferToDismissed(plugin, rem, history);
      if (job.rep) {
        await addToIncrementalHistory(plugin, remId, { dismissed: true });
      } else {
        await addDismissalToIncrementalHistory(plugin, remId);
      }
      await rem.removePowerup(powerupCode);
      cache.set(remId, null);
      return {};
    }

    case 'reschedule': {
      // FORK (#3/#13): the popup's priority field is seeded from the Rem. For an unreadable
      // slot that seed IS the placeholder (prioritySource 'fallback'), and upstream's
      // "write it anyway unless it came from the slot" would launder it into the real slot.
      // Left untouched, it is neither written nor stamped.
      const untouchedPlaceholder =
        incRem.prioritySource === 'fallback' && job.newPriority === incRem.priority;
      const priorityChanged =
        !untouchedPlaceholder && (job.newPriority !== incRem.priority || incRem.prioritySource !== 'slot');
      if (priorityChanged) {
        // recordHistory: false — the reschedule entry below carries this priority.
        await setIncRemPriority(plugin, rem, job.newPriority, { recordHistory: false });
      }
      if (job.schedulerChoice) {
        await applySchedulerChoice(plugin, rem, job.schedulerChoice);
      }

      const nextRepDate = job.confirmedAt + job.intervalDays * 1000 * 60 * 60 * 24;
      const scheduledDate = incRem.nextRepDate;
      const daysDifference = (job.confirmedAt - scheduledDate) / (1000 * 60 * 60 * 24);

      const rescheduleEntry: IncrementalRep = {
        date: job.confirmedAt,
        scheduled: scheduledDate,
        interval: job.intervalDays,
        wasEarly: daysDifference < 0,
        daysEarlyOrLate: Math.round(daysDifference * 10) / 10,
        // An editor reschedule does not imply the item was read.
        reviewTimeSeconds: job.context === 'queue' ? job.reviewTimeSeconds ?? undefined : undefined,
        ...(untouchedPlaceholder ? {} : { priority: job.newPriority }), // the NEW priority set during reschedule (FORK #13: not a placeholder)
        eventType: job.context === 'queue' ? 'rescheduledInQueue' : 'rescheduledInEditor',
      };

      // Attach the user's reason (if typed) + a reading-state snapshot to the entry.
      await stampNoteAndContext(plugin, rem, rescheduleEntry, job.note);

      const history = [...(incRem.history || []), rescheduleEntry];
      // FORK (#1/#9): a failed write is reported, not cached as rescheduled.
      const saved = await updateSRSDataForRem(plugin, remId, nextRepDate, history, rem);
      if (!saved) throw new Error('The new date could not be written.');
      cache.set(remId, reviewedEntry(incRem, nextRepDate, saved, priorityChanged ? job.newPriority : undefined));

      // The cascade only matters when a priority changed; it used to run on
      // every reschedule, costing seconds of background work to update nothing.
      return priorityChanged ? { cascadeRemId: remId } : {};
    }

    case 'new':
    case 'amendLast': {
      // Skip the write (and its band sync, which looks up source highlights)
      // when nothing changes. A priority that was only recovered from history
      // or defaulted is written anyway, so the slot holds it from now on.
      // FORK (#3/#13): as in 'reschedule' — an untouched placeholder is not a priority.
      const untouchedPlaceholder =
        incRem.prioritySource === 'fallback' && job.newPriority === incRem.priority;
      const changedDuringReview =
        job.basePriority !== undefined &&
        incRem.prioritySource === 'slot' &&
        incRem.priority !== job.basePriority;
      const priorityChanged =
        job.newPriority !== undefined &&
        !untouchedPlaceholder &&
        !changedDuringReview &&
        (job.newPriority !== incRem.priority || incRem.prioritySource !== 'slot');
      if (priorityChanged) {
        // recordHistory: false — the rep entry written below carries this priority.
        await setIncRemPriority(plugin, rem, job.newPriority!, { recordHistory: false });
      }

      const reviewTimeSeconds = job.reviewTimeSeconds;

      // Reading time belongs to the PDF/HTML host too.
      // FORK (Deviation 13): both branches write pdfState — only with the reader enabled.
      if (!FORK_FEATURES.pdfReader) {
        // reader off: no reading-position writes
      } else if (job.host) {
        await logHostReadingTime(plugin, remId, job.host, reviewTimeSeconds);
      } else if (reviewTimeSeconds > 0) {
        const pdfRem = await getActivePdfForIncRem(plugin, rem);
        if (pdfRem) {
          const activePage = await getIncrementalReadingPosition(plugin, remId, pdfRem._id);
          await addPageToHistory(plugin, remId, pdfRem._id, activePage || 1, reviewTimeSeconds);
        }
      }

      let history: IncrementalRep[];
      let nextRepDate: number;

      if (job.kind === 'amendLast') {
        history = [...(incRem.history || [])];
        const lastEntry = history[history.length - 1];
        if (lastEntry) {
          lastEntry.reviewTimeSeconds = reviewTimeSeconds;
          // Append a note typed during this session to the one the handoff may
          // already have stamped, and refresh the snapshot to end-of-session values.
          const sessionNote = await consumePendingReviewNote(plugin, remId);
          if (sessionNote && sessionNote !== lastEntry.notes) {
            lastEntry.notes = lastEntry.notes ? `${lastEntry.notes}\n${sessionNote}` : sessionNote;
          }
          const context = await buildRepContext(plugin, rem);
          if (context) lastEntry.context = context;
        }
        nextRepDate = incRem.nextRepDate;
      } else {
        const actualDate = job.confirmedAt;
        // FORK (#60): no interval and no date means "leave the schedule alone" — upstream's
        // `intervalDays ?? 0` would make the Rem due now.
        nextRepDate =
          job.overrideNextRepDate === undefined && typeof job.intervalDays !== 'number'
            ? incRem.nextRepDate
            : editorReviewNextRepDate(job);

        // The interval stored in history must reflect the EFFECTIVE interval
        // used for the next rep date, not the algorithm-calculated one. When
        // the user chooses "Keep Current Date" or "Custom Interval",
        // overrideNextRepDate differs from the computed value.
        const effectiveIntervalDays = job.overrideNextRepDate
          ? Math.round(((job.overrideNextRepDate - actualDate) / (1000 * 60 * 60 * 24)) * 10) / 10
          : typeof job.intervalDays === 'number'
          ? job.intervalDays
          : Math.max(0, Math.round(((nextRepDate - actualDate) / (1000 * 60 * 60 * 24)) * 10) / 10); // FORK (#60)

        const scheduledDate = incRem.nextRepDate;
        const daysDifference = (actualDate - scheduledDate) / (1000 * 60 * 60 * 24);

        const repEntry: IncrementalRep = {
          date: actualDate,
          scheduled: scheduledDate,
          interval: effectiveIntervalDays,
          wasEarly: daysDifference < 0,
          daysEarlyOrLate: Math.round(daysDifference * 10) / 10,
          reviewTimeSeconds,
          // FORK (#13): the priority this job just WROTE when it wrote one (incRem was read
          // before setIncRemPriority above), else the Rem's own — never the placeholder.
          ...(priorityChanged ? { priority: job.newPriority! } : priorityStampFor(incRem)),
          eventType: 'executeRepetition' as const,
        };

        // Attach the user's note (if typed) + a reading-state snapshot to the entry.
        await stampNoteAndContext(plugin, rem, repEntry, job.note);

        history = [...(incRem.history || []), repEntry];
      }

      // FORK (#1/#9): a failed write is reported, not cached as a review.
      const saved = await updateSRSDataForRem(plugin, remId, nextRepDate, history, rem);
      if (!saved) throw new Error('The repetition could not be written.');
      await addToIncrementalHistory(plugin, remId);
      cache.set(remId, reviewedEntry(incRem, nextRepDate, saved, priorityChanged ? job.newPriority : undefined));

      if (job.recordRep) {
        await recordIncRemRep(plugin, remId, reviewTimeSeconds * 1000);
      }

      return priorityChanged ? { cascadeRemId: remId } : {};
    }
  }
}
