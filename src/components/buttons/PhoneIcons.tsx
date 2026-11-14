// components/buttons/PhoneIcons.tsx
// FORK-ONLY (2026-11-14, owner request). Icons for the queue's answer row on a phone,
// where the buttons carry no words. Like upstream's ActionIcons.tsx — which supplies Open
// and Dismiss — they are stroke icons that take `currentColor`, so each follows its
// button's colour in both themes. Paths adapted from Lucide (ISC licence).

import React from 'react';

export { DismissIcon, NewTabIcon as OpenIcon } from './ActionIcons';

function StrokeIcon({ size = 20, children }: { size?: number; children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={{ display: 'block', flexShrink: 0 }}
    >
      {children}
    </svg>
  );
}

/** Arrow left: Previous. */
export const PreviousIcon = ({ size }: { size?: number }) => (
  <StrokeIcon size={size}>
    <path d="M19 12H5" />
    <path d="m12 19-7-7 7-7" />
  </StrokeIcon>
);

/** Arrow right: Next. */
export const NextIcon = ({ size }: { size?: number }) => (
  <StrokeIcon size={size}>
    <path d="M5 12h14" />
    <path d="m12 5 7 7-7 7" />
  </StrokeIcon>
);

/** Skip forward (a triangle running into a bar): Skip. */
export const SkipIcon = ({ size }: { size?: number }) => (
  <StrokeIcon size={size}>
    <polygon points="5 4 15 12 5 20 5 4" />
    <line x1="19" x2="19" y1="5" y2="19" />
  </StrokeIcon>
);
