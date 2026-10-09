import { RNPlugin, ReactRNPlugin } from '@remnote/plugin-sdk';
import { buildCardInfoBarDockCss } from './card_info_bar_dock';
import { queueInfoBarDockCssId, queueInfoBarHeightKey } from './consts';

/* FORK (Deviation 14, 2026-10-10): docks the fork's queue_info_bar above the answer
   buttons in RemNote's Beautiful queue variant, exactly as upstream docks its
   card_info_bar (lib/card_info_bar_dock.ts owns the rules; only the widget name
   differs). Without this the bar sits wherever the card content ends — mid-card on
   a short flashcard, below the fold on a long one. Every rule is gated on the
   Beautiful scroll surface, so the Compact queue is untouched. The fork's bar has
   its own padding inside the iframe (QUEUE_INFO_BAR_OUTER_PADDING), so upstream's
   wrapper padding is not applied (inFlowPadding: false). */

const DOCK_TARGET = { widgetName: 'queue_info_bar', inFlowPadding: false } as const;
// Before the widget reports its height: one bar row plus the in-iframe padding.
const DEFAULT_BAR_HEIGHT = 58;

export async function registerQueueInfoBarDockCss(plugin: RNPlugin, barHeight?: number) {
  const height = typeof barHeight === 'number' ? barHeight : DEFAULT_BAR_HEIGHT;
  await plugin.app.registerCSS(queueInfoBarDockCssId, buildCardInfoBarDockCss(height, DOCK_TARGET));
}

let lastReportedHeight: number | undefined;

/** Called from the widget whenever its rendered height changes (0 = renders nothing). */
export async function reportQueueInfoBarHeight(plugin: RNPlugin, height: number) {
  const rounded = Math.ceil(height);
  if (rounded === lastReportedHeight) return;
  lastReportedHeight = rounded;
  await plugin.storage.setSession(queueInfoBarHeightKey, rounded);
}

/** Index-widget side: registers the dock CSS at activation and again whenever the
 *  bar reports a new height (the widget cannot call registerCSS from its iframe). */
export function installQueueInfoBarDock(plugin: ReactRNPlugin) {
  plugin.track(async (rp) => {
    const barHeight = await rp.storage.getSession<number>(queueInfoBarHeightKey);
    await registerQueueInfoBarDockCss(plugin, barHeight);
  });
}
