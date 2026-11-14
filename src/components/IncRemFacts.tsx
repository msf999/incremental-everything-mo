// components/IncRemFacts.tsx
// FORK-ONLY (2026-11-14, owner request).
//
// The facts of ONE Incremental Rem at a glance, for the chip under a document's title
// (widgets/inc_rem_counter.tsx): its priority, its Rotation in words, when it is next due,
// and how often and how long it has been reviewed. Renders nothing for a document that is
// not itself an Incremental Rem.
//
// A Rotation that cannot be read is said so, in red — the scheduler then decides the next
// date, which is rarely what whoever wrote the rotation meant.
import React from 'react';
import dayjs from 'dayjs';
import { useTrackerPlugin, WidgetLocation } from '@remnote/plugin-sdk';
import { allIncrementalRemSlimKey, currentDocumentIdKey, currentIncRemKey, powerupCode } from '../lib/consts';
import { getIncrementalRemFromRem, IncrementalRem } from '../lib/incremental_rem';
import type { SlimIncRem } from '../lib/incremental_rem/cache';
import { repCountsForScheduling } from '../lib/incremental_rem/types';
import { describeRotation, nextRotationDate, parseRotation, ROTATION_HELP } from '../lib/rotation';
import { calculateRelativePercentile } from '../lib/utils';
import { priorityColor, usePriorityColorScale } from './priorityColor';
import { QUEUE_PRIORITY_NEUTRAL_COLOR } from './QueueDistribution';

const DUE_COLOR = '#f97316';
const ERROR_COLOR = 'var(--rn-clr-red, #dc2626)';

/** "Mon 16 Nov", with the year when it is not this one. */
function dayText(ms: number): string {
  const day = dayjs(ms);
  return day.format(day.year() === dayjs().year() ? 'ddd D MMM' : 'ddd D MMM YYYY');
}

/** Whole calendar days from today to `ms`, in words: "today", "tomorrow", "in 12 days", "in 3 months". */
function inDaysText(ms: number): string {
  const days = dayjs(ms).startOf('day').diff(dayjs().startOf('day'), 'day');
  if (days <= 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days < 60) return `in ${days} days`;
  if (days < 730) return `in ${Math.round(days / 30.44)} months`;
  return `in ${Math.round((days / 365.25) * 10) / 10} years`;
}

function Fact(props: { title?: string; color?: string; children: React.ReactNode }) {
  return (
    <span title={props.title} style={{ whiteSpace: 'nowrap', color: props.color }}>
      {props.children}
    </span>
  );
}

const Dot = () => <span style={{ opacity: 0.5 }}>·</span>;

export function IncRemFacts() {
  const colorScale = usePriorityColorScale();
  const facts = useTrackerPlugin(async (rp) => {
    try {
      // Read for the same reason the counter reads it: the widget is told about a new document
      // through this key. And the queue's 🔄 puts another rem into the same view without a
      // navigation — RemNote reuses this frame — so the queue's own "rem on screen" key is read
      // too: when it changes, the document under this chip may have changed with it.
      await rp.storage.getSession(currentDocumentIdKey);
      await rp.storage.getSession(currentIncRemKey);
      const ctx = await rp.widget.getWidgetContext<WidgetLocation.DocumentBelowTitle>();
      if (!ctx?.documentId) return null;
      const rem = await rp.rem.findOne(ctx.documentId);
      if (!rem || !(await rem.hasPowerup(powerupCode))) return null;
      const incRem: IncrementalRem | null = await getIncrementalRemFromRem(rp as any, rem);
      if (!incRem) return null;
      const all = (await rp.storage.getSession<SlimIncRem[]>(allIncrementalRemSlimKey)) || [];
      return { incRem, rank: calculateRelativePercentile(all, incRem.remId) };
    } catch (error) {
      console.error('INC REM FACTS: could not read the document', error);
      return null;
    }
  }, []);

  if (!facts) return null;
  const { incRem, rank } = facts;
  const now = Date.now();

  // --- priority ---------------------------------------------------------------
  const priorityUnreadable = incRem.prioritySource === 'fallback';
  const pillColor = priorityUnreadable
    ? QUEUE_PRIORITY_NEUTRAL_COLOR
    : priorityColor(colorScale, incRem.priority, rank);
  const priorityTitle = priorityUnreadable
    ? 'This Rem’s priority could not be read.'
    : `Priority ${incRem.priority} (0 = most important)` +
      (rank != null ? ` — ${rank}% of the Incremental Rems are at least as important.` : '.');

  // --- rotation ---------------------------------------------------------------
  const rule = parseRotation(incRem.rotation);
  const rotationWords = describeRotation(rule);
  const afterReview = nextRotationDate(rule, now, incRem.nextRepDate);

  // --- next date ----------------------------------------------------------------
  const isDue = now >= incRem.nextRepDate;

  // --- reviews, as the queue's info bar counts them ---------------------------------
  const reps = (incRem.history || []).filter((h) => repCountsForScheduling(h.eventType));
  const minutes = Math.round(reps.reduce((sum, rep) => sum + (rep.reviewTimeSeconds || 0), 0) / 6) / 10;

  return (
    // `display: contents`: each fact is an item of the chip's own row, so a narrow chip wraps
    // fact by fact instead of pushing the whole group onto a second line.
    <span className="text-xs" style={{ display: 'contents', color: 'var(--rn-clr-content-tertiary)' }}>
      <span
        title={priorityTitle}
        style={{
          padding: '1px 7px',
          borderRadius: 10,
          fontSize: 11,
          fontWeight: 600,
          color: 'white',
          backgroundColor: pillColor,
          whiteSpace: 'nowrap',
        }}
      >
        {priorityUnreadable ? 'P?' : `P${incRem.priority}`}
      </span>

      {rule.kind === 'invalid' ? (
        <>
          <Dot />
          <Fact color={ERROR_COLOR} title={`${ROTATION_HELP} Until it is fixed, the normal schedule is used.`}>
            <strong>⚠ Rotation “{rule.text}” not understood</strong>
          </Fact>
        </>
      ) : rotationWords ? (
        <>
          <Dot />
          <Fact
            title={
              `Rotation “${incRem.rotation}” — every review schedules the next one by this rule` +
              (afterReview ? `. Reviewed today, this Rem would come back on ${dayText(afterReview.date)}.` : '.')
            }
          >
            🔁 {rotationWords}
          </Fact>
        </>
      ) : null}

      <Dot />
      {isDue ? (
        <Fact color={DUE_COLOR} title={`Due since ${dayText(incRem.nextRepDate)}`}>
          due now
        </Fact>
      ) : (
        <Fact title="When this Rem is next due in the queue">
          next {dayText(incRem.nextRepDate)} ({inDaysText(incRem.nextRepDate)})
        </Fact>
      )}

      <Dot />
      <Fact title="Reviews recorded for this Rem, and the time spent on them">
        {reps.length} {reps.length === 1 ? 'rep' : 'reps'}
        {minutes > 0 ? `, ${minutes} min` : ''}
      </Fact>
    </span>
  );
}
