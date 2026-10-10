import {
  renderWidget,
  usePlugin,
  useTrackerPlugin,
  WidgetLocation,
} from '@remnote/plugin-sdk';
import React, { useMemo, useRef, useState, useLayoutEffect, useEffect } from 'react';
import * as _ from 'remeda';
import dayjs from 'dayjs';
import { IncrementalRep, repCountsForScheduling } from '../lib/incremental_rem/types';
import { priorityStampFor } from '../lib/incremental_rem/types';
import { NextRepTime, durationToHumanReadable } from '../components/NextRepTime';
import dayjsDuration from 'dayjs/plugin/duration';
import { SplitButton } from '../components/buttons/SplitButton';
import { requestAnotherIncRem } from '../lib/queue_swap'; // FORK (Deviation 16)

// Granular offset picker opened by the chevrons on Next / Open Editor / Skip:
// a number stepper + a Days/Weeks/Months unit toggle in one shared row below
// the button row (same visual convention as the ⚙️ Options row). The chevron
// picks WHICH action the chosen offset applies to.
type OffsetUnit = 'days' | 'weeks' | 'months';

// FORK (2026-10-10, owner request): Previous, Next, Open, Skip and Dismiss share Dismiss's
// width — the base button minimum. Split buttons count their chevron inside it.
const MAIN_BUTTON_WIDTH = 95;
dayjs.extend(dayjsDuration);

const OFFSET_UNITS: { unit: OffsetUnit; label: string }[] = [
  { unit: 'days', label: 'Days' },
  { unit: 'weeks', label: 'Weeks' },
  { unit: 'months', label: 'Months' },
];
// Calendar-aware conversion: months use real month lengths, not 30-day blocks.
const offsetToDays = (value: number, unit: OffsetUnit): number => {
  const today = dayjs().startOf('day');
  const target =
    unit === 'days' ? today.add(value, 'day')
    : unit === 'weeks' ? today.add(value * 7, 'day')
    : today.add(value, 'month');
  return Math.max(1, target.diff(today, 'day'));
};
import { Button } from '../components/buttons/Button';
import { getButtonStyles } from '../components/buttons/styles';
import {
  allIncrementalRemKey,
  powerupCode,
  activeHighlightIdKey,
  currentIncrementalRemTypeKey,
  displayPriorityShieldId,
  displayWeightedShieldId,
  seenRemInSessionKey,
  queueSessionCacheKey,
  priorityCalcScopeRemIdsKey,
  incremReviewStartTimeKey,
  queueInfoBarModeId,
  isMobileDeviceKey,
  queueSlotSwapKey, // FORK (Deviation 16)
  QueueSlotSwap,
} from '../lib/consts';
import { getIncrementalRemFromRem, handleNextRepetitionClick, handleNextRepetitionManualOffset, rescheduleWithoutReview, updateReviewRemData, getRotationIntervalMs, requestQueueDashboardRefocus } from '../lib/incremental_rem';
import { removeIncrementalRemCache, updateIncrementalRemCache } from '../lib/incremental_rem/cache';
import { IncrementalRem } from '../lib/incremental_rem';
import { percentileToHslColor, calculateRelativePercentile, calculateVolumeBasedPercentile, calculateWeightedShield } from '../lib/utils';
import { getActivePdfForIncRem, findHTMLinRem, addPageToHistory, getPageHistory, getIncrementalReadingPosition, resolveSessionBookmarkCarry } from '../lib/pdfUtils';
import { FORK_FEATURES } from '../lib/fork_gates';
import {
  QueueDistribution,
  shouldShowQueueInfoBar,
  getQueueInfoBarStyle,
  QUEUE_INFO_BAR_OUTER_PADDING,
  QUEUE_PRIORITY_NEUTRAL_COLOR,
} from '../components/QueueDistribution';
import { remTitleEndsWithOpenLinkTag, extractExternalHttpUrlsFromRem } from '../lib/open_editor_link_tag';
import { getRemReadPoint } from '../lib/remReadPoint';
import { resolveRemTextForBreadcrumb } from '../lib/richTextRemRefs';
import { QueueSessionCache } from '../lib/card_priority';
import { WeightedShieldTooltip } from '../components';
import { shouldUseLightMode } from '../lib/mobileUtils';
import { getHtmlSourceUrl, determineIncRemType } from '../lib/incRemHelpers';
import { transferToDismissed } from '../lib/dismissed';
import { setPendingReviewNote, getPendingReviewNote, MAX_NOTE_LENGTH } from '../lib/history_notes';
import { addToIncrementalHistory } from '../lib/history_utils';
import { handleReviewInEditorRem } from '../lib/review_actions';

import { handleCardPriorityInheritance } from '../lib/card_priority/card_priority_inheritance';
import { useIESetting } from '../lib/settings';

export function AnswerButtons() {
  const plugin = usePlugin();
  const [showAdvancedOptions, setShowAdvancedOptions] = useState(false);
  // Which button's chevron opened the offset row (null = closed).
  const [offsetRowFor, setOffsetRowFor] = useState<null | 'next' | 'editor' | 'skip'>(null);
  // Granular picker value — remembered across opens within this card.
  const [offsetValue, setOffsetValue] = useState(1);
  const [offsetUnit, setOffsetUnit] = useState<OffsetUnit>('days');

  // Separate lightweight trackers for UI state
  const useLightMode = useTrackerPlugin(
    async (rp) => await shouldUseLightMode(rp),
    []
  ) || false;

  const allIncRems = useTrackerPlugin(
    (rp) => rp.storage.getSession<IncrementalRem[]>(allIncrementalRemKey),
    []
  ) || [];

  const shouldDisplayShield = useIESetting(displayPriorityShieldId);
  const shouldDisplayWeightedShield = useIESetting(displayWeightedShieldId);

  // FORK (2026-08-14, bug-hunt #5/#6): row-level in-flight lock for every action
  // that mutates the rem or advances the queue.
  //
  // Each of these does several sequential IPC round trips before its destructive
  // step, and nothing used to disable the row meanwhile — so a second press
  // re-entered with the same captured `incRemInfo`. On Dismiss that appended the
  // rem's whole history to the Dismissed powerup a SECOND time (its
  // `alreadyDismissed` merge branch) and consumed the next card unreviewed. Next
  // is worse-timed still: `handleNextRepetitionClick` awaits a `sleep(150)`
  // before advancing.
  //
  // The whole ROW locks, not each button: these actions all mutate the same rem
  // and then tear the widget down, so Dismiss-then-Next is as damaging as
  // Dismiss-twice. `busyRef` is the guard (synchronous, so it wins the race
  // between two clicks in the same tick); `isBusy` only drives the disabled
  // styling. MUST stay above the early returns — Rules of Hooks.
  const busyRef = useRef(false);
  const mountedRef = useRef(true);
  const [isBusy, setIsBusy] = useState(false);
  useEffect(() => () => { mountedRef.current = false; }, []);
  // FORK (Deviation 16): the rem this row currently acts on, for the 🔄 button to wait
  // on — set each render below, right after baseData resolves.
  const shownRemIdRef = useRef<string | undefined>(undefined);

  /** Runs `fn` unless another row action is in flight; otherwise drops the press. */
  const runExclusive = async (fn: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setIsBusy(true);
    try {
      await fn();
    } catch (e) {
      console.error('[AnswerButtons] action failed', e);
    } finally {
      busyRef.current = false;
      // Most of these destroy the sandbox before resolving, so this often never
      // runs; the mounted check keeps the survivors from setting state on an
      // unmounted tree.
      if (mountedRef.current) setIsBusy(false);
    }
  };

  // FORK (Deviation 14): the info bar's visibility setting. isMobile drives the
  // 'allExceptMobile' option; this is an IncRem bar, so isIncRem is true.
  // MUST stay in the hooks section ABOVE the early returns below (Rules of
  // Hooks) — placing these beside the render code silently kills the widget.
  const infoBarMode = useIESetting(queueInfoBarModeId);
  const isMobileDevice =
    useTrackerPlugin(async (rp) => !!(await rp.storage.getSession<boolean>(isMobileDeviceKey)), []) ??
    false;
  const showInfoBar = shouldShowQueueInfoBar(infoBarMode, true, isMobileDevice);

  // FORK (2026-08-14, bug-hunt #29): these trackers feed ONLY buttons behind
  // FORK_FEATURES flags that are false, so every card paid for reads whose
  // results nothing could render. Short-circuit inside the tracker rather than
  // deleting it — the hook must still run (Rules of Hooks) and the code revives
  // by flipping the flag.
  const activeHighlightId = useTrackerPlugin(
    (rp) =>
      FORK_FEATURES.pdfReader
        ? rp.storage.getSession<string | null>(activeHighlightIdKey)
        : Promise.resolve(null),
    []
  );

  const remType = useTrackerPlugin(
    (rp) => rp.storage.getSession<string | null>(currentIncrementalRemTypeKey),
    []
  );

  const scopeRemIds = useTrackerPlugin(
    (rp) =>
      FORK_FEATURES.shields
        ? rp.storage.getSession<string[] | null>(priorityCalcScopeRemIdsKey)
        : Promise.resolve(null),
    []
  );

  const baseData = useTrackerPlugin(async (rp) => {
    const ctx = await rp.widget.getWidgetContext<WidgetLocation.FlashcardAnswerButtons>();
    if (!ctx?.remId) return null;

    // FORK (Deviation 16, 2026-10-10): after a 🔄 swap this RemNote slot shows a
    // different IncRem, and every action below must target the rem on screen. All
    // per-item resets in this widget key on baseData.rem._id, so they follow too.
    const slotSwap = await rp.storage.getSession<QueueSlotSwap | null>(queueSlotSwapKey);
    const shownRemId =
      slotSwap && slotSwap.slotRemId === ctx.remId && slotSwap.showRemId ? slotSwap.showRemId : ctx.remId;
    const rem = await rp.rem.findOne(shownRemId);
    if (!rem) return null;

    const incRemInfo = await getIncrementalRemFromRem(rp, rem);
    if (!incRemInfo) return null;

    return {
      ctx,
      rem,
      incRemInfo,
    };
  }, []);

  const sessionCacheData = useTrackerPlugin(async (rp) => {
    if (useLightMode || !baseData?.rem) {
      return null;
    }
    return await rp.storage.getSession<QueueSessionCache>(queueSessionCacheKey);
  }, [useLightMode, baseData?.rem?._id]);

  const coreData = baseData ? { ...baseData, sessionCache: sessionCacheData } : null;
  shownRemIdRef.current = baseData?.rem?._id; // FORK (Deviation 16)

  const shieldStatusAsync = useTrackerPlugin(async (rp) => {
    // FORK (Deviation 13): shields disabled — skip the whole computation.
    if (!FORK_FEATURES.shields) return null;
    if (useLightMode || !shouldDisplayShield || !coreData?.sessionCache) return null;

    const seenRemIds = (await rp.storage.getSession<string[]>(seenRemInSessionKey)) || [];

    const { sessionCache, rem } = coreData;
    const dueKb = sessionCache.dueIncRemsInKB || [];
    const unreviewedDueKb = dueKb.filter(
      (r) => !seenRemIds.includes(r.remId) || r.remId === rem._id
    );
    const topMissedInKb = _.minBy(unreviewedDueKb, (r) => r.priority);

    const dueDoc = sessionCache.dueIncRemsInScope || [];
    const unreviewedDueDoc = dueDoc.filter(
      (r) => !seenRemIds.includes(r.remId) || r.remId === rem._id
    );
    const topMissedInDoc = _.minBy(unreviewedDueDoc, (r) => r.priority);

    const kbPercentile = topMissedInKb ? calculateVolumeBasedPercentile(
      allIncRems,
      topMissedInKb.priority,
      (r) => !seenRemIds.includes(r.remId) || r.remId === rem._id
    ) : null;

    if (topMissedInKb) {
      // console.log(`[AnswerButtons] KB Shield: Priority ${topMissedInKb.priority}, Percentile ${kbPercentile}%, Universe ${allIncRems.length}`);
    }


    // DOC Shield Calculation
    let docPercentile: number | null = null;
    if (topMissedInDoc && scopeRemIds) {
      const scopeSet = new Set(scopeRemIds);
      const allIncRemsInScope = allIncRems.filter(r => scopeSet.has(r.remId));
      if (allIncRemsInScope.length > 0) {
        docPercentile = calculateVolumeBasedPercentile(
          allIncRemsInScope,
          topMissedInDoc.priority,
          (r) => !seenRemIds.includes(r.remId) || r.remId === rem._id
        );
        // console.log(`[AnswerButtons] Doc Shield: Priority ${topMissedInDoc.priority}, Percentile ${docPercentile}%, Universe ${allIncRemsInScope.length}`);
      }
    }

    // Weighted Shield Calculation
    let weightedKB: number | null = null;
    let weightedDoc: number | null = null;
    let docIncRems: IncrementalRem[] | null = null;

    if (shouldDisplayWeightedShield && allIncRems.length > 0) {
      weightedKB = calculateWeightedShield(
        allIncRems,
        (r) => Date.now() >= r.nextRepDate && (!seenRemIds.includes(r.remId) || r.remId === rem._id)
      );

      if (scopeRemIds) {
        const scopeSet2 = new Set(scopeRemIds);
        docIncRems = allIncRems.filter(r => scopeSet2.has(r.remId));
        if (docIncRems.length > 0) {
          weightedDoc = calculateWeightedShield(
            docIncRems,
            (r) => Date.now() >= r.nextRepDate && (!seenRemIds.includes(r.remId) || r.remId === rem._id)
          );
        }
      }
    }

    return {
      kb: topMissedInKb ? {
        absolute: topMissedInKb.priority,
        percentile: kbPercentile ?? null,
      } : null,
      doc: topMissedInDoc ? {
        absolute: topMissedInDoc.priority,
        percentile: docPercentile,
      } : null,
      weightedKB,
      weightedDoc,
      docIncRems,
      seenRemIds,
    };
  }, [shouldDisplayShield, shouldDisplayWeightedShield, coreData?.sessionCache, allIncRems, coreData?.rem?._id, useLightMode, scopeRemIds]);

  const htmlSourceUrl = useTrackerPlugin(async (rp) => {
    // console.log('[htmlSourceUrl] rem:', baseData?.rem?._id, 'remType:', remType);
    if (!baseData?.rem) return null;
    const type = await rp.storage.getSession<string | null>(currentIncrementalRemTypeKey);
    // console.log('[htmlSourceUrl] type from session:', type);
    if (type !== 'html' && type !== 'html-highlight') return null;
    const url = await getHtmlSourceUrl(rp, baseData.rem, type);
    // console.log('[htmlSourceUrl] found URL:', url);
    return url;
  }, [baseData?.rem?._id, remType]);

  const externalUrls = useTrackerPlugin(async (rp) => {
    if (!baseData?.rem) return [];
    try {
      return await extractExternalHttpUrlsFromRem(rp, baseData.rem);
    } catch (e) {
      console.error('[externalUrls] error:', e);
      return [];
    }
  }, [baseData?.rem]);

  /** Plain-text title ends with "(OpenLink)" (case-sensitive) — with extracted URLs, Open Editor skips the Rem document tab. */
  const remTitleEndsWithOpenLinkTagState = useTrackerPlugin(async (rp) => {
    if (!baseData?.rem) return false;
    return remTitleEndsWithOpenLinkTag(rp, baseData.rem);
  }, [baseData?.rem]);

  // Fetch the most recent bookmark highlightId for this IncRem (pdf or html doc reps).
  // Skipped for highlight reps — those auto-scroll to the highlight itself, no
  // separate bookmark concept applies.
  // FORK (#29): the costliest of the group — a multi-hop chain
  // (getActivePdfForIncRem -> getPageHistory) on every pdf/html card, consumed
  // only by the pdfReader-gated Scroll-to-Bookmark button.
  const bookmarkHighlightId = useTrackerPlugin(async (rp) => {
    if (!FORK_FEATURES.pdfReader) return null;
    if (!baseData?.rem) return null;
    const type = await rp.storage.getSession<string | null>(currentIncrementalRemTypeKey);
    if (type !== 'pdf' && type !== 'html') return null;

    const hostRem = type === 'pdf'
      ? await getActivePdfForIncRem(rp, baseData.rem)
      : await findHTMLinRem(rp, baseData.rem);
    if (!hostRem) return null;

    const history = await getPageHistory(rp, baseData.rem._id, hostRem._id);
    // Only use the highlight if the LAST entry carries a highlightId.
    // If a manual position was recorded after the highlight bookmark, the button
    // would scroll to a stale position, so we suppress it in that case.
    const lastEntry = history[history.length - 1];
    return lastEntry?.highlightId ?? null;
  }, [baseData?.rem?._id, remType]);

  // Read point on the IncRem's OWN outline (a bookmarked descendant rem). Only
  // surfaced for hybrid cards reviewed as a PDF/HTML source — pure rem-type cards
  // already show the read point in the ExtractViewer body. The in-queue reader
  // can't navigate to a descendant without leaving the queue, so this is an
  // informational chip that points the user to "Review in Editor" instead of
  // navigating. Also flags whether the read point is the most recent reading
  // action (vs the PDF/HTML bookmark).
  // FORK (#29): ~5-6 chained RPCs per pdf/html card (getSession ->
  // getRemReadPoint -> findOne -> resolveRemTextForBreadcrumb ->
  // getActivePdfForIncRem -> getPageHistory) for the readPoints-gated button.
  const remReadPointInfo = useTrackerPlugin(async (rp) => {
    if (!FORK_FEATURES.readPoints) return null;
    if (!baseData?.rem) return null;
    const type = await rp.storage.getSession<string | null>(currentIncrementalRemTypeKey);
    if (type !== 'pdf' && type !== 'html') return null;

    const entry = await getRemReadPoint(rp, baseData.rem._id);
    if (!entry?.highlightId) return null;

    const targetRem = await rp.rem.findOne(entry.highlightId);
    if (!targetRem) return null;
    const text = await resolveRemTextForBreadcrumb(rp, targetRem.text || []);

    const hostRem = type === 'pdf'
      ? await getActivePdfForIncRem(rp, baseData.rem)
      : await findHTMLinRem(rp, baseData.rem);
    let readerTs = 0;
    if (hostRem) {
      const hist = await getPageHistory(rp, baseData.rem._id, hostRem._id);
      readerTs = hist[hist.length - 1]?.timestamp ?? 0;
    }
    return {
      targetRemId: entry.highlightId,
      text,
      isLatest: (entry.timestamp ?? 0) > readerTs,
    };
  }, [baseData?.rem?._id, remType]);


  // ✅ MEMOIZE CALCULATIONS (but they must run every render, not conditionally)
  const percentiles = useMemo(() => {
    if (!coreData) return { kb: null, doc: null };

    const { incRemInfo, sessionCache } = coreData;
    const kbPercentile = calculateRelativePercentile(allIncRems, incRemInfo.remId);
    const docPercentile = sessionCache?.incRemDocPercentiles?.[incRemInfo.remId] ?? null;

    return { kb: kbPercentile, doc: docPercentile };
  }, [coreData, allIncRems]);

  // Calculate history stats for display (must be before early returns)
  const historyStats = useMemo(() => {
    if (!coreData?.incRemInfo?.history || coreData.incRemInfo.history.length === 0) {
      return { reps: 0, totalMinutes: 0 };
    }
    // Only count real repetitions (events that count for interval calculation).
    // Uses the shared scheduling predicate — excludes markers, slot edits, and
    // 'importedRep' (imported flashcard reviews never belong to a rem's schedule).
    const realReps = coreData.incRemInfo.history.filter(h => repCountsForScheduling(h.eventType));
    const reps = realReps.length;
    const totalSeconds = realReps.reduce((total, rep) => total + (rep.reviewTimeSeconds || 0), 0);
    const totalMinutes = Math.round(totalSeconds / 6) / 10; // Round to 1 decimal
    return { reps, totalMinutes };
  }, [coreData?.incRemInfo?.history]);

  // Detect whether the stats separator `|` has flex-wrapped to a new line.
  // CSS cannot observe line-breaks in a flex-wrap container, so we compare the
  // vertical position of the separator span against the stats div with a layout effect.
  // The `|` stays in the DOM (opacity: 0 when hidden) so it's always measurable.
  const statsSepRef = useRef<HTMLSpanElement>(null);
  const statsContainerRef = useRef<HTMLDivElement>(null);
  const [statsSepVisible, setStatsSepVisible] = useState(true);

  useLayoutEffect(() => {
    const sep = statsSepRef.current;
    const stats = statsContainerRef.current;
    if (!sep || !stats) return;
    // Compare vertical midpoints rather than top edges: in a centered flex row,
    // elements of different heights have different tops even when on the same row.
    const sepRect = sep.getBoundingClientRect();
    const statsRect = stats.getBoundingClientRect();
    const sepMid = sepRect.top + sepRect.height / 2;
    const statsMid = statsRect.top + statsRect.height / 2;
    const sameRow = Math.abs(sepMid - statsMid) < 4;
    setStatsSepVisible(sameRow);
  }); // No deps — runs after every render so it catches the first render where refs are populated

  // Review note (📝): parked per-rem in session storage on every keystroke and
  // attached to the history entry written by whichever action ends this review
  // (Next / Reschedule / Dismiss) — see stampNoteAndContext in lib/history_notes.
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState('');
  const currentRemId = baseData?.rem?._id;
  useEffect(() => {
    // New card: reset the input, then prefill from a previously parked note
    // (e.g. typed earlier this session but not yet consumed).
    setNoteOpen(false);
    setNoteText('');
    if (!currentRemId) return;
    // FORK (2026-08-14, bug-hunt #47): stale-guard the async prefill. Advancing
    // quickly (A -> B) let A's promise resolve after B's effect had already run,
    // so B opened the note box prefilled with A's parked text. Storage is keyed
    // per rem so nothing was written to the wrong rem — but the wrong text was
    // shown, and would have been saved to B on the next review.
    let stale = false;
    getPendingReviewNote(plugin, currentRemId).then((parked) => {
      if (stale) return;
      if (parked) {
        setNoteText(parked);
        setNoteOpen(true);
      }
    });
    return () => {
      stale = true;
    };
  }, [currentRemId]);

  // FORK (2026-08-14, bug-hunt #46): close the offset picker when the card
  // changes. The widget is NOT remounted per card — the note state directly above
  // proves it, since it has to reset itself — so the row stayed open across a
  // transition, still labelled for the previous mode ("Skip to (no review)") on a
  // brand-new item. The chosen value/unit deliberately persist; only the open
  // state resets.
  useEffect(() => {
    setOffsetRowFor(null);
    // FORK (2026-08-15, review §2.1): reset the ⚙️ Options panel too. Its toggle
    // BUTTON renders inside `{!isProcessed && ...}` but the panel itself did not,
    // and unlike the offset row it was never reset per card — so "open Options →
    // Next → Previous" landed on the already-processed row with the panel still
    // open, offering Reschedule / Change Priority / Review with Timer. The last of
    // those calls updateReviewRemData, which breaks Deviation 8's invariant that
    // nothing reachable on that row can write a schedule.
    setShowAdvancedOptions(false);
  }, [currentRemId]);

  // ✅ NOW we can do early returns AFTER all hooks are called
  if (!coreData) {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        padding: '20px',
        color: '#6b7280',
        fontSize: '13px'
      }}>
        Loading...
      </div>
    );
  }

  const { ctx, rem, incRemInfo, sessionCache } = coreData;

  // FORK (2026-08-14): an item whose next repetition is in the future has already
  // been processed — a stale queue entry (reviewed on another device mid-session)
  // or one revisited with Previous. It used to be silently skipped by a due-check
  // effect in queue.tsx; it is now shown with a distinct button row instead, so
  // "already done" is visible rather than inferred from an item vanishing.
  const isProcessed = Date.now() < incRemInfo.nextRepDate;

  const hasInvalidRotation = !!(
    incRemInfo.rotation &&
    incRemInfo.rotation.toLowerCase() !== 'default' &&
    getRotationIntervalMs(incRemInfo.rotation) === null
  );

  const warningStyle: React.CSSProperties = hasInvalidRotation
    ? {
        borderColor: 'var(--rn-clr-yellow, #f59e0b)',
        color: 'var(--rn-clr-yellow-dark, #92400e)',
      }
    : {};

  const capturePdfPageHistoryIfNeeded = async () => {
    // FORK (Deviation 13): PDF reader disabled — stop writing reading positions.
    if (!FORK_FEATURES.pdfReader) return;
    if (remType === 'pdf') {
      const pdfRem = await getActivePdfForIncRem(plugin, rem);
      if (pdfRem) {
        const currentPage = await getIncrementalReadingPosition(plugin, rem._id, pdfRem._id);

        if (currentPage) {
          // Carry a session bookmark forward so this reading-time entry does
          // not bury it and make the Scroll button appear stale.
          const carryHighlightId = await resolveSessionBookmarkCarry(plugin, rem._id, pdfRem._id, currentPage);
          // Compute review duration here (addPageToHistory no longer auto-
          // computes — bookmark/UI callers must not record durations).
          const startTime = await plugin.storage.getSession<number>(incremReviewStartTimeKey);
          const reviewTimeSeconds = startTime
            ? Math.round((Date.now() - startTime) / 1000)
            : undefined;
          await addPageToHistory(plugin, rem._id, pdfRem._id, currentPage, reviewTimeSeconds, carryHighlightId);
        }
      }
    }
  };

  const handleNextClick = async () => {
    await capturePdfPageHistoryIfNeeded();

    await handleNextRepetitionClick(plugin, incRemInfo);
  };

  const runManualNext = async (offsetDays: number) => {
    await handleNextRepetitionManualOffset(plugin, incRemInfo, offsetDays);
  };

  /** External http(s) tabs only when title ends with "(OpenLink)" — otherwise Open Editor opens the Rem document only. */
  const openExternalLinkTabsWhenOpenLinkTagged = () => {
    if (remTitleEndsWithOpenLinkTagState !== true) return;
    externalUrls?.forEach((url) => window.open(url, '_blank'));
  };

  const openEditorAction = async (incRemTypeOverride?: string) => {
    try {
      const incRemType = incRemTypeOverride ?? await determineIncRemType(plugin, rem);
      if (incRemType === 'pdf-note') {
        await rem.openRemAsPage();
      } else {
        await plugin.window.openRem(rem);
      }
    } catch (error) {
      console.error('Error opening document:', error);
      plugin.app.toast('Error opening document');
    }
  };

  // FORK (2026-08-14): the processed state's Open Editor. Same navigation as the
  // normal one — (OpenLink) policy included — but it records NO review and leaves
  // the schedule untouched. Re-reviewing an item you deliberately went back to look
  // at would overwrite the very date that marks it as already processed.
  const openEditorWithoutReview = async () => {
    // Synchronous first, so the user-gesture token survives for window.open.
    openExternalLinkTabsWhenOpenLinkTagged();
    const skipRemDocument = shouldSkipRemDocumentForOpenEditor;
    // Dispatch together: removeCurrentCardFromQueue can tear down this sandbox
    // before a later await would resolve (same reason as the Dismiss path).
    await Promise.allSettled([
      plugin.queue.removeCurrentCardFromQueue(),
      skipRemDocument ? Promise.resolve() : openEditorAction(),
    ]);
  };

  const shouldSkipRemDocumentForOpenEditor =
    remTitleEndsWithOpenLinkTagState === true && (externalUrls?.length ?? 0) > 0;

  /** "(OpenLink)" + URLs: external tabs, no Rem doc; else Rem document only, then advance. */
  const performOpenEditorFlow = async () => {
    const skipRemDocument = shouldSkipRemDocumentForOpenEditor;
    openExternalLinkTabsWhenOpenLinkTagged();
    if (skipRemDocument) {
      await handleNextClick();
      return;
    }
    await capturePdfPageHistoryIfNeeded();
    try {
      await plugin.storage.setSession('plugin_operation_active', true);
      const reviewResult = await updateReviewRemData(plugin, incRemInfo);
      // FORK (2026-08-14, bug-hunt #9): null means the write failed — do not
      // advance past an item that was not actually reviewed. Opening the editor
      // without advancing is fine (and arguably what the user wants next), but
      // the queue must keep the item; updateReviewRemData has already toasted.
      if (!reviewResult) {
        await openEditorAction();
        return;
      }
      const updatedIncRem: IncrementalRem = {
        ...incRemInfo,
        nextRepDate: reviewResult.newNextRepDate,
        history: reviewResult.newHistory,
      };
      await updateIncrementalRemCache(plugin as any, updatedIncRem);
      const incRemType = await determineIncRemType(plugin, rem);
      // Dispatch both critical operations before widget teardown can interrupt either.
      await Promise.allSettled([
        plugin.queue.removeCurrentCardFromQueue(),
        openEditorAction(incRemType),
      ]);
    } finally {
      await plugin.storage.setSession('plugin_operation_active', false);
    }
  };

  // Open Editor with a manual offset: same flow as the main click, but the
  // review is recorded with the chosen offset instead of the scheduler's date.
  const runOpenEditorWithOffset = async (offsetDays: number) => {
    openExternalLinkTabsWhenOpenLinkTagged();
    if (shouldSkipRemDocumentForOpenEditor) {
      await runManualNext(offsetDays);
      return;
    }
    const incRemType = await determineIncRemType(plugin, rem);
    // FORK (2026-08-15, review §2.4): AWAIT the review before navigating.
    //
    // This used to be Promise.allSettled([runManualNext, openEditorAction]) — both
    // started together. openEditorAction reaches openRem on its first tick while the
    // write has ~6 sequential awaits ahead of it, so the widget could be torn down
    // mid-write. Deviation 6 states the rule ("scheduling runs before navigation so
    // the widget is not destroyed before the review is recorded") and the sibling
    // performOpenEditorFlow follows it. It also defeated the #9 guard: a "could not
    // save" toast surfaced after the user had already left the queue.
    await runManualNext(offsetDays);
    await openEditorAction(incRemType);
  };

  // FORK (2026-08-14, bug-hunt #52 + #59): `!== null`, not truthiness —
  // calculateRelativePercentile legitimately returns 0.0 for the top-priority rem
  // once the KB exceeds ~2000 items, and `0 ?` is falsy, so the most important
  // item in the KB rendered a grey border. And when there IS no percentile, fall
  // back to the absolute priority exactly as queue_info_bar does, instead of
  // diverging to neutral grey while its comment claimed the two matched.
  // FORK (#13, completed 2026-08-14): a 'fallback' prioritySource means the
  // priority slot could NOT be read and the number is the placeholder 50, which
  // types.ts says "means nothing". queue_priority_chip and queue_info_bar were
  // both taught this; THIS bar was missed — so a damaged rem showed a grey `P?`
  // chip reading "could not be read" in the toolbar and, two inches below, a
  // confidently coloured border plus a ringed band asserting the item sits at 50.
  const priorityUnreadable = incRemInfo.prioritySource === 'fallback';
  const priorityColor = priorityUnreadable
    ? QUEUE_PRIORITY_NEUTRAL_COLOR
    : percentiles.kb !== null
      ? percentileToHslColor(percentiles.kb)
      : percentileToHslColor(incRemInfo.priority);
  const buttonStyles = getButtonStyles();

  // When both a reader bookmark and an outline read point exist, the reader
  // bookmark is the "latest" only when the read point isn't (mirrors the editor
  // timer's marker). With no read point there's nothing to compare, so no badge.
  const readerBookmarkIsLatest = !!remReadPointInfo && !remReadPointInfo.isLatest;

  // --- NEW: Check if current IncRem is directly impacting the shield ---
  const isKbShieldActive = shieldStatusAsync?.kb && incRemInfo.priority === shieldStatusAsync.kb.absolute;
  const isDocShieldActive = shieldStatusAsync?.doc && incRemInfo.priority === shieldStatusAsync.doc.absolute;
  const isAnyShieldActive = isKbShieldActive || isDocShieldActive;

  // Container styles using RemNote CSS variables
  const containerStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    padding: QUEUE_INFO_BAR_OUTER_PADDING,
    backgroundColor: 'var(--rn-clr-background-primary)',
    borderRadius: '12px',
  };

  const buttonRowStyle: React.CSSProperties = {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
  };

  const dividerStyle: React.CSSProperties = {
    width: '1px',
    height: '40px',
    backgroundColor: 'var(--rn-clr-border-primary)',
    margin: '0 6px',
  };

  const infoBarStyle = getQueueInfoBarStyle(priorityColor);

  return (
    <div
      style={containerStyle}
      className="incremental-everything-answer-buttons"
      onMouseDown={(e) => {
        // Prevent the plugin iframe from capturing keyboard focus on non-interactive areas.
        // Without this, clicking the answer buttons area steals focus from RemNote's
        // parent window, blocking native queue shortcuts like "P" (previewer) and "G" (Go to Rem).
        if (!(e.target as HTMLElement).closest('button, [role="button"], a, input, select, textarea')) {
          e.preventDefault();
        }
      }}
      onClick={(e) => {
        // After any click, return focus to the parent window so native
        // RemNote shortcuts work immediately. EXCEPT for text inputs (the
        // review-note field) — blurring those would make typing impossible.
        if ((e.target as HTMLElement).closest('input, textarea')) return;
        try {
          if (document.activeElement instanceof HTMLElement) {
            document.activeElement.blur();
          }
          window.parent?.focus();
        } catch (_) { /* cross-origin safe */ }
      }}
    >
      {/* FORK (2026-08-14): "already processed" row — shown instead of the normal
          actions when this item's next repetition is in the future. Reached by
          pressing Previous after reviewing, or by meeting a queue entry that another
          device has since rescheduled. The point is that the item stays VISIBLE and
          says so, rather than being silently advanced past. */}
      {isProcessed && (
        <div style={buttonRowStyle}>
          <Button
            variant="secondary"
            disabled={isBusy}
            onClick={() => runExclusive(async () => {
              await plugin.queue.goBackToPreviousCard();
            })}
            title="Previous: Go back to the previous card in the queue"
          >
            <div style={buttonStyles.label}>Previous</div>
          </Button>

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0 14px',
              lineHeight: 1.25,
              whiteSpace: 'nowrap',
            }}
            title={`Already reviewed. Next repetition ${dayjs(incRemInfo.nextRepDate).format('dddd, D MMMM YYYY')}.`}
          >
            <span style={{ fontWeight: 700, fontSize: '13px', color: 'var(--rn-clr-green, #16a34a)' }}>
              ✓ Already reviewed
            </span>
            <span style={{ fontSize: '11px', color: 'var(--rn-clr-content-tertiary)' }}>
              next in{' '}
              {durationToHumanReadable(dayjs.duration(dayjs(incRemInfo.nextRepDate).diff(dayjs())))}
              {' · '}
              {dayjs(incRemInfo.nextRepDate).format('ddd, MMM D')}
            </span>
          </div>

          <Button
            variant="secondary"
            disabled={isBusy}
            style={{
              color: 'var(--rn-clr-green, #16a34a)',
              border: '1px solid var(--rn-clr-green, #16a34a)',
            }}
            onClick={() => runExclusive(openEditorWithoutReview)}
            title="Open: open this Rem in the editor without re-reviewing it — its schedule stays as it is"
          >
            <div style={buttonStyles.label}>Open</div>
          </Button>

          {/* Plain secondary styling, exactly like Previous: NOTHING in this row
              changes the item's schedule, and the buttons should look like it.
              This Next therefore only advances the queue — it deliberately does
              NOT call handleNextClick, which would record a repetition and
              rewrite nextRepDate from today. */}
          <Button
            variant="secondary"
            disabled={isBusy}
            onClick={() => runExclusive(async () => {
              await plugin.queue.removeCurrentCardFromQueue();
            })}
            title="Next: move on to the next item — this item's schedule is left as it is"
          >
            <div style={buttonStyles.label}>Next</div>
          </Button>
        </div>
      )}

      {/* Single row of buttons */}
      {!isProcessed && (
      <div style={buttonRowStyle}>
        <Button
          variant="secondary"
          disabled={isBusy}
          onClick={() => runExclusive(async () => {
            // No back-nav flag needed since 2026-08-14: nothing auto-skips an
            // item that is no longer due — it renders the 'already processed'
            // state instead (see isProcessed below).
            await plugin.queue.goBackToPreviousCard();
          })}
          title="Previous: Go back to the previous card in the queue"
          style={{ width: MAIN_BUTTON_WIDTH }}
        >
          <div style={buttonStyles.label}>Previous</div>
        </Button>

        <SplitButton
          variant="secondary"
          disabled={isBusy}
          onClick={() => runExclusive(handleNextClick)}
          title="Next (Cmd+Right / Ctrl+Right, or Opt+T): Mark as reviewed, calculate next interval, and advance to next item"
          onChevronClick={() => setOffsetRowFor((v) => (v === 'next' ? null : 'next'))}
          chevronActive={offsetRowFor === 'next'}
          width={MAIN_BUTTON_WIDTH}
          style={{
            // Outline colouring (Dismiss-style): border + font only, neutral background.
            color: 'var(--rn-clr-blue, #3b82f6)',
            border: '1px solid var(--rn-clr-blue, #3b82f6)',
            ...warningStyle,
          }}
        >
          <div style={buttonStyles.label}>Next</div>
          {hasInvalidRotation ? (
            <div style={{ ...buttonStyles.sublabel, color: 'var(--rn-clr-yellow, #f59e0b)' }}>
              invalid rotation
            </div>
          ) : (
            <div style={buttonStyles.sublabel}><NextRepTime rem={incRemInfo} bare /></div>
          )}
        </SplitButton>

        <SplitButton
          variant="secondary"
          disabled={isBusy}
          // runExclusive reaches `await fn()` without yielding, so
          // performOpenEditorFlow's synchronous first statement
          // (openExternalLinkTabsWhenOpenLinkTagged) still runs in the click's own
          // tick — the user-gesture token for window.open survives the wrapper.
          onClick={() => runExclusive(performOpenEditorFlow)}
          width={MAIN_BUTTON_WIDTH}
          style={{
            // Outline colouring (Dismiss-style): border + font only, neutral background.
            color: 'var(--rn-clr-green, #16a34a)',
            border: '1px solid var(--rn-clr-green, #16a34a)',
            ...warningStyle,
          }}
          title={
            shouldSkipRemDocumentForOpenEditor
              ? 'Open external link(s) in new tab(s), then advance the queue (title ends with "(OpenLink)" — no Rem document tab)'
              : 'Open (Ctrl+G): open this Rem in the editor, then advance (external URLs open in tabs only when the title ends with "(OpenLink)")'
          }
          onChevronClick={() => setOffsetRowFor((v) => (v === 'editor' ? null : 'editor'))}
          chevronActive={offsetRowFor === 'editor'}
        >
          <div style={buttonStyles.label}>Open</div>
          {hasInvalidRotation ? (
            <div style={{ ...buttonStyles.sublabel, color: 'var(--rn-clr-yellow, #f59e0b)' }}>
              invalid rotation
            </div>
          ) : (
            <div style={buttonStyles.sublabel}><NextRepTime rem={incRemInfo} bare /></div>
          )}
        </SplitButton>

        {/* FORK (Deviation 16, 2026-10-10): 🔄 another item — set this Incremental Rem
            aside for the session and show a different due one in this same queue slot,
            right away: no review, no reschedule, no detour through the flashcards. */}
        <Button
          variant="secondary"
          disabled={isBusy}
          title="Another item (Opt+R): set this Incremental Rem aside for this session and show a different due one right away — no review, no reschedule"
          onClick={() => runExclusive(async () => {
            const result = await requestAnotherIncRem(plugin, rem._id);
            if (result.outcome === 'none') await plugin.app.toast('No other Incremental Rem is due right now.');
            else if (result.outcome === 'timeout') await plugin.app.toast('Could not fetch another item — please try again.');
            else {
              // Keep the row locked until THIS row acts on the new rem, so no action
              // can land on the one just set aside (bounded; never fails the swap).
              const until = Date.now() + 1500;
              while (Date.now() < until && shownRemIdRef.current !== result.showRemId) {
                await new Promise((r) => setTimeout(r, 50));
              }
            }
          })}
          // Icon-only: half the base button's 95px minimum, so the main row still fits
          // on one line in the narrower Beautiful card.
          style={{ minWidth: 48, padding: '10px 12px' }}
        >
          <div style={{ fontSize: 20, lineHeight: 1 }}>🔄</div>
        </Button>

        <SplitButton
          variant="secondary"
          disabled={isBusy}
          onClick={() => runExclusive(async () => {
            await plugin.queue.removeCurrentCardFromQueue();
          })}
          title="Skip (Opt+B): Move to the next item without recording a review or rescheduling"
          onChevronClick={() => setOffsetRowFor((v) => (v === 'skip' ? null : 'skip'))}
          chevronActive={offsetRowFor === 'skip'}
          width={MAIN_BUTTON_WIDTH}
          style={{
            // Outline colouring (Dismiss-style): border + font only, neutral background.
            color: 'var(--rn-clr-purple, #8b5cf6)',
            border: '1px solid var(--rn-clr-purple, #8b5cf6)',
          }}
        >
          <div style={buttonStyles.label}>Skip</div>
        </SplitButton>

        <Button
          variant="danger"
          disabled={isBusy}
          onClick={() => runExclusive(async () => {
            // FORK (Deviation 13): card surface disabled — don't stamp CardPriority
            // tags onto dismissed rems (T4).
            if (FORK_FEATURES.cardSurface) await handleCardPriorityInheritance(plugin, rem, incRemInfo);

            //Calculate review time and add current history entry
            const startTime = await plugin.storage.getSession<number>(incremReviewStartTimeKey);
            const reviewTimeSeconds = startTime ? dayjs().diff(dayjs(startTime), 'second') : 0;

            const currentRep: IncrementalRep = {
              date: Date.now(),
              scheduled: incRemInfo.nextRepDate,
              reviewTimeSeconds: reviewTimeSeconds,
              eventType: 'rep',
              // FORK (#13): omits priority entirely when it is the unreadable
              // placeholder, instead of laundering 50 into history.
              ...priorityStampFor(incRemInfo),
            };

            const updatedHistory = [...(incRemInfo.history || []), currentRep];

            // Save updated history to dismissed powerup BEFORE removing incremental
            await transferToDismissed(plugin, rem, updatedHistory);

            // Reflect the dismissal in the Incremental History widget
            await addToIncrementalHistory(plugin, rem._id, { dismissed: true });

            // Remove from session cache
            await removeIncrementalRemCache(plugin, rem._id);

            // Like "Next", leaving the rem should restore the queue dashboard.
            // Set the flag BEFORE the destructive call below (the persistent
            // QueueLoadCard listener consumes it once the next card loads).
            await requestQueueDashboardRefocus(plugin, 'dismiss-button');

            // CRITICAL: Both removePowerup and removeCurrentCardFromQueue must be
            // fired simultaneously. removePowerup destroys the widget sandbox
            // shortly after resolving, so any subsequent await never completes.
            // By initiating both calls at once, both IPC messages reach RemNote
            // before either can trigger sandbox destruction.
            console.log('[Dismiss] Firing removePowerup + removeCurrentCardFromQueue simultaneously for rem:', rem._id);
            await Promise.allSettled([
              rem.removePowerup(powerupCode),
              plugin.queue.removeCurrentCardFromQueue(true),
            ]);
            console.log('[Dismiss] Both operations settled');
          })}
          title="Dismiss (Ctrl+D): Permanently finish item by removing its Incremental power-up"
          style={{ width: MAIN_BUTTON_WIDTH }}
        >
          <div style={buttonStyles.label}>Dismiss</div>
        </Button>

        <Button
          onClick={() => setShowAdvancedOptions(!showAdvancedOptions)}
          variant={showAdvancedOptions ? "primary" : "secondary"}
          title="Toggle advanced options"
        >
          <div style={buttonStyles.label}>⚙️ Options</div>
        </Button>
      </div>
      )}

      {/* Offset picker — opened by the chevrons on Next / Open Editor / Skip.
          Number stepper + unit toggle + live landing date + one Apply button.
          Same visual convention as the ⚙️ Options row below. */}
      {offsetRowFor && (() => {
        const offsetDays = offsetToDays(offsetValue, offsetUnit);
        const landing = dayjs().startOf('day').add(offsetDays, 'day');
        const unitWord = offsetValue === 1 ? offsetUnit.slice(0, -1) : offsetUnit;
        const applyLabel =
          offsetRowFor === 'next'
            ? `Next in ${offsetValue} ${unitWord}`
            : offsetRowFor === 'editor'
              ? `Open in ${offsetValue} ${unitWord}`
              : `Skip to ${offsetValue} ${unitWord}`;
        // Outline colouring per mode, matching the main buttons (border + font only).
        const applyStyle =
          offsetRowFor === 'next'
            ? { color: 'var(--rn-clr-blue, #3b82f6)', border: '1px solid var(--rn-clr-blue, #3b82f6)' }
            : offsetRowFor === 'editor'
              ? { color: 'var(--rn-clr-green, #16a34a)', border: '1px solid var(--rn-clr-green, #16a34a)' }
              : { color: 'var(--rn-clr-purple, #8b5cf6)', border: '1px solid var(--rn-clr-purple, #8b5cf6)' };
        const runApply = () => runExclusive(async () => {
          setOffsetRowFor(null);
          if (offsetRowFor === 'next') {
            await runManualNext(offsetDays);
          } else if (offsetRowFor === 'editor') {
            await runOpenEditorWithOffset(offsetDays);
          } else {
            await rescheduleWithoutReview(plugin, incRemInfo, offsetDays);
          }
        });
        const stepBtnStyle: React.CSSProperties = {
          width: 28,
          height: 28,
          borderRadius: 8,
          border: '1px solid var(--rn-clr-border-primary)',
          backgroundColor: 'var(--rn-clr-background-primary)',
          color: 'var(--rn-clr-content-primary)',
          fontSize: 15,
          fontWeight: 600,
          lineHeight: 1,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        };
        return (
          <div
            style={{
              display: 'flex',
              gap: '10px',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: 'var(--rn-clr-background-secondary)',
              padding: '8px 12px',
              borderRadius: '8px',
              border: '1px solid var(--rn-clr-border-primary)',
            }}
          >
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--rn-clr-content-tertiary)' }}>
              {offsetRowFor === 'next' ? 'Next in:' : offsetRowFor === 'editor' ? 'Open in:' : 'Skip to (no review):'}
            </span>

            {/* Stepper: − [n] + */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <button
                style={stepBtnStyle}
                title="Decrease"
                onClick={() => setOffsetValue((v) => Math.max(1, v - 1))}
              >
                −
              </button>
              <input
                type="number"
                min={1}
                max={999}
                value={offsetValue}
                onChange={(e) => {
                  // FORK (2026-08-14, bug-hunt #37): allow the field to be empty
                  // while editing. This is a CONTROLLED input, so ignoring NaN
                  // meant the old value was re-rendered immediately: deleting both
                  // digits of "12" was impossible, and changing it required
                  // select-all-then-type. 0 is a valid transient state; the value
                  // is clamped on blur and on apply.
                  const t = e.target.value;
                  if (t === '') {
                    setOffsetValue(0);
                    return;
                  }
                  const n = parseInt(t, 10);
                  if (!isNaN(n)) setOffsetValue(Math.min(999, n));
                }}
                onBlur={() => setOffsetValue((v) => Math.min(999, Math.max(1, v || 1)))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') runApply();
                  if (e.key === 'Escape') setOffsetRowFor(null);
                  e.stopPropagation();
                }}
                style={{
                  width: 52,
                  height: 28,
                  textAlign: 'center',
                  fontSize: 13,
                  fontWeight: 600,
                  borderRadius: 8,
                  border: '1px solid var(--rn-clr-border-primary)',
                  backgroundColor: 'var(--rn-clr-background-primary)',
                  color: 'var(--rn-clr-content-primary)',
                  outline: 'none',
                }}
              />
              <button
                style={stepBtnStyle}
                title="Increase"
                onClick={() => setOffsetValue((v) => Math.min(999, v + 1))}
              >
                +
              </button>
            </div>

            {/* Unit segmented toggle */}
            <div
              style={{
                display: 'inline-flex',
                borderRadius: 8,
                border: '1px solid var(--rn-clr-border-primary)',
                overflow: 'hidden',
              }}
            >
              {OFFSET_UNITS.map(({ unit, label }) => (
                <button
                  key={unit}
                  onClick={() => setOffsetUnit(unit)}
                  style={{
                    padding: '5px 12px',
                    fontSize: 12,
                    fontWeight: 600,
                    border: 'none',
                    cursor: 'pointer',
                    backgroundColor:
                      offsetUnit === unit
                        ? 'var(--rn-clr-button-primary-bg, #3b82f6)'
                        : 'var(--rn-clr-background-primary)',
                    color: offsetUnit === unit ? '#ffffff' : 'var(--rn-clr-content-primary)',
                    transition: 'background-color 0.15s',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Landing date preview */}
            <span style={{ fontSize: '12px', color: 'var(--rn-clr-content-tertiary)', whiteSpace: 'nowrap' }}>
              → {landing.format('ddd, MMM D')}{offsetDays !== offsetValue || offsetUnit !== 'days' ? ` (${offsetDays}d)` : ''}
            </span>

            <Button
              variant="secondary"
              style={applyStyle}
              onClick={runApply}
              title={
                offsetRowFor === 'next'
                  ? `Record a review and schedule the next repetition in ${offsetDays} day(s)`
                  : offsetRowFor === 'editor'
                    ? `Record a review scheduled in ${offsetDays} day(s), then open the editor`
                    : `Reschedule ${offsetDays} day(s) from now without recording a review`
              }
            >
              <div style={buttonStyles.label}>{applyLabel}</div>
            </Button>
          </div>
        );
      })()}

      {/* Advanced Options Toolbar. `!isProcessed` guards the PANEL as well as its
          toggle button (review §2.1) — see the per-card reset above. */}
      {!isProcessed && showAdvancedOptions && (
        <div style={{ 
          display: 'flex', 
          gap: '8px', 
          flexWrap: 'wrap', 
          alignItems: 'center', 
          justifyContent: 'center',
          backgroundColor: 'var(--rn-clr-background-secondary)',
          padding: '8px',
          borderRadius: '8px',
          border: '1px solid var(--rn-clr-border-primary)'
        }}>
          <Button onClick={async () => { await plugin.widget.openPopup('reschedule', { remId: rem._id }); }}>
            <div style={buttonStyles.label}>🗓️ Reschedule</div>
          </Button>

          <Button onClick={async () => { await plugin.widget.openPopup('priority', { remId: rem._id }); }}>
            <div style={buttonStyles.label}>⚡ Change Priority</div>
          </Button>

          {/* FORK (2026-08-15, review §2.2): inside the row lock. This writes through
              the same updateReviewRemData funnel as Next, and handleNextRepetitionClick's
              deliberate `await sleep(150)` is a wide window in which the whole main row
              is disabled and this button was not — two overlapping runs both read
              pre-write history and append, losing a repetition or recording two for one
              review. The fork's own notes already described the lock as covering "every action
              button". */}
          {/* FORK (2026-10-10): Review with Timer is an option (FORK_FEATURES.editorReviewTimer). */}
          {FORK_FEATURES.editorReviewTimer && (
            <Button
              disabled={isBusy}
              onClick={() =>
                runExclusive(async () => {
                  await handleReviewInEditorRem(plugin, rem, remType);
                })
              }
            >
              <div style={buttonStyles.label}>📝 Review with Timer</div>
            </Button>
          )}

          <Button
            onClick={() => setNoteOpen((o) => !o)}
            style={{ color: noteOpen || noteText ? 'var(--rn-clr-green, #16a34a)' : undefined }}
            title="Review note: attach an observation to this repetition's history entry (saved when you press Next / Reschedule / Dismiss)"
          >
            <div style={buttonStyles.label}>📝 Review Note</div>
          </Button>

          {FORK_FEATURES.pdfReader && activeHighlightId && (
            <Button onClick={async () => {
              const highlightRem = await plugin.rem.findOne(activeHighlightId);
              await highlightRem?.scrollToReaderHighlight();
            }} style={{ color: 'var(--rn-clr-yellow, #d97706)' }}>
              <div style={buttonStyles.label}>✨ Scroll to Highlight</div>
            </Button>
          )}

          {FORK_FEATURES.pdfReader && bookmarkHighlightId && (
            <Button
              onClick={async () => {
                const bookmarkRem = await plugin.rem.findOne(bookmarkHighlightId);
                await bookmarkRem?.scrollToReaderHighlight();
              }}
              style={{
                backgroundColor: 'var(--rn-clr-background-secondary)',
                color: 'var(--rn-clr-blue, #3b82f6)',
                border: '2px solid var(--rn-clr-blue, #3b82f6)',
                fontWeight: 600,
              }}
              title="Scroll to Bookmark: Jump to your last saved reading position in the document"
            >
              <div style={buttonStyles.label}>🔖 Scroll to Bookmark{readerBookmarkIsLatest ? ' • latest' : ''}</div>
            </Button>
          )}

          {FORK_FEATURES.readPoints && remReadPointInfo && (
            <Button
              onClick={async () => {
                const ok = window.confirm(
                  `Open the read point in the Editor?\n\n"${remReadPointInfo.text}"\n\n` +
                  `This records a review for the current Incremental Rem (like "Review in Editor"), ` +
                  `starts its timer, and opens the read point rem in the editor so you can resume reading there.`
                );
                if (!ok) return;
                await handleReviewInEditorRem(plugin, rem, remType, {
                  navigateToRemId: remReadPointInfo.targetRemId,
                });
              }}
              style={{ color: 'var(--rn-clr-green, #16a34a)' }}
              title={`Read point set on a descendant rem: "${remReadPointInfo.text}". Click to open it in the Editor — this reviews the current IncRem (starts its timer) and jumps to the read point.`}
            >
              <div style={buttonStyles.label}>🔖 Read point{remReadPointInfo.isLatest ? ' • latest' : ''}</div>
            </Button>
          )}

          {(remType === 'html' || remType === 'html-highlight') && htmlSourceUrl && (
            <Button onClick={async () => {
              try {
                const newWindow = window.open(htmlSourceUrl, '_blank');
                if (!newWindow || newWindow.closed) {
                  const link = document.createElement('a');
                  link.href = htmlSourceUrl;
                  link.target = '_blank';
                  link.rel = 'noopener noreferrer';
                  document.body.appendChild(link);
                  link.click();
                  setTimeout(() => document.body.removeChild(link), 100);
                }
                await plugin.app.toast('📎 URL opened! Use RemNote Clipper in the browser to take notes.');
              } catch (error) {
                console.error('Error opening URL:', error);
                await plugin.app.toast('Error opening URL');
              }
            }} style={{ color: 'var(--rn-clr-blue, #2563eb)' }}>
              <div style={buttonStyles.label}>📎 Open Web Clipper URL</div>
            </Button>
          )}

          <Button onClick={() => window.open('https://github.com/bjsi/incremental-everything/wiki/Reviewing-Items-in-the-Queue', '_blank')}>
            <div style={buttonStyles.label}>ℹ️ Help</div>
          </Button>
        </div>
      )}

      {/* Review-note input — parked in session storage on every keystroke and
          attached to this repetition's history entry by Next/Reschedule/Dismiss. */}
      {noteOpen && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '13px' }}>📝</span>
          <input
            type="text"
            autoFocus
            value={noteText}
            maxLength={MAX_NOTE_LENGTH}
            placeholder="Observation for this repetition (saved with Next / Reschedule / Dismiss)…"
            onChange={(e) => {
              setNoteText(e.target.value);
              setPendingReviewNote(plugin, rem._id, e.target.value).catch(console.error);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setNoteOpen(false);
              }
              // Keep queue shortcuts from firing while typing.
              e.stopPropagation();
            }}
            style={{
              flex: 1,
              fontSize: '12px',
              padding: '6px 10px',
              borderRadius: '8px',
              border: '1px solid var(--rn-clr-border-primary)',
              backgroundColor: 'var(--rn-clr-background-secondary)',
              color: 'var(--rn-clr-content-primary)',
              outline: 'none',
            }}
          />
        </div>
      )}

      {/* Priority and Shield Info Bar */}
      {showInfoBar && (incRemInfo || (shouldDisplayShield && shieldStatusAsync)) && (
        <div style={infoBarStyle}>
          {/* FORK (Deviation 14): due-IncRem priority distribution, moved here
              from the queue's top counter. */}
          {/* No ringed band when the priority is unreadable — ringing band 5
              would assert a position on the scale that nothing supports. */}
          <QueueDistribution
            highlightPriority={priorityUnreadable ? null : incRemInfo.priority}
          />
          {/* FORK (Deviation 14): the priority pill, its KB/Doc percentiles and
              the ⟳ stale-doc-percentile hint used to sit here. They moved to the
              queue toolbar's P-chip (widgets/queue_priority_chip.tsx), which
              shows "P50 (92.5%)" and explains the source and the percentile on
              hover — one place for priority instead of two. The bar keeps its
              priority-coloured left border. */}
          {/* FORK (2026-08-14, bug-hunt #51): this flex wrapper is display:contents
              now. It used to hold the priority block AND the shield; with the
              priority moved to the toolbar chip it holds only the shield, which
              cannot render in this fork (FORK_FEATURES.shields is false, so
              shieldStatusAsync is hard-null). As a zero-width flex CHILD of a
              gap:16px row it still contributed two gaps where one belonged — a
              visible ~32px hole between the distribution bar and the separator.
              display:contents keeps the subtree for when shields are re-enabled
              while contributing no box of its own. */}
          <div style={{ display: 'contents' }}>
            {/* Shield Display */}
            {/* 🔌 Conditionally show Shield */}
            {!useLightMode && shouldDisplayShield && shieldStatusAsync && (
              <>
                <span style={{ color: 'var(--rn-clr-content-tertiary)' }}>|</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <span style={{
                      display: 'inline-block',
                      animation: isAnyShieldActive ? 'shieldPulse 2s ease-in-out infinite' : 'none'
                    }}>🛡️</span>
                    <span>IncRem Shield:</span>
                  </span>
                  <div style={{ display: 'flex', gap: '12px' }}>
                    {shieldStatusAsync.kb ? (
                      <span style={{
                        animation: isKbShieldActive ? 'shieldTextGlow 2s ease-in-out infinite' : 'none',
                        color: isKbShieldActive ? 'var(--rn-clr-blue)' : 'inherit'
                      }}>
                        KB: <strong style={{ color: percentileToHslColor(shieldStatusAsync.kb.percentile ?? shieldStatusAsync.kb.absolute) }}>{shieldStatusAsync.kb.absolute}</strong> ({shieldStatusAsync.kb.percentile?.toFixed(1)}%)
                      </span>
                    ) : (
                      <span>KB: 100%</span>
                    )}
                    {shieldStatusAsync.doc ? (
                      <span style={{
                        animation: isDocShieldActive ? 'shieldTextGlow 2s ease-in-out infinite' : 'none',
                        color: isDocShieldActive ? 'var(--rn-clr-blue)' : 'inherit'
                      }}>
                        Doc: <strong style={{ color: percentileToHslColor(shieldStatusAsync.doc.percentile ?? shieldStatusAsync.doc.absolute) }}>{shieldStatusAsync.doc.absolute}</strong> ({shieldStatusAsync.doc.percentile?.toFixed(1)}%)
                      </span>
                    ) : (
                      sessionCache?.dueIncRemsInScope && <span>Doc: 100%</span>
                    )}
                  </div>
                </div>
                <style>{`
                  @keyframes shieldPulse {
                    0%, 100% { transform: scale(1); filter: drop-shadow(0 0 0px rgba(59, 130, 246, 0)); }
                    50% { transform: scale(1.15); filter: drop-shadow(0 0 4px rgba(59, 130, 246, 0.6)); }
                  }
                  @keyframes shieldTextGlow {
                    0%, 100% { filter: brightness(1); }
                    50% { filter: brightness(1.3); text-shadow: 0 0 4px rgba(59, 130, 246, 0.3); }
                  }
                `}</style>
              </>
            )}
          </div>

          {/* Separator before Weighted/Reps — hidden when it has wrapped to a new line */}
          <span
            ref={statsSepRef}
            style={{
              color: 'var(--rn-clr-content-tertiary)',
              opacity: statsSepVisible ? 1 : 0,
              pointerEvents: 'none',
            }}
          >|</span>

          {/* Right side: Weighted Shield + Reps — wraps together as a unit */}
          <div ref={statsContainerRef} style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            {/* Weighted Shield Display */}
            {!useLightMode && shouldDisplayWeightedShield && shieldStatusAsync &&
              shieldStatusAsync.weightedKB !== null && shieldStatusAsync.weightedKB !== undefined && (
                <>
                  <WeightedShieldTooltip
                    kbValue={shieldStatusAsync.weightedKB}
                    docValue={shieldStatusAsync.weightedDoc}
                    allItems={allIncRems}
                    isDuePredicate={(r: any) => Date.now() >= r.nextRepDate && (!(shieldStatusAsync.seenRemIds || []).includes(r.remId) || r.remId === coreData?.rem?._id)}
                    docItems={shieldStatusAsync.docIncRems}
                    itemLabel="IncRem"
                  />
                  <span style={{ color: 'var(--rn-clr-content-tertiary)' }}>|</span>
                </>
              )
            }

            {/* Repetition History Stats and Icon */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span>
                <strong>{historyStats.reps}</strong> Reps, <strong>{historyStats.totalMinutes}</strong> min
              </span>
              <span
                role="button"
                style={{
                  cursor: 'pointer',
                  fontSize: '16px',
                  opacity: 0.7,
                  padding: '4px',
                  borderRadius: '6px',
                  transition: 'opacity 0.2s, background-color 0.2s',
                }}
                onClick={() => plugin.widget.openPopup('repetition_history', { remId: rem._id })}
                onMouseEnter={(e) => {
                  e.currentTarget.style.opacity = '1';
                  e.currentTarget.style.backgroundColor = 'var(--rn-clr-background-tertiary)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.opacity = '0.7';
                  e.currentTarget.style.backgroundColor = 'transparent';
                }}
                title="Repetition History"
              >
                📊
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

renderWidget(AnswerButtons);
