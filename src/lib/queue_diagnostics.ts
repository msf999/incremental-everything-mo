// lib/queue_diagnostics.ts
// FORK-ONLY (2026-11-14).
//
// A short record of what the queue's serving logic decided and what the queue widgets
// reported, kept so that a rare misfire — an item shown a second time, an advance that did
// nothing — can be explained after the fact instead of guessed at. Nothing reads it to make
// a decision.
//
// Two places hold events, because the plugin runs in several frames:
//   - the index widget (GetNextCard, the prefetch buffer) keeps its events in memory here;
//   - the queue's own widgets append theirs to the session key `queueDiagWidgetKey`.
// `formatQueueDiagnostics` merges both, oldest first. "Incremental: Copy Queue
// Diagnostics" puts that text on the clipboard.

import type { RNPlugin } from '@remnote/plugin-sdk';

export const queueDiagWidgetKey = 'queue-diag-widget';

export interface QueueDiagEvent {
  /** ms since the epoch */
  t: number;
  /** where it was recorded: the index widget or a queue widget */
  src: 'index' | 'widget';
  kind: string;
  remId?: string | null;
  data?: Record<string, unknown>;
}

const MAX_EVENTS = 80;
const MAX_WIDGET_EVENTS = 40;
const events: QueueDiagEvent[] = [];

/** Index-widget side: record an event in memory. Synchronous and cheap. */
export function recordQueueEvent(kind: string, remId?: string | null, data?: Record<string, unknown>) {
  events.push({ t: Date.now(), src: 'index', kind, remId, data });
  if (events.length > MAX_EVENTS) events.shift();
}

/** Queue-widget side: append an event to the session key. Never throws. */
export async function recordQueueWidgetEvent(
  plugin: RNPlugin,
  kind: string,
  remId?: string | null,
  data?: Record<string, unknown>
): Promise<void> {
  try {
    const list = (await plugin.storage.getSession<QueueDiagEvent[]>(queueDiagWidgetKey)) || [];
    list.push({ t: Date.now(), src: 'widget', kind, remId, data });
    await plugin.storage.setSession(queueDiagWidgetKey, list.slice(-MAX_WIDGET_EVENTS));
  } catch (e) {
    console.error('[queue diagnostics] could not record', kind, e);
  }
}

/** Both sources merged, oldest first. Call from the index widget. */
export async function readQueueDiagnostics(plugin: RNPlugin): Promise<QueueDiagEvent[]> {
  let widget: QueueDiagEvent[] = [];
  try {
    widget = (await plugin.storage.getSession<QueueDiagEvent[]>(queueDiagWidgetKey)) || [];
  } catch {}
  return [...events, ...widget].sort((a, b) => a.t - b.t);
}

export async function formatQueueDiagnostics(plugin: RNPlugin): Promise<string> {
  const all = await readQueueDiagnostics(plugin);
  if (all.length === 0) return 'No queue events recorded in this session.';
  const stamp = (t: number) => {
    const d = new Date(t);
    const p = (n: number, w = 2) => String(n).padStart(w, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
  };
  return all
    .map(
      (e) =>
        `${stamp(e.t)} ${e.src === 'index' ? 'I' : 'W'} ${e.kind}` +
        (e.remId ? ` ${e.remId}` : '') +
        (e.data ? ` ${JSON.stringify(e.data)}` : '')
    )
    .join('\n');
}
