# Upstream Merge Plan

> **Purpose:** Forward-looking runbook for merging upstream changes into this fork.
> This is a **plan**, not a record. The historical record of what was actually merged and
> how conflicts were resolved lives in [`FORK_TRACKING.md`](./FORK_TRACKING.md) and is updated
> **only after** a merge completes (per its "Logging Protocol"). Do **not** log results here.

---

## Current pending sync

| Field | Value |
|---|---|
| **Base (last synced)** | `7e0bc0d` — _Merge PR #271_ (synced 2026-04-16) |
| **Target (upstream HEAD)** | `2955e9a` — `bjsi/incremental-everything@main` |
| **Our HEAD** | `86028a9` — `origin/main` |
| **Delta size** | ~245 commits / ~6 weeks |

**Upstream themes in this delta** (these drive the conflict hotspots):
card-cluster expansion for sibling rems; PDF bookmark/highlight-preview improvements and
preserve-highlight-references on extract; priority-shield overdue tracking + activation changes;
`CardPriorityDisplay` sibling context; inheritance-cascade debounce removal + local ancestral
lookup for inc-rem discovery; `quickCodes` added to all commands + command renames (incl. the
extraction command); a new Rem History widget + global open-Rem listener; manifest patch bumps.

> The exact per-file conflict set is confirmed at execution time in **Step 3** (GitHub omits the
> inline file list for a diff this large, so it must be enumerated locally after `git fetch`).

---

## Conflict map (our deviation files)

Only files the fork has modified can conflict. Reference: `FORK_TRACKING.md` → "Current Deviations".

| File | Risk | What to preserve |
|---|---|---|
| `public/manifest.json` | reconcile | Keep `repoUrl`=fork + `unlisted: true`; accept upstream `version`. |
| `src/register/commands.ts` | **HIGH** | `open-incremental-editor` (`Ctrl+G`) + `(OpenLink)` URL/skip-doc logic. |
| `src/widgets/answer_buttons.tsx` | **HIGH** | 6-button layout, `SplitButton`s, green in-app Open Editor flow, `(OpenLink)` trackers, rotation warning, Skip `rescheduleWithoutReview`. |
| `src/lib/incremental_rem/index.ts` | **HIGH** | rotation read, helpers, First-Added/inherited-rotation init, `updateReviewRemData` `newNextRepDate` return. |
| `src/lib/incremental_rem/types.ts` | low | Keep both `rotation` and upstream `createdAt`. |
| `src/lib/consts.ts` | low | `firstAddedSlotCode`, `rotationSlotCode`. |
| `src/register/powerups.tsx` | low | First Added (DATE) + Rotation (TEXT) slots. |
| `src/components/NextRepTime.tsx` | low | rotation-aware display branch. |
| `package.json` / `package-lock.json` | low | Keep `parse-duration`; regenerate lock via `npm install`. |
| `src/lib/open_editor_link_tag.ts` | none | Fork-only new file — cannot conflict. |
| `src/components/buttons/SplitButton.tsx` | none | Fork-only new file — cannot conflict. |

---

## Runbook

### Step 1 — Pre-flight (read-only)
- `git status` — confirm a clean working tree.
- Re-read `FORK_TRACKING.md` → "Current Deviations" (conflict map) + "AI System Instructions".
- `git fetch upstream` — advance `upstream/main` to `2955e9a`; verify with
  `git rev-parse upstream/main`.

### Step 2 — Safety net
- `git branch backup/pre-merge-2955e9a` — rollback anchor at `86028a9`.
- `git switch -c merge/upstream-2955e9a` — merge off `main` so `main` stays clean until verified.

### Step 3 — Recon the real conflict surface
Enumerate which of our deviation files upstream actually touched:

```sh
git diff --stat 7e0bc0d..upstream/main -- \
  public/manifest.json src/lib/consts.ts src/register/powerups.tsx \
  src/register/commands.ts src/lib/incremental_rem/types.ts \
  src/lib/incremental_rem/index.ts src/widgets/answer_buttons.tsx \
  src/components/NextRepTime.tsx package.json package-lock.json
```

- Per high-risk file: `git log --oneline 7e0bc0d..upstream/main -- <path>` for context.
- Total churn / new files: `git diff --stat 7e0bc0d..upstream/main | tail -1` and
  `git diff --name-status 7e0bc0d..upstream/main | grep '^A'`.

### Step 4 — Merge (merge-commit style, matching prior protocol)
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

### Step 5 — Verify
- `npm install` — pick up `parse-duration` + any new upstream deps; regenerate the lock.
- `npm run build` (production webpack) **must compile**. Pre-existing `tsc` errors are acceptable
  only if unchanged. Optionally `npm run dev` for a dev-compile sanity check.
- Smoke-test (if running end-to-end): rotation scheduling + amber invalid-rotation warning,
  `(OpenLink)` Open Editor tab policy, `SplitButton` dropdowns, 6-button queue layout, `Ctrl+G`.

### Step 6 — Land + record
- Commit the merge; fast-forward `main` to `merge/upstream-2955e9a` (or open a PR).
- **Now** update `FORK_TRACKING.md` per its Logging Protocol:
  - "Upstream Sync Status" → last synced `2955e9a`.
  - "Current Deviations" → adjust any file/region notes that upstream refactors forced.
  - "Changelog" → append a **Merge** entry (`7e0bc0d`→`2955e9a`, conflicts list, custom code
    preserved/adapted, compilation verified, files touched, notes).
- Delete `backup/pre-merge-2955e9a` once satisfied.

### Rollback
- Mid-merge: `git merge --abort`.
- Post-merge (before pushing): `git reset --hard backup/pre-merge-2955e9a`.
