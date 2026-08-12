// components/QueueDistribution.tsx
// FORK-ONLY (Deviation 14). The due-Incremental-Rem priority distribution,
// rendered inline in the queue info bar. This used to live in the queue's top
// counter as a CSS ::after string ("1440 + 1610 (40, 582, 352, 965)") — four
// unlabelled numbers whose bands you had to remember.
//
// It is drawn as a proportional stacked bar over the plugin's OWN ten priority
// bands (lib/priority_bands.ts: 0s, 10s ... 90s), using the plugin's own
// bandForPriority + bandColorPercentile + percentileToHslColor, so a band reads
// the same colour here as its badge does in a table cell. Priority 0-100 with
// LOWER = more important, hence the red-to-blue ramp left to right.
import React from 'react';
import { useTrackerPlugin } from '@remnote/plugin-sdk';
import { allIncrementalRemKey } from '../lib/consts';
import { IncrementalRem } from '../lib/incremental_rem';
import { BAND_COUNT, bandColorPercentile, bandForPriority } from '../lib/priority_bands';
import { percentileToHslColor } from '../lib/utils';

/**
 * Colour for a band.
 *
 * Deliberately the ABSOLUTE scale — `bandColorPercentile(null, band)`, i.e. the
 * band's own midpoint — rather than the KB-ranked percentiles the table badges
 * prefer when the sample is large enough. Percentile ranking is right for a
 * single badge ("how urgent is this one, relative to everything else") but wrong
 * for a distribution: in a KB where most IncRems sit in one band, every band's
 * percentile lands in the same part of the ramp and the whole chart collapses to
 * one colour. The absolute scale keeps 0s red and 90s blue whatever the shape of
 * the data, which is the point of the chart.
 */
function bandColor(band: number): string {
  return percentileToHslColor(bandColorPercentile(null, band));
}

const BAND_GAP_PX = 2;

/**
 * Floor width of a band segment: just enough for the count it has to show, at
 * 10px tabular figures (~6px a digit) plus breathing room. Sized per band rather
 * than to a fixed worst case, so an empty band shrinks to a tight `0` chip and
 * leaves its space to the bands that hold something. Everything above the sum of
 * these floors is shared out by flex-grow, i.e. in proportion to the counts.
 */
function bandFloorPx(n: number): number {
  return String(n).length * 6 + 8;
}

/** e.g. 0 -> "0-9", 9 -> "90-100" (100 is clamped into the top band). */
function bandRange(band: number): string {
  return band === BAND_COUNT - 1 ? '90-100' : `${band * 10}-${band * 10 + 9}`;
}

export function QueueDistribution(props: {
  /**
   * Priority of the queue item currently on screen, if it has one. Its band is
   * ringed in the bar so you can see where this item sits on the same scale the
   * distribution is drawn on. Resolved by the caller (both callers already have
   * it) rather than here, so the component stays a pure view of the data.
   */
  highlightPriority?: number | null;
}) {
  const bands = useTrackerPlugin(async (rp) => {
    const all = (await rp.storage.getSession<IncrementalRem[]>(allIncrementalRemKey)) || [];
    const now = Date.now();
    const counts = new Array<number>(BAND_COUNT).fill(0);
    for (const rem of all) {
      if (now >= rem.nextRepDate) counts[bandForPriority(rem.priority)]++;
    }
    return counts;
  }, []);

  if (!bands) return null;
  const total = bands.reduce((a, b) => a + b, 0);
  const highlightBand =
    props.highlightPriority == null ? null : bandForPriority(props.highlightPriority);
  // The strip can never be narrower than its ten floors, or overflow:hidden
  // would clip a band away silently.
  const stripMinPx =
    bands.reduce((sum, n) => sum + bandFloorPx(n), 0) + (BAND_COUNT - 1) * BAND_GAP_PX;

  const tooltip =
    'Due Incremental Rems by priority band (lower = more important)\n' +
    bands
      .map(
        (n, band) =>
          `  ${bandRange(band).padStart(6)}  ${String(n).padStart(5)}  ${(
            (n / total) *
            100
          ).toFixed(1)}%`
      )
      .join('\n') +
    `\n  ${'total'.padStart(6)}  ${String(total).padStart(5)}` +
    (highlightBand === null
      ? ''
      : `\n\nThe ringed band (${bandRange(highlightBand)}) is where this queue item's ` +
        `priority (${props.highlightPriority}) sits on the same scale.`);

  // No "Due <total>" caption: the queue's own top counter already reads
  // `cards + due IncRems`, so repeating the figure here was redundant. The total
  // is still in the tooltip.
  if (total === 0) return null;

  return (
    <div
      style={{ display: 'flex', alignItems: 'center', flex: '1 1 auto', minWidth: 0 }}
      title={tooltip}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'stretch',
          gap: `${BAND_GAP_PX}px`,
          // Enough room for all ten bands at their floor width, so the bar wraps
          // onto its own line rather than clipping a band away.
          flex: `1 1 ${stripMinPx + 120}px`,
          minWidth: `${stripMinPx}px`,
          height: '18px',
          borderRadius: '9px',
          overflow: 'hidden',
        }}
      >
        {bands.map((n, band) => (
          <div
            key={band}
            style={{
              // Floor = just wide enough for THIS band's number, so all ten
              // counts stay legible (zeros included) without an empty band
              // reserving space it does not need. Everything above the floors is
              // shared out in proportion to the counts (flex-grow: n), so a band
              // with 0 has grow 0 and stays a tight `0` chip.
              flex: `${n} 1 ${bandFloorPx(n)}px`,
              minWidth: `${bandFloorPx(n)}px`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
              backgroundColor: bandColor(band),
              // Empty bands stay on the scale but recede, so the eye lands on
              // the bands that actually hold something. The current item's own
              // band keeps full opacity even when empty — it is the one band the
              // ring is pointing at.
              opacity: n === 0 && band !== highlightBand ? 0.3 : 1,
              // INSET ring, not `outline`: the strip clips to a rounded rect
              // with overflow:hidden, which would shave an outline off the first
              // and last segments. content-primary tracks the theme, so the ring
              // stays legible against every band colour in light and dark.
              boxShadow:
                band === highlightBand
                  ? 'inset 0 0 0 2px var(--rn-clr-content-primary)'
                  : undefined,
              fontSize: '10px',
              fontWeight: 700,
              lineHeight: 1,
              color: '#fff',
              textShadow: '0 1px 1px rgba(0,0,0,0.35)',
              whiteSpace: 'nowrap',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {/* The count only — never the range. Ranges inside the segments made
                the bar unreadable and truncated ("-19 4"); the band a segment
                stands for is carried by its colour and position, and spelled out
                in the tooltip. */}
            {n}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Geometry shared by BOTH info bars — the IncRem one in answer_buttons and the
 * flashcard one in queue_info_bar — so they render at identical size. Defined
 * once here because they live in different widgets (different iframes) and any
 * divergence is immediately visible as the queue moves between item types.
 *
 * The outer padding matches answer_buttons' containerStyle, which is what sets
 * the IncRem bar's inset from the pane edge.
 */
export const QUEUE_INFO_BAR_OUTER_PADDING = '8px 12px 12px 12px';

export function getQueueInfoBarStyle(priorityColor: string): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: '16px',
    padding: '8px 16px',
    backgroundColor: 'var(--rn-clr-background-secondary)',
    borderRadius: '10px',
    fontSize: '12px',
    color: 'var(--rn-clr-content-secondary)',
    borderLeft: `4px solid ${priorityColor}`,
  };
}

/** The rounded priority pill, shared by both bars for the same reason. */
export function getQueuePriorityBadgeStyle(priorityColor: string): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '5px 12px',
    borderRadius: '14px',
    fontSize: '12px',
    fontWeight: 600,
    color: 'white',
    backgroundColor: priorityColor,
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
  };
}

/** Neutral grey used by both bars when no percentile is available. */
export const QUEUE_PRIORITY_NEUTRAL_COLOR = '#6b7280';

/**
 * Whether the info bar should render, given the setting and the platform.
 * `isIncRem` decides the 'incRemOnly' case; `isMobile` the 'allExceptMobile' one.
 */
export function shouldShowQueueInfoBar(
  mode: 'all' | 'incRemOnly' | 'allExceptMobile' | 'off' | undefined,
  isIncRem: boolean,
  isMobile: boolean
): boolean {
  switch (mode) {
    case 'off':
      return false;
    case 'incRemOnly':
      return isIncRem;
    case 'allExceptMobile':
      return isMobile ? isIncRem : true;
    case 'all':
      return true;
    default:
      // Loading frame: fall back to the default ('allExceptMobile').
      return isMobile ? isIncRem : true;
  }
}
