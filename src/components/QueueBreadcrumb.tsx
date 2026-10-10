// components/QueueBreadcrumb.tsx
// FORK (2026-10-11, owner requests): the line above a queue item that says where it sits —
// its ancestors, top first, separated by RemNote's chevron, each with the icon RemNote gives
// it: a folder or document its own icon (an emoji, or RemNote's coloured folder picture), a
// folder without one RemNote's folder picture, a document without one RemNote's document
// icon (the page RemNote draws in front of a flashcard's document). lib/rem_icon.ts has the
// rules. One line, as the breadcrumb it replaces was: RemNote's Compact queue stacks a card's
// ancestors one under the other, which the owner tried and rejected for the height it takes.
//
// It stays one line whatever the depth. When the names do not fit, crumbs fold to their icon
// alone — the middle ones first, then the top one — and the item's parent keeps its name,
// shortened with an ellipsis; a crumb without an icon shortens the same way. Every crumb
// keeps its full name in its tooltip. Past that the line scrolls sideways, starting at its
// end. (Folding is measured, as RemNote's own breadcrumb does: shrinking by CSS alone left a
// one-pixel sliver of a name that read as a stray "|".)
//
// Plain text — references resolved, pins as 📌, images as 🖼️, LaTeX as its source in a serif
// italic — and no RichText embed, so nothing here depends on RemNote's overlays. Inline
// styles throughout, so it draws the same in a frame RemNote's stylesheet does not reach (the
// phone app). Each crumb opens its Rem on click, as before.

import { PluginRem, RNPlugin, RemId } from '@remnote/plugin-sdk';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { resolveRemTextSegments } from '../lib/richTextRemRefs';
import { iconForRem, readRemIconFacts, RemIcon, RemIconFacts } from '../lib/rem_icon';

const MAX_ANCESTORS = 50;
// Geometry the folding arithmetic relies on — keep in step with the styles below.
const ICON_PX = 16;
const ICON_GAP_PX = 5;
const CRUMB_PADDING_PX = 8;
const CHEVRON_PX = 16;
const MAX_CRUMB_PX = 320;
const NO_FOLDS: ReadonlySet<string> = new Set();

// RemNote's own icons (offline_assets/svg_icons/uncolored/{document,chevron-right}.svg in
// 1.28): the page it draws in front of a flashcard's document, and its breadcrumb separator.
const DOCUMENT_GLYPH_PATH =
  'M7.55262 21H16.4687C17.3362 21 17.9855 20.7789 18.4164 20.3368C18.853 19.9002 19.0713 19.2453 19.0713 18.3722V10.7491C19.0713 10.3853 19.0517 10.0802 19.0125 9.83396C18.9733 9.58769 18.895 9.36381 18.7774 9.16231C18.6655 8.95522 18.4976 8.73694 18.2737 8.50746L13.6478 3.79757C13.4351 3.57929 13.228 3.41418 13.0265 3.30224C12.825 3.1847 12.6039 3.10634 12.3633 3.06716C12.1282 3.02239 11.8539 3 11.5405 3H7.55262C6.68509 3 6.03303 3.22108 5.59647 3.66325C5.1655 4.10541 4.95001 4.76306 4.95001 5.63619V18.3722C4.95001 19.2509 5.1655 19.9086 5.59647 20.3451C6.03303 20.7817 6.68509 21 7.55262 21ZM7.61139 19.6483C7.18042 19.6483 6.853 19.5364 6.62912 19.3125C6.41083 19.0886 6.30169 18.7668 6.30169 18.347V5.66138C6.30169 5.2472 6.41083 4.92537 6.62912 4.6959C6.853 4.46642 7.18322 4.35168 7.61979 4.35168H11.3558V9.22948C11.3558 9.7556 11.4873 10.1502 11.7504 10.4132C12.0134 10.6763 12.408 10.8078 12.9342 10.8078H17.7196V18.347C17.7196 18.7668 17.6077 19.0886 17.3838 19.3125C17.1655 19.5364 16.8381 19.6483 16.4015 19.6483H7.61139ZM13.0853 9.54011C12.9174 9.54011 12.797 9.50373 12.7243 9.43097C12.6571 9.35821 12.6235 9.23787 12.6235 9.06996V4.61194L17.4593 9.54011H13.0853Z';
const CHEVRON_PATH =
  'M9.00002 6.71063C8.61002 7.10063 8.61002 7.73063 9.00002 8.12063L12.88 12.0006L9.00002 15.8806C8.61002 16.2706 8.61002 16.9006 9.00002 17.2906C9.39002 17.6806 10.02 17.6806 10.41 17.2906L15 12.7006C15.39 12.3106 15.39 11.6806 15 11.2906L10.41 6.70063C10.03 6.32063 9.39002 6.32063 9.00002 6.71063Z';
const EMOJI_FONTS = 'Apple Color Emoji, Segoe UI Emoji, Segoe UI Symbol, Noto Color Emoji, sans-serif';

// RemNote's colour where its stylesheet reaches this frame; a fallback for each theme where
// it does not (the SDK puts `dark` or `light` on this frame's body).
const CRUMBS_CSS =
  '.ie-crumbs{color:var(--rn-clr-content-secondary,#63637b);scrollbar-width:none}' +
  'body.dark .ie-crumbs{color:var(--rn-clr-content-secondary,#a3a3b8)}' +
  '.ie-crumbs::-webkit-scrollbar{display:none}' +
  '.ie-crumb{cursor:pointer}' +
  '.ie-crumb:hover .ie-crumb-label{text-decoration:underline}' +
  ".ie-crumb-tex{font-family:'Times New Roman',Times,serif;font-style:italic}";

type TextPart = { kind: 'text' | 'pin' | 'latex'; text: string };

interface Crumb {
  id: RemId;
  parts: TextPart[];
  /** The whole name as plain text, for the tooltip. */
  title: string;
  facts: RemIconFacts;
}

interface LoadedCrumbs {
  remId: RemId;
  crumbs: Crumb[];
  /** More ancestors above the first crumb than MAX_ANCESTORS allowed to read. */
  truncated: boolean;
}

/** Rich text as plain parts; a LaTeX element keeps its source as its own part. */
async function toParts(plugin: RNPlugin, richText: unknown): Promise<TextPart[]> {
  if (!Array.isArray(richText)) {
    return typeof richText === 'string' && richText ? [{ kind: 'text', text: richText }] : [];
  }
  const parts: TextPart[] = [];
  let run: unknown[] = [];
  const flush = async () => {
    if (run.length === 0) return;
    const segments = await resolveRemTextSegments(plugin, run);
    run = [];
    for (const s of segments) parts.push({ kind: s.kind, text: s.text });
  };
  for (const el of richText) {
    const latex =
      el && typeof el === 'object' && (el as { i?: unknown }).i === 'x' ? (el as { text?: unknown }).text : undefined;
    if (typeof latex === 'string') {
      await flush();
      parts.push({ kind: 'latex', text: latex });
    } else {
      run.push(el);
    }
  }
  await flush();
  return parts;
}

const isBlank = (parts: TextPart[]) => parts.every((p) => p.kind === 'text' && !p.text.trim());

const titleOf = (parts: TextPart[]): string =>
  isBlank(parts)
    ? 'Untitled'
    : parts
        .map((p) => (p.kind === 'pin' ? `📌 ${p.text}` : p.kind === 'latex' ? `$${p.text}$` : p.text))
        .join('')
        .replace(/\s+/g, ' ')
        .trim();

async function loadCrumbs(plugin: RNPlugin, rem: PluginRem): Promise<LoadedCrumbs> {
  // Parents one by one (each needs the last), then everything else about them at once.
  const chain: PluginRem[] = [];
  const seen = new Set<string>([rem._id]);
  let parentId = rem.parent;
  while (parentId && !seen.has(parentId) && chain.length < MAX_ANCESTORS) {
    seen.add(parentId);
    const parent = await plugin.rem.findOne(parentId);
    if (!parent) break;
    chain.unshift(parent);
    parentId = parent.parent;
  }
  const truncated = chain.length === MAX_ANCESTORS && !!parentId;
  const crumbs = await Promise.all(
    chain.map(async (r) => {
      const [parts, facts] = await Promise.all([
        toParts(plugin, r.text).catch((): TextPart[] => []),
        readRemIconFacts(r),
      ]);
      return { id: r._id, parts, title: titleOf(parts), facts };
    })
  );
  return { remId: rem._id, crumbs, truncated };
}

/** Follows the theme RemNote sets on this frame's body. */
function useDarkTheme(): boolean {
  const read = () => !!document.body?.classList.contains('dark');
  const [dark, setDark] = useState(read);
  useEffect(() => {
    const body = document.body;
    if (!body) return;
    const observer = new MutationObserver(() => setDark(read()));
    observer.observe(body, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);
  return dark;
}

function Chevron() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="currentColor" aria-hidden style={{ flexShrink: 0, display: 'block' }}>
      <path d={CHEVRON_PATH} />
    </svg>
  );
}

function IconView({ icon, size }: { icon: RemIcon; size: number }) {
  if (icon.kind === 'document') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden style={{ flexShrink: 0, display: 'block' }}>
        <path d={DOCUMENT_GLYPH_PATH} />
      </svg>
    );
  }
  if (icon.kind === 'image') {
    return (
      <img
        src={icon.src}
        alt=""
        width={size}
        height={size}
        draggable={false}
        style={{ flexShrink: 0, display: 'block' }}
        // Offline, or a picture RemNote has since renamed: no icon rather than a broken one.
        onError={(e) => {
          e.currentTarget.style.display = 'none';
        }}
      />
    );
  }
  return (
    <span style={{ flexShrink: 0, width: size, fontSize: size - 2, lineHeight: `${size}px`, textAlign: 'center', fontFamily: EMOJI_FONTS }}>
      {icon.text}
    </span>
  );
}

function Name({ parts }: { parts: TextPart[] }) {
  if (isBlank(parts)) return <>Untitled</>;
  return (
    <>
      {parts.map((p, i) =>
        p.kind === 'latex' ? (
          <span key={i} className="ie-crumb-tex">
            {p.text}
          </span>
        ) : p.kind === 'pin' ? (
          <span key={i} title={p.text}>
            📌
          </span>
        ) : (
          <React.Fragment key={i}>{p.text}</React.Fragment>
        )
      )}
    </>
  );
}

interface QueueBreadcrumbProps {
  rem: PluginRem;
  plugin: RNPlugin;
  style?: React.CSSProperties;
}

export function QueueBreadcrumb({ rem, plugin, style }: QueueBreadcrumbProps) {
  const [loaded, setLoaded] = useState<LoadedCrumbs | null>(null);
  const dark = useDarkTheme();
  const lineRef = useRef<HTMLDivElement>(null);
  const labelRefs = useRef(new Map<string, HTMLSpanElement | null>());
  // Each name's full width, measured while it is shown and kept while it is folded.
  const nameWidths = useRef(new Map<string, number>());
  const [folded, setFolded] = useState<ReadonlySet<string>>(NO_FOLDS);

  useEffect(() => {
    let cancelled = false;
    loadCrumbs(plugin, rem)
      .then((c) => {
        if (!cancelled) setLoaded(c);
      })
      .catch((err) => {
        console.error('[QueueBreadcrumb] could not read the ancestors', err);
        if (!cancelled) setLoaded({ remId: rem._id, crumbs: [], truncated: false });
      });
    return () => {
      cancelled = true;
    };
  }, [rem._id, plugin]);

  const current = loaded?.remId === rem._id ? loaded : null;

  // Fold crumbs to their icon until the names fit (see the header); refold on resize. The
  // line's own width comes from the row around it, not from the crumbs, so folding cannot
  // feed back into the measurement.
  useLayoutEffect(() => {
    const line = lineRef.current;
    if (!line || !current || current.crumbs.length === 0) return;
    const crumbs = current.crumbs;
    const fit = () => {
      for (const c of crumbs) {
        const label = labelRefs.current.get(c.id);
        if (label && label.style.display !== 'none') nameWidths.current.set(c.id, label.scrollWidth);
      }
      const hasIcon = crumbs.map((c) => !!iconForRem(c.facts, dark));
      const nameWidth = crumbs.map((c) => Math.min(nameWidths.current.get(c.id) ?? 0, MAX_CRUMB_PX));
      let total =
        (current.truncated ? CHEVRON_PX * 2 : 0) +
        (crumbs.length - 1) * CHEVRON_PX +
        crumbs.reduce((sum, _c, i) => sum + CRUMB_PADDING_PX + (hasIcon[i] ? ICON_PX + ICON_GAP_PX : 0) + nameWidth[i], 0);
      const last = crumbs.length - 1;
      const order = [...crumbs.keys()].filter((i) => i > 0 && i < last);
      if (last > 0) order.push(0);
      const next = new Set<string>();
      for (const i of order) {
        if (total <= line.clientWidth) break;
        if (!hasIcon[i]) continue;
        next.add(crumbs[i].id);
        total -= nameWidth[i] + ICON_GAP_PX;
      }
      setFolded((prev) => (prev.size === next.size && [...next].every((id) => prev.has(id)) ? prev : next));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(line);
    return () => observer.disconnect();
  }, [current, dark]);

  // A line too long even folded starts at its end — the item's parent.
  useLayoutEffect(() => {
    const line = lineRef.current;
    if (line) line.scrollLeft = line.scrollWidth;
  }, [current, folded]);

  if (!current || current.crumbs.length === 0) return null;

  const last = current.crumbs.length - 1;
  const open = (id: RemId) => async (e: React.MouseEvent) => {
    e.stopPropagation();
    const target = await plugin.rem.findOne(id);
    if (target) await plugin.window.openRem(target);
  };

  return (
    <div
      ref={lineRef}
      className="ie-crumbs"
      style={{
        display: 'flex',
        alignItems: 'center',
        flex: '1 1 auto',
        minWidth: 0,
        overflowX: 'auto',
        overflowY: 'hidden',
        whiteSpace: 'nowrap',
        fontSize: 14,
        lineHeight: '20px',
        ...style,
      }}
    >
      <style>{CRUMBS_CSS}</style>
      {current.truncated && (
        <>
          <span style={{ flexShrink: 0, padding: '0 4px' }}>…</span>
          <Chevron />
        </>
      )}
      {current.crumbs.map((crumb, i) => {
        const icon = iconForRem(crumb.facts, dark);
        const isFolded = folded.has(crumb.id) && !!icon;
        // What is left after folding shortens in the same order: the middle crumbs, then the
        // top one, the item's parent last — which keeps a few letters whatever happens.
        const shrink = i === last ? 1 : i === 0 ? 100 : 1000;
        const minWidth = i === last ? (icon ? 72 : 56) : icon ? ICON_PX + CRUMB_PADDING_PX : 28;
        return (
          <React.Fragment key={crumb.id}>
            {i > 0 && <Chevron />}
            <span
              role="button"
              className="ie-crumb"
              title={crumb.title}
              onClick={open(crumb.id)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: ICON_GAP_PX,
                flex: `0 ${shrink} auto`,
                minWidth,
                maxWidth: MAX_CRUMB_PX,
                padding: `2px ${CRUMB_PADDING_PX / 2}px`,
                boxSizing: 'border-box',
              }}
            >
              {icon && <IconView icon={icon} size={ICON_PX} />}
              <span
                ref={(el) => {
                  labelRefs.current.set(crumb.id, el);
                }}
                className="ie-crumb-label"
                style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', ...(isFolded ? { display: 'none' } : {}) }}
              >
                <Name parts={crumb.parts} />
              </span>
            </span>
          </React.Fragment>
        );
      })}
    </div>
  );
}
