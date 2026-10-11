// lib/queue_screen.ts
// FORK (2026-10-11, found while testing, reproduced live): what the queue's screen shows —
// used by the toolbar chip and the flashcard info bar.
//
// Upstream's answer is the session flag incrementalQueueActiveKey. The queue widget sets it
// on mount and clears it on unmount, and GetNextCard clears it whenever it decides the NEXT
// slot is a flashcard. Neither clear is reliable: RemNote destroys the widget's iframe before
// React runs the cleanup, and RemNote asks for the next slot one item ahead (Deviation 15).
// So the flag stays set on the flashcard after an Incremental Rem when that flashcard is
// itself followed by an Incremental Rem (every flashcard at an Incremental Rem Frequency of
// 1), and when the flashcard is reached again after Previous — RemNote replays its history
// without asking the plugin. Seen live: the chip kept the previous item's priority and the
// flashcard had no info bar.
//
// RemNote itself knows: getCurrentQueueScreenType() is QueueItemType.Plugin exactly while a
// plugin item is on screen (the rule queue_target.ts uses, UPSTREAM_ISSUES.md #15), another
// type on a flashcard or a checkpoint, and nothing at all on RemNote's finished screen. This
// hook polls it; the flag is the fallback while the call gives no answer, and — for
// useIncRemOnScreen only — when RemNote names no screen.
import { useEffect, useState } from 'react';
import { QueueItemType, usePlugin, useTrackerPlugin } from '@remnote/plugin-sdk';
import { incrementalQueueActiveKey } from './consts';

const POLL_MS = 500;

/**
 * - `incRem`: a plugin item, an Incremental Rem, is on screen.
 * - `card`: anything else RemNote names — a flashcard, or a checkpoint (no current card).
 * - `none`: RemNote reports no screen at all — its finished screen.
 */
export type QueueScreen = 'incRem' | 'card' | 'none';

function useQueueScreenAnswer(enabled: boolean): { answer: QueueScreen | null; flag: boolean } {
  const plugin = usePlugin();
  const flag = useTrackerPlugin((rp) => rp.storage.getSession<boolean>(incrementalQueueActiveKey), []);
  const [answer, setAnswer] = useState<QueueScreen | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    // A slow bridge can answer polls out of order; an older answer never replaces a newer one.
    let issued = 0;
    let applied = 0;
    const check = async () => {
      const mine = ++issued;
      let next: QueueScreen | null = null;
      try {
        const screen = await plugin.queue.getCurrentQueueScreenType();
        next = screen === QueueItemType.Plugin ? 'incRem' : screen === undefined || screen === null ? 'none' : 'card';
      } catch {
        /* no answer: fall back to the flag */
      }
      if (!alive || mine < applied) return;
      applied = mine;
      setAnswer(next);
    };
    void check();
    const intervalId = setInterval(check, POLL_MS);
    return () => {
      alive = false;
      clearInterval(intervalId);
    };
  }, [plugin, enabled]);

  return { answer, flag: !!flag };
}

/**
 * What the queue's screen shows. `enabled: false` stops the poll. Before RemNote's first
 * answer, or if the call fails, the flag decides between `incRem` and `card`.
 */
export function useQueueScreen(enabled: boolean): QueueScreen {
  const { answer, flag } = useQueueScreenAnswer(enabled);
  return answer ?? (flag ? 'incRem' : 'card');
}

/**
 * True while a plugin (Incremental Rem) item is on the queue's screen. `enabled: false` stops
 * the poll. RemNote's `none` falls back to the flag here, as no answer does: the flashcard info
 * bar is not mounted on the finished screen, and in a transition the flag is the better guess.
 */
export function useIncRemOnScreen(enabled: boolean): boolean {
  const { answer, flag } = useQueueScreenAnswer(enabled);
  return answer === 'incRem' || (answer !== 'card' && flag);
}
