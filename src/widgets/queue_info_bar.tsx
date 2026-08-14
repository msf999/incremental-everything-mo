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
// RemNote keeps a FlashcardUnder widget mounted across sibling cards, and
// getWidgetContext().remId stays pinned to the cluster parent while QueueLoadCard
// does not fire per sibling. The visible card therefore has to be POLLED from
// getWidgetContext().cardId — see the poll below. (Listening to QueueLoadCard
// alone, as this file did until 2026-08-14, left every sibling after the first
// showing the anchor card's stats.)
import { useEffect, useRef, useState } from 'react';
import {
  AppEvents,
  renderWidget,
  useAPIEventListener,
  usePlugin,
  useRunAsync,
  useTrackerPlugin,
  WidgetLocation,
  QueueInteractionScore,
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

  // Track the card actually on screen, not the one this widget mounted with.
  //
  // Inside a Card Cluster RemNote keeps this FlashcardUnder widget mounted across
  // every sibling, and NEITHER of the cheap signals advances:
  //   - `ctx` comes from useRunAsync(..., []) — fetched once, never refetched;
  //   - QueueLoadCard does NOT fire per sibling (upstream's card_info_bar records
  //     this from experience, and notes plugin.queue.getCurrentCard() is likewise
  //     stuck on the cluster's anchor card).
  // The only thing that moves per sibling is getWidgetContext().cardId, so it has
  // to be polled. Without the poll every sibling after the first showed the ANCHOR
  // card's reps/time — silently, and with plausible-looking numbers.
  const [cardId, setCardId] = useState<string | undefined>(undefined);
  const lastAppliedCardId = useRef<string | undefined>(undefined);

  const applyCardId = (next: string | undefined) => {
    if (!next || next === lastAppliedCardId.current) return;
    lastAppliedCardId.current = next;
    setCardId(next);
  };

  useEffect(() => {
    applyCardId((ctx as any)?.cardId);
  }, [(ctx as any)?.cardId]);

  useAPIEventListener(AppEvents.QueueLoadCard, undefined, (data: any) => {
    applyCardId(data?.cardId);
  });

  // FORK (2026-08-14, bug-hunt #22): broadcast which cluster sibling is visible.
  //
  // These session signals are consumed by register/events.ts to attribute a
  // rating and a flashcard-history entry to the sibling actually on screen rather
  // than the cluster's anchor card. Their only writer used to be upstream's
  // `card_info_bar`, which the fork gates deny — so the readers were permanently
  // dead and attribution silently fell back to the anchor. This widget already
  // tracks the visible card for its own stats, so it can restore the signal at no
  // extra cost. (Both history writers are still on — see Deviation 13.)
  useEffect(() => {
    if (!cardId) return;
    (async () => {
      try {
        await plugin.storage.setSession('clusterVisibleCardId', cardId);
        await plugin.storage.setSession('clusterVisibleCardLoadTime', Date.now());
        // FORK (2026-08-15, review §2.7): `clusterVisibleRemId` is NOT written here.
        // It has zero readers anywhere in the codebase (the only other writer is the
        // denied card_info_bar), and producing it cost a plugin.card.findOne on every
        // card transition. The two keys above ARE read, by events.ts, to attribute a
        // rating and a history entry to the cluster sibling actually on screen.
      } catch (e) {
        console.error('[QueueInfoBar] failed to broadcast cluster-visible signals', e);
      }
    })();
  }, [plugin, cardId]);

  useEffect(() => {
    let isMounted = true;
    // 500ms matches upstream. Off the hot path by construction: the first tick is
    // at t+500ms, ordinary card changes are already handled by QueueLoadCard
    // above, and lastAppliedCardId short-circuits any tick that re-sees a known
    // id — so outside a cluster this costs one cheap context read per tick and
    // never touches state.
    const poll = async () => {
      try {
        const live: any = await plugin.widget.getWidgetContext().catch(() => null);
        if (!isMounted) return;
        applyCardId(live?.cardId);
      } catch {
        /* context unavailable between cards — next tick retries */
      }
    };
    const intervalId = setInterval(poll, 500);
    return () => {
      isMounted = false;
      clearInterval(intervalId);
    };
  }, [plugin]);

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

  // FORK (§2.5): this hook is hoisted above the `info` tracker so `shouldShow` can
  // gate it. Hook ORDER is what React requires to be stable, and both are
  // unconditional, so moving one earlier is safe.
  const isMobile =
    useTrackerPlugin(async (rp) => !!(await rp.storage.getSession<boolean>(isMobileDeviceKey)), []) ??
    false;

  const shouldShow = shouldShowQueueInfoBar(mode, false, isMobile);

  const info = useTrackerPlugin(
    async (rp) => {
      // FORK (2026-08-15, review §2.5): bail before doing any work when the bar
      // cannot render. The early returns below sit after every hook (they must), so
      // switching the bar off stopped it RENDERING while this tracker kept running —
      // including resolveQueuePriority, an ancestor walk plus a full
      // getIncrementalRemFromRem on the document — for every card. Reachable at the
      // shipped default: shouldShowQueueInfoBar('allExceptMobile', false, true) is
      // false, so on mobile it was pure waste. Bug-hunt #28 fixed the same shape in
      // queue_priority_chip; this widget was missed.
      if (!shouldShow) return null;
      const id = cardId ?? (ctx as any)?.cardId;
      if (!id) return null;
      const card = await rp.card.findOne(id);
      if (!card) return null;
      const rem = card.remId ? await rp.rem.findOne(card.remId) : undefined;

      // Priority: the card's own if it has one, else its own document's, and
      // nothing above that. Read-only — nothing is written to the card and no
      // CardPriority tag is involved.
      const barPriority = rem ? await resolveQueuePriority(rp as any, rem) : null;

      // FORK (2026-08-14, bug-hunt #31): count what the rest of the plugin counts.
      // This used to be raw history.length and a sum over every entry, so the bar
      // reported MORE reps and MORE time than the repetition-history popup for the
      // same card. Upstream's card_info_bar defines the semantics: slice off
      // everything up to the last RESET, then count only gradeable answers.
      const rawHistory = ((card as any).repetitionHistory ?? []) as any[];
      const sorted = [...rawHistory].sort((a, b) => (a?.date ?? 0) - (b?.date ?? 0));
      const lastReset = sorted.map((h) => h?.score).lastIndexOf(QueueInteractionScore.RESET);
      const afterReset = lastReset !== -1 ? sorted.slice(lastReset + 1) : sorted;
      const gradeable = afterReset.filter((h) => {
        const sc = h?.score;
        return (
          sc === QueueInteractionScore.AGAIN ||
          sc === QueueInteractionScore.HARD ||
          sc === QueueInteractionScore.GOOD ||
          sc === QueueInteractionScore.EASY
        );
      });
      const totalSeconds = gradeable.reduce(
        (sum: number, rep: any) => sum + (rep?.responseTime ?? 0) / 1000,
        0
      );
      return {
        barPriority,
        reps: gradeable.length,
        totalMinutes: Math.round((totalSeconds / 60) * 10) / 10,
      };
    },
    [cardId, (ctx as any)?.cardId]
  );


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
  // FORK (#13): an unreadable priority is the placeholder 50, so colouring by it
  // would show a confident mid-band tint for a value nobody knows. Neutral instead.
  const priorityColor =
    pri && !pri.unreadable
      ? percentileToHslColor(percentile ?? pri.priority)
      : QUEUE_PRIORITY_NEUTRAL_COLOR;

  return (
    <div style={{ padding: QUEUE_INFO_BAR_OUTER_PADDING }}>
      <div style={getQueueInfoBarStyle(priorityColor)}>
        {/* The card's band is ringed in the bar — for a card, that is its
            document's priority, the same value the toolbar chip shows. */}
        <QueueDistribution highlightPriority={pri && !pri.unreadable ? pri.priority : null} />
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
