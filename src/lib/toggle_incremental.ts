// lib/toggle_incremental.ts
// FORK-ONLY (2026-10-10, owner request). Decides what the single Opt+X toggle does
// AND on which rems: make them incremental, or dismiss them when they already are.
//
// The result is a plan naming its targets, and the command acts on exactly those
// (createExtract's `selection` option, the Dismiss body's explicit targets). The first
// version only picked a direction and let each action resolve its own target again;
// live testing showed the two disagreeing, so the decision was about one rem and the
// action hit another. Every rule below was reproduced in the app before it was added.

import {
  BuiltInPowerupCodes,
  ReactRNPlugin,
  ReaderSelection,
  RemSelection,
  SelectionType,
  TextSelection,
} from '@remnote/plugin-sdk';
import { powerupCode } from './consts';
import { getEffectiveSelection } from './editor_selection';
import { getIncrementalRemFromRem } from './incremental_rem';
import { safeRemTextToString } from './pdfUtils';
import { QueueCommandTarget, resolveQueueCommandTarget } from './queue_target';

export type TogglePlan =
  /** A text range or a reader selection: extract it. */
  | { kind: 'extract'; selection: TextSelection | ReaderSelection; why: string }
  /** Make these rems incremental (already-incremental ones are left as they are). */
  | { kind: 'make'; remIds: string[]; why: string }
  /**
   * Dismiss one rem through the Dismiss command's queue path: the item under review
   * gets its review recorded and the queue advances; any other rem is a plain dismissal.
   */
  | { kind: 'dismissQueueTarget'; target: QueueCommandTarget; why: string }
  /** Dismiss these rems: no review recorded, the queue does not advance. */
  | { kind: 'dismiss'; remIds: string[]; why: string }
  /** Nothing to do; `message` is shown as a toast. */
  | { kind: 'none'; message: string; why: string };

// In the queue every Opt+X dismissal waits for a second press: see confirmQueueDismissal.
const QUEUE_CONFIRM_WINDOW_MS = 6000;
let pendingQueueDismiss: { key: string; at: number } | null = null;

export async function resolveTogglePlan(plugin: ReactRNPlugin): Promise<TogglePlan> {
  const url = (await plugin.window.getURL()) || '';
  const inQueue = url.includes('/flashcards');

  // In the queue only the LIVE selection counts. The 30-s selection cache exists for
  // the omnibar, which steals the editor's focus; in the queue it outlives the item it
  // was taken on. Pressing Opt+X on a flashcard right after clicking into the previous
  // item made that item's child incremental instead of the card's rem. A real keypress
  // in the queue body does report its live selection, so nothing is lost by this.
  const selection = inQueue
    ? await plugin.editor.getSelection()
    : await getEffectiveSelection(plugin);

  // A text range is always an extract of that text, never a dismissal of the rem the
  // text sits in. Reader selections (PDF / web) go the same way, to a highlight.
  if (selection?.type === SelectionType.Text && selection.range.start !== selection.range.end) {
    return { kind: 'extract', selection, why: 'text range' };
  }
  if (selection && selection.type !== SelectionType.Text && selection.type !== SelectionType.Rem) {
    return { kind: 'extract', selection: selection as ReaderSelection, why: 'reader selection' };
  }

  return inQueue
    ? resolveQueuePlan(plugin, selection as RemSelection | TextSelection | undefined)
    : resolveEditorPlan(plugin, selection as RemSelection | TextSelection | undefined);
}

async function resolveQueuePlan(
  plugin: ReactRNPlugin,
  selection: RemSelection | TextSelection | undefined
): Promise<TogglePlan> {
  return confirmQueueDismissal(plugin, await resolveQueuePlanUnconfirmed(plugin, selection), selection);
}

async function resolveQueuePlanUnconfirmed(
  plugin: ReactRNPlugin,
  selection: RemSelection | TextSelection | undefined
): Promise<TogglePlan> {
  const target = await resolveQueueCommandTarget(plugin);

  // Several rems selected that do not include the item on screen: decided like the
  // editor — all incremental → dismiss them all, otherwise make them all. The queue
  // target is a single rem (the first selected), so this used to dismiss that one
  // rem and ignore the rest.
  if (
    selection?.type === SelectionType.Rem &&
    selection.remIds.length > 1 &&
    !target.isTargetingQueueContext
  ) {
    return planForRems(plugin, selection.remIds, 'queue: several rems selected');
  }

  if (!target.remId) {
    // RemNote's own screens (finished, checkpoints, leeches) have no item of ours.
    return {
      kind: 'none',
      message: 'Nothing to toggle here: no Incremental Rem on screen and nothing selected.',
      why: 'queue: no target',
    };
  }

  const rem = await plugin.rem.findOne(target.remId);
  if (!rem) return { kind: 'none', message: 'Could not find that Rem.', why: 'queue: rem missing' };

  if (!(await rem.hasPowerup(powerupCode))) {
    return { kind: 'make', remIds: [rem._id], why: target.isTargetingQueueContext ? 'queue: item on screen' : 'queue: selected rem' };
  }

  if (target.isActiveIncRemTurn) {
    // The already-reviewed row (Deviation 8) is schedule-neutral by design and offers no
    // Dismiss. A dismissal here would also stamp a second review for one that has
    // already been recorded.
    const info = await getIncrementalRemFromRem(plugin, rem);
    if (info && Date.now() < info.nextRepDate) {
      return {
        kind: 'none',
        message: 'Already reviewed — Opt+X does not dismiss it from this screen. Open it and press Opt+X there.',
        why: 'queue: already-reviewed row',
      };
    }
  }

  return {
    kind: 'dismissQueueTarget',
    target,
    why: target.isActiveIncRemTurn ? 'queue: item on its own turn' : 'queue: selected rem',
  };
}

/**
 * In the queue a dismissal happens only on the SECOND Opt+X within a few seconds; the
 * first shows a toast saying so (owner request, 2026-10-10). A dismissal is the one
 * hard-to-undo outcome of the toggle — the item leaves the queue with its review
 * recorded — and the queue is where it is easiest to trigger by accident. One case
 * made it concrete: text selected inside a PDF item is invisible to plugins, so Opt+X
 * there looked like "nothing selected" and dismissed the whole PDF (reproduced).
 * The editor keeps single-press dismissal.
 */
async function confirmQueueDismissal(
  plugin: ReactRNPlugin,
  plan: TogglePlan,
  selection: RemSelection | TextSelection | undefined
): Promise<TogglePlan> {
  const remIds =
    plan.kind === 'dismissQueueTarget' ? [plan.target.remId!] : plan.kind === 'dismiss' ? plan.remIds : null;
  if (!remIds) {
    pendingQueueDismiss = null;
    return plan;
  }

  const key = [...remIds].sort().join(',');
  const now = Date.now();
  if (pendingQueueDismiss?.key === key && now - pendingQueueDismiss.at < QUEUE_CONFIRM_WINDOW_MS) {
    pendingQueueDismiss = null;
    return plan;
  }
  pendingQueueDismiss = { key, at: now };

  let what = `these ${remIds.length} Incremental Rems`;
  let pdfNote = '';
  if (remIds.length === 1) {
    const rem = await plugin.rem.findOne(remIds[0]);
    const name = rem ? (await safeRemTextToString(plugin, rem.text)).trim() : '';
    what = name ? `"${name.length > 40 ? name.slice(0, 40) + '…' : name}"` : 'this Incremental Rem';
    if (!selection && rem && (await rem.hasPowerup(BuiltInPowerupCodes.UploadedFile))) {
      pdfNote = ' Text selected inside a PDF cannot be extracted with the keyboard.';
    }
  }
  return {
    kind: 'none',
    message: `Press Opt+X again to dismiss ${what}.${pdfNote}`,
    why: `queue: dismissal waits for a second press (${plan.why})`,
  };
}

async function resolveEditorPlan(
  plugin: ReactRNPlugin,
  selection: RemSelection | TextSelection | undefined
): Promise<TogglePlan> {
  if (selection?.type === SelectionType.Rem) {
    return planForRems(plugin, selection.remIds, 'editor: rems selected');
  }
  if (selection?.type === SelectionType.Text) {
    return planForRems(plugin, [selection.remId], 'editor: cursor');
  }
  const focused = await plugin.focus.getFocusedRem();
  if (focused) return planForRems(plugin, [focused._id], 'editor: focused rem');
  return { kind: 'none', message: 'Put the cursor in a Rem, or select Rems, first.', why: 'editor: nothing' };
}

/** All incremental → dismiss all; anything not incremental yet → make (all). */
async function planForRems(plugin: ReactRNPlugin, remIds: string[], why: string): Promise<TogglePlan> {
  const rems = (await plugin.rem.findMany(remIds)) || [];
  if (rems.length === 0) return { kind: 'none', message: 'Could not find the selected Rems.', why };
  const flags = await Promise.all(rems.map((r) => r.hasPowerup(powerupCode)));
  const ids = rems.map((r) => r._id);
  return flags.every(Boolean) ? { kind: 'dismiss', remIds: ids, why } : { kind: 'make', remIds: ids, why };
}

/** One console line per press, so a misfire can be traced to its decision. */
export function describeTogglePlan(plan: TogglePlan): string {
  switch (plan.kind) {
    case 'extract':
      return `extract (${plan.why})`;
    case 'make':
    case 'dismiss':
      return `${plan.kind} ${plan.remIds.length} rem(s) [${plan.remIds.join(', ')}] (${plan.why})`;
    case 'dismissQueueTarget':
      return `dismiss ${plan.target.remId}${plan.target.isActiveIncRemTurn ? ' with its review, then advance' : ''} (${plan.why})`;
    default:
      return `nothing (${plan.why})`;
  }
}
