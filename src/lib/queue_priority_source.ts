// lib/queue_priority_source.ts
// FORK-ONLY (Deviation 14). The single rule deciding which priority the queue's
// fork surfaces show — the info bar under the item (widgets/queue_info_bar.tsx)
// and the P-chip in the queue toolbar (widgets/queue_priority_chip.tsx). Both
// read it from here so they can never disagree about the same queue item.
//
// The rule, in order:
//   1. The rem's own priority, if it has one.
//   2. Otherwise its own DOCUMENT's — the nearest ancestor for which
//      isDocument() is true. The walk stops at that document whatever it finds
//      and never continues to a higher one, so a rem inside an unprioritised
//      document resolves to nothing even when an ancestor further up is an
//      Incremental Rem. `findClosestIncrementalAncestor` (priority_inheritance)
//      is exactly that unbounded climb — do NOT substitute it here.
//   3. Otherwise nothing.
//
// Read-only throughout: nothing is written and no CardPriority tag is involved,
// so the disabled card-priority engine (Deviation 13) stays untouched.
import { RNPlugin, PluginRem } from '@remnote/plugin-sdk';
import { getIncrementalRemFromRem } from './incremental_rem';
import { getDismissedHistoryFromRem } from './dismissed';
import { resolveRemTextForBreadcrumb } from './richTextRemRefs';

/**
 * Ceiling on any ancestor walk in this module.
 *
 * The visited Set below is the correct cycle guard; this is the backstop for the
 * other shape — an acyclic but absurdly deep chain, which would terminate but
 * only after hundreds of SDK round trips on a per-card path. 100 is far beyond
 * any real hierarchy, so hitting it means something is wrong, and it warns.
 */
const MAX_ANCESTOR_DEPTH = 100;

export type QueuePrioritySource = {
  priority: number;
  /**
   * The rem the priority came from, or null when that rem is dismissed — a
   * dismissed rem is no longer in the IncRem set, so it has no KB percentile
   * and callers colour its chip by the absolute priority value instead.
   */
  sourceRemId: string | null;
  /** Whose priority this is: the queue item's own rem, or the document it lives in. */
  origin: 'own' | 'document';
  /** Display name of the source rem, for tooltips. */
  sourceName: string;
  /** True when the value came from a dismissed rem's preserved history. */
  fromDismissed: boolean;
  /**
   * True when the priority could NOT be read — the number is the
   * UNREADABLE_PRIORITY_FALLBACK placeholder, not a real value. Callers must not
   * present it as one (see incremental_rem/types.ts).
   */
  unreadable: boolean;
};

/**
 * A single rem's priority, if it has one: its live value while it is an
 * Incremental Rem, otherwise the last priority its preserved history recorded if
 * it *was* one and has been dismissed. Dismissal removes the Incremental powerup
 * and with it the priority slot, but every history entry carries the priority it
 * held at the time, so the value survives.
 */
export async function readRemPriority(
  plugin: RNPlugin,
  rem: PluginRem
): Promise<{
  priority: number;
  sourceRemId: string | null;
  fromDismissed: boolean;
  unreadable: boolean;
} | null> {
  const incRem = await getIncrementalRemFromRem(plugin, rem);
  if (incRem) {
    // FORK (#13): 'fallback' means nothing could be read — flag it rather than
    // letting the placeholder 50 be rendered as this rem's priority.
    return {
      priority: incRem.priority,
      sourceRemId: incRem.remId,
      fromDismissed: false,
      unreadable: incRem.prioritySource === 'fallback',
    };
  }

  const dismissed = await getDismissedHistoryFromRem(plugin, rem);
  if (dismissed?.history?.length) {
    for (let i = dismissed.history.length - 1; i >= 0; i--) {
      const recorded = dismissed.history[i]?.priority;
      if (typeof recorded === 'number') {
        return { priority: recorded, sourceRemId: null, fromDismissed: true, unreadable: false };
      }
    }
  }

  return null;
}

/** Resolve the priority to show for a queue item's rem. See the rule at the top. */
export async function resolveQueuePriority(
  plugin: RNPlugin,
  rem: PluginRem
): Promise<QueuePrioritySource | null> {
  const own = await readRemPriority(plugin, rem);
  if (own) {
    // FORK (2026-08-14, bug-hunt #27): no breadcrumb resolution on this branch.
    // `sourceName` is read by exactly one consumer — the chip's tooltip, and only
    // in its `origin === 'document'` case — while resolveRemTextForBreadcrumb
    // walks rich text and issues an extra findOne per rem reference in the title.
    // Paying that on every queue item, in two widgets, for a string nothing shows
    // was pure waste.
    return { ...own, origin: 'own', sourceName: '' };
  }

  // Guarded walk. Without these the loop exits only on finding a document, a
  // falsy parent, or a missing rem — and a cyclic parent chain (a self-parent, or
  // A->B->A from conflict-merged sync data) satisfies none of them, so it spun
  // forever at two SDK round trips per iteration. This runs on every card
  // transition in two widgets, so it floods the plugin bridge rather than just
  // hanging. Note `.catch(() => false)` on isDocument does not help: one that
  // always throws simply keeps the climb going.
  const seen = new Set<string>();
  let depth = 0;
  let doc: PluginRem | undefined = rem;
  while (doc) {
    if (seen.has(doc._id)) {
      console.warn('[queuePriority] cyclic parent chain — abandoning walk at', doc._id);
      return null;
    }
    seen.add(doc._id);
    if (++depth > MAX_ANCESTOR_DEPTH) {
      console.warn('[queuePriority] ancestor walk exceeded', MAX_ANCESTOR_DEPTH, 'from', rem._id);
      return null;
    }
    if (await doc.isDocument().catch(() => false)) break;
    if (!doc.parent) return null;
    doc = await plugin.rem.findOne(doc.parent);
  }
  // A document that IS the item's own rem was already covered above, so there is
  // nothing left to read from it.
  if (!doc || doc._id === rem._id) return null;

  const fromDoc = await readRemPriority(plugin, doc);
  if (!fromDoc) return null;

  return {
    ...fromDoc,
    origin: 'document',
    sourceName: await resolveRemTextForBreadcrumb(plugin, doc.text),
  };
}
