// lib/queue_url.ts
// FORK-ONLY (2026-11-15, R-038, reproduced live).
//
// Which queue a URL belongs to, for the activation bootstrap (register/events.ts): it runs when
// the plugin starts while a queue is already open — a page reload, a plugin update or restart —
// and so never receives QueueEnter's `subQueueId`. Until 2026-11-15 it re-ran queue entry with
// none, and a document's queue was then treated as the whole knowledge base's: the counter showed
// the knowledge base's numbers, Incremental Rems from outside the document were served in it, and
// a document with no flashcards stayed on RemNote's finished screen.
//
// `plugin.window.getURL()` gives the path (upstream's lib/queue_route.ts lists RemNote's routes):
//   /flashcards                         the daily queue
//   /flashcards/<document>              that document's queue — the id QueueEnter and GetNextCard
//                                       pass as `subQueueId`
//   /flashcards/<document>/<mode>       its Practice All / In Order / no-SRS / Need to Learn modes
// Anything else is not a queue the bootstrap should start — `/flashcards_home` included, which the
// old `includes('/flashcards')` test took for one.

export type OpenQueue = { inQueue: boolean; subQueueId?: string };

export function queueOfPath(url: string | null | undefined): OpenQueue {
  if (typeof url !== 'string') return { inQueue: false };
  const path = url
    .replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+/i, '') // a full URL → its path
    .split(/[?#]/)[0]
    .replace(/\/+$/, '');
  const match = /^\/flashcards(?:\/([^/]+)(?:\/[^/]+)?)?$/.exec(path);
  if (!match) return { inQueue: false };
  if (!match[1]) return { inQueue: true };
  let subQueueId = match[1];
  try {
    subQueueId = decodeURIComponent(subQueueId);
  } catch {
    // not percent-encoded after all: keep it as it is
  }
  return { inQueue: true, subQueueId };
}
