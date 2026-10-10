import { RNPlugin } from '@remnote/plugin-sdk';
import { currentIncRemKey, queueSlotSwapKey, queueSwapRequestKey, QueueSlotSwap } from './consts';

/* FORK (Deviation 16, 2026-10-10): the 🔄 "another item" button / command.

   Asks the index widget (the only place the prefetch buffer lives) to swap a
   different due Incremental Rem into RemNote's CURRENT plugin slot — in place, right
   now, with no review of the item being set aside and no trip through RemNote's
   flashcards. The queue and answer-button widgets read `queueSlotSwapKey` and render
   `showRemId` instead of the slot's own rem while the slot is on screen.

   Resolves 'swapped' (with the rem now shown) when a candidate was served, 'none' when
   nothing else is due (the request was answered with showRemId: null), 'timeout' when
   the index widget did not answer within 3 s (plugin not ready, or the tracker not
   registered). */
// One member per outcome: a combined `'none' | 'timeout'` member cannot be narrowed
// away by two successive checks, so `showRemId` would not type-check in the else.
export type AnotherIncRemResult =
  | { outcome: 'swapped'; showRemId: string }
  | { outcome: 'none' }
  | { outcome: 'timeout' };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function requestAnotherIncRem(
  plugin: RNPlugin,
  currentRemId: string
): Promise<AnotherIncRemResult> {
  const nonce = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await plugin.storage.setSession(queueSwapRequestKey, { currentRemId, nonce });
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const res = await plugin.storage.getSession<QueueSlotSwap | null>(queueSlotSwapKey);
    if (res && res.nonce === nonce) {
      if (!res.showRemId) return { outcome: 'none' };
      // Do not hand control back until the queue widget is showing the new rem. It
      // writes currentIncRemKey when it renders it, and every queue keyboard command
      // targets currentIncRemKey — so a Next pressed a beat too early (Opt+R, Opt+T)
      // would otherwise review the rem that was just set aside. Bounded: a slow
      // render only delays the release, it never fails the swap.
      const until = Date.now() + 1500;
      while (
        Date.now() < until &&
        (await plugin.storage.getSession<string>(currentIncRemKey)) !== res.showRemId
      ) {
        await sleep(50);
      }
      return { outcome: 'swapped', showRemId: res.showRemId };
    }
    await sleep(80);
  }
  return { outcome: 'timeout' };
}
