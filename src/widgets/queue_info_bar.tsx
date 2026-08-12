// widgets/queue_info_bar.tsx
// FORK-ONLY (Deviation 14). The info bar for NON-IncRem queue items (regular
// flashcards): the due-IncRem priority distribution, the priority this card
// inherits from its nearest Incremental ancestor, and the card's own reps/time.
//
// Why a separate widget: the IncRem bar is drawn by answer_buttons, which is
// registered at FlashcardAnswerButtons with queueItemTypeFilter: Plugin — it
// cannot render for a flashcard. FlashcardUnder mounts for every queue item, so
// this widget covers the rest and bails out while an IncRem is on screen.
//
// The bar's geometry comes from components/QueueDistribution.tsx, shared with
// answer_buttons so both bars are the same size.
//
// Cluster caveat (learned from upstream's card_info_bar): inside a Card Cluster
// RemNote keeps a FlashcardUnder widget mounted across sibling cards and
// getWidgetContext().remId stays pinned to the cluster parent, so the visible
// card is resolved from the context's cardId on each QueueLoadCard instead.
import React, { useEffect, useState } from 'react';
import {
  AppEvents,
  renderWidget,
  useAPIEventListener,
  usePlugin,
  useRunAsync,
  useTrackerPlugin,
  WidgetLocation,
} from '@remnote/plugin-sdk';
import {
  QueueDistribution,
  shouldShowQueueInfoBar,
  getQueueInfoBarStyle,
  QUEUE_INFO_BAR_OUTER_PADDING,
  QUEUE_PRIORITY_NEUTRAL_COLOR,
} from '../components/QueueDistribution';
import {
  queueInfoBarModeId,
  isMobileDeviceKey,
  incrementalQueueActiveKey,
  allIncrementalRemKey,
} from '../lib/consts';
import { useIESetting } from '../lib/settings';
import { IncrementalRem } from '../lib/incremental_rem';
import { resolveQueuePriority } from '../lib/queue_priority_source';
import { calculateRelativePercentile, percentileToHslColor } from '../lib/utils';

function QueueInfoBar() {
  const plugin = usePlugin();
  const mode = useIESetting(queueInfoBarModeId);

  const ctx = useRunAsync(
    async () => plugin.widget.getWidgetContext<WidgetLocation.FlashcardUnder>(),
    []
  );

  // Cluster-aware: track the card actually on screen, not the mounted context.
  const [cardId, setCardId] = useState<string | undefined>(undefined);
  useEffect(() => {
    setCardId((ctx as any)?.cardId);
  }, [(ctx as any)?.cardId]);
  useAPIEventListener(AppEvents.QueueLoadCard, undefined, (data: any) => {
    if (data?.cardId) setCardId(data.cardId);
  });

  // While a plugin (IncRem) item is on screen its own bar is drawn by
  // answer_buttons — bail so the two never stack. This is the same discriminator
  // upstream's card_info_bar uses; note it is about the QUEUE ITEM, not the rem:
  // a flashcard whose rem happens to be an IncRem still gets this bar.
  const isIncrementalQueueActive = useTrackerPlugin(
    (rp) => rp.storage.getSession<boolean>(incrementalQueueActiveKey),
    []
  );

  const allIncRems =
    useTrackerPlugin(
      async (rp) => (await rp.storage.getSession<IncrementalRem[]>(allIncrementalRemKey)) || [],
      []
    ) || [];

  const info = useTrackerPlugin(
    async (rp) => {
      const id = cardId ?? (ctx as any)?.cardId;
      if (!id) return null;
      const card = await rp.card.findOne(id);
      if (!card) return null;
      const rem = card.remId ? await rp.rem.findOne(card.remId) : undefined;

      // Priority: the card's own if it has one, else its own document's, and
      // nothing above that. Read-only — nothing is written to the card and no
      // CardPriority tag is involved.
      const barPriority = rem ? await resolveQueuePriority(rp as any, rem) : null;

      const history = (card as any).repetitionHistory ?? [];
      const totalSeconds = history.reduce(
        (sum: number, rep: any) => sum + (rep?.responseTime ?? 0) / 1000,
        0
      );
      return {
        barPriority,
        reps: history.length,
        totalMinutes: Math.round((totalSeconds / 60) * 10) / 10,
      };
    },
    [cardId, (ctx as any)?.cardId]
  );

  const isMobile =
    useTrackerPlugin(async (rp) => !!(await rp.storage.getSession<boolean>(isMobileDeviceKey)), []) ??
    false;

  if (!info) return null;
  if (isIncrementalQueueActive) return null;
  if (!shouldShowQueueInfoBar(mode, false, isMobile)) return null;

  // Percentile of the source rem among all IncRems, so the chip is coloured
  // exactly as it is on that rem. A dismissed source is no longer in the IncRem
  // set and has no percentile, so its chip is coloured by the priority value
  // itself — the same absolute-colouring fallback used elsewhere.
  const pri = info.barPriority;
  const percentile = pri?.sourceRemId
    ? calculateRelativePercentile(allIncRems, pri.sourceRemId)
    : null;
  const priorityColor = pri
    ? percentileToHslColor(percentile ?? pri.priority)
    : QUEUE_PRIORITY_NEUTRAL_COLOR;

  return (
    <div style={{ padding: QUEUE_INFO_BAR_OUTER_PADDING }}>
      <div style={getQueueInfoBarStyle(priorityColor)}>
        {/* The card's band is ringed in the bar — for a card, that is its
            document's priority, the same value the toolbar chip shows. */}
        <QueueDistribution highlightPriority={pri?.priority ?? null} />
        {/* FORK (Deviation 14): the priority pill, its percentile and the
            own/↖ document badge used to sit here. They moved to the queue
            toolbar's P-chip (widgets/queue_priority_chip.tsx), which shows
            "P50 (92.5%)" and explains the source and the percentile on hover —
            one place for priority instead of two. The resolution is still done
            here, but only to colour the bar's left border. */}
        <span style={{ color: 'var(--rn-clr-content-tertiary)' }}>|</span>
        <span>
          <strong>{info.reps}</strong> Reps, <strong>{info.totalMinutes}</strong> min
        </span>
      </div>
    </div>
  );
}

renderWidget(QueueInfoBar);
