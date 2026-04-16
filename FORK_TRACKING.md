# Fork Tracking: incremental-everything-mo

> **Purpose:** This document is the single source of truth for all custom modifications made to this fork. It is designed to be read and updated by an AI assistant when merging upstream changes or making new edits.

---

## AI System Instructions

When working on this repository, follow these rules in order:

### Before Any Merge or Edit

1. **Read this file first.** Parse every section. The "Current Deviations" section is your conflict map.
2. **Identify the upstream base.** The last known upstream commit is recorded in the "Upstream Sync Status" section below. Compare against it to understand what is new upstream.
3. **Never overwrite custom code blindly.** If an upstream change touches a file listed in "Current Deviations," perform a manual three-way inspection: read the upstream diff, read our custom code, and reconcile intentionally.

### During a Merge

4. **Preserve `manifest.json` overrides.** Our fork uses a different `repoUrl` and sets `unlisted: true`. Any upstream change to `manifest.json` must keep these two fields as-is.
5. **Preserve additive custom code.** Our changes are designed to be additive (new constants, new slots, new helper functions, new branches in existing functions). Upstream refactors that rename or move the functions we hook into require manual adaptation -- do not auto-resolve.
6. **Test compilation.** After resolving conflicts, run `npm run dev` and confirm webpack compiles successfully before committing.

### After Any Merge or Edit

7. **Update "Upstream Sync Status"** with the new upstream commit hash.
8. **Update "Current Deviations"** if files or regions changed.
9. **Append a changelog entry** using the template in "Logging Protocol."

---

## Upstream Sync Status

| Field | Value |
|---|---|
| **Upstream repo** | `https://github.com/bjsi/incremental-everything` (via `hugomarins` fork) |
| **Our fork** | `https://github.com/msf999/incremental-everything-mo` |
| **Last synced upstream commit** | `7e0bc0d` — _Merge pull request #271 from hugomarins/main_ |
| **Our first custom commit** | `88839e1` — _feat: add Rotation and First Added properties, make Open Editor advance queue_ |
| **Branch** | `main` |

---

## Current Deviations

All custom changes are **additive** unless noted otherwise. No upstream logic was deleted or rewritten.

### 1. `public/manifest.json`

| Field | Upstream Value | Our Value | Reason |
|---|---|---|---|
| `repoUrl` | `https://github.com/bjsi/incremental-everything` | `https://github.com/msf999/incremental-everything-mo` | Points to our fork |
| `unlisted` | `false` | `true` | Prevents public listing of our private fork |

**Merge rule:** Always keep our values for these two fields. Accept all other manifest changes from upstream.

### 2. `src/lib/consts.ts`

**What changed:** Added two new export constants after `originalIncrementalDateSlotCode`:

```
firstAddedSlotCode = 'firstAdded'
rotationSlotCode  = 'rotation'
```

**Merge rule:** Pure addition at the end of the powerup constants block. No conflict expected unless upstream adds identically named constants.

### 3. `src/register/powerups.tsx`

**What changed:**

- Added imports for `firstAddedSlotCode` and `rotationSlotCode`.
- Added two new slot entries to the Incremental powerup registration:
  - `firstAdded` — `PropertyType.DATE`, visible (`PropertyLocation.BELOW`).
  - `rotation` — `PropertyType.TEXT`, visible (`PropertyLocation.BELOW`).

**Merge rule:** Our slots are appended to the end of the existing `slots` array. If upstream adds new slots in the same array, ensure ours remain at the end. If upstream changes the `registerPowerup` call signature, adapt our additions to match.

### 3.1. `src/register/commands.ts`

**What changed:** Added `open-incremental-editor` macro bound to `Ctrl+G` that replicates the AnswerButtons "Open Editor" behavior from the keyboard. External `http(s)` tabs open **only** when the visible title ends with **`(OpenLink)`** (case-sensitive; see `open_editor_link_tag.ts`). If `(OpenLink)` **and** at least one extracted URL: open those URL tab(s) only and **do not** open `remnote.com/document/...` or in-app `openRem`. If the title does **not** end with `(OpenLink)`: open **only** the Rem document (then advance); extracted URLs are not opened in browser tabs.

**Merge rule:** Retain the `open-incremental-editor` command registration, `remTitleEndsWithOpenLinkTag`, and the guarded URL-opening + skip-doc logic.

### 4. `src/lib/incremental_rem/types.ts`

**What changed:** Added `rotation: z.string().optional()` to the `IncrementalRem` Zod schema. Upstream also added optional `createdAt` (ms) for when the Rem was first made Incremental; both fields are kept.

**Merge rule:** Preserve both `rotation` and `createdAt` when merging schema changes.

### 5. `src/lib/incremental_rem/index.ts`

This file has the most custom code. All additions are in clearly separated blocks.

| Region | What Changed |
|---|---|
| **Imports** | Added `firstAddedSlotCode`, `rotationSlotCode` from consts; added `import parseDuration from 'parse-duration'`. Also imports `addCreationToIncrementalHistory` from `history_utils` (with upstream). |
| **`getIncrementalRemFromRem()`** | After priority reading, reads `rotation` into `rawData`; also reads `createdAt` from `originalIncrementalDateSlotCode` (upstream) into `rawData`. |
| **New helpers (before `initIncrementalRem`)** | Added `getRotationIntervalMs()`, `getRotationIntervalDays()`, `getInitialRotation()`, and `rescheduleWithoutReview()`. These are standalone functions — no upstream code was modified. |
| **`initIncrementalRem()`** | After `setPowerupProperty(prioritySlotCode, ...)`, added two blocks: (a) set `firstAddedSlotCode` to today's daily doc ref, (b) inherit rotation from closest ancestor via `getInitialRotation()` and set as text. When setting `originalIncrementalDateSlotCode`, also calls `addCreationToIncrementalHistory` (upstream). |
| **`handleNextRepetitionClick()` / `handleNextRepetitionManualOffset()`** | Use manual in-memory `IncrementalRem` patch + `updateIncrementalRemCache` from review result / constructed state (upstream) instead of re-fetching from the Rem after write. |
| **`updateReviewRemData()`** | Branching `nextRepDateToUse`: explicit overrides, then rotation interval (`getRotationIntervalMs`), then normal scheduler. Returns `{ ...nextSpacing, newNextRepDate: nextRepDateToUse, newHistory }` so callers patch the cache with the **persisted** next date (required when rotation overrides the scheduler). |

**Merge rule:** If upstream modifies `getIncrementalRemFromRem`, `initIncrementalRem`, or `updateReviewRemData`, carefully re-apply our additions into the updated function bodies. Our helpers (`getRotationIntervalMs`, `getRotationIntervalDays`, `getInitialRotation`, `rescheduleWithoutReview`) are freestanding and should not conflict.

### 6. `src/widgets/answer_buttons.tsx`

This file has grown into the most heavily customised widget. All changes are additive or replace upstream UI elements with improved alternatives.

| Region | What Changed |
|---|---|
| **Imports** | Added `getRotationIntervalMs`, `rescheduleWithoutReview` from `../lib/incremental_rem`; replaced `DraggableButton` import with `SplitButton`. |
| **`hasInvalidRotation` + `warningStyle`** | Derived boolean + amber style object computed after `incRemInfo` is destructured. Applied to the Next and Open Editor buttons when the rotation value cannot be parsed. |
| **Next button** | Replaced `DraggableButton` (drag-up/down gesture) with `SplitButton` (dropdown chevron). Menu items: "Saturday (Xd)", "Monday (Xd)" with dynamic day counts. When `hasInvalidRotation` is true, the sublabel shows `"invalid rotation"` in amber instead of `<NextRepTime />`. |
| **`openEditorAction` helper** | Extracted editor-opening logic (mobile in-app nav vs desktop new tab) into a reusable async function, used by the main click and dropdown items. |
| **Open Editor button** | Converted from `Button` to `SplitButton`. On mobile (`isMobile`), calls `plugin.window.openRem(rem)` for in-app navigation instead of `window.open()`. Scheduling runs **before** navigation so the widget is not destroyed before the review is recorded. Dropdown items: "Saturday (Xd)", "Monday (Xd)" — each records a review with the chosen offset then opens the editor. Also receives `warningStyle` when rotation is invalid. |
| **Skip button** | Converted from `Button` to `SplitButton`. Main click calls `plugin.queue.removeCurrentCardFromQueue()` (advances queue without recording a review). Dropdown items: "Saturday (Xd)", "Monday (Xd)" — each reschedules to the chosen date without recording a review via `rescheduleWithoutReview`. |
| **Unified layout (Accordion)** | Removed all `!isMobile` conditional rendering guards. Consolidated the top row into a minimalist 6-button layout: Previous, Next, Open Editor, Skip, Dismiss, and `⚙️ Options`. Built a dynamic `showAdvancedOptions` local state variable. Clicking `⚙️ Options` opens a visually clean secondary row positioned underneath to host the power-user buttons: Reschedule, Change Priority, Review in Editor, Scroll to Highlight, **Scroll to Bookmark** (PDF: last page-history entry with `highlightId`; upstream feature merged into this row), URL clipping, and Help. |
| **Link Auto-Open (guarded)** | Added `externalUrls` via `useTrackerPlugin` (extract from `rem.text`, `rem.backText`, Link powerup). `openExternalLinkTabsWhenOpenLinkTagged()` runs **first** on Open Editor clicks (sync `window.open` while the gesture is valid) but **only** when the title ends with **`(OpenLink)`**. If the title does **not** end with `(OpenLink)`, only the Rem document opens — external URLs are not opened in new tabs. |
| **Title `(OpenLink)` → external tabs, no Rem doc** | `remTitleEndsWithOpenLinkTag` (`open_editor_link_tag.ts`) **and** non-empty `externalUrls`: `performOpenEditorFlow` skips `openEditorAction` so only external URL(s) open (one tab per URL). If the title has `(OpenLink)` but no URL was extracted, the Rem document still opens. Saturday/Monday dropdown paths use the same rules. |

**Merge rule:** If upstream modifies the answer buttons layout, the Next button component, the Open Editor button, or the Skip area, re-apply our changes: (0) Previous button via `goBackToPreviousCard()`, (1) SplitButton with Saturday/Monday dropdown on Next, Open Editor, and Skip, (2) mobile branch in Open Editor via `openEditorAction`, (3) `hasInvalidRotation` warning on Next + Open Editor, (4) `rescheduleWithoutReview` for Skip dropdown items, (5) accordion-style toggle logic for the power-user button array (`showAdvancedOptions` state block), (6) inject `openExternalLinkTabsWhenOpenLinkTagged()` at the start of Open Editor click handlers (URLs only when `(OpenLink)`), (7) skip `openEditorAction` when the title ends with `(OpenLink)` and `externalUrls` is non-empty.

### 6.1. `src/lib/open_editor_link_tag.ts` *(new file)*

**What changed:** Shared `remTitleEndsWithOpenLinkTag()` helper: checks **front and back** (`rem.text` / `rem.backText`). First walks rich text with `richTextVisibleForLinkSuffix()` (strings + `.text` + nested arrays; **does not** append raw `url` so hyperlinked titles like `Article (OpenLink)` still match), then falls back to `safeRemTextToString` + regex **`/\(\s*OpenLink\s*\)\s*$/`** (**case-sensitive** — must be exactly `OpenLink` inside the parens). Also exports `extractExternalHttpUrlsFromRem()` (scans front + back). Used by answer buttons and `Ctrl+G`.

### 6.2. `docs/open-editor-behavior.md` *(new file)*

**What changed:** Human-readable description of Open Editor / Ctrl+G behavior (including `(OpenLink)` rules and URL vs document tab policy).

**Merge rule:** Keep in sync when editing open-editor flow.

### 7. `src/components/buttons/SplitButton.tsx` *(new file)*

**What changed:** New component that renders a split button — main click area on the left, small chevron on the right that opens a dropdown menu. Used by the Next, Open Editor, and Skip buttons. Replaces the upstream `DraggableButton` pattern. Added an iframe sandbox padding hack in the `useEffect` (`document.body.style.paddingBottom = '150px'`) whenever the menu toggles open to proactively expand the RemNote plugin boundary, gracefully preventing native clipping since it renders downward as a `position: absolute` popover.

**Merge rule:** Freestanding new file. No conflict expected. If upstream introduces its own split-button or dropdown component, consider consolidating, but ensure any absolute-positioned dropdown injects dynamic body padding to survive iframe clipping.

### 8. `src/components/NextRepTime.tsx`

**What changed:** Before falling through to the SRS scheduler (`getNextSpacingDateForRem`), the component now checks for a rotation value via `getRotationIntervalMs`. If a valid rotation is set, it displays `Date.now() + rotationMs` instead of the scheduler result. Added `props.rem.rotation` to the `useEffect` dependency array.

**Merge rule:** If upstream modifies `NextRepTime`, re-apply the rotation check at the top of the `useEffect` callback and add `props.rem.rotation` to the dependency array.

### 9. `package.json` / `package-lock.json`

**What changed:** Added `parse-duration` as a runtime dependency.

**Merge rule:** After any upstream merge that touches dependencies, verify `parse-duration` is still present. Run `npm install` to regenerate the lock file.

---

## Logging Protocol

When recording a merge or edit, append an entry to the "Changelog" section below using this exact template:

```markdown
### YYYY-MM-DD — [TYPE: Merge | Edit | Fix | Refactor]

**Upstream commit(s):** `<hash>` to `<hash>` (or "N/A" for local edits)
**Conflicts resolved:** [list files, or "None"]
**Custom code preserved:** [Yes / Adapted — explain]
**Compilation verified:** [Yes / No — explain]
**Files touched:**
- `path/to/file` — description of change

**Notes:** Free-form context for future reference.
```

---

## Changelog

### 2026-04-07 — Merge (initial upstream sync)

**Upstream commit(s):** up to `da4b9d2`
**Conflicts resolved:** None (clean fork point)
**Custom code preserved:** N/A (no custom code yet)
**Compilation verified:** Yes
**Files touched:**
- All files inherited from upstream as-is

**Notes:** Fork created from hugomarins/incremental-everything at commit `da4b9d2`.

---

### 2026-04-07 — Edit (Rotation, First Added, Open Editor advancement)

**Upstream commit(s):** N/A (local feature)
**Conflicts resolved:** None
**Custom code preserved:** Yes
**Compilation verified:** Yes
**Files touched:**
- `src/lib/consts.ts` — added `firstAddedSlotCode`, `rotationSlotCode`
- `src/register/powerups.tsx` — added First Added (DATE) and Rotation (TEXT) slots to Incremental powerup
- `src/lib/incremental_rem/types.ts` — added `rotation` field to `IncrementalRem` schema
- `src/lib/incremental_rem/index.ts` — added rotation reading in `getIncrementalRemFromRem`; added `getRotationIntervalMs`, `getRotationIntervalDays`, `getInitialRotation` helpers; added First Added + Rotation init in `initIncrementalRem`; added rotation-aware scheduling in `updateReviewRemData`
- `src/widgets/answer_buttons.tsx` — Open Editor New Tab button now also calls `handleNextClick()` to advance queue
- `public/manifest.json` — set `repoUrl` to fork, `unlisted: true`
- `package.json` — added `parse-duration` dependency

**Notes:** Rotation was initially implemented as `SINGLE_SELECT` but switched to `TEXT` with `parse-duration` because RemNote's SINGLE_SELECT does not propagate inherited values to child Rem. The TEXT approach accepts any human-readable duration string (e.g. "5 days", "2 weeks", "6 months", "4.5w").

---

### 2026-04-11 — Fix (Next button showing wrong interval for rotation items)

**Upstream commit(s):** N/A (local fix)
**Conflicts resolved:** None
**Custom code preserved:** Yes
**Compilation verified:** Yes
**Files touched:**
- `src/components/NextRepTime.tsx` — check for rotation value before falling through to SRS scheduler; display rotation interval instead when set

**Notes:** The Next button sublabel was always showing the SRS-computed interval (e.g. "in 20 days") even when a Rotation like "2 days" was active, because `NextRepTime` only called `getNextSpacingDateForRem` and had no rotation awareness.

---

### 2026-04-11 — Edit (Mobile Open Editor, Skip button, Split button, Invalid rotation warning)

**Upstream commit(s):** N/A (local features)
**Conflicts resolved:** None
**Custom code preserved:** Yes
**Compilation verified:** Yes
**Files touched:**
- `src/widgets/answer_buttons.tsx` — (1) Open Editor uses `plugin.window.openRem()` on mobile instead of new tab; (2) replaced "P Edit" badge with functional Skip button; (3) replaced `DraggableButton` with `SplitButton` dropdown for Next; (4) added `hasInvalidRotation` detection and amber warning style on Next + Open Editor buttons
- `src/components/buttons/SplitButton.tsx` — new component: split button with dropdown chevron menu, replaces the drag-gesture `DraggableButton`

**Notes:** Four related UX improvements bundled together. The drag-up/drag-down gesture on the Next button was not discoverable; the split-button dropdown makes "Repeat today/tomorrow" visible. The P Edit badge occupied space without function; replaced with a Skip button that advances the queue without rescheduling. Mobile users get in-app navigation instead of a broken new-tab attempt. Invalid rotation values now produce a clear visual warning rather than silently falling back to the default scheduler.

---

### 2026-04-11 — Merge (upstream sync to `8144672`)

**Upstream commit(s):** `da4b9d2` to `8144672` (PR #258 through PR #262)
**Conflicts resolved:** None (all four overlapping files auto-merged cleanly)
**Custom code preserved:** Yes
**Compilation verified:** Yes (only pre-existing TS errors, no new ones)
**Files touched:**
- `public/manifest.json` — patch version bumped from 159 to 167 upstream; our `repoUrl` and `unlisted` overrides preserved
- `src/lib/consts.ts` — upstream added `incRemCacheReloadKey`, `displayQueueToolbarPriorityId`, weighted shield keys, `pendingIntervalBatchSaveKey`; our constants untouched
- `src/lib/incremental_rem/index.ts` — upstream added `skipFlagManagement` option and cache reload trigger to `initIncrementalRem`; our rotation/firstAdded additions in different regions, merged cleanly
- `src/widgets/answer_buttons.tsx` — upstream added weighted shield feature (new imports, hook, calculation, display); our SplitButton/Skip/mobile/warning changes in different regions, merged cleanly
- 25 other files added or modified by upstream (new widgets, PDF improvements, batch operations, etc.)

**Notes:** Clean merge with zero manual intervention. Upstream added significant features: weighted priority shield, queue toolbar priority display, PDF page range improvements, batch priority/interval updates, and various refactors. None overlapped with our custom code regions.

---

### 2026-04-11 — Edit (Next dropdown options changed to Saturday/Monday)

**Upstream commit(s):** N/A (local edit)
**Conflicts resolved:** None
**Custom code preserved:** Yes
**Compilation verified:** Yes
**Files touched:**
- `src/widgets/answer_buttons.tsx` — replaced "Repeat today"/"Repeat tomorrow" dropdown items with "Saturday (Xd)"/"Monday (Xd)" showing dynamic day counts; simplified `runManualNext` to accept a numeric offset directly

**Notes:** Saturday and Monday provide more practical scheduling landmarks than today/tomorrow. Day counts are computed dynamically using `dayjs().day()` so the labels always show the correct number of days until the next occurrence.

---

### 2026-04-11 — Edit (Saturday/Monday dropdowns on Open Editor and Skip)

**Upstream commit(s):** N/A (local edit)
**Conflicts resolved:** None
**Custom code preserved:** Yes
**Compilation verified:** Yes
**Files touched:**
- `src/lib/incremental_rem/index.ts` — added `rescheduleWithoutReview()` helper: sets next rep date without recording a history entry
- `src/widgets/answer_buttons.tsx` — converted Open Editor and Skip from `Button` to `SplitButton` with Saturday/Monday dropdown items; extracted `openEditorAction` helper for reuse across main click and dropdown items

**Notes:** Open Editor dropdown items open the editor then record a review with the chosen offset (same as Next). Skip dropdown items reschedule to the chosen date without recording a review, using the new `rescheduleWithoutReview` helper. All three action buttons (Next, Open Editor, Skip) now share consistent Saturday/Monday dropdown options.

---

### 2026-04-11 — Fix (Open Editor not rescheduling on mobile)

**Upstream commit(s):** N/A (local fix)
**Conflicts resolved:** None
**Custom code preserved:** Yes
**Compilation verified:** Yes
**Files touched:**
- `src/widgets/answer_buttons.tsx` — reversed the order of operations in Open Editor: schedule/review runs before navigation so the widget is not destroyed before the review completes

**Notes:** On mobile, `plugin.window.openRem()` navigates away from the queue and destroys the widget sandbox. If the editor opened first, `handleNextClick()` never ran. Fixed by scheduling first, then navigating. Desktop behavior is unaffected since `window.open()` does not destroy the widget.

---

### 2026-04-11 — Edit (Hide secondary buttons on mobile)

**Upstream commit(s):** N/A (local edit)
**Conflicts resolved:** None
**Custom code preserved:** Yes
**Compilation verified:** Yes
**Files touched:**
- `src/widgets/answer_buttons.tsx` — wrapped Reschedule, Change Priority, Review in Editor, and help icon in `!isMobile` guards to hide them on mobile

**Notes:** Mobile queue was too crowded with all buttons visible. Reduced to four essential actions: Next, Dismiss, Open Editor, Skip. The hidden buttons are desktop power-user features with keyboard shortcuts and are less useful on a phone.

---

### 2026-04-14 — Edit (Auto-open external URLs when advancing queue)

**Upstream commit(s):** N/A (local feature)
**Conflicts resolved:** None
**Custom code preserved:** Yes
**Compilation verified:** Yes
**Files touched:**
- `src/widgets/answer_buttons.tsx` — added `openExtractedUrls` helper function to parse `rem.text` looking for strings matching `http*` or `node.url` string components; injected call into `handleNextClick` and `runManualNext`. Filters out `remnote.com` internal dashboard links.

**Notes:** **Superseded in behavior** by **2026-04-16 — Fix / Edit (Open Editor / Ctrl+G: `(OpenLink)` suffix and tab policy)**. URL extraction and where it is invoked evolved; see Current Deviations and that entry for when external tabs open today.

### 2026-04-14 — Fix (Open Editor blocked by popup blockers)

**Upstream commit(s):** N/A (local fix)
**Conflicts resolved:** None
**Custom code preserved:** Yes
**Compilation verified:** Yes
**Files touched:**
- `src/widgets/answer_buttons.tsx` — migrated `openExtractedUrls` to a `useTrackerPlugin` hook (`externalUrls`) so URLs are precomputed during render rather than read asynchronously on click via `await rem.text`. Also precomputed `remnoteDomain`. Added support for extracting URLs from the `BuiltInPowerupCodes.Link` Powerup, which handles bookmark Rems correctly. Finally, completely extracted the URL-opening out of `handleNextClick()` and placed it explicitly as the *very first* synchronous line of code inside the `onClick` and `menuItem` targets of the Open Editor button (removed from Next).

**Notes:** Adding `await rem.text` to `handleNextClick` introduced enough async delay (an RPC hop to RemNote) that the browser's user-gesture token expired by the time `openEditorAction` tried to run `window.open`, causing popups to be silently blocked. Precomputing dependencies and firing `window.open` synchronously on line 1 of the click handler resolves this without triggering browser security filters. Furthermore, when multiple tabs attempt to open simultaneously (the hyperlink AND the editor), browsers strictly block anything past the first. We inverted the order so the hyperlink is guaranteed to consume the trusted interaction token.

**Superseded in policy** by **2026-04-16** — external URL tabs are no longer opened on every Open Editor click; they open only when the title ends with `(OpenLink)` (see that entry and Current Deviations). The synchronous-first `window.open` approach still applies whenever URL tabs *are* opened.

---

### 2026-04-14 — Edit (Open Editor Keyboard Shortcut)

**Upstream commit(s):** N/A (local feature)
**Conflicts resolved:** None
**Custom code preserved:** Yes
**Compilation verified:** Yes
**Files touched:**
- `src/register/commands.ts` — added `open-incremental-editor` command triggered by `Ctrl+G`. It directly executes the same compound logic as the "Open Editor" queue UI button (extract/open URLs, jump to document, advance queue). This included a local port of the `externalUrls` parsing code so the keyboard command functions natively without traversing the React UI wrapper.

**Notes:** User requested `Ctrl+G` to explicitly trigger the "Open Editor" flow entirely via keyboard.

**Superseded in policy** by **2026-04-16** — `Ctrl+G` now follows the same `(OpenLink)` / document-only URL rules as the Open Editor button (see that changelog entry).

---

### 2026-04-14 — Edit (Minimalist Queue UI Redesign & Mobile Unification)

**Upstream commit(s):** N/A (local feature)
**Conflicts resolved:** None
**Custom code preserved:** Yes
**Compilation verified:** Yes
**Files touched:**
- `src/widgets/answer_buttons.tsx` — Completely reorganized the buttons row. Unified the mobile and desktop views by removing `!isMobile` constraints. The top-level `buttonRowStyle` now only displays: Next, Open Editor, Skip, Dismiss, and a new `⚙️ Options` toggle button. Clicking `⚙️ Options` conditionally renders a secondary horizontal toolbar row underneath the main row for advanced UI components (Reschedule, Change Priority, Review in Editor, Scroll to Highlight, Web Clipper, Help array).

**Notes:** Consolidating into a clean 5-button footprint prevents the main row from wrapping and reduces visual overload. By moving mobile-excluded buttons into the inline expandable toolbar, we bypassed iframe bounding limitations of floating absolute menus and were able to drop device-specific toggles entirely.

---

### 2026-04-14 — Edit (Queue 'Previous' Button addition)

**Upstream commit(s):** N/A (local feature)
**Conflicts resolved:** None
**Custom code preserved:** Yes
**Compilation verified:** Yes
**Files touched:**
- `src/widgets/answer_buttons.tsx` — Inserted a new explicit `Previous` button into the `buttonRowStyle` layout map directly to the left of the `Next` button.

**Notes:** Wired directly into the native RemNote SDK's `plugin.queue.goBackToPreviousCard()` API to let users rapidly rewind the queue stack inline. Our queue actions row now consists of 6 primary top-level footprint buttons: Previous, Next, Open Editor, Skip, Dismiss, and Options.

---

### 2026-04-16 — Fix / Edit (Open Editor / Ctrl+G: `(OpenLink)` suffix and tab policy)

**Upstream commit(s):** N/A (local fix + behavior tweak)
**Conflicts resolved:** None
**Custom code preserved:** Yes
**Compilation verified:** Yes (`npm run build`)
**Files touched:**
- `src/lib/open_editor_link_tag.ts` — `remTitleEndsWithOpenLinkTag()`; visible title must end with **`(OpenLink)`** (case-sensitive `OpenLink`; optional spaces inside parens). Checks front + back; rich-text walk before plain fallback.
- `src/widgets/answer_buttons.tsx` — `remTitleEndsWithOpenLinkTagState`, `openExternalLinkTabsWhenOpenLinkTagged()` (opens URL tabs **only** when `(OpenLink)`), `shouldSkipRemDocumentForOpenEditor` (requires `(OpenLink)` + non-empty `externalUrls`)
- `src/register/commands.ts` — same rules for `Ctrl+G`
- `docs/open-editor-behavior.md` — documents behavior

**Notes:** **Supersedes** the Open Editor / external-URL behavior logged under **2026-04-14** (Auto-open URLs, popup-blocker fix, Ctrl+G); those entries now note that policy was superseded here. **(1)** Suffix renamed from `(Link)` to **`(OpenLink)`** and matching is **case-sensitive**. **(2)** If the title does **not** end with `(OpenLink)`, Open Editor opens **only** the Rem document (external URLs are not opened in new tabs). **(3)** If `(OpenLink)` **and** at least one extracted URL: open those URL tab(s) and **skip** the Rem document tab. **(4)** If `(OpenLink)` but extraction finds no URLs, the Rem document still opens. Multiple extracted URLs produce multiple tabs. **(5)** `richText.toString` alone could miss a trailing suffix when the title contains an inline hyperlink; detection walks visible rich-text characters first.

---

### 2026-04-16 — Merge (upstream sync to `7e0bc0d`)

**Upstream commit(s):** `8144672` to `7e0bc0d` (PR #263 through PR #271)
**Conflicts resolved:** `src/lib/incremental_rem/index.ts`, `src/lib/incremental_rem/types.ts`, `src/widgets/answer_buttons.tsx`
**Custom code preserved:** Yes — adapted
**Compilation verified:** Yes (production `webpack` build; pre-existing `tsc` errors unchanged)
**Files touched:**
- `public/manifest.json` — patch 174 from upstream; `repoUrl` and `unlisted` preserved
- `src/lib/incremental_rem/types.ts` — merged upstream `createdAt` with fork `rotation`
- `src/lib/incremental_rem/index.ts` — merged `createdAt` read, `addCreationToIncrementalHistory`, manual cache patching after review; `updateReviewRemData` return includes `newNextRepDate: nextRepDateToUse` for correct rotation + cache
- `src/widgets/answer_buttons.tsx` — merged `getPageHistory` / `bookmarkHighlightId`; Open Editor / `(OpenLink)` trackers retained; PDF “Scroll to Bookmark” placed in advanced options row
- Plus upstream-only changes across queue CSS, PDF bookmark widgets, commands (`createExtract` rewrite), settings, and 30+ other files

**Notes:** Upstream added PDF bookmark tooling, queue UI/CSS improvements, incremental history creation tracking, and extract/queue context fixes. Fork-specific queue button layout and Open Editor rules were reconciled manually in the three conflicted files.
