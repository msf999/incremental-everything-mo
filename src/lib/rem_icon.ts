// lib/rem_icon.ts
// FORK (2026-10-11, owner request): what the queue needs to draw a Rem's icon the way
// RemNote does — its own icon (an emoji, or one of RemNote's coloured folder and document
// pictures), whether it is a folder, and whether it is a document. Used by
// components/QueueHierarchy.tsx.
//
// Where RemNote keeps them: on the Document powerup ('o'), in two hidden properties —
// Bullet Icon ('b', written by RemNote's emoji picker) and Is Folder ('f', "true" for a
// folder). RemNote's sidebar chooses a Rem's icon from those two and the Document powerup
// itself (RemNote 1.28 bundle, module 715394):
//   - Bullet Icon set: a path containing "offline_assets/emoji/folder" is a coloured folder
//     (drawn as its "-filled" variant when the folder has children — every ancestor does),
//     one containing "offline_assets/emoji/document" a coloured document, anything else an
//     emoji;
//   - otherwise a folder gets RemNote's folder picture (a "-dark" variant in dark mode),
//   - and a document RemNote's document icon (owner decision: the same page icon RemNote
//     draws in front of a flashcard's document, components/QueueHierarchy.tsx).
//
// How they are read, and why not through rem.getPowerupProperty: for a built-in powerup the
// SDK (0.0.46) translates the property NAME into its code through its own table, which
// predates both properties — so neither gets through, and RemNote answers "powerupSlot
// parameter: Required" (seen live, 2026-10-11). getPowerupSlotByCode refuses built-in hidden
// slots, and their values are not child Rems either (lib/powerup_slot_compat.ts). What works
// is the request RemNote expects, sent through the Rem's own `call` — the SDK-internal method
// every typed Rem method uses — with the codes as they are. If a future SDK drops `call`,
// the catch below just means no icon.

import { PluginRem } from '@remnote/plugin-sdk';

const DOCUMENT_POWERUP_CODE = 'o';
const BULLET_ICON_PROPERTY_CODE = 'b';
const IS_FOLDER_PROPERTY_CODE = 'f';
// RemNote's own pictures. They load in the plugin's frame like any image (checked
// 2026-10-11); offline, the image fails and the icon is simply left out.
const REMNOTE_ASSETS = 'https://www.remnote.com';
// Any pictographic code point; native emoji always contain one.
const EMOJI = /\p{Extended_Pictographic}/u;

export interface RemIconFacts {
  /** The Bullet Icon as stored, or ''. */
  bulletIcon: string;
  /** Tagged with the Document powerup (RemNote's isTaggedAsDocument). */
  isDocument: boolean;
  /** Made a folder in RemNote (its explicit Is Folder property). */
  isFolder: boolean;
}

export type RemIcon =
  | { kind: 'emoji'; text: string }
  | { kind: 'image'; src: string }
  | { kind: 'document' };

const NO_FACTS: RemIconFacts = { bulletIcon: '', isDocument: false, isFolder: false };

async function readDocumentProperty(rem: PluginRem, code: string): Promise<string> {
  const call = (rem as unknown as { call?: (method: string, args: object) => Promise<unknown> }).call;
  if (typeof call !== 'function') return '';
  const raw = await call.call(rem, 'getPowerupProperty', {
    powerupCode: DOCUMENT_POWERUP_CODE,
    powerupSlot: code,
  });
  return typeof raw === 'string' ? raw.trim() : '';
}

/** The three facts RemNote picks a Rem's icon from. Never throws. */
export async function readRemIconFacts(rem: PluginRem): Promise<RemIconFacts> {
  try {
    const isDocument = await rem.hasPowerup(DOCUMENT_POWERUP_CODE);
    const [bulletIcon, isFolder] = await Promise.all([
      readDocumentProperty(rem, BULLET_ICON_PROPERTY_CODE).catch(() => ''),
      isDocument
        ? readDocumentProperty(rem, IS_FOLDER_PROPERTY_CODE)
            .then((v) => v === 'true')
            .catch(() => false)
        : Promise.resolve(false),
    ]);
    return { bulletIcon, isDocument, isFolder };
  } catch {
    return NO_FACTS;
  }
}

/** URL of one of RemNote's emoji pictures, from the stored path or URL. */
function remnotePicture(stored: string, variant: string): string {
  const name = (stored.split('/').pop() ?? '').replace(/\.svg$/i, '');
  const withVariant = variant && !name.endsWith(variant) ? `${name}${variant}` : name;
  return `${REMNOTE_ASSETS}/offline_assets/emoji/${withVariant}.svg`;
}

/** The Rem's own icon, from its Bullet Icon alone; null when it has none we can draw. */
export function ownIcon(facts: RemIconFacts): RemIcon | null {
  const value = facts.bulletIcon;
  if (!value) return null;
  if (value.includes('offline_assets/emoji/folder')) return { kind: 'image', src: remnotePicture(value, '-filled') };
  if (value.includes('offline_assets/emoji/')) return { kind: 'image', src: remnotePicture(value, '') };
  if (/^https?:\/\//i.test(value)) return { kind: 'image', src: value };
  // A short string carrying an emoji; anything longer is not an icon we can draw.
  return EMOJI.test(value) && value.length <= 16 ? { kind: 'emoji', text: value } : null;
}

/**
 * The icon RemNote shows for a folder or document: its own icon, else RemNote's folder
 * picture for a folder, else RemNote's document icon for a document; null for any other Rem
 * without its own icon.
 */
export function iconForRem(facts: RemIconFacts, dark: boolean): RemIcon | null {
  const own = ownIcon(facts);
  if (own) return own;
  if (facts.isFolder) return { kind: 'image', src: remnotePicture('folder-placeholder', dark ? '-dark-filled' : '-filled') };
  if (facts.isDocument) return { kind: 'document' };
  return null;
}
