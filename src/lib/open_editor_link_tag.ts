import {
  RNPlugin,
  PluginRem,
  BuiltInPowerupCodes,
} from '@remnote/plugin-sdk';
import { safeRemTextToString } from './pdfUtils';

/**
 * Plain-text title must end with "(OpenLink)" — **case-sensitive** (`OpenLink` only).
 * Spaces allowed inside parentheses, e.g. "( OpenLink )".
 * When true, Open Editor / Ctrl+G may open only external URL tabs (no Rem document tab),
 * provided at least one external URL was extracted.
 */
export const REM_TITLE_ENDS_WITH_OPEN_LINK_TAG = /\(\s*OpenLink\s*\)\s*$/;

/** Normalize so titles like `Article （OpenLink）` (fullwidth parens) still match. */
export function normalizeVisibleTitleForLinkCheck(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/\uFF08/g, '(')
    .replace(/\uFF09/g, ')')
    .trim();
}

/**
 * HTTP(S) URLs for Open Editor: Link powerup, inline links, and plain URLs in rich text.
 * Scans **both** card front (`rem.text`) and back (`rem.backText`) — URLs only on the back
 * were previously missed, so "(OpenLink)" + skip-Rem-tab never triggered.
 */
export async function extractExternalHttpUrlsFromRem(
  _plugin: RNPlugin,
  rem: PluginRem
): Promise<string[]> {
  const urls: string[] = [];

  const hasLinkPowerup = await rem.hasPowerup(BuiltInPowerupCodes.Link);
  if (hasLinkPowerup) {
    const urlProp = await rem.getPowerupProperty<BuiltInPowerupCodes.Link>(
      BuiltInPowerupCodes.Link,
      'URL'
    );
    if (urlProp && typeof urlProp === 'string') urls.push(urlProp);
  }

  const seen = new Set<unknown>();
  const traverseSafe = (node: unknown): void => {
    if (node == null) return;
    if (typeof node === 'string') {
      const matches = node.match(/https?:\/\/[^\s"'<\[\]{}()]+/g);
      if (matches) urls.push(...matches);
      return;
    }
    if (typeof node !== 'object') return;
    if (seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const item of node) traverseSafe(item);
      return;
    }
    const o = node as Record<string, unknown>;
    if (o.url && typeof o.url === 'string' && o.url.startsWith('http')) {
      urls.push(o.url);
    }
    for (const v of Object.values(o)) traverseSafe(v);
  };

  traverseSafe(await rem.text);
  if (rem.backText != null) traverseSafe(await rem.backText);

  return Array.from(new Set(urls)).filter((u) => !u.includes('remnote.com'));
}

/**
 * Walks rich text in document order and concatenates visible characters: string nodes and
 * `.text` on elements, recursing nested `c` / `children` / `contents`. Does **not** append raw
 * `url` values — otherwise hyperlink titles like `Article (OpenLink)` serialize like a long URL and
 * fail the `(OpenLink)` suffix check when using `richText.toString` alone.
 */
export function richTextVisibleForLinkSuffix(richText: unknown): string {
  const parts: string[] = [];
  const walk = (node: unknown): void => {
    if (node == null) return;
    if (typeof node === 'string') {
      parts.push(node);
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (typeof node === 'object') {
      const o = node as Record<string, unknown>;
      if (typeof o.text === 'string') parts.push(o.text);
      for (const k of ['c', 'children', 'contents', 'content'] as const) {
        const v = o[k];
        if (Array.isArray(v)) walk(v);
      }
      // Catch other RemNote nests without treating `url` as visible text
      for (const [k, v] of Object.entries(o)) {
        if (k === 'url' || k === '_id') continue;
        if (Array.isArray(v)) walk(v);
      }
    }
  };
  walk(richText);
  return parts.join('');
}

async function sideMatchesOpenLinkTag(
  plugin: RNPlugin,
  rawRichText: unknown
): Promise<{ structured: string; plain: string; matches: boolean }> {
  const structuredRaw = richTextVisibleForLinkSuffix(rawRichText).trim();
  const structured = normalizeVisibleTitleForLinkCheck(structuredRaw);
  if (structured && REM_TITLE_ENDS_WITH_OPEN_LINK_TAG.test(structured)) {
    return { structured, plain: '', matches: true };
  }
  const plainRaw = (await safeRemTextToString(plugin, rawRichText)).trim();
  const plain = normalizeVisibleTitleForLinkCheck(plainRaw);
  const matches =
    !!plain && plain !== 'Untitled' && REM_TITLE_ENDS_WITH_OPEN_LINK_TAG.test(plain);
  return { structured: structuredRaw, plain: plainRaw, matches };
}

export async function remTitleEndsWithOpenLinkTag(plugin: RNPlugin, rem: PluginRem): Promise<boolean> {
  const rawFront = await rem.text;
  const rawBack = rem.backText != null ? await rem.backText : null;

  const front = await sideMatchesOpenLinkTag(plugin, rawFront);
  const back =
    rawBack != null ? await sideMatchesOpenLinkTag(plugin, rawBack) : null;

  return front.matches || (back?.matches ?? false);
}
