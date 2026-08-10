// components/ExtractViewer.tsx
// UPDATED: Added filtering for powerup slots (Incremental and CardPriority)

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { PluginRem, RNPlugin, RemViewer, DocumentViewer, BuiltInPowerupCodes, RemId, useTrackerPlugin } from '@remnote/plugin-sdk';
import { powerupCode, dismissedPowerupCode, allCardPriorityInfoKey, incremNotesSidebarWidgetId, incremNotesSidebarRemIdKey } from '../lib/consts';
import { resolveRemTextForBreadcrumb } from '../lib/richTextRemRefs';
import { getRemReadPoint } from '../lib/remReadPoint';
import {
  getChildrenExcludingSlots,
  getDescendantsExcludingSlots
} from '../lib/powerupSlotFilter';
import { CardPriorityInfo } from '../lib/card_priority';

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

// Read-only preview caps. Each RemViewer is a (read-only) FakeEmbed overlay, so
// we bound how many we spawn: children per node, and how deep we recurse. Beyond
// either cap we show a "edit in sidebar" hint instead.
const MAX_PREVIEW_CHILDREN = 100;
const MAX_PREVIEW_DEPTH = 6;

const hintButtonStyle: React.CSSProperties = {
  alignSelf: 'flex-start',
  marginTop: 2,
  background: 'none',
  border: 'none',
  color: 'var(--rn-clr-content-tertiary, #94a3b8)',
  cursor: 'pointer',
  fontSize: 12,
};

/**
 * Read-only, reactive render of a Rem and its descendant subtree. Each node
 * fetches its own children via useTrackerPlugin, so editing/adding/removing any
 * descendant in the sidebar updates the preview live (RemViewer itself is
 * reactive to a rem's own text). Depth is conveyed by indentation + a guide line
 * (and a divider under the root) — not font size, which a FakeEmbed overlay
 * ignores. Bounded by MAX_PREVIEW_CHILDREN per node and MAX_PREVIEW_DEPTH; past
 * either, a hint routes to the sidebar.
 */
// FORK NOTE: retained from upstream but NOT rendered by this fork — the queue body
// uses RemNote's DocumentViewer instead (see the content section below and
// Deviation 11 in CLAUDE.md). Kept rather than deleted so upstream changes to it
// keep merging cleanly, and so the read-only tree is one line away if ever wanted.
function ReadOnlyRemTree({
  remId,
  depth,
  onEditInSidebar,
  readPointRemId,
  scrollTrigger,
}: {
  remId: RemId;
  depth: number;
  onEditInSidebar: () => void;
  readPointRemId: RemId | null;
  scrollTrigger: number;
}) {
  const nodeData = useTrackerPlugin(
    async (rp) => {
      const r = await rp.rem.findOne(remId);
      if (!r) return { childIds: [] as RemId[], isIncremental: false, isDismissed: false, isClozeExtract: false, isIgnored: false };
      const children = await getChildrenExcludingSlots(rp as unknown as RNPlugin, r);
      // Powerup status for left-border emphasis (mirrors the editor's
      // incremental/dismissed left borders, since RemViewer overlays ignore
      // any text styling we set here).
      const isIncremental = await r.hasPowerup(powerupCode);
      const isDismissed = await r.hasPowerup(dismissedPowerupCode);
      // cloze-extract and ignore are named tags (not powerups). Detect them so we
      // can badge these child rems here too — mirrors the queue's violet ↑ cloze
      // identifier and the editor's #ignore de-emphasis, both of which the
      // RemViewer overlay ignores (it renders outside this iframe's CSS).
      const tagRems = await r.getTagRems();
      const clozeExtractTag = await rp.rem.findByName(['cloze-extract'], null);
      const isClozeExtract = clozeExtractTag
        ? tagRems.some((t) => t._id === clozeExtractTag._id)
        : false;
      const ignoreTag = await rp.rem.findByName(['ignore'], null);
      const isIgnored = ignoreTag ? tagRems.some((t) => t._id === ignoreTag._id) : false;
      return { childIds: children.map((c) => c._id), isIncremental, isDismissed, isClozeExtract, isIgnored };
    },
    [remId]
  );
  const childIds = nodeData?.childIds ?? [];
  const isIncremental = nodeData?.isIncremental ?? false;
  const isDismissed = nodeData?.isDismissed ?? false;
  const isClozeExtract = nodeData?.isClozeExtract ?? false;
  const isIgnored = nodeData?.isIgnored ?? false;

  const shown = childIds.slice(0, MAX_PREVIEW_CHILDREN);
  const hidden = childIds.length - shown.length;
  const atMaxDepth = depth >= MAX_PREVIEW_DEPTH;

  // Read-point emphasis. RemViewer is a FakeEmbed overlay that ignores any
  // font/color we set here, so emphasis is layout-only (accent left border +
  // background box) plus our own badge DOM element above the embed. The wrapper
  // ref lets us center the node in the scroll container on load / on demand.
  const isReadPoint = readPointRemId != null && readPointRemId === remId;
  const nodeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!isReadPoint || !nodeRef.current) return;
    // Defer to let the overlay position itself before we scroll.
    const t = setTimeout(() => {
      nodeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 150);
    return () => clearTimeout(t);
  }, [isReadPoint, scrollTrigger]);

  // NOTE: we can't vary font size by depth — RemViewer is a FakeEmbed rendered
  // as an overlay in RemNote's main window, so it ignores any font/color set on
  // this iframe-side wrapper. Only layout (indentation, the guide line, the
  // divider under the root, and the emphasis boxes below) reaches it.
  //
  // Emphasis boxes (left border + background tint + radius + padding — the box
  // style aligns to the embed better than a bare border). Precedence:
  //   • root (depth 0) → the Target Incremental Rem: strongest box + badge.
  //   • read point → blue box + badge.
  //   • Incremental descendant → green box (mirrors SHOW_LEFT_BORDER_CSS).
  //   • Dismissed descendant → amber box (mirrors SHOW_DISMISSED_INDICATOR_CSS).
  // The generic Incremental box is intentionally NOT applied to the root, which
  // gets the stronger target treatment instead.
  const isRoot = depth === 0;
  let wrapperStyle: React.CSSProperties | undefined;
  let badge: { text: string; color: string } | null = null;
  if (isRoot) {
    wrapperStyle = {
      borderLeft: '5px solid #15803d',
      background: 'rgba(34,197,94,0.18)',
      borderRadius: 8,
      padding: '6px 10px',
      margin: '2px 0',
    };
    badge = { text: '🎯 Target Incremental Rem', color: '#15803d' };
  } else if (isReadPoint) {
    wrapperStyle = {
      borderLeft: '3px solid var(--rn-clr-blue, #3b82f6)',
      background: 'var(--rn-clr-blue-light, rgba(59,130,246,0.10))',
      borderRadius: 6,
      padding: '4px 8px',
      margin: '2px 0',
    };
    badge = { text: '🔖 Read point', color: 'var(--rn-clr-blue, #3b82f6)' };
  } else if (isIncremental) {
    wrapperStyle = {
      borderLeft: '3px solid green',
      background: 'rgba(34,197,94,0.10)',
      borderRadius: 6,
      padding: '4px 8px',
      margin: '2px 0',
    };
  } else if (isDismissed) {
    wrapperStyle = {
      borderLeft: '3px solid #f59e0b',
      background: 'rgba(245,158,11,0.10)',
      borderRadius: 6,
      padding: '4px 8px',
      margin: '2px 0',
    };
  } else if (isIgnored) {
    // Deliberately understated — no colored fill, a thin *dashed* grey rule and a
    // faint neutral tint. Reads as a muted/archived snippet, differentiating the
    // rem without the emphasis the incremental/dismissed boxes carry. (We can't
    // dim the rendered text itself — that's a RemViewer overlay outside our CSS.)
    wrapperStyle = {
      borderLeft: '2px dashed var(--rn-clr-border-primary, #cbd5e1)',
      background: 'rgba(148,163,184,0.06)',
      borderRadius: 6,
      padding: '4px 8px',
      margin: '2px 0',
    };
  }

  return (
    <div>
      <div ref={nodeRef} style={wrapperStyle}>
        {badge && (
          <div style={{ fontSize: 11, fontWeight: 700, color: badge.color, marginBottom: 2 }}>
            {badge.text}
          </div>
        )}
        {isClozeExtract && (
          <div
            title="Cloze child — created from a parent rem via Create Cloze Deletion"
            style={{ fontSize: 11, fontWeight: 700, color: '#7c3aed', marginBottom: 2 }}
          >
            ⬆️ Cloze extract
          </div>
        )}
        {isIgnored && (
          <div
            title="Tagged #ignore — a low-importance snippet"
            style={{ fontSize: 11, fontWeight: 400, color: 'var(--rn-clr-content-tertiary, #94a3b8)', fontStyle: 'italic', marginBottom: 2 }}
          >
            🚫 Ignored
          </div>
        )}
        <RemViewer remId={remId} width="100%" />
      </div>
      {childIds.length > 0 && (
        <>
          {/* Horizontal divider separating the target rem from its descendants. */}
          {depth === 0 && (
            <div style={{ borderTop: '1px solid var(--rn-clr-border-primary, #e5e7eb)', margin: '10px 0' }} />
          )}
          <div
            style={{
              marginLeft: 14,
              marginTop: depth === 0 ? 0 : 4,
              paddingLeft: 12,
              borderLeft: '1px solid var(--rn-clr-border-primary, #e5e7eb)',
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
            }}
          >
            {atMaxDepth ? (
              <button onClick={onEditInSidebar} style={hintButtonStyle}>
                … deeper items — edit in sidebar →
              </button>
            ) : (
              <>
                {shown.map((id) => (
                  <ReadOnlyRemTree
                    key={id}
                    remId={id}
                    depth={depth + 1}
                    onEditInSidebar={onEditInSidebar}
                    readPointRemId={readPointRemId}
                    scrollTrigger={scrollTrigger}
                  />
                ))}
                {hidden > 0 && (
                  <button onClick={onEditInSidebar} style={hintButtonStyle}>
                    + {hidden} more — edit in sidebar →
                  </button>
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export function ExtractViewer({ rem, plugin }: ExtractViewerProps) {
  if (!rem) return null;

  // --- STATE 1: DEFERRED METADATA (Statistics) ---
  const [metadata, setMetadata] = useState<Metadata | null>(null);

  // --- STATE 2: DEFERRED CRITICAL CONTEXT (Breadcrumbs & Status) ---
  const [criticalContext, setCriticalContext] = useState<CriticalContext | null>(null);

  // --- READ POINT (rem-type bookmark) ---
  // Reactive so setting/changing the read point while reviewing updates the
  // viewer live. Resolves the bookmarked descendant's id + display text.
  const readPoint = useTrackerPlugin(
    async (rp) => {
      const entry = await getRemReadPoint(rp as unknown as RNPlugin, rem._id);
      if (!entry?.highlightId) return null;
      const targetRem = await rp.rem.findOne(entry.highlightId);
      if (!targetRem) return null;
      const text = await resolveRemTextForBreadcrumb(rp as unknown as RNPlugin, targetRem.text || []);
      return { remId: entry.highlightId, text };
    },
    [rem._id]
  ) ?? null;
  const readPointRemId = readPoint?.remId ?? null;

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

          // Use the pin-aware breadcrumb resolver: reference *pins* collapse to a
          // 📌 marker instead of expanding into the full referenced rem's text,
          // so an ancestor whose title carries a pin doesn't bloat the breadcrumb.
          const parentText = await resolveRemTextForBreadcrumb(plugin, parentRem.text || []);

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


  // NOTE: The read-only content (the rem + its descendant subtree) is rendered
  // by <ReadOnlyRemTree>, which fetches each node's children reactively — so it
  // stays in sync as descendants are edited/added/removed in the sidebar. The
  // in-queue view is intentionally READ-ONLY because an editable DocumentViewer
  // (FakeEmbed) can't hold focus inside the queue's Flashcard pane (it loses a
  // focus tug-of-war that collapses selections and can even rate the card).

  // -----------------------------------------------------------
  // 2c. AUTO-OPEN the notes sidebar (and tell it WHICH rem to edit)
  // -----------------------------------------------------------
  // Editing happens in increm_notes_sidebar (RightSidebar pane), so surface it
  // automatically — mirrors the 📝 button Reader.tsx uses for PDF/HTML.
  //
  // We publish the rem id to a dedicated session key rather than letting the
  // sidebar infer it from currentIncrementalRemTypeKey: the queue clears that
  // type key in its own effect-cleanup, so it races with this auto-open and the
  // sidebar would intermittently see `undefined` and show its empty state. This
  // key is set by the widget that definitively knows a Rem extract is on screen,
  // and cleared on unmount. The sidebar additionally only honors it when it
  // matches the current IncRem id, so a stale value (if an unmount-clear is
  // skipped during sandbox teardown) is ignored rather than mis-shown.
  //
  // FORK DEVIATION: upstream also force-opened the notes sidebar here on every
  // mount. We publish the id but never open the pane — the queue item belongs in
  // the queue body, and an unrequested sidebar on every card is disruptive. The
  // sidebar is still one click away via the '✎ Edit in sidebar' button below (and
  // the Reader's 📝 button), both of which rely on the key we still set here.
  useEffect(() => {
    plugin.storage.setSession(incremNotesSidebarRemIdKey, rem._id);
    return () => {
      plugin.storage.setSession(incremNotesSidebarRemIdKey, undefined);
    };
  }, [rem._id, plugin]);

  // NOTE: Restoring the Practiced Queues dashboard after advancing past an
  // IncRem is handled globally in handleNextRepetitionClick (gated by the
  // "Auto focus Queue Dashboard" setting) rather than here — PDF/HTML items
  // also need it (RemNote auto-focuses its own Summary pane for those), so a
  // rem-only listener wouldn't cover them.


  // -----------------------------------------------------------
  // 3. MAIN RENDER LOGIC
  // -----------------------------------------------------------

  // --- IMMEDIATE RENDER ---
  // We no longer rely on remData. We use null coalescing for the deferred state.

  const isMetadataLoading = !metadata;
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

  const openNotesSidebar = useCallback(() => {
    plugin.window.openWidgetInRightSidebar(incremNotesSidebarWidgetId).catch(() => {});
  }, [plugin]);

  return (
    <div
      className="extract-viewer"
      style={{
        // FORK DEVIATION — layout restored from the pre-merge fork. A flat grid
        // directly on the widget root: header / document / footer. Upstream wrapped
        // the body in an extra "card" (border + radius + shadow + grey chrome),
        // which both looked like a box pasted into the queue and put another
        // layout layer between the root and the document. The document row is a
        // grid `1fr`, which is a definite height — DocumentViewer is an overlay
        // with no intrinsic height, so it needs one to fill.
        //
        // Height is 100vh, NOT a percentage: the widget is registered with
        // dimensions.height 'auto' (widgets.ts) and the SDK docs state percentages
        // apply to width only, so RemNote sizes the iframe from our content and a
        // percentage has nothing to resolve against.
        height: '100vh',
        width: '100%',
        boxSizing: 'border-box',
        display: 'grid',
        gridTemplateRows: readPoint ? 'auto auto 1fr auto' : 'auto 1fr auto',
        overflow: 'hidden',
      }}
      onClick={(e) => {
        // With an editable DocumentViewer inside the queue's Flashcard pane,
        // clicking chrome (breadcrumb, footer, empty space) leaves focus in a
        // no-man's-land where neither the editor nor the parent window handles
        // keystrokes — and stray keys can reach the card. Redirect into the editor.
        const target = e.target as HTMLElement;
        if (!target.closest('.document-viewer-section, a, button, [role="button"], input, select, textarea, [contenteditable]')) {
          const editable = (e.currentTarget as HTMLElement)
            .querySelector('.document-viewer-section [contenteditable="true"]') as HTMLElement | null;
          editable?.focus();
        }
      }}
    >
      {/* Breadcrumb — ancestor trail, click to open. */}
      <div
        className="breadcrumb-section"
        style={{
          padding: '6px 12px',
          minHeight: 28,
          display: 'flex',
          alignItems: 'center',
          overflow: 'hidden',
          opacity: isContextLoading ? 0 : 1,
        }}
      >
        {!isContextLoading && ancestors.length > 0 && (
          <div style={{ fontSize: 12, lineHeight: 1.4, color: 'var(--rn-clr-content-tertiary, #64748b)', wordBreak: 'break-word' }}>
            {ancestors.map((ancestor, index) => (
              <span key={ancestor.id}>
                <span
                  onClick={() => handleAncestorClick(ancestor.id)}
                  className="hover:underline"
                  title={ancestor.fullText}
                  style={{ cursor: 'pointer' }}
                >
                  {ancestor.fullText}
                </span>
                {index < ancestors.length - 1 && <span style={{ margin: '0 4px' }}>›</span>}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Read-point banner — only when a read point is set (adds a grid row). */}
      {readPoint && (
        <div
          style={{
            padding: '4px 12px',
            fontSize: 12,
            color: 'var(--rn-clr-blue, #2563eb)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={readPoint.text}
        >
          🔖 Read point: <span style={{ fontWeight: 600 }}>{readPoint.text}</span>
        </div>
      )}

      {/* The Rem itself, rendered by RemNote's own document editor. */}
      <div className="document-viewer-section" style={{ minHeight: 0, overflow: 'hidden' }}>
        <DocumentViewer width={'100%'} height={'100%'} documentId={rem._id} />
      </div>

      {/* Footer — stats + open-in-sidebar. */}
      <div
        style={{
          padding: '6px 12px',
          borderTop: '1px solid var(--rn-clr-border-primary, #e2e8f0)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          opacity: isMetadataLoading ? 0.7 : 1,
        }}
      >
        <div style={{ fontSize: 11, color: 'var(--rn-clr-content-tertiary, #64748b)', display: 'flex', flexWrap: 'wrap', gap: 12, minWidth: 0 }}>
          <span>{isContextLoading ? 'Loading…' : (hasDocumentPowerup ? 'Document' : 'Extract')} • Incremental Rem</span>
          {isMetadataLoading ? (
            <span>Calculating statistics…</span>
          ) : (
            <>
              <span>{childrenCount} direct {childrenCount === 1 ? 'child' : 'children'} ({incrementalChildrenCount} incremental)</span>
              <span>{descendantsCount} {descendantsCount === 1 ? 'descendant' : 'descendants'} ({incrementalDescendantsCount} incremental)</span>
              <span>{flashcardCount} {flashcardCount === 1 ? 'flashcard' : 'flashcards'}</span>
            </>
          )}
        </div>
        <button
          onClick={openNotesSidebar}
          title="Open this Rem in the notes sidebar (handy for editing alongside the source, or when the queue pane is cramped)"
          style={{
            flexShrink: 0,
            padding: '4px 10px',
            borderRadius: 6,
            border: '1px solid var(--rn-clr-blue, #3b82f6)',
            backgroundColor: 'transparent',
            color: 'var(--rn-clr-blue, #3b82f6)',
            cursor: 'pointer',
            fontSize: 12,
            fontWeight: 600,
            whiteSpace: 'nowrap',
          }}
        >
          ✎ Edit in sidebar →
        </button>
      </div>
    </div>
  );
}
