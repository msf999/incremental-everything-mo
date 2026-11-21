// components/ExtractViewer.tsx
// UPDATED: Added filtering for powerup slots (Incremental and CardPriority)

import React, { useState, useEffect } from 'react';
import { useRef } from 'react'; // MOBILE-EXPERIMENT (M4 only)
import { PluginRem, RNPlugin, DocumentViewer, RichText, BuiltInPowerupCodes, RichTextElementRemInterface, useTrackerPlugin } from '@remnote/plugin-sdk';
import { powerupCode, allCardPriorityInfoKey, extractEditorTargetKey, extractEditorRequestKey, extractEditorRequestAckKey, incRemPreviewOpenKey, INC_REM_PREVIEW_FRESH_MS } from '../lib/consts';
import type { ExtractEditorRequest, IncRemPreviewOpen } from '../lib/consts';
import { QueueBreadcrumb } from './QueueBreadcrumb'; // FORK (2026-10-11): ancestors with RemNote's icons
import { keepFocusWithRemNote } from '../lib/keep_focus_with_remnote'; // FORK (2026-10-11)
import {
  getChildrenExcludingSlots,
  getDescendantsExcludingSlots
} from '../lib/powerupSlotFilter';
import { CardPriorityInfo } from '../lib/card_priority';
import { MOBILE_DOCVIEW_CLASS, isMobileApp, mobileExperiment, tagMobileDocumentOverlay } from '../lib/mobile_experiments'; // MOBILE-EXPERIMENT
import { queueDocviewClassName } from '../lib/queue_docview'; // FORK (2026-11-14)
// FORK (b01355e sync, Deviation 19): upstream's editor over the card, opened from the footer.
import { closeExtractEditor, ExtractEditorTarget, openExtractEditor } from '../lib/extract_editor';
import { resolveRemTextForBreadcrumb } from '../lib/richTextRemRefs';
import { FORK_FEATURES } from '../lib/fork_gates';
import { MobileTextOutline } from './MobileTextOutline'; // MOBILE-EXPERIMENT M4
import { MobileDocumentTree } from './MobileDocumentTree'; // MOBILE-EXPERIMENT M7

// MOBILE-EXPERIMENT (lib/mobile_experiments.ts): all false outside RemNote's phone and
// tablet apps, so on desktop every branch below that reads them renders as before.
const M1_INLINE_LAYOUT = mobileExperiment('inlineLayout');
const M2_COMPACT_FOOTER = mobileExperiment('compactFooter');
const M4_TEXT_BUTTON = mobileExperiment('textButton');
const M5_FACTS = mobileExperiment('diagnostics');
const M7_DOCUMENT_TREE = mobileExperiment('documentsAsTree');
// M4/M7 mount and unmount RemNote's overlay themselves; DOC_LIFECYCLE routes every such
// change through `shownDoc` (see below). With both off, the viewer renders as on desktop.
const DOC_LIFECYCLE = M4_TEXT_BUTTON || M7_DOCUMENT_TREE;
// The SDK only sends an unmount for an overlay once RemNote has answered its create
// call; unmount it sooner and RemNote's overlay stays with no owner. A mounted overlay is
// therefore kept for at least this long before anything replaces or removes it.
const MIN_OVERLAY_LIFETIME_MS = 1000;
// RemNote copies a className onto its overlay element. Two things use that:
//  - FORK (2026-11-14): the queue's document view opens at the top, and — everywhere but in
//    RemNote's phone and tablet apps — is not typed into (lib/queue_docview.ts); `turn` counts
//    the rems this view has shown, see there. `isMobileApp`, not `isPhone` (2026-11-15, review):
//    it is the test that takes the ✎ sidebar button away (M2), and a view that cannot be typed
//    into must never be one without that button — which is what RemNote's tablet app got;
//  - MOBILE-EXPERIMENT M4/M5/M7: the phone's diagnostics and overlay rules (MOBILE_DOCVIEW_CLASS).
const overlayClassProps = (turn: number) => ({
  className: queueDocviewClassName(turn, !isMobileApp) + (tagMobileDocumentOverlay() ? ` ${MOBILE_DOCVIEW_CLASS}` : ''),
});
// M7: RemNote opens a Rem that has one of these powerups as its source — an uploaded file
// (PDF), a video, a web link, an audio recording, a shared article or outline — and that
// page draws on a phone, also for a Document (checked for the PDF and the link in the
// phone layout, 2026-11-14). Such a Rem keeps RemNote's document page.
const LEARNING_SOURCE_POWERUPS = ['f', 'vi', 'b', 'au', 'ssa', 'sslo'];

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
  section: { overflow: 'hidden', minHeight: 0, minWidth: 0, position: 'relative' },
  footer: { padding: '12px 16px', flexShrink: 0, borderTop: '1px solid rgba(127, 127, 127, 0.25)', fontSize: 12, lineHeight: '16px' },
  footerRow: { display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' },
};

// MOBILE-EXPERIMENT M4: the ≡ button (an icon, no words); `pressed` is the ≡ text view
// being open. Unpressed text colour comes from M4_COLOUR_CSS (class ie-m4-fg), not from an
// inline style.
// The footer's ✎ Edit toggle: blue outline, and filled blue with
// white text while on — the pressed state is unmistakable.
const footerButtonStyle = (pressed: boolean): React.CSSProperties => ({
  flexShrink: 0,
  padding: '1px 8px',
  fontSize: 11,
  fontWeight: 600,
  lineHeight: '16px',
  borderRadius: 6,
  border: '1px solid var(--rn-clr-blue, #3b82f6)',
  backgroundColor: pressed ? 'var(--rn-clr-blue, #3b82f6)' : 'transparent',
  color: pressed ? '#ffffff' : 'var(--rn-clr-blue, #3b82f6)',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
});

const m4ButtonStyle = (pressed: boolean): React.CSSProperties => ({
  flexShrink: 0,
  minHeight: 30,
  minWidth: 34,
  padding: '4px 8px',
  fontSize: 16,
  fontWeight: 600,
  lineHeight: '18px',
  borderRadius: 6,
  border: `1px solid ${pressed ? '#3b82f6' : 'rgba(127, 127, 127, 0.5)'}`,
  backgroundColor: pressed ? '#3b82f6' : 'transparent',
  ...(pressed ? { color: '#ffffff' } : {}),
  cursor: 'pointer',
  whiteSpace: 'nowrap',
});
// MOBILE-EXPERIMENT M4/M7: readable text in both themes in a frame without RemNote's CSS
// (the ≡ button and text view, the tree's title line) — the SDK puts `dark` or `light` on
// this frame's body.
const M4_COLOUR_CSS =
  '.ie-m4-fg{color:#111827}body.dark .ie-m4-fg{color:#e5e7eb}' +
  '.ie-m4-dim{color:#64748b}body.dark .ie-m4-dim{color:#94a3b8}';

interface ExtractViewerProps {
  rem: PluginRem;
  plugin: RNPlugin;
  /** FORK (2026-10-11): px the breadcrumb row leaves free on its right for a button the queue floats there. */
  topRightClearance?: number;
}

// Define the critical context structure. FORK (2026-10-11): the ancestors moved to
// components/QueueBreadcrumb.tsx, which reads and draws them itself.
interface CriticalContext {
  hasDocumentPowerup: boolean;
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

export function ExtractViewer({ rem, plugin, topRightClearance = 0 }: ExtractViewerProps) {
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

  // --- STATE 2: DEFERRED CRITICAL CONTEXT (Status) ---
  const [criticalContext, setCriticalContext] = useState<CriticalContext | null>(null);

  // FORK (2026-11-21, owner: "their new edit button is superior … remove the Sidebar button and
  // only keep the Edit button"): the footer's ✎ toggle that opened this Rem in the notes sidebar
  // (and paused the view below while it was there, on incremNotesSidebarRemIdKey) is gone. The
  // notes sidebar itself is upstream's and unchanged; nothing in the fork points it at a
  // Rem-type item any more.

  // FORK (b01355e sync, Deviation 19): upstream's Extract Editor — RemNote's editor in a
  // floating panel laid over this card (lib/extract_editor.ts). The queue view below is
  // read-only because RemNote's queue takes the keys of anything typed in it; the panel is a
  // floating widget, outside the queue, where typing is safe. While it is open on this Rem
  // the in-queue view is paused, as for the notes sidebar: two views of one Rem take the
  // caret from each other. The section's rectangle is where the panel is laid.
  const editingHere =
    useTrackerPlugin(
      async (rp) => (await rp.storage.getSession<ExtractEditorTarget>(extractEditorTargetKey))?.remId === rem._id,
      [rem._id]
    ) ?? false;
  const sectionRef = useRef<HTMLDivElement>(null);

  // FORK (2026-11-21, owner's report: "typing doesnt work correctly … the cursor keeps moving so it
  // gets jumbled"): while the preview popup (Ctrl+P, widgets/inc_rem_preview.tsx) shows THIS Rem,
  // the view below is paused too. Two document pages of one Rem take the caret from each other:
  // "abcdef" typed key by key in the popup over this view was saved as "abcdfe" (reproduced live);
  // the same keys in the popup were saved right for a Rem shown nowhere else, and for one shown as
  // a bullet of another page. The popup says "I am open" four times a second
  // (incRemPreviewOpenKey); one RemNote closes stops saying it, so the view also comes back once
  // the last beat is older than the freshness window (the timer below re-renders for that).
  const previewBeat = useTrackerPlugin(
    async (rp) => rp.storage.getSession<IncRemPreviewOpen | null>(incRemPreviewOpenKey),
    []
  );
  const [, setPreviewTick] = useState(0);
  const previewOpenHere =
    !!previewBeat && previewBeat.remId === rem._id && Date.now() - previewBeat.at < INC_REM_PREVIEW_FRESH_MS;
  useEffect(() => {
    if (!previewOpenHere || !previewBeat) return;
    const wait = Math.max(0, INC_REM_PREVIEW_FRESH_MS - (Date.now() - previewBeat.at)) + 50;
    const timer = setTimeout(() => setPreviewTick((t) => t + 1), wait);
    return () => clearTimeout(timer);
  }, [previewBeat?.at, previewOpenHere]);
  const toggleEditor = async () => {
    if (editingHere) {
      await closeExtractEditor(plugin, rem._id);
      return;
    }
    const title = await resolveRemTextForBreadcrumb(plugin, rem.text || []).catch(() => '');
    await openExtractEditor(plugin, rem._id, title, sectionRef.current).catch((err) => {
      console.error('[ExtractViewer] could not open the editor', err);
      plugin.app.toast('Could not open the editor here. Use Ctrl+P (Preview Item) instead.');
    });
  };

  // FORK (2026-11-21, owner: "make it ctrl+e"): Ctrl+E (register/commands.ts, `edit-inc-item`) asks
  // for the panel through the session; the viewer showing that Rem opens it over its own card, as
  // the button does, and answers with the nonce (without an answer the command opens a panel in the
  // middle of the screen). A request older than 2 s is not this view's: it was made before it drew.
  const editRequest = useTrackerPlugin(
    async (rp) => rp.storage.getSession<ExtractEditorRequest | null>(extractEditorRequestKey),
    []
  );
  const handledEditRequestRef = useRef<string | null>(null);
  useEffect(() => {
    if (!FORK_FEATURES.extractEditor || !editRequest) return;
    if (editRequest.remId !== rem._id || handledEditRequestRef.current === editRequest.nonce) return;
    if (Date.now() - editRequest.at > 2000) return;
    handledEditRequestRef.current = editRequest.nonce;
    void plugin.storage.setSession(extractEditorRequestAckKey, editRequest.nonce);
    if (!editingHere) void toggleEditor();
  }, [editRequest?.nonce, rem._id]);

  // MOBILE-EXPERIMENT M4/M7: whether the ≡ text view is open, and which of RemNote's
  // views draws this rem. Each is recorded WITH the rem it belongs to and derived per
  // render, never reset by an effect: the 🔄 swap changes `rem` in place. On desktop none
  // of this changes anything.
  const [textViewRemId, setTextViewRemId] = useState<string | null>(null);
  const textView = textViewRemId === rem._id;
  const [viewFact, setViewFact] = useState<{ remId: string; kind: 'page' | 'tree' } | null>(null);
  useEffect(() => {
    if (!M7_DOCUMENT_TREE) return;
    let cancelled = false;
    const remId = rem._id;
    Promise.all([rem.isDocument(), ...LEARNING_SOURCE_POWERUPS.map((code) => rem.hasPowerup(code))]).then(
      ([isDocument, ...sources]) => {
        if (!cancelled) setViewFact({ remId, kind: isDocument && !sources.some(Boolean) ? 'tree' : 'page' });
      },
      () => {
        // Unreadable: RemNote's document page, as before M7.
        if (!cancelled) setViewFact({ remId, kind: 'page' });
      }
    );
    return () => {
      cancelled = true;
    };
  }, [rem._id]);
  // M7: RemNote's hierarchy tree for a plain Document, its document page (as on desktop)
  // for anything else. null until that is known for THIS rem: nothing is mounted before,
  // because the page throws for a plain Document on a phone.
  const viewKind: 'page' | 'tree' | null = !M7_DOCUMENT_TREE
    ? 'page'
    : viewFact?.remId === rem._id
      ? viewFact.kind
      : null;

  // FORK (2026-11-14): how many rems this view has shown — 🔄 Another item puts a new rem into
  // the same view, and the open-at-the-top hold has to start again for it
  // (lib/queue_docview.ts).
  const docTurnRef = useRef({ remId: rem._id, turn: 0 });
  if (docTurnRef.current.remId !== rem._id) {
    docTurnRef.current = { remId: rem._id, turn: docTurnRef.current.turn + 1 };
  }
  const docTurn = docTurnRef.current.turn;

  // Taps on ≡ less than a second apart are ignored (a double tap is one request).
  const lastM4TapAtRef = useRef(0);
  const toggleTextView = () => {
    if (Date.now() - lastM4TapAtRef.current < 1000) return;
    lastM4TapAtRef.current = Date.now();
    setTextViewRemId(textView ? null : rem._id);
  };

  // The view of RemNote's actually rendered (DOC_LIFECYCLE only). Every change — the
  // first mount, ≡, the notes sidebar, a 🔄 swap — goes through here, and a view younger
  // than MIN_OVERLAY_LIFETIME_MS is kept until it is old enough. That is what prevents an
  // orphan: the SDK sends no unmount for an overlay RemNote has not yet confirmed, and
  // such an overlay then stays on screen, invisible-but-tappable, for the rest of the item
  // (seen in testing: two overlays after a swap).
  const [shownDoc, setShownDoc] = useState<{
    key: string;
    remId: string;
    kind: 'page' | 'tree';
    mountedAt: number;
  } | null>(null);
  const wantedDoc =
    DOC_LIFECYCLE && !editingHere && !previewOpenHere && !textView && viewKind
      ? { key: `${rem._id}:${viewKind}`, remId: rem._id, kind: viewKind }
      : null;
  useEffect(() => {
    if (!DOC_LIFECYCLE) return;
    if ((shownDoc?.key ?? null) === (wantedDoc?.key ?? null)) return;
    const apply = () => setShownDoc(wantedDoc ? { ...wantedDoc, mountedAt: Date.now() } : null);
    const age = shownDoc ? Date.now() - shownDoc.mountedAt : Infinity;
    if (age >= MIN_OVERLAY_LIFETIME_MS) {
      apply();
      return;
    }
    const timer = setTimeout(apply, MIN_OVERLAY_LIFETIME_MS - age);
    return () => clearTimeout(timer);
  }, [wantedDoc?.key, shownDoc?.key]);


  // -----------------------------------------------------------
  // 1. EFFECT FOR DEFERRED CRITICAL CONTEXT (Breadcrumbs & Status)
  //    - This replaces the slow parts of the original remData tracker.
  // -----------------------------------------------------------
  useEffect(() => {
    setCriticalContext(null);

    const loadCriticalData = async () => {
      // 1. Check Document Powerup (fast)
      const hasDocumentPowerup = await rem.hasPowerup(BuiltInPowerupCodes.Document);

      // FORK (2026-10-11): the ancestor walk that fed the breadcrumb lives in
      // components/QueueBreadcrumb.tsx now.
      setCriticalContext({
        hasDocumentPowerup,
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
    if (M2_COMPACT_FOOTER) return;

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

  const isMetadataLoading = !metadata && !M2_COMPACT_FOOTER; // MOBILE-EXPERIMENT M2: never loads there
  const {
    childrenCount = '...',
    incrementalChildrenCount = '...',
    descendantsCount = '...',
    incrementalDescendantsCount = '...',
    flashcardCount = '...'
  } = metadata || {};

  // Fallback for Critical Context (Status)
  const isContextLoading = !criticalContext;
  const hasDocumentPowerup = criticalContext?.hasDocumentPowerup ?? false;

  // FORK (b01355e sync): what the section shows under the editor panel — normally covered by it,
  // seen if the panel is dragged away.
  const editHint = (
    <div
      {...keepFocusWithRemNote}
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
      <span>✎ Editing over the card</span>
      <span style={{ fontSize: 11 }}>Press “✓ Done” to bring the queue view back.</span>
    </div>
  );
  // FORK (2026-11-21): the same, while the preview popup shows this Rem.
  const previewHint = (
    <div
      {...keepFocusWithRemNote}
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
      <span>Editing in the preview popup</span>
      <span style={{ fontSize: 11 }}>Close it (Esc or Ctrl+P) to bring the queue view back.</span>
    </div>
  );
  const showEditButton = FORK_FEATURES.extractEditor;

  return (
    <div
      className="extract-viewer"
      style={{
        height: '100vh',
        display: 'grid',
        gridTemplateRows: 'auto 1fr auto',
        ...(M1_INLINE_LAYOUT ? M1_STYLES.root : {}), // MOBILE-EXPERIMENT M1
      }}
      // FORK (2026-10-11, owner request): the root onClick that stood here tried to move
      // focus into the DocumentViewer's '[contenteditable]' after a click on empty space.
      // It never found one: RemNote draws the document in an overlay OUTSIDE this frame,
      // which holds only the SDK's placeholder. So a click on the breadcrumb row or the
      // footer left keyboard focus in this frame, where neither RemNote's shortcuts nor the
      // arrows reach anything (reproduced). Those two rows now hand focus back to RemNote
      // instead — lib/keep_focus_with_remnote.ts.
    >
      {/* Breadcrumb Section. FORK (2026-10-11): the ancestors, with RemNote's folder and
          document icons — components/QueueBreadcrumb.tsx, which shows nothing until they are
          read, so the row no longer hides itself while loading. MOBILE-EXPERIMENT M4: the
          row also carries the ≡ button. */}
      <div
        className="breadcrumb-section px-4 border-b border-gray-200 dark:border-gray-700 flex-shrink-0 h-10 flex items-center overflow-x-auto"
        {...keepFocusWithRemNote} // FORK (2026-10-11)
        style={{
          ...(M1_INLINE_LAYOUT ? M1_STYLES.crumbRow : {}), // MOBILE-EXPERIMENT M1
          ...(topRightClearance > 0 ? { paddingRight: topRightClearance } : {}), // FORK (2026-10-11)
        }}
      >
        {DOC_LIFECYCLE && <style>{M4_COLOUR_CSS}</style> /* MOBILE-EXPERIMENT M4/M7 */}
        {M4_TEXT_BUTTON && (
          // MOBILE-EXPERIMENT M4. In the phone app RemNote's page header covers this row
          // whenever RemNote's document page is drawn (not over its tree, M7). The click
          // reaches the row's keepFocusWithRemNote, which hands keyboard focus back after
          // a tap (2026-10-11, review, reproduced on desktop: a stopPropagation here kept
          // it in the plugin).
          <button
            className="ie-m4-fg"
            type="button"
            title={textView ? 'Back to RemNote’s view' : 'Show this Rem as plain text, drawn by the plugin'}
            aria-pressed={textView}
            style={{ ...m4ButtonStyle(textView), marginRight: 10 }}
            onClick={() => toggleTextView()}
          >
            ≡
          </button>
        )}
        <QueueBreadcrumb rem={rem} plugin={plugin} />
      </div>

      {/* DocumentViewer Section (Renders immediately using rem._id). Paused while the
          ✎ Edit panel is open on this rem — see editingHere. */}
      <div
        ref={sectionRef} // FORK (b01355e sync): the editor panel is laid over this rectangle
        className="document-viewer-section overflow-hidden"
        style={M1_INLINE_LAYOUT || DOC_LIFECYCLE ? M1_STYLES.section : undefined} // MOBILE-EXPERIMENT M1 (and M4/M7: the ≡ view and the tree's column need a bounded section)
      >
        {DOC_LIFECYCLE ? (
          // MOBILE-EXPERIMENT M4/M7: the view RemNote was asked for (see shownDoc) — its
          // tree under a title line for a Document, its document page otherwise — else the
          // notes hint or the plugin's own ≡ text view.
          shownDoc ? (
            shownDoc.kind === 'tree' ? (
              <MobileDocumentTree key={shownDoc.key} remId={shownDoc.remId} />
            ) : (
              <DocumentViewer
                key={shownDoc.key}
                width={'100%'}
                height={'100%'}
                documentId={shownDoc.remId}
                {...overlayClassProps(docTurn)} // RemNote copies it onto its overlay
              />
            )
          ) : editingHere ? (
            editHint
          ) : previewOpenHere ? (
            previewHint
          ) : textView ? (
            <MobileTextOutline rem={rem} plugin={plugin} showFacts={M5_FACTS} view={viewKind} />
          ) : null
        ) : editingHere ? (
          editHint
        ) : previewOpenHere ? (
          previewHint
        ) : (
          <DocumentViewer
            width={'100%'}
            height={'100%'}
            documentId={rem._id}
            {...overlayClassProps(docTurn)} // FORK (2026-11-14): open at the top; RemNote copies it onto its overlay
          />
        )}
      </div>

      {/* Metadata Section (Updates when metadata is ready) */}
      <div className={`metadata-section px-4 py-3 border-t flex-shrink-0 ${isMetadataLoading ? 'opacity-50' : ''}`}
        {...keepFocusWithRemNote} // FORK (2026-10-11)
        style={{
          borderColor: '#e5e7eb',
          backgroundColor: isMetadataLoading ? 'rgba(0,0,0,0.05)' : 'transparent',
          ...(M1_INLINE_LAYOUT ? M1_STYLES.footer : {}), // MOBILE-EXPERIMENT M1
          ...(M2_COMPACT_FOOTER ? { paddingTop: 6, paddingBottom: 6 } : {}), // MOBILE-EXPERIMENT M2
        }}
      >
        <div className={`text-xs text-gray-500 dark:text-gray-400${M2_COMPACT_FOOTER ? ' ie-m4-dim' : ''}`}>
          <div className="flex items-center gap-4 flex-wrap" style={M1_INLINE_LAYOUT ? M1_STYLES.footerRow : undefined /* MOBILE-EXPERIMENT M1 */}>
            <span>
              {isContextLoading ? 'Loading...' : (hasDocumentPowerup ? 'Document' : 'Extract')} • Incremental Rem
            </span>
            {M2_COMPACT_FOOTER ? null /* MOBILE-EXPERIMENT M2: one line on a phone */ : isMetadataLoading ? (
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
            {/* FORK (b01355e sync, Deviation 19): ✎ Edit opens RemNote's editor in a panel over
                this card (lib/extract_editor.ts) — on a phone too. The ✎ sidebar toggle that stood
                beside it was removed on 2026-11-21 (owner decision). */}
            <span style={{ marginLeft: 'auto', display: 'inline-flex', flexShrink: 0 }}>
            {showEditButton && (
              <button
                onClick={() => void toggleEditor()}
                title={
                  editingHere
                    ? 'Close the editor and show this Rem in the queue again (Ctrl+E)'
                    : 'Edit this Rem here (Ctrl+E): RemNote\'s own editor, in a panel over this card — formatting, clozes, / commands, [[ search. The queue\'s keys are off while you type; ✓ Done, Esc or Ctrl+E brings the queue view back.'
                }
                style={footerButtonStyle(editingHere)}
              >
                {editingHere ? '✓ Done' : '✎ Edit'}
              </button>
            )}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
