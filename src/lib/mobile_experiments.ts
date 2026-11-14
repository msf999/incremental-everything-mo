// lib/mobile_experiments.ts
// MOBILE-EXPERIMENT. FORK-ONLY. Phone-only changes to the queue body, each switchable on
// its own. Checked in Chrome's emulation of RemNote's phone layout (2026-11-14); the real
// phone is the owner's to confirm, which is why they are still called experiments.
//
// The problem (owner's screenshots of 2026-08-21 and 2026-11-14): in RemNote's phone app
// the queue body stays white for some Incremental Rems. The queue body is RemNote's own
// document page, which RemNote draws in an overlay it lays over the plugin's frame (the
// SDK's DocumentViewer). On a phone that page throws for a Document ("No QueryClient
// set", from its Share / Publish popover), and RemNote leaves the overlay empty. M7 draws
// a Document with RemNote's hierarchy tree instead, which does not use that page.
// CLAUDE.md Deviation 17 has the rest.
//
// Every change for this problem:
//   - runs only in RemNote's phone and tablet apps (`isMobileApp`), so desktop and the
//     web app are untouched;
//   - can be switched off on its own in MOBILE_EXPERIMENTS;
//   - carries the tag MOBILE-EXPERIMENT.
// M3 (a delayed document request), M6 (forcing the overlay visible) and M4's ↻ Redraw
// button did not help and were removed on 2026-11-14.
// To switch them all off: set every flag in MOBILE_EXPERIMENTS to false. To remove the
// code: delete this file, components/MobileTextOutline.tsx and
// components/MobileDocumentTree.tsx, then run `tsc` and remove what it flags — each
// flagged line belongs to a block marked MOBILE-EXPERIMENT (an import, a statement, a JSX
// element or a style spread; the tag is on its first line) — and repeat until `tsc` is
// back to its baseline and `grep -rn MOBILE-EXPERIMENT src/` finds nothing.

import { RNPlugin } from '@remnote/plugin-sdk';

export const MOBILE_EXPERIMENTS = {
  /**
   * M1 — the queue body's layout as inline styles. RemNote's stylesheet does not reach
   * the plugin's frame in the phone app (confirmed on the owner's iPhone, 2026-11-14),
   * and the queue widget ships no styles of its own, so the Tailwind classes this layout
   * depends on do nothing there. RemNote then places its overlay at the top of the frame,
   * over the breadcrumb, and sizes it from a layout that grows with the overlay. The
   * inline styles give the phone the desktop geometry.
   */
  inlineLayout: true,
  /**
   * M2 — a one-line footer on phones: "Document • Incremental Rem" and nothing else. No
   * statistics pass (two or three bridge calls per descendant while RemNote is drawing
   * the document), and no "✎ Open in sidebar" button: the notes sidebar is a full-screen
   * sheet there, and it draws RemNote's document page, which stays white for a Document.
   */
  compactFooter: true,
  /**
   * M4 — a ≡ button at the start of the breadcrumb row: it shows a plain-text outline the
   * plugin draws itself, in place of RemNote's view.
   */
  textButton: true,
  /**
   * M5 — diagnostics: a small label on RemNote's overlay when RemNote left it empty or
   * never showed it (nothing while it draws normally), and a few facts about the rem at
   * the top of the ≡ text view.
   */
  diagnostics: true,
  /**
   * M7 — a Document is drawn with RemNote's hierarchy tree (the SDK's
   * RemHierarchyEditorTree) under a title line the plugin draws, instead of RemNote's
   * document page, which throws for a Document on a phone. Anything that is not a
   * Document keeps the document page, as on desktop.
   */
  documentsAsTree: true,
};

/**
 * True in RemNote's phone apps — and in its tablet apps when their user agent carries
 * RemNote's own app token (RemNote's host code detects the app by that token too). Read
 * from the user agent so it is known before the first render; the plugin's
 * isMobileDeviceKey is set later, asynchronously. RemNote does not run its web app in a
 * phone browser, so a phone user agent means the app. iPad browsers are deliberately NOT
 * matched: they report a desktop Mac user agent and run RemNote's desktop web app, which
 * these experiments must leave alone (review, 2026-10-11).
 */
export const isMobileApp: boolean = (() => {
  try {
    const ua = navigator.userAgent || '';
    return /RemNote-(IOS|Android)\//i.test(ua) || /iPhone|iPod/.test(ua) || /Android.*Mobile/i.test(ua);
  } catch {
    return false;
  }
})();

/**
 * Development only: true runs the experiments in a desktop browser so they can be
 * exercised there. Must be false in anything that ships — a production build refuses to
 * run while it is true (webpack.config.js).
 */
const RUN_ON_DESKTOP_FOR_TESTING = false;

export const mobileExperiment = (name: keyof typeof MOBILE_EXPERIMENTS): boolean =>
  MOBILE_EXPERIMENTS[name] && (isMobileApp || RUN_ON_DESKTOP_FOR_TESTING);

/**
 * The class the queue's document view asks RemNote to put on its overlay. RemNote copies
 * a fake embed's `className` prop onto the overlay element it creates, which is the only
 * handle the plugin has on RemNote's side of the queue body.
 */
export const MOBILE_DOCVIEW_CLASS = 'ie-mobile-docview';
/** M7: the hierarchy tree's overlay carries this class as well. */
export const MOBILE_TREE_CLASS = 'ie-mobile-tree';

const C = MOBILE_DOCVIEW_CLASS;

// M5: a label for the two states in which RemNote's overlay shows nothing. Both rules have
// the same specificity, (0,1,1) — `:where()` around the class — so when both match, the
// last one wins. A label waits 1.5 s before showing: an ordinary load passes through both
// states for a moment. No label and a white body means RemNote created no overlay. An
// overlay RemNote is retiring (after ≡, or when the item changes) holds 'unmounted-div'
// for about a second before it is removed; it gets no label. RemNote's Beautiful queue
// animates a leaving card with an `inert` clone, which gets no label either.
const PROBLEM_LABEL_CSS = `
.${C}::after {
  position: absolute; top: 6px; right: 6px; z-index: 2147483647;
  white-space: nowrap; pointer-events: none; visibility: visible;
  font: 600 10px/1.35 -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
  color: #ffffff; padding: 2px 6px; border-radius: 4px;
  animation: ie-mobile-docview-late 0s linear 1.5s backwards;
}
:where(.${C})[style*="visibility: hidden"]::after { content: 'IE check: RemNote never showed this view'; background: #1d4ed8; }
:where(.${C}):empty::after { content: 'IE check: view EMPTY, RemNote stopped drawing'; background: #b91c1c; }
:where(.${C}):has(> .unmounted-div)::after { display: none; }
[inert] .${C}::after { display: none; }
@keyframes ie-mobile-docview-late { from { visibility: hidden; } }
`;

// An overlay RemNote is retiring (after ≡ or a 🔄 swap) keeps its inline
// pointer-events: all for about a second; without this, the first taps on the ≡ Text
// view or on the next overlay land on that invisible element and do nothing.
const RETIRING_OVERLAY_CSS = `.${C}:has(> .unmounted-div) { pointer-events: none !important; }`;

// M7: RemNote sizes the tree's overlay to the plugin's placeholder and lets what does not
// fit spill out of it; this makes the overlay scroll instead, and keeps the scroll from
// moving the queue page behind it.
const TREE_SCROLL_CSS = `.${MOBILE_TREE_CLASS} { overflow-x: hidden !important; overflow-y: auto !important; -webkit-overflow-scrolling: touch; overscroll-behavior: contain; }`;

/** Registered by the index widget at startup; does nothing outside the phone app. */
export async function registerMobileExperimentCss(plugin: RNPlugin): Promise<void> {
  const parts: string[] = [];
  if (mobileExperiment('diagnostics')) parts.push(PROBLEM_LABEL_CSS);
  if (tagMobileDocumentOverlay()) parts.push(RETIRING_OVERLAY_CSS);
  if (mobileExperiment('documentsAsTree')) parts.push(TREE_SCROLL_CSS);
  if (parts.length > 0) await plugin.app.registerCSS('ie-mobile-docview', parts.join('\n'));
}

/** The queue's document view is tagged only when a rule above can use the tag. */
export const tagMobileDocumentOverlay = (): boolean =>
  mobileExperiment('diagnostics') || mobileExperiment('textButton') || mobileExperiment('documentsAsTree');
