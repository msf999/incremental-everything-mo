import {
  AppEvents,
  QueueItemType,
  ReactRNPlugin,
  RemId,
  SpecialPluginCallback,
} from '@remnote/plugin-sdk';
import dayjs from 'dayjs';
import * as _ from 'remeda';
import {
  allIncrementalRemKey,
  currentScopeRemIdsKey,
  queueCounterId,
  queueLayoutFixId,
  queueHideElementsId,
  seenRemInSessionKey,
  noIncRemTimerKey,
  incremReviewStartTimeKey,
  incrementalQueueActiveKey,
  incRemDisabledDeviceKey,
  currentIncrementalRemTypeKey,
  incremNotesSidebarRemIdKey,
  pluginIframeSelector,
  forkPluginId,
  powerupCode,
} from '../lib/consts';
import { getIncrementalRemFromRem, IncrementalRem } from '../lib/incremental_rem';
import { removeIncrementalRemCache } from '../lib/incremental_rem/cache';
import {
  getCardsPerRem,
  getSortingRandomness,
  getWeightSelectionK,
  applyPriorityWeightedLottery,
} from '../lib/sorting';
import { consumePendingScrollRequest } from '../lib/remHelpers';
import { registerQueueCounter } from '../lib/ui_helpers';
import { getDueIncRemPriorityBuckets } from '../lib/session_helpers';


// Registered once globally — safe because all selectors are highly specific to the
// incremental-everything plugin iframe and do not affect regular flashcard layout.
const QUEUE_LAYOUT_FIX_CSS = `
  .rn-queue:has(${pluginIframeSelector}[src*="widgetName=queue&"]) {
    height: 100% !important;
  }
  .rn-queue:has(${pluginIframeSelector}[src*="widgetName=queue&"]) .rn-queue__content,
  .rn-queue:has(${pluginIframeSelector}[src*="widgetName=queue&"]) .rn-queue__content .rn-flashcard,
  .rn-queue:has(${pluginIframeSelector}[src*="widgetName=queue&"]) .rn-queue__content .rn-flashcard__content,
  .rn-queue:has(${pluginIframeSelector}[src*="widgetName=queue&"]) .box-border:has(${pluginIframeSelector}[src*="widgetName=queue&"]),
  .rn-queue:has(${pluginIframeSelector}[src*="widgetName=queue&"]) div.fade-in-first-load:has(${pluginIframeSelector}[src*="widgetName=queue&"]),
  .rn-queue:has(${pluginIframeSelector}[src*="widgetName=queue&"]) div.fade-in-first-load:has(${pluginIframeSelector}[src*="widgetName=queue&"]) > div,
  .rn-queue:has(${pluginIframeSelector}[src*="widgetName=queue&"]) ${pluginIframeSelector}[src*="widgetName=queue&"] {
    flex-grow: 1 !important;
  }

  /* Ensure card_info_bar (our widget) renders above flashcard-repetition-history.
     The parent flashcard container is already "flex flex-col", so flex order is sufficient.
     Scoped to only activate when our card_info_bar iframe is present, so regular
     flashcards without the plugin widget are not affected. */
  .box-border.flex.flex-col:has(${pluginIframeSelector}[src*="widgetName=card_info_bar&"])
    .fade-in-first-load:has(iframe[data-plugin-id="flashcard-repetition-history"]) {
    order: 1;
  }

  /* Remove the default pt-6 top padding from the bottom action bar when our
     answer_buttons widget is present — the widget provides its own internal spacing. */
  .spaced-repetition__bottom:has(${pluginIframeSelector}[src*="widgetName=answer_buttons&"]) {
    padding-top: 0 !important;
  }
`;

// Registered once globally — safe because the :has(iframe[...widgetName=queue...]) gate
// activates ONLY while the Plugin-type queue iframe is in the DOM:
//   • Race condition: if GetNextCard pre-fetches and returns null, the iframe is already
//     gone and the :has() selector stops matching automatically.
//   • Dual-type rems on flashcard turns: the queue widget uses
//     queueItemTypeFilter: QueueItemType.Plugin, so the iframe is never mounted on
//     plain flashcard turns — the selector never fires.
const QUEUE_HIDE_ELEMENTS_CSS = `
  /* Hide unwanted UI elements during incremental rem review.
     Gated on the Plugin queue iframe presence — self-deactivates the instant
     the iframe leaves the DOM, making timing-based race conditions impossible. */
  .rn-queue:has(${pluginIframeSelector}[src*="widgetName=queue&"]) .rn-flashcard-insights,
  .rn-queue:has(${pluginIframeSelector}[src*="widgetName=queue&"]) [data-cy="bottom-of-card-ai-suggestions"],
  .rn-queue:has(${pluginIframeSelector}[src*="widgetName=queue&"]) div.fade-in-first-load:has(div[data-cy="bottom-of-card-suggestions"]),
  .rn-queue:has(${pluginIframeSelector}[src*="widgetName=queue&"]) div.fade-in-first-load:has(iframe[data-plugin-id="flashcard-repetition-history"]) {
    display: none !important;
  }
`;


let sessionItemCounter = 0;

export const resetSessionItemCounter = () => {
  sessionItemCounter = 0;
};

export function registerCallbacks(plugin: ReactRNPlugin) {
  plugin.app.registerCSS(queueLayoutFixId, QUEUE_LAYOUT_FIX_CSS);
  plugin.app.registerCSS(queueHideElementsId, QUEUE_HIDE_ELEMENTS_CSS);

  plugin.app.registerCallback<SpecialPluginCallback.GetNextCard>(
    SpecialPluginCallback.GetNextCard,
    async (queueInfo) => {
      // FORK (2026-08-14): time the whole callback. RemNote times GetNextCard out,
      // and this races QueueEnter's pre-calculation, so "we answered but nothing
      // rendered" and "we answered too late" look identical from the outside.
      const callStart = Date.now();
      console.log('queueInfo', queueInfo);

      // Helper: clear stale sidebar signals when returning null (flashcard turn).
      // The QueueComponent's useEffect cleanup is unreliable — RemNote can
      // destroy its iframe before React cleanup fires. This main-process
      // helper guarantees the signals are cleared.
      const clearStaleIncRemSignals = () => {
        plugin.storage.setSession(incrementalQueueActiveKey, false);
        plugin.storage.setSession(currentIncrementalRemTypeKey, undefined);
        // Also clear the rem-extract id the notes sidebar keys off. ExtractViewer's
        // unmount cleanup that clears this is unreliable during sandbox teardown,
        // and its sidebar guard (remExtractId === currentIncRemId) can't catch a
        // stale value here because currentIncRemKey is also stale on a flashcard
        // turn — both end up equal to the previous rem, so the sidebar would keep
        // showing it. Clearing here (main process) guarantees the empty state.
        plugin.storage.setSession(incremNotesSidebarRemIdKey, undefined);
      };

      const noIncRemTimerEnd = await plugin.storage.getSynced<number>(noIncRemTimerKey);
      const isDeviceDisabled = await plugin.storage.getLocal<boolean>(incRemDisabledDeviceKey);
      const now = Date.now();

      const isTimerActive = noIncRemTimerEnd && noIncRemTimerEnd > now;

      if (isTimerActive || isDeviceDisabled) {
        if (isTimerActive) {
          const remainingSeconds = Math.ceil((noIncRemTimerEnd - now) / 1000);
          // console.log('⚠️ TIMER IS ACTIVE - BLOCKING INCREM! Time remaining:', remainingSeconds, 'seconds');
        } else {
          // console.log('⚠️ DEVICE IS DISABLED - BLOCKING INCREM!');
        }

        // Timer or Device is blocking IncRem — this turn will be a flashcard.
        plugin.app.registerCSS(queueCounterId, '');
        clearStaleIncRemSignals();
        return null;
      } else if (noIncRemTimerEnd && noIncRemTimerEnd <= now) {
        // console.log('🧹 Timer expired, cleaning up...');
        await plugin.storage.setSynced(noIncRemTimerKey, null);
        // console.log('No Inc Rem timer expired and cleared');
      } else {
        // console.log('✅ No timer active and device enabled - IncRem allowed');
      }

      const allIncrementalRem: IncrementalRem[] =
        (await plugin.storage.getSession(allIncrementalRemKey)) || [];

      let docScopeRemIds = await plugin.storage.getSession<RemId[] | null>(currentScopeRemIdsKey);

      if (queueInfo.subQueueId && docScopeRemIds === null) {
        // QueueEnter is still computing the scope in the background.
        // Do NOT call buildDocumentScope here — it hangs and causes RemNote's
        // getNextCard timeout to expire, blocking all IncRem injection.
        // Instead, temporarily skip scope filtering and inject from the full KB.
        // The QueueEnter handler will set the proper scope for future calls.
        console.log('⚠️ GetNextCard: Scope not ready yet. Using full KB for IncRem injection.');
        docScopeRemIds = null; // explicit: no scope filtering
      }

      const cardsPerRem = await getCardsPerRem(plugin);
      const intervalBetweenIncRem =
        typeof cardsPerRem === 'number' ? cardsPerRem + 1 : cardsPerRem;

      // FORK (2026-08-14, bug-hunt #15): scope positions as a Map, built ONCE.
      // remeda re-runs a projection on every comparison (no memoisation), so an
      // `indexOf` in there was ~2*N*log2(N) linear scans of the scope array —
      // ~10^8 element comparisons for a 5k-rem KB with a 3k-rem scope, every card
      // turn, synchronously. That is exactly the shape that trips GetNextCard's
      // timeout, and this file's own comment records that a timeout there "blocks
      // all IncRem injection".
      const scopeIndexById =
        queueInfo.mode === 'in-order' && docScopeRemIds
          ? new Map(docScopeRemIds.map((id, i) => [id, i]))
          : null;

      const sorted = _.sortBy(
        allIncrementalRem,
        (incRem) => {
          if (scopeIndexById) {
            // ?? Infinity, not -1: an out-of-scope rem sorts LAST rather than
            // ahead of everything. The filter drops them anyway, so this only
            // matters if that ever changes.
            return scopeIndexById.get(incRem.remId) ?? Infinity;
          } else {
            return incRem.priority;
          }
        },
        // Tiebreak: among equal-priority items, show the most overdue first
        // (smallest nextRepDate). In 'in-order' mode the primary key (scope index)
        // is unique per rem, so this secondary key never engages there.
        // NOTE: remeda's sortBy takes projections as separate args — NOT a lodash
        // array of iteratees. Wrapping them in [ ] makes remeda treat it as a
        // [projection, order] pair and throw "comparator is not a function",
        // which kills GetNextCard so no IncRems ever appear in the queue.
        (incRem) => incRem.nextRepDate,
      );

      const seenRemIds = (await plugin.storage.getSession<RemId[]>(seenRemInSessionKey)) || [];
      const filtered = sorted.filter((x) => {
        const isDue = Date.now() >= x.nextRepDate;
        const hasBeenSeen = seenRemIds.includes(x.remId);
        const isInScope = !queueInfo.subQueueId || !docScopeRemIds || docScopeRemIds.includes(x.remId);

        if (!isInScope) {
          return false;
        }

        switch (queueInfo.mode) {
          case 'practice-all':
          case 'in-order':
            return !hasBeenSeen;
          default:
            return isDue && !hasBeenSeen;
        }
      });

      console.log('📊 GetNextCard Summary:', {
        allIncrementalRem: allIncrementalRem.length,
        sorted: sorted.length,
        filtered: filtered.length,
        seenRemIds: seenRemIds.length,
        queueMode: queueInfo.mode,
        subQueueId: queueInfo.subQueueId,
        sessionItemCounter,
        intervalBetweenIncRem,
        scopeSource: docScopeRemIds ? (await plugin.storage.getSession<RemId[] | null>(currentScopeRemIdsKey)) !== null ? 'cached' : 'on-the-fly' : 'none',
      });

      // Always register the queue counter — don't gate it behind scope being cached.
      // During the race window (QueueEnter still running), the counter would never appear
      // because currentScopeRemIdsKey is null.
      // Includes the priority distribution [0-10, 11-30, 31-60, 61-100] of the items
      // counted here, so the top bar reads e.g. `1440 + 1610 (x, y, z, u)`.
      registerQueueCounter(plugin, filtered.length, getDueIncRemPriorityBuckets(filtered));

      const shouldShowIncRem =
        (typeof intervalBetweenIncRem === 'number' &&
          (sessionItemCounter + 1) % intervalBetweenIncRem === 0) ||
        queueInfo.numCardsRemaining === 0 ||
        intervalBetweenIncRem === 'no-cards';

      console.log(
        `🎯 GetNextCard → deciding: willShowIncRem=${shouldShowIncRem} ` +
          `numCardsRemaining=${queueInfo.numCardsRemaining} filtered=${filtered.length} ` +
          `counter=${sessionItemCounter} interval=${intervalBetweenIncRem}`
      );
      console.log('🎯 GetNextCard → deciding NEXT item:', {
        willShowIncRem: shouldShowIncRem,
        sessionItemCounter,
        counterCheck: typeof intervalBetweenIncRem === 'number' ? `(${sessionItemCounter}+1) % ${intervalBetweenIncRem} = ${(sessionItemCounter + 1) % intervalBetweenIncRem}` : intervalBetweenIncRem,
        numCardsRemaining: queueInfo.numCardsRemaining,
        filteredIncRems: filtered.length,
      });

      if (shouldShowIncRem) {
        // console.log('🎯 INCREM CONDITION TRUE:', {
        //   sessionItemCounter,
        //   intervalBetweenIncRem,
        //   calculation: `(${sessionItemCounter} + 1) % ${intervalBetweenIncRem} = ${
        //     (sessionItemCounter + 1) % intervalBetweenIncRem
        //   }`,
        //   numCardsRemaining: queueInfo.numCardsRemaining,
        //   filteredLength: filtered.length,
        //   allIncrementalRemLength: allIncrementalRem.length,
        // });

        if (filtered.length === 0) {
          // console.log('⚠️ FILTERED LENGTH IS 0 - Returning null, will show a flashcard.');
          plugin.app.registerCSS(queueCounterId, '');
          sessionItemCounter++;
          clearStaleIncRemSignals();
          return null;
        }

        // Inject randomness via the priority-weighted lottery — the SAME weighting
        // used by the Priority Review Document — so raising the IncRem randomness
        // slider pulls higher-priority due IncRems toward the front far more often
        // than low-priority ones (instead of the old flat uniform swap).
        // Only applies when `filtered` is in priority order: in 'in-order' mode it is
        // sorted by document position, so we leave it untouched (no randomisation).
        if (queueInfo.mode !== 'in-order') {
          const sortingRandomness = await getSortingRandomness(plugin);
          const weightK = await getWeightSelectionK(plugin);
          applyPriorityWeightedLottery(filtered, sortingRandomness, weightK);
        }

        // console.log('✅ Filtered has items, selecting first IncRem');
        let first = filtered[0];

        // FORK (2026-08-14, bug-hunt #16; narrowed 2026-08-15, review §2.3):
        // rejected entries are dropped from this local array, and purged from the
        // cache ONLY when the rem is genuinely no longer an IncRem — otherwise the
        // same stale rems are re-validated (a findOne + a full
        // getIncrementalRemFromRem each) on every card turn, forever.
        //
        // The narrowing matters: getIncrementalRemFromRem returns null for THREE
        // different reasons, and only "the powerup is gone" means the rem has left
        // the IncRem set. A transient findOne miss or a single malformed history
        // entry used to evict the rem permanently — and loadIncrementalRemCache can
        // never re-run (incRemCacheReloadKey has zero writers, see CLAUDE.md #55),
        // so it vanished from the queue, counter, distribution and tables until
        // RemNote restarted. That is the same shape as the #10 vanishing-rem bug.
        //
        // Purges are also BATCHED to after the loop: removeIncrementalRemCache is a
        // full read-filter-write under the shared lock, so purging inside the loop
        // turned a bulk rejection into hundreds of serialised whole-array rewrites
        // inside the one callback #15 was optimised to keep under RemNote's deadline.
        const remsToPurge: string[] = [];
        while (!(await getIncrementalRemFromRem(plugin, await plugin.rem.findOne(first.remId)))) {
          const staleRem = await plugin.rem.findOne(first.remId);
          if (!staleRem || !(await staleRem.hasPowerup(powerupCode))) {
            remsToPurge.push(first.remId);
          } else {
            // Still a tagged IncRem — the read failed for another reason (most
            // likely an unparseable history entry). Skip it for this turn, but keep
            // it in the cache so a later successful read can recover it.
            console.warn(
              '[GetNextCard] skipping IncRem that failed validation but still has the powerup:',
              first.remId
            );
          }
          filtered.shift();
          if (filtered.length === 0) {
            console.log('❌ All filtered items were invalid after verification - Returning null');
            for (const id of remsToPurge) await removeIncrementalRemCache(plugin, id);
            plugin.app.registerCSS(queueCounterId, '');
            // FORK (#16): advance the counter as the sibling early-return above
            // does. Without it `(sessionItemCounter + 1) % intervalBetweenIncRem`
            // stays true, so the next call re-enters and repeats the whole
            // validation sweep instead of moving on.
            sessionItemCounter++;
            clearStaleIncRemSignals();
            return null;
          }
          first = filtered[0];
        }
        // §2.3: one lock acquisition for the whole batch, on the success path.
        for (const id of remsToPurge) await removeIncrementalRemCache(plugin, id);

        // FORK (2026-08-14, bug-hunt #14): re-read immediately before appending.
        // `seenRemIds` was captured ~10 awaits ago, and QueueEnter's
        // clearSeenItems() can land in that window — writing the stale array back
        // would undo the reset and treat every rem from the PREVIOUS session as
        // already seen, hiding them for the whole new one. The two genuinely
        // interleave: this file's own scope handling exists because GetNextCard
        // runs while QueueEnter is still working.
        const seenNow = (await plugin.storage.getSession<RemId[]>(seenRemInSessionKey)) || [];
        await plugin.storage.setSession(seenRemInSessionKey, [...seenNow, first.remId]);
        await plugin.storage.setSession(incremReviewStartTimeKey, Date.now());

        // Activate hide CSS now that we know we're genuinely showing a Plugin (IncRem) item.
        // (No-op: the CSS is now registered globally and self-gates via :has().)

        // console.log('✅ SHOWING INCREM:', first, 'due', dayjs(first.nextRepDate).fromNow());
        sessionItemCounter++;
        // FORK (2026-08-14): the pluginId MUST be this plugin's own manifest id.
        //
        // Upstream hardcodes its own `'incremental-everything'` here, and this
        // fork's manifest id is deliberately different (Deviation 1 — it has to
        // be, or the fork collides with the official plugin). RemNote routes the
        // returned queue item to a plugin BY THIS ID, so a mismatch means the item
        // is dropped: no Flashcard widget is ever mounted for it.
        //
        // That was invisible for as long as flashcards remained — a dropped plugin
        // item just becomes "show a card instead". It only bites once IncRems are
        // the ONLY thing left, where the dropped item leaves the queue with nothing
        // and RemNote shows "you're done for today".
        //
        // Same class of bug as the 18 hardcoded `data-plugin-id` CSS selectors
        // (see pluginIframeSelector in consts.ts) — upstream stamps its own id
        // throughout. Grep for the literal after every sync.
        // Resolve from the host first; fall back to the fork's own id (consts.ts).
        // NEVER fall back to upstream's literal — that is the broken value.
        const resolvedPluginId = plugin.manifest?.id || plugin.id || forkPluginId;
        // Logged as PRIMITIVES, not an object: console output gets pasted
        // un-expanded, where an object renders only as "Object" and tells us nothing.
        console.log(
          `✅ GetNextCard → returning IncRem remId=${first.remId} ` +
            `pluginId=${resolvedPluginId} (manifest.id=${plugin.manifest?.id} ` +
            `plugin.id=${plugin.id}) elapsedMs=${Date.now() - callStart}`
        );
        return {
          type: QueueItemType.Plugin,
          remId: first.remId,
          pluginId: resolvedPluginId,
        };
      } else {
        const moduloDenominator: number =
          typeof intervalBetweenIncRem === 'number'
            ? intervalBetweenIncRem
            : Number(intervalBetweenIncRem);
        // console.log('🎴 FLASHCARD TURN:', {
        //   sessionItemCounter,
        //   intervalBetweenIncRem,
        //   calculation: `(${sessionItemCounter} + 1) % ${intervalBetweenIncRem} = ${
        //     (sessionItemCounter + 1) % moduloDenominator
        //   }`,
        //   nextIncRemAt:
        //     typeof intervalBetweenIncRem === 'number'
        //       ? intervalBetweenIncRem - ((sessionItemCounter + 1) % intervalBetweenIncRem)
        //       : 'N/A',
        // });
        sessionItemCounter++;
        // Flashcard turn — the hide CSS is globally registered and self-deactivates via :has()
        // when the Plugin iframe is absent; no manual clearing needed.
        clearStaleIncRemSignals();
        return null;
      }
    }
  );

  // Pending-scroll listener. Runs in the main-process context, so the
  // polling and setTimeouts inside `consumePendingScrollRequest` survive
  // the widget iframe death caused by `setRemWindowTree` reorganizing the
  // panes. Triggered widgets stash their request in session storage and
  // call openRemInNewPane; this listener picks it up after the layout
  // settles.
  let scrollInflight = false;
  plugin.event.addListener(AppEvents.CurrentWindowTreeChange, undefined, async () => {
    if (scrollInflight) return;
    scrollInflight = true;
    try {
      await consumePendingScrollRequest(plugin);
    } catch (e) {
      console.error('[pending-scroll listener] consume threw:', e);
    } finally {
      scrollInflight = false;
    }
  });
}
