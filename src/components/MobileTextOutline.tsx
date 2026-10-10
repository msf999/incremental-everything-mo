// components/MobileTextOutline.tsx
// MOBILE-EXPERIMENT M4 + M5 (2026-10-10, untested on a device; see lib/mobile_experiments.ts).
//
// A plain-text outline of a rem, drawn by the plugin inside its own frame. It needs
// nothing from RemNote's document overlay, so it shows the text even where RemNote's
// document view stays white. Read-only and plain: no formatting, images (🖼️) or LaTeX,
// and property rows (Priority, Next Rep Date, a tag's own properties…) are left out.
// Opened with the ≡ Text button in the queue body. With the diagnostics experiment on,
// it starts with a few facts about the rem for the bug report.
//
// Built to stay cheap on a phone (2026-10-11 review): children come from one
// getChildrenRem() per Rem, a property row is recognised locally (its text is a single
// reference to a property definition — one lookup per distinct definition), and text is
// converted with resolveRemTextSegments, which makes no bridge call for plain text. No
// knowledge-base-wide scan, and the walk stops at MAX_LINES / MAX_DEPTH.
// Colours: classes ie-m4-fg / ie-m4-dim, defined by ExtractViewer for both themes.

import { PluginRem, RNPlugin } from '@remnote/plugin-sdk';
import { useEffect, useState } from 'react';
import { powerupCode } from '../lib/consts';
import { resolveRemTextSegments } from '../lib/richTextRemRefs';

const MAX_LINES = 400;
const MAX_DEPTH = 8;
const FLUSH_EVERY = 25;

// RemNote shows a rem with any of these powerups as a "learning source" page (a PDF,
// video, web page, audio recording or shared content) instead of its outline.
const LEARNING_SOURCE_POWERUPS: Array<[string, string]> = [
  ['f', 'PDF/file'],
  ['vi', 'video'],
  ['b', 'link'],
  ['au', 'audio recording'],
  ['ssa', 'shared article'],
  ['sslo', 'shared outline'],
];

interface OutlineLine {
  id: string;
  depth: number;
  text: string;
  back: string;
}

interface Facts {
  isIncRem: boolean;
  isDocument: boolean;
  learningSource: string[];
  children: number;
  propertyRows: number;
  styles: string;
  device: string;
}

interface MobileTextOutlineProps {
  rem: PluginRem;
  plugin: RNPlugin;
  showFacts: boolean;
  /** How long after the queue body appeared RemNote was asked for the document (M3). */
  documentRequestedAfterMs: number | null;
  /** How many document views RemNote has been asked for, for this rem (↻ adds one). */
  overlaysCreated: number;
}

/** Plain text of a rich-text value; '' when empty (never 'Untitled'). */
const plainText = async (plugin: RNPlugin, richText: unknown): Promise<string> => {
  if (!Array.isArray(richText) || richText.length === 0) return '';
  try {
    const segments = await resolveRemTextSegments(plugin, richText);
    return segments
      .map((s) => (s.kind === 'pin' ? '📌' : s.text))
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
  } catch {
    return '';
  }
};

/**
 * A property row (a powerup's or a tag's property, as RemNote shows them under a title)
 * is a child whose text is exactly one reference to a property definition. `isSlot`
 * results are cached per definition for the life of the walk.
 */
const makePropertyRowTest = (plugin: RNPlugin) => {
  const isDefinition = new Map<string, Promise<boolean>>();
  return async (rem: PluginRem): Promise<boolean> => {
    const text = rem.text as unknown;
    if (!Array.isArray(text) || text.length !== 1) return false;
    const el = text[0] as { i?: string; _id?: string } | string;
    if (!el || typeof el !== 'object' || el.i !== 'q' || !el._id) return false;
    const id = el._id;
    if (!isDefinition.has(id)) {
      isDefinition.set(
        id,
        (async () => {
          try {
            const target = await plugin.rem.findOne(id);
            return !!target && (await target.isSlot());
          } catch {
            return false;
          }
        })()
      );
    }
    return isDefinition.get(id)!;
  };
};

/** Whether RemNote's stylesheet reached this frame, and how its <link>s fared. */
const describeStyles = (): string => {
  try {
    const probe = document.createElement('div');
    probe.className = 'h-10';
    probe.style.position = 'absolute';
    probe.style.visibility = 'hidden';
    document.body.appendChild(probe);
    const applied = probe.offsetHeight > 0;
    probe.remove();
    const links = [...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')];
    const loaded = links.filter((l) => !!l.sheet).length;
    let origin = '';
    const first = links.find((l) => !/App\.css/.test(l.href));
    if (first) {
      try {
        origin = new URL(first.href).origin;
      } catch {
        origin = first.href.slice(0, 40);
      }
    }
    return `${applied ? 'present' : 'missing'} (${links.length} stylesheet links, ${loaded} loaded${origin ? `, from ${origin}` : ''})`;
  } catch {
    return 'unknown';
  }
};

const deviceLabel = (): string => {
  const ua = navigator.userAgent || '';
  const app = /RemNote-(IOS|Android)\/[^\s;)]*/i.exec(ua)?.[0] ?? '';
  const device = /iPhone|iPad|iPod|Android|Macintosh|Windows|Linux/.exec(ua)?.[0] ?? 'unknown device';
  return app ? `${device}, ${app}` : device;
};

export function MobileTextOutline({
  rem,
  plugin,
  showFacts,
  documentRequestedAfterMs,
  overlaysCreated,
}: MobileTextOutlineProps) {
  const [title, setTitle] = useState<OutlineLine | null>(null);
  const [lines, setLines] = useState<OutlineLine[]>([]);
  const [state, setState] = useState<'loading' | 'done' | 'capped' | 'error'>('loading');
  const [facts, setFacts] = useState<Facts | null>(null);

  useEffect(() => {
    let cancelled = false;
    setTitle(null);
    setLines([]);
    setState('loading');

    const isPropertyRow = makePropertyRowTest(plugin);
    const out: OutlineLine[] = [];
    let flushedAt = 0;
    const flush = (force = false) => {
      if (cancelled) return;
      if (force || out.length - flushedAt >= FLUSH_EVERY) {
        flushedAt = out.length;
        setLines(out.slice());
      }
    };

    let capped = false;
    const walk = async (parent: PluginRem, depth: number): Promise<void> => {
      if (cancelled) return;
      const children = await parent.getChildrenRem();
      if (cancelled || children.length === 0) return;
      if (depth > MAX_DEPTH) {
        capped = true;
        return;
      }
      for (const child of children) {
        if (cancelled) return;
        if (out.length >= MAX_LINES) {
          capped = true;
          return;
        }
        if (await isPropertyRow(child)) continue;
        out.push({
          id: child._id,
          depth,
          text: await plainText(plugin, child.text),
          back: await plainText(plugin, child.backText),
        });
        flush();
        await walk(child, depth + 1);
      }
    };

    (async () => {
      setTitle({ id: rem._id, depth: 0, text: await plainText(plugin, rem.text), back: await plainText(plugin, rem.backText) });
      if (cancelled) return;
      await walk(rem, 1);
      if (cancelled) return;
      flush(true);
      setState(capped ? 'capped' : 'done');
    })().catch((err) => {
      console.error('[MOBILE-EXPERIMENT] text outline failed', err);
      if (cancelled) return;
      flush(true);
      setState('error');
    });

    return () => {
      cancelled = true;
    };
  }, [rem._id, plugin]);

  useEffect(() => {
    if (!showFacts) return;
    let cancelled = false;
    setFacts(null);
    (async () => {
      const isPropertyRow = makePropertyRowTest(plugin);
      const [isIncRem, isDocument, children, ...sources] = await Promise.all([
        rem.hasPowerup(powerupCode),
        rem.isDocument(),
        rem.getChildrenRem(),
        ...LEARNING_SOURCE_POWERUPS.map(([code]) => rem.hasPowerup(code)),
      ]);
      let propertyRows = 0;
      for (const child of children as PluginRem[]) if (await isPropertyRow(child)) propertyRows++;
      if (cancelled) return;
      setFacts({
        isIncRem: isIncRem as boolean,
        isDocument: isDocument as boolean,
        learningSource: LEARNING_SOURCE_POWERUPS.filter((_, i) => sources[i]).map(([, label]) => label),
        children: (children as PluginRem[]).length - propertyRows,
        propertyRows,
        styles: describeStyles(),
        device: deviceLabel(),
      });
    })().catch((err) => console.error('[MOBILE-EXPERIMENT] facts failed', err));
    return () => {
      cancelled = true;
    };
  }, [rem._id, showFacts, plugin]);

  const yesNo = (b: boolean) => (b ? 'yes' : 'no');

  return (
    <div
      className="ie-m4-fg"
      style={{ height: '100%', overflowY: 'auto', boxSizing: 'border-box', padding: '10px 14px 24px' }}
    >
      {showFacts && (
        <div
          className="ie-m4-dim"
          style={{
            fontSize: 11,
            lineHeight: 1.45,
            border: '1px dashed rgba(127, 127, 127, 0.5)',
            borderRadius: 6,
            padding: '6px 8px',
            marginBottom: 10,
          }}
        >
          <div style={{ fontWeight: 700 }}>What the plugin sees (for the mobile test)</div>
          {facts ? (
            <div>
              Incremental Rem: {yesNo(facts.isIncRem)}
              {!facts.isIncRem && ' (probably the queue item’s source)'} · Document: {yesNo(facts.isDocument)} ·
              PDF/link/audio parts: {facts.learningSource.length ? facts.learningSource.join(', ') : 'none'} ·
              child Rems: {facts.children} (+{facts.propertyRows} property rows) · RemNote styles in this frame:{' '}
              {facts.styles} · document requested after{' '}
              {documentRequestedAfterMs === null ? '—' : `${(documentRequestedAfterMs / 1000).toFixed(1)} s`} · document
              views requested: {overlaysCreated} · {facts.device}
            </div>
          ) : (
            <div>checking…</div>
          )}
        </div>
      )}
      <div className="ie-m4-dim" style={{ fontSize: 11, marginBottom: 8 }}>
        Plain text drawn by the plugin — no formatting, images or properties. Tap ≡ again for RemNote’s view.
      </div>
      {title && (
        <div style={{ fontSize: 17, fontWeight: 700, lineHeight: 1.35, marginBottom: 6, overflowWrap: 'anywhere' }}>
          {title.text || 'Untitled'}
          {title.back && (
            <span className="ie-m4-dim" style={{ fontWeight: 400 }}>
              {' '}
              → {title.back}
            </span>
          )}
        </div>
      )}
      {lines.map((line) => (
        <div
          key={line.id}
          style={{
            display: 'flex',
            gap: 6,
            paddingLeft: (line.depth - 1) * 16,
            margin: '2px 0',
            fontSize: 15,
            lineHeight: 1.45,
          }}
        >
          <span className="ie-m4-dim" style={{ flexShrink: 0 }}>
            •
          </span>
          <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
            {line.text || <span className="ie-m4-dim">(no text)</span>}
            {line.back && <span className="ie-m4-dim"> → {line.back}</span>}
          </span>
        </div>
      ))}
      <div className="ie-m4-dim" style={{ fontSize: 11, marginTop: 8 }}>
        {state === 'loading' && 'Loading…'}
        {state === 'capped' && `Shortened: at most ${MAX_LINES} Rems and ${MAX_DEPTH} levels are shown.`}
        {state === 'error' && 'Could not read the rest of this Rem.'}
        {state === 'done' && lines.length === 0 && 'No child Rems.'}
      </div>
    </div>
  );
}
