import {
  renderWidget,
  usePlugin,
  useRunAsync,
  useTrackerPlugin,
  WidgetLocation,
} from '@remnote/plugin-sdk';
import { useEffect, useRef, useState } from 'react';
import { Reader } from '../components/Reader';
import { VideoViewer } from '../components/Video';
import { VideoExtractViewer } from '../components/VideoExtractViewer';
import { NativeVideoViewer } from '../components/NativeVideoViewer';
import { ExtractViewer } from '../components/ExtractViewer';
import { IsolatedCardViewer } from '../components/IsolatedCardViewer';
import { remToActionItemType } from '../lib/incremental_rem';
import {
  incrementalQueueActiveKey,
  currentIncrementalRemTypeKey,
  forkPluginId,
  activeHighlightIdKey,
  isolatedQueueModeId,
  powerupCode,
  currentHostDocumentIdKey,
  queueSlotSwapKey, // FORK (Deviation 16)
  QueueSlotSwap,
} from '../lib/consts';
import { setCurrentIncrementalRem } from '../lib/incremental_rem';
import { safeRemTextToString } from '../lib/pdfUtils';
import { startIncRemEngagement, endIncRemEngagement } from '../lib/queue_session';
import { FORK_FEATURES } from '../lib/fork_gates';
import { useIESettingOptional } from '../lib/settings';

type ViewMode = 'isolated' | 'context';

export function QueueComponent() {
  const plugin = usePlugin();
  const [viewMode, setViewMode] = useState<ViewMode | undefined>(undefined);
  const [sourceDocName, setSourceDocName] = useState<string | undefined>();
  const [showSpark, setShowSpark] = useState(false);

  const ctx = useRunAsync(
    async () => plugin.widget.getWidgetContext<WidgetLocation.Flashcard>(),
    []
  );

  // FORK (Deviation 16, 2026-10-10): the 🔄 "another item" swap. RemNote keeps its own
  // rem for this slot (ctx.remId); when a swap names this slot, the widget shows the
  // swapped-in rem instead, and everything below keys on `remId` — the rem on screen.
  // `remId` stays undefined until the swap key has loaded (null = no swap), so a
  // swapped slot revisited with Previous never flashes the set-aside rem first.
  const slotSwap = useTrackerPlugin(
    async (rp) => (await rp.storage.getSession<QueueSlotSwap | null>(queueSlotSwapKey)) ?? null,
    []
  );
  const remId =
    slotSwap === undefined
      ? undefined
      : ctx?.remId && slotSwap?.slotRemId === ctx.remId && slotSwap.showRemId
        ? slotSwap.showRemId
        : ctx?.remId;

  // FORK (2026-08-14, bug-hunt #18): guards the auto-advance effects below so at
  // most one of them can remove a card. Reset per item, since a fresh queue item
  // may legitimately need its own advance.
  const autoAdvancedRef = useRef(false);
  useEffect(() => {
    autoAdvancedRef.current = false;
  }, [remId]);

  // All hooks must run before any early return — keep this block above the
  // `if (!remId) return null` guard further down.
  const remAndType = useTrackerPlugin(
    async (rp) => {
      if (!remId) return undefined;
      const rem = await rp.rem.findOne(remId);
      if (!rem) {
        console.log('[QueueComponent] remAndType: rem not found for', remId);
        return null;
      }
      const result = await remToActionItemType(rp, rem);
      console.log('[QueueComponent] remAndType resolved:', {
        slotRemId: ctx?.remId,
        shownRemId: remId,
        type: result?.type,
        remId: result?.rem?._id,
        hasExtract: !!(result as any)?.extract,
      });
      return result;
    },
    [remId]
  );

  // Optional form on purpose: the effect that turns this into `viewMode` runs
  // once and never revisits (it bails on `viewMode !== undefined`), so seeing the
  // default during the loading frame would lock in the wrong view.
  const isolatedMode = useIESettingOptional(isolatedQueueModeId);
  const isolatedDefaultForHighlight = isolatedMode === 'highlights' || isolatedMode === 'both';
  const isolatedDefaultForRem = isolatedMode === 'rems' || isolatedMode === 'both';

  // Hybrid IncRems (a full-document PDF/HTML reading source AND their own outline
  // content): offer a Reader ↔ Outline toggle when the IncRem also has a read
  // point set on one of its descendants. This lets the user flip to the outline
  // (with read-point emphasis + auto-scroll) without leaving the queue or
  // re-tagging. The `#extractviewer` tag remains the explicit way to default a
  // hybrid to the ExtractViewer instead.
  const incRemRem = useTrackerPlugin(
    async (rp) => (remId ? await rp.rem.findOne(remId) : null),
    [remId]
  );
  // FORK DEVIATION (outline-first queue): upstream offers this toggle only when a
  // read point has been set on a descendant, and defaults to the Reader — so an
  // IncRem with a PDF attached shows the PDF, not the Rem. We want the Rem itself
  // in the queue body for every reading-type item, so the toggle is offered for
  // all pdf/html cards and the outline is the default. The Reader is still one
  // click away via '📄 Read document'. Highlight types are excluded deliberately:
  // they are already handled by IsolatedCardViewer (which shows the highlight
  // text, not the document) and their '← Back to isolated view' button occupies
  // the same top-right slot as this toggle.
  const outlineCapableType = remAndType?.type === 'pdf' || remAndType?.type === 'html';
  // FORK (Deviation 13): with the PDF reader disabled there is nothing to toggle
  // to — the outline is the only body, so the 📄 button disappears entirely.
  const offerOutlineToggle = outlineCapableType && FORK_FEATURES.pdfReader;
  // true = Outline (ExtractViewer, our default), false = Reader. Reset on card change.
  const [outlineView, setOutlineView] = useState(true);
  useEffect(() => { setOutlineView(true); }, [remId]);

  // This hook signals the component's state.
  useEffect(() => {
    plugin.storage.setSession(incrementalQueueActiveKey, true);
    return () => {
      plugin.storage.setSession(incrementalQueueActiveKey, false);
    };
  }, [plugin]);

  // Drive PracticedQueues IncRem count + time from explicit mount/unmount of
  // this widget rather than the QueueLoadCard heuristic. Mount = engagement
  // starts (count++ unless this is a queue→editor handoff). Unmount or remId
  // change = engagement ends (accumulated time is added to the session).
  useEffect(() => {
    if (!remId) return;
    // FORK (Deviation 13): engagement events only feed Practiced Queues /
    // dashboards; with session analytics off nothing drains the event queue,
    // so don't produce them.
    if (!FORK_FEATURES.sessionAnalytics) return;
    startIncRemEngagement(plugin, remId);
    return () => {
      endIncRemEngagement(plugin);
    };
  }, [remId, plugin]);

  useEffect(() => {
    // The identity of the incremental item in the queue is `remId`: RemNote's own rem
    // for this slot (ctx.remId), or the rem a 🔄 swap put in its place (Deviation 16).
    // remAndType tells us WHAT to display, but remId tells us WHO we are.
    const incrementalRemId = remId;
    setCurrentIncrementalRem(plugin, incrementalRemId);

    const resolvedType = remAndType?.type;
    plugin.storage.setSession(currentIncrementalRemTypeKey, resolvedType);

    // For highlights, we still need to identify the specific extract.
    const activeHighlight = (resolvedType === 'pdf-highlight' || resolvedType === 'html-highlight')
      ? (remAndType as any).extract?._id
      : null;
    plugin.storage.setSession(activeHighlightIdKey, activeHighlight);

    // Publish the host document ID (PDF/HTML source Rem) so the notes sidebar
    // can discover related IncRems for highlight types.
    const hostDocId = (resolvedType === 'pdf-highlight' || resolvedType === 'html-highlight'
      || resolvedType === 'pdf' || resolvedType === 'html')
      ? remAndType!.rem._id
      : null;
    plugin.storage.setSession(currentHostDocumentIdKey, hostDocId);

    console.log('[QueueComponent] useEffect publishing session signals:', {
      incrementalRemId,
      resolvedType,
      activeHighlight,
      hostDocId,
      remAndTypeIsNull: remAndType === null,
      remAndTypeIsUndefined: remAndType === undefined,
    });

    if (remAndType === null) {
      // FORK (2026-08-14, bug-hunt #18): at most ONE auto-advance per widget
      // instance. This effect and the powerup one below both derive from the same
      // `rp.rem.findOne(remId)`: when the current item's Rem is deleted mid-
      // session, `remAndType` resolves null AND `hasIncrementalPowerup` resolves
      // false, in the same render — so both fired and the queue skipped the
      // deleted item AND the next card, unreviewed. The render-level bail comes
      // too late; the effects have already run.
      if (autoAdvancedRef.current) return;
      autoAdvancedRef.current = true;
      plugin.queue.removeCurrentCardFromQueue(false);
    }

    return () => {
      console.log('[QueueComponent] useEffect CLEANUP - clearing hostDocId + remType');
      plugin.storage.setSession(currentHostDocumentIdKey, null);
      plugin.storage.setSession(currentIncrementalRemTypeKey, undefined);
    };
  }, [remId, remAndType, plugin]);

  const shouldRenderEditorForRemType = useRunAsync(async () => {
    if (remAndType?.type !== 'rem') {
      return false;
    }
    // FORK (2026-08-14): filter by OUR manifest id, not upstream's.
    //
    // The intent is "is any OTHER plugin claiming this Flashcard slot?" — so the
    // filter has to drop THIS plugin's own widget. Upstream hardcodes
    // 'incremental-everything'; this fork's id is 'incremental-everything-mo'
    // (Deviation 1), so the filter matched nothing, our own widget counted as a
    // foreign one, and the check below could conclude the slot was taken —
    // making line ~293 render NOTHING for a plain rem-type IncRem.
    //
    // Second instance of the hardcoded-upstream-id bug found alongside the
    // GetNextCard `pluginId` (see register/callbacks.ts).
    // The `|| forkPluginId` fallback matters as much as the id itself: both SDK
    // properties are typed `| undefined`, and if both were empty here the filter
    // would keep EVERY widget, `widgetsAtLocation.length === 0` would be false, and
    // the render bail below would blank the queue body for every rem-type IncRem —
    // a strictly worse failure than the upstream-id bug this line fixes.
    // register/callbacks.ts already defends this way; keep the two in step.
    const ownPluginId = plugin.manifest?.id || plugin.id || forkPluginId;
    // FORK (2026-08-15, review): fail OPEN, not closed.
    //
    // A rejected getWidgetsAtLocation used to propagate out of this tracker, leaving
    // shouldRenderEditorForRemType undefined forever — and the render bail below
    // treats anything falsy as "another plugin owns this slot", so the queue body
    // went permanently blank for every rem-type IncRem, with no error and no retry.
    // Rendering our own body when the probe fails is the safe direction: the worst
    // case is two widgets in one slot, versus showing the user nothing at all.
    let widgetsAtLocation;
    try {
      widgetsAtLocation = await plugin.widget.getWidgetsAtLocation(
        WidgetLocation.Flashcard,
        remAndType.rem._id
      );
    } catch (err) {
      console.warn('[queue] getWidgetsAtLocation failed — rendering our own body', err);
      return true;
    }
    return (widgetsAtLocation || []).filter((w) => w.pluginId !== ownPluginId).length === 0;
  }, [remAndType?.type, remAndType?.rem?._id, plugin]);

  // FORK (2026-08-14, bug-hunt #54): the effect that used to live here wrote
  // `shouldHideIncEverythingKey` on every card and cleared it on unmount. Nothing
  // in the codebase ever read that key (verified: 2 writes, 0 reads), so it was
  // pure per-card session-storage churn. The `shouldRenderEditorForRemType`
  // tracker above is NOT dead and stays — the render bail further down depends on
  // it.

  // Track if this Rem still has the incremental powerup.
  // When a user presses "Dismiss", the powerup is removed and we should proactively advance.
  const hasIncrementalPowerup = useTrackerPlugin(async (rp) => {
    if (!remId) return true; // Default true while loading to prevent premature skips
    const rem = await rp.rem.findOne(remId);
    if (!rem) return false;
    return await rem.hasPowerup(powerupCode);
  }, [remId]);

  // If the powerup goes missing while we're mounted, immediately advance the queue.
  useEffect(() => {
    if (hasIncrementalPowerup === false) {
      // FORK (#18): shares the one-advance guard with the effect above.
      if (autoAdvancedRef.current) return;
      autoAdvancedRef.current = true;
      plugin.queue.removeCurrentCardFromQueue(true);
    }
  }, [hasIncrementalPowerup, plugin]);

  // FORK (2026-08-14): items that are no longer due are SHOWN, not skipped.
  //
  // This used to be a due-on-encounter effect calling removeCurrentCardFromQueue()
  // whenever an item's freshly-read nextRepDate had moved into the future — a stale
  // queue entry (reviewed on another device mid-session) or an item revisited with
  // Previous. It needed a one-shot `queueBackNavKey` session flag so that going back
  // did not instantly skip the item you had just returned to.
  //
  // Silently advancing hides information: you cannot tell a stale entry from an item
  // that was never in the queue. The answer buttons now detect the same condition
  // (Date.now() < incRemInfo.nextRepDate) and render an 'already processed' state —
  // the item stays visible, showing when it is next due, with Continue / Review anyway.
  // Nothing auto-advances any more, so the back-nav flag is gone with it.

  // Reset view mode when switching to a new rem.
  // The default view mode is computed once `remAndType` and the user setting
  // have resolved, in the effect below — so we clear it here.
  useEffect(() => {
    setViewMode(undefined);
    setSourceDocName(undefined);
  }, [remId]);

  // Load source document name for highlights
  useEffect(() => {
    const loadSourceDocName = async () => {
      if (remAndType?.type === 'pdf-highlight' || remAndType?.type === 'html-highlight') {
        const docRem = remAndType.rem;
        if (docRem?.text) {
          const name = await safeRemTextToString(plugin, docRem.text);
          setSourceDocName(name.slice(0, 50) + (name.length > 50 ? '...' : ''));
        }
      }
    };
    loadSourceDocName();
  }, [remAndType, plugin]);

  // The isolated card view is supported for highlights AND regular rems.
  // The user setting controls the DEFAULT view; the user can always toggle.
  const isHighlightType = remAndType?.type === 'pdf-highlight' || remAndType?.type === 'html-highlight';
  const isRemType = remAndType?.type === 'rem';
  const supportsIsolated = isHighlightType || isRemType;

  // Initialize viewMode once we know the item type and the setting has loaded.
  useEffect(() => {
    if (viewMode !== undefined) return;
    if (!remAndType || isolatedMode === undefined) return;
    if (!supportsIsolated) {
      setViewMode('context');
      return;
    }
    const defaultIsolated = isHighlightType
      ? isolatedDefaultForHighlight
      : isolatedDefaultForRem;
    setViewMode(defaultIsolated ? 'isolated' : 'context');
  }, [viewMode, remAndType, isolatedMode, supportsIsolated, isHighlightType, isolatedDefaultForHighlight, isolatedDefaultForRem]);

  const shouldShowIsolated = viewMode === 'isolated' && supportsIsolated;

  // Trigger a single spark when entering context view for items that support isolated view
  useEffect(() => {
    if (viewMode === 'context' && supportsIsolated) {
      setShowSpark(true);
      const timer = setTimeout(() => setShowSpark(false), 1800);
      return () => clearTimeout(timer);
    }
    setShowSpark(false);
  }, [viewMode, supportsIsolated]);

  // AFTER ALL HOOKS, NOW you can return early
  if (!remId) return null;

  // If the powerup is gone, this widget should NOT be rendering anything that covers the flashcard.
  if (hasIncrementalPowerup === false) return null;

  if (remAndType?.type === 'rem' && !shouldRenderEditorForRemType) return null;

  // Get the rem to display in isolated view (highlights and rems)
  const getIsolatedRem = () => {
    if (!remAndType) return null;
    if (isHighlightType) {
      return (remAndType as any).extract;
    }
    if (isRemType) {
      return remAndType.rem;
    }
    return null;
  };

  const isolatedRem = getIsolatedRem();

  return (
    <div className="incremental-everything-element" style={{ height: '100%' }}>
      <div className="box-border p-2" style={{ height: `100vh`, position: 'relative' }}>
        {viewMode === 'context' && supportsIsolated && (
          <div style={{ position: 'absolute', top: 12, right: 12, zIndex: 10 }}>
            <style>{`
              .inc-back-btn {
                --inc-spark-strong: rgba(96, 165, 250, 0.50);
                --inc-spark-faint: rgba(96, 165, 250, 0);
              }
              @media (prefers-color-scheme: dark) {
                .inc-back-btn {
                  --inc-spark-strong: rgba(110, 231, 183, 0.70);
                  --inc-spark-faint: rgba(110, 231, 183, 0);
                  color: var(--rn-clr-content-primary, #e2e8f0);
                  border-color: var(--rn-clr-border-primary, #334155);
                  background-color: var(--rn-clr-background-secondary, #0f172a);
                }
              }
              @keyframes incSpark {
                0% { box-shadow: 0 0 0 0 var(--inc-spark-strong, rgba(96,165,250,0.45)); }
                70% { box-shadow: 0 0 0 14px var(--inc-spark-faint, rgba(96,165,250,0)); }
                100% { box-shadow: 0 0 0 0 var(--inc-spark-faint, rgba(96,165,250,0)); }
              }
            `}</style>
            <button
              className="inc-back-btn"
              onClick={() => setViewMode('isolated')}
              style={{
                padding: '6px 10px',
                borderRadius: 6,
                border: `1px solid var(--rn-clr-border-primary, #e2e8f0)`,
                backgroundColor: 'var(--rn-clr-background-primary, #ffffff)',
                color: 'var(--rn-clr-content-secondary, #475569)',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 600,
                boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
                animation: showSpark ? 'incSpark 1.5s ease-out 1' : 'none'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--rn-clr-background-tertiary, #f1f5f9)';
                e.currentTarget.style.borderColor = 'var(--rn-clr-border-secondary, #cbd5e1)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--rn-clr-background-primary, #ffffff)';
                e.currentTarget.style.borderColor = 'var(--rn-clr-border-primary, #e2e8f0)';
              }}
            >
              ← Back to isolated view
            </button>
          </div>
        )}
        {offerOutlineToggle && (
          <div style={{ position: 'absolute', top: 12, right: 12, zIndex: 10 }}>
            <button
              onClick={() => setOutlineView((v) => !v)}
              style={{
                padding: '6px 10px',
                borderRadius: 6,
                border: `1px solid var(--rn-clr-border-primary, #e2e8f0)`,
                backgroundColor: 'var(--rn-clr-background-primary, #ffffff)',
                color: 'var(--rn-clr-content-secondary, #475569)',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 600,
                boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--rn-clr-background-tertiary, #f1f5f9)';
                e.currentTarget.style.borderColor = 'var(--rn-clr-border-secondary, #cbd5e1)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--rn-clr-background-primary, #ffffff)';
                e.currentTarget.style.borderColor = 'var(--rn-clr-border-primary, #e2e8f0)';
              }}
              title={outlineView
                ? 'Switch back to the PDF/HTML reader'
                : 'Switch to the outline view to see your notes and the read point (without leaving the queue)'}
            >
              {outlineView ? '📄 Read document' : '📑 View outline'}
            </button>
          </div>
        )}
        {!remAndType ? null : shouldShowIsolated && isolatedRem ? (
          <IsolatedCardViewer
            rem={isolatedRem}
            plugin={plugin}
            sourceDocumentName={isHighlightType ? sourceDocName : undefined}
            sourceDocumentId={isHighlightType ? remAndType.rem._id : undefined}
            sourceType={remAndType.type}
            onViewInContext={supportsIsolated ? () => setViewMode('context') : undefined}
          />
        ) : remAndType.type === 'pdf' ||
          remAndType.type === 'html' ||
          remAndType.type === 'pdf-highlight' ||
          remAndType.type === 'html-highlight' ? (
          // Hybrid toggle: flip a PDF/HTML reading card to its outline (read-only
          // ExtractViewer on the IncRem) when the user has chosen the outline view.
          !FORK_FEATURES.pdfReader ? (
            // FORK (Deviation 13): reader disabled — the rem outline is the
            // terminal branch for ALL reading types, including highlight types
            // that fell through the isolated view. Null until the IncRem
            // resolves (avoids a one-frame flash).
            incRemRem ? <ExtractViewer rem={incRemRem} plugin={plugin} /> : null
          ) : offerOutlineToggle && outlineView ? (
            // Render nothing until the IncRem resolves rather than falling through
            // to the Reader — otherwise the PDF flashes for a frame on every card.
            incRemRem ? <ExtractViewer rem={incRemRem} plugin={plugin} /> : null
          ) : (
            <Reader actionItem={remAndType} queueIncRemId={remId} />
          )
        ) : remAndType.type === 'youtube' ? (
          <VideoViewer actionItem={remAndType} />
        ) : remAndType.type === 'youtube-highlight' ? (
          <VideoExtractViewer actionItem={remAndType} />
        ) : remAndType.type === 'video' ? (
          <NativeVideoViewer actionItem={remAndType} />
        ) : remAndType.type === 'rem' ? (
          <ExtractViewer rem={remAndType.rem} plugin={plugin} />
        ) : null}
      </div>
    </div>
  );
}

renderWidget(QueueComponent);
