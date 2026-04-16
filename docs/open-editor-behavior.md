# Open Editor & Ctrl+G — behavior and changes

This document describes how **Open Editor** (answer button) and **Open Incremental Editor** (Ctrl+G) work, and summarizes the implementation changes that restored full behavior after a temporary debug-only mode (no new tabs, debug toasts).

## Intended behavior

### Link-only cards: title ends with `(OpenLink)`

If the visible title ends with **`(OpenLink)`** — **case-sensitive** (must be exactly `OpenLink` inside the parentheses; optional spaces inside the parens) — checked on front and back, including rich text so inline links do not hide the suffix — **and** at least one external `http(s)` URL is found:

- **External URLs** are still opened in new browser tabs.
- **The Rem document is not** opened (no `/document/{id}` tab on desktop, no `openRem` on mobile).

This avoids opening both the external resource and the Rem document when the card is explicitly marked as link-only.

### Title does **not** end with `(OpenLink)`

- **Only the Rem document** is opened (desktop: new tab; mobile: `openRem` after advance). Embedded or extracted **external URLs are not** opened in browser tabs.
- Advance the queue like **Next** (desktop: open document then advance; mobile: advance then `openRem`).

### Title ends with `(OpenLink)` but no external URLs were found

- Open the Rem document and advance (same as the “no `(OpenLink)`” case for tab behavior).

### URL extraction

URLs come from the Link powerup, and from traversing **`rem.text`** and **`rem.backText`**. They are used to decide **link-only** behavior: external tabs are opened **only** when the title ends with `(OpenLink)` **and** at least one URL exists; those URLs also determine when the Rem document tab is skipped.

---

## Files touched

| File | Role |
|------|------|
| `src/lib/open_editor_link_tag.ts` | `(OpenLink)` detection on front/back (case-sensitive), rich-text-safe suffix check, `extractExternalHttpUrlsFromRem`. Debug helper `toastOpenEditorLinkDebug` was **removed** once production behavior was restored. |
| `src/widgets/answer_buttons.tsx` | **Open Editor**: `openExternalLinkTabsWhenOpenLinkTagged` (URLs only if title ends with `(OpenLink)`), `openEditorAction`, `shouldSkipRemDocumentForOpenEditor`, Sat/Mon menu, tooltips. |
| `src/register/commands.ts` | **Ctrl+G**: open URL tabs only when title ends with `(OpenLink)`; same skip-doc rule and mobile/desktop ordering; PDF page history when the document is opened on desktop. |

---

## What was reverted from the debug phase

During debugging, Open Editor and Ctrl+G were reduced to **queue advance only** (and optional debug toasts when URLs existed), to avoid new tabs and to verify detection in environments where the console is often suppressed.

**Restored:** real `window.open` for URLs and documents, `openRem` on mobile, and removal of debug-only toasts from these paths.

---

## Build

After changes, `npm run build` should complete successfully (same bundle-size warnings as before may appear).
