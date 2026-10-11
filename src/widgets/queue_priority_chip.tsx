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
import { useEffect, useState } from 'react';
import { renderWidget, usePlugin, useTrackerPlugin } from '@remnote/plugin-sdk';
import {
  queueToolbarPriorityModeId,
  allIncrementalRemKey,
  currentIncRemKey,
  isMobileDeviceKey,
  isWebPlatformKey,
  queueSessionCacheKey,
} from '../lib/consts';
import { getQueuePriorityBadgeStyle, QUEUE_PRIORITY_NEUTRAL_COLOR } from '../components/QueueDistribution';
import { IncrementalRem } from '../lib/incremental_rem';
import { resolveQueuePriority } from '../lib/queue_priority_source';
import { calculateRelativePercentile, percentileToHslColor } from '../lib/utils';
import { useIESetting } from '../lib/settings';
import { keepFocusWithRemNote } from '../lib/keep_focus_with_remnote'; // FORK (2026-10-11)
import { useQueueScreen } from '../lib/queue_screen'; // FORK (2026-10-11)

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

  // FORK (2026-08-14, bug-hunt #28): decide visibility BEFORE the expensive hooks,
  // and gate their bodies. The early return sits after every hook (it must —
  // Rules of Hooks), so switching the chip off used to stop it RENDERING while
  // the 500ms poll kept running and the resolver kept doing its full ancestor
  // walk plus ~12 SDK round trips on every card, all to produce null.
  const shouldShow = shouldShowQueuePriorityChip(mode, isWeb, isMobile);

  // Which queue item is on screen. FORK (2026-10-11): asked of RemNote's screen type, not
  // upstream's session flag, which can stay set on the flashcard after an Incremental Rem
  // (lib/queue_screen.ts). getCurrentCard() answers only on a flashcard screen (the SDK's
  // contract, and what the queue showed in testing), so on a plugin item the chip reads
  // currentIncRemKey.
  const queueScreen = useQueueScreen(shouldShow);
  const currentIncRemId = useTrackerPlugin(
    (rp) => rp.storage.getSession<string>(currentIncRemKey),
    []
  );

  // Toolbar widgets get no per-item context, so the visible card is polled.
  const [polledCardRemId, setPolledCardRemId] = useState<string | undefined>();
  useEffect(() => {
    if (!shouldShow) return; // FORK (#28)
    let isMounted = true;
    // FORK (2026-10-11, review): a slow bridge can answer polls out of order; an older answer
    // never replaces a newer one (as in lib/queue_screen.ts).
    let issued = 0;
    let applied = 0;
    const checkCard = async () => {
      const mine = ++issued;
      try {
        const card = await plugin.queue.getCurrentCard();
        if (!isMounted || mine < applied) return;
        applied = mine;
        setPolledCardRemId(card?.remId);
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
    // shouldShow in the deps so toggling the setting starts/stops the poll
    // without needing a reload.
  }, [plugin, shouldShow]);

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
      if (!shouldShow) return null; // FORK (#28)
      // FORK (2026-10-11, review, reproduced live): no chip when no item is on screen. This chip
      // fell back from either source to the other (upstream's badge falls back from the card to
      // currentIncRemKey), so on RemNote's finished screen (no card, no plugin item) it showed
      // the last Incremental Rem's priority, and clicking it opened that Rem's priority popup.
      const remId =
        queueScreen === 'incRem' ? currentIncRemId : queueScreen === 'card' ? polledCardRemId : undefined;
      if (!remId) return null;

      const rem = await rp.rem.findOne(remId);
      if (!rem) return null;

      const resolved = await resolveQueuePriority(rp as any, rem);
      if (!resolved) return null;

      // Only an item that carries the priority itself may be edited from here.
      const isEditableIncRem = resolved.origin === 'own' && !resolved.fromDismissed;
      return { resolved, editRemId: isEditableIncRem ? rem._id : null };
    },
    [queueScreen, currentIncRemId, polledCardRemId]
  );

  if (!shouldShow) return null;
  if (!data) return null;

  const { resolved, editRemId } = data;
  // A dismissed source is not in the IncRem set, so it has no rank; the chip
  // then shows the bare number and is coloured by the value itself.
  // FORK (#13): an unreadable priority has no meaningful rank — the number is a
  // placeholder, so ranking it would dress a guess up as a measurement.
  const percentile = resolved.sourceRemId && !resolved.unreadable
    ? calculateRelativePercentile(allIncRems, resolved.sourceRemId)
    : null;
  const color = percentileToHslColor(percentile ?? resolved.priority);
  const doc = resolved.sourceRemId ? docPercentile?.[resolved.sourceRemId] ?? null : null;

  // Everything that used to sit in the info bar — where the priority comes from,
  // and what the percentage actually means — now lives here on hover.
  const lines: string[] = resolved.unreadable
    ? [
        'This item’s priority could not be read.',
        'Its Priority slot is unreadable and its history holds no recorded priority, so there is no value to show — the plugin is NOT treating it as 50.',
        'Setting a priority on it will repair the slot.',
      ]
    : [
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
      // FORK (2026-08-14, bug-hunt #32): the derived clause used to read
      // "sits in the least-important {100-p}%", which inverts the meaning — a
      // percentile of 2 means 2nd-most-important of 100, i.e. the MOST-important
      // 2%, not the least-important 98%.
      `${percentile}% KB — this is a RANK, not a share: ${percentile}% of the ` +
        'Incremental Rems in your knowledge base are at least as important as this one ' +
        '(a lower priority number means more important), so it is more important than ' +
        `the other ${Math.round((100 - percentile) * 10) / 10}%. Ranked against ` +
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
      // FORK (2026-10-11): a click leaves keyboard focus with RemNote (lib/keep_focus_with_remnote.ts);
      // the priority popup, opened after, takes focus itself.
      onMouseDown={keepFocusWithRemNote.onMouseDown}
      onClick={async (e) => {
        keepFocusWithRemNote.onClick(e);
        if (editRemId) await plugin.widget.openPopup('priority', { remId: editRemId });
      }}
      title={lines.join('\n')}
    >
      <div
        style={{
          ...getQueuePriorityBadgeStyle(resolved.unreadable ? QUEUE_PRIORITY_NEUTRAL_COLOR : color),
          padding: '3px 10px',
        }}
      >
        <span>{resolved.unreadable ? 'P?' : `P${resolved.priority}`}</span>
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
