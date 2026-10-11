// lib/keep_focus_with_remnote.ts
// FORK (2026-10-11, owner request, reproduced live): a click on a plugin surface that is not
// a control leaves keyboard focus with RemNote.
//
// Every plugin widget is a cross-origin iframe, and a click inside one moves keyboard focus
// into it. Keys pressed there reach neither RemNote's shortcuts nor the plugin's own (Opt+T,
// Opt+X, Ctrl+G, …): the SDK forwards no keys out of a plugin frame. Seen live: after a click
// on the queue body's breadcrumb row, three ArrowDowns all went into the plugin frame and none
// reached RemNote, until something else was clicked. answer_buttons has always guarded the
// answer row this way; these handlers give the other queue surfaces (the document view's
// breadcrumb row and footer, the info bar, the priority chip, the isolated card, the queue
// body's margin) the same behaviour.
//
// Content the user may want to select and copy is marked `data-ie-selectable` (the isolated
// card's content box): a press there is let through, so a drag selects as usual and its
// scrollbar and image behave natively. While text selected there is still selected, focus
// stays — copying needs it. A plain click on it still hands focus back.

import type React from 'react';

const CONTROL = 'button, [role="button"], a, input, select, textarea, [contenteditable="true"]';
const TEXT_FIELD = 'input, textarea, [contenteditable="true"]';
const SELECTABLE = '[data-ie-selectable]';

/** Blur whatever has focus in this frame and give the keyboard back to RemNote's window. */
export function handFocusBackToRemNote(): void {
  try {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    window.parent?.focus();
  } catch {
    /* cross-origin: nothing else to do */
  }
}

/** True while text is selected inside a `data-ie-selectable` element of this frame. */
function selectionInSelectable(): boolean {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) return false;
  const inSelectable = (node: Node | null) => {
    const element = node instanceof Element ? node : node?.parentElement;
    return !!element?.closest(SELECTABLE);
  };
  return inSelectable(selection.anchorNode) || inSelectable(selection.focusNode);
}

/** Spread onto a widget surface that is not itself a control: `<div {...keepFocusWithRemNote}>`. */
export const keepFocusWithRemNote = {
  // A press that is not on a control or on selectable text does not move focus into this
  // frame at all; it also drops a text selection, as a click elsewhere would.
  onMouseDown: (e: React.MouseEvent) => {
    const target = e.target as Element;
    if (target.closest(CONTROL) || target.closest(SELECTABLE)) return;
    e.preventDefault();
    window.getSelection()?.removeAllRanges();
  },
  // After any click, a control's included, hand focus back to RemNote's window — except in a
  // text field, where that would make typing impossible, and after a drag that selected text.
  // The selection decides that, not the click's target: Chrome sends the click to the common
  // ancestor of where the drag started and ended, which can lie outside the selectable box. If
  // the selection is gone a moment later (a plain click inside it), focus is handed back then.
  onClick: (e: React.MouseEvent) => {
    const target = e.target as Element;
    if (target.closest(TEXT_FIELD)) return;
    if (!target.closest(CONTROL) && selectionInSelectable()) {
      setTimeout(() => {
        if (!selectionInSelectable()) handFocusBackToRemNote();
      }, 0);
      return;
    }
    handFocusBackToRemNote();
  },
};
