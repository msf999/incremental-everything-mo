# Mo's Incremental Everything

> **This is a personal fork of [Incremental RemNote](https://github.com/bjsi/incremental-everything)** (formerly *Incremental Everything*) by Jamesb, Hugomarins and Jonathangimeno. All credit for the plugin itself — incremental reading, prioritization, scheduling, analytics, and everything else it does — belongs upstream; read their README and [documentation site](https://hugomarins.github.io/incremental-remnote/) first. This fork is **unlisted** on RemNote, tracks upstream (currently synced to upstream v1.0.213, commit `10297b3` of 2026-11-10; this fork is version 1.0.218), and layers the changes described below on top.

This document only describes **what is different from upstream**. If a feature isn't mentioned here, it works exactly as in the original plugin.

---

## New properties on Incremental Rems

Both appear as visible properties under every Incremental Rem.

### Rotation

A plain-text scheduling override, written the way you would say it. Reviewing the Rem with **Next** then reschedules it by the rotation, bypassing the SRS scheduler entirely (an offset you pick with the chevron, below, wins for that one review). Leave it empty or write `Default` for normal scheduling — which is upstream's: the **Multiplier** scheduler by default (next interval = the item's current interval × 1.5) or the **Saturating Curve**, chosen in the settings window or per Rem in the Reschedule popup. A Rotation overrides either.

Two kinds of rotation:

- **An interval, counted from the day of the review:** `10` (days), `10 days`, `3 weeks`, `4.5w`, `1 week 2 days`, `1 week and 2 days`, `a week and a day`, `1w2d`, `6 months`, `daily`, `weekly`, `fortnightly`, `monthly`, `yearly`, `every 3 days`. Whole days, months and years are counted on the calendar: `1 month` on 31 January lands on 28 February, and `7` lands on the same weekday at the same time of day even across a daylight-saving change. A fractional or mixed length (`1.5 months`, `2 weeks 1 month`) is a plain span of days.
- **Days of the calendar** — the item comes back on the next such day after the review:
  - a weekday or several: `sunday`, `every sunday`, `mon, wed, fri`, `monday to friday`, `weekdays`, `weekends`;
  - every N weeks on a day: `every 2 weeks on monday`, `every other friday`, `fortnightly on monday`, `every second tuesday`;
  - a day of the month: `1st`, `every 1st of the month`, `1st and 15th`, `the 15`, `last day of the month`, `end of month` (a day the month does not have, like the 31st in April, means its last day);
  - a weekday of the month: `first saturday of the month`, `last friday`, `second tuesday`, `first and third monday`, `last weekday of the month`, `second last friday` (the one before the last; also `second to last`, `penultimate`);
  - every N months: `every 3 months on the 1st`, `quarterly on the 15th`, `every 2 months on the first monday` (a skip can be up to 520 weeks or 120 months);
  - a date of the year: `3 march`, `march 3rd`, `first monday of january`.

**A rule that skips keeps its rhythm.** `every 2 weeks on monday` counts its weeks from the date the item was due on, not from the day you got round to it: due Monday 2 November and reviewed on Wednesday the 4th, it comes back on Monday the 16th. If the item's due date is not a day the rule could have produced — you have just written the rule — the series starts at the next matching day.

A rotation lands on a calendar day: anything *between* zero and one day (`2 hours`, `30m`, `0.5`) is rejected, because the next-review date is stored as a day reference and cannot hold less than a day.

**`Rotation: 0` is allowed and means "always due".** Each review reschedules the item to today, which is already in the past, so it comes back in every future session until you change the rotation — it is a permanent always-in-the-queue marker, not a one-off repeat. It will not reappear within the *same* session, since the queue does not show an item twice in one sitting.

- **Inheritance:** when a Rem is made incremental, it inherits the Rotation of its closest incremental ancestor. Set `Rotation: 1 week` on a project note, and every extract created under it rotates weekly.
- The **Next** and **Open** buttons show the time until the rotation date in their sublabel (e.g. `7 days`), and Next's tooltip says how the rotation was understood (`Rotation: every 2 weeks on Mon`).
- **A rotation that cannot be read is said so, never guessed at.** A typo (`evry sunday`, `2 weeks on mnday`) turns Next and Open amber with `invalid rotation`, the chip under the document's title shows it in red, and reviews fall back to the normal scheduler until you fix it. The same goes for a comma between digits that could mean two things: `1,000 days` is a thousand days and `1,5 weeks` one and a half weeks, but `1,15` on its own is refused — write `1st and 15th`, or `1.15`.

**The 📚 Inc Rems chip** under a document's title shows, when the document is itself an Incremental Rem, its facts on one line: its priority (in its colour), the rotation in words (`🔁 every 2 weeks on Mon`), when it is next due (`next Mon 23 Nov (in 9 days)`, or `due now`), and its reviews and the time spent on them (`2 reps, 0.6 min`). Hover a fact for more — the rotation's tooltip says on which day a review today would land.

### First Added

A date property recording the day the Rem was first made incremental in this knowledge base. A Rem you dismiss and later make incremental again keeps that first day: it is read back from the review history the Rem kept (its earliest entry, not counting sessions you added by hand or reviews imported from a flashcard). Rems made incremental before this property existed have it empty. Purely informational — useful for sorting and auditing what entered the system when.

## The queue review bar

The answer-button row is rebuilt into seven buttons:

**Previous · Next · Open · 🔄 · Dismiss · ⚙️ Options · Skip**

Previous, Next, Open, Skip and Dismiss share one width (Dismiss's), chevrons included; 🔄 is narrower, and ⚙️ Options widens while its row is open. Under **Next** and **Open** you see when the item will next be due if you press it — just the time, e.g. `5 days` or `11.4 months`. While an action runs the whole row greys out, so a double press cannot fire twice.

**On a phone** the same seven buttons are icons with no words, on one line: **←** Previous, **→** Next (with the time until the next repetition under it), **↗** Open, **🔄**, **⊗** Dismiss, **⚙️** Options and **⏭** Skip — same colours, same ▼ chevrons. The Options row shows each tool's emoji alone (🗓️ Reschedule, ⚡ Change Priority, 📝 Review Note, 📎 Web-Clipper URL, ℹ️ Help), the offset picker's Apply button shows the action's icon and the amount (e.g. **→ 3 weeks**), and the already-reviewed row reads ← · the status · ↗ · →.

- **Previous** steps back to the last card. Going back to something you just reviewed shows it in the *already-reviewed* state described below. Going back to one you skipped and pressing Next records an ordinary review — upstream would delete the item's previous review in that case.
- **Next** (blue outline) — record a review, advance. The review is saved **before** the queue moves on, so if the save fails the item stays on screen with a message. Upstream has since made its own Next move on at once and save in the background; this fork keeps the save-first order for Next, Open, Skip-with-offset and the offset picker.
- **Open** (green outline; its keyboard command keeps the name *Open Editor*) — records the review **and opens the Rem in-app** (no browser tab), so you can process it immediately. Scheduling happens before navigation, so the review is never lost.
- **🔄 Another item** — sets this Incremental Rem aside for the rest of the session (no review, no reschedule — it stays due) and **immediately shows a different due Incremental Rem in its place**. Press it again for another. Which one comes is the queue's own choice for its next Incremental Rem: by priority, most overdue first among equals, with your **Sorting Criteria → randomness** applied exactly as the queue applies it (at 0 you always get the strict next one; at 20%, about one press in five draws a priority-weighted pick from the whole due list instead). Skip leaves the same way, but what follows is whatever RemNote already lined up next, usually a flashcard; 🔄 gives you another Incremental Rem now. Keyboard priority changes (`Ctrl+Opt+↑/↓`) and **Copy Rem ID** (`Ctrl+Opt+I`) act on the Incremental Rem 🔄 brought in, not on the one set aside.
- **Dismiss** (red outline) — dismisses the item, recording the review that is ending.
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
| `Ctrl+P` | **Preview Item** — the Incremental Rem on the queue screen (or the focused Rem) in a popup where it can be edited; the same key, or Esc, closes it. On Windows and Linux Ctrl+P is RemNote's *Search All Notes*: rebind one of the two |
| `Opt+X` | **Toggle Incremental** — make the Rem (or the selected Rems) incremental, or dismiss it if it already is. A selected piece of text becomes an extract. In the queue, with nothing selected, it acts on the item on screen |

On a flashcard these keys leave the card alone — even when its Rem is itself an Incremental Rem — and `Opt+T`, `Opt+B` and `Opt+R` say they work on Incremental Rems only. Rate flashcards with RemNote's own keys. Upstream's **Reschedule** (`Ctrl+J`) on such a flashcard reschedules the Rem's incremental schedule and leaves the card on screen to be rated. A quick second press of `Opt+T` / `Opt+B` / `Ctrl+G` waits for the next item to load instead of acting on the one you just left. Upstream's **Copy Rem ID** (`Ctrl+Opt+I`) copies the Incremental Rem on screen when nothing is focused or selected; upstream's version only knew flashcards there and said "No Rem focused or selected".

**Opt+X replaces upstream's two keys** (`Opt+X` to make incremental, `Ctrl+D` to dismiss). It acts on what you have selected, else on the Rem your cursor is in — in the queue, else on the item on screen. A selection of several Rems is dismissed only when all of them are incremental; otherwise the rest are made incremental. **In the queue a dismissal needs a second Opt+X within a few seconds** — the first press only shows a toast saying so — and Opt+X does nothing on RemNote's own screens (e.g. the finished screen) or on the "Already reviewed" row. It cannot extract text from a PDF: RemNote does not tell plugins about a selection inside its PDF viewer. Both original commands are still in the omnibar ("Incremental: Extract / Tag Rem", "Incremental: Dismiss Rem"), without a key.

A dismissal from the keyboard (Opt+X, or the omnibar's Dismiss Rem) and upstream's **Reschedule** now work as they do upstream since v1.0.164: the queue moves on at once and the change is written in the background a moment later. If that write fails, a dialog says which Rem was not saved. For that moment the queue's keys (Next, Skip, Another Item, Open) ignore a press, so a quick second key cannot land on the item you just left.

Two upstream defaults collided with Chrome DevTools, which matters when RemNote runs in a browser tab, and were moved: **Review in Editor** `Ctrl+Shift+J` → `Ctrl+Shift+E` (a command that is off by default here now, see below), and **Toggle Ignore Tag** `Ctrl+Shift+I` → `Ctrl+Shift+G`.

## Queue behaviour

### Items are shown as the Rem, not the source document

- A queue item renders **the Rem itself in the queue body**, using RemNote's real document renderer — actual formatting and powerup properties — not a plugin-drawn approximation. It opens **at its top**, also when RemNote remembers that you last left that document scrolled half-way down. It is **read-only for the keyboard** — see *Writing into an item* below. Two exceptions: a RemNote video Rem (*Upload File › YouTube URL*) plays in RemNote's own video player, and — from upstream unchanged — an Incremental Rem with exactly one source that is an ordinary Rem shows that source Rem (tag it `#extractviewer` to show the Rem itself). Other video items (a Rem that is a YouTube link, a Video Extract) are shown as the Rem; upstream's own video players are off here — see *Video* under *Slimmed down*.
- An IncRem with a PDF/HTML source attached shows this outline too — the source reader is disabled entirely in this fork (see below), so there is no 📄 Read document button. Highlight-type items keep upstream's isolated view.
- The breadcrumb above the item (in the document view and the isolated card) shows each ancestor with the **icon RemNote gives it**: a folder's or document's own emoji or coloured folder picture — e.g. **📒 Zotero › 📄 Items** — RemNote's folder picture for a folder without one, and RemNote's page icon for a document without one. It stays on one line: when the names do not fit, crumbs fold to their icon (the middle ones first, then the top one) and the item's parent is shortened with an ellipsis. Hover a crumb for its full name; click it to open it.
- The notes sidebar **never opens on its own**. The footer under the item (type + child/descendant/flashcard counts) ends with a small **✎ Open in sidebar** button: it opens the Rem in the notes sidebar for full editing (backlink search, date pickers, etc.) and pauses the in-queue copy while it's there; the button becomes a filled-blue **✎ Show in queue** to bring it back. Close the sidebar pane itself with RemNote's own control.
- Clicking the breadcrumb row, the footer, the info bar, the priority chip, the isolated card or the margin around the item leaves keyboard focus with RemNote, so the queue's shortcuts keep working after the click. The isolated card's text can still be selected and copied. A review note you left unfinished reopens with its item without taking the keyboard; click into it to type.
- An Incremental Rem's review time counts from the moment it appears on screen, not from when the queue lined it up (which is while you are still on the card before it).
- If the plugin restarts while you are in the queue (an update), or you reload the page there, the session carries on: items you have already seen are not served again, a 🔄 swap stays, and a document's queue stays that document's — its counter, and only its Incremental Rems.
- Leaving the queue by navigating away (**Open**, a link, a document) ends its session as closing it does. When you come back, nothing the queue had lined up before is mixed into the new session, and no Incremental Rem is shown twice in it.
- **Skipping quickly** (Skip, `Opt+B`, 🔄) does not run the queue dry: it keeps a few Incremental Rems ready and refills them as soon as they run out, so they keep coming however fast you go, and a queue with no flashcards left does not end while some are still due.
- A queue in which **only Incremental Rems are due** used to stop on RemNote's "finished" screen. Upstream's fix for that is in: after a brief flash of that screen the first Incremental Rem appears.
- A document's **Practice All** and **Practice in Order** show only the Incremental Rems that are due, as the normal queue does; upstream shows every Incremental Rem in the document there. Its flashcards are RemNote's business — Practice All still shows them all.
- **Scrolling a long item from the keyboard:** the arrow keys do not scroll an item (or a flashcard) taller than the screen — RemNote never gives its scroll area keyboard focus, and plugins have no way to. Click into the text and use **Page Up / Page Down** (`fn+↑` / `fn+↓` on a Mac).

### Writing into an item

In RemNote's queue, the queue's own keys stay live while the caret is inside a document that a plugin shows there: with the caret in a bullet, `H` skips the item, so does `→`, and whatever letters you have bound to answers rate it. RemNote only holds its queue keys back when its own focus tracking says a text editor is focused, and it does not enter such a document in that tracking; a plugin, which runs sandboxed, can neither see those keys nor set that focus.

So in this fork **the queue view does not take the caret at all**: nothing can be half-typed, half-shortcut. Text can still be selected (for an extract with `Opt+X`), links and checkboxes still work. To write into the item, use one of the two places where RemNote does track the focus — both checked with the same keys:

- **`Ctrl+P` — Preview Item:** the item in a popup, as the same document page, editable. Esc (or `Ctrl+P` again) closes it and you are back on the item.
- **✎ Open in sidebar** in the footer under the item: the item in the notes sidebar, for longer edits.

One exception, where the queue view stays editable and RemNote's queue keys therefore stay live while you type in it: **RemNote's phone and tablet apps**, which have neither the sidebar button nor `Ctrl+P`, so the queue view is the one place to write.

**A RemNote video Rem** follows the same rule: its page in the queue (RemNote's own video page — the player, its outline and its flashcard buttons) is read-only for the keyboard as well. In RemNote 1.30 that page has nothing to type into in any case, and `Ctrl+P` shows the same page.

### Items you've already reviewed

An Incremental Rem whose next review is in the future still appears in the queue — it is never silently skipped — but with a different, deliberately harmless set of buttons:

**Previous · ✓ Already reviewed, next in 4 days · Tue, Aug 18 · Open · Next**

You'll see this in two situations: you pressed **Previous** to go back to something you just reviewed, or you met an item that was reviewed on another device after this queue session started (the item list is built once, at the start).

**None of these buttons changes the item's schedule.** *Next* simply moves on, *Previous* steps back, and *Open* takes you to the Rem without recording a review — which is why Previous and Next look identical here. The keyboard behaves the same way: `Opt+T` / `Cmd/Ctrl+→` only move on, `Ctrl+G` opens the Rem like the row's *Open*, and `Opt+X` and `Opt+R` do nothing here (Opt+R says why). The row offers no way to re-review, reschedule or dismiss the item; the point is that "already done" is visible and safe to click through. If you do mean to dismiss it, the omnibar's **"Incremental: Dismiss Rem"** still works — without recording a second review.

You should only meet this row when you went back, or when another device reviewed the item. An item you have just reviewed is not handed to RemNote a second time, and if RemNote shows it again right after its review all the same, the queue moves on by itself. Should that ever happen, **"Incremental: Copy Queue Diagnostics"** copies what the queue did in the last minutes.

A third way to meet this row: you change an item's **Next Rep Date** by hand while it is on screen. The queue picks up the new date straight away, so the item is not served again until it is due.

### Info bar under every queue item

Upstream shows its info bar under Incremental Rems, plus a card bar under flashcards that carry a card priority (removed here — see *Slimmed down*). Here one info bar appears under **every** queue item, flashcards included, and leads with the **due-IncRem priority distribution**: a stacked bar across the plugin's ten priority bands (0s, 10s, … 90s), coloured on a fixed scale by priority value — red for the 0s (most urgent) through blue for the 90s. A band's colour can therefore differ from the priority chip's and from the bar's own left border, which are coloured by where that priority sits among all your Incremental Rems (below).

Band widths are proportional to their counts, so the shape of your backlog reads at a glance; every band shows its number, zeros included; and the band holding the current item's own priority is ringed, so you can see where what you're reviewing sits against the rest. Hover for the exact figure and share of each band.

After the distribution the bar shows the item's own repetitions and review time. Priority is not repeated here — it lives in the chip at the top of the queue (below).

Control it under **General → Queue → Queue Info Bar**: all items / Incremental Rems only / all items but Incremental Rems only on mobile (the default) / off.

### The queue counter

Upstream appends the number of due Incremental Rems to RemNote's card counter (`30 + 1620`). This fork adds, in parentheses, how many of those have a **priority below 10** — the red 0-band of the distribution bar — so the counter reads **`30 + 1620 (1064)`** in Compact and **`30 Left + 1620 (1064)`** in Beautiful. Both figures say how many Incremental Rems of this queue are **still due**: they fall when you review, reschedule or dismiss one, and not when an item merely passes by — **Skip** and **🔄 Another item** leave them as they are, because such an item is still waiting. In the queue of the whole knowledge base, the distribution bar's first band and the figure in parentheses count the same items; in a document's queue the counter covers that document, while the bar still shows the whole knowledge base.

### Priority chip in the queue's top bar

The `P50 (92.5%)` chip at the top right is the one place priority is shown, for Incremental Rems and flashcards alike.

The percentage is a **rank, not a share**. Since a lower priority number means more important, `92.5%` says 92.5% of your Incremental Rems are at least as important as this one — only the other 7.5% are less important. Items with the same priority share one rank (with hundreds of Incremental Rems at P5, every one of them shows the same percentage), so the number changes only when the item's priority or the rest of your collection does. The Rems Table, the 📚 list and the History tab rank the same way. Hovering explains that, names where the priority came from, and adds the same rank within your current queue scope.

The chip's **colour** is upstream's: since upstream v1.0.193 every priority colour in the plugin — the badges in the editor, the tables, this chip, the info bar's left border — comes from one map, so a priority has the same colour everywhere. The map places a priority by the middle of the group of items that share it (with hundreds of items at P5, P5 is coloured as the middle of that group, not as its far end), on a ramp that changes fastest across the most important third. So the colour and the written percentage can point at different places for a priority that many items share. The map is built when the plugin starts: priorities you change during a session move the colours only at the next start, or when you run **"Incremental: Refresh Rem Cache"**.

Under a flashcard the chip shows the priority of the card's Rem if that Rem is (or was) an Incremental Rem, otherwise **its document's** (inside a Card Cluster it follows the card that is on screen, not the cluster's first card) — and only that one document's: the lookup stops there and never walks further up, so a card inside a document you haven't prioritised shows no chip at all. If the source has been dismissed, the chip shows the last priority its review history recorded; if a priority cannot be read at all, it shows a grey **P?**. Clicking opens the priority editor only when the number is the item's own live Incremental-Rem priority; for a document's priority, or a dismissed Rem's, the chip does nothing. On RemNote's own screens — the finished screen, checkpoints — there is no item, and no chip.

Set it under **General → Queue → Priority Chip in Queue Top Bar**: always show (the default) / always hide / only on web / only on mobile.

### Both queue variants

Everything here works in RemNote's **Compact** and **Beautiful** queue variants. In Beautiful: the priority chip sits in the top bar's action row (next to the +, ✎ and ⋯ icons) rather than in the card's corner where upstream draws its badge; the info bar under flashcards is docked just above the answer buttons, below RemNote's AI Explanation, exactly as upstream docks its own bar; and the counter reads **`N Left + M (U)`** (upstream's suffix only appears in Compact). An Incremental Rem fills the card down to the button row, and the Options row and offset picker grow the button area while the item shrinks to make room.

### On the phone

In RemNote's phone app the queue body stayed white for many Incremental Rems. The cause is RemNote's: the document page it draws for a plugin fails for a **Document** on a phone (while drawing its Share button) and is left empty. What follows applies **only in RemNote's phone app** (and its tablet app, if that identifies itself as RemNote's app) — desktop, the web app and iPad browsers are unchanged. It was checked in Chrome made to show RemNote's phone layout; a real phone has yet to confirm it, so each part can still be switched off on its own in `src/lib/mobile_experiments.ts` (the code is marked `MOBILE-EXPERIMENT`).

- **A Document is drawn as RemNote's own outline, under its name.** In place of the document page the queue body shows the Document's name and, below it, RemNote's outline of its Rems — real formatting, editable. What it leaves out is the table of properties RemNote lists under a title (Priority, Next Rep Date, a tag's properties…). A long name keeps to three lines until you tap it. Anything that is not a Document keeps RemNote's page, and so does a Document that is a PDF, a web link, a video or an audio recording: RemNote's page works for those.
- **The answer buttons are icons on one line** (see *The queue review bar*), which leaves the item most of the screen.
- **The footer is one line** — "Document • Incremental Rem" — with no statistics and no **✎ Open in sidebar**: on a phone the notes sidebar is a full-screen sheet that draws the same page, white for a Document.
- **≡**, at the start of the breadcrumb row, swaps RemNote's view for a plain-text outline that the plugin draws itself (≡ again goes back). A dashed box at its top lists what the plugin can see about the Rem. Over RemNote's document page this button is hidden by RemNote's own page header; over the outline it is not.
- The queue body and the answer buttons carry their own layout and fallback colours, because RemNote's stylesheet does not reach the plugin in the phone app (without the colours, grey text and icons are black in dark mode).
- If RemNote leaves its view empty, or never shows it, a small label starting "IE check:" says so at the view's top right after a second and a half. A white body with no label means RemNote created no view at all.

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

- **All PDF/reader tooling** — the in-reader highlight toolbar (bookmark / extract / tag-as-incremental / peek), PDF Control Panel, source popups (Opt+O / Opt+Shift+O), reading-position memory, source pins (Pin Source Quote, also for a whole subtree; AI transcribe), *Follow the Queue's Sources* in a second window and *Open in Another Window*, the Logos Bible Software bridge, the tag-rems-with-images scan, and the in-queue reader itself: queue items always show the rem outline (no 📄 Read document button). Read sources with RemNote's own reader.
- **Flashcard features** — the card info bar, batch card priority, card-maintenance commands (the flashcard-prioritisation engine was already off), True/False cards (with *Judge by Emoji*), the scissors and True/False answer sheet on multiple-choice cards, *Recognition First*, the FSRS scheduler-data import, the bridges that let other plugins set card priorities or link card videos, the Card Enablement Audit and empty-Extra-Card-Detail cleanup, the hidden-slot migration commands, the Hide Front Extras command, the flashcard repetition-history popup (so no 🃏 Cards History button in the repetition-history popup), and cloze-creation commands. The editor's priority widget is on/off here rather than upstream's three modes, since its third mode existed only to add a card-priority editor beside rems with flashcards. The **Change Priority** popups (⚡ in the queue, and `Opt+P`) no longer offer a *Card Priority* section either: this fork never creates `CardPriority` tags, so the section had nothing to act on.
- **Analytics** — Priority/Weighted Shields, Practiced Queues and its per-card session tracking. (The Study Dashboard is kept.)
- **Editor utilities** — heading/outline restructuring, listify/bulletize, text-case converter, Convert Extracted Markup, reference finder, read points.
- **Video** — upstream rebuilt Incremental Video: its own players for YouTube links, Video Extracts and local video files, a choice between its player and RemNote's for a RemNote video Rem, and transcripts, snapshots and card videos around them. All of it is off here (`videoSurface`), the players included. A YouTube player can no longer run inside a plugin's frame (upstream's finding), so upstream's player **creates a document in your knowledge base** — "▶️ Incremental RemNote video player", holding an Embed Website Rem that it re-points at each video — and loads a player page hosted on upstream's site in it; its transcript and snapshot buttons also look for a helper program on your computer. Here a RemNote video Rem plays in RemNote's own player, exactly as before, and a YouTube-link item or a Video Extract is shown as the Rem (open the video from there). Before this sync such an item showed the old in-plugin YouTube player, which upstream reports as a black box in current RemNote.
- **Outside helpers** — the Chrome Companion extension's listener, and the media tools: *Store linked images & audio in RemNote* (one Rem, or with descendants), *Cycle Image Size*, the Local Media Bridge and *Upscale image with ChatGPT*.
- **Misc** — upstream's stall diagnostics, all debug/repair commands, Priority Review Documents and the Priority Queue, the Plugin Hub sidebar panel and onboarding tips, queue cooling, and the Beautiful-queue corner priority badge (the fork's own chip covers it).
- **Modes** — Full performance mode is retired (the fork always runs Light; upstream lets you choose Full) and the startup "running in Light Mode" banner is gone. Upstream's warm start is on, as it is upstream: start-up loads the Incremental Rem cache from a copy kept on the device and re-reads only what changed since. The command **"Incremental: Refresh Rem Cache"** re-reads everything on demand, and rebuilds the priority colours with it.
- **Migration commands** — Import-with-History, Transfer IncRem Data to Parent, and Copy/Paste Rem Sources (upstream groups the latter with the PDF tooling).

**Options, off by default** — merged from upstream but switched off; each is one boolean in the same flags file (or one setting):

- **Review with Timer** — the 📝 button in the queue's Options row, the *Review in Editor* buttons in the IncRem table and list, and the `Ctrl+Shift+E` command (`editorReviewTimer`).
- **Duplicate-source check** — upstream warns when you make incremental a Rem whose web page already has an Incremental Rem, and adds an *Incremental Rems by Website* list; off here (`duplicateSources`).
- **Hold Back Spoiler IncRems** — a setting, visible under General → Queue, off by default (on upstream).
- **Priority Bands (badges in tables)** — a setting under General → Appearance, off by default. Upstream gives every Incremental Rem that can appear as a table row (one carrying a tag of yours that has properties) a hidden *PriorityBand0–9* tag for its priority range, and draws a coloured badge such as "10s" in its table cell, since plugins cannot draw inside RemNote tables. With the setting off, nothing is tagged or drawn, and both band commands — *Refresh Priority Badges (Tables)* and *Remove All Priority Band Tags* — are hidden. To clear band tags written earlier, switch the setting on, reload, run **"Incremental: Remove All Priority Band Tags"** (it asks first, and loses no data — the tags only mirror the priority), then switch it off again.

**Changed:** the three history sidebar tabs (Incremental / Flashcard / Visited Rems) are merged into **one "History" tab** with collapsible sections. Kept: the 📚 Inc Rems counter under document titles, the No-IncRem queue timer, Sorting Criteria, all IncRem priority tools, and repetition history (Ctrl+Shift+H). **Sorting Criteria** no longer shows *Flashcard Randomness* (only Priority Review Documents used it, and they are off), and its card ratio is titled **Incremental Rem Frequency** ("One Incremental Rem after every N flashcards") — same setting, same stored value.


## Settings, in one window

As upstream, every setting lives in the plugin's own window — here the command is **"Incremental: Settings"** (quick code `is`). Where upstream leaves RemNote's plugin-settings panel empty, this fork puts one row there that points to the window.

The window is reorganised into **three sections** holding the 19 settings that still do something here (settings belonging to disabled subsystems are hidden, not deleted — their stored values survive). Also not listed: upstream's **per-type schedulers and initial intervals** (documents / videos / highlights / rems) — the general scheduler and interval apply to every type — **Mastery Drill**'s switch, which is opt-in upstream, so the drill stays off here, and the settings upstream has added since for features that are off here. One of those does act here, at upstream's default: **Ignore Same-Day Reviews** (on) — a second review of an item on the same day, before it is due again, keeps its next date. In this fork's queue that cannot happen (an item you already reviewed comes back with the "Already reviewed" row), so it matters only for reviews recorded outside the queue.

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

Fork-only commands: **Toggle Incremental (Make / Dismiss)**, **Another Item in Queue**, **Skip Item in Queue**, **Next Item in Queue (alternate)**, **Open Editor**, **Preview Item**, and **Copy Queue Diagnostics** (the queue's recent decisions, for a bug report).

Quick codes are unchanged.
