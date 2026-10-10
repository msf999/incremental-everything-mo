# Mo's Incremental Everything

> **This is a personal fork of [Incremental RemNote](https://github.com/bjsi/incremental-everything)** (formerly *Incremental Everything*) by Jamesb, Hugomarins and Jonathangimeno. All credit for the plugin itself — incremental reading, prioritization, scheduling, analytics, and everything else it does — belongs upstream; read their README and [documentation site](https://hugomarins.github.io/incremental-remnote/) first. This fork is **unlisted** on RemNote, tracks upstream (currently synced to upstream v1.0.150, commit `bb758b8` of 2026-10-08; this fork is version 1.0.156), and layers the changes described below on top.

This document only describes **what is different from upstream**. If a feature isn't mentioned here, it works exactly as in the original plugin.

---

## New properties on Incremental Rems

Both appear as visible properties under every Incremental Rem.

### Rotation

A plain-text scheduling override. Give a Rem a `Rotation` like `10 days`, `3 weeks`, `6 months`, `4.5w` — or just `10`, which means days — and reviewing it with **Next** always reschedules it that far out, bypassing the SRS scheduler entirely. Set it to `Default` (or leave it empty) for normal scheduling — which is upstream's: the **Multiplier** scheduler by default (next interval = the item's current interval × 1.5) or the **Saturating Curve**, chosen in the settings window or per Rem in the Reschedule popup. A Rotation overrides either.

Rotations are whole days: anything *between* zero and a day (`2 hours`, `30m`, `0.5`) is rejected, because the next-review date is stored as a day reference and sub-day precision cannot survive it.

**`Rotation: 0` is allowed and means "always due".** Each review reschedules the item to today, which is already in the past, so it comes back in every future session until you change the rotation — it is a permanent always-in-the-queue marker, not a one-off repeat. It will not reappear within the *same* session, since the queue does not show an item twice in one sitting.

- **Inheritance:** when a Rem is made incremental, it inherits the Rotation of its closest incremental ancestor. Set `Rotation: 1 week` on a project note, and every extract created under it rotates weekly.
- The **Next** and **Open** buttons show the rotation-based date in their sublabel, so you can see the override is active.
- An unparsable value (e.g. `banana`) turns those buttons amber with an `invalid rotation` warning; reviews then fall back to the normal scheduler until you fix it.

### First Added

A date property recording the day the Rem was first made incremental in this knowledge base. Purely informational — useful for sorting and auditing what entered the system when.

## The queue review bar

The answer-button row is rebuilt into seven buttons, identical on desktop and mobile:

**Previous · Next · Open · 🔄 · Skip · Dismiss · ⚙️ Options**

All of them except the small 🔄 share one width (Dismiss's), chevrons included. Under **Next** and **Open** you see when the item will next be due if you press it — just the time, e.g. `5 days` or `11.4 months`.

- **Previous** steps back to the last card. Going back to something you just reviewed shows it in the *already-reviewed* state described below.
- **Next** (blue outline) — as upstream: record a review, advance.
- **Open** (green outline; called *Open Editor* until 1.0.156) — records the review **and opens the Rem in-app** (no browser tab), so you can process it immediately. Scheduling happens before navigation, so the review is never lost.
- **🔄 Another item** — sets this Incremental Rem aside for the rest of the session (no review, no reschedule — it stays due) and **immediately shows a different due Incremental Rem in its place**. Press it again for another. Which one comes is the queue's own choice for its next Incremental Rem: by priority, most overdue first among equals, with your **Sorting Criteria → randomness** applied exactly as the queue applies it (at 0 you always get the strict next one; at 20%, about one press in five draws a priority-weighted pick from the whole due list instead). Skip leaves the same way, but what follows is whatever RemNote already lined up next, usually a flashcard; 🔄 gives you another Incremental Rem now.
- **Skip** (purple outline) — advances **without recording a review or rescheduling** (the item stays due).
- **Dismiss** (red outline) — as upstream.
- **⚙️ Options** toggles a second row holding the power-user tools: Reschedule, Change Priority, Review Note, the Web-Clipper URL button (when the item has one), and Help. Review with Timer, Scroll to Highlight / Bookmark and Read point join the row only when their subsystems are switched on (see *Options, off by default* and *Slimmed down* below).

### Custom scheduling: the chevron offset picker

**Next**, **Open** and **Skip** are split buttons. Pressing the **▼ chevron** opens a picker row beneath the buttons: a −/+ stepper with a typeable number, a **Days / Weeks / Months** toggle (months are calendar-aware), a live preview of the landing date, and one Apply button that reads back your choice (e.g. *"Next in 3 weeks"*). Enter applies, Escape closes.

The chosen offset does whatever its button does: **Next** records a review at that offset, **Open** does the same and opens the editor, **Skip** reschedules with **no** review recorded.

A picked offset is a **one-off**. On the Multiplier scheduler the item keeps growing from the interval it already had, so *Next in 3 weeks* does not turn a 5-day item into a 3-week one — upstream's Reschedule popup is the place to set a new base interval. A Skip-with-offset likewise moves only the date and leaves the item's rhythm alone.

### `(OpenLink)` titles

If a Rem's visible title ends with `(OpenLink)` (case-sensitive), **Open** (and `Ctrl+G`) opens the Rem's extracted external URL(s) in browser tabs **instead of** the Rem document — one tab per URL. Without the suffix, only the Rem document opens and URLs are never auto-opened. Useful for link-queue items you want to read at the source.

This needs **popups allowed for RemNote** in your browser, especially with more than one URL — browsers otherwise block the second tab onwards. If popups are blocked the item is still reviewed and the queue still advances, but no tab opens and the Rem document is not opened as a fallback.

## Keyboard shortcuts (rebindable in RemNote → Settings → Shortcuts)

| Shortcut | Action |
|---|---|
| `Ctrl+G` | The full **Open** flow from the keyboard, including `(OpenLink)` handling (omnibar: "Incremental: Open Editor") |
| `Opt+T` | Next item in queue (alternate binding, same as upstream's `Cmd/Ctrl+Right`) |
| `Opt+B` | Skip — advance without recording a review |
| `Opt+R` | 🔄 Another item — show a different due Incremental Rem now, no review |
| `Opt+X` | **Toggle Incremental** — make the Rem (or the selected Rems) incremental, or dismiss it if it already is. A selected piece of text becomes an extract. In the queue, with nothing selected, it acts on the item on screen |

**Opt+X replaces upstream's two keys** (`Opt+X` to make incremental, `Ctrl+D` to dismiss). It acts on what you have selected, else on the Rem your cursor is in — in the queue, else on the item on screen. A selection of several Rems is dismissed only when all of them are incremental; otherwise the rest are made incremental. **In the queue a dismissal needs a second Opt+X within a few seconds** — the first press only shows a toast saying so — and Opt+X does nothing on RemNote's own screens (e.g. the finished screen) or on the "Already reviewed" row. It cannot extract text from a PDF: RemNote does not tell plugins about a selection inside its PDF viewer. Both original commands are still in the omnibar ("Incremental: Extract / Tag Rem", "Incremental: Dismiss Rem"), without a key.

Two upstream defaults collided with Chrome DevTools, which matters when RemNote runs in a browser tab, and were moved: **Review in Editor** `Ctrl+Shift+J` → `Ctrl+Shift+E` (a command that is off by default here now, see below), and **Toggle Ignore Tag** `Ctrl+Shift+I` → `Ctrl+Shift+G`.

## Queue behaviour

### Items are shown as the Rem, not the source document

- A queue item renders **the Rem itself in the queue body**, using RemNote's real document renderer — actual formatting, powerup properties, and inline editing — not a read-only approximation.
- An IncRem with a PDF/HTML source attached shows this outline too — the source reader is disabled entirely in this fork (see below), so there is no 📄 Read document button. Highlight-type items keep upstream's isolated view.
- The notes sidebar **never opens on its own**. The footer under the item (type + child/descendant/flashcard counts) ends with a small **✎ Open in sidebar** button: it opens the Rem in the notes sidebar for full editing (backlink search, date pickers, etc.) and pauses the in-queue copy while it's there; the button becomes a filled-blue **✎ Show in queue** to bring it back. Close the sidebar pane itself with RemNote's own control.

### Items you've already reviewed

An Incremental Rem whose next review is in the future still appears in the queue — it is never silently skipped — but with a different, deliberately harmless set of buttons:

**Previous · ✓ Already reviewed, next in 4 days · Tue, Aug 18 · Open · Next**

You'll see this in two situations: you pressed **Previous** to go back to something you just reviewed, or you met an item that was reviewed on another device after this queue session started (the item list is built once, at the start).

**None of these buttons changes the item's schedule.** *Next* simply moves on, *Previous* steps back, and *Open* takes you to the Rem without recording a review — which is why Previous and Next look identical here. There is intentionally no way to re-review, reschedule or dismiss an item from this state; the point is that "already done" is visible and safe to click through.

### Info bar under every queue item

Upstream shows an info bar only under Incremental Rems. Here it appears under **every** queue item, flashcards included, and leads with the **due-IncRem priority distribution**: a stacked bar across the plugin's ten priority bands (0s, 10s, … 90s), coloured exactly as the priority badges elsewhere — red for urgent through blue for low.

Band widths are proportional to their counts, so the shape of your backlog reads at a glance; every band shows its number, zeros included; and the band holding the current item's own priority is ringed, so you can see where what you're reviewing sits against the rest. Hover for the exact figure and share of each band.

After the distribution the bar shows the item's own repetitions and review time. Priority is not repeated here — it lives in the chip at the top of the queue (below).

Control it under **General → Queue → Queue info bar**: all items / Incremental Rems only / all items but Incremental Rems only on mobile (the default) / off.

### The queue counter

Upstream appends the number of due Incremental Rems to RemNote's card counter (`30 + 1620`). This fork adds, in parentheses, how many of those have a **priority below 10** — the red 0-band of the distribution bar — so the counter reads **`30 + 1620 (1064)`** in Compact and **`30 Left + 1620 (1064)`** in Beautiful. Both figures count down as items are served.

### Priority chip in the queue's top bar

The `P50 (92.5%)` chip at the top right is the one place priority is shown, for Incremental Rems and flashcards alike.

The percentage is a **rank, not a share**. Since a lower priority number means more important, `92.5%` says 92.5% of your Incremental Rems are at least as important as this one — it sits in the least-important 7.5%. Hovering explains that, names where the priority came from, and adds the same rank within your current queue scope.

A flashcard has no priority of its own, so it shows **its document's** — and only that one document's: the lookup stops there and never walks further up, so an item inside a document you haven't prioritised shows no chip at all. If that source was an Incremental Rem and has since been dismissed, the chip shows the last priority its review history recorded. Clicking opens the priority editor, but only on an Incremental Rem — under a flashcard the number belongs to the document, not the card.

Set it under **General → Queue → Priority Chip in Queue Top Bar**: always show (the default) / always hide / only on web / only on mobile.

### Both queue variants

Everything here works in RemNote's **Compact** and **Beautiful** queue variants. In Beautiful: the priority chip sits in the top bar's action row (next to the +, ✎ and ⋯ icons) rather than in the card's corner where upstream draws its badge; the info bar under flashcards is docked just above the answer buttons, below RemNote's AI Explanation, exactly as upstream docks its own bar; and the counter reads **`N Left + M (U)`** (upstream's suffix only appears in Compact). An Incremental Rem fills the card down to the button row, and the Options row and offset picker grow the button area while the item shrinks to make room.

### Deterministic ordering among equal priorities

When several due items share a priority, the **most overdue comes first** (both in the live queue and in the IncRem table's "Queue Order" view). Upstream's priority-weighted randomness lottery still applies on top (default 20%; set Sorting Criteria → randomness to 0 for strictly deterministic order).

## Intentionally different / removed

- Upstream's green **🎯 Target Incremental Rem** boxed read-only queue view is replaced by the editable document view described above.
- Upstream's "Open Editor in New Tab" button is replaced by the in-app **Open** button.
- The Saturday/Monday quick-reschedule dropdowns became the granular offset picker.
- Upstream's `×1.5` / `curve` scheduler chip on the Next and Open buttons is not shown; the sublabel keeps just the next date.
- Upstream's spoiler protection (**Hold Back Spoiler IncRems**, which holds an Incremental Rem back while one of its own flashcards is due) is **off** by default here — upstream ships it on. Switch it on under General → Queue.
- The translated READMEs (ES, PT-BR) are removed in this fork; see upstream for translations.

## Slimmed down in this fork

This fork disables the upstream subsystems its owner doesn't use (everything remains in the code behind a single flags file, `src/lib/fork_gates.ts` — any of it can be re-enabled by flipping one boolean):

- **All PDF/reader tooling** — the in-reader highlight toolbar (bookmark / extract / tag-as-incremental / peek), PDF Control Panel, source popups (Opt+O / Opt+Shift+O), reading-position memory, source pins (Pin Source Quote, AI transcribe), the Logos Bible Software bridge, the tag-rems-with-images scan, and the in-queue reader itself: queue items always show the rem outline (no 📄 Read document button). Read sources with RemNote's own reader.
- **Flashcard features** — the card info bar, batch card priority, card-maintenance commands (the flashcard-prioritisation engine was already off), True/False cards, the Card Enablement Audit and empty-Extra-Card-Detail cleanup, the hidden-slot migration commands, the flashcard repetition-history popup (so no 🃏 Cards History button in the repetition-history popup), and cloze-creation commands. The editor's priority widget is on/off here rather than upstream's three modes, since its third mode existed only to add a card-priority editor beside rems with flashcards. The **Change Priority** popups (⚡ in the queue, and `Opt+P`) no longer offer a *Card Priority* section either: this fork never creates `CardPriority` tags, so the section had nothing to act on.
- **Analytics** — Priority/Weighted Shields, Practiced Queues and its per-card session tracking. (The Study Dashboard is kept.)
- **Editor utilities** — heading/outline restructuring, listify/bulletize, text-case converter, Convert Extracted Markup, reference finder, read points.
- **Misc** — video debug surface, all debug/repair commands, Priority Review Documents and the Priority Queue, the Plugin Hub sidebar panel and onboarding tips, queue cooling, and the Beautiful-queue corner priority badge (the fork's own chip covers it).
- **Modes & native settings** — Full performance mode is retired (the fork always runs Light) and the startup "running in Light Mode" banner is gone. RemNote's own plugin-settings panel now holds **no settings at all**, just a signpost row: every setting lives in the plugin's settings window (see below).
- **Migration commands** — Import-with-History, Transfer IncRem Data to Parent, and Copy/Paste Rem Sources (upstream groups the latter with the PDF tooling).

**Options, off by default** — merged from upstream but switched off; each is one boolean in the same flags file (or one setting):

- **Review with Timer** — the 📝 button in the queue's Options row, the *Review in Editor* buttons in the IncRem table and list, and the `Ctrl+Shift+E` command (`editorReviewTimer`).
- **Priority-change history** — upstream now records a history entry every time a priority changes; off here, so the repetition history stays a list of reviews (`priorityChangeHistory`).
- **Media tools** — Localize External Media (store linked images/audio in RemNote, single or whole tree) and Cycle Image Size (`mediaTools`).
- **Hold Back Spoiler IncRems** — a setting, visible under General → Queue, off by default (on upstream).
- Upstream's **per-type schedulers and initial intervals** (documents / videos / highlights / rems) are hidden from the settings window; the general scheduler and interval apply to every type.

**Changed:** the three history sidebar tabs (Incremental / Flashcard / Visited Rems) are merged into **one "History" tab** with collapsible sections. Kept: the 📚 Inc Rems counter under document titles, the No-IncRem queue timer, Sorting Criteria, all IncRem priority tools, and repetition history (Ctrl+Shift+H). **Sorting Criteria** no longer shows *Flashcard Randomness* (only Priority Review Documents used it, and they are off), and its card ratio is titled **Incremental Rem Frequency** ("One Incremental Rem after every N flashcards") — same setting, same stored value.


## Settings, in one window

Every setting now lives in the plugin's own window — open it from the omnibar with **"Incremental: Settings"** (quick code `is`). RemNote's plugin-settings panel carries only a pointer to it.

The window is reorganised into **three sections** holding the 19 settings that still do something here (settings belonging to disabled subsystems are hidden, not deleted — their stored values survive):

1. **General** — split into *Queue* (queue info bar, priority chip, collapse top bar, isolated card view, spoiler hold-back) and *Appearance* (priority widget in the editor, left borders, hidden tags, table badges).
2. **Priority & Scheduling** — *Priority* (default IncRem priority, step size), then *Scheduling* (initial interval, the Default Scheduler switch — Multiplier or Saturating Curve — the multiplier, and the curve's first-review and max intervals).
3. **Advanced** — Hide-in-Queue integration, flashcard response-time limit.

The Hide-in-Queue warning about duplicate powerups — the one thing here that can genuinely break the plugin — renders as a red callout rather than a sentence buried in the description.

## Commands in the omnibar

Every command this plugin registers is prefixed **`Incremental: `** in the omnibar, so they group together and are findable (upstream's own `Incremental RemNote:` prefix is replaced, not stacked).
