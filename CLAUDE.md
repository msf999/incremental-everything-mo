# incremental-everything-mo — Fork Tracking & Upstream Merge Guide

> **Purpose:** This document is the single source of truth for all custom modifications made to this fork **and** the runbook for syncing it with upstream. It is designed to be read and updated by an AI assistant when merging upstream changes or making new edits.
>
> **Provenance:** Merged 2026-08-09 from the former `FORK_TRACKING.md` (record: AI instructions, sync status, deviations, logging protocol, changelog) and `UPSTREAM_MERGE_PLAN.md` (forward-looking runbook), both now deleted. References to those filenames in older changelog entries refer to this document.

---

## AI System Instructions

When working on this repository, follow these rules in order:

### Before Any Merge or Edit

1. **Read this file first.** Parse every section. The "Current Deviations" section is your conflict map.
2. **Identify the upstream base.** The last known upstream commit is recorded in the "Upstream Sync Status" section below. Compare against it to understand what is new upstream.
3. **Never overwrite custom code blindly.** If an upstream change touches a file listed in "Current Deviations," perform a manual three-way inspection: read the upstream diff, read our custom code, and reconcile intentionally.

> For the step-by-step merge procedure (safety branches, conflict recon, verify, land), follow the "Upstream Merge Runbook" section below.

### During a Merge

4. **Preserve `manifest.json` overrides.** Our fork uses a different `id` (**critical** — must differ or our fork collides with the official plugin), a different `name` and `repoUrl`, and sets `unlisted: true`. Any upstream change to `manifest.json` must keep these four fields as-is (see Deviation 1).
5. **Preserve additive custom code.** Our changes are designed to be additive (new constants, new slots, new helper functions, new branches in existing functions). Upstream refactors that rename or move the functions we hook into require manual adaptation -- do not auto-resolve.
6. **Test compilation.** After resolving conflicts run `npm run build` **and** `npx tsc --noEmit`, compared against the current error baseline (Runbook Step 5). `npm run dev` is transpile-only: it does not catch type errors, and it is exactly what hid the `9e2a2bb` remeda crash recorded in the 2026-06-15 Fix.

### After Any Merge or Edit

7. **Update "Upstream Sync Status"** with the new upstream commit hash.
8. **Update "Current Deviations"** if files or regions changed.
9. **Append a changelog entry** using the template in "Logging Protocol."
10. **Update `README.md`** whenever the fork's user-visible behaviour changes — a feature added, modified, or removed, whether by a local edit or by adopting/dropping something in an upstream merge. `README.md` is fork-owned, user-facing documentation: it links upstream and describes only the fork's differences, written for someone who knows the original plugin. Keep it describing the **current** state (not history — history lives in the Changelog below).

---

## Upstream Sync Status

| Field | Value |
|---|---|
| **Upstream repo** | `https://github.com/bjsi/incremental-everything` (via `hugomarins` fork) |
| **Our fork** | `https://github.com/msf999/incremental-everything-mo` |
| **Last synced upstream commit** | `5f8ccdd` — _Merge pull request #306 from hugomarins/main_ (synced 2026-08-10) |
| **Our first custom commit** | `88839e1` — _feat: add Rotation and First Added properties, make Open Editor advance queue_ |
| **Branch** | `main` is the fork trunk; the current work sits on `merge/upstream-5f8ccdd` until Runbook Step 6 lands it |

---

## Current Deviations

All custom changes are **additive** unless noted otherwise. No upstream logic was deleted or rewritten.

### 1. `public/manifest.json`

| Field | Upstream Value | Our Value | Reason |
|---|---|---|---|
| `id` | `incremental-everything` | `incremental-everything-mo` | **Critical** — plugin identifier; must differ or our fork collides with the official plugin |
| `name` | `Incremental Everything` | `Mo's Incremental Everything` | Fork branding |
| `repoUrl` | `https://github.com/bjsi/incremental-everything` | `https://github.com/msf999/incremental-everything-mo` | Points to our fork |
| `unlisted` | `false` | `true` | Prevents public listing of our private fork |
| `author` | `Jamesb and Hugomarins (cont. Jonathangimeno)` | `Jamesb, Hugomarins and Jonathangimeno` | Minor attribution wording (cosmetic) |

**Merge rule:** Always keep our values for the four fields above (`id`, `name`, `repoUrl`, `unlisted`; `author` is cosmetic). Accept all other manifest changes from upstream — including the upstream `version` and the `supportUrl` (upstream's GitHub issues) / `projectUrl` / `changeLogUrl` fields (the latter two point at upstream's MkDocs site `hugomarins.github.io/incremental-everything`, which is fine for a fork that tracks upstream features).

**Version scheme:** upstream reset its numbering `0.2.294 → 1.0.x` during the `5f8ccdd` sync; we adopted it (fork was `0.2.277` → upstream base `1.0.35`, now at fork-local **`1.0.43`**). The rule is unchanged — accept upstream's `version`, and bump the patch for fork-local releases on top of it.

### 2. `src/lib/consts.ts`

**What changed:** Added two new export constants immediately after `originalIncrementalDateSlotCode` (since the `5f8ccdd` sync, upstream's `pdfStateSlotCode` block also sits in that region — it follows ours, after its own comment block):

```
firstAddedSlotCode = 'firstAdded'
rotationSlotCode  = 'rotation'
```

Also added the `queueBackNavKey` session-flag constant (one-shot back-navigation flag consumed by the due-on-encounter auto-skip; see Deviation 8).

**Merge rule:** Pure additions at the end of the constants blocks. Upstream has no colliding identifiers or slot-code strings, but it does insert its own constants directly around ours (`pdfStateSlotCode` after `originalIncrementalDateSlotCode`; ~15 new setting IDs near `queueBackNavKey`), so expect *context* conflicts here even though the names never clash — keep both sides.

### 3. `src/register/powerups.tsx`

**What changed:**

- Added imports for `firstAddedSlotCode` and `rotationSlotCode`.
- Added two new slot entries to the Incremental powerup registration:
  - `firstAdded` — `PropertyType.DATE`, visible (`PropertyLocation.BELOW`).
  - `rotation` — `PropertyType.TEXT`, visible (`PropertyLocation.BELOW`).

**Merge rule:** Our slots are appended to the end of the existing `slots` array. If upstream adds new slots in the same array, ensure ours remain at the end. If upstream changes the `registerPowerup` call signature, adapt our additions to match.

### 3.1. `src/register/commands.ts`

**What changed:** Added `open-incremental-editor` macro bound to `Ctrl+G` that replicates the AnswerButtons "Open Editor" behavior from the keyboard. External `http(s)` tabs open **only** when the visible title ends with **`(OpenLink)`** (case-sensitive; see `open_editor_link_tag.ts`). If `(OpenLink)` **and** at least one extracted URL: open those URL tab(s) only and **do not** open the Rem document. If the title does **not** end with `(OpenLink)`: advance first, then open the Rem in-app editor (`openRemAsPage` for `pdf-note`, otherwise `plugin.window.openRem`).

**Merge rule:** Retain the `open-incremental-editor` command registration, `remTitleEndsWithOpenLinkTag`, and the guarded URL-opening + skip-doc logic — plus the fork's two added import lines (`remTitleEndsWithOpenLinkTag` + `extractExternalHttpUrlsFromRem` from `open_editor_link_tag`, `determineIncRemType` from `incRemHelpers`), which a broad accept-upstream pass on the heavily-rewritten import block will otherwise drop.

**PDF reading position (since `5f8ccdd`):** both this command and `runNextInQueueAction` record the current PDF page via **`getIncrementalReadingPosition(plugin, remId, pdfRemId)`** (backed by upstream's new `pdfState` powerup slot). The legacy `getCurrentPageKey` + `plugin.storage.getSynced` pair is **still re-exported by `pdfUtils.ts`, so stale calls compile silently** while reading a key nobody writes any more — detection is a grep plus the page-resume smoke test, never `tsc`.

**Also added (queue keyboard shortcuts):** Extracted upstream's `nextInQueueCommandId` ("Next Item in Queue", `cmd+right`) action into a shared `runNextInQueueAction` closure, and registered two fork-only commands (both registered like `open-incremental-editor` so they're rebindable in RemNote → Settings → Shortcuts):

- `next-in-queue-alt` — "Next Item in Queue (alternate)", default **`opt+t`**. Reuses `runNextInQueueAction` (same behavior as upstream's Next command).
- `skip-in-queue` — "Skip Item in Queue", default **`opt+b`**. Guards on the queue (`/flashcards`), then `removeCurrentCardFromQueue()` — mirrors the Skip button (advance without recording a review or rescheduling).

**Merge rule (shortcuts):** Keep `runNextInQueueAction` and both fork commands. If upstream refactors the `nextInQueueCommandId` action body, re-extract it into `runNextInQueueAction` so both bindings stay in sync. `opt+t` / `opt+b` are defaults only.

### 4. `src/lib/incremental_rem/types.ts`

**What changed:** Added `rotation: z.string().optional()` to the `IncrementalRem` Zod schema. Upstream's schema has since grown around it — `createdAt` (ms), `prioritySource`, and per-rep `nextRepMs` / `notes` / `context` — and all are kept.

**Merge rule:** Preserve `rotation` alongside upstream's growing schema (`createdAt`, `prioritySource`, and the rep fields). ⚠️ **Zod strips unknown keys**: if `rotation` is dropped from this schema it disappears everywhere at runtime — reads, cache, scheduling — with **no compile error**. This is the single highest-value line in the fork to get right during a merge.

### 5. `src/lib/incremental_rem/index.ts`

This file has the most custom code. All additions are in clearly separated blocks.

| Region | What Changed |
|---|---|
| **Imports** | Added `firstAddedSlotCode`, `rotationSlotCode` from consts; added `import parseDuration from 'parse-duration'`. Also imports `addCreationToIncrementalHistory` from `history_utils` (with upstream). |
| **`getIncrementalRemFromRem()`** | Upstream rewrote this function (powerup-presence gate as the only `null` path, 3-tier priority resolution with `prioritySource`, 3-tier `nextRepDate` resolution). Our addition is now a rotation slot read placed **immediately after the priority clamp** (`priority = Math.min(100, Math.max(0, priority))`), plus a `rotation` key in the 7-key `rawData` literal. `createdAt` is now resolved by upstream's own `resolveDailyDocSlot` + `madeIncremental` marker fallback — our old createdAt block was superseded and removed. |
| **New helpers (before `initIncrementalRem`)** | Added `MS_PER_DAY`, `getRotationIntervalMs()`, `getRotationIntervalDays()`, `getInitialRotation()`, and `rescheduleWithoutReview()`. Freestanding — upstream has no functions by these names. |
| **`initIncrementalRem()`** | Upstream batches its slot writes into a `slotWrites: Promise<unknown>[]` array + `Promise.all`. Our two writes are entries in that array: (a) `firstAddedSlotCode` set to upstream's existing **`todayRef`** — deliberately *not* a second `getDailyDocReferenceForDate` call, which upstream documents as a `getDailyDoc` race — guarded only on `todayRef` truthiness (unconditional on `hasExistingHistory`, unlike upstream's own `originalIncDate` write); (b) `rotationSlotCode` set from `getInitialRotation()`, which is resolved **before** the array so the value is also in scope for the cache entry. Upstream replaced its closing re-read with a hand-built `constructedIncRem` + `safeParse` — **`rotation: initialRotation` must be in that literal**, or the cache entry silently loses rotation until the next full read. |
| **`handleNextRepetitionClick()` / `handleNextRepetitionManualOffset()`** | Use manual in-memory `IncrementalRem` patch + `updateIncrementalRemCache` from review result / constructed state (upstream) instead of re-fetching from the Rem after write. Upstream's `requestQueueDashboardRefocus` (before `removeCurrentCardFromQueue`) and `stampNoteAndContext` / `manualEntry` coexist with it. |
| **`updateReviewRemData()`** | Branching `nextRepDateToUse`: explicit overrides, then rotation interval (`getRotationIntervalMs`), then normal scheduler. Returns `{ ...nextSpacing, newNextRepDate: nextRepDateToUse, newHistory }` so callers patch the cache with the **persisted** next date (required when rotation overrides the scheduler). Upstream's `stampNoteAndContext` block and its `overrideIntervalDays` write sit immediately **before** our branch — which is **not** purely additive: it replaces upstream's one-line `nextRepDateToUse` ternary with the 3-tier if/else. ⚠️ Upstream adds **no** `requestQueueDashboardRefocus` here — do not add one: this function is also called by the Review-in-Editor path, which deliberately leaves the queue. |

**Merge rule:** If upstream modifies `getIncrementalRemFromRem`, `initIncrementalRem`, or `updateReviewRemData`, carefully re-apply our additions into the updated function bodies — the anchors above are the current ones and upstream has rewritten all three at least once. Our helpers are freestanding and should not conflict. Our re-applied blocks never write `prioritySlotCode`, so none of them needs routing through upstream's `setIncRemPriority` band-sync chokepoint.

### 6. `src/widgets/answer_buttons.tsx`

This file has grown into the most heavily customised widget. All changes are additive or replace upstream UI elements with improved alternatives.

| Region | What Changed |
|---|---|
| **Imports** | Added `getRotationIntervalMs`, `rescheduleWithoutReview` from `../lib/incremental_rem`; replaced `DraggableButton` import with `SplitButton`. Later joined by the Deviation 13/14 imports: `FORK_FEATURES`, `queueInfoBarModeId` + `isMobileDeviceKey`, and the shared bar geometry from `../components/QueueDistribution` (`QUEUE_INFO_BAR_OUTER_PADDING` and `getQueueInfoBarStyle` are load-bearing for the container). |
| **`hasInvalidRotation` + `warningStyle`** | Derived boolean + amber style object computed after `incRemInfo` is destructured. Applied to the Next and Open Editor buttons when the rotation value cannot be parsed. |
| **Next button** | Replaced `DraggableButton` (drag-up/down gesture) with `SplitButton`. The chevron toggles the shared **offset row** (see below) in `'next'` mode. When `hasInvalidRotation` is true, the sublabel shows `"invalid rotation"` in amber instead of `<NextRepTime />`. |
| **`openEditorAction` helper** | Extracted editor-opening logic into a reusable async function. It now always opens in-app (`openRemAsPage` for `pdf-note`, otherwise `plugin.window.openRem`) on both mobile and desktop. |
| **Open Editor button** | Converted from `Button` to `SplitButton`. Scheduling runs **before** navigation so the widget is not destroyed before the review is recorded. Its chevron toggles the offset row in `'editor'` mode — a chosen offset records a review with that offset then opens the editor in-app (`runOpenEditorWithOffset`). The sublabel now mirrors Next (`<NextRepTime />`) and shows `invalid rotation` in amber when parsing fails. Styled with a green **outline** theme (border + font only, Dismiss-style; neutral background). |
| **Skip button** | Converted from `Button` to `SplitButton`. Main click calls `plugin.queue.removeCurrentCardFromQueue()` (advances queue without recording a review). Its chevron toggles the offset row in `'skip'` mode — a chosen offset reschedules without recording a review via `rescheduleWithoutReview` (which advances the queue itself). |
| **Offset picker (chevrons)** | The chevrons on Next / Open Editor / Skip no longer open per-button dropdowns. Each toggles ONE shared picker row rendered below the button row (same visual convention as the ⚙️ Options row), driven by `offsetRowFor: 'next' \| 'editor' \| 'skip' \| null`. The picker is granular: a − / + stepper with a typeable number (1–999, Enter applies, Escape closes), a Days/Weeks/Months segmented toggle (`OFFSET_UNITS`; months are calendar-aware via `offsetToDays`, not 30-day blocks), a live landing-date preview ("→ Tue, Sep 8 (28d)"), and one Apply button labelled per mode ("Next in 3 weeks") and outline-coloured to match its action (blue / green / purple). Value+unit persist across opens within a card. Applying closes the row and runs the mode's action (`runManualNext` / `runOpenEditorWithOffset` / `rescheduleWithoutReview`). This replaced the earlier "Saturday (Xd)" / "Monday (Xd)" dropdown items and an interim fixed-chip row. |
| **Unified layout (Accordion)** | Removed all `!isMobile` conditional rendering guards **from the button rows** (a mobile gate returned later, for the info bar only — see Deviation 14). Consolidated the top row into a minimalist 6-button layout: Previous, Next, Open Editor, Skip, Dismiss, and `⚙️ Options`. Built a dynamic `showAdvancedOptions` local state variable. Clicking `⚙️ Options` opens a visually clean secondary row positioned underneath to host the power-user buttons: Reschedule, Change Priority, Review with Timer, Scroll to Highlight, **Scroll to Bookmark** (PDF: last page-history entry with `highlightId`; upstream feature merged into this row), URL clipping, and Help. **(Post `5f8ccdd`)** upstream's new **📝 Review Note** toggle and **🔖 Read point** button were folded into this row too, restyled to the row's `Button` + single-label convention. |
| **Upstream hooks + note input (post `5f8ccdd`)** | Upstream's `remReadPointInfo` tracker and the note state (`noteOpen` / `noteText` + prefill `useEffect`) live in the **hooks section above the early returns** — moving them down beside `hasInvalidRotation` would break the Rules of Hooks and crash the widget. The note **input row** renders **outside** the accordion (upstream's position, after the `showAdvancedOptions` block): its prefill effect auto-opens when a note is parked, and the accordion defaults closed, so inside it a parked note would be invisible. `readerBookmarkIsLatest` (non-hook) drives the ` • latest` badge on our Scroll-to-Bookmark button. |
| **Link Auto-Open (guarded)** | Added `externalUrls` via `useTrackerPlugin` (extract from `rem.text`, `rem.backText`, Link powerup). `openExternalLinkTabsWhenOpenLinkTagged()` runs **first** on Open Editor clicks (sync `window.open` while the gesture is valid) but **only** when the title ends with **`(OpenLink)`**. If the title does **not** end with `(OpenLink)`, only the Rem document opens — external URLs are not opened in new tabs. |
| **Title `(OpenLink)` → external tabs, no Rem doc** | `remTitleEndsWithOpenLinkTag` (`open_editor_link_tag.ts`) **and** non-empty `externalUrls`: `performOpenEditorFlow` skips `openEditorAction` so only external URL(s) open (one tab per URL). If the title has `(OpenLink)` but no URL was extracted, the Rem document still opens. The offset picker's `'editor'` path (`runOpenEditorWithOffset`) applies the same rules. |

**Merge rule:** If upstream modifies the answer buttons layout, the Next button component, the Open Editor button, or the Skip area, re-apply our changes: (0) Previous button via `goBackToPreviousCard()`, (1) SplitButton on Next, Open Editor, and Skip with the chevron-toggled shared offset picker (`offsetRowFor`, `OFFSET_UNITS`, `offsetToDays`), (2) Open Editor uses in-app `openEditorAction` on all platforms and runs after scheduling, (3) `hasInvalidRotation` warning on Next + Open Editor, (4) `rescheduleWithoutReview` for the offset picker's Skip mode, (5) accordion-style toggle logic for the power-user button array (`showAdvancedOptions` state block), (6) inject `openExternalLinkTabsWhenOpenLinkTagged()` at the start of Open Editor click handlers (URLs only when `(OpenLink)`), (7) skip `openEditorAction` when the title ends with `(OpenLink)` and `externalUrls` is non-empty; (8) Next/Skip button tooltips advertise the `Opt+T` / `Opt+B` queue shortcuts (see Deviation 3.1); (9) new upstream buttons go in the accordion but their **hooks stay above the early returns**; (10) `handleNextClick`'s PDF branch uses `getIncrementalReadingPosition` (see Deviation 3.1's PDF note).

**Deliberately dropped (post `5f8ccdd`):** upstream's edit to its "Open Editor in New Tab" button (`plugin.settings.getSetting(remnoteEnvironmentId)` → `getIESetting`, which only picks `beta.` vs `www.remnote.com` for a browser-tab URL). The fork replaced that button with the in-app `openEditorAction`, which builds no URL — verified UI-only, nothing to port. Re-check this if upstream ever puts functional logic in that handler. Note the container's `onClick` **must** keep upstream's `closest('input, textarea')` bail-out, or the note input cannot be typed into (our stricter guard is on `onMouseDown`, a different handler).

### 6.1. `src/lib/open_editor_link_tag.ts` *(new file)*

**What changed:** Shared `remTitleEndsWithOpenLinkTag()` helper: checks **front and back** (`rem.text` / `rem.backText`). First walks rich text with `richTextVisibleForLinkSuffix()` (strings + `.text` + nested arrays; **does not** append raw `url` so hyperlinked titles like `Article (OpenLink)` still match), then falls back to `safeRemTextToString`. **Both** strings are normalised by `normalizeVisibleTitleForLinkCheck()` (NFKC + fullwidth `（ ）` → ASCII parens) and tested against **`/\(\s*OpenLink\s*\)\s*$/`** (**case-sensitive** — must be exactly `OpenLink` inside the parens); the plain fallback additionally ignores the literal title `Untitled`. Also exports `extractExternalHttpUrlsFromRem()` (scans front + back). Used by answer buttons and `Ctrl+G`.

### 6.2. `src/components/buttons/SplitButton.tsx` *(new file)*

**What changed:** New component that renders a split button — main click area on the left, small chevron on the right. Used by the Next, Open Editor, and Skip buttons; replaces the upstream `DraggableButton` pattern. Two chevron modes: with `menuItems` it opens a dropdown popover; with the (now-preferred) `onChevronClick` + `chevronActive` props it is a plain toggle (glyph ▼/▲, no popover) — the answer buttons use this to open their shared offset row. Added an iframe sandbox padding hack in the `useEffect` (`document.body.style.paddingBottom = '150px'`) whenever the menu toggles open to proactively expand the RemNote plugin boundary, gracefully preventing native clipping since it renders downward as a `position: absolute` popover. Later updated so optional custom `style` props also apply to the chevron segment, enabling consistent full-button theming (used by green Open Editor).

**Merge rule:** Freestanding new file. No conflict expected. If upstream introduces its own split-button or dropdown component, consider consolidating, but ensure any absolute-positioned dropdown injects dynamic body padding to survive iframe clipping.

### 6.3. `src/components/NextRepTime.tsx`

**What changed:** Before falling through to the SRS scheduler (`getNextSpacingDateForRem`), the component now checks for a rotation value via `getRotationIntervalMs`. If a valid rotation is set, it displays `Date.now() + rotationMs` instead of the scheduler result. Added `props.rem.rotation` to the `useEffect` dependency array.

**Merge rule:** If upstream modifies `NextRepTime`, re-apply the rotation check at the top of the `useEffect` callback and add `props.rem.rotation` to the dependency array.

### 7. `package.json` / `package-lock.json`

**What changed:** Added `parse-duration` as a runtime dependency.

**Merge rule:** After any upstream merge that touches dependencies, verify `parse-duration` is still present. Run `npm install` to regenerate the lock file.

### 8. `src/widgets/queue.tsx` (due-on-encounter auto-skip)

**What changed:** Added a due-date guard to `QueueComponent` (the `WidgetLocation.Flashcard` view for plugin queue items). Upstream already auto-advances when `remAndType === null` or the powerup is removed; this adds a parallel check. On first encounter of each item — a `useEffect` keyed on `ctx.remId` (deliberately **not** a reactive tracker) with a `cancelled` guard — it reads the item's *current* `nextRepDate` straight from the Rem via `getIncrementalRemFromRem` and, if `!isIncRemDue(incRem)`, calls `removeCurrentCardFromQueue(false)` to advance. Fixes stale queue entries: an item rescheduled to a future date on another device can linger in a session whose item list was built earlier (e.g. reviewed on a laptop, then back to a desktop). Consecutive stale items chain-skip. Imports: `getIncrementalRemFromRem` (added to the existing `../lib/incremental_rem` import) and `isIncRemDue` from `../lib/shield_history`.

**Back-navigation exception:** As its very first step, the async effect reads and consumes a one-shot session flag `queueBackNavKey` (consts) — set by the **Previous** button in `answer_buttons.tsx` right before `goBackToPreviousCard()`. If set, the effect clears it and returns *without* the due check, so a just-reviewed (now future-dated) item revisited via Previous is shown instead of auto-skipped. The flag is also reset in `resetQueueSession` (`session_helpers.ts`). (Known minor edge: if Previous lands on a non-plugin card, the flag is consumed by the next IncRem instead — rare, bounded to one item per session.)

**Merge rule:** Keep the due-check `useEffect`. Its dep array is `[ctx?.remId, plugin]` (`plugin` is a stable ref); what matters is that it **must not** contain a reactive tracker value or the item's `nextRepDate` — otherwise it reacts to the future `nextRepDate` the user writes when reviewing the *current* item and skips the wrong card. Keep the `queueBackNavKey` consume-first early-out and the Previous-button hand-off together (they're a pair). If upstream restructures `QueueComponent`, re-add the effect alongside the existing auto-advance effects. **(Post `5f8ccdd`)** upstream added a hybrid Reader↔Outline feature (`useIESettingOptional(isolatedQueueModeId)`, `outlineView` state + reset effect) at the top of the component; it does not overlap this effect, which still follows the `hasIncrementalPowerup` effect.

### 9. Queue counter priority distribution (`session_helpers.ts`, `ui_helpers.ts`, `events.ts`, `callbacks.ts`)

**What changed:** Extended upstream's queue top-bar counter (which appends ` + <due IncRem count>` to RemNote's native card counter) to also show the due IncRems' **priority distribution** by range `[0-10, 11-30, 31-60, 61-100]` (inclusive), e.g. `1440 + 1610 (x, y, z, u)`. All four files modify **upstream** code:

- `src/lib/session_helpers.ts` — added `getDueIncRemPriorityBuckets()` + `DueIncRemStats` type; **renamed upstream `calculateDueIncRemCount` → `calculateDueIncRemStats`**, now returning `{ count, priorityBuckets }`, computed from the same due-IncRem array in each branch (priority-doc / full-KB / scoped-full / scoped-light).
- `src/lib/ui_helpers.ts` — `registerQueueCounter(plugin, count, priorityBuckets?)` gained an optional buckets arg. ⚠️ **Superseded by Deviation 14 (2026-08-12):** it no longer appends ` (x, y, z, u)` to the CSS `::after` content — the counter shows only ` + <count>`, and the distribution moved into the queue info bar where it can be labelled and colour-coded. Both call sites still pass buckets, now used only for the console line; `getDueIncRemPriorityBuckets` is still the 4-bucket helper for that log, while the *bar* draws the plugin's ten bands instead.
- `src/register/events.ts` — QueueEnter calls `calculateDueIncRemStats` and passes `.count` + `.priorityBuckets`.
- `src/register/callbacks.ts` — the live `GetNextCard` counter path (excludes already-seen rems) now calls `registerQueueCounter(plugin, filtered.length, getDueIncRemPriorityBuckets(filtered))` instead of inlining the CSS, keeping both counter paths consistent.

**Merge rule:** If upstream changes `calculateDueIncRemCount`, re-apply the rename to `calculateDueIncRemStats` + bucket return (or wrap it). Keep `registerQueueCounter`'s optional `priorityBuckets` param and **both** call sites (events.ts QueueEnter + callbacks.ts GetNextCard) passing buckets, so the distribution doesn't flicker between the two paths. Buckets use the standard `priority` field (0-100) and `Date.now() >= nextRepDate` due semantics (`isIncRemDue`).

### 10. Equal-priority tiebreak by `nextRepDate` (`callbacks.ts`, `IncRemTable.tsx`, `sorting.ts`)

**What changed:** Added a deterministic secondary sort key so that when two or more Incremental Rems share the same priority, the **most overdue** one (smallest `nextRepDate`) is ordered first. Previously priority was the only sort key, so ties fell back to arbitrary KB load order (stable sort) or got shuffled by sorting randomness. The new key is additive — it only orders items that were already tied on the primary key. Three sort sites:

- `src/register/callbacks.ts` — the authoritative live-queue selector. The `_.sortBy(allIncrementalRem, …)` in `GetNextCard` passes **two projections as separate arguments**: `_.sortBy(allIncrementalRem, primaryKey, (incRem) => incRem.nextRepDate)`. The primary projection is unchanged (scope index in `in-order` mode, else `priority`); in `in-order` mode the scope index is unique per rem, so the `nextRepDate` tiebreak never engages there. **⚠️ remeda gotcha:** `_` is **remeda** (`import * as _ from 'remeda'`), not lodash — `sortBy` takes projections as *separate args*, **not** a lodash array of iteratees; `_.sortBy(arr, [fn1, fn2])` makes remeda read the array as a `[projection, order]` pair and throw `TypeError: comparator is not a function`, crashing `GetNextCard` so **no IncRems appear in the queue** (the `9e2a2bb` bug; fixed in the `0.2.277` Fix below). **(Post `be390d5` merge)** the old uniform random-swap block that ran after the sort was replaced by upstream's `applyPriorityWeightedLottery(filtered, sortingRandomness, weightK)` (skipped in `in-order` mode). Our tiebreak still sets the base order the lottery runs on top of.
- `src/components/IncRemTable.tsx` — the **"Queue Order"** sort (the `sortBy === 'queueOrder'` branch) sorts `a.priority - b.priority || a.nextRepDate - b.nextRepDate` before the randomness step, so the table preview mirrors the live queue. The separate user-selectable "priority" **column** sort is intentionally left unchanged. **(Post `be390d5`)** upstream did **not** touch this file, so its randomness step still uses the old uniform swaps rather than the new lottery — a minor preview-vs-live divergence; aligning it to `applyPriorityWeightedLottery` is an optional follow-up.
- `src/lib/sorting.ts` — `applySortingCriteria` (used by Priority Review Documents for both IncRems and cards) sorts `a.priority - b.priority || ((a as any).nextRepDate ?? 0) - ((b as any).nextRepDate ?? 0)`. The `?? 0` guard keeps flashcards (no `nextRepDate`) in their prior stable order while IncRems get most-overdue-first. **(Post `be390d5`)** the result is then passed to upstream's `applyPriorityWeightedLottery(sorted, randomness, weightK)` (it replaced the old uniform-swap loop). **`DEFAULT_RANDOMNESS` follows upstream** — `0` → `0.1` (be390d5 sync) → **`0.2`** (`5f8ccdd` sync), so the tiebreak is the deterministic base order but ~20% of slots get the priority-weighted lottery on top — it is **no longer strict by default** (set randomness to 0 to make it strict).

**Note:** `callbacks.ts` was already fork-touched for the queue counter (Deviation 9), but the **sort itself** was upstream code. `IncRemTable.tsx` and `sorting.ts` were previously pure-upstream files; this is their first fork deviation.

**Merge rule:** If upstream modifies any of these three sorts, re-apply `nextRepDate` **ascending** as the secondary key. In `callbacks.ts` use **remeda's multi-projection form** (projections as separate args) — **never** a lodash array of iteratees (`_.sortBy(arr, [fn1, fn2])` crashes; see the remeda gotcha above). `IncRemTable.tsx` and `sorting.ts` use native `Array.prototype.sort` with a comparator (`a - b || …`), which is unaffected. In the generic `applySortingCriteria` keep the `?? 0` guard so cards (which lack `nextRepDate`) are unaffected, and keep the tiebreak in the `sort` line that feeds `applyPriorityWeightedLottery` (do not revert to the old uniform swaps). Do **not** add the tiebreak to the percentile-only sorts (utils percentile helpers, `inc_rem_main_view.tsx`, `inc_rem_list.tsx`, shield/card-priority caches) or to the IncRemTable "priority" column sort — those are intentionally out of scope.

### 11. Outline-first queue, no auto-opened sidebar (`queue.tsx`, `ExtractViewer.tsx`)

**What changed:** two related fork edits so a queue item is always shown **as the Rem, in the queue body** — never as the source document, and never pushed into the right sidebar.

- `src/components/ExtractViewer.tsx` — **restored VERBATIM from the pre-merge fork** (`git show be390d5:src/components/ExtractViewer.tsx`, 332 lines) after several failed attempts to blend upstream's rewritten card layout with the fork's geometry (2026-08-10/11 changelog). This one move resolves everything at once: **no sidebar auto-open** (upstream's `openWidgetInRightSidebar` mount effect post-dates this file), the body is RemNote's own **`DocumentViewer`**. Two small fork additions since the restore (the file is otherwise verbatim): the footer's `justify-between` became a left-aligned `gap-4` row (the status label used to be pushed a pane-width away from the stats), and a **tiny sidebar-toggle button** sits at the row's end (`marginLeft: 'auto'`). It is a **toggle over `incremNotesSidebarRemIdKey`** (the key doubles as the open-flag — no extra state): open sets the key to this rem and opens the **docked** notes sidebar (`openWidgetInRightSidebar(incremNotesSidebarWidgetId)`); while `key === rem._id` the in-queue `DocumentViewer` is **unmounted** (hint panel) so two editable host-window overlays of the same rem never fight for focus/clicks; close clears the key and the document returns (the sidebar *pane* is closed with RemNote's own control — the SDK cannot). **Button labels are state-describing:** `✎ Open in sidebar` (blue outline) → pressed: `✎ Show in queue` (filled blue, white text). (A 2s-heartbeat auto-remount on sidebar close was also built and removed at the user's request — no sidebar-close event exists, and the manual toggle was preferred.) Per-rem by construction, so the next card shows its document normally; upstream's `clearStaleIncRemSignals` also clears the key on queue transitions. **Recorded dead-ends (2026-08-11, tried and removed — do not retry):** a floating-widget variant of the notes panel (true open/close toggle, near-fullscreen, centred) was abandoned because RemNote's host popups — `[[` search, the date picker, tag navigation — cannot function over a plugin floating window (both documents are host-window overlays with plugin-uncontrollable stacking; the queue's overlay even captured the float's clicks until the in-queue document was paused). The SDK also offers **no way to close the docked right sidebar** (`openWidgetInRightSidebar` has no close counterpart) and **no way to trigger the native `P` previewer**, so open-only is the honest button behaviour. The body remains (real formatting, powerup properties, inline editing — not upstream's hand-drawn `ReadOnlyRemTree` with the green `🎯 Target Incremental Rem` badge), and the geometry is the known-good `100vh` flat grid (`auto 1fr auto`: breadcrumb `h-10` / document / stats footer) that the published fork build renders correctly. Compiles unchanged against the post-merge codebase.
  - **Dropped with the restore** (upstream `033a8c8`+ additions that lived in this file): upstream's `✎ Edit in sidebar →` footer button — the fork's own ✎ toggle (above) replaced it and re-added the `incremNotesSidebarRemIdKey` write; the read-point banner (read points are disabled outright in this fork — Deviation 13's `readPoints: false`); and `ReadOnlyRemTree` itself — **no longer in the file at all**, so expect upstream edits to `ExtractViewer.tsx` to conflict wholesale at the next sync; keep this file verbatim unless upstream's version passes the re-test below.
- `src/widgets/queue.tsx` — upstream offers its Reader↔Outline toggle only when a read point exists on a descendant, and defaults to the Reader. We offer it for **every** `pdf` / `html` card and default to the **outline** (`ExtractViewer` on the IncRem itself): `offerOutlineToggle` is a type check (`'pdf' || 'html'`) **AND-ed with `FORK_FEATURES.pdfReader`** (Deviation 13), which is `false` today — so in practice no toggle is offered; `outlineView` initialises/resets to `true`. The render branch renders `null` (not the Reader) while `incRemRem` resolves, to avoid a one-frame PDF flash. The `📄 Read document` button switches to the Reader per card **when `FORK_FEATURES.pdfReader` is on; with it off (the current default) neither the button nor the Reader is reachable**. Highlight types are deliberately excluded **from the toggle** — and with the reader disabled they render `ExtractViewer` too, via queue.tsx's `!pdfReader` terminal branch (`IsolatedCardViewer` already shows the highlight text, and its `← Back to isolated view` button shares the toggle's top-right slot).


**Known limitation — the queue document does not fill the full pane height.** This is **long-standing and pre-dates the `5f8ccdd` merge**: the fork's own pre-merge `DocumentViewer` layout did not cover the full length either. The current result is **accepted** — do not spend more time on it without new information. Why it cannot be solved today: `WidgetOptions.dimensions.height` is `number | 'auto'` and the SDK docs state percentages apply to **width only**, so a widget cannot declare "fill the pane"; with `'auto'` the host sizes the iframe from our content, which makes a CSS percentage circular and `100vh` the *window* rather than the pane; and `plugin.widget.getDimensions(widgetInstanceId)` (real, `widget.d.ts:21`) reports *this widget's own* rect, which under `'auto'` is our content height — measuring it and pinning to it is circular too. All three were tried and are recorded in the 2026-08-10 changelog entries.

**⚠️ Re-test on every upstream merge that touches queue rendering.** If a future sync changes how Rems are rendered in the queue — `ExtractViewer`, `queue.tsx`'s render branch, `IsolatedCardViewer`, `Reader`, or the `registerWidget('queue', …)` dimensions — **run upstream's version in the app before re-applying our overrides**. Upstream may have found a technique for filling the pane, or RemNote may have added SDK support (watch for percentage/`'fill'` heights on `dimensions.height`, or a new sizing API, in the SDK changelog). If upstream's rendering fills the pane and still shows real formatting and properties, **prefer it and retire the corresponding parts of this deviation** rather than reflexively restoring ours. The parts to keep regardless are the ones that are preferences, not workarounds: no auto-opened sidebar, and the outline-first default.

**Merge rule:** `ExtractViewer.tsx` is the verbatim `be390d5` file. At the next sync, first test upstream's behaviour (above); if it doesn't win, resolve `ExtractViewer.tsx` conflicts by keeping this file verbatim, and re-apply the `queue.tsx` outline-first edits separately. Watch for upstream re-adding a per-card `openWidgetInRightSidebar` call anywhere in the queue path — that is the regression to look for. If upstream ever adds a real setting for the queue body view, prefer adopting it over this hard-coded default.

### 12. `README.md` (fork-owned; translations removed)

**What changed:** `README.md` is replaced wholesale: a fork notice linking upstream (`bjsi/incremental-everything` + the MkDocs site), followed by a human-readable description of every fork difference and how to use it (Rotation/First Added, the queue bar + offset picker, `(OpenLink)`, shortcuts, outline-first queue + ✎ sidebar toggle, auto-skip, the queue info bar's priority distribution and the queue priority chip, ordering tiebreak, the single settings window, omnibar command naming, removed items, versioning). `README_ES.md` and `README_PT-BR.md` are **deleted** (translations are upstream's concern, not the fork's).

**Merge rule:** `README.md` is **fork-owned** — at a sync, resolve conflicts by keeping ours wholesale; upstream README changes are only a prompt to check whether a new upstream feature deserves a mention in our "different from upstream" framing. If upstream re-adds or modifies `README_ES.md` / `README_PT-BR.md`, delete them again (expect modify/delete conflicts). Per AI System Instruction 10, refresh `README.md` whenever fork behaviour changes.

### 13. Fork feature gates — unused upstream subsystems disabled (`fork_gates.ts` + flag edits)

**What changed:** the fork's owner uses only the core incremental workflow (tag → inherit priority/rotation → queue shows the rem → Open Editor). Everything else is switched off via a central, merge-friendly mechanism:

- **`src/lib/fork_gates.ts`** (fork-only): `FORK_FEATURES` booleans per subsystem + `installForkGates(plugin)`, which wraps `plugin.app.registerCommand/registerWidget/registerMenuItem/registerCSS` **and the four `plugin.settings.register*Setting` methods** (all own arrow-function properties — monkey-patchable) and silently drops ids on the deny-list assembled from the disabled groups. The command wrapper additionally **rewrites** every surviving command: it applies `FORK_COMMAND_OVERRIDES` (per-id `name` / `description` / `keyboardShortcut`) and then prefixes `Incremental: `. Installed by **one added block in `index.tsx`** before any registration. Also `registerForkWidgets` (the combined History tab plus the Deviation 14 queue widgets). Re-enabling a subsystem = flipping one boolean.
- **Disabled groups** (all user decisions, 2026-08-11): `pdfReader` (highlight toolbar, PDF control panel, source popups, page-range/bookmark popups, highlight CSS, hover tracking, **and the in-queue Reader itself** — see queue.tsx below), `cardSurface` (card_info_bar, batch/maintenance commands; the *engine* was already off via `enable-flashcard-prioritisation`), `shields`, `practicedQueues` (Practiced Queues sidebar tab; the **Study Dashboard was restored** 2026-08-11 under its own `studyDashboard: true` flag — its IncRem time aggregates compute from rep history, so it works without session analytics), `upstreamQueueToolbarPriority` (upstream's queue-toolbar P-chip — split out of `practicedQueues`, where it had been lumped in, and replaced by the fork's own `queue_priority_chip`; see Deviation 14), `sessionAnalytics`, `clozeTools`, `outlineTools` (heading/outline/list/text-case), `referenceFinder`, `readPoints`, `videoSurface`, `debugTools`, `priorityReviewDocs`, `historyImport` (the Import-with-History migration command + popup, trimmed 2026-08-11; Reschedule and the IncRem Main View were offered and kept), `remSourceCopyPaste` (Copy/Paste Rem Sources — upstream groups them with the PDF tools and copy feeds the disabled PDF Control Panel's known-rem index).
**Audited and deliberately KEPT** (offered 2026-08-11, user declined): the priority-band commands + table-cell badges (bands are still live — only the PDF-highlight badge CSS is denied), and `toggle-ignore-tag` (general editor utility, belongs to no disabled group). **Kept:** No-IncRem timer, Sorting Criteria, IncRem priority tools, 📚 Inc Rems editor counter, repetition-history popups + `preserve-history-and-remove`, priority bands (unasked → untouched), everything core. ⚠️ Import-with-History (`historyImport`) and Copy/Paste Rem Sources (`remSourceCopyPaste`) are **disabled** — an earlier revision of this line wrongly listed them as kept.
- **Flag-gated behaviour edits** (registration gating alone isn't enough): `queue.tsx` — `offerOutlineToggle &&= FORK_FEATURES.pdfReader` (no 📄 button) and a `!pdfReader` terminal `ExtractViewer` branch so highlight types can never reach the Reader; engagement calls skipped when `!sessionAnalytics`. `answer_buttons.tsx` — `shieldStatusAsync` short-circuits; `capturePdfPageHistoryIfNeeded` no-ops (stops pdfState writes); Dismiss skips `handleCardPriorityInheritance` (T4); Scroll-to-Highlight/Bookmark + Read-point accordion buttons hidden. `commands.ts` — same Dismiss skip. `review_actions.ts` — pdf position write skipped. `events.ts` — `registerQueueSessionTracking` and `registerHoveredReferenceTracking` not wired.
- **Combined History tab:** fork widget `src/widgets/history_sidebar.tsx` (RightSidebar tab "History") renders upstream's three components under collapsible headings; the three separate tabs are denied. Requires two small edits per widget file: `export` on `IncrementalHistory`/`FlashcardHistory`/`RemHistory`, and a self-render guard. **Import-side-effect (hit in-app, fixed 2026-08-11):** each module's own `renderWidget` also runs when the module is imported for its component, and the SDK's HMR branch then calls `unmountComponentAtNode` on a container absent from a non-entry bundle — it **throws** (`Target container is not a DOM element`) and the combined tree never renders. The earlier assumption that ReactDOM.render's replace semantics would let the last call win was **wrong**. Fix: guard each call with `if (!FORK_FEATURES.combinedHistoryTab) renderWidget(X);` — a compile-time constant, so no import-order dependency — so they self-render only when registered standalone. Both history writers stay on.
- **Priority Widget in Editor reduced to on/off (2026-08-12):** upstream's three modes are `all` / `incRemOnly` / `disable`, but `all` differs from `incRemOnly` *only* by also rendering a card-priority editor on any rem with flashcards (`priority_editor.tsx`: `showCardEditor` requires `displayMode === 'all'`) — a surface for the disabled card-priority engine. The fork presents two options (On = `incRemOnly`, Off = `disable`) and its default moved `'all'` → `'incRemOnly'`. The union type still admits `'all'` so a value stored before the change stays readable, and `priority_editor` coerces `'all'` (and empty) to `'incRemOnly'` at the single read site, so a legacy value cannot resurrect the card editor. **Merge note:** the changed default sits in upstream's `IE_SETTINGS_DEFAULTS` table — re-apply it after a sync, or the card-priority editor silently returns.
- **Native settings pruned (2026-08-11, same mechanism):** the gates also wrap `plugin.settings.register*Setting` and drop the four native-panel mode settings — `enable-flashcard-prioritisation`, `performanceMode`, `always-use-light-mode-on-mobile`, `alwaysUseLightModeOnWeb` — so RemNote's plugin-settings panel is **empty of real settings**. As of 2026-08-12 the last native setting, `enable-hide-in-queue-integration`, was moved to **popup tier** in `settings.ts` (a one-word `tier` change + FORK comment) so it can be *changed* in the plugin's own window — native-tier rows render read-only there because the SDK has no setter for them. The panel now carries a single **signpost row** (`registerForkSettingsSignpost`, an inert one-option dropdown — the panel has no text-only row type) stating that every setting lives in the plugin's settings window (`ies`). ⚠️ Side effect of the tier move: the value now reads from the plugin's own store, so anyone who had previously enabled Hide-in-Queue in RemNote's panel is reset to the default (`false`) and must re-enable it in the popup. Safe because `readRawSetting` try/catches native reads and falls back to defaults, which are exactly the fork's pinned values (prioritisation **false**, performance **'light'** — Full Mode is retired, light-on-mobile/web **true**). The "running in Light Mode" startup toasts in `mobileUtils.ts` are silenced behind `FORK_FEATURES.startupModeBanner` (10 call sites routed through a local `notify`). The four are gone from the IE Settings popup too: it renders only the ids named in `FORK_IE_LAYOUT`.
- **IE Settings popup layout (fork-owned, in `fork_gates.ts`):** `FORK_IE_LAYOUT` + `FORK_IE_GROUPS` define the sections the popup renders; `FORK_HIDDEN_IE_SETTINGS` filters individual rows out of them. `FORK_HIDDEN_IE_GROUPS` is **dead code** — still exported and still imported by `ie_settings.tsx`, but never consulted; the layout allow-list superseded it. Delete it, or wire it back, but do not trust it to be hiding anything.
- **Mastery Drill is deliberately NOT gated:** upstream already ships it opt-in behind `enableMasteryDrill` (default off), so its widgets (`mastery_drill`, `mastery_drill_notification`) and commands (`open_mastery_drill`, `debug_audit_mastery_drill`, `cleanup_mastery_drill`) stay registered and inert. Only its settings group is hidden. If it ever becomes default-on upstream, add a group for it.
- **Never gated:** `registerPowerup` (T1 — `getInitialPriority` reads CardPriority slots unguarded during Make-Incremental; pdfState slot stores data read points/dismissal rely on).
- **Upstream bugfix (T2), report upstream:** `tracker.ts`'s cascade watcher now clears `plugin_operation_active` on its prioritisation-off early return — previously the flag set by `initIncrementalRem`/`extract.ts` stayed stuck (its only clearer was `runCascade`'s `finally`), suppressing `GlobalRemChanged` (manual powerup-removal → Dismissed transfer, manual date-edit detection).

**Merge rule:** at a sync, upstream's `commands.ts`/`widgets.ts`/`menus.ts` merge clean (untouched by this deviation) — but **re-verify the deny-list ids still match** (upstream renames = silently re-enabled feature; grep each denied id post-merge) and re-apply the flag edits if upstream rewrites the touched regions. If upstream adds new commands/widgets in a disabled subsystem, add their ids to the group. **Popup check:** the IE Settings popup renders only `FORK_IE_LAYOUT` ids, so a newly added upstream setting will not appear until its id is added there (deliberate — new upstream settings are opt-in for this fork).

---

### 14. Queue priority surfaces — info bar + toolbar chip (`QueueDistribution.tsx`, `queue_info_bar.tsx`, `queue_priority_source.ts`, `queue_priority_chip.tsx`, `answer_buttons.tsx`, `ui_helpers.ts`, `consts.ts`, `settings.ts`, `fork_gates.ts`)

**What changed:** the bottom info bar now appears for **all** queue items, and the due-IncRem **priority distribution** moved into it from the queue's top counter.

- `src/components/QueueDistribution.tsx` *(new, fork-only)* — renders the distribution as a **proportional stacked bar over the plugin's own ten priority bands** (`priority_bands.ts`), not the fork's four ad-hoc buckets: band membership via `bandForPriority`, colour via `percentileToHslColor(bandColorPercentile(...))`, so a band reads the same colour here as its badge does in a table cell. **All ten bands always render, and every one always shows its count — zeros included.** Each segment is `flex: n 1 <floor>px` with a matching `min-width`, where the floor is `bandFloorPx(n)` — sized to **that band's own digit count** (`digits × 6 + 8`, for 10px tabular figures), not to a fixed worst case. So an empty band shrinks to a tight `0` chip instead of reserving four-digit width it will never use, and everything above the sum of the floors is shared out by `flex-grow: n`, i.e. in proportion to the counts. An empty band has grow 0, so it stays at its floor showing `0` at 0.3 opacity — present on the scale, but receding. The strip's `min-width` is the computed sum of the ten floors plus gaps, so a narrow queue wraps the bar onto its own line rather than clipping a band away. The band holding the **current queue item's own priority is ringed** (`boxShadow: inset 0 0 0 2px var(--rn-clr-content-primary)`), so you can see where this item sits on the same scale the backlog is drawn on; that band also keeps full opacity even when empty. The priority arrives as the optional `highlightPriority` prop — both callers already resolve it (`answer_buttons` from `incRemInfo`, `queue_info_bar` from `resolveQueuePriority`), so the component stays a pure view. An **inset** ring rather than `outline` because the strip clips to a rounded rect with `overflow: hidden`, which shaves an outline off the first and last segments. Segments carry the **count only** — range labels inside them were tried and removed (they crowded the bar and truncated to things like `-19 4`); the band is conveyed by colour and position, and spelled out in the tooltip, which lists every band with its count and percentage. The strip is `flex: 1 1 (stripMinPx + 120)px` / `min-width: stripMinPx` — both derived from the same floor sum — and its wrapper (`flex: 1 1 auto`, `min-width: 0`) grows, so it takes the slack in the info bar rather than sitting at a fixed narrow width. No `Due <total>` caption and no `Priority:` caption on either bar — the queue's top counter already reports the due total, and the coloured pill needs no label; the total stays in the tooltip. Renders `null` when nothing is due. Computed client-side from `allIncrementalRemKey` filtered by `now >= nextRepDate` — nothing is stored (upstream wrote its buckets straight into CSS text). ⚠️ **Colour uses the ABSOLUTE scale** — `bandColorPercentile(null, band)`, the band midpoint — deliberately *not* the KB-ranked percentiles the table badges prefer when the sample is large: percentile ranking is right for one badge but collapses a distribution to a single colour whenever most IncRems sit in one band (the fork owner's KB: 1541 of 2006 due items in 0–10). Passing `percentiles.inc` here would look broken, not more consistent. Also the **single source of the bar's geometry**, shared by both widgets so they can't drift: `getQueueInfoBarStyle(color)`, `getQueuePriorityBadgeStyle(color)`, `QUEUE_INFO_BAR_OUTER_PADDING` (also used as `answer_buttons`' `containerStyle` padding), `QUEUE_PRIORITY_NEUTRAL_COLOR`, and `shouldShowQueueInfoBar(mode, isIncRem, isMobile)` — the single place the setting's four options are interpreted. The two bars live in **different iframes**, so any divergence shows up as a visible jump when the queue moves between item types; keep the styles here rather than inlining them.
- `src/widgets/queue_info_bar.tsx` *(new, fork-only)* — the bar for **non-IncRem** items, registered at `WidgetLocation.FlashcardUnder` with **no** `powerupFilter`/`queueItemTypeFilter` (that location mounts for every queue item). Shows the distribution and the card's reps/time from `card.repetitionHistory`. It still resolves the priority, but **only to colour the bar's left border** — the readout itself lives in the toolbar chip. Two widgets are needed rather than one because `FlashcardAnswerButtons` is `queueItemTypeFilter: Plugin` and so can never render for a flashcard.
  - **Bail discriminator:** it returns `null` while `incrementalQueueActiveKey` is true — i.e. while a *plugin queue item* is on screen and `answer_buttons` is drawing its own bar. ⚠️ This is deliberately about the **queue item**, not the rem: an earlier version bailed when the *rem* had the Incremental powerup, which wrongly blanked the bar for a flashcard whose rem is also an IncRem. `incrementalQueueActiveKey` is set true by `queue.tsx` on mount and false by `callbacks.ts` when a flashcard is served — the same discriminator upstream's `card_info_bar` uses.
  - **Priority (border colour only):** resolved by the shared `resolveQueuePriority` (below). The `own` / `↖ document` badge, the percentile and the pill all moved to the toolbar chip's label and tooltip. The document walk starts at the card's rem and stops at the first ancestor with `isDocument()` true; whatever that document has is what shows, and it never continues upward — a card in an unprioritised document shows **no** chip even when a grandparent document is an IncRem. That unbounded climb is exactly what `findClosestIncrementalAncestor` does, so do **not** reintroduce it here (it was the first implementation and was wrong for this fork). `readRemPriority` resolves either source the same way: live IncRem → its current priority; dismissed → the last priority recorded in its preserved history (dismissal drops the priority slot, but every history entry carries the priority it had at the time), flagged `fromDismissed` and explained in prose by the chip's tooltip. Colour and the `x% KB` figure come from `calculateRelativePercentile(allIncRems, sourceRemId)` so the chip matches how the source rem itself looks; a dismissed source is no longer in the IncRem set, so it has no percentile and falls back to colouring by the absolute priority value. Read-only — nothing is written and no CardPriority tag is involved, so the disabled card-priority engine (Deviation 13) stays untouched.
  - **Cluster caveat** (from upstream's `card_info_bar`): inside a Card Cluster a `FlashcardUnder` widget stays mounted across siblings and `getWidgetContext().remId` stays pinned to the cluster parent, so the visible card is tracked via the context's `cardId` + the `QueueLoadCard` event.
- `src/widgets/answer_buttons.tsx` — the IncRem bar gains `<QueueDistribution />` as its first segment and is gated on `shouldShowQueueInfoBar(mode, true, isMobile)`. ⚠️ The gate's two hooks (`useIESetting(queueInfoBarModeId)` + the `isMobileDeviceKey` tracker) **must live in the hooks section above the `if (!coreData)` early return** — the same Rules-of-Hooks constraint Deviation 6 records for upstream's note/read-point hooks. Placed next to the render code they compile and typecheck fine, then blow the widget up the moment `coreData` resolves: the hook count changes between renders, React throws, and the **entire answer-buttons tree disappears** — no info bar *and no buttons* under the item. Hit in-app 2026-08-12 and fixed by moving them up.
- `src/lib/ui_helpers.ts` — `registerQueueCounter` no longer appends the bucket breakdown to the top counter (it still shows `+ <count>`); both call sites still pass buckets, now used only for the console line.
- Setting **`queue-info-bar-mode`** (`consts.ts` + the three `settings.ts` tables), options `All queue items` / `Incremental Rems only` / `All items (Incremental Rems only on mobile)` / `Off`, default **`allExceptMobile`**; listed first under General → Queue.

- `src/lib/queue_priority_source.ts` *(new, fork-only)* — **the one rule** deciding which priority the fork's queue surfaces show, shared by the info bar and the toolbar chip so they can never disagree about the same item. `resolveQueuePriority(rem)`: (1) the rem's **own** priority if it has one, else (2) **its own document's and nothing above it** — nearest `isDocument()` ancestor, walk stops there whatever it finds — else (3) null and nothing renders. A rem inside an unprioritised document therefore shows **no** priority even when a grandparent document is an IncRem; `findClosestIncrementalAncestor` (`priority_inheritance.ts`) is exactly that unbounded climb and must **not** be substituted here (it was the first implementation and was wrong for this fork). `readRemPriority` resolves either source the same way: live IncRem → current priority; dismissed → the last priority recorded in its preserved history (dismissal drops the priority slot, but every history entry carries the priority it held at the time), flagged `fromDismissed`. Callers colour by `calculateRelativePercentile(allIncRems, sourceRemId)` so a chip matches the source rem's own appearance; a dismissed source is no longer in the IncRem set, has no percentile, and falls back to colouring by the absolute value. Read-only throughout — nothing written, no CardPriority tag, so the disabled card-priority engine (Deviation 13) stays untouched.
- `src/widgets/queue_priority_chip.tsx` *(new, fork-only)* — the coloured `P50` chip in the queue's top bar (`WidgetLocation.QueueToolbar`), **replacing upstream's `queue_toolbar_priority`**, which stays denied under its own `upstreamQueueToolbarPriority: false` flag (it was split out of the `practicedQueues` group, where it had been lumped in and disappeared as collateral). A fork widget rather than an edit to upstream's because upstream's flashcard branch goes through `getCardPriority` — the disabled card-priority engine plus the unbounded ancestor walk — and would contradict the info bar under the same item; and because it is gated by a boolean where the fork wants four modes. Renders `P{n}` in the shared `getQueuePriorityBadgeStyle` pill plus a muted `({percentile}%)`, i.e. **the whole priority readout** — pill, percentile, source, and the explanation of what the percentile means (a rank, not a share; plus the Doc rank from `queueSessionCacheKey.incRemDocPercentiles` when a scoped session exists) in one hover tooltip. It deliberately does **not** use upstream's `PriorityBadge`: that component carries its own `title` ("top X%", misleading for a rank where high = unimportant), and a nested title would win over the container's on hover. Toolbar widgets get no per-item context, so the visible item is `currentIncRemKey` when `incrementalQueueActiveKey` is true and a 500 ms poll of `plugin.queue.getCurrentCard()` otherwise. **Click:** opens `openPopup('priority')` — the same popup as the queue's ⚡ Change Priority button — but **only** when `origin === 'own'` and not `fromDismissed`; under a flashcard the chip is inert, because the number belongs to the document, not the card, and a click would silently retarget.
- Setting **`queue-toolbar-priority-mode`** (fork-owned; upstream's boolean `display-queue-toolbar-priority` stays in `FORK_HIDDEN_IE_SETTINGS`, inert): `Always show` / `Always hide` / `Only show on web` / `Only show on mobile`, default **`always`**, listed under General → Queue. "Web" reads `isWebPlatformKey` (browser) and "mobile" `isMobileDeviceKey` (iOS/Android) — **independent flags**, so a phone browser satisfies both; the description says so.

**Merge rule:** all four new files are fork-only. If upstream restructures the `answer_buttons` info bar, re-insert `<QueueDistribution />`, the `showInfoBar` gate, and the `getQueueInfoBarStyle` / `getQueuePriorityBadgeStyle` calls (upstream's version inlines those style literals — re-inlining them silently desyncs the two bars' size). If upstream re-enables `card_info_bar` (currently denied), check the two bars don't stack under flashcards. If upstream changes `queue_toolbar_priority`, nothing needs porting unless the change is worth adopting into the fork chip — but **keep it denied**, or two P-chips render in the toolbar.

---

## Upstream Merge Runbook

> **Purpose:** Forward-looking runbook for merging upstream changes into this fork.
> This is a **plan**, not a record. The historical record of what was actually merged and
> how conflicts were resolved lives in the "Changelog" section below and is updated
> **only after** a merge completes (per the "Logging Protocol"). Do **not** log results in this runbook.

### Current pending sync

| Field | Value |
|---|---|
| **Base (last synced)** | `5f8ccdd` — _Merge PR #306_ (synced 2026-08-10) |
| **Target (upstream HEAD)** | `5f8ccdd` — **caught up, no pending delta** |
| **Our HEAD** | `cf5a72c` on `merge/upstream-5f8ccdd`, **plus a large uncommitted working tree** (Deviations 11 and 13-14: fork gates, settings rework, queue info bar, priority chip). `main` is 225 commits behind and nothing is pushed — Runbook Step 6 is still open, gated on in-app smoke tests. |
| **Delta size** | none pending (next sync: `git fetch upstream` then re-run the runbook) |

**Last sync's themes** (for reference; the next delta will differ — re-recon at Step 3):
the settings-architecture rewrite (native RemNote settings → a plugin-owned typed store + "IE Settings"
popup: `getIESetting` / `useIESetting` / `useIESettingOptional`, 12 setting IDs deregistered, Mastery Drill
flipped to opt-in); priority bands + PDF highlight badges; powerup-slot damage recovery for RemNote's
storage overhaul (raw slot scan/dump/repair); listify + heading assignment; **PDF state consolidated into
`pdf_state.ts` behind a `pdfState` powerup slot** (the `getCurrentPageKey` → `getIncrementalReadingPosition`
migration); history notes/edit/import; read points + hybrid Reader↔Outline queue view; synced-storage
shrink; and a MkDocs documentation site. Upstream also reset its version numbering to `1.0.x`.

> The exact per-file conflict set is confirmed at execution time in **Step 3** (GitHub omits the
> inline file list for a diff this large, so it must be enumerated locally after `git fetch`).

---

### Conflict map (our deviation files)

Only files the fork has modified can conflict. Reference: the "Current Deviations" section above.

| File | Risk | What to preserve |
|---|---|---|
| `public/manifest.json` | reconcile | Keep fork `id` + `name` + `repoUrl` + `unlisted: true` (Deviation 1); accept upstream `version`. |
| `src/register/commands.ts` | **HIGH** | `open-incremental-editor` (`Ctrl+G`) + `(OpenLink)` URL/skip-doc logic; `runNextInQueueAction` + `next-in-queue-alt` (`opt+t`) + `skip-in-queue` (`opt+b`); the two fork import lines; PDF position via `getIncrementalReadingPosition`. |
| `src/widgets/answer_buttons.tsx` | **HIGH** | Deviation 6: 6-button layout, `SplitButton`s + shared offset picker, green in-app Open Editor flow, `(OpenLink)` trackers, rotation warning, Skip `rescheduleWithoutReview`. Deviation 13: shield/pdf-capture/Dismiss-inheritance gates, accordion buttons hidden. Deviation 14: `<QueueDistribution highlightPriority=…/>` + the `showInfoBar` gate (**hooks above the early returns**), and the priority pill REMOVED from the bar. |
| `src/lib/incremental_rem/index.ts` | **HIGH** | rotation read, helpers, First-Added/inherited-rotation init, `updateReviewRemData` `newNextRepDate` return. |
| `src/lib/incremental_rem/types.ts` | low | Keep both `rotation` and upstream `createdAt`. |
| `src/lib/consts.ts` | low | `firstAddedSlotCode`, `rotationSlotCode`, `queueBackNavKey` (Deviation 8); Deviation 14: `queueInfoBarModeId`/`QueueInfoBarMode` + `queueToolbarPriorityModeId`/`QueueToolbarPriorityMode`. |
| `src/register/powerups.tsx` | low | First Added (DATE) + Rotation (TEXT) slots. |
| `src/components/NextRepTime.tsx` | low | rotation-aware display branch. |
| `package.json` / `package-lock.json` | low | Keep `parse-duration`; regenerate lock via `npm install`. |
| `src/register/callbacks.ts` | **HIGH** | Deviations 9+10: queue-counter buckets in `GetNextCard`; remeda **multi-projection** `sortBy` tiebreak (never the lodash array-of-iteratees form); lottery ordering. |
| `src/lib/sorting.ts` | reconcile | Deviation 10: `nextRepDate` tiebreak (`?? 0` guard) in the `sort` feeding `applyPriorityWeightedLottery` — conflicted in the `be390d5` merge. |
| `src/lib/session_helpers.ts` | reconcile | Deviations 8+9: `calculateDueIncRemStats` rename + `getDueIncRemPriorityBuckets`; `queueBackNavKey` reset in `resetQueueSession`. |
| `src/widgets/queue.tsx` | **HIGH** | Deviation 8: due-on-encounter auto-skip effect (keyed on `ctx.remId` only) + `queueBackNavKey` consume-first early-out. Deviation 11: outline-first (`offerOutlineToggle` is a plain pdf/html type check, `outlineView` defaults true, render branch yields `null` while resolving). Deviation 13: `offerOutlineToggle &&= FORK_FEATURES.pdfReader`, the `!pdfReader` terminal `ExtractViewer` branch, engagement calls gated. |
| `src/lib/ui_helpers.ts` | low | Deviation 9: `registerQueueCounter` optional `priorityBuckets` arg. Deviation 14: buckets are **no longer appended** to the counter CSS (console line only) — a naive accept-upstream restores them. |
| `src/register/events.ts` | low | Deviation 9: QueueEnter passes count + buckets to `registerQueueCounter`. Deviation 13: flag-gated wiring of `registerQueueSessionTracking` / `registerHoveredReferenceTracking` + import. |
| `src/components/IncRemTable.tsx` | low | Deviation 10: "Queue Order" `nextRepDate` tiebreak. |
| `README.md` | reconcile | **Fork-owned** (Deviation 12): keep ours wholesale; upstream's README changes only prompt a content review. |
| `README_ES.md` / `README_PT-BR.md` | reconcile | Deleted by the fork (Deviation 12) — re-delete if upstream re-adds; expect modify/delete conflicts. |
| `src/lib/fork_gates.ts` | none | Fork-only new file (Deviation 13) — cannot conflict; re-verify deny-list ids after each sync. |
| `src/widgets/history_sidebar.tsx` | none | Fork-only new file (Deviation 13) — cannot conflict. |
| `src/widgets/incremental_history.tsx` / `flashcard_history.tsx` / `rem_history.tsx` | low | Deviation 13: `export` on the component + `if (!FORK_FEATURES.combinedHistoryTab) renderWidget(X)` guard + `FORK_FEATURES` import. |
| `src/register/tracker.ts` | low | Deviation 13: T2 bugfix — clear `plugin_operation_active` on the cascade watcher's prioritisation-off early return. |
| `src/lib/review_actions.ts` | low | Deviation 13: `FORK_FEATURES.pdfReader` guard on the pdf position write + import. |
| `src/widgets/index.tsx` | low | Deviation 13: `installForkGates` + `registerForkWidgets` calls + import. |
| `src/lib/open_editor_link_tag.ts` | none | Fork-only new file — cannot conflict. |
| `src/components/buttons/SplitButton.tsx` | none | Fork-only new file — cannot conflict. |
| `CLAUDE.md` | none | Fork-only doc, absent upstream — cannot conflict. |
| `src/components/ExtractViewer.tsx` | **HIGH** | Deviation 11: the **verbatim `be390d5` file** + the `✎` sidebar toggle. Upstream rewrote this file after that commit, so expect a wholesale conflict; keep ours unless upstream passes Deviation 11's re-test. |
| `src/lib/settings.ts` | **HIGH** | Deviation 13: Hide-in-Queue moved to `tier: 'popup'`, `warningTone`, reworded descriptions, **`priorityEditorDisplayMode` default `'all'` → `'incRemOnly'`** (in upstream's `IE_SETTINGS_DEFAULTS` — a sync silently reverts it). Deviation 14: `queue-info-bar-mode` + `queue-toolbar-priority-mode` (id, type, default, schema entry — four places each). |
| `src/widgets/ie_settings.tsx` | reconcile | Deviation 13: fork-owned section layout (`FORK_IE_LAYOUT` + `blocks`), `groupSpec()`, widened `activeGroup`, `danger` warning callout, row/group filtering by `FORK_HIDDEN_IE_*`. |
| `src/widgets/priority_editor.tsx` | low | Deviation 13: coerce `displayMode` `'all'` → `'incRemOnly'` at the read site + the matching `??` default. |
| `src/lib/mobileUtils.ts` | low | Deviation 13: the 10 Light-Mode startup toasts routed through a `notify` gated on `FORK_FEATURES.startupModeBanner`. |
| `src/components/QueueDistribution.tsx` | none | Fork-only new file (Deviation 14) — the banded distribution **and** the geometry both info bars share. |
| `src/widgets/queue_info_bar.tsx` | none | Fork-only new file (Deviation 14). |
| `src/lib/queue_priority_source.ts` | none | Fork-only new file (Deviation 14) — the own-rem-then-own-document priority rule. |
| `src/widgets/queue_priority_chip.tsx` | none | Fork-only new file (Deviation 14) — replaces upstream's denied `queue_toolbar_priority`; keep that denied or two chips render. |

---

### Runbook

> _The concrete hashes (`2955e9a`, `7e0bc0d`, `86028a9`) **and** the sync-specific prose in the steps below (e.g. Step 4's per-file upstream themes, Step 6's "last synced `2955e9a`") are worked examples from the 2026-06-01 sync. Substitute the current base / target / HEAD values when re-running, re-derive the per-file notes from the actual delta at Step 3, and never regress "Upstream Sync Status" to an older hash._

#### Step 1 — Pre-flight (read-only)
- `git status` — confirm a clean working tree.
- Re-read the "Current Deviations" (conflict map) + "AI System Instructions" sections above.
- `git fetch upstream` — advance `upstream/main` to `2955e9a`; verify with
  `git rev-parse upstream/main`.

#### Step 2 — Safety net
- `git branch backup/pre-merge-2955e9a` — rollback anchor at `86028a9`.
- `git switch -c merge/upstream-2955e9a` — merge off `main` so `main` stays clean until verified.

#### Step 3 — Recon the real conflict surface
Enumerate which of our deviation files upstream actually touched:

```sh
git diff --stat 7e0bc0d..upstream/main -- \
  public/manifest.json src/lib/consts.ts src/register/powerups.tsx \
  src/register/commands.ts src/lib/incremental_rem/types.ts \
  src/lib/incremental_rem/index.ts src/widgets/answer_buttons.tsx \
  src/components/NextRepTime.tsx src/register/callbacks.ts src/register/events.ts \
  src/lib/sorting.ts src/lib/session_helpers.ts src/lib/ui_helpers.ts \
  src/widgets/queue.tsx src/components/IncRemTable.tsx \
  package.json package-lock.json
```

- Per high-risk file: `git log --oneline 7e0bc0d..upstream/main -- <path>` for context.
- Total churn / new files: `git diff --stat 7e0bc0d..upstream/main | tail -1` and
  `git diff --name-status 7e0bc0d..upstream/main | grep '^A'`.

#### Step 4 — Merge (merge-commit style, matching prior protocol)
- `git merge upstream/main`. Expect conflicts in the deviation files above.
- Resolve via **three-way inspection** (upstream diff vs. our custom block vs. reconciled result),
  using the Conflict-map column as the checklist. Detailed re-apply notes:
  - **commands.ts** — upstream added `quickCodes` to all commands + renamed the extraction command;
    re-apply our `Ctrl+G` registration and `(OpenLink)` URL/skip-doc logic on top.
  - **answer_buttons.tsx** — upstream priority-shield/overdue, card-cluster, `CardPriorityDisplay`
    changes; re-apply the 6-button layout (Previous/Next/Open Editor/Skip/Dismiss/⚙️ Options accordion),
    `SplitButton`s + Saturday/Monday dropdowns, green in-app Open Editor (`Promise.allSettled` ordering),
    `(OpenLink)` trackers, `hasInvalidRotation` warning, `rescheduleWithoutReview` for Skip, and the
    "Scroll to Bookmark" placement in the advanced row.
  - **incremental_rem/index.ts** — upstream inheritance-cascade/ancestral-lookup changes; re-apply the
    rotation read in `getIncrementalRemFromRem`, the freestanding helpers (`getRotationIntervalMs/Days`,
    `getInitialRotation`, `rescheduleWithoutReview`), the First-Added + inherited-rotation init blocks,
    and the `updateReviewRemData` branching that returns `newNextRepDate: nextRepDateToUse`.
- If upstream **renamed or moved** a function we hook into, adapt manually — never auto-resolve.

#### Step 5 — Verify
- `npm install` — pick up `parse-duration` + any new upstream deps; regenerate the lock.
- `npm run build` (production webpack) **must compile** — it also runs `remnote-plugin validate` and
  rebuilds `dist/` + `PluginZip.zip`. Optionally `npm run dev` for a dev-compile sanity check.
- `npx tsc --noEmit` — **current baseline: 13 errors** (was 17 before the `5f8ccdd` sync; upstream fixed 4
  in `fsrs.ts`). After a big sync the count legitimately changes, so compare *error sets*, not counts:
  capture pre- and post-merge output, diff them, and assert **zero new errors in the deviation files**.
  A new error inside a fork-custom region means a bad resolution — fix it before landing.
- **Toolchain note:** Node is installed via `nvm` at `~/.nvm/versions/node/v16.15.1` (the `.nvmrc` version)
  and is **not** on the default non-interactive `PATH`; prefix commands with
  `export PATH="$HOME/.nvm/versions/node/v16.15.1/bin:$PATH"`.
- Smoke-test (if running end-to-end): rotation scheduling + amber invalid-rotation warning,
  `(OpenLink)` Open Editor tab policy, `SplitButton` dropdowns, 6-button queue layout, `Ctrl+G`,
  First Added set on a new IncRem, PDF page-resume via `opt+t` and `Ctrl+G` (the only check that
  catches a missed `getCurrentPageKey` swap), `opt+b` skip, and Previous-after-review not auto-skipping.

#### Step 6 — Land + record
- Commit the merge; fast-forward `main` to `merge/upstream-2955e9a` (or open a PR).
- **Now** update this document per the "Logging Protocol" section below:
  - "Upstream Sync Status" → last synced `2955e9a`.
  - "Current Deviations" → adjust any file/region notes that upstream refactors forced.
  - "Changelog" → append a **Merge** entry (`7e0bc0d`→`2955e9a`, conflicts list, custom code
    preserved/adapted, compilation verified, files touched, notes).
- Delete `backup/pre-merge-2955e9a` once satisfied.

#### Rollback
- Mid-merge: `git merge --abort`.
- Post-merge (before pushing): `git reset --hard backup/pre-merge-2955e9a`.

---

## Logging Protocol

When recording a merge or edit, append an entry to the "Changelog" section below using this exact template:

```markdown
### YYYY-MM-DD — [TYPE: Merge | Edit | Fix | Refactor | Note]

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

---

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

---

### 2026-04-24 — Edit (Open Editor in-app flow + "Review with Timer" label)

**Upstream commit(s):** N/A (local edit)
**Conflicts resolved:** None
**Custom code preserved:** Yes
**Compilation verified:** Yes (`npm run build`)
**Files touched:**
- `src/widgets/answer_buttons.tsx` — Open Editor now uses in-app navigation on both mobile and desktop (`openRemAsPage` for `pdf-note`, else `plugin.window.openRem`) after queue advancement; `(OpenLink)` + URL skip-doc behavior unchanged; advanced options label renamed to **Review with Timer**
- `src/register/commands.ts` — `open-incremental-editor` (`Ctrl+G`) now mirrors answer-button flow: optional `(OpenLink)` URL tabs, queue advancement, then in-app open when applicable

**Notes:** This removes the desktop `window.open(remnote.com/document/...)` path for Open Editor while keeping the guarded external-tab behavior for `(OpenLink)` titles.

---

### 2026-04-24 — Fix (Open Editor queue removal/open race hardening)

**Upstream commit(s):** N/A (local fix)
**Conflicts resolved:** None
**Custom code preserved:** Yes
**Compilation verified:** Yes (`npm run build`)
**Files touched:**
- `src/widgets/answer_buttons.tsx` — Open Editor flow now captures PDF page history first, applies review/cache updates directly, pre-resolves `incRemType`, then dispatches `removeCurrentCardFromQueue()` and editor-open concurrently via `Promise.allSettled` to avoid widget teardown races. Saturday/Monday Open Editor dropdown paths use the same pre-resolved type strategy.

**Notes:** This addresses two race outcomes observed during testing: (1) review updated but card sometimes remained in queue, and (2) card advanced but editor sometimes failed to open. The fix mirrors the robust ordering used by the timer-based editor path while preserving `(OpenLink)` skip-doc behavior.

---

### 2026-04-24 — Edit (Open Editor visual refresh: green theme + next-date sublabel)

**Upstream commit(s):** N/A (local edit)
**Conflicts resolved:** None
**Custom code preserved:** Yes
**Compilation verified:** Yes (`npm run build`)
**Files touched:**
- `src/widgets/answer_buttons.tsx` — Open Editor uses a custom green style and now shows next repetition timing (`<NextRepTime />`) as its sublabel, with amber `invalid rotation` fallback matching the Next button
- `src/components/buttons/SplitButton.tsx` — applied custom `style` overrides to chevron segment as well, so split buttons preserve uniform theming across both halves
- `public/manifest.json` — bumped version from `0.2.174` to `0.2.175`

**Notes:** This is a UI-only refinement; Open Editor scheduling/open behavior and `(OpenLink)` routing policy are unchanged.

---

### 2026-06-01 — Merge (upstream sync to `2955e9a`)

**Upstream commit(s):** `7e0bc0d` to `2955e9a` (PR #272 through PR #286; ~245 commits)
**Conflicts resolved:** `public/manifest.json`, `src/register/commands.ts`, `src/widgets/answer_buttons.tsx`
**Custom code preserved:** Yes — adapted (one forced helper migration, see below)
**Compilation verified:** Yes (production `webpack` build + zip; manifest `validate` passed; `tsc` errors 17, all pre-existing, none in the 3 resolved files)
**Files touched:**
- `public/manifest.json` — kept fork `id`/`name`/`repoUrl`/`unlisted`; accepted upstream `version` (patch 175 → 259) and the new `supportUrl`/`projectUrl`/`changeLogUrl` fields. Documented `id`/`name` as overrides (this doc previously listed only `repoUrl`/`unlisted` — drift corrected in Deviation 1).
- `src/register/commands.ts` — import conflict was additive on both sides (kept our `open_editor_link_tag` + `incRemHelpers` imports alongside upstream `text_case_converter_utils` / `outline_restructure` / `editor_selection` / `extract`). **Adaptation:** our `open-incremental-editor` (`Ctrl+G`) PDF page-capture migrated `findPDFinRem(plugin, rem)` → `getActivePdfForIncRem(plugin, rem)` — upstream replaced `findPDFinRem`; the new fn matches the 2-arg call and mirrors the answer-buttons Open Editor flow.
- `src/widgets/answer_buttons.tsx` — took upstream React import superset (`useRef`, `useLayoutEffect`); migrated pdfUtils import to upstream set (`getActivePdfForIncRem`, `findHTMLinRem`, `resolveSessionBookmarkCarry`; dropped unused `findPDFinRem`) while keeping our `open_editor_link_tag` import; preserved our `externalUrls` + `remTitleEndsWithOpenLinkTagState` trackers and took upstream's improved bookmark comment (now covers pdf + html doc reps).
- Auto-merged cleanly (our additions sat in separate regions): `src/lib/consts.ts`, `src/lib/incremental_rem/index.ts`, `src/register/powerups.tsx`. Untouched upstream (no conflict): `src/lib/incremental_rem/types.ts`, `src/components/NextRepTime.tsx`, `package.json`/lock, and both fork-only new files (`open_editor_link_tag.ts`, `SplitButton.tsx`).
- Plus ~100 upstream-only files: Study Dashboard, Outline Restructure (preview/undo), Mastery Drill, Rem History widget + global open-Rem listener, wide Weighted Shield popup, Text Case converter, cloze auto-priority, queue-display powerups/commands, `quickCodes` across commands, `createExtract` + `getActivePdfForIncRem` refactors; removed 3 legacy toolbar widgets (`create_inc_rem_toolbar`, `pdf_bookmark_toolbar`, `toggle_incremental_toolbar`).

**Notes:** Large delta (~6 weeks). Only 3 files conflicted; resolutions were additive except the single `findPDFinRem` → `getActivePdfForIncRem` migration forced by an upstream API replacement. Merge performed on branch `merge/upstream-2955e9a`; backup branch `backup/pre-merge-2955e9a` (at `86028a9`) was kept until the merge was verified in-app and has since been deleted. The forward-looking runbook is in the "Upstream Merge Runbook" section of this document (originally kept in `UPSTREAM_MERGE_PLAN.md` as the reusable procedure for future syncs).

---

### 2026-06-01 — Edit (Next/Skip queue shortcuts, due-on-encounter auto-skip, queue-counter priority distribution)

**Upstream commit(s):** N/A (local features, layered on top of merge commit `996c710`)
**Conflicts resolved:** None
**Custom code preserved:** Yes
**Compilation verified:** Yes (production `webpack` build + zip; `tsc` errors 17, all pre-existing, none in edited files)
**Files touched:**
- `src/register/commands.ts` — extracted upstream's Next-in-queue action into shared `runNextInQueueAction`; added `next-in-queue-alt` (default `opt+t`) and `skip-in-queue` (default `opt+b`), registered like `open-incremental-editor` so they're rebindable in RemNote → Settings → Shortcuts (see Deviation 3.1).
- `src/widgets/answer_buttons.tsx` — Next tooltip now reads "Next (Cmd+Right / Ctrl+Right, or Opt+T)"; Skip tooltip "Skip (Opt+B): …".
- `src/widgets/queue.tsx` — added due-on-encounter guard to `QueueComponent`: on first encounter of each item (effect keyed on `ctx.remId`) reads the fresh `nextRepDate` and calls `removeCurrentCardFromQueue(false)` if `!isIncRemDue`. Fixes future-dated items lingering in a stale cross-device queue (see Deviation 8).
- `src/lib/session_helpers.ts` — added `getDueIncRemPriorityBuckets()`; renamed `calculateDueIncRemCount` → `calculateDueIncRemStats` (returns `{ count, priorityBuckets }`).
- `src/lib/ui_helpers.ts` — `registerQueueCounter` gained optional `priorityBuckets` arg → appends ` (x, y, z, u)` to the counter.
- `src/register/events.ts` — QueueEnter passes count + buckets to `registerQueueCounter`.
- `src/register/callbacks.ts` — `GetNextCard` counter path now calls `registerQueueCounter` with buckets from `filtered` (see Deviation 9).

**Notes:** Three independent local features. (1) `opt+t`/`opt+b` are defaults only (user-rebindable). (2) The due-check effect is intentionally non-reactive (keyed on `ctx.remId`) to avoid skipping the wrong card during the user's own review. (3) Queue counter now reads e.g. `1440 + 1610 (x, y, z, u)` where the four numbers are due IncRems in priority ranges 0-10 / 11-30 / 31-60 / 61-100; both the QueueEnter and live GetNextCard counter paths emit the distribution. All edits are uncommitted on `main`, layered on merge commit `996c710` (unpushed).

---

### 2026-06-02 — Fix (due-on-encounter auto-skip: back-navigation exception)

**Upstream commit(s):** N/A (local fix to Deviation 8)
**Conflicts resolved:** None
**Custom code preserved:** Yes
**Compilation verified:** Yes (production `webpack` build + zip; `tsc` errors 17, all pre-existing, none in edited files)
**Files touched:**
- `src/lib/consts.ts` — added `queueBackNavKey` session-flag constant.
- `src/widgets/answer_buttons.tsx` — Previous button sets `queueBackNavKey = true` before `goBackToPreviousCard()`.
- `src/widgets/queue.tsx` — due-check effect consumes `queueBackNavKey` as its first step; if set, clears it and returns without the due check (shows the item).
- `src/lib/session_helpers.ts` — reset `queueBackNavKey` to `false` in `resetQueueSession`.

**Notes:** Fixes a regression from the new due-on-encounter auto-skip (Deviation 8): after reviewing an item (Next), its `nextRepDate` moves to the future, so pressing **Previous** to revisit it tripped the due-check and removed it. "Seen" couldn't distinguish this from a genuine stale item because `seenRemInSessionKey` is written at show-time (callbacks.ts:252). The one-shot back-nav flag is the discriminator. Genuine stale items encountered going forward are still auto-skipped. Minor known edge: Previous landing on a non-plugin card consumes the flag on the next IncRem instead (rare, one item, bounded per session).

---

### 2026-06-15 — Edit (Equal-priority tiebreak by nextRepDate: most overdue first)

**Upstream commit(s):** N/A (local feature)
**Conflicts resolved:** None
**Custom code preserved:** Yes
**Compilation verified:** Partially — `npm run build` (webpack, transpile-only) succeeded, but this claim was **inaccurate**: the `callbacks.ts` change introduced 4 `tsc` errors (count 17 → 21) **and a runtime crash** that webpack's transpile-only build never surfaced. **⚠️ Corrected by the 2026-06-15 — Fix below.**
**Files touched:**
- `src/register/callbacks.ts` — `GetNextCard` sort changed from single-key `_.sortBy` to the lodash-style two-iteratee array form `_.sortBy(arr, [primaryKey, nextRepDate])` — **broken** because `_` is remeda, not lodash (see the 2026-06-15 Fix and Deviation 10).
- `src/components/IncRemTable.tsx` — "Queue Order" sort now `a.priority - b.priority || a.nextRepDate - b.nextRepDate` so the table preview matches the live queue.
- `src/lib/sorting.ts` — `applySortingCriteria` adds a guarded `nextRepDate` secondary key (`?? 0` so flashcards are unaffected); used by Priority Review Documents.
- `public/manifest.json` — bumped version `0.2.259` → `0.2.260`.
- `FORK_TRACKING.md` — added Deviation 10 and this changelog entry; corrected Deviation 3.1 `removeCurrentCardFromQueue(false)` → `()` to match the code (audit fix).

**Notes:** Previously priority was the only sort key, so ties fell back to arbitrary KB load order (stable sort) or were shuffled by sorting randomness. The new secondary key is purely additive — it only orders items already tied on priority. Order of precedence is now: priority → nextRepDate (most overdue first) → randomness swaps (if sorting randomness > 0, applied last, same as before). With the default randomness of 0 the tiebreak is strict. Percentile-only sorts and the IncRemTable "priority" column sort were intentionally left unchanged. This commit also includes the previously-uncommitted back-navigation exception fix (see 2026-06-02 entry).

---

### 2026-06-15 — Merge (upstream sync to `be390d5`)

**Upstream commit(s):** `2955e9a` to `be390d5` (PR #287 + #288; 45 commits)
**Conflicts resolved:** `public/manifest.json`, `src/lib/sorting.ts` (only 2 files)
**Custom code preserved:** Yes — adapted (tiebreak layered onto upstream's new lottery)
**Compilation verified:** Yes (production `webpack` build + zip). At merge time `tsc` showed 21 errors, **unchanged** from the pre-merge state (the merge itself introduced none, confirmed via a throwaway worktree on `backup/pre-merge-be390d5`). **⚠️ Correction (see 2026-06-15 Fix below):** 4 of those 21 were **not** benign — they were the remeda `_.sortBy` bug the `9e2a2bb` tiebreak commit introduced (a runtime crash that hid all IncRems), which webpack's transpile-only build never surfaced. The **genuine baseline is 17**; this branch's Fix below removes those 4, bringing `tsc` back to 17. (My original wording here — "the true baseline is 21, 17 was stale" — was wrong and is retracted.)
**Files touched:**
- `public/manifest.json` — kept fork `id`/`name`/`repoUrl`/`unlisted`; accepted upstream `version` (patch 260 → 276).
- `src/lib/sorting.ts` — **manual resolve:** kept the Dev 10 `nextRepDate` tiebreak in the `sort` line, then delegate to upstream's new `applyPriorityWeightedLottery(sorted, randomness, weightK)` (dropping our superseded uniform-swap loop). Adopted upstream `DEFAULT_RANDOMNESS 0 → 0.1` (user decision) and the new `applyPriorityWeightedLottery` / `getWeightSelectionK` / `DEFAULT_WEIGHT_K` helpers.
- `src/register/callbacks.ts` — **auto-merged cleanly:** our `_.sortBy` tiebreak (Dev 10) + queue-counter buckets (Dev 9) coexist with upstream's new lottery block (uniform swaps → `applyPriorityWeightedLottery`, skipped in `in-order` mode) and the two new sorting imports. ⚠️ The auto-merge carried over the **broken** `_.sortBy(arr, [fn1, fn2])` tiebreak line verbatim — fixed on this branch in the 2026-06-15 Fix below.
- `src/lib/consts.ts`, `src/register/commands.ts`, `src/register/events.ts` — auto-merged (fork deviations in separate regions; upstream added analytics/pref keys, `bulletize` + `find-insert-reference` commands, and per-card weighted-shield bucketing).
- All other fork-customized files untouched upstream: `answer_buttons.tsx`, `incremental_rem/*`, `queue.tsx`, `session_helpers.ts`, `ui_helpers.ts`, `NextRepTime.tsx`, `IncRemTable.tsx`, `powerups.tsx`, `open_editor_link_tag.ts`, `SplitButton.tsx`, `package.json`.
- Plus ~40 upstream-only files: Card Memory Analytics + FSRS Calibration views, period filtering, monthly catch-up shield, scope-engine rewrite + debug tooling, rogue-CardPriority cleanup, the new ReferenceFinder widget (`opt+shift+f`), and the Bulletize command (`opt+shift+8`).

**Notes:** Small conflict surface (2 files) despite a 45-commit / ~6,500-line delta — most upstream work landed in new files or regions disjoint from the fork. The headline behavioral change is upstream's **priority-weighted lottery** replacing uniform random swaps (steeper bias toward high-priority items, `W = e^(−k·p/100)`, k=ln10); see Deviation 10. Merge performed on branch `merge/upstream-be390d5`; backup branch `backup/pre-merge-be390d5` (at `9e2a2bb`) was kept until the merge was verified in-app and has since been deleted; the pre-merge state remains reachable at commit `9e2a2bb` on `main`. Optional follow-up: align `IncRemTable.tsx` "Queue Order" randomness to the lottery so the preview matches the live queue.

---

### 2026-06-15 — Fix (No IncRems in queue — remeda `sortBy` crash carried in from `9e2a2bb`)

**Upstream commit(s):** N/A (local fix to the `9e2a2bb` tiebreak Edit / Deviation 10; the bug was carried into this branch unchanged by the `be390d5` merge)
**Conflicts resolved:** None
**Custom code preserved:** Yes
**Compilation verified:** Yes — `tsc` error count dropped **21 → 17** (the 4 removed were this bug; 17 is the genuine baseline). `npm run build` (production webpack) compiles.
**Files touched:**
- `src/register/callbacks.ts` — changed `GetNextCard`'s sort from the broken lodash array form `_.sortBy(allIncrementalRem, [fn1, fn2])` to remeda's correct multi-projection form `_.sortBy(allIncrementalRem, fn1, fn2)`. Added a comment warning that `_` is remeda, not lodash.
- `public/manifest.json` — bumped version `0.2.276` → `0.2.277`.
- `FORK_TRACKING.md` — corrected Deviation 10's `callbacks.ts` description + merge rule (remeda gotcha), the 2026-06-15 Edit entry's inaccurate "Compilation verified" line, the merge entry's `tsc` baseline note (retracted the "21 baseline" claim), and added this entry.

**Root cause:** `_` in `callbacks.ts` is **remeda** (`import * as _ from 'remeda'`). The `9e2a2bb` tiebreak commit wrote the sort using **lodash's** array-of-iteratees syntax `_.sortBy(arr, [fn1, fn2])`; remeda instead expects projections as separate args, reads the array as a `[projection, order]` pair (`order = fn2`), and throws `TypeError: comparator is not a function` from `_purryOrderRules`, crashing `GetNextCard` so no IncRems were injected. The `be390d5` merge auto-merged that broken line through unchanged, so this branch inherited the bug until this Fix. `IncRemTable.tsx` and `sorting.ts` are unaffected (native `Array.sort`).

---

### 2026-08-09 — Edit (Docs: merged `FORK_TRACKING.md` + `UPSTREAM_MERGE_PLAN.md` into `CLAUDE.md`)

**Upstream commit(s):** N/A (docs-only)
**Conflicts resolved:** None
**Custom code preserved:** Yes (no code changes)
**Compilation verified:** N/A (docs-only)
**Files touched:**
- `CLAUDE.md` — new; verbatim merge of the two docs. The runbook was embedded as the "Upstream Merge Runbook" section between "Current Deviations" and "Logging Protocol", its headings demoted one level, and all cross-file references rewritten as section references.
- `FORK_TRACKING.md`, `UPSTREAM_MERGE_PLAN.md` — deleted after verification.
- `.gitignore` — removed the dead `FORK_TRACKING.md` entry.

**Notes:** Verification (line-level diff + independent multi-agent review) confirmed no content loss. Two pre-existing inconsistencies were fixed while merging: (1) AI System Instructions rule 4 and the runbook conflict-map `manifest.json` row still said to keep only `repoUrl`/`unlisted` — updated to the four-field set (`id`, `name`, `repoUrl`, `unlisted`) that Deviation 1 has required since the 2026-06-01 drift correction; (2) the runbook's conflict map and Step 3 recon path list predated Deviations 8–10 — added the seven files from those deviations (`callbacks.ts`, `events.ts`, `sorting.ts`, `session_helpers.ts`, `ui_helpers.ts`, `queue.tsx`, `IncRemTable.tsx`). Also refreshed the stale "Our HEAD" row (`65578e9` → `abe9852`), broadened the runbook's worked-example disclaimer to cover sync-specific prose (not just hashes), and added a missing `---` separator between the two 2026-04-14 changelog entries. A follow-up code audit the same day verified all 168 technical claims in "Upstream Sync Status" + "Current Deviations" against the actual code, git state, and a fresh `npm run build` + `tsc` run (17-error baseline confirmed); the only drift found was the two backup-branch "retained" notes (branches since deleted), corrected in place.

---

### 2026-08-10 — Merge (upstream sync to `5f8ccdd`)

**Upstream commit(s):** `be390d5` to `5f8ccdd` (PR #289 through #306; 216 commits)
**Conflicts resolved:** `.gitignore`, `public/manifest.json`, `src/lib/incremental_rem/index.ts`, `src/widgets/answer_buttons.tsx`, `src/widgets/queue.tsx` (only 5 of 360 changed files)
**Custom code preserved:** Yes — adapted (three re-anchorings, see Notes)
**Compilation verified:** Yes — production `webpack` build + manifest `validate` + zip all pass. `tsc` **17 → 13** errors: **zero new**, and upstream fixed 4 in `fsrs.ts`. Verified by diffing the pre/post error *sets* and asserting no new errors in the 16 deviation files. 18/18 fork-integrity checks passed.
**Files touched:**
- `public/manifest.json` — kept fork `id`/`name`/`repoUrl`/`unlisted`; adopted upstream `version` **1.0.35** (upstream reset `0.2.294` → `1.0.x`; user decision) and the new MkDocs-site `projectUrl`/`changeLogUrl`.
- `src/lib/incremental_rem/index.ts` — took upstream's rewritten `getIncrementalRemFromRem`; re-inserted the rotation read after the priority clamp + `rotation` in the 7-key `rawData`. Our old `createdAt` block was superseded by upstream's `resolveDailyDocSlot` + `madeIncremental` fallback and removed. **Re-anchored** the First Added + inherited-Rotation writes into upstream's batched `slotWrites` and added `rotation` to `constructedIncRem`.
- `src/widgets/answer_buttons.tsx` — fork layout won wholesale; merged imports; folded upstream's 📝 Review Note and 🔖 Read point buttons into the ⚙️ Options accordion (their hooks stay above the early returns); note input renders outside the accordion; ported the ` • latest` bookmark badge.
- `src/register/commands.ts` — auto-merged, then **ported** upstream's `getCurrentPageKey` → `getIncrementalReadingPosition` migration into `runNextInQueueAction`.
- `src/widgets/queue.tsx` — import union; Deviation-8 effect auto-merged intact.
- `src/lib/sorting.ts` — adopted upstream `DEFAULT_RANDOMNESS 0.1 → 0.2` (user decision); Dev-10 tiebreak intact.
- Auto-merged correctly with fork code intact: `consts.ts`, `types.ts`, `powerups.tsx`, `ui_helpers.ts`, `callbacks.ts`, `events.ts`. Untouched upstream: `NextRepTime.tsx`, `session_helpers.ts`, `IncRemTable.tsx`, `package.json`/lock, and both fork-only files.
- Plus ~350 upstream-only files (settings-store rewrite, priority bands, slot-repair tooling, `pdf_state.ts`, read points, history notes/import, MkDocs site).

**Notes:** Small conflict surface (5 files) for a 216-commit, +35k-line delta. Three things auto-merged into *compiling but wrong* code and were fixed by hand — the reason this sync's plan pre-resolved them: **(1)** `constructedIncRem` kept upstream's literal, silently dropping `rotation` from the cache entry of every newly created IncRem (Zod strips unknown keys — no compile error); **(2)** the fork's First Added write kept its own `getDailyDocReferenceForDate` call, the redundant/racy second lookup upstream introduced `todayRef` to avoid; **(3)** `runNextInQueueAction` kept `getCurrentPageKey`, which upstream still re-exports — here it happened to break loudly because the merged import line no longer provides it, but in general that trap is silent. Also corrected during planning: the fork's container `onClick` needed upstream's `closest('input, textarea')` bail-out (our stricter guard is on `onMouseDown`), without which the new review-note input cannot be typed into. Upstream's edit to the "Open Editor in New Tab" button was deliberately dropped after reading it in full — a one-line `getIESetting` migration for a beta/www browser URL, with no counterpart in the fork's in-app `openEditorAction`. Merge performed on `merge/upstream-5f8ccdd`; backup branch `backup/pre-merge-5f8ccdd` retained at `f469c72` until verified in-app. **In-app smoke tests still pending** — `main` has not been fast-forwarded and nothing has been pushed.

---

### 2026-08-10 — Edit (Outline-first queue; no auto-opened notes sidebar)

**Upstream commit(s):** N/A (local behaviour change, layered on merge `44027fa`)
**Conflicts resolved:** None
**Custom code preserved:** Yes
**Compilation verified:** Yes (`npx tsc --noEmit` = 13 errors, unchanged baseline, none in the edited files; production `webpack` build + validate + zip pass)
**Files touched:**
- `src/components/ExtractViewer.tsx` — removed upstream's unconditional `openWidgetInRightSidebar` call from the mount effect; kept the `incremNotesSidebarRemIdKey` session write so the sidebar still targets the right Rem when opened on purpose.
- `src/widgets/queue.tsx` — `offerOutlineToggle` is now a plain `'pdf' | 'html'` type check (was: only when a read point existed on a descendant); `outlineView` defaults and resets to `true`; the render branch yields `null` instead of the Reader while `incRemRem` resolves; dropped the now-unused `getRemReadPoint` import.
- `public/manifest.json` — version `1.0.35` → `1.0.36`.
- `CLAUDE.md` — added Deviation 11 and this entry.

**Notes:** Two complaints, one theme — queue items should be the *Rem*, in the *queue body*. (1) Upstream commit `033a8c8` added a sidebar auto-open to `ExtractViewer`, which the queue renders for every rem-type card, so the right sidebar popped open on essentially every item; there was no setting to disable it, hence the code edit. (2) An IncRem with a PDF attached rendered the PDF reader; now it renders its own outline, with the Reader one click away via `📄 Read document`. Note upstream's queue body is **read-only** (`ReadOnlyRemTree`) — before `033a8c8` it was an editable `DocumentViewer`, which upstream replaced because it loses a focus fight inside the Flashcard pane (collapsing selections and sometimes rating the card). Restoring inline editing would mean reintroducing that; the `✎ Edit in sidebar` button is the deliberate alternative. See Deviation 11 for the accepted trade-offs (no in-queue page controls; Scroll-to-Highlight/Bookmark become no-ops in outline mode).

---

### 2026-08-10 — Edit (Queue body renders the Rem via `DocumentViewer`, as in the editor)

**Upstream commit(s):** N/A (local change; reverts upstream `033a8c8`'s body renderer)
**Conflicts resolved:** None
**Custom code preserved:** Yes
**Compilation verified:** Yes (`tsc` 13, unchanged baseline, none in the edited file; production build + validate + zip pass)
**Files touched:**
- `src/components/ExtractViewer.tsx` — content section swapped from `ReadOnlyRemTree` back to `<DocumentViewer documentId={rem._id} />`; restored the pre-merge container `onClick` refocus handler; removed the read-point banner's now-dead `🔖 Scroll to it` button and the `scrollTrigger` state behind it; `ReadOnlyRemTree` retained but unrendered with a FORK NOTE; footer tooltip no longer claims the view is read-only.
- `public/manifest.json` — version `1.0.36` → `1.0.37`.
- `CLAUDE.md` — extended Deviation 11 and added this entry.

**Notes:** Upstream's `ReadOnlyRemTree` re-implements rem rendering with `RemViewer` overlays, so the queue lost real formatting and powerup properties and gained a boxed green `🎯 Target Incremental Rem` badge — visually unlike the editor. `DocumentViewer` is the same component RemNote uses for a document, so the item now looks (and edits) exactly as it does in the editor. The trade-off upstream was avoiding is real and now applies again: an editable viewer inside the queue's Flashcard pane can lose a focus tug-of-war, which collapses selections and can let stray keystrokes rate the card — the restored refocus handler is the mitigation the fork used pre-merge. If that misbehaves in practice, the alternative is upstream's read-only tree (one line in the content section).

---

### 2026-08-10 — Fix (Queue document follows the pane size)

**Upstream commit(s):** N/A (local fix to Deviation 11)
**Conflicts resolved:** None
**Custom code preserved:** Yes
**Compilation verified:** Yes (`tsc` 13, unchanged baseline; production build + validate + zip pass)
**Files touched:**
- `src/components/ExtractViewer.tsx` — root `height` `100vh` → `100%`; card frame `maxWidth: 1000` removed; `alignItems` `center` → `stretch`; side/bottom padding `16px` → `12px`.
- `public/manifest.json` — version `1.0.37` → `1.0.38`.
- `CLAUDE.md` — sizing note added to Deviation 11 and this entry.

**Notes:** Two independent reasons the document didn't fit. **Height:** the widget used `100vh`, but `queue.tsx` already wraps it in a `height: 100vh`, `p-2` container — so the child was taller than its parent by that padding and the bottom was clipped. `100%` makes it fill the box it is actually given, which RemNote resizes with the pane. **Width:** the card frame was capped at `maxWidth: 1000`, so widening the queue left the document stranded at 1000px with growing empty margins; removing the cap lets it follow the pane. The `48px` top padding stays deliberately — it clears the queue's absolutely-positioned top-right buttons; the remaining `12px` is the gap to the pane edge (on top of the queue's own `p-2`, so ~20px total).

---

### 2026-08-10 — Fix (Queue document height: revert to `100vh`, definite box for the overlay)

**Upstream commit(s):** N/A (corrects the previous entry's height change)
**Conflicts resolved:** None
**Custom code preserved:** Yes
**Compilation verified:** Yes (`tsc` 13, unchanged baseline; production build + validate + zip pass)
**Files touched:**
- `src/components/ExtractViewer.tsx` — root `height` back to `100vh`; `.document-viewer-section` gains `height: '100%'` alongside `flex: 1` / `minHeight: 0`.
- `public/manifest.json` — version `1.0.38` → `1.0.39`.
- `CLAUDE.md` — corrected the Deviation 11 sizing note (the previous entry's reasoning was wrong) and added this entry.

**Notes:** The previous change to `height: '100%'` was wrong and made the card render much shorter than the pane. Reason: the queue widget is registered with `dimensions.height: 'auto'`, so RemNote sizes the plugin iframe **to our content**. A percentage height then has nothing definite to resolve against — it falls back to content height, and since `DocumentViewer` is an overlay with no intrinsic height, the content measured near-zero and the iframe collapsed with it. `100vh` breaks the cycle by giving the chain a definite height, which is why `Reader` and `IsolatedCardViewer` both use it. **SDK limitation worth remembering:** `WidgetOptions.dimensions.height` is typed `number | 'auto'` — `'100%'` is not available for height (width does accept a string), so a widget cannot declare "fill the pane"; viewport units are the practical substitute.

---

### 2026-08-10 — Fix (Queue document height: measure the pane via `widget.getDimensions`)

**Upstream commit(s):** N/A (local fix to Deviation 11)
**Conflicts resolved:** None
**Custom code preserved:** Yes
**Compilation verified:** Yes (`tsc` 13, unchanged baseline, none in the edited file; production build + validate + zip pass)
**Files touched:**
- `src/components/ExtractViewer.tsx` — added a `paneHeight` state measured with `plugin.widget.getDimensions(ctx.widgetInstanceId)` (re-measured every 1s, ignores rects under 80px so a not-yet-laid-out widget can't pin the card to a collapsed height); root height is the measured pixel value, falling back to `100vh`.
- `public/manifest.json` — version `1.0.39` → `1.0.40`.
- `CLAUDE.md` — Deviation 11 sizing note + this entry.

**Notes:** Neither CSS approach could work, and the SDK docs say why: *"Percentages can only be applied to `width`, not to `height`"* (`WidgetOptions.dimensions.height` is `number | 'auto'`). So a widget cannot declare "fill the pane" — with `'auto'` the host sizes the iframe to our content, which makes a CSS percentage circular (it collapses) and makes `100vh` the *window* height rather than the pane. The escape hatch is `plugin.widget.getDimensions(widgetInstanceId): Promise<DOMRect>`, which reports the rect the host actually allotted; it is absent from the published `WidgetOptions`/API page but present in `node_modules/@remnote/plugin-sdk/dist/name_spaces/widget.d.ts:21` and the SDK changelog (0.0.x). We start tall (`100vh`) and then pin to the measured height. If a future upstream change needs the same trick — any widget that must fill its pane — this is the mechanism.

---

### 2026-08-10 — Fix (Queue document: restore the pre-merge grid layout; drop the card wrapper)

**Upstream commit(s):** N/A (local fix to Deviation 11)
**Conflicts resolved:** None
**Custom code preserved:** Yes
**Compilation verified:** Yes (`tsc` 13, unchanged baseline, none in the edited file; production build + validate + zip pass)
**Files touched:**
- `src/components/ExtractViewer.tsx` — render rewritten to the pre-merge structure: flat CSS grid on the root (`auto [auto] 1fr auto`), breadcrumb / optional read-point banner / `DocumentViewer` / footer, no card wrapper; removed the `paneHeight` + `getDimensions` measurement added earlier the same day.
- `public/manifest.json` — version `1.0.40` → `1.0.41`.
- `CLAUDE.md` — Deviation 11 layout note rewritten; this entry.

**Notes:** Three failed height attempts before this one, worth recording so the next person doesn't repeat them. **(1)** `height: 100%` — collapses: the widget is registered `dimensions.height: 'auto'`, so the host sizes the iframe from our content and a percentage has nothing to resolve against. **(2)** `height: 100vh` — didn't help on its own, because the failing part was not the root but the chain below it. **(3)** `plugin.widget.getDimensions(widgetInstanceId)` — real API (`widget.d.ts:21`), but it reports *this widget's* rect, which under `'auto'` is our own content height: measuring it and pinning to it is circular, so it changed nothing. The actual difference from the working pre-merge fork was structural: upstream had inserted a nested flex "card" between the root and the document, so the document's height depended on a chain of `flex: 1` + `minHeight: 0` + percentage rather than a single definite grid track. Restoring the flat grid — where the document row is a `1fr` of a `100vh` root — restored the pre-merge appearance and removed the boxed look. **It does not make the document cover the full pane height, and nothing tried does** — see "Known limitation" in Deviation 11; the pre-merge fork never covered it either, and the current result is accepted. **Lesson for future merges:** if the queue document renders *worse than the pre-merge baseline*, look at the layout chain between the widget root and `DocumentViewer`, not at the root's height value.

---

### 2026-08-10 — Note (Queue document height: accepted limitation, re-test upstream)

**Upstream commit(s):** N/A (documentation only)
**Conflicts resolved:** None
**Custom code preserved:** Yes (no code change)
**Compilation verified:** N/A (docs only)
**Files touched:**
- `CLAUDE.md` — added "Known limitation" + the re-test-on-upstream-merge instruction to Deviation 11; corrected the previous entry, which implied the grid restore made the document fill the pane.

**Notes:** Confirmed by the user that the queue document **never** covered the full pane height, including well before the `5f8ccdd` merge and upstream's rendering changes — so this is an SDK limitation, not a merge regression, and the current appearance is accepted. Recorded so no future session re-litigates it: the three approaches that cannot work are percentage heights (the SDK allows them on width only), `100vh` (window, not pane), and `widget.getDimensions` (returns our own content-sized rect under `dimensions.height: 'auto'`). The standing instruction is to **test upstream's queue rendering before overriding it** at each sync — if upstream or a future SDK release makes the document fill the pane while keeping real formatting and properties, adopt it and retire that half of Deviation 11.

---

### 2026-08-11 — Fix (Queue: ExtractViewer restored verbatim from the pre-merge fork)

**Upstream commit(s):** N/A (local; left uncommitted per user instruction)
**Conflicts resolved:** None
**Custom code preserved:** Yes
**Compilation verified:** Yes (`tsc` 13, unchanged baseline, no errors in the file)
**Files touched:**
- `src/components/ExtractViewer.tsx` — replaced wholesale with `git show be390d5:src/components/ExtractViewer.tsx` (the fork's published 0.2.277 file). Compiles unchanged post-merge.
- `public/manifest.json` — version `1.0.41` → `1.0.42`.
- `CLAUDE.md` — Deviation 11 rewritten around the verbatim restore.

**Notes:** The endpoint of a day of failed geometry blending. Sequence: upstream's card layout left more whitespace above the answer buttons than the published build → a fixed `60vh` track shrank the reading area → a content-length estimate capped in `vh` collapsed (**viewport units inside a `dimensions.height:'auto'` iframe are self-referential** — the iframe is sized from our content, so `vh` chases its own tail) → fixed pixel tracks based on `screen.availHeight`, then `window.outerHeight`, still failed to show the stats footer + `✎ Edit in sidebar` on the user's machine. The user then asked for the frame exactly as their GitHub fork — which is simply the `be390d5` file, known to render correctly there (footer visible, published geometry). Restoring it verbatim also removed upstream's sidebar auto-open and `ReadOnlyRemTree` (now absent from the file entirely — future upstream edits to `ExtractViewer.tsx` will conflict wholesale; keep the verbatim file unless upstream's version passes Deviation 11's re-test). The sizing lessons stay recorded in Deviation 11's "Known limitation" paragraph.

---

### 2026-08-11 — Edit (Queue: chevrons open a granular offset picker instead of Saturday/Monday dropdowns)

**Upstream commit(s):** N/A (local feature; left uncommitted per user instruction)
**Conflicts resolved:** None
**Custom code preserved:** Yes
**Compilation verified:** Yes (`tsc` 13, unchanged baseline; the 6 SplitButton TS1117s are the pre-existing baseline errors)
**Files touched:**
- `src/components/buttons/SplitButton.tsx` — `menuItems` now optional; new `onChevronClick` (chevron becomes a plain toggle, no popover, no body-padding hack) + `chevronActive` (▼/▲) props. Dropdown mode kept for compatibility.
- `src/widgets/answer_buttons.tsx` — the three chevrons toggle ONE shared picker row below the button row (⚙️-Options styling): − / + stepper with typeable number (1–999, Enter applies, Escape closes), Days/Weeks/Months segmented toggle (calendar-aware months via `offsetToDays`), live landing-date preview, and a per-mode Apply button. `runOpenEditorWithOffset` extracted from the old Saturday/Monday editor items; removed the now-unused `today`/`daysUntilSaturday`/`daysUntilMonday`.
- `CLAUDE.md` — Deviation 6 rows (Next/Open Editor/Skip + "Offset picker" row), Deviation 6.2, merge-rule item (1), this entry.

**Notes:** Requested UX: first a fixed 1-day–4-weeks chip row replacing the two-item dropdowns, then refined the same day to a granular number+unit picker ("select number of days or weeks or months easily"). Semantics per mode are unchanged from the old dropdown items: `'next'` records a review at the offset (`runManualNext`); `'editor'` does the same then opens the editor in-app, honouring the `(OpenLink)` policy; `'skip'` reschedules without recording a review (`rescheduleWithoutReview`, which also advances the queue). Months convert via real calendar arithmetic (`dayjs().add(n,'month')` diffed in days), so "1 month" from Jan 31 lands Feb 28/29, not Mar 2.

---

### 2026-08-11 — Edit (Queue: outline colouring for Next / Open Editor / Skip)

**Upstream commit(s):** N/A (local styling; left uncommitted per user instruction)
**Conflicts resolved:** None
**Custom code preserved:** Yes
**Compilation verified:** Yes (`tsc` 13, unchanged baseline)
**Files touched:**
- `src/widgets/answer_buttons.tsx` — Next (blue), Open Editor (green) and Skip (purple, new accent) switched from solid/neutral fills to the Dismiss button's outline pattern: coloured border + font on the neutral secondary background. The picker's Apply button mirrors the same per-mode outline colours. Previous / Dismiss / ⚙️ Options unchanged. `warningStyle` still overrides Next/Open Editor with amber on invalid rotation.
- `CLAUDE.md` — Deviation 6 wording (green outline; Apply colours) and this entry.

**Notes:** User request for colour consistency across the row: every coloured button now uses border+font colouring only, like Dismiss (red). Palette: Next blue, Open Editor green, Skip purple, Dismiss red — with amber reserved for the invalid-rotation warning state.

---

### 2026-08-11 — Edit (Queue footer: tighten stats row, add tiny ✎ Sidebar button)

**Upstream commit(s):** N/A (local; left uncommitted per user instruction)
**Conflicts resolved:** None
**Custom code preserved:** Yes
**Compilation verified:** Yes (`tsc` 13, unchanged baseline)
**Files touched:**
- `src/components/ExtractViewer.tsx` — footer's `justify-between` → left-aligned `gap-4 flex-wrap` (removes the big gap between "Document • Incremental Rem" and the stats); appended a tiny blue-outline `✎ Notes` button at the row's end that sets `incremNotesSidebarRemIdKey` and opens the docked notes sidebar on click (click-only — Deviation 11's no-auto-open rule stands). A floating-panel variant with a true close toggle was built and removed the same day — see the dead-ends note in Deviation 11 (host popups can't work over a plugin float; the SDK can neither close the docked sidebar nor trigger the native `P` previewer). Final refinement: the button toggles `incremNotesSidebarRemIdKey` with state-describing labels (`✎ Open in sidebar` → filled-blue `✎ Show in queue`); while the key points at the current rem the in-queue document is unmounted (paused) so the sidebar's editor is the only interactive overlay for that rem. A 2s-heartbeat auto-remount on sidebar close was tried and removed at the user's request. Extended the consts import accordingly. The file is otherwise still the verbatim `be390d5` restore.
- `CLAUDE.md` — Deviation 11 wording + this entry.

---

### 2026-08-11 — Edit (Docs: fork-owned README; translations removed)

**Upstream commit(s):** N/A (docs-only; left uncommitted per user instruction)
**Conflicts resolved:** None
**Custom code preserved:** Yes (no code change)
**Compilation verified:** N/A (docs only)
**Files touched:**
- `README.md` — replaced with a fork notice linking upstream plus a human-readable, user-facing description of every fork difference and how to use it (written for someone familiar with the original plugin).
- `README_ES.md`, `README_PT-BR.md` — deleted (translations remain upstream's).
- `CLAUDE.md` — new AI System Instruction 10 (keep README in sync with fork behaviour), Deviation 12, conflict-map rows, this entry.

**Notes:** Standing rule going forward: any change to the fork's user-visible behaviour — added, modified, or removed, locally or via an upstream merge — must be reflected in `README.md` in the same change. The README describes the current state; the Changelog remains the historical record.

---

### 2026-08-11 — Edit (Fork feature gates: disable unused upstream subsystems; combined History tab; T2 bugfix)

**Upstream commit(s):** N/A (local; left uncommitted per user instruction)
**Conflicts resolved:** None
**Custom code preserved:** Yes
**Compilation verified:** Yes (`tsc` 13, unchanged baseline, none in edited files; production `webpack` build + validate + zip pass)
**Files touched:**
- `src/lib/fork_gates.ts` — **new**: `FORK_FEATURES` flags + registration interceptor (deny-list over registerCommand/Widget/MenuItem/CSS) + `registerForkWidgets`.
- `src/widgets/history_sidebar.tsx` — **new**: combined "History" sidebar tab (3 collapsible sections reusing upstream components).
- `src/widgets/index.tsx` — install gates before registrations; register fork widgets after upstream's.
- `src/widgets/incremental_history.tsx`, `flashcard_history.tsx`, `rem_history.tsx` — component `export` (one word each).
- `src/widgets/queue.tsx` — Reader unreachable when `!pdfReader` (terminal ExtractViewer branch incl. highlight types; 📄 button gone); engagement calls gated.
- `src/widgets/answer_buttons.tsx` — shield computation, pdf position capture, Dismiss card-priority inheritance, and Scroll/Read-point accordion buttons gated.
- `src/register/commands.ts` — Dismiss card-priority inheritance gated (+ import).
- `src/register/events.ts` — session tracking + hover tracking wiring gated (+ import).
- `src/lib/review_actions.ts` — pdf position write gated (+ import).
- `src/register/tracker.ts` — **T2 upstream bugfix**: clear `plugin_operation_active` on the prioritisation-off cascade early-return (stuck flag suppressed GlobalRemChanged).
- `CLAUDE.md` — Deviation 13, conflict-map rows, this entry. `README.md` — "Slimmed down in this fork" section (AI Instruction 10).

**Notes:** Full decision record and dependency analysis (3-explorer audit: 22-subsystem inventory, core-workflow dependency map with traps T1–T10, gating-pattern study) preceded this. Disabled: PDF/reader tools incl. the in-queue Reader, card-priority surface, shields, dashboards + practiced-queues session analytics, cloze tools, heading/outline/list/text-case utilities, reference finder, read points, video surface, debug/repair tools, Priority Review Documents. Kept: No-IncRem timer, Sorting Criteria, IncRem priority tools, the 📚 editor counter (explicitly asked), repetition-history popups, preserve-history, copy/paste-rem-sources, priority bands (unasked), Reschedule command, IncRem Main View. (Import-with-History later trimmed — see `historyImport`.) CardPriority powerup and pdfState slot remain registered (data safety, T1). All features restorable by flipping one `FORK_FEATURES` boolean.

---

### 2026-08-11 — Edit (Native settings panel reduced to Hide-in-Queue; Light Mode pinned; startup banner removed)

**Upstream commit(s):** N/A (local; left uncommitted per user instruction)
**Conflicts resolved:** None
**Custom code preserved:** Yes
**Compilation verified:** Yes (`tsc` 13, unchanged baseline; production build + validate + zip pass)
**Files touched:**
- `src/lib/fork_gates.ts` — new flags `nativeModeSettings: false` + `startupModeBanner: false`; the interceptor now also wraps `plugin.settings.registerBoolean/Number/String/DropdownSetting` and drops the four native mode settings.
- `src/lib/settings.ts` — `MORE_SETTINGS_POINTER` reworded (no performance switches left in the panel; mentions the omnibar command + `ies`).
- `src/lib/mobileUtils.ts` — the 10 "Light Mode" startup toasts in `handleMobileDetectionOnStartup` route through a `notify` gated on `startupModeBanner` (+ import).
- `CLAUDE.md` — Deviation 13 extended; this entry.

**Notes:** RemNote's native panel now shows only "Enable Hide-in-Queue Powerups and Commands", plus a standalone "ℹ️ Looking for the other settings?" signpost row beneath it (an inert one-option dropdown — native panels have no text-only rows; the old description-footer text is stripped to avoid duplication). The four removed settings read as their defaults via `readRawSetting`'s fallback — prioritisation off, performance permanently 'light' (Full Mode retired in this fork), auto-light on mobile/web — so no reader code paths change. Next planned step: clean the IE Settings popup itself (it still lists the four read-only, plus settings for gated features).

---

### 2026-08-11 — Edit (IE Settings popup: hide sections for disabled subsystems; trim history-import)

**Upstream commit(s):** N/A (local; left uncommitted per user instruction)
**Conflicts resolved:** None
**Custom code preserved:** Yes
**Compilation verified:** Yes (`tsc` 13, unchanged baseline; production build + validate + zip pass)
**Files touched:**
- `src/lib/fork_gates.ts` — `historyImport: false` flag (denies `import-incremental-history` + its popup; Reschedule and IncRem Main View were offered and kept); exported `FORK_HIDDEN_IE_GROUPS` = `flashcardPriority`, `performance`, `masteryDrill`, `fsrs`.
- `src/widgets/ie_settings.tsx` — renders the fork's own section layout (`FORK_IE_LAYOUT`) instead of upstream's per-setting `group` field, with a `groupSpec()` helper that resolves labels/blurbs from `FORK_IE_GROUPS` and falls back to upstream's specs; `activeGroup` widened to `string` and defaulted to the first visible section (upstream's default `'flashcardPriority'` is hidden).
- `CLAUDE.md` — Deviation 13 notes + this entry.

**Notes:** Popup cleanup per user decisions: the Flashcard Prioritisation, Performance, Mastery Drill and (follow-up) FSRS sections are hidden entirely; **Other and the full Priority/Queue sections stay visible** (the earlier proposal to prune Default Card Priority + shield/toolbar/auto-focus queue settings was explicitly narrowed by the user — do not re-prune without asking). Hidden ≠ deleted: values remain stored and every read path still resolves via `readRawSetting`. The popup now shows 6 sections (Scheduling, Priority, Queue, Editor Indicators, Integrations, Other).

---

### 2026-08-11 — Edit (Study Dashboard restored; kept `phr` pending decision)

**Upstream commit(s):** N/A (local; left uncommitted per user instruction)
**Conflicts resolved:** None
**Custom code preserved:** Yes
**Compilation verified:** Yes (`tsc` 13, unchanged baseline; production build passes)
**Files touched:**
- `src/lib/fork_gates.ts` — the `dashboards` flag split: `studyDashboard: true` (restores `open-study-dashboard` + the `study_dashboard` widget) and `practicedQueues: false` (Practiced Queues tab + toolbar chip stay denied). `sessionAnalytics` stays off — the dashboard computes from rep histories, retroactively, and needs no session tracking.
- `CLAUDE.md` — Deviation 13 group list + this entry.

**Notes:** After a plain-language walkthrough of what the dashboard shows (KB-wide reviews/time-per-day incl. IncRems) vs what the per-rem views cover, the user chose to keep it. Because the dashboard reads `flashcardResponseTimeLimitId`, the "Other" settings section keeps a live reader and stays visible. `phr` (Preserve history & remove) was explained and left UNTOUCHED — no decision yet; ask before removing.

---

### 2026-08-11 — Edit (Omnibar: every surviving command prefixed "Incremental: ")

**Upstream commit(s):** N/A (local; left uncommitted per user instruction)
**Conflicts resolved:** None
**Custom code preserved:** Yes
**Compilation verified:** Yes (`tsc` 13, unchanged baseline; production build passes)
**Files touched:**
- `src/lib/fork_gates.ts` — the registerCommand wrapper rewrites `command.name` (strip a leading "Incremental Everything:", then prefix `Incremental: `) and applies `FORK_COMMAND_OVERRIDES` — an id-keyed map of optional `name` / `description` / `keyboardShortcut` replacements. Central: no upstream command strings edited.
- `CLAUDE.md` — this entry.

**Notes:** Requested after the restored Study Dashboard proved undiscoverable ("Open Study Dashboard" carried no plugin marker). All 27 surviving commands now group under "Incremental: " in the omnibar. A follow-up wording pass added `FORK_COMMAND_NAMES` (id-keyed rename map, applied before the prefix): de-stuttered 5 names (`Make Incremental (Extract)` → `Extract / Tag Rem`, `Open Incremental Editor` → `Open Editor`, `Dismiss/Reschedule Incremental Rem` → `Dismiss/Reschedule Rem`, `Open Incremental Rems Main View` → `Open Rems Table`), replaced implementation-speak with intent (`Preserve history & remove` → `Delete Rem, Keep Study History`, `Review in Editor (Execute Repetition)` → `Review in Editor (Timer)`, `Cancel No Inc Rem Timer` → `Cancel Queue Pause Timer`, `Quick Increase/Decrease Priority Number` → `Make Less/More Important`, `Remove Parent/Grandparent` → `… from Card`), dropped the disabled PDF-highlights mention from `Refresh Priority Badges`, and clarified `Open Queue Sorting Criteria` / `Next Item in Queue (alt shortcut)`. 13 names keep upstream wording. Quick codes and keyboard shortcuts are untouched throughout.

---

### 2026-08-11 — Fix (Combined History tab crashed: guard the imported widgets' self-render)

**Upstream commit(s):** N/A (local; left uncommitted per user instruction)
**Conflicts resolved:** None
**Custom code preserved:** Yes
**Compilation verified:** Yes (`tsc` 13, unchanged baseline; production build passes)
**Files touched:**
- `src/widgets/incremental_history.tsx`, `flashcard_history.tsx`, `rem_history.tsx` — module-scope `renderWidget(X)` → `if (!FORK_FEATURES.combinedHistoryTab) renderWidget(X)` (+ import).
- `src/widgets/history_sidebar.tsx` — header comment corrected (it recorded the wrong assumption).
- `CLAUDE.md` — Deviation 13 note + conflict-map row corrected; this entry.

**Notes:** In-app the sidebar threw `unmountComponentAtNode(...): Target container is not a DOM element` from `flashcard_history.tsx`'s `renderWidget` inside the `history_sidebar` bundle; dismissing the error left only the first section visible. Cause: importing those modules for their components also executes their `renderWidget`, whose HMR branch unmounts `window.__plugin.mountDiv` — absent in a non-entry bundle. This was the risk the plan flagged ("verify at implementation; fallback = move the component bodies to `src/components/history/`"); the cheaper guard resolved it, so the move was unnecessary.

---

### 2026-08-12 — Edit (IE Settings popup: hide six settings with no live consumer)

**Upstream commit(s):** N/A (local; left uncommitted per user instruction)
**Conflicts resolved:** None
**Custom code preserved:** Yes
**Compilation verified:** Yes (`tsc` 13, unchanged baseline; production build passes)
**Files touched:**
- `src/lib/fork_gates.ts` — new `FORK_HIDDEN_IE_SETTINGS` set: `defaultCardPriority`, `display-priority-shield`, `display-weighted-shield`, `display-queue-toolbar-priority`, `auto-focus-queue-dashboard`, `remnote-environment`, `hideCardPriorityTag` (added 2026-08-12 — nothing writes CardPriority tags any more and its default is already 'hidden').
- `src/widgets/ie_settings.tsx` — the visible-groups computation now also filters rows and drops groups left empty.
- `CLAUDE.md` — this entry.

**Notes:** Chosen after auditing each remaining setting's consumers post-debloat. Each hidden row is provably inert: the two shield toggles were already dead even pre-fork (their render sites also require `!useLightMode`, and light is the only mode), the toolbar-priority toggle's sole consumer is the denied `queue_toolbar_priority` widget, auto-focus targets the denied Practiced Queues tab, Default Card Priority feeds the disabled card-priority engine, and RemNote Environment only fed the "Open in New Tab" URL this fork replaced with in-app opening. **Explicitly kept** after the same audit: all 5 Scheduling settings, Default IncRem Priority / Priority Step Size / Priority Widget in Editor, Collapse Queue Top Bar, Use Isolated Card View, all 5 Editor Indicators (incl. Show Priority Badges in Table Cells — bands are still live), Hide-in-Queue, and Flashcard Response Time Limit (read by the restored Study Dashboard and `phr`). Popup is now **17 settings in 6 sections**.

---

### 2026-08-12 — Edit (IE Settings popup: consolidate 6 sections into 4, fork-owned layout)

**Upstream commit(s):** N/A (local; left uncommitted per user instruction)
**Conflicts resolved:** None
**Custom code preserved:** Yes
**Compilation verified:** Yes (`tsc` 13, unchanged baseline; production build passes)
**Files touched:**
- `src/lib/fork_gates.ts` — `FORK_IE_GROUPS` (3 section specs: General / Priority & Scheduling / Advanced, each with a blurb) + `FORK_IE_LAYOUT` (ordered section → setting-id lists, 17 ids, with optional `blocks` for sub-headings).
- `src/widgets/ie_settings.tsx` — builds its sections from `FORK_IE_LAYOUT` (skipping ids absent from the schema, e.g. after an upstream rename, and dropping empty sections); renders optional sub-headings when a section defines `blocks` (a block whose rows are all filtered out by search or a `showWhen` rule drops its heading too); label/blurb/help via `groupSpec()`; `activeGroup` widened + defaulted to the first visible section.
- `CLAUDE.md` — this entry.

**Notes:** Layout settled after several rounds of user feedback (upstream's 6 sections → 4 → 3). Final:
1. **General** — split by sub-heading: *Queue* (Collapse Queue Top Bar, Isolated Card View) then *Appearance* (Priority Widget in Editor, both left borders, both tag-hiders, table badges).
2. **Priority & Scheduling** — split by sub-heading: *Priority* (Default IncRem Priority, Priority Step Size) then *Scheduling* (`Initial Interval` first because it applies to both curves, then the `Use Beta Scheduler` selector, then only the selected curve's parameters — upstream's `showWhen` rules, honoured by the popup via `isSettingVisible`, hide `Multiplier` while Beta is on and the two Beta params while it is off).
3. **Advanced** — Hide-in-Queue (now editable here, default off), Flashcard Response Time Limit.

Interim namings/orders not to revive: a "General" section holding scheduling values, a standalone "Beta Scheduler" section, "Appearance" for the display group, "Scheduling & Priority" with scheduling first, and the selector above Initial Interval. Upstream's `IE_SETTINGS_SCHEMA` and every setting's `group` field are untouched — the fork owns presentation only, so a sync merges upstream's schema cleanly. **Merge check:** after a sync, verify `FORK_IE_LAYOUT` still covers every setting worth showing — a newly added upstream setting will NOT appear until its id is added here (deliberate: new upstream settings are opt-in for this fork).

---

### 2026-08-12 — Edit (All settings in one place: Hide-in-Queue moved to the popup; native panel is a signpost only)

**Upstream commit(s):** N/A (local; left uncommitted per user instruction)
**Conflicts resolved:** None
**Custom code preserved:** Yes
**Compilation verified:** Yes (`tsc` 13, unchanged baseline; production build passes)
**Files touched:**
- `src/lib/settings.ts` — `enable-hide-in-queue-integration` `tier: 'native'` → `'popup'` (+ FORK comment). Default already `false`; its long description (incl. the duplicate-powerup warning and docs link) is unchanged and now renders in the popup.
- `src/lib/fork_gates.ts` — new `registerForkSettingsSignpost()`; the interceptor's Hide-in-Queue special case (footer-strip + inline pointer registration) removed, since that setting no longer registers natively; Advanced blurb no longer claims the switch lives in RemNote's panel; General section split into *Queue* / *Appearance* sub-headings.
- `src/widgets/index.tsx` — calls `registerForkSettingsSignpost` after `registerPluginSettings`.
- `CLAUDE.md` — Deviation 13 + this entry.

**Notes:** Goal was "one place for every setting". Hiding the row was not enough: native-tier settings are read-only in the popup (`SettingRow`'s `readOnly = spec.tier === 'native'`, and `setIESetting` refuses native writes), so the tier had to move. Reads now resolve from the plugin's synced store via `readRawSetting`'s popup branch. **Migration caveat:** a KB that had Hide-in-Queue enabled in RemNote's panel falls back to the default `false` after this change and must re-enable it in the popup — acceptable here (the fork owner keeps it off), but worth knowing. The signpost row's text was reworded to say all settings are in the plugin's window.

---

### 2026-08-12 — Edit (Hide-in-Queue conflict warning: red callout instead of buried prose)

**Upstream commit(s):** N/A (local; left uncommitted per user instruction)
**Conflicts resolved:** None
**Custom code preserved:** Yes
**Compilation verified:** Yes (`tsc` 13, unchanged baseline; production build passes)
**Files touched:**
- `src/lib/settings.ts` — new optional `warningTone?: 'warn' | 'danger'` on `SettingSpecBase`; the Hide-in-Queue duplicate-powerup warning moved out of the middle of `description` into the `warning` field with `warningTone: 'danger'`.
- `src/widgets/ie_settings.tsx` — the warning callout renders red (2px red border, red tint, `⛔ WARNING:` prefix) when `warningTone === 'danger'`, keeping the existing amber style otherwise.
- `CLAUDE.md` — this entry.

**Notes:** Upstream already had a `warning` field with an amber callout, but this text sat as a plain paragraph inside `description`, so the one warning in the plugin whose consequence is *fatal* (duplicate powerup registration with the standalone Hide in Queue plugin) read like body copy. Amber is upstream's "this is heavy" tone (e.g. Enable Flashcard Prioritisation); red is reserved for "ignoring this breaks the plugin". The tone field is additive and optional, so upstream warnings keep their existing appearance.

---

### 2026-08-12 — Edit (General section: drop the CardPriority-tag setting; reword three stale descriptions)

**Upstream commit(s):** N/A (local; left uncommitted per user instruction)
**Conflicts resolved:** None
**Custom code preserved:** Yes
**Compilation verified:** Yes (`tsc` 13, unchanged baseline; production build passes)
**Files touched:**
- `src/lib/fork_gates.ts` — `hideCardPriorityTag` added to `FORK_HIDDEN_IE_SETTINGS` and removed from the General layout (flat list + Appearance block, kept in sync).
- `src/lib/settings.ts` — three fork rewordings: **Isolated Card View** description no longer says non-isolated items "appear inside the PDF/HTML reader" (this fork has none — they show the Rem in document context); **Priority Widget in Editor** options `Show for IncRem and Cards / Show only for IncRem / Disable` → `All rems / Incremental Rems only / Off`; **Show Priority Badges in Table Cells** now names the command as renamed by the fork (`Incremental: Refresh Priority Badges (Tables)`).
- `CLAUDE.md` — hidden-settings list + this entry.

**Notes:** Audit of the General section after the user noticed lingering CardPriority references. Kept unchanged: Collapse Queue Top Bar, Green/Yellow left borders, Hide Dismissed Tag (Dismiss is core, so those tags really exist), Show Priority Badges (bands are live). General now reads: *Queue* (2) + *Appearance* (5) = 7 settings; popup total **16**.

---

### 2026-08-12 — Edit (Shortcuts audit: two DevTools-colliding defaults moved; three descriptions corrected)

**Upstream commit(s):** N/A (local; left uncommitted per user instruction)
**Conflicts resolved:** None
**Custom code preserved:** Yes
**Compilation verified:** Yes (`tsc` 13, unchanged baseline; production build passes)
**Files touched:**
- `src/lib/fork_gates.ts` — `FORK_COMMAND_NAMES` generalised into `FORK_COMMAND_OVERRIDES` (`{ name?, description?, keyboardShortcut? }` per command id); the interceptor now applies all three. New overrides: `review-increm-in-editor` → `ctrl+shift+e`, `toggle-ignore-tag` → `ctrl+shift+g`, `set-priority-light` description drops "and Card", `quick-increase/decrease-priority` descriptions name the Priority Step Size and its real default (**5**, upstream's text said 10).
- `CLAUDE.md` — Deviation 13 note + this entry.

**Notes:** Audit of all registered shortcuts. 17 were active; the debloat had already freed 13 more (their commands are denied). Nothing needed removing — every active binding belongs to a kept feature. Two defaults collided with Chrome DevTools, which matters because this fork runs in a browser tab: `Ctrl+Shift+J` (console) on Review in Editor and `Ctrl+Shift+I` (inspector) on Toggle Ignore Tag; both moved and both remain rebindable in RemNote → Settings → Shortcuts. Note for a future audit: two commands declare `id:` via a const (`dismissIncRemCommandId` = `ctrl+d`, `nextInQueueCommandId` = `cmd+right`), so a naive string-literal scan of `commands.ts` misses them.

---

### 2026-08-12 — Edit (Queue info bar on every item; priority distribution moved into it)

**Upstream commit(s):** N/A (local; left uncommitted per user instruction)
**Conflicts resolved:** None
**Custom code preserved:** Yes
**Compilation verified:** Yes (`tsc` 13, unchanged baseline, none in the touched files; production build + validate + zip pass; dev server restarted and `queue_info_bar.js` served)
**Files touched:**
- `src/components/QueueDistribution.tsx` *(new)* — the due-IncRem priority distribution. Ended the day as a proportional stacked bar over the ten `priority_bands.ts` bands (counts only, via `bandForPriority`); also exports `shouldShowQueueInfoBar` and the bar/badge geometry shared by both bars.
- `src/widgets/queue_info_bar.tsx` *(new)* — `FlashcardUnder` widget carrying the bar for non-IncRem items (distribution + that card's reps/minutes); returns `null` while an IncRem queue item is on screen.
- `src/widgets/answer_buttons.tsx` — distribution prepended to the IncRem bar; whole bar gated on `shouldShowQueueInfoBar(mode, true, isMobile)`; its own priority pill/percentiles later removed (Fifth follow-up).
- `src/lib/queue_priority_source.ts` *(new)* — the shared own-rem-then-own-document priority rule (`resolveQueuePriority` / `readRemPriority`), extracted from `queue_info_bar` once a second surface needed it.
- `src/widgets/queue_priority_chip.tsx` *(new)* — the queue toolbar's `P50 (92.5%)` chip, replacing upstream's denied `queue_toolbar_priority`.
- `src/lib/consts.ts` — `queueInfoBarModeId` / `QueueInfoBarMode` and `queueToolbarPriorityModeId` / `QueueToolbarPriorityMode`.
- `src/lib/settings.ts` — two 4-option dropdowns (info bar, default `allExceptMobile`; toolbar chip, default `always`), placed first under General → Queue.
- `src/lib/ui_helpers.ts` — the top counter no longer appends the bucket string (still shows `+ <count>`).
- `src/lib/fork_gates.ts` — registers both fork widgets; splits `queue_toolbar_priority` out of the `practicedQueues` group into its own `upstreamQueueToolbarPriority: false` flag; adds the new setting id to the General → Queue layout.
- `CLAUDE.md` — Deviation 14 + this entry. `README.md` — info-bar and priority-chip sections.

**Follow-up fix (same day, in-app):** the first cut put the gate's two hooks beside the render code, *below* `if (!coreData)`. `tsc` and webpack were both happy; in the app the whole answer-buttons widget vanished for IncRems — bar **and** buttons — because the hook count changes once `coreData` resolves and React throws. Moved them into the hooks section next to the other `useIESetting` calls. Deviation 6 already recorded this trap for upstream's note/read-point hooks; Deviation 14 now records it for these.

**Follow-up (same day, on user request):** the two bars were visibly different sizes and the flashcard one had no priority. Fixed by (a) moving the bar + badge geometry into `QueueDistribution.tsx` as shared helpers that both widgets call — including the outer padding, which is now literally the same constant as `answer_buttons`' `containerStyle` — and (b) giving the flashcard bar a priority chip. The bail also changed from "the rem is an IncRem" to "an IncRem queue item is on screen" (`incrementalQueueActiveKey`), because the old test blanked the bar for flashcards whose rem is itself an IncRem.

**Second follow-up (same day, user correction):** the chip first resolved its priority by walking up to the *closest Incremental ancestor at any depth*, which meant a card in an unprioritised document could show a priority from somewhere far above it. Per the user's rule it now resolves **the card's own rem first, then only its own document**, with no chip at all when neither has a priority. (The own-rem step was briefly dropped on a literal reading of "otherwise it should not show priority" and restored when the user confirmed it: a rem with a priority of its own should use it.) Both sources go through the same `readRemPriority`, so a dismissed rem or document contributes its last recorded history priority.

**Fifth follow-up (same day, user request):** **priority left the info bars entirely and lives only in the toolbar chip.** Both bars previously drew a priority pill (`answer_buttons`: pill + `(x% KB, y% Doc)` + the ⟳ stale-doc hint; `queue_info_bar`: pill + `(x% KB)` + the `own` / `↖ document` badge) — duplicating what the chip already showed two inches above. Both blocks were deleted, the chip now renders `P50 (92.5%)`, and everything explanatory moved into its hover tooltip. **Both bars still call `resolveQueuePriority`, now only to colour their left border** — if that ever needs trimming for cost, that is the call to remove.

**Fourth follow-up (same day, user request):** the distribution was redrawn. It had been four labelled chips on the fork's own `0–10 / 11–30 / 31–60 / 61–100` buckets; the user asked for something glanceable that matches the plugin's existing priority colours, and to adopt the plugin's bands if it has more. It does — ten, in `priority_bands.ts` — so the readout is now a proportional stacked bar over those ten, coloured by the plugin's own band-colour function. `getDueIncRemPriorityBuckets` (4 buckets) survives untouched for the console line in `ui_helpers`.

**Third follow-up (same day, user request):** the queue toolbar's `P50` chip was restored. The user noticed it missing and asked for it back, matching the info bar, clickable only on IncRems, with a four-option setting. The debloat had denied upstream's `queue_toolbar_priority` on 2026-08-11 as part of the `practicedQueues` group — a bad grouping (a priority badge is not a practiced-queues feature), so it vanished as collateral. Rather than un-deny upstream's widget, the fork now ships `queue_priority_chip` and the resolution logic moved out of `queue_info_bar` into the shared `lib/queue_priority_source.ts`, which both read.

**Notes:** The distribution used to be written into the queue counter's CSS `::after` as a bare `(40, 582, 352, 965)` — four unlabelled numbers whose bands you had to remember. In the bar it gets band colours and a tooltip. Two widgets are needed rather than one because the IncRem bar lives in `answer_buttons` (`FlashcardAnswerButtons` + `queueItemTypeFilter: Plugin`, so it can never mount for a flashcard) — the new widget covers everything else and bails for IncRems so the bar never doubles. Card Clusters keep a `FlashcardUnder` widget mounted across siblings with `remId` pinned to the parent, so the new widget tracks the visible card through the context `cardId` + `QueueLoadCard` (the same approach upstream's denied `card_info_bar` uses). **Webpack discovers entries at startup**, so a new widget file needs a dev-server restart, not just a reload.

---

### 2026-08-12 — Edit (Priority Widget in Editor reduced to on/off)

**Upstream commit(s):** N/A (local; left uncommitted per user instruction)
**Conflicts resolved:** None
**Custom code preserved:** Yes
**Compilation verified:** Yes (`tsc` 13, unchanged baseline; production build passes)
**Files touched:**
- `src/lib/settings.ts` — the dropdown drops upstream's `all` option (On = `incRemOnly`, Off = `disable`), description narrowed to Incremental Rems, and the default in `IE_SETTINGS_DEFAULTS` moved `'all'` → `'incRemOnly'`.
- `src/widgets/priority_editor.tsx` — coerce a stored/legacy `'all'` (and empty) to `'incRemOnly'` at the single read site; the later `??` default matched.
- `CLAUDE.md` — Deviation 13 note + this entry. `README.md` — flashcard-features bullet.

**Notes:** Upstream's three modes differ only in that `all` *also* renders a card-priority editor beside any rem with flashcards (`showCardEditor` requires `displayMode === 'all'`) — a surface for the engine this fork disables, so the real choice is on/off. The default had been `'all'`, so that editor had been rendering all along unless the setting was changed by hand. The union type still admits `'all'` so stored values stay readable; the coercion is what stops a legacy value resurrecting the card editor with no UI left to turn it off. ⚠️ The changed default lives in **upstream's** defaults table — re-apply after a sync.

---

### 2026-08-12 — Note (State of the fork: audit before landing)

**Upstream commit(s):** N/A (docs/audit only)
**Conflicts resolved:** None
**Custom code preserved:** Yes (no code change)
**Compilation verified:** N/A
**Files touched:**
- `CLAUDE.md` — corrected Deviation 9 (the queue counter no longer appends the bucket string; superseded by Deviation 14), refreshed the stale "Our HEAD" row, and rebuilt the Runbook conflict map: added the nine fork-touched files it never listed (`ExtractViewer.tsx`, `settings.ts`, `ie_settings.tsx`, `priority_editor.tsx`, `mobileUtils.ts` and the four Deviation-14 files) and widened the `queue.tsx` / `answer_buttons.tsx` rows to name Deviations 11/13/14.
- `README.md` — see the entry below.

**Notes:** The conflict map is now verified mechanically rather than by eye: every path in `git diff --name-only upstream/main` plus every untracked `src/` file resolves to a row. Re-run that check after each sync. Outstanding at the time of writing, none of it code: the whole Deviation 11/13/14 body of work is **uncommitted** (21 modified, 2 deleted, 6 untracked fork-only sources), `main` is 225 commits behind `merge/upstream-5f8ccdd` with nothing pushed (Runbook Step 6), `public/manifest.json` is still `1.0.42` despite ~15 fork changes since, and the in-app smoke tests have not been run.
