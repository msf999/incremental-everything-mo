// lib/mobile_experiments.ts
// MOBILE-EXPERIMENT (2026-10-10). FORK-ONLY. Written without a phone: none of this has
// run on a device yet, which is why every part can be switched off on its own.
//
// The problem (owner's screenshots of 2026-08-21, build 1.0.44): in the RemNote phone
// app some Incremental Rems show their document in the queue body and others a white
// page. The queue body is RemNote's own document page, which RemNote draws in an
// overlay it lays over the plugin's frame (the SDK's DocumentViewer). On the white page
// RemNote drew nothing at all — not even the phone page header it draws for every
// document it shows. Why it draws nothing for some rems is not known; CLAUDE.md
// Deviation 17 lists the candidates and what each experiment is meant to show or fix.
//
// Every change for this problem:
//   - runs only in RemNote's phone and tablet apps (`isMobileApp`), so desktop and the
//     web app are untouched;
//   - can be switched off on its own in MOBILE_EXPERIMENTS;
//   - carries the tag MOBILE-EXPERIMENT.
// To switch them all off: set every flag in MOBILE_EXPERIMENTS to false. To remove the
// code: delete this file and components/MobileTextOutline.tsx, then run `tsc` and remove
// what it flags — each flagged line belongs to a block marked MOBILE-EXPERIMENT (an
// import, a statement, a JSX element or a style spread; the tag is on its first line) —
// and repeat until `tsc` is back to its baseline and `grep -rn MOBILE-EXPERIMENT src/`
// finds nothing. Tried on a copy on 2026-10-11: two rounds reach every use.

import { RNPlugin } from '@remnote/plugin-sdk';

export const MOBILE_EXPERIMENTS = {
  /**
   * M1 — the queue body's layout as inline styles. RemNote's stylesheet does not reach
   * the plugin's frame in the phone app (the screenshots show the breadcrumb unstyled:
   * large black text at the very top), and the queue widget ships no styles of its own,
   * so the Tailwind classes this layout depends on do nothing there. RemNote then places
   * its overlay at the top of the frame, over the breadcrumb, and sizes it from a layout
   * that grows with the overlay. The inline styles give the phone the desktop geometry.
   */
  inlineLayout: true,
  /**
   * M2 — no statistics pass on phones. It makes two or three bridge calls per descendant
   * while RemNote is drawing the document, and its footer is hidden behind the answer
   * buttons there anyway.
   */
  skipStatistics: true,
  /**
   * M3 — ask RemNote for the document only once the queue body has its final size, plus
   * 250 ms (upstream's own delay for the PDF reader on iPhone, commit 13002e3); never
   * later than 1.5 s.
   */
  delayDocument: true,
  /**
   * M4 — two buttons at the start of the breadcrumb row: ↻ asks RemNote to draw the
   * document again (a new overlay), ≡ shows a plain-text outline the plugin draws itself.
   */
  redrawAndTextButtons: true,
  /**
   * M5 — diagnostics: a small label on RemNote's overlay naming what RemNote drew in it
   * ("document drawn" fades to faint after a few seconds; no label at all means RemNote
   * created no overlay), and a few facts about the rem at the top of the ≡ text view.
   */
  diagnostics: true,
  /**
   * M6 — show RemNote's overlay even if RemNote never revealed it: RemNote keeps a new
   * overlay invisible until it has measured it once.
   */
  revealOverlay: true,
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
 * M5/M6: the class the queue's DocumentViewer asks RemNote to put on its overlay. RemNote
 * copies a fake embed's `className` prop onto the overlay element it creates, which is
 * the only handle the plugin has on RemNote's side of the queue body.
 */
export const MOBILE_DOCVIEW_CLASS = 'ie-mobile-docview';

const C = MOBILE_DOCVIEW_CLASS;

// M5: one label per state RemNote's page can be in. Each label rule below has the same
// specificity, (0,1,1) — `:where()` around the class, and inside `:has()` around any
// second class — so when several match, the LAST one wins: the most basic failures come
// last. Markers are RemNote's own: .rn-document is its normal page; the loading skeleton;
// the "document not found" container; [data-native-document-id], a source page (PDF, web
// page, video, audio, shared content — and drawings); the page container RemNote keeps
// `hidden` until its editor has loaded. No label at all means RemNote created no overlay.
// Failure labels wait 1.5 s before showing (one shared animation name, so moving between
// failure states does not restart the wait): an ordinary load passes through "no page
// yet" and "page hidden" for a moment. "Document drawn" fades to faint but stays, so a
// later screenshot of a drawn-but-blank page still says so. An overlay RemNote is
// retiring (after ↻ / ≡, or when the item changes) holds 'unmounted-div' for about a
// second before it is removed; it gets no label. RemNote's Beautiful queue animates a
// leaving card with an `inert` clone, which gets no label either.
const PROBE_CSS = `
.${C}::after {
  content: 'IE check: no document page drawn (yet)';
  position: absolute; top: 6px; right: 6px; z-index: 2147483647;
  white-space: nowrap; pointer-events: none; visibility: visible;
  font: 600 10px/1.35 -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
  color: #ffffff; background: #334155; padding: 2px 6px; border-radius: 4px;
  animation: ie-mobile-docview-late 0s linear 1.5s backwards;
}
:where(.${C}):has(.rn-document)::after {
  content: 'IE check: document drawn'; background: #15803d;
  animation: ie-mobile-docview-fade 0.5s ease 6s forwards;
}
:where(.${C}):has([data-cy="doc-loading-skeleton"])::after { content: 'IE check: RemNote is still loading'; background: #a16207; animation: ie-mobile-docview-late 0s linear 1.5s backwards; }
:where(.${C}):has([data-native-document-id])::after { content: 'IE check: RemNote shows a source page (PDF, link, media or drawing), not the outline'; background: #7c3aed; animation: ie-mobile-docview-late 0s linear 1.5s backwards; }
:where(.${C}):has([data-test="Document force sync container"])::after { content: 'IE check: RemNote cannot find this document'; background: #b91c1c; animation: ie-mobile-docview-late 0s linear 1.5s backwards; }
:where(.${C}):has(.document-inner-container:where(.hidden))::after { content: 'IE check: page hidden, RemNote editor not loaded (yet)'; background: #c2410c; animation: ie-mobile-docview-late 0s linear 1.5s backwards; }
:where(.${C})[style*="visibility: hidden"]::after { content: 'IE check: RemNote never showed this overlay'; background: #1d4ed8; animation: ie-mobile-docview-late 0s linear 1.5s backwards; }
:where(.${C}):empty::after { content: 'IE check: overlay EMPTY, RemNote stopped drawing'; background: #b91c1c; animation: ie-mobile-docview-late 0s linear 1.5s backwards; }
:where(.${C}):has(> .unmounted-div)::after { display: none; }
[inert] .${C}::after { display: none; }
@keyframes ie-mobile-docview-fade { to { opacity: 0.35; } }
@keyframes ie-mobile-docview-late { from { visibility: hidden; } }
`;

// M6: RemNote sets visibility: hidden inline on a new overlay and lifts it from the first
// size report of its own ResizeObserver; a stylesheet !important outranks the inline value.
const REVEAL_CSS = `.${C} { visibility: visible !important; }`;

// An overlay RemNote is retiring (after ↻ / ≡ / a 🔄 swap) keeps its inline
// pointer-events: all for about a second; without this, the first taps on the ≡ Text
// view or on the next overlay land on that invisible element and do nothing.
const RETIRING_OVERLAY_CSS = `.${C}:has(> .unmounted-div) { pointer-events: none !important; }`;

/** Registered by the index widget at startup; does nothing outside the phone app. */
export async function registerMobileExperimentCss(plugin: RNPlugin): Promise<void> {
  const parts: string[] = [];
  if (mobileExperiment('diagnostics')) parts.push(PROBE_CSS);
  if (mobileExperiment('revealOverlay')) parts.push(REVEAL_CSS);
  if (tagMobileDocumentOverlay()) parts.push(RETIRING_OVERLAY_CSS);
  if (parts.length > 0) await plugin.app.registerCSS('ie-mobile-docview', parts.join('\n'));
}

/** The queue's DocumentViewer is tagged only when a rule above can use the tag. */
export const tagMobileDocumentOverlay = (): boolean =>
  mobileExperiment('diagnostics') || mobileExperiment('revealOverlay') || mobileExperiment('redrawAndTextButtons');
