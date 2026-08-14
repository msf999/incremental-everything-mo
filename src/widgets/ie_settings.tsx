import { renderWidget, usePlugin, useTrackerPlugin } from '@remnote/plugin-sdk';
import React, { CSSProperties, useMemo, useState } from 'react';
import {
  IE_DOCS_BASE_URL,
  IE_SETTINGS_DEFAULTS,
  IE_SETTINGS_SCHEMA,
  IE_SETTING_GROUPS,
  IE_SETTING_IDS_BY_GROUP,
  IESettingId,
  IESettings,
  SettingGroupId,
  SettingSpec,
  getIESetting,
  setIESetting,
  isSettingVisible,
  hiddenDependentsOf,
} from '../lib/settings';
import {
  FORK_HIDDEN_IE_SETTINGS,
  FORK_IE_GROUPS,
  FORK_IE_LAYOUT,
} from '../lib/fork_gates';

// FORK (Deviation 13): the popup renders the fork's own section layout
// (fork_gates.FORK_IE_LAYOUT) rather than upstream's per-setting `group` field —
// six upstream sections consolidated into four, with rows for disabled features
// omitted. Values and reads are untouched; this is presentation only. Any id in
// the layout that isn't in the schema (e.g. after an upstream rename) is skipped
// rather than crashing, and empty sections drop out.
const keepId = (id: string) =>
  !FORK_HIDDEN_IE_SETTINGS.has(id) && !!(IE_SETTINGS_SCHEMA as any)[id];

const FORK_VISIBLE_IDS_BY_GROUP = FORK_IE_LAYOUT.map(({ group, ids, blocks }) => ({
  group,
  ids: ids.filter(keepId) as typeof IE_SETTING_IDS_BY_GROUP[number]['ids'],
  blocks: blocks
    ?.map((b) => ({ ...b, ids: b.ids.filter(keepId) }))
    .filter((b) => b.ids.length > 0),
})).filter((g) => g.ids.length > 0);

/** Flat list of the ids this popup renders — used for the "changed" counter. */
const FORK_VISIBLE_IDS = FORK_VISIBLE_IDS_BY_GROUP.flatMap((g) => g.ids);

/** Section label/blurb/help: fork sections first, then upstream's. */
const groupSpec = (group: string): { label: string; blurb?: string; helpPath?: string } =>
  FORK_IE_GROUPS[group] ?? (IE_SETTING_GROUPS as any)[group] ?? { label: group };

/**
 * The IE Settings popup: every setting the plugin owns, grouped and layered,
 * because RemNote's own panel renders three dozen entries as one flat list.
 *
 * Native-tier settings (see lib/settings.ts) are shown read-only with a pointer
 * to RemNote's panel: the SDK has no setter for a registered setting, and those
 * particular ones are deliberately kept where someone chasing a performance
 * problem would look for them.
 */

const openDocs = (path: string) => {
  const url = `${IE_DOCS_BASE_URL}${path}`;
  const opened = window.open(url, '_blank');
  if (!opened || opened.closed) {
    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    document.body.appendChild(link);
    link.click();
    setTimeout(() => document.body.removeChild(link), 100);
  }
};

const isDefault = (id: IESettingId, value: unknown) =>
  JSON.stringify(value) === JSON.stringify(IE_SETTINGS_DEFAULTS[id]);

/**
 * How to tell the user to reveal the settings this one gates. A switch can gate
 * in either direction — the Beta Scheduler hides its parameters when off and
 * hides the Multiplier when on — so the phrase follows the required value.
 */
function requirementPhrase(spec: SettingSpec, requires: unknown): string {
  // A native-tier switch cannot be flipped here, so say where it lives rather
  // than pointing at a control the popup renders disabled.
  const where = spec.tier === 'native' ? " in RemNote's settings" : '';
  if (spec.kind === 'boolean') {
    return `Turn this ${requires ? 'on' : 'off'}${where} to configure`;
  }
  if (spec.kind === 'dropdown') {
    const label = spec.options.find((o) => o.value === requires)?.label ?? String(requires);
    return `Set this to “${label}”${where} to configure`;
  }
  return `Set this to ${JSON.stringify(requires)}${where} to configure`;
}

function HelpLink({ path, label }: { path: string; label: string }) {
  return (
    <button
      onClick={() => openDocs(path)}
      title={`Open the documentation: ${label}`}
      aria-label={`Open the documentation: ${label}`}
      style={{
        width: 18,
        height: 18,
        borderRadius: '50%',
        border: '1px solid var(--rn-clr-border-primary, #cbd5e1)',
        background: 'transparent',
        color: 'var(--rn-clr-content-secondary, #64748b)',
        fontSize: 11,
        fontWeight: 700,
        lineHeight: '16px',
        cursor: 'pointer',
        flexShrink: 0,
        padding: 0,
      }}
    >
      ?
    </button>
  );
}

function Badge({ children, tone }: { children: React.ReactNode; tone: 'neutral' | 'warn' }) {
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 600,
        padding: '1px 6px',
        borderRadius: 4,
        whiteSpace: 'nowrap',
        color: tone === 'warn' ? '#b45309' : 'var(--rn-clr-content-tertiary, #94a3b8)',
        backgroundColor:
          tone === 'warn' ? 'rgba(245, 158, 11, 0.14)' : 'var(--rn-clr-background-tertiary, #f1f5f9)',
      }}
    >
      {children}
    </span>
  );
}

interface RowProps {
  id: IESettingId;
  spec: SettingSpec;
  value: unknown;
  onChange: (value: unknown) => void;
  /** Settings hidden because they depend on this one, grouped by required value. */
  hiddenDependents: Array<{ requires: unknown; ids: IESettingId[] }>;
}

function SettingRow({ id, spec, value, onChange, hiddenDependents }: RowProps) {
  const readOnly = spec.tier === 'native';
  // Text and number inputs keep a local draft so that typing is not fought by
  // the reactive value coming back from storage; committed on blur / Enter.
  const [draft, setDraft] = useState<string | null>(null);

  const inputStyle: CSSProperties = {
    fontSize: 12,
    padding: '4px 8px',
    border: '1px solid var(--rn-clr-border-primary, #cbd5e1)',
    borderRadius: 6,
    backgroundColor: 'var(--rn-clr-background-primary, #fff)',
    color: 'var(--rn-clr-content-primary, #0f172a)',
    opacity: readOnly ? 0.6 : 1,
  };

  const commitNumber = (raw: string) => {
    setDraft(null);
    const n = Number(raw);
    // FORK (2026-08-14, bug-hunt #37): `Number('')` is 0, not NaN, so this guard —
    // plainly written to catch an emptied field — passed and committed 0 (then
    // clamped to the min). Select-all + Delete + blur silently rewrote the value.
    if (raw.trim() === '') return;
    if (!Number.isFinite(n)) return;
    const spec2 = spec as Extract<SettingSpec, { kind: 'number' }>;
    let v = spec2.integer ? Math.round(n) : n;
    if (spec2.min !== undefined) v = Math.max(spec2.min, v);
    if (spec2.max !== undefined) v = Math.min(spec2.max, v);
    onChange(v);
  };

  const control = () => {
    switch (spec.kind) {
      case 'boolean':
        return (
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: readOnly ? 'default' : 'pointer' }}>
            <input
              type="checkbox"
              checked={!!value}
              disabled={readOnly}
              onChange={(e) => onChange(e.target.checked)}
              style={{ width: 15, height: 15, cursor: readOnly ? 'default' : 'pointer' }}
            />
            <span style={{ fontSize: 12, color: 'var(--rn-clr-content-secondary, #475569)' }}>
              {value ? 'On' : 'Off'}
            </span>
          </label>
        );
      case 'number':
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="number"
              value={draft ?? String(value ?? '')}
              disabled={readOnly}
              min={spec.min}
              max={spec.max}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={(e) => commitNumber(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitNumber((e.target as HTMLInputElement).value);
              }}
              style={{ ...inputStyle, width: 92 }}
            />
            {spec.unit && (
              <span style={{ fontSize: 11, color: 'var(--rn-clr-content-tertiary, #94a3b8)' }}>{spec.unit}</span>
            )}
          </div>
        );
      case 'string':
        return (
          <input
            type="text"
            value={draft ?? String(value ?? '')}
            disabled={readOnly}
            placeholder={spec.placeholder}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={(e) => {
              setDraft(null);
              onChange(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            }}
            style={{ ...inputStyle, width: spec.wide ? '100%' : 220, fontFamily: spec.wide ? 'monospace' : undefined }}
          />
        );
      case 'dropdown':
        return (
          <select
            value={String(value ?? '')}
            disabled={readOnly}
            onChange={(e) => onChange(e.target.value)}
            style={{ ...inputStyle, minWidth: 220, cursor: readOnly ? 'default' : 'pointer' }}
          >
            {spec.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        );
    }
  };

  const modified = !readOnly && !isDefault(id, value);

  return (
    <div
      style={{
        padding: '12px 0',
        borderBottom: '1px solid var(--rn-clr-background-tertiary, #f1f5f9)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{spec.title}</span>
        {spec.helpPath && <HelpLink path={spec.helpPath} label={spec.title} />}
        {spec.reloadRequired && <Badge tone="neutral">needs reload</Badge>}
        {readOnly && <Badge tone="neutral">RemNote settings</Badge>}
        {modified && <Badge tone="neutral">modified</Badge>}
      </div>

      {spec.warning && (
        <div
          style={{
            fontSize: 12,
            lineHeight: 1.5,
            padding: '8px 10px',
            borderRadius: 6,
            // FORK (Deviation 13): 'danger' warnings (ignoring them breaks the
            // plugin) get a red callout; the default amber is for "this is heavy".
            border:
              spec.warningTone === 'danger'
                ? '2px solid rgba(220, 38, 38, 0.65)'
                : '1px solid rgba(245, 158, 11, 0.45)',
            backgroundColor:
              spec.warningTone === 'danger'
                ? 'rgba(220, 38, 38, 0.10)'
                : 'rgba(245, 158, 11, 0.10)',
            color: 'var(--rn-clr-content-primary, #0f172a)',
          }}
        >
          <strong style={spec.warningTone === 'danger' ? { color: 'var(--rn-clr-red, #dc2626)' } : undefined}>
            {spec.warningTone === 'danger' ? '⛔ WARNING: ' : '⚠️ '}
          </strong>
          {spec.warning}
        </div>
      )}

      {spec.description.split('\n\n').map((para, i) => (
        <div
          key={i}
          style={{ fontSize: 12, lineHeight: 1.55, color: 'var(--rn-clr-content-secondary, #475569)' }}
        >
          {para}
        </div>
      ))}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        {control()}
        {readOnly ? (
          <span style={{ fontSize: 11, color: 'var(--rn-clr-content-tertiary, #94a3b8)' }}>
            Change this in Settings → Plugins → Incremental Everything. It is kept there on purpose: that panel
            is where you would look first if the plugin felt heavy.
          </span>
        ) : (
          modified && (
            <button
              onClick={() => onChange(IE_SETTINGS_DEFAULTS[id])}
              style={{
                fontSize: 11,
                padding: '2px 8px',
                borderRadius: 5,
                border: '1px solid var(--rn-clr-border-primary, #cbd5e1)',
                backgroundColor: 'transparent',
                color: 'var(--rn-clr-content-secondary, #475569)',
                cursor: 'pointer',
              }}
              title={`Reset to ${JSON.stringify(IE_SETTINGS_DEFAULTS[id])}`}
            >
              Reset
            </button>
          )
        )}
      </div>

      {hiddenDependents.map((dep) => (
        <div
          key={JSON.stringify(dep.requires)}
          style={{ fontSize: 11, fontStyle: 'italic', color: 'var(--rn-clr-content-tertiary, #94a3b8)' }}
        >
          {requirementPhrase(spec, dep.requires)}{' '}
          {dep.ids.map((depId) => IE_SETTINGS_SCHEMA[depId].title).join(' and ')}.
        </div>
      ))}
    </div>
  );
}

export function IESettingsWidget() {
  const plugin = usePlugin();
  // FORK (Deviation 13): widened to string (fork section ids aren't in upstream's
  // SettingGroupId union) and defaulted to the first VISIBLE section — upstream's
  // default 'flashcardPriority' is now hidden, which would open the popup with no
  // section selected.
  const [activeGroup, setActiveGroup] = useState<string>(
    FORK_VISIBLE_IDS_BY_GROUP[0]?.group ?? 'general'
  );
  const [search, setSearch] = useState('');

  const allIds = useMemo(() => Object.keys(IE_SETTINGS_SCHEMA) as IESettingId[], []);

  // One tracker for the whole set: re-runs when the synced blob or any native
  // setting changes, so the popup reflects edits made anywhere.
  const values = useTrackerPlugin(async (rp) => {
    const entries = await Promise.all(allIds.map(async (id) => [id, await getIESetting(rp, id)] as const));
    return Object.fromEntries(entries) as unknown as IESettings;
  }, [allIds]);

  const query = search.trim().toLowerCase();
  // A setting whose parent switch is off is hidden everywhere, search included:
  // configuring a scheduler you have turned off is exactly the noise the popup
  // exists to remove.
  const visible = (id: IESettingId) => isSettingVisible(id, values);
  const matches = (id: IESettingId) => {
    if (!visible(id)) return false;
    if (!query) return true;
    const spec = IE_SETTINGS_SCHEMA[id];
    return (
      spec.title.toLowerCase().includes(query) ||
      spec.description.toLowerCase().includes(query) ||
      id.toLowerCase().includes(query)
    );
  };

  // FORK (Deviation 13): count only settings this popup actually shows. Upstream
  // counted every popup-tier id in the schema, so a hidden setting holding a
  // non-default value (e.g. display-fsrs-dsr in the hidden FSRS group) reported
  // "N changed from default" with no visible row marked — nothing to click.
  // FORK (2026-08-14, bug-hunt #30): also filter by showWhen visibility. Narrowing
  // this from the whole schema to FORK_VISIBLE_IDS was not enough — the three
  // showWhen-gated settings still slipped through, so e.g. changing Multiplier and
  // then enabling the Beta Scheduler left "1 changed from default" in the header
  // with no visible row carrying the badge and nothing to click. The nav sidebar
  // count already filters by `visible`, so the two disagreed.
  const modifiedCount = values
    ? FORK_VISIBLE_IDS.filter(
        (id) =>
          IE_SETTINGS_SCHEMA[id].tier === 'popup' &&
          isSettingVisible(id, values) &&
          !isDefault(id, values[id])
      ).length
    : 0;

  const onChange = async (id: IESettingId, value: unknown) => {
    await setIESetting(plugin, id, value as never);
  };

  const visibleGroups = FORK_VISIBLE_IDS_BY_GROUP.filter((g) => g.ids.some(matches));
  const shownGroups = query ? visibleGroups : visibleGroups.filter((g) => g.group === activeGroup);

  const navBtn = (active: boolean): CSSProperties => ({
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 6,
    width: '100%',
    textAlign: 'left',
    fontSize: 12,
    fontWeight: active ? 600 : 400,
    padding: '7px 10px',
    borderRadius: 6,
    border: 'none',
    cursor: 'pointer',
    color: active ? 'var(--rn-clr-content-primary, #0f172a)' : 'var(--rn-clr-content-secondary, #475569)',
    backgroundColor: active ? 'var(--rn-clr-background-tertiary, #f1f5f9)' : 'transparent',
  });

  return (
    <div
      className="incremental-everything-element"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        boxSizing: 'border-box',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        color: 'var(--rn-clr-content-primary, #0f172a)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '12px 16px',
          borderBottom: '1px solid var(--rn-clr-background-tertiary, #f1f5f9)',
        }}
      >
        <span style={{ fontSize: 15, fontWeight: 700 }}>Incremental Everything — Settings</span>
        <span style={{ fontSize: 11, color: 'var(--rn-clr-content-tertiary, #94a3b8)' }}>
          {modifiedCount} changed from default
        </span>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search settings…"
          style={{
            marginLeft: 'auto',
            fontSize: 12,
            padding: '5px 10px',
            width: 220,
            border: '1px solid var(--rn-clr-border-primary, #cbd5e1)',
            borderRadius: 6,
            backgroundColor: 'var(--rn-clr-background-primary, #fff)',
            color: 'var(--rn-clr-content-primary, #0f172a)',
          }}
        />
      </div>

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {!query && (
          <div
            style={{
              width: 210,
              flexShrink: 0,
              padding: '10px 8px',
              borderRight: '1px solid var(--rn-clr-background-tertiary, #f1f5f9)',
              overflowY: 'auto',
            }}
          >
            {FORK_VISIBLE_IDS_BY_GROUP.map(({ group, ids }) => (
              <button key={group} onClick={() => setActiveGroup(group)} style={navBtn(group === activeGroup)}>
                <span>{groupSpec(group).label}</span>
                <span style={{ fontSize: 10, color: 'var(--rn-clr-content-tertiary, #94a3b8)' }}>
                  {ids.filter(visible).length}
                </span>
              </button>
            ))}
          </div>
        )}

        <div style={{ flex: 1, overflowY: 'auto', padding: '10px 18px 24px' }}>
          {!values ? (
            <div style={{ fontSize: 12, color: 'var(--rn-clr-content-tertiary, #94a3b8)', padding: '20px 0' }}>
              Loading settings…
            </div>
          ) : shownGroups.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--rn-clr-content-tertiary, #94a3b8)', padding: '20px 0' }}>
              No settings match “{search}”.
            </div>
          ) : (
            shownGroups.map(({ group, ids, blocks }) => (
              <div key={group} style={{ marginBottom: 18 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 700 }}>{groupSpec(group).label}</span>
                  {groupSpec(group).helpPath && (
                    <HelpLink
                      path={groupSpec(group).helpPath!}
                      label={groupSpec(group).label}
                    />
                  )}
                </div>
                {groupSpec(group).blurb && (
                  <div
                    style={{
                      fontSize: 12,
                      lineHeight: 1.5,
                      color: 'var(--rn-clr-content-tertiary, #94a3b8)',
                      marginTop: 2,
                    }}
                  >
                    {groupSpec(group).blurb}
                  </div>
                )}
                {(() => {
                  const row = (id: IESettingId) => (
                    <SettingRow
                      key={id}
                      id={id}
                      spec={IE_SETTINGS_SCHEMA[id]}
                      value={values[id]}
                      onChange={(v) => onChange(id, v)}
                      hiddenDependents={hiddenDependentsOf(id, values)}
                    />
                  );
                  // FORK (Deviation 13): optional sub-headings inside a section.
                  // A block whose rows are all filtered out (search, or a
                  // showWhen rule) drops its heading too.
                  if (!blocks) return ids.filter(matches).map(row);
                  return blocks.map((block) => {
                    const shown = (block.ids as IESettingId[]).filter(matches);
                    if (shown.length === 0) return null;
                    return (
                      <div key={block.heading}>
                        <div
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            letterSpacing: '0.04em',
                            textTransform: 'uppercase',
                            color: 'var(--rn-clr-content-tertiary, #94a3b8)',
                            marginTop: 14,
                            marginBottom: 2,
                          }}
                        >
                          {block.heading}
                        </div>
                        {shown.map(row)}
                      </div>
                    );
                  });
                })()}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

renderWidget(IESettingsWidget);
