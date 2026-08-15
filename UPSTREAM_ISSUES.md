# Bugs found in upstream `bjsi/incremental-everything`

Found while maintaining the `incremental-everything-mo` fork. Every item below is **upstream code** —
each was verified as unmodified by the fork before being listed (`git diff upstream/main -- <file>`
empty at the time of discovery), and re-checked against upstream `9d2ea3a` (2026-08-15) to confirm it
is still present.

Ordered by severity. Each entry gives the mechanism, why it is reachable, and the fix the fork
applied, so a maintainer can take or adapt it.

---

## 1. A failed review is reported as success and consumes the item

**`src/lib/scheduler.ts` — `updateSRSDataForRem`**

It is the only function that persists a review, returns `void`, and bails with a `console.log` when
`getDailyDocReferenceForDate` yields nothing. Callers cannot distinguish total failure from success,
so `updateReviewRemData` returns a success-shaped payload regardless, and
`handleNextRepetitionClick` then patches the session cache with the new date and calls
`removeCurrentCardFromQueue()`.

**Result:** the IncRem leaves the queue looking reviewed while **nothing was written to the Rem** —
due again next session with no record of the repetition, its review time or its interval, and hidden
from the counter meanwhile because the cache says otherwise.

**Reachable, not theoretical.** `getDailyDocReferenceForDate` goes through `plugin.date.getDailyDoc`,
whose concurrent-call race is documented in your own `incremental_rem/index.ts` (*"firing two
getDailyDoc calls concurrently can make one lose the race and resolve to undefined"*) — the reason
`initIncrementalRem` reuses `todayRef`.

**Fork fix:** return the persisted history (`Promise<IncrementalRep[] | null>`) instead of `void`, log
`console.error` on both failure paths, and have every queue-consuming caller bail on `null` rather
than advancing. Also dropped the `rem?.` optional chaining that made the missing-rem case silent.

---

## 2. An out-of-range inherited priority makes a Rem permanently invisible

**`src/lib/priority_inheritance.ts` — `getInitialPriority`** (still unclamped in `9d2ea3a`)

`initIncrementalRem` clamps `defaultPriority` but not `getInitialPriority`'s result, which is a raw
`parseInt` of a slot with `!isNaN` as the only check. An out-of-range value — hand-edited slot,
import, older plugin version, corrupted sync — is written to the priority slot **and stamped into the
`madeIncremental` history marker**.

Both Zod schemas bound priority to 0–100, so that one entry makes `IncrementalRem.safeParse` fail:
`initIncrementalRem` returns early (skipping the cache insert, host-index registration and the
inheritance cascade) *after* the Rem is already tagged and written, and every later
`getIncrementalRemFromRem` returns `null`.

**Result:** `null` means "not an Incremental Rem" to every consumer, so the Rem vanishes from cache,
queue, counter and distribution **permanently**, while still showing its powerup and properties in the
editor. The only trace is one console line at creation.

**Fork fix:** clamp at the source and again before the write, and — the load-bearing part — repair
out-of-range history priorities *on read* in `getIncrementalRemFromRem`. Clamping at the source does
nothing for a Rem already in this state, because the bad entry is persisted and re-tagging cannot
remove it. The read repair clamps rather than drops (the date, interval and review time are all still
true) and writes nothing back. Verified: a history containing `priority: 150` fails `safeParse` before
the change and parses to `[100, 20]` after.

---

## 3. The unreadable-priority placeholder is laundered into real data

**`src/lib/incremental_rem/types.ts` contract vs. five history writers**

`types.ts` states the contract — a `'fallback'` priority is `UNREADABLE_PRIORITY_FALLBACK` (50), it
"means nothing", and "must not be written back or stamped into history" — but only `scheduler.ts`
honours it. Five other writers stamp `priority: incRem.priority` unconditionally.

**The harm is a one-way door.** A Rem whose Priority slot is unreadable (real — the same file records
slots being detached by RemNote's storage overhaul) reads as `50 / 'fallback'`. Dismiss it or review
it in the editor, and 50 lands in a history entry. The next read finds it through the history tier and
reports `prioritySource: 'history'` — which the contract calls **"trustworthy as a value"**. The
placeholder is now indistinguishable from a genuinely recovered priority, it is the most recent entry
so it buries the older ones the real value might still have been recoverable from, and the Rem is
silently, permanently rewritten to P50.

**Worse:** the review timer *seeds* its session priority from the Rem (`incRem?.priority ?? 10`), so
for an unreadable slot that seed **is** the placeholder — and `setIncRemPriority` then writes it into
the **real priority slot**, promoting it to `prioritySource: 'slot'`, the tier the contract calls
fully trustworthy. That is the irreversible half; stamping history is the lesser one.

**Fork fix:** a shared `priorityStampFor(incRem)` helper returning `{}` for a `'fallback'` priority
that all five writers spread, plus `seedPriorityForTimer` which seeds `undefined` for an unreadable
priority so the slot write cannot happen. Also: `findClosestIncrementalAncestor` now skips ancestors
whose priority is `'fallback'` and keeps climbing, so a new Rem is not born at 50 because an ancestor
has a damaged slot.

---

## 4. `interactionOnSameDay` compares two Date objects by reference

**`src/lib/scheduler.ts`** (still present in `9d2ea3a`)

`new Date(scheduled) == new Date(prev.date)` compares two distinct `Date` *objects* — always false. So
`useRealScheduledTime` collapses to `!prevInteraction`, and every entry past the first is compared at
day granularity.

**Result:** a rep answered on the same calendar day it was scheduled does not use the real time, which
changes which reps `removeResponsesBeforeEarlyResponses` cleanses and therefore the computed interval.

**Fork fix:** compare calendar days (`dayjs(a).isSame(b, 'day')`), and fail loudly on a missing Rem or
unresolvable date reference instead of returning silently.

---

## 5. Unguarded ancestor walks can loop forever on a cyclic parent chain

**`src/lib/priority_inheritance.ts` — `findClosestIncrementalAncestor`, `findClosestAncestorWithAnyPriority`**

Both walks exit only on finding their target, a falsy `parent`, or a missing Rem. A cyclic parent
chain — a self-parent, or `A → B → A` from conflict-merged sync data — satisfies none of those, so the
loop runs forever issuing SDK calls, flooding the plugin bridge rather than merely hanging.
`.catch(() => false)` on `isDocument()` does not help: one that always throws just keeps the climb
going.

These are reached from `getInitialPriority` during **extraction**, so a hang freezes tagging a Rem.

**Fork fix:** a visited `Set` (the exact cycle detector) plus a `MAX_ANCESTOR_DEPTH = 100` backstop for
the acyclic-but-absurdly-deep case, both warning rather than failing silently. Verified against
synthetic chains: self-parent caught in 2 steps, `A→B→A` in 3, a 500-deep acyclic chain stopped at the
cap, a normal 3-deep chain unaffected.

---

## 6. `plugin_operation_active` leaks when flashcard prioritisation is off

**`src/register/tracker.ts` — the inheritance-cascade watcher**

`initIncrementalRem` and `extract.ts` set `plugin_operation_active = true` and rely on the cascade
watcher's `finally` to clear it. With `enable-flashcard-prioritisation` off — **the default** — the
watcher returns early *without* clearing.

**Result:** the flag stays up and suppresses `GlobalRemChanged` handling (manual powerup-removal →
Dismissed transfer, manual date-edit detection) until something else clears it.

**Fork fix:** clear the flag (and the pending-cascade key) on that early return, mirroring `runCascade`'s
`finally`.

---

## 7. `initIncrementalRem` destroys before it gives up

**`src/lib/incremental_rem/index.ts`**

`mergeHistoryFromDismissed` removes the Dismissed powerup, then `if (!dateRef) return` bails *before*
`addPowerup` runs. The Rem ends up with neither powerup — its preserved history detached and its
Incremental tag never applied.

Not fixed in the fork (noted only); the ordering wants an upstream decision about whether to restore
the Dismissed powerup or defer its removal until after the write can succeed.

---

## Notes

- Items 1–6 have fixes in the fork and can be lifted more or less directly; item 7 is reported only.
- Two of these (1 and 2) are silent data-loss paths — an item leaves the queue looking reviewed with
  nothing written, or disappears from the plugin entirely while still looking normal in the editor.
  Those seem worth prioritising.
- Separately, and **not** an upstream bug: RemNote itself no longer renders a returned plugin queue
  item when its own card list is empty at queue entry, which makes an all-IncRem queue show "you have
  finished all your cards". `loadCards` commits `currentCard = null` before the plugin is asked, and
  `numRemainingCards()` does not count the `pendingPluginCard` it stores. Worth raising with RemNote —
  the queue-prefetch work in `9d2ea3a` reduced the latency but does not address this.
