// components/ExtractViewer.tsx
// UPDATED: Added filtering for powerup slots (Incremental and CardPriority)

import React, { useState, useEffect, useCallback } from 'react';
import { useRef } from 'react'; // MOBILE-EXPERIMENT (M3/M4 only)
import { PluginRem, RNPlugin, DocumentViewer, RichText, BuiltInPowerupCodes, RemId, RichTextElementRemInterface, useTrackerPlugin } from '@remnote/plugin-sdk';
import { powerupCode, allCardPriorityInfoKey, incremNotesSidebarRemIdKey, incremNotesSidebarWidgetId } from '../lib/consts';
import { safeRemTextToString } from '../lib/pdfUtils';
import {
  getChildrenExcludingSlots,
  getDescendantsExcludingSlots
} from '../lib/powerupSlotFilter';
import { CardPriorityInfo } from '../lib/card_priority';
import { MOBILE_DOCVIEW_CLASS, mobileExperiment, tagMobileDocumentOverlay } from '../lib/mobile_experiments'; // MOBILE-EXPERIMENT
import { MobileTextOutline } from './MobileTextOutline'; // MOBILE-EXPERIMENT M4

// MOBILE-EXPERIMENT (lib/mobile_experiments.ts): all false outside RemNote's phone and
// tablet apps, so on desktop every branch below that reads them renders as before.
const M1_INLINE_LAYOUT = mobileExperiment('inlineLayout');
const M2_SKIP_STATISTICS = mobileExperiment('skipStatistics');
const M3_DELAY_DOCUMENT = mobileExperiment('delayDocument');
const M4_BUTTONS = mobileExperiment('redrawAndTextButtons');
const M5_FACTS = mobileExperiment('diagnostics');
// M3/M4 mount and unmount RemNote's overlay themselves; DOC_LIFECYCLE routes every such
// change through `shownDoc` (see below). With both off, the viewer renders as on desktop.
const DOC_LIFECYCLE = M3_DELAY_DOCUMENT || M4_BUTTONS;
// The SDK only sends an unmount for an overlay once RemNote has answered its create
// call; unmount it sooner and RemNote's overlay stays with no owner. A mounted overlay is
// therefore kept for at least this long before anything replaces or removes it.
const MIN_OVERLAY_LIFETIME_MS = 1000;
// M5/M6: RemNote copies this onto its overlay element (see MOBILE_DOCVIEW_CLASS).
const OVERLAY_CLASS_PROPS = tagMobileDocumentOverlay() ? { className: MOBILE_DOCVIEW_CLASS } : {};

// MOBILE-EXPERIMENT M1: the inline equivalents of the Tailwind classes on the same
// elements, for a frame RemNote's stylesheet never reaches. The section's overflow and
// min-height matter most: without them its grid row grows with the overlay RemNote sizes
// from it, and the breadcrumb row is 0 px tall while it loads, so the overlay is placed
// at the very top of the frame.
const M1_STYLES: Record<string, React.CSSProperties> = {
  root: { gridTemplateColumns: 'minmax(0, 1fr)' },
  crumbRow: {
    height: 40,
    display: 'flex',
    alignItems: 'center',
    overflowX: 'auto',
    overflowY: 'hidden',
    padding: '0 16px',
    boxSizing: 'border-box',
    flexShrink: 0,
    borderBottom: '1px solid rgba(127, 127, 127, 0.25)',
  },
  crumbList: { display: 'flex', flexWrap: 'nowrap', alignItems: 'center', width: '100%', minWidth: 0, fontSize: 14, lineHeight: '20px' },
  crumb: { display: 'flex', alignItems: 'center', flexShrink: 0 },
  crumbText: {
    display: 'inline-block',
    maxWidth: 150,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    cursor: 'pointer',
  },
  crumbSeparator: { margin: '0 4px' },
  section: { overflow: 'hidden', minHeight: 0, minWidth: 0, position: 'relative' },
  footer: { padding: '12px 16px', flexShrink: 0, borderTop: '1px solid rgba(127, 127, 127, 0.25)', fontSize: 12, lineHeight: '16px' },
  footerRow: { display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' },
};

// MOBILE-EXPERIMENT M4: the ↻ / ≡ buttons; `pressed` is the ≡ text view being open.
// Unpressed text colour comes from M4_COLOUR_CSS (class ie-m4-fg), not from an inline style.
const m4ButtonStyle = (pressed: boolean): React.CSSProperties => ({
  flexShrink: 0,
  minHeight: 30,
  padding: '4px 10px',
  fontSize: 12,
  fontWeight: 600,
  lineHeight: '18px',
  borderRadius: 6,
  border: `1px solid ${pressed ? '#3b82f6' : 'rgba(127, 127, 127, 0.5)'}`,
  backgroundColor: pressed ? '#3b82f6' : 'transparent',
  ...(pressed ? { color: '#ffffff' } : {}),
  cursor: 'pointer',
  whiteSpace: 'nowrap',
});
// MOBILE-EXPERIMENT M4: readable text in both themes in a frame without RemNote's CSS —
// the SDK puts `dark` or `light` on this frame's body.
const M4_COLOUR_CSS =
  '.ie-m4-fg{color:#111827}body.dark .ie-m4-fg{color:#e5e7eb}' +
  '.ie-m4-dim{color:#64748b}body.dark .ie-m4-dim{color:#94a3b8}';

interface ExtractViewerProps {
  rem: PluginRem;
  plugin: RNPlugin;
}

// Define the critical context structure
interface CriticalContext {
  hasDocumentPowerup: boolean;
  ancestors: Array<{ text: string; fullText: string; id: RemId }>;
}

// Define the metadata structure (already deferred)
interface Metadata {
  childrenCount: number;
  incrementalChildrenCount: number;
  descendantsCount: number;
  incrementalDescendantsCount: number;
  flashcardCount: number;
}

const BATCH_SIZE = 50;
const BATCH_DELAY_MS = 10;

export function ExtractViewer({ rem, plugin }: ExtractViewerProps) {
  // FORK (2026-08-14, bug-hunt #48): NO early return here.
  //
  // This used to be `if (!rem) return null;` — placed above every hook in the
  // component. Rendering once with a falsy `rem` and once with a truthy one would
  // change the hook count and throw "Rendered fewer hooks than expected". It is
  // unreachable today because all three call sites guard externally
  // (`incRemRem ? <ExtractViewer/> : null`, and remAndType.rem is always defined),
  // so the contract lives entirely in the callers — which is exactly what makes it
  // a landmine for the next one. The prop type is non-optional; trust it.

  // --- STATE 1: DEFERRED METADATA (Statistics) ---
  const [metadata, setMetadata] = useState<Metadata | null>(null);

  // --- STATE 2: DEFERRED CRITICAL CONTEXT (Breadcrumbs & Status) ---
  const [criticalContext, setCriticalContext] = useState<CriticalContext | null>(null);
  const [hoveredAncestorId, setHoveredAncestorId] = useState<string | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ top: 0, left: 0 });

  // FORK (Deviation 11): true while THIS rem is open in the notes sidebar (the
  // ✎ Notes button sets incremNotesSidebarRemIdKey to this rem, so the key doubles
  // as the flag — no extra state). While set, the in-queue DocumentViewer is
  // unmounted: both it and the sidebar's editor are host-window overlays, and two
  // editable overlays of the same rem fight for focus and clicks. Per-rem by
  // construction: advancing to the next card shows its document normally, and
  // upstream's clearStaleIncRemSignals also clears the key on queue transitions.
  const notesOpenForThisRem =
    useTrackerPlugin(
      async (rp) => (await rp.storage.getSession<string>(incremNotesSidebarRemIdKey)) === rem._id,
      [rem._id]
    ) ?? false;

  // MOBILE-EXPERIMENT M3/M4: whether RemNote has been asked for this rem's document yet
  // (and how long after the queue body appeared), how often ↻ was pressed, and whether
  // the ≡ text view is open. Each is recorded WITH the rem it belongs to and derived per
  // render, never reset by an effect: the 🔄 swap changes `rem` in place. On desktop none
  // of this changes anything.
  const sectionRef = useRef<HTMLDivElement>(null);
  const [documentRequest, setDocumentRequest] = useState<{ remId: string; afterMs: number } | null>(null);
  const [redrawState, setRedrawState] = useState<{ remId: string; count: number } | null>(null);
  const [textViewRemId, setTextViewRemId] = useState<string | null>(null);
  const documentRequested = !M3_DELAY_DOCUMENT || documentRequest?.remId === rem._id;
  const documentRequestedAfterMs = documentRequest?.remId === rem._id ? documentRequest.afterMs : null;
  const redraws = redrawState?.remId === rem._id ? redrawState.count : 0;
  const textView = textViewRemId === rem._id;

  // Taps on ↻ / ≡ less than a second apart are ignored (a double tap is one request).
  const lastM4TapAtRef = useRef(0);
  const m4TapAllowed = () => {
    if (Date.now() - lastM4TapAtRef.current < 1000) return false;
    lastM4TapAtRef.current = Date.now();
    return true;
  };
  const redrawDocument = () => {
    if (!m4TapAllowed()) return;
    setTextViewRemId(null);
    setRedrawState({ remId: rem._id, count: redraws + 1 });
  };
  const toggleTextView = () => {
    if (!m4TapAllowed()) return;
    setTextViewRemId(textView ? null : rem._id);
  };

  // The DocumentViewer actually rendered (DOC_LIFECYCLE only). Every change — M3's first
  // request, ↻, ≡, the notes sidebar, a 🔄 swap — goes through here, and a viewer younger
  // than MIN_OVERLAY_LIFETIME_MS is kept until it is old enough. That is what prevents an
  // orphan: the SDK sends no unmount for an overlay RemNote has not yet confirmed, and
  // such an overlay then stays on screen, invisible-but-tappable, for the rest of the item
  // (seen in testing: two overlays after a swap). `overlaysCreated` counts viewers per rem
  // for the ≡ Text facts box.
  const [shownDoc, setShownDoc] = useState<{ key: string; remId: string; mountedAt: number } | null>(null);
  const overlaysCreatedRef = useRef<Record<string, number>>({});
  const wantedDoc =
    DOC_LIFECYCLE && !notesOpenForThisRem && !textView && documentRequested
      ? { key: `${rem._id}:${redraws}`, remId: rem._id }
      : null;
  useEffect(() => {
    if (!DOC_LIFECYCLE) return;
    if ((shownDoc?.key ?? null) === (wantedDoc?.key ?? null)) return;
    const apply = () => {
      if (wantedDoc) {
        overlaysCreatedRef.current[wantedDoc.remId] = (overlaysCreatedRef.current[wantedDoc.remId] ?? 0) + 1;
        setShownDoc({ ...wantedDoc, mountedAt: Date.now() });
      } else {
        setShownDoc(null);
      }
    };
    const age = shownDoc ? Date.now() - shownDoc.mountedAt : Infinity;
    if (age >= MIN_OVERLAY_LIFETIME_MS) {
      apply();
      return;
    }
    const timer = setTimeout(apply, MIN_OVERLAY_LIFETIME_MS - age);
    return () => clearTimeout(timer);
  }, [wantedDoc?.key, shownDoc?.key]);

  useEffect(() => {
    if (!M3_DELAY_DOCUMENT) return;
    const remId = rem._id;
    const startedAt = Date.now();
    let done = false;
    let settle: ReturnType<typeof setTimeout> | undefined;
    const request = () => {
      if (done) return;
      done = true;
      setDocumentRequest({ remId, afterMs: Date.now() - startedAt });
    };
    // Whatever the layout does, RemNote is asked within 1.5 s.
    const fallback = setTimeout(request, 1500);
    // Otherwise 250 ms after the section last changed size, once it has a real height
    // (the frame starts 0 px tall until RemNote sizes it).
    const section = sectionRef.current;
    const observer = section
      ? new ResizeObserver(() => {
          if (done || section.getBoundingClientRect().height < 100) return;
          clearTimeout(settle);
          settle = setTimeout(request, 250);
        })
      : undefined;
    if (section && observer) observer.observe(section);
    return () => {
      clearTimeout(fallback);
      clearTimeout(settle);
      observer?.disconnect();
    };
  }, [rem._id]);


  // -----------------------------------------------------------
  // 1. EFFECT FOR DEFERRED CRITICAL CONTEXT (Breadcrumbs & Status)
  //    - This replaces the slow parts of the original remData tracker.
  // -----------------------------------------------------------
  useEffect(() => {
    setCriticalContext(null);

    const loadCriticalData = async () => {
      // 1. Check Document Powerup (fast)
      const hasDocumentPowerup = await rem.hasPowerup(BuiltInPowerupCodes.Document);

      // 2. Get Ancestors (slow part)
      const ancestorList: CriticalContext['ancestors'] = [];
      let currentParent = rem.parent;
      let depth = 0;
      const maxDepth = 10;

      while (currentParent && depth < maxDepth) {
        try {
          // Add a yield point here to prevent blocking if the hierarchy is deep.
          if (depth % 2 === 0) {
            await new Promise(resolve => setTimeout(resolve, 1));
          }

          const parentRem = await plugin.rem.findOne(currentParent);
          if (!parentRem) break;

          const parentText = await safeRemTextToString(plugin, parentRem.text || []);

          ancestorList.unshift({
            text: parentText.slice(0, 30) + (parentText.length > 30 ? '...' : ''),
            fullText: parentText,
            id: currentParent
          });

          currentParent = parentRem.parent;
          depth++;
        } catch (error) {
          break;
        }
      }

      setCriticalContext({
        hasDocumentPowerup,
        ancestors: ancestorList
      });
    };

    // Execute after a short delay to ensure initial render is not blocked
    const timeoutId = setTimeout(() => {
      loadCriticalData().catch(console.error);
    }, 10);

    return () => clearTimeout(timeoutId);

  }, [rem._id, plugin]);

  /**
   * OPTIMIZED METADATA CALCULATION FOR ExtractViewer.tsx
   *
   * Replace the existing useEffect for metadata calculation with this optimized version.
   *
   * Key optimization: Uses allCardPriorityInfoKey cache instead of per-rem getCards() calls.
   * This avoids the SDK inconsistency where rem.getCards() sometimes returns [] for valid flashcards.
   *
   * Performance improvement:
   * - Before: N API calls (one per rem in remsToProcess)
   * - After: 1 session storage read + in-memory filtering
   */

  // Add this import at the top of the file:
  // import { allCardPriorityInfoKey } from '../lib/consts';
  // import { CardPriorityInfo } from '../lib/card_priority';

  // -----------------------------------------------------------
  // 2. EFFECT FOR DEFERRED METADATA CALCULATION (Statistics)
  // OPTIMIZED: Uses allCardPriorityInfoKey cache instead of per-rem getCards()
  // -----------------------------------------------------------
  useEffect(() => {
    setMetadata(null);
    // MOBILE-EXPERIMENT M2: no statistics pass on phones (see lib/mobile_experiments.ts).
    if (M2_SKIP_STATISTICS) return;

    const calculateMetadata = async () => {
      console.log("[ExtractViewer] Starting OPTIMIZED metadata calculation (using cache)...");
      const startTime = Date.now();

      // UPDATED: Filter out powerup slots from descendants
      const descendants = await getDescendantsExcludingSlots(plugin, rem);
      const descendantsCount = descendants.length;

      // UPDATED: Filter out powerup slots from children
      const children = await getChildrenExcludingSlots(plugin, rem);
      const childrenCount = children.length;

      const remsToProcess = [rem, ...descendants];

      // Create a Set of children IDs for quick lookup
      const childrenIds = new Set(children.map(c => c._id));

      // Create a Set of all rem IDs we're processing for fast lookup
      const remsToProcessIds = new Set(remsToProcess.map(r => r._id));

      // OPTIMIZATION: Use the pre-built cache instead of calling rem.getCards() for each rem
      // The cache already contains cardCount for each rem
      const allCardInfos = await plugin.storage.getSession<CardPriorityInfo[]>(allCardPriorityInfoKey) || [];

      // Build a map of remId -> card count for rems in our scope
      const cardCountByRemId = new Map<string, number>();
      for (const cardInfo of allCardInfos) {
        if (remsToProcessIds.has(cardInfo.remId)) {
          cardCountByRemId.set(cardInfo.remId, cardInfo.cardCount);
        }
      }
      console.log(`[ExtractViewer] Found ${cardCountByRemId.size} rems with cards in scope (from cache)`);

      let incrementalDescendantsCount = 0;
      let flashcardCount = 0;
      let incrementalChildrenCount = 0;
      let processedCount = 0;

      // Process in batches - but now we only need to check hasPowerup, not getCards
      for (let i = 0; i < remsToProcess.length; i += BATCH_SIZE) {
        const batch = remsToProcess.slice(i, i + BATCH_SIZE);

        const batchResults = await Promise.all(
          batch.map(async (r) => ({
            remId: r._id,
            isIncremental: await r.hasPowerup(powerupCode),
            // Use the pre-built map instead of calling getCards()
            cardCount: cardCountByRemId.get(r._id) || 0,
          }))
        );

        for (const result of batchResults) {
          if (result.isIncremental) {
            incrementalDescendantsCount++;
          }
          // Use the card count from our map
          flashcardCount += result.cardCount;

          // Use the Set for O(1) lookup instead of Array.some
          if (childrenIds.has(result.remId) && result.isIncremental) {
            incrementalChildrenCount++;
          }
        }
        processedCount += batch.length;

        if (i + BATCH_SIZE < remsToProcess.length) {
          await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
        }
      }

      setMetadata({
        childrenCount,
        incrementalChildrenCount,
        descendantsCount,
        incrementalDescendantsCount,
        flashcardCount,
      });

      const elapsedTime = Date.now() - startTime;
      console.log(`[ExtractViewer] OPTIMIZED metadata calculation complete. Processed ${processedCount} rems in ${elapsedTime}ms.`);
    };

    const timeoutId = setTimeout(() => {
      calculateMetadata().catch(console.error);
    }, 50);

    return () => clearTimeout(timeoutId);

  }, [rem._id, plugin]);


  // -----------------------------------------------------------
  // 3. MAIN RENDER LOGIC
  // -----------------------------------------------------------

  // --- IMMEDIATE RENDER ---
  // We no longer rely on remData. We use null coalescing for the deferred state.

  const isMetadataLoading = !metadata && !M2_SKIP_STATISTICS; // MOBILE-EXPERIMENT M2: never loads there
  const {
    childrenCount = '...',
    incrementalChildrenCount = '...',
    descendantsCount = '...',
    incrementalDescendantsCount = '...',
    flashcardCount = '...'
  } = metadata || {};

  // Fallback for Critical Context (Breadcrumbs/Status)
  const isContextLoading = !criticalContext;
  const ancestors = criticalContext?.ancestors || [];
  const hasDocumentPowerup = criticalContext?.hasDocumentPowerup ?? false;

  const handleAncestorClick = useCallback(
    async (ancestorId: RemId) => {
      const ancestorRem = await plugin.rem.findOne(ancestorId);
      if (ancestorRem) {
        await plugin.window.openRem(ancestorRem);
      }
    },
    [plugin]
  );

  const notesHint = (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        color: 'var(--rn-clr-content-tertiary, #64748b)',
        fontSize: 13,
      }}
    >
      <span>📝 Editing in the notes sidebar</span>
      <span style={{ fontSize: 11 }}>
        The in-queue view is paused while this Rem is open there — press “✎ Show in queue” to bring it back.
      </span>
    </div>
  );

  return (
    <div
      className="extract-viewer"
      style={{
        height: '100vh',
        display: 'grid',
        gridTemplateRows: 'auto 1fr auto',
        ...(M1_INLINE_LAYOUT ? M1_STYLES.root : {}), // MOBILE-EXPERIMENT M1
      }}
      onClick={(e) => {
        // When clicking non-interactive areas (metadata bar, empty space),
        // redirect focus into the DocumentViewer's editable area.
        // This prevents a "no-man's-land" focus state where neither the
        // RemNote editor nor the parent window handles keyboard events properly.
        const target = e.target as HTMLElement;
        if (!target.closest('.document-viewer-section, a, button, [role="button"], input, select, textarea, [contenteditable]')) {
          const docViewerSection = (e.currentTarget as HTMLElement).querySelector('.document-viewer-section');
          const editable = docViewerSection?.querySelector('[contenteditable="true"]') as HTMLElement | null;
          if (editable) {
            editable.focus();
          }
        }
      }}
    >
      {/* Breadcrumb Section (Hidden/Placeholder while loading context). MOBILE-EXPERIMENT
          M4: the row stays visible while loading when it carries the ↻ / ≡ buttons. */}
      <div
        className={`breadcrumb-section px-4 border-b border-gray-200 dark:border-gray-700 flex-shrink-0 h-10 flex items-center overflow-x-auto ${isContextLoading && !M4_BUTTONS ? 'opacity-0' : ''}`}
        style={M1_INLINE_LAYOUT ? M1_STYLES.crumbRow : undefined} // MOBILE-EXPERIMENT M1
      >
        {M4_BUTTONS && (
          // MOBILE-EXPERIMENT M4. In the phone app RemNote's page header covers this row
          // whenever the document is drawn, so in practice these are reachable exactly
          // when it is not.
          <div style={{ display: 'flex', gap: 6, marginRight: 10, flexShrink: 0 }}>
            <style>{M4_COLOUR_CSS}</style>
            <button
              className="ie-m4-fg"
              type="button"
              title="Ask RemNote to draw this document again"
              style={m4ButtonStyle(false)}
              onClick={(e) => {
                e.stopPropagation();
                redrawDocument();
              }}
            >
              ↻ Redraw
            </button>
            <button
              className="ie-m4-fg"
              type="button"
              title={textView ? 'Back to RemNote’s document view' : 'Show this Rem as plain text, drawn by the plugin'}
              style={m4ButtonStyle(textView)}
              onClick={(e) => {
                e.stopPropagation();
                toggleTextView();
              }}
            >
              {textView ? '≡ Document' : '≡ Text'}
            </button>
          </div>
        )}
        {!isContextLoading && ancestors.length > 0 && (
          <div
            className="text-sm text-gray-600 dark:text-gray-400 flex flex-nowrap items-center w-full"
            style={M1_INLINE_LAYOUT ? M1_STYLES.crumbList : undefined} // MOBILE-EXPERIMENT M1
          >
            {ancestors.map((ancestor, index) => (
              <div
                key={ancestor.id}
                className="flex items-center flex-shrink-0"
                style={M1_INLINE_LAYOUT ? M1_STYLES.crumb : undefined} // MOBILE-EXPERIMENT M1
              >
                <span
                  onClick={() => handleAncestorClick(ancestor.id)}
                  className="hover:underline cursor-pointer max-w-[150px] truncate inline-block"
                  style={M1_INLINE_LAYOUT ? M1_STYLES.crumbText : undefined} // MOBILE-EXPERIMENT M1
                  title={ancestor.fullText}
                >
                  {ancestor.text}
                </span>
                {index < ancestors.length - 1 && (
                  <span className="mx-1" style={M1_INLINE_LAYOUT ? M1_STYLES.crumbSeparator : undefined /* MOBILE-EXPERIMENT M1 */}>
                    ›
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* DocumentViewer Section (Renders immediately using rem._id). Paused
          while this rem is open in the notes sidebar — see notesOpenForThisRem. */}
      <div
        ref={sectionRef}
        className="document-viewer-section overflow-hidden"
        style={M1_INLINE_LAYOUT || M4_BUTTONS ? M1_STYLES.section : undefined} // MOBILE-EXPERIMENT M1 (and M4: the ≡ view scrolls only inside a bounded section)
      >
        {DOC_LIFECYCLE ? (
          // MOBILE-EXPERIMENT M3/M4: the viewer RemNote was asked for (see shownDoc), else
          // the notes hint or the plugin's own ≡ text view.
          shownDoc ? (
            <DocumentViewer
              key={shownDoc.key}
              width={'100%'}
              height={'100%'}
              documentId={shownDoc.remId}
              {...OVERLAY_CLASS_PROPS} // MOBILE-EXPERIMENT M4/M5/M6: RemNote copies it onto its overlay
            />
          ) : notesOpenForThisRem ? (
            notesHint
          ) : textView ? (
            <MobileTextOutline
              rem={rem}
              plugin={plugin}
              showFacts={M5_FACTS}
              documentRequestedAfterMs={documentRequestedAfterMs}
              overlaysCreated={overlaysCreatedRef.current[rem._id] ?? 0}
            />
          ) : null
        ) : notesOpenForThisRem ? (
          notesHint
        ) : (
          <DocumentViewer
            width={'100%'}
            height={'100%'}
            documentId={rem._id}
            {...OVERLAY_CLASS_PROPS} // MOBILE-EXPERIMENT M5/M6: empty on desktop
          />
        )}
      </div>

      {/* Metadata Section (Updates when metadata is ready) */}
      <div className={`metadata-section px-4 py-3 border-t flex-shrink-0 ${isMetadataLoading ? 'opacity-50' : ''}`}
        style={{
          borderColor: '#e5e7eb',
          backgroundColor: isMetadataLoading ? 'rgba(0,0,0,0.05)' : 'transparent',
          ...(M1_INLINE_LAYOUT ? M1_STYLES.footer : {}), // MOBILE-EXPERIMENT M1
        }}
      >
        <div className="text-xs text-gray-500 dark:text-gray-400">
          <div className="flex items-center gap-4 flex-wrap" style={M1_INLINE_LAYOUT ? M1_STYLES.footerRow : undefined /* MOBILE-EXPERIMENT M1 */}>
            <span>
              {isContextLoading ? 'Loading...' : (hasDocumentPowerup ? 'Document' : 'Extract')} • Incremental Rem
            </span>
            {M2_SKIP_STATISTICS ? (
              // MOBILE-EXPERIMENT M2
              <span>Statistics are not calculated on phones</span>
            ) : isMetadataLoading ? (
              <span>Calculating statistics...</span>
            ) : (
              <>
                <span>
                  {childrenCount} direct {childrenCount === 1 ? 'child' : 'children'} ({incrementalChildrenCount} incremental)
                </span>
                <span>
                  {descendantsCount} {descendantsCount === 1 ? 'descendant' : 'descendants'} ({incrementalDescendantsCount} incremental)
                </span>
                <span>
                  {flashcardCount} {flashcardCount === 1 ? 'flashcard' : 'flashcards'}
                </span>
              </>
            )}
            <button
              onClick={async () => {
                // Toggle. Open: point the sidebar at this Rem (which also pauses
                // the in-queue document above) and open RemNote's docked right
                // sidebar — a docked pane hosts the editor's popups ([[ search,
                // date picker, tag navigation) correctly, which a plugin floating
                // window cannot. Close: clear the key so the in-queue document
                // returns; the sidebar pane itself is closed with RemNote's own
                // control (the SDK cannot close it, nor trigger the native P
                // previewer — see Deviation 11's dead-ends note).
                if (notesOpenForThisRem) {
                  await plugin.storage.setSession(incremNotesSidebarRemIdKey, undefined);
                  return;
                }
                await plugin.storage.setSession(incremNotesSidebarRemIdKey, rem._id);
                await plugin.window.openWidgetInRightSidebar(incremNotesSidebarWidgetId).catch(() => {});
              }}
              title={
                notesOpenForThisRem
                  ? 'Show this Rem in the queue again (the sidebar pane is closed with RemNote\'s own control)'
                  : 'Open this Rem in the notes sidebar (popups and [[ search work there); the in-queue view pauses while it is open'
              }
              style={{
                marginLeft: 'auto',
                flexShrink: 0,
                padding: '1px 8px',
                fontSize: 11,
                fontWeight: 600,
                lineHeight: '16px',
                borderRadius: 6,
                border: '1px solid var(--rn-clr-blue, #3b82f6)',
                // Pressed state is unmistakable: filled blue, white text.
                backgroundColor: notesOpenForThisRem ? 'var(--rn-clr-blue, #3b82f6)' : 'transparent',
                color: notesOpenForThisRem ? '#ffffff' : 'var(--rn-clr-blue, #3b82f6)',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {notesOpenForThisRem ? '✎ Show in queue' : '✎ Open in sidebar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
