# Mo's Incremental Everything

> **This is a personal fork of [Incremental RemNote](https://github.com/bjsi/incremental-everything)** (formerly *Incremental Everything*) by Jamesb, Hugomarins and Jonathangimeno. All credit for the plugin itself — incremental reading, prioritization, scheduling, analytics, and everything else it does — belongs upstream; read their README and [documentation site](https://hugomarins.github.io/incremental-remnote/) first. This fork is **unlisted** on RemNote, tracks upstream (currently synced to upstream v1.0.150, commit `bb758b8` of 2026-10-08; this fork is version 1.0.162), and layers the changes described below on top.

This document only describes **what is different from upstream**. If a feature isn't mentioned here, it works exactly as in the original plugin.

---

## New properties on Incremental Rems

Both appear as visible properties under every Incremental Rem.

### Rotation

A plain-text scheduling override. Give a Rem a `Rotation` like `10 days`, `3 weeks`, `6 months`, `4.5w` — or just `10`, which means days — and reviewing it with **Next** reschedules it that far out, bypassing the SRS scheduler entirely (an offset you pick with the chevron, below, wins for that one review). Set it to `Default` (or leave it empty) for normal scheduling — which is upstream's: the **Multiplier** scheduler by default (next interval = the item's current interval × 1.5) or the **Saturating Curve**, chosen in the settings window or per Rem in the Reschedule popup. A Rotation overrides either.

A rotation lands on a calendar day: anything *between* zero and one day (`2 hours`, `30m`, `0.5`) is rejected and shows as `invalid rotation`, because the next-review date is stored as a day reference and cannot hold less than a day. Longer fractional values such as `4.5w` are fine.

**`Rotation: 0` is allowed and means "always due".** Each review reschedules the item to today, which is already in the past, so it comes back in every future session until you change the rotation — it is a permanent always-in-the-queue marker, not a one-off repeat. It will not reappear within the *same* session, since the queue does not show an item twice in one sitting.

- **Inheritance:** when a Rem is made incremental, it inherits the Rotation of its closest incremental ancestor. Set `Rotation: 1 week` on a project note, and every extract created under it rotates weekly.
- The **Next** and **Open** buttons show the time until the rotation date in their sublabel (e.g. `7 days`), so you can see the override is active.
- An unparsable value (e.g. `banana`) turns those buttons amber with an `invalid rotation` warning; reviews then fall back to the normal scheduler until you fix it.

### First Added

A date property recording the day the Rem was first made incremental in this knowledge base. A Rem you dismiss and later make incremental again keeps that first day: it is read back from the review history the Rem kept (its earliest entry, not counting sessions you added by hand or reviews imported from a flashcard). Rems made incremental before this property existed have it empty. Purely informational — useful for sorting and auditing what entered the system when.

## The queue review bar

The answer-button row is rebuilt into seven buttons, identical on desktop and mobile:

**Previous · Next · Open · 🔄 · Dismiss · ⚙️ Options · Skip**

Previous, Next, Open, Skip and Dismiss share one width (Dismiss's), chevrons included; 🔄 is narrower, and ⚙️ Options widens while its row is open. Under **Next** and **Open** you see when the item will next be due if you press it — just the time, e.g. `5 days` or `11.4 months`. While an action runs the whole row greys out, so a double press cannot fire twice.

- **Previous** steps back to the last card. Going back to something you just reviewed shows it in the *already-reviewed* state described below. Going back to one you skipped and pressing Next records an ordinary review — upstream would delete the item's previous review in that case.
- **Next** (blue outline) — as upstream: record a review, advance.
- **Open** (green outline; its keyboard command keeps the name *Open Editor*) — records the review **and opens the Rem in-app** (no browser tab), so you can process it immediately. Scheduling happens before navigation, so the review is never lost.
- **🔄 Another item** — sets this Incremental Rem aside for the rest of the session (no review, no reschedule — it stays due) and **immediately shows a different due Incremental Rem in its place**. Press it again for another. Which one comes is the queue's own choice for its next Incremental Rem: by priority, most overdue first among equals, with your **Sorting Criteria → randomness** applied exactly as the queue applies it (at 0 you always get the strict next one; at 20%, about one press in five draws a priority-weighted pick from the whole due list instead). Skip leaves the same way, but what follows is whatever RemNote already lined up next, usually a flashcard; 🔄 gives you another Incremental Rem now.
- **Dismiss** (red outline) — as upstream.
- **⚙️ Options** toggles a second row holding the power-user tools: Reschedule, Change Priority, Review Note, the Web-Clipper URL button (when the item has one), and Help. Review with Timer, Scroll to Highlight / Bookmark and Read point join the row only when their subsystems are switched on (see *Options, off by default* and *Slimmed down* below).
- **Skip** (purple outline, last in the row) — advances **without recording a review or rescheduling** (the item stays due).

### Custom scheduling: the chevron offset picker

**Next**, **Open** and **Skip** are split buttons. Pressing the **▼ chevron** opens a picker row beneath the buttons: a −/+ stepper with a typeable number, a **Days / Weeks / Months** toggle (months are calendar-aware), a live preview of the landing date, and one Apply button that reads back your choice (e.g. *"Next in 3 weeks"*). Enter applies, Escape closes.

The chosen offset does whatever its button does: **Next** records a review at that offset, **Open** does the same and opens the editor, **Skip** reschedules with **no** review recorded. A review recorded this way is a normal review — with its review time — only the landing date is yours.

A picked offset is a **one-off**. On the Multiplier scheduler the item keeps growing from the interval it already had, so *Next in 3 weeks* does not turn a 5-day item into a 3-week one — upstream's Reschedule popup is the place to set a new base interval. A Skip-with-offset likewise moves only the date and leaves the item's rhythm alone.

### `(OpenLink)` titles

If a Rem's visible title ends with `(OpenLink)` (case-sensitive), **Open** (and `Ctrl+G`) opens the Rem's extracted external URL(s) in browser tabs **instead of** the Rem document — one tab per URL. If no URL is found, the Rem document opens as usual. Without the suffix, only the Rem document opens and URLs are never auto-opened. Useful for link-queue items you want to read at the source.

This needs **popups allowed for RemNote** in your browser, especially with more than one URL — browsers otherwise block the second tab onwards. If popups are blocked the item is still reviewed and the queue still advances, but no tab opens and the Rem document is not opened as a fallback.

## Keyboard shortcuts (rebindable in RemNote → Settings → Shortcuts)

| Shortcut | Action |
|---|---|
| `Ctrl+G` | The full **Open** flow from the keyboard, including `(OpenLink)` handling (omnibar: "Incremental: Open Editor") |
| `Opt+T` | Next item in queue (alternate binding, same as upstream's `Cmd/Ctrl+Right`) |
| `Opt+B` | Skip — advance without recording a review |
| `Opt+R` | 🔄 Another item — show a different due Incremental Rem now, no review |
| `Opt+X` | **Toggle Incremental** — make the Rem (or the selected Rems) incremental, or dismiss it if it already is. A selected piece of text becomes an extract. In the queue, with nothing selected, it acts on the item on screen |

On a flashcard these keys leave the card alone — even when its Rem is itself an Incremental Rem — and `Opt+T`, `Opt+B` and `Opt+R` say they work on Incremental Rems only. Rate flashcards with RemNote's own keys. Upstream's **Reschedule** (`Ctrl+J`) on such a flashcard reschedules the Rem's incremental schedule and leaves the card on screen to be rated. A quick second press of `Opt+T` / `Opt+B` / `Ctrl+G` waits for the next item to load instead of acting on the one you just left.

**Opt+X replaces upstream's two keys** (`Opt+X` to make incremental, `Ctrl+D` to dismiss). It acts on what you have selected, else on the Rem your cursor is in — in the queue, else on the item on screen. A selection of several Rems is dismissed only when all of them are incremental; otherwise the rest are made incremental. **In the queue a dismissal needs a second Opt+X within a few seconds** — the first press only shows a toast saying so — and Opt+X does nothing on RemNote's own screens (e.g. the finished screen) or on the "Already reviewed" row. It cannot extract text from a PDF: RemNote does not tell plugins about a selection inside its PDF viewer. Both original commands are still in the omnibar ("Incremental: Extract / Tag Rem", "Incremental: Dismiss Rem"), without a key.

Two upstream defaults collided with Chrome DevTools, which matters when RemNote runs in a browser tab, and were moved: **Review in Editor** `Ctrl+Shift+J` → `Ctrl+Shift+E` (a command that is off by default here now, see below), and **Toggle Ignore Tag** `Ctrl+Shift+I` → `Ctrl+Shift+G`.

## Queue behaviour

### Items are shown as the Rem, not the source document

- A queue item renders **the Rem itself in the queue body**, using RemNote's real document renderer — actual formatting, powerup properties, and inline editing — not a read-only approximation. Two exceptions come from upstream unchanged: a video Incremental Rem plays in its video player, and an Incremental Rem with exactly one source that is an ordinary Rem shows that source Rem (tag it `#extractviewer` to show the Rem itself).
- An IncRem with a PDF/HTML source attached shows this outline too — the source reader is disabled entirely in this fork (see below), so there is no 📄 Read document button. Highlight-type items keep upstream's isolated view.
- The breadcrumb above the item (in the document view and the isolated card) shows each ancestor with the **icon RemNote gives it**: a folder's or document's own emoji or coloured folder picture — e.g. **📒 Zotero › 📄 Items** — RemNote's folder picture for a folder without one, and RemNote's page icon for a document without one. It stays on one line: when the names do not fit, crumbs fold to their icon (the middle ones first, then the top one) and the item's parent is shortened with an ellipsis. Hover a crumb for its full name; click it to open it.
- The notes sidebar **never opens on its own**. The footer under the item (type + child/descendant/flashcard counts) ends with a small **✎ Open in sidebar** button: it opens the Rem in the notes sidebar for full editing (backlink search, date pickers, etc.) and pauses the in-queue copy while it's there; the button becomes a filled-blue **✎ Show in queue** to bring it back. Close the sidebar pane itself with RemNote's own control.
- Clicking the breadcrumb row, the footer, the info bar, the priority chip, the isolated card or the margin around the item leaves keyboard focus with RemNote, so the queue's shortcuts keep working after the click. The isolated card's text can still be selected and copied. A review note you left unfinished reopens with its item without taking the keyboard; click into it to type.
- An Incremental Rem's review time counts from the moment it appears on screen, not from when the queue lined it up (which is while you are still on the card before it).
- If the plugin restarts while you are in the queue (an update), the session carries on: items you have already seen are not served again, and a 🔄 swap stays.
- A document's **Practice All** and **Practice in Order** show only the Incremental Rems that are due, as the normal queue does; upstream shows every Incremental Rem in the document there. Its flashcards are RemNote's business — Practice All still shows them all.
- **Scrolling a long item from the keyboard:** the arrow keys do not scroll an item (or a flashcard) taller than the screen — RemNote never gives its scroll area keyboard focus, and plugins have no way to. Click into the text and use **Page Up / Page Down** (`fn+↑` / `fn+↓` on a Mac).

### Items you've already reviewed

An Incremental Rem whose next review is in the future still appears in the queue — it is never silently skipped — but with a different, deliberately harmless set of buttons:

**Previous · ✓ Already reviewed, next in 4 days · Tue, Aug 18 · Open · Next**

You'll see this in two situations: you pressed **Previous** to go back to something you just reviewed, or you met an item that was reviewed on another device after this queue session started (the item list is built once, at the start).

**None of these buttons changes the item's schedule.** *Next* simply moves on, *Previous* steps back, and *Open* takes you to the Rem without recording a review — which is why Previous and Next look identical here. The keyboard behaves the same way: `Opt+T` / `Cmd/Ctrl+→` only move on, `Ctrl+G` opens the Rem like the row's *Open*, and `Opt+X` and `Opt+R` do nothing here (Opt+R says why). The row offers no way to re-review, reschedule or dismiss the item; the point is that "already done" is visible and safe to click through. If you do mean to dismiss it, the omnibar's **"Incremental: Dismiss Rem"** still works — without recording a second review.

A third way to meet this row: you change an item's **Next Rep Date** by hand while it is on screen. The queue picks up the new date straight away, so the item is not served again until it is due.

### Info bar under every queue item

Upstream shows its info bar under Incremental Rems, plus a card bar under flashcards that carry a card priority (removed here — see *Slimmed down*). Here one info bar appears under **every** queue item, flashcards included, and leads with the **due-IncRem priority distribution**: a stacked bar across the plugin's ten priority bands (0s, 10s, … 90s), coloured on a fixed scale by priority value — red for the 0s (most urgent) through blue for the 90s. A band's colour can therefore differ from the priority chip's, which is coloured by rank.

Band widths are proportional to their counts, so the shape of your backlog reads at a glance; every band shows its number, zeros included; and the band holding the current item's own priority is ringed, so you can see where what you're reviewing sits against the rest. Hover for the exact figure and share of each band.

After the distribution the bar shows the item's own repetitions and review time. Priority is not repeated here — it lives in the chip at the top of the queue (below).

Control it under **General → Queue → Queue Info Bar**: all items / Incremental Rems only / all items but Incremental Rems only on mobile (the default) / off.

### The queue counter

Upstream appends the number of due Incremental Rems to RemNote's card counter (`30 + 1620`). This fork adds, in parentheses, how many of those have a **priority below 10** — the red 0-band of the distribution bar — so the counter reads **`30 + 1620 (1064)`** in Compact and **`30 Left + 1620 (1064)`** in Beautiful. Both figures count down as items are served.

### Priority chip in the queue's top bar

The `P50 (92.5%)` chip at the top right is the one place priority is shown, for Incremental Rems and flashcards alike.

The percentage is a **rank, not a share**. Since a lower priority number means more important, `92.5%` says 92.5% of your Incremental Rems are at least as important as this one — only the other 7.5% are less important. Items with the same priority share one rank (with hundreds of Incremental Rems at P5, every one of them shows the same percentage), so the number changes only when the item's priority or the rest of your collection does. The Rems Table, the 📚 list and the History tab rank the same way. Hovering explains that, names where the priority came from, and adds the same rank within your current queue scope.

Under a flashcard the chip shows the priority of the card's Rem if that Rem is (or was) an Incremental Rem, otherwise **its document's** — and only that one document's: the lookup stops there and never walks further up, so a card inside a document you haven't prioritised shows no chip at all. If the source has been dismissed, the chip shows the last priority its review history recorded; if a priority cannot be read at all, it shows a grey **P?**. Clicking opens the priority editor only when the number is the item's own live Incremental-Rem priority; for a document's priority, or a dismissed Rem's, the chip does nothing. On RemNote's own screens — the finished screen, checkpoints — there is no item, and no chip.

Set it under **General → Queue → Priority Chip in Queue Top Bar**: always show (the default) / always hide / only on web / only on mobile.

### Both queue variants

Everything here works in RemNote's **Compact** and **Beautiful** queue variants. In Beautiful: the priority chip sits in the top bar's action row (next to the +, ✎ and ⋯ icons) rather than in the card's corner where upstream draws its badge; the info bar under flashcards is docked just above the answer buttons, below RemNote's AI Explanation, exactly as upstream docks its own bar; and the counter reads **`N Left + M (U)`** (upstream's suffix only appears in Compact). An Incremental Rem fills the card down to the button row, and the Options row and offset picker grow the button area while the item shrinks to make room.

### On the phone: blank queue documents (experimental)

In RemNote's phone app some Incremental Rems showed a white page in the queue body instead of their document. The cause could not be pinned down without a phone to test on, so this version carries a set of experimental changes that apply **only in RemNote's phone app** (and its tablet app, if that identifies itself as RemNote's app) — desktop, the web app and iPad browsers are unchanged:

- The queue body's layout is set inline instead of through RemNote's stylesheet, which does not reach the plugin in the phone app. This is meant to start RemNote's document below the plugin's breadcrumb row rather than over it; RemNote's own page header can still cover that row (see below).
- The document is requested a moment later, once the layout has settled, and the footer's statistics are not calculated (they were hidden behind the answer buttons anyway).
- Two buttons at the start of the breadcrumb row: **↻ Redraw** asks RemNote to draw the document again, and **≡ Text** shows a plain-text outline of the Rem that the plugin draws itself, so there is something to read even when RemNote draws nothing (the button then reads **≡ Document** to go back). A dashed box at the top of the text view lists what the plugin can see about the Rem. On a phone, RemNote's own page header covers this row whenever the document is drawn, so the buttons are reachable on a blank page — which is when they are needed.
- RemNote's document view is forced visible even if RemNote never reveals it (RemNote keeps a new view hidden until it has measured it once).
- A small label at the top right of the document, starting "IE check:", says what RemNote drew there: **document drawn** (green, fading to faint after a few seconds), **no document page drawn (yet)**, **overlay EMPTY, RemNote stopped drawing**, **page hidden, RemNote editor not loaded (yet)**, **RemNote shows a source page (PDF, link, media or drawing), not the outline**, **RemNote cannot find this document**, **RemNote is still loading**, or **RemNote never showed this overlay**. Problem labels appear only after a second and a half, since every normal load passes through some of these states for a moment. **No label at all** means RemNote did not create its document view for that item. On a blank page, take a screenshot of the label first, then open ≡ Text and take one of its box — opening ≡ Text replaces RemNote's view, label included.

Each part can be switched off on its own in `src/lib/mobile_experiments.ts`, and every piece of code belonging to them is marked `MOBILE-EXPERIMENT`, so whatever does not help can be removed cleanly after the phone test.

### Deterministic ordering among equal priorities

When several due items share a priority, the **most overdue comes first** (both in the live queue and in the IncRem table's "Queue Order" view). Upstream's priority-weighted randomness lottery still applies on top (default 20%; set Sorting Criteria → randomness to 0 for strictly deterministic order).

## Intentionally different / removed

- Upstream's green **🎯 Target Incremental Rem** boxed read-only queue view is replaced by the editable document view described above.
- Upstream's "Open Editor in New Tab" button is replaced by the in-app **Open** button.
- Upstream's drag gesture on **Next** (drag up to repeat tomorrow, drag down to repeat today) is gone; the chevron offset picker replaces it. Upstream's dashed "P Edit" hint (press P for RemNote's pop-up previewer) is not shown either.
- Upstream's `×1.5` / `curve` scheduler chip on the Next button is not shown; Next and Open show only the time until the next review.
- Upstream's **← Back to isolated view** button, which floated over every item shown in context, is removed. Items still start in the isolated card according to *Use Isolated Card View in Queue for* (highlights, by default), and the card's **View in Context** still switches to the full view — there is just no way back for that item.
- Upstream's spoiler protection (**Hold Back Spoiler IncRems**, which holds an Incremental Rem back while one of its own flashcards is due) is **off** by default here — upstream ships it on. Switch it on under General → Queue.
- The translated READMEs (ES, PT-BR) are removed in this fork; see upstream for translations.

## Slimmed down in this fork

This fork disables the upstream subsystems its owner doesn't use (everything remains in the code behind a single flags file, `src/lib/fork_gates.ts` — any of it can be re-enabled by flipping one boolean):

- **All PDF/reader tooling** — the in-reader highlight toolbar (bookmark / extract / tag-as-incremental / peek), PDF Control Panel, source popups (Opt+O / Opt+Shift+O), reading-position memory, source pins (Pin Source Quote, AI transcribe), the Logos Bible Software bridge, the tag-rems-with-images scan, and the in-queue reader itself: queue items always show the rem outline (no 📄 Read document button). Read sources with RemNote's own reader.
- **Flashcard features** — the card info bar, batch card priority, card-maintenance commands (the flashcard-prioritisation engine was already off), True/False cards, the Card Enablement Audit and empty-Extra-Card-Detail cleanup, the hidden-slot migration commands, the Hide Front Extras command, the flashcard repetition-history popup (so no 🃏 Cards History button in the repetition-history popup), and cloze-creation commands. The editor's priority widget is on/off here rather than upstream's three modes, since its third mode existed only to add a card-priority editor beside rems with flashcards. The **Change Priority** popups (⚡ in the queue, and `Opt+P`) no longer offer a *Card Priority* section either: this fork never creates `CardPriority` tags, so the section had nothing to act on.
- **Analytics** — Priority/Weighted Shields, Practiced Queues and its per-card session tracking. (The Study Dashboard is kept.)
- **Editor utilities** — heading/outline restructuring, listify/bulletize, text-case converter, Convert Extracted Markup, reference finder, read points.
- **Misc** — video debug surface, all debug/repair commands, Priority Review Documents and the Priority Queue, the Plugin Hub sidebar panel and onboarding tips, queue cooling, and the Beautiful-queue corner priority badge (the fork's own chip covers it).
- **Modes** — Full performance mode is retired (the fork always runs Light; upstream lets you choose Full) and the startup "running in Light Mode" banner is gone.
- **Migration commands** — Import-with-History, Transfer IncRem Data to Parent, and Copy/Paste Rem Sources (upstream groups the latter with the PDF tooling).

**Options, off by default** — merged from upstream but switched off; each is one boolean in the same flags file (or one setting):

- **Review with Timer** — the 📝 button in the queue's Options row, the *Review in Editor* buttons in the IncRem table and list, and the `Ctrl+Shift+E` command (`editorReviewTimer`).
- **Priority-change history** — upstream now records a history entry every time a priority changes; off here, so the repetition history stays a list of reviews (`priorityChangeHistory`).
- **Media tools** — *Store linked images & audio in RemNote* (one Rem, or with descendants) and *Cycle Image Size* (`mediaTools`).
- **Hold Back Spoiler IncRems** — a setting, visible under General → Queue, off by default (on upstream).
- **Priority Bands (badges in tables)** — a setting under General → Appearance, off by default. Upstream gives every Incremental Rem that can appear as a table row (one carrying a tag of yours that has properties) a hidden *PriorityBand0–9* tag for its priority range, and draws a coloured badge such as "10s" in its table cell, since plugins cannot draw inside RemNote tables. With the setting off, nothing is tagged or drawn, and both band commands — *Refresh Priority Badges (Tables)* and *Remove All Priority Band Tags* — are hidden. To clear band tags written earlier, switch the setting on, reload, run **"Incremental: Remove All Priority Band Tags"** (it asks first, and loses no data — the tags only mirror the priority), then switch it off again.

**Changed:** the three history sidebar tabs (Incremental / Flashcard / Visited Rems) are merged into **one "History" tab** with collapsible sections. Kept: the 📚 Inc Rems counter under document titles, the No-IncRem queue timer, Sorting Criteria, all IncRem priority tools, and repetition history (Ctrl+Shift+H). **Sorting Criteria** no longer shows *Flashcard Randomness* (only Priority Review Documents used it, and they are off), and its card ratio is titled **Incremental Rem Frequency** ("One Incremental Rem after every N flashcards") — same setting, same stored value.


## Settings, in one window

As upstream, every setting lives in the plugin's own window — here the command is **"Incremental: Settings"** (quick code `is`). Where upstream leaves RemNote's plugin-settings panel empty, this fork puts one row there that points to the window.

The window is reorganised into **three sections** holding the 19 settings that still do something here (settings belonging to disabled subsystems are hidden, not deleted — their stored values survive). Also not listed: upstream's **per-type schedulers and initial intervals** (documents / videos / highlights / rems) — the general scheduler and interval apply to every type — and **Mastery Drill**'s switch, which is opt-in upstream, so the drill stays off here.

1. **General** — split into *Queue* (queue info bar, priority chip, collapse top bar, isolated card view, spoiler hold-back) and *Appearance* (priority widget in the editor, the two left-border indicators, hiding the Dismissed tag, priority bands — off by default).
2. **Priority & Scheduling** — *Priority* (default IncRem priority, step size), then *Scheduling* (initial interval, the Default Scheduler switch — Multiplier or Saturating Curve — the multiplier, and the curve's first-review and max intervals).
3. **Advanced** — Hide-in-Queue integration, flashcard response-time limit.

The Hide-in-Queue warning about duplicate powerups — the one thing here that can genuinely break the plugin — renders as a red callout rather than a sentence buried in the description.

## Commands in the omnibar

Every command this plugin registers is prefixed **`Incremental: `** in the omnibar, so they group together and are findable (upstream's one prefixed command, "Incremental RemNote: Settings", becomes "Incremental: Settings"). Several are also renamed (upstream → here):

- Make Incremental (Extract) → Extract / Tag Rem
- Dismiss Incremental Rem → Dismiss Rem
- Reschedule Incremental Rem → Reschedule Rem
- Open Incremental Rems Main View → Open Rems Table
- Preserve history & remove → Delete Rem, Keep Study History
- Cancel No Inc Rem Timer → Cancel Queue Pause Timer
- Quick Increase / Decrease Priority Number → Make Less / More Important
- Remove Parent / Remove Grandparent → Remove Parent / Grandparent from Card
- Open Sorting Criteria → Open Queue Sorting Criteria

Quick codes are unchanged.
