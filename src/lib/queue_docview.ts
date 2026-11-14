// lib/queue_docview.ts
// FORK-ONLY (2026-11-14).
//
// Two rules for the document RemNote draws in the queue body (the SDK's DocumentViewer, in an
// overlay over the plugin's frame). The plugin cannot reach that page — it is RemNote's, in
// another origin — and the SDK has no call that scrolls it or moves the caret in it. What the
// plugin can do is give the overlay a class name and register a stylesheet in RemNote's page.
//
// 1. IT OPENS AT ITS TOP (owner request: "the scrollbar should be at the top always").
//
//    RemNote remembers how far each document was last scrolled, and puts it back there about a
//    third of a second after the document is drawn — also in the page a plugin embeds. So a
//    document once read to the middle, in the editor or in an earlier queue session, came up in
//    the queue at the middle, with its name out of sight. Reproduced live: scrolled to 700 px in
//    the editor, then shown in a new queue card — top 0 for 320 ms, then 700.
//
//    The rule: for the first moments after a document is drawn, its content is held to the
//    height of the visible area. Nothing overflows, so there is nothing to scroll — RemNote's
//    "put it back" lands on a position that does not exist and is dropped. Then the hold is
//    lifted, with the view at the top. The first screenful is visible throughout; only scrolling
//    further waits for that moment.
//
//    The hold is a CSS animation, which runs once per element. RemNote reuses the element when
//    the plugin shows another rem in the same view (🔄 Another item), so the class alternates
//    between two names whose animations differ only in name: a new name starts a new run.
//
// 2. IT IS NOT TYPED INTO (owner report: typing "a" or a space skipped the item; then, after the
//    cause was found: "make it not possible to type in the document at all while it is being
//    shown in the queue").
//
//    RemNote's queue acts on its own keys — the answer keys, Skip, the arrow keys — whenever its
//    focus bookkeeping says no text editor is focused, and a click into a document that a plugin
//    embeds in the queue is not entered in that bookkeeping (read from RemNote 1.30's code: the
//    dispatcher's filter asks `getFocusedElementId()` for a RichTextEditor). So with the caret in
//    a bullet of the item, H skipped the item, so did the right arrow, and J was swallowed;
//    whoever has letters bound to answers rates or skips with ordinary typing. The title is worse
//    still: there every key is refused. Reproduced live in both queue layouts. The plugin runs
//    sandboxed: it cannot listen to keys in RemNote's page or set that focus, and the SDK's
//    stealKeys blocks a key everywhere (omnibar and sidebar included) without typing it.
//
//    The rule: in the queue view nothing takes the caret — `-webkit-user-modify: read-only` on
//    every editable element of the overlay — so a key can never be half-typed, half-shortcut.
//    Text can still be selected (extracts), links and checkboxes still work. The empty space under
//    a document, which adds a bullet on click, takes no clicks. Writing happens where RemNote
//    does track the focus: the notes sidebar (✎ Open in sidebar) and the preview popup (Ctrl+P,
//    widgets/inc_rem_preview.tsx), both verified with the same keys. Not in RemNote's phone and
//    tablet apps (lib/mobile_experiments.ts, `isMobileApp`): the queue view there has no sidebar
//    button and no Ctrl+P, so it is the one place to write, and it was not part of this.
//
// Both rules also go on the page of a RemNote video Rem in the queue (components/
// NativeVideoViewer.tsx; owner decision 2026-11-15, "the same should apply"). On RemNote 1.30 that
// page is RemNote's Learn Video page — player, outline, flashcard buttons — with nothing editable
// and no `.document-inner-container`, and it opens at its top by itself; the classes are there for
// when RemNote changes it.

import type { RNPlugin } from '@remnote/plugin-sdk';

/** On the overlay of the queue's document view. */
export const QUEUE_DOCVIEW_CLASS = 'ie-queue-docview';

/**
 * How long the content is held. RemNote's restore was measured 270–320 ms after the document
 * appeared; this leaves room for a slow load without being long enough to notice.
 */
const HOLD_MS = 900;

/** Added to the overlay where rule 2 applies (everywhere but in RemNote's phone and tablet apps). */
export const QUEUE_DOCVIEW_READONLY_CLASS = 'ie-queue-readonly';

/**
 * The class names for the nth document shown in one view (see rule 1 for the two names).
 * `readOnly`: rule 2.
 */
export const queueDocviewClassName = (turn: number, readOnly: boolean): string =>
  `${QUEUE_DOCVIEW_CLASS} ${turn % 2 === 0 ? 'ie-top-a' : 'ie-top-b'}` +
  (readOnly ? ` ${QUEUE_DOCVIEW_READONLY_CLASS}` : '');

const hold = (name: string) =>
  `@keyframes ie-open-at-top-${name} { from { max-height: 100%; } to { max-height: 100%; } }\n` +
  `.${QUEUE_DOCVIEW_CLASS}.ie-top-${name} .document-inner-container { animation: ie-open-at-top-${name} ${HOLD_MS}ms steps(1, end); }`;

const OPEN_AT_TOP_CSS = `${hold('a')}\n${hold('b')}`;

const READ_ONLY_CSS =
  `.${QUEUE_DOCVIEW_READONLY_CLASS} [contenteditable="true"] { -webkit-user-modify: read-only !important; }\n` +
  `.${QUEUE_DOCVIEW_READONLY_CLASS} .rn-add-rem-button { pointer-events: none !important; }`;

/** Registers the stylesheet in RemNote's page. Call once, from the index widget. */
export async function registerQueueDocviewCss(plugin: RNPlugin): Promise<void> {
  await plugin.app.registerCSS('ie-queue-docview', `${OPEN_AT_TOP_CSS}\n${READ_ONLY_CSS}`);
}
