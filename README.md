# Mo's Incremental Everything

> **This is a personal fork of [Incremental Everything](https://github.com/bjsi/incremental-everything)** by Jamesb, Hugomarins and Jonathangimeno. All credit for the plugin itself — incremental reading, prioritization, scheduling, analytics, and everything else it does — belongs upstream; read their README and [documentation site](https://hugomarins.github.io/incremental-everything/) first. This fork is **unlisted**, tracks upstream (currently synced to upstream v1.0.35, commit `5f8ccdd`), and layers the changes described below on top.

This document only describes **what is different from upstream**. If a feature isn't mentioned here, it works exactly as in the original plugin.

---

## New properties on Incremental Rems

Both appear as visible properties under every Incremental Rem.

### Rotation

A plain-text scheduling override. Give a Rem a `Rotation` like `10 days`, `3 weeks`, `6 months`, `4.5w` — or just `10`, which means days — and reviewing it with **Next** always reschedules it that far out, bypassing the SRS scheduler entirely. Set it to `Default` (or leave it empty) for normal scheduling.

Rotations are whole days: anything *between* zero and a day (`2 hours`, `30m`, `0.5`) is rejected, because the next-review date is stored as a day reference and sub-day precision cannot survive it.

**`Rotation: 0` is allowed and means "always due".** Each review reschedules the item to today, which is already in the past, so it comes back in every future session until you change the rotation — it is a permanent always-in-the-queue marker, not a one-off repeat. It will not reappear within the *same* session, since the queue does not show an item twice in one sitting.

- **Inheritance:** when a Rem is made incremental, it inherits the Rotation of its closest incremental ancestor. Set `Rotation: 1 week` on a project note, and every extract created under it rotates weekly.
- The **Next** and **Open Editor** buttons show the rotation-based date in their sublabel, so you can see the override is active.
- An unparsable value (e.g. `banana`) turns those buttons amber with an `invalid rotation` warning; reviews then fall back to the normal scheduler until you fix it.

### First Added

A date property recording the day the Rem was first made incremental in this knowledge base. Purely informational — useful for sorting and auditing what entered the system when.

## The queue review bar

The answer-button row is rebuilt into six buttons, identical on desktop and mobile:

**Previous · Next · Open Editor · Skip · Dismiss · ⚙️ Options**

- **Previous** steps back to the last card. Going back to something you just reviewed shows it in the *already-reviewed* state described below.
- **Next** (blue outline) — as upstream: record a review, advance.
- **Open Editor** (green outline) — records the review **and opens the Rem in-app** (no browser tab), so you can process it immediately. Scheduling happens before navigation, so the review is never lost.
- **Skip** (purple outline) — advances **without recording a review or rescheduling** (the item stays due).
- **Dismiss** (red outline) — as upstream.
- **⚙️ Options** toggles a second row holding the power-user tools: Reschedule, Change Priority, Review with Timer, Scroll to Highlight, Scroll to Bookmark, Review Note, Read point, the Web-Clipper URL button, and Help.

### Custom scheduling: the chevron offset picker

**Next**, **Open Editor** and **Skip** are split buttons. Pressing the **▼ chevron** opens a picker row beneath the buttons: a −/+ stepper with a typeable number, a **Days / Weeks / Months** toggle (months are calendar-aware), a live preview of the landing date, and one Apply button that reads back your choice (e.g. *"Next in 3 weeks"*). Enter applies, Escape closes.

The chosen offset does whatever its button does: **Next** records a review at that offset, **Open Editor** does the same and opens the editor, **Skip** reschedules with **no** review recorded.

### `(OpenLink)` titles

If a Rem's visible title ends with `(OpenLink)` (case-sensitive), **Open Editor** (and `Ctrl+G`) opens the Rem's extracted external URL(s) in browser tabs **instead of** the Rem document — one tab per URL. Without the suffix, only the Rem document opens and URLs are never auto-opened. Useful for link-queue items you want to read at the source.

This needs **popups allowed for RemNote** in your browser, especially with more than one URL — browsers otherwise block the second tab onwards. If popups are blocked the item is still reviewed and the queue still advances, but no tab opens and the Rem document is not opened as a fallback.

## Keyboard shortcuts (rebindable in RemNote → Settings → Shortcuts)

| Shortcut | Action |
|---|---|
| `Ctrl+G` | The full Open Editor flow from the keyboard (including `(OpenLink)` handling) |
| `Opt+T` | Next item in queue (alternate binding, same as upstream's `Cmd/Ctrl+Right`) |
| `Opt+B` | Skip — advance without recording a review |

Two upstream defaults collided with Chrome DevTools, which matters when RemNote runs in a browser tab, and were moved: **Review in Editor** `Ctrl+Shift+J` → `Ctrl+Shift+E`, and **Toggle Ignore Tag** `Ctrl+Shift+I` → `Ctrl+Shift+G`.

## Queue behaviour

### Items are shown as the Rem, not the source document

- A queue item renders **the Rem itself in the queue body**, using RemNote's real document renderer — actual formatting, powerup properties, and inline editing — not a read-only approximation.
- An IncRem with a PDF/HTML source attached shows this outline too — the source reader is disabled entirely in this fork (see below), so there is no 📄 Read document button. Highlight-type items keep upstream's isolated view.
- The notes sidebar **never opens on its own**. The footer under the item (type + child/descendant/flashcard counts) ends with a small **✎ Open in sidebar** button: it opens the Rem in the notes sidebar for full editing (backlink search, date pickers, etc.) and pauses the in-queue copy while it's there; the button becomes a filled-blue **✎ Show in queue** to bring it back. Close the sidebar pane itself with RemNote's own control.

### Items you've already reviewed

An Incremental Rem whose next review is in the future still appears in the queue — it is never silently skipped — but with a different, deliberately harmless set of buttons:

**Previous · ✓ Already reviewed, next in 4 days · Tue, Aug 18 · Open Editor · Next**

You'll see this in two situations: you pressed **Previous** to go back to something you just reviewed, or you met an item that was reviewed on another device after this queue session started (the item list is built once, at the start).

**None of these buttons changes the item's schedule.** *Next* simply moves on, *Previous* steps back, and *Open Editor* takes you to the Rem without recording a review — which is why Previous and Next look identical here. There is intentionally no way to re-review, reschedule or dismiss an item from this state; the point is that "already done" is visible and safe to click through.

### Info bar under every queue item

Upstream shows an info bar only under Incremental Rems. Here it appears under **every** queue item, flashcards included, and leads with the **due-IncRem priority distribution**: a stacked bar across the plugin's ten priority bands (0s, 10s, … 90s), coloured exactly as the priority badges elsewhere — red for urgent through blue for low.

Band widths are proportional to their counts, so the shape of your backlog reads at a glance; every band shows its number, zeros included; and the band holding the current item's own priority is ringed, so you can see where what you're reviewing sits against the rest. Hover for the exact figure and share of each band.

After the distribution the bar shows the item's own repetitions and review time. Priority is not repeated here — it lives in the chip at the top of the queue (below).

Control it under **General → Queue → Queue info bar**: all items / Incremental Rems only / all items but Incremental Rems only on mobile (the default) / off.

### Priority chip in the queue's top bar

The `P50 (92.5%)` chip at the top right is the one place priority is shown, for Incremental Rems and flashcards alike.

The percentage is a **rank, not a share**. Since a lower priority number means more important, `92.5%` says 92.5% of your Incremental Rems are at least as important as this one — it sits in the least-important 7.5%. Hovering explains that, names where the priority came from, and adds the same rank within your current queue scope.

A flashcard has no priority of its own, so it shows **its document's** — and only that one document's: the lookup stops there and never walks further up, so an item inside a document you haven't prioritised shows no chip at all. If that source was an Incremental Rem and has since been dismissed, the chip shows the last priority its review history recorded. Clicking opens the priority editor, but only on an Incremental Rem — under a flashcard the number belongs to the document, not the card.

Set it under **General → Queue → Priority Chip in Queue Top Bar**: always show (the default) / always hide / only on web / only on mobile.

### Deterministic ordering among equal priorities

When several due items share a priority, the **most overdue comes first** (in the live queue, the IncRem table's "Queue Order" view, and Priority Review Documents). Upstream's priority-weighted randomness lottery still applies on top (default 20%; set Sorting Criteria → randomness to 0 for strictly deterministic order).

## Known issue: an all-Incremental queue can show "you've finished all your cards"

If **every** flashcard is done and only Incremental Rems are still due, opening the queue may show
RemNote's completion screen with no Incremental Rems at all.

This is a bug in RemNote, not in the plugin. RemNote decides the queue is finished and renders that
screen *before* it asks the plugin for an item, and the answer the plugin gives — correct, and in
about 25 ms — is then discarded. Nothing a plugin can do changes that. It only bites at queue
*entry*: once the queue is running, Incremental Rems appear normally, including after RemNote's own
cards run out.

**Workaround:** start the queue somewhere that has at least one due flashcard — a document's
**Practice** button, or practice-ahead — and your Incremental Rems will come through as usual.

Still present after syncing with upstream on 2026-08-15, which rewrote this area (the plugin now
answers RemNote in about a millisecond instead of a few hundred). That ruled out speed as the cause
and confirmed the problem is on RemNote's side, so the fork is waiting on a fix there rather than
working around it further.

## Intentionally different / removed

- Upstream's green **🎯 Target Incremental Rem** boxed read-only queue view is replaced by the editable document view described above.
- Upstream's "Open Editor in New Tab" button is replaced by the in-app Open Editor flow.
- The Saturday/Monday quick-reschedule dropdowns became the granular offset picker.
- The translated READMEs (ES, PT-BR) are removed in this fork; see upstream for translations.

## Slimmed down in this fork

This fork disables the upstream subsystems its owner doesn't use (everything remains in the code behind a single flags file, `src/lib/fork_gates.ts` — any of it can be re-enabled by flipping one boolean):

- **All PDF/reader tooling** — the in-reader highlight toolbar (bookmark / extract / tag-as-incremental / peek), PDF Control Panel, source popups (Opt+O / Opt+Shift+O), reading-position memory, and the in-queue reader itself: queue items always show the rem outline (no 📄 Read document button). Read sources with RemNote's own reader.
- **Flashcard features** — the card info bar, batch card priority, card-maintenance commands (the flashcard-prioritisation engine was already off), and cloze-creation commands. The editor's priority widget is on/off here rather than upstream's three modes, since its third mode existed only to add a card-priority editor beside rems with flashcards. The **Change Priority** popups (⚡ in the queue, and `Opt+P`) no longer offer a *Card Priority* section either: this fork never creates `CardPriority` tags, so the section had nothing to act on.
- **Analytics** — Priority/Weighted Shields, Practiced Queues and its per-card session tracking. (The Study Dashboard is kept.)
- **Editor utilities** — heading/outline restructuring, listify/bulletize, text-case converter, reference finder, read points.
- **Misc** — video debug surface, all debug/repair commands, Priority Review Documents.
- **Modes & native settings** — Full performance mode is retired (the fork always runs Light) and the startup "running in Light Mode" banner is gone. RemNote's own plugin-settings panel now holds **no settings at all**, just a signpost row: every setting lives in the plugin's settings window (see below).
- **Migration commands** — Import-with-History, and Copy/Paste Rem Sources (upstream groups the latter with the PDF tooling).

**Changed:** the three history sidebar tabs (Incremental / Flashcard / Visited Rems) are merged into **one "History" tab** with collapsible sections. Kept: the 📚 Inc Rems counter under document titles, the No-IncRem queue timer, Sorting Criteria, all IncRem priority tools, and repetition history (Ctrl+Shift+H).

Also fixed here (pre-existing upstream bug): a stuck `plugin_operation_active` flag after making a rem incremental with flashcard prioritisation off, which silently disabled manual-dismiss and manual-date-edit detection.

## Settings, in one window

Every setting now lives in the plugin's own window — open it from the omnibar with **"Incremental: Settings"** (quick code `ies`). RemNote's plugin-settings panel carries only a pointer to it.

The window is reorganised into **three sections** holding the ~16 settings that still do something here (settings belonging to disabled subsystems are hidden, not deleted — their stored values survive):

1. **General** — split into *Queue* (queue info bar, priority chip, collapse top bar, isolated card view) and *Appearance* (priority widget in the editor, left borders, hidden tags, table badges).
2. **Priority & Scheduling** — *Priority* (default IncRem priority, step size), then *Scheduling* (initial interval, the Beta-scheduler switch, and only the selected curve's parameters).
3. **Advanced** — Hide-in-Queue integration, flashcard response-time limit.

The Hide-in-Queue warning about duplicate powerups — the one thing here that can genuinely break the plugin — renders as a red callout rather than a sentence buried in the description. Note that moving that setting out of RemNote's panel resets it to its default (off); re-enable it here if you used it.

## Commands in the omnibar

Every command this plugin registers is prefixed **`Incremental: `** in the omnibar, so they group together and are findable — upstream's names ranged from "Open Study Dashboard" to "Preserve history & remove" with nothing marking them as belonging to this plugin. Several were also renamed for intent over implementation (e.g. *Preserve history & remove* → **Delete Rem, Keep Study History**; *Quick Increase/Decrease Priority Number* → **Make Less/More Important**). Quick codes are untouched.
