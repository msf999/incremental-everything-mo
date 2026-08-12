// widgets/queue_priority_chip.tsx
// FORK-ONLY (Deviation 14). The coloured "P50" chip in the queue's top bar.
//
// This replaces upstream's `queue_toolbar_priority`, which stays denied by the
// fork gates. Two reasons for a fork widget rather than an edit to upstream's:
//   - its flashcard branch resolves priority through getCardPriority, i.e. the
//     card-priority engine this fork disables, and an unbounded walk up to the
//     closest ancestor with any priority — which would disagree with the info
//     bar under the very same item;
//   - it is gated by a boolean setting, and this fork wants four modes.
// Keeping upstream's file untouched also keeps it out of the merge surface.
//
// What it shows comes from lib/queue_priority_source.ts, shared with
// queue_info_bar, so the chip and the bar can never disagree.
//
// Clicking opens the priority popup — but only for Incremental Rems, matching
// the queue's own "⚡ Change Priority" button. A flashcard's chip is inert: the
// priority it displays belongs to the item's document, not to the card, so
// offering to edit it here would silently retarget the click.
import React, { useEffect, useState } from 'react';
import { renderWidget, usePlugin, useTrackerPlugin } from '@remnote/plugin-sdk';
import {
  queueToolbarPriorityModeId,
  allIncrementalRemKey,
  currentIncRemKey,
  incrementalQueueActiveKey,
  isMobileDeviceKey,
  isWebPlatformKey,
  queueSessionCacheKey,
} from '../lib/consts';
import { getQueuePriorityBadgeStyle } from '../components/QueueDistribution';
import { IncrementalRem } from '../lib/incremental_rem';
import { resolveQueuePriority } from '../lib/queue_priority_source';
import { calculateRelativePercentile, percentileToHslColor } from '../lib/utils';
import { useIESetting } from '../lib/settings';

/** Whether the chip shows, given the setting and the platform. */
export function shouldShowQueuePriorityChip(
  mode: 'always' | 'off' | 'webOnly' | 'mobileOnly' | undefined,
  isWeb: boolean,
  isMobile: boolean
): boolean {
  switch (mode) {
    case 'off':
      return false;
    case 'webOnly':
      return isWeb;
    case 'mobileOnly':
      return isMobile;
    case 'always':
      return true;
    default:
      return true; // loading frame — fall back to the default ('always')
  }
}

function QueuePriorityChip() {
  const plugin = usePlugin();
  const mode = useIESetting(queueToolbarPriorityModeId);

  const isWeb =
    useTrackerPlugin(async (rp) => !!(await rp.storage.getSession<boolean>(isWebPlatformKey)), []) ??
    false;
  const isMobile =
    useTrackerPlugin(async (rp) => !!(await rp.storage.getSession<boolean>(isMobileDeviceKey)), []) ??
    false;

  // Which queue item is on screen. `incrementalQueueActiveKey` is the reliable
  // discriminator: while a plugin item shows, plugin.queue.getCurrentCard() can
  // still be reporting the previous flashcard.
  const isIncrementalQueueActive = useTrackerPlugin(
    (rp) => rp.storage.getSession<boolean>(incrementalQueueActiveKey),
    []
  );
  const currentIncRemId = useTrackerPlugin(
    (rp) => rp.storage.getSession<string>(currentIncRemKey),
    []
  );

  // Toolbar widgets get no per-item context, so the visible card is polled.
  const [polledCardRemId, setPolledCardRemId] = useState<string | undefined>();
  useEffect(() => {
    let isMounted = true;
    const checkCard = async () => {
      try {
        const card = await plugin.queue.getCurrentCard();
        if (isMounted) setPolledCardRemId(card?.remId);
      } catch {
        /* ignore */
      }
    };
    checkCard();
    const intervalId = setInterval(checkCard, 500);
    return () => {
      isMounted = false;
      clearInterval(intervalId);
    };
  }, [plugin]);

  const allIncRems =
    useTrackerPlugin((rp) => rp.storage.getSession<IncrementalRem[]>(allIncrementalRemKey), []) || [];

  // Doc percentile, when the queue was started from a scope. Computed at
  // QueueEnter into the session cache; absent until then, hence the guard.
  const docPercentile = useTrackerPlugin(
    async (rp) => {
      const cache = await rp.storage.getSession<any>(queueSessionCacheKey);
      return cache?.incRemDocPercentiles ?? null;
    },
    []
  );

  const data = useTrackerPlugin(
    async (rp) => {
      const remId = isIncrementalQueueActive
        ? currentIncRemId ?? polledCardRemId
        : polledCardRemId ?? currentIncRemId;
      if (!remId) return null;

      const rem = await rp.rem.findOne(remId);
      if (!rem) return null;

      const resolved = await resolveQueuePriority(rp as any, rem);
      if (!resolved) return null;

      // Only an item that carries the priority itself may be edited from here.
      const isEditableIncRem = resolved.origin === 'own' && !resolved.fromDismissed;
      return { resolved, editRemId: isEditableIncRem ? rem._id : null };
    },
    [isIncrementalQueueActive, currentIncRemId, polledCardRemId]
  );

  if (!shouldShowQueuePriorityChip(mode, isWeb, isMobile)) return null;
  if (!data) return null;

  const { resolved, editRemId } = data;
  // A dismissed source is not in the IncRem set, so it has no rank; the chip
  // then shows the bare number and is coloured by the value itself.
  const percentile = resolved.sourceRemId
    ? calculateRelativePercentile(allIncRems, resolved.sourceRemId)
    : null;
  const color = percentileToHslColor(percentile ?? resolved.priority);
  const doc = resolved.sourceRemId ? docPercentile?.[resolved.sourceRemId] ?? null : null;

  // Everything that used to sit in the info bar — where the priority comes from,
  // and what the percentage actually means — now lives here on hover.
  const lines: string[] = [
    resolved.origin === 'own'
      ? `Priority ${resolved.priority} — this item's own.`
      : `Priority ${resolved.priority} — from its document "${resolved.sourceName}".`,
  ];
  if (resolved.origin === 'document') {
    lines.push(
      'This item has no priority of its own. Only its own document counts — a ' +
        'document further up the hierarchy is never used.'
    );
  }
  if (resolved.fromDismissed) {
    lines.push(
      'That rem is no longer an Incremental Rem; this is the last priority its ' +
        'preserved review history recorded.'
    );
  }
  if (percentile !== null) {
    lines.push(
      '',
      `${percentile}% KB — this is a RANK, not a share: ${percentile}% of the ` +
        'Incremental Rems in your knowledge base are at least as important as this one ' +
        '(a lower priority number means more important), so it sits in the ' +
        `least-important ${Math.round((100 - percentile) * 10) / 10}%. Ranked against ` +
        'every Incremental Rem, not only the ones due today.'
    );
    if (doc !== null && doc !== undefined) {
      lines.push(`${doc}% Doc — the same rank within this queue session's scope.`);
    }
  }
  if (editRemId) lines.push('', 'Click to change the priority.');

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '0 6px',
        cursor: editRemId ? 'pointer' : 'default',
      }}
      onClick={
        editRemId
          ? async () => {
              await plugin.widget.openPopup('priority', { remId: editRemId });
            }
          : undefined
      }
      title={lines.join('\n')}
    >
      <div style={{ ...getQueuePriorityBadgeStyle(color), padding: '3px 10px' }}>
        <span>P{resolved.priority}</span>
      </div>
      {percentile !== null && (
        <span
          style={{
            fontSize: '11px',
            color: 'var(--rn-clr-content-tertiary)',
            fontVariantNumeric: 'tabular-nums',
            whiteSpace: 'nowrap',
          }}
        >
          ({percentile}%)
        </span>
      )}
    </div>
  );
}

renderWidget(QueuePriorityChip);
