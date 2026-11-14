// components/MobileDocumentTree.tsx
// MOBILE-EXPERIMENT M7 (see lib/mobile_experiments.ts).
//
// A Document in the queue body on a phone: its name, drawn by the plugin, above RemNote's
// own hierarchy tree of its children (the SDK's RemHierarchyEditorTree — real formatting,
// editable). The tree leaves out the Rem itself and its property rows, hence the title
// line. RemNote draws the tree in an overlay in its own page, sized from the placeholder
// below; the rule registered for MOBILE_TREE_CLASS makes that overlay scroll.
// Colours: classes ie-m4-fg / ie-m4-dim, defined by ExtractViewer for both themes.

import { RemHierarchyEditorTree, useTrackerPlugin } from '@remnote/plugin-sdk';
import React, { useState } from 'react';
import { keepFocusWithRemNote } from '../lib/keep_focus_with_remnote';
import { MOBILE_DOCVIEW_CLASS, MOBILE_TREE_CLASS } from '../lib/mobile_experiments';
import { plainText } from './MobileTextOutline';

// The title keeps to this many lines until it is tapped.
const TITLE_LINES = 3;

interface MobileDocumentTreeProps {
  remId: string;
}

export function MobileDocumentTree({ remId }: MobileDocumentTreeProps) {
  // undefined while it is read, '' for a Rem without a name.
  const title = useTrackerPlugin(
    async (rp) => {
      const rem = await rp.rem.findOne(remId);
      return rem ? await plainText(rp, rem.text) : '';
    },
    [remId]
  );
  const [expanded, setExpanded] = useState(false);

  return (
    <div style={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div
        className="ie-m4-fg"
        title={expanded ? undefined : title || undefined}
        onMouseDown={keepFocusWithRemNote.onMouseDown}
        onClick={(e) => {
          keepFocusWithRemNote.onClick(e);
          setExpanded((was) => !was);
        }}
        style={{
          flexShrink: 0,
          // Left: in line with the text of the tree's first level, 24 px into RemNote's
          // overlay. Below: nothing — the tree starts with an empty 32 px row of its own.
          padding: '8px 16px 0 24px',
          fontSize: 18,
          fontWeight: 700,
          lineHeight: 1.3,
          overflowWrap: 'anywhere',
          ...(expanded
            ? { maxHeight: '50%', overflowY: 'auto' as const }
            : {
                display: '-webkit-box',
                WebkitBoxOrient: 'vertical' as const,
                WebkitLineClamp: TITLE_LINES,
                overflow: 'hidden',
              }),
        }}
      >
        {title === undefined ? ' ' : title || <span className="ie-m4-dim">Untitled</span>}
      </div>
      {/* The placeholder RemNote sizes its overlay from: all the height the title leaves. */}
      <div style={{ flex: '1 1 0', minHeight: 0, position: 'relative' }}>
        <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}>
          <RemHierarchyEditorTree
            width={'100%'}
            height={'100%'}
            remId={remId}
            className={`${MOBILE_DOCVIEW_CLASS} ${MOBILE_TREE_CLASS}`}
          />
        </div>
      </div>
    </div>
  );
}
