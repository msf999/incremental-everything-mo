// widgets/inc_rem_preview.tsx
// FORK-ONLY (2026-11-14, owner request: "make the preview shortcut work on incremental items …
// the incremental item is shown in the preview and you can edit it there").
//
// A popup showing one Rem as RemNote's own document page, editable. Opened by the command
// "Incremental: Preview Item" (Ctrl+P) for the Incremental Rem on the queue screen, or for the
// focused Rem in the editor.
//
// Why a popup of the plugin's and not RemNote's previewer: RemNote's `P` works on flashcards
// only, and the SDK can neither open that previewer nor see the key. Why it is the place to
// write: while a popup is open RemNote's queue does not act on any key, so typing here cannot
// rate or skip the item — which it does in the queue's own document view, now read-only for
// that reason (lib/queue_docview.ts).
import { DocumentViewer, renderWidget, usePlugin, useTrackerPlugin, WidgetLocation } from '@remnote/plugin-sdk';
import React, { useEffect, useState } from 'react';
import { withHoverTips } from '../components/HoverTipLayer';
import { QueueBreadcrumb } from '../components/QueueBreadcrumb';
import { INC_REM_PREVIEW_BEAT_MS, INC_REM_PREVIEW_SIZE, incRemPreviewOpenKey } from '../lib/consts';
import '../style.css';
import '../App.css';
import '../rn_theme_vars.css';

function IncRemPreview() {
  const plugin = usePlugin();
  const [remId, setRemId] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    (async () => {
      const ctx = await plugin.widget.getWidgetContext<WidgetLocation.Popup>();
      setRemId((ctx?.contextData?.remId as string) ?? null);
    })();
  }, [plugin]);

  const rem = useTrackerPlugin(async (rp) => (remId ? (await rp.rem.findOne(remId)) ?? null : null), [remId]);

  // "I am open": the command reads this to close the popup on a second press (see consts).
  useEffect(() => {
    if (!remId) return;
    const beat = () => void plugin.storage.setSession(incRemPreviewOpenKey, { remId, at: Date.now() });
    beat();
    const timer = setInterval(beat, INC_REM_PREVIEW_BEAT_MS);
    // This cleanup runs when the popup closes itself (its ✕, Esc or Ctrl+P inside this frame).
    // When RemNote closes it — Esc in RemNote's own page, a click outside — the frame is simply
    // destroyed and nothing here runs; the key then just stops being fresh (see consts.ts).
    return () => {
      clearInterval(timer);
      void plugin.storage.setSession(incRemPreviewOpenKey, null);
    };
  }, [remId, plugin]);

  // Keys pressed while this frame itself has the focus (after a click on the header) never
  // reach RemNote, so the two that close the popup are handled here as well.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const togglesPreview = e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === 'p';
      if (e.key !== 'Escape' && !togglesPreview) return;
      e.preventDefault();
      void plugin.storage.setSession(incRemPreviewOpenKey, null);
      void plugin.widget.closePopup();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [plugin]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: INC_REM_PREVIEW_SIZE.height,
        boxSizing: 'border-box',
        backgroundColor: 'var(--rn-clr-background-primary)',
        color: 'var(--rn-clr-content-primary)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          height: 40,
          padding: '0 12px',
          flexShrink: 0,
          borderBottom: '1px solid var(--rn-clr-border-primary)',
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>{rem ? <QueueBreadcrumb rem={rem} plugin={plugin} /> : null}</div>
        <span style={{ fontSize: 11, whiteSpace: 'nowrap', color: 'var(--rn-clr-content-tertiary)' }}>
          Edit here · Esc or Ctrl+P closes
        </span>
        <button
          onClick={() => plugin.widget.closePopup()}
          title="Close (Esc)"
          style={{
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            fontSize: 16,
            lineHeight: 1,
            padding: '4px 6px',
            color: 'var(--rn-clr-content-secondary)',
          }}
        >
          ✕
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {remId ? (
          <DocumentViewer width={'100%'} height={'100%'} documentId={remId} />
        ) : remId === null ? (
          <div style={{ padding: 16, fontSize: 13, color: 'var(--rn-clr-content-tertiary)' }}>
            There is no Rem to preview.
          </div>
        ) : null}
      </div>
    </div>
  );
}

renderWidget(withHoverTips(IncRemPreview));
