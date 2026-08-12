// widgets/history_sidebar.tsx
// FORK-ONLY (Deviation 13). One right-sidebar "History" tab combining the three
// upstream history views under collapsible headings, replacing the three
// separate tabs (which the fork gates deny — see lib/fork_gates.ts).
//
// The three components are imported from their upstream widget modules. Those
// modules each end in a module-scope renderWidget(), which also runs on import
// — and the SDK's HMR branch then calls unmountComponentAtNode on a container
// that does not exist in a non-entry bundle, throwing
// "Target container is not a DOM element" and blocking this tree. So each of
// those files guards its own call with `if (!FORK_FEATURES.combinedHistoryTab)`
// (compile-time constant — no import-order dependency); they self-render only
// when registered standalone.
import React, { useState } from 'react';
import { renderWidget } from '@remnote/plugin-sdk';
import { IncrementalHistory } from './incremental_history';
import { FlashcardHistory } from './flashcard_history';
import { RemHistory } from './rem_history';

function Section({
  title,
  defaultOpen,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div style={{ borderBottom: '1px solid var(--rn-clr-border-primary, #e2e8f0)' }}>
      <div
        role="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          cursor: 'pointer',
          fontSize: 13,
          fontWeight: 700,
          color: 'var(--rn-clr-content-primary)',
          backgroundColor: 'var(--rn-clr-background-secondary)',
          userSelect: 'none',
        }}
      >
        <span style={{ fontSize: 10, width: 12 }}>{open ? '▼' : '▶'}</span>
        {title}
      </div>
      {open && <div>{children}</div>}
    </div>
  );
}

function CombinedHistorySidebar() {
  return (
    <div style={{ width: '100%' }}>
      <Section title="📚 Incremental History">
        <IncrementalHistory />
      </Section>
      <Section title="🃏 Flashcard History">
        <FlashcardHistory />
      </Section>
      <Section title="🧭 Visited Rems" defaultOpen>
        <RemHistory />
      </Section>
    </div>
  );
}

renderWidget(CombinedHistorySidebar);
