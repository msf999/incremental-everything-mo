// lib/fork_gates.ts
// FORK-ONLY (Deviation 13). Central switchboard for disabling upstream
// subsystems the fork's owner does not use, without touching upstream's
// registration files.
//
// Mechanism: the SDK exposes registerCommand / registerWidget / registerMenuItem
// / registerCSS as own arrow-function properties on plugin.app, so they can be
// wrapped at runtime. installForkGates() replaces them with versions that
// silently drop any id on the deny-list assembled below from FORK_FEATURES.
// The registrations themselves stay upstream's (menus.ts is byte-identical to
// upstream; commands.ts and widgets.ts carry fork edits of their own — see
// CLAUDE.md's conflict map), so the deny-list never forces an edit there;
// re-enabling a whole subsystem is flipping one boolean here.
//
// HARD RULES (see the fork's maintenance notes, Deviation 13, and the traps recorded
// there): never gate registerPowerup — the CardPriority powerup is read
// unguarded by getInitialPriority during Make-Incremental (T1), and the
// pdfState slot on Incremental/Dismissed stores data that read points and
// dismissal transfer rely on. Storage stays; only UI/commands/CSS are gated.

import type { ReactRNPlugin } from '@remnote/plugin-sdk';
import { WidgetLocation } from '@remnote/plugin-sdk';

/**
 * One boolean per upstream subsystem. true = behave like upstream.
 * All decisions 2026-08-11 by the fork owner; see the fork's maintenance notes.
 */
export const FORK_FEATURES = {
  /** PDF/HTML reader in the queue, highlight toolbar, source popups, PDF
      control panel, reading-position writes. Off = queue always shows the rem. */
  pdfReader: false,
  /** Card-priority UI surface (info bar under flashcards, batch/maintenance
      commands). The engine is already off via enable-flashcard-prioritisation. */
  cardSurface: false,
  /** Priority Shield + Weighted Shield (queue displays, popups, history saves). */
  shields: false,
  /** Study Dashboard (`sdb`): KB-wide reviews/time-per-day aggregates, incl.
      IncRems (computed from rep history on open — works retroactively).
      Restored at the user's request 2026-08-11. */
  studyDashboard: true,
  /** Practiced Queues sidebar tab. */
  practicedQueues: false,
  /** Upstream's queue-toolbar P-chip. Permanently off: the fork ships its own
      (widgets/queue_priority_chip.tsx) which resolves priority the same way the
      queue info bar does, instead of through the disabled card-priority engine
      and an unbounded ancestor walk. Flip only to compare against upstream's. */
  upstreamQueueToolbarPriority: false,
  /** Per-card queue session tracking (feeds Practiced Queues / dashboards). */
  sessionAnalytics: false,
  /** Cloze creation commands (they create flashcards). */
  clozeTools: false,
  /** Heading / outline restructure / listify / text-case editor utilities. */
  outlineTools: false,
  /** Opt+Shift+F floating reference finder. */
  referenceFinder: false,
  /** Ctrl+F7 read points (rem-position bookmarks). */
  readPoints: false,
  /** Video debug surface (viewers stay compiled for data safety). */
  videoSurface: false,
  /**
   * Debug / diagnostics / raw-slot repair commands and widgets.
   *
   * Briefly enabled on 2026-08-15 as insurance against the slot-detachment bug in
   * upstream's two REMNOTE_SUPPORT_*.md reports, then turned back OFF the same day
   * once we actually read what the tooling does. It does not cover this fork's
   * exposure:
   *
   *   - The only real REPAIR is `repairDetachedCardPriorities`, and the
   *     card-priority engine is disabled here — those values are wrong in a
   *     subsystem this fork does not use.
   *   - Detached INCREMENTAL priorities (the ~100% case that would matter) are not
   *     repaired by this tooling at all. `getIncrementalRemFromRem` recovers them
   *     from each Rem's own repetition history on every read, automatically, so a
   *     scan reports them as detached forever while the app shows correct values.
   *   - Dangling Daily Document dates — the half RemNote 1.27.24 did NOT fix — are
   *     not recoverable by anything. The plugin's own `nextRepMs` history stamp is
   *     what saves those schedules, also automatically.
   *
   * So its value here is purely diagnostic, and every question it answers leads to
   * "nothing to do". Re-enable if a FUTURE RemNote change breaks something
   * slot-shaped — `probe-slot-api` and `dump-raw-powerup-slots` are general
   * diagnostics and would be the first thing to reach for.
   *
   * ⚠️ Re-enabling needs a DEV SERVER RESTART, not just a reload: webpack derives
   * its entry exclusions from this deny-list and only reads it at startup. Skipping
   * that gives you a registered widget with no bundle — the popup opens as a blank
   * white rectangle with nothing in the console. That is exactly what happened when
   * this was switched on.
   */
  debugTools: false,
  /** Priority Review Documents (Opt+Shift+R). */
  priorityReviewDocs: false,
  /** Fork-built combined History sidebar tab replacing the three upstream tabs. */
  combinedHistoryTab: true,
  /** The four native-panel mode settings (flashcard prioritisation, performance
      mode, light-on-mobile/web). Off = not registered with RemNote's panel;
      reads fall back to their defaults (false / 'light' / true / true), which
      readRawSetting handles explicitly. Only Hide-in-Queue remains native. */
  nativeModeSettings: false,
  /** The "running in Light Mode" startup toasts. One mode now — no banner. */
  startupModeBanner: false,
  /** "Import Incremental Rems with History" — one-time KB-migration tool. */
  historyImport: false,
  /** Copy/Paste Rem Sources — PDF-workflow helpers (copy also feeds the
      disabled PDF Control Panel's known-rem index). */
  remSourceCopyPaste: false,
  /** Upstream's priority-change history (v1.0.77): a 'priorityChange' entry in the
      rem's Incremental history on every priority edit. Off: setIncRemPriority writes
      the slot only (recordHistory forced false). Option, off — owner decision 2026-10-10. */
  priorityChangeHistory: false,
  /** Localize media (store linked images/audio in RemNote) and Cycle Image Size:
      manual editor utilities. Option, off — owner decision 2026-10-10. */
  mediaTools: false,
  /** Review with Timer: the editor_review / editor_review_timer widgets, the
      review-increm-in-editor command (Ctrl+Shift+E) and the 📝 accordion button.
      Option, off — owner decision 2026-10-10. */
  editorReviewTimer: false,
  /** The queue's "← Back to isolated view" button, floating in the top-right corner of every
      Rem and highlight shown in context. Off — owner decision 2026-10-11 ("I do not see the
      point of it and I do not use it"). The isolated card itself is unchanged: the setting
      still picks which items start in it, and its "View in Context" still leaves it; there is
      just no way back for that item. */
  isolatedViewBackButton: false,
} as const;

/**
 * IE-Settings popup sections hidden by the fork (user decision 2026-08-11:
 * "remove entirely: flashcard prioritisation, performance, mastery drill",
 * then FSRS added in a follow-up; Other was deliberately KEPT visible).
 * Values stay stored; this only filters the popup's rendering (ie_settings.tsx).
 */
export const FORK_HIDDEN_IE_GROUPS: ReadonlySet<string> = new Set([
  'flashcardPriority', // engine permanently off (cardSurface disabled)
  'performance',       // Full Mode retired — the three settings are pinned
  'masteryDrill',      // feature permanently off
  'fsrs',              // card-only stats; the fork isn't used for flashcards
]);

/**
 * Individual IE-Settings rows hidden by the fork, on top of the hidden groups
 * above (user decision 2026-08-12, after an audit of each setting's live
 * consumers). Every one of these has no reachable consumer left; values stay
 * stored and reads still resolve via readRawSetting, so nothing changes
 * behaviourally — the popup just stops offering dead switches.
 */
export const FORK_HIDDEN_IE_SETTINGS: ReadonlySet<string> = new Set([
  'defaultCardPriority',            // flashcard priorities are off
  'display-priority-shield',        // shields disabled (and light-mode-gated anyway)
  'display-weighted-shield',        // ditto
  'display-queue-toolbar-priority', // its only consumer is the denied toolbar widget
  'auto-focus-queue-dashboard',     // focuses Practiced Queues, which is denied
  'remnote-environment',            // only fed the replaced "Open in New Tab" URL
  'hideCardPriorityTag',            // nothing writes CardPriority tags any more (engine off,
                                    // Dismiss writer gated); default is already 'hidden'
]);

/**
 * Fork layout for the IE Settings popup (user decision 2026-08-12): upstream's
 * six remaining sections consolidated into four, grouped by what the user is
 * looking for rather than by which subsystem owns the value. Defined here so
 * upstream's `IE_SETTINGS_SCHEMA` (and every setting's `group` field) stays
 * untouched — the popup reads this layout, falling back to upstream's group
 * specs for anything not listed. Ids not present in this layout are not shown.
 */
export const FORK_IE_GROUPS: Record<string, { label: string; blurb: string }> = {
  general: {
    label: 'General',
    blurb: 'What the queue and the editor show. Display only — except "Hold Back Spoiler IncRems", which changes what the queue serves.',
  },
  priorityScheduling: {
    label: 'Priority & Scheduling',
    blurb: 'How important new items are, and when they come back.',
  },
  advanced: {
    label: 'Advanced',
    blurb: 'Rarely changed. Both take effect after reloading RemNote.',
  },
};

/**
 * Ordered layout: section id → setting ids, in display order.
 *
 * `blocks` optionally splits a section under sub-headings; `ids` stays the flat
 * list (nav counts + search still work off it), and the two must agree — the
 * popup renders blocks when present and falls back to `ids` otherwise.
 */
export const FORK_IE_LAYOUT: ReadonlyArray<{
  group: string;
  ids: string[];
  blocks?: ReadonlyArray<{ heading: string; ids: string[] }>;
}> = [
  {
    // Split by where you see it: the two queue-view settings, then the editor's
    // visual markers (borders, hidden tags, table badges).
    group: 'general',
    ids: [
      'queue-info-bar-mode',
      'queue-toolbar-priority-mode',
      'collapse-queue-top-bar',
      'isolated-queue-view-mode',
      'defer-spoiler-increms',
      'priorityEditorDisplayMode',
      'showLeftBorderForIncRems',
      'showDismissedIndicator',
      'hideDismissedTag',
      'priority-bands-enabled',
    ],
    blocks: [
      {
        heading: 'Queue',
        ids: [
          'queue-info-bar-mode',
          'queue-toolbar-priority-mode',
          'collapse-queue-top-bar',
          'isolated-queue-view-mode',
          // bb758b8 sync: upstream's spoiler protection (holds back an IncRem whose own
          // cards are due). Default OFF here (lib/settings.ts), shown so it can be tried.
          'defer-spoiler-increms',
        ],
      },
      {
        heading: 'Appearance',
        ids: [
          'priorityEditorDisplayMode',
          'showLeftBorderForIncRems',
          'showDismissedIndicator',
          'hideDismissedTag',
          // 2026-10-11: the fork's master switch for priority bands (default off) replaces
          // upstream's badge-only 'showPriorityBandsInTables' row, which is not shown.
          'priority-bands-enabled',
        ],
      },
    ],
  },
  {
    // Priority first, then scheduling. Within Scheduling: Initial Interval (the base
    // both schedulers grow from), then the 'Default Scheduler' switch (Multiplier /
    // Saturating Curve, since bb758b8), then the three parameters — upstream removed
    // the `showWhen` rules, so all three rows always show. The per-type scheduler and
    // initial-interval rows stay out (defaults = the general setting).
    group: 'priorityScheduling',
    ids: [
      'default-priority',
      'priority-step-size',
      'initial-interval',
      'beta-scheduler-enabled',
      'multiplier',
      'beta-first-review-interval',
      'beta-max-interval',
    ],
    blocks: [
      {
        heading: 'Priority',
        ids: ['default-priority', 'priority-step-size'],
      },
      {
        heading: 'Scheduling',
        ids: [
          // Initial Interval first: it applies to BOTH schedulers, so it reads as a
          // property of scheduling itself rather than of the chosen curve.
          'initial-interval',
          'beta-scheduler-enabled',
          'multiplier',
          'beta-first-review-interval',
          'beta-max-interval',
        ],
      },
    ],
  },
  {
    group: 'advanced',
    ids: ['enable-hide-in-queue-integration', 'flashcard_response_time_limit'],
  },
];

type GateGroup = {
  enabled: boolean;
  commands?: string[];
  widgets?: string[];
  menuItems?: string[];
  css?: string[];
};

const GROUPS: GateGroup[] = [
  {
    enabled: FORK_FEATURES.pdfReader,
    commands: [
      'toggle-pdf-highlight-borders',
      'pdf-control-panel',
      'open-source-in-popup',
      'open-source-in-floating',
      // bb758b8 sync: reading-source tooling that arrived with upstream's PDF work
      'open-in-logos',
      'tag-rems-with-images',
      'remove-image-tags',
      'pin-source-quote',
      'ai-transcribe-highlight',
      'restore-highlight-before-ai',
    ],
    widgets: [
      'page-range',
      'highlight_toolbar',
      'pdf_bookmark_popup',
      'pdf_source_popup',
      'pdf_source_floating',
      'image_scan_popup',
      'pin_source_views_popup',
    ],
    menuItems: ['pdf_control_panel_menuitem'],
    css: ['pdf-inc-highlight-styling', 'highlight-priority-band-badges', 'has-image-tag-hide', 'pin-reference-styling'],
  },
  {
    enabled: FORK_FEATURES.readPoints,
    commands: ['set-read-point', 'view-read-points'],
  },
  {
    enabled: FORK_FEATURES.cardSurface,
    commands: [
      'batch-card-priority',
      'update-card-priorities',
      'refresh-card-priority-cache',
      'cleanup-card-priority',
      'sanitize-rogue-card-priority-tags',
      // bb758b8 sync
      'migrate-card-priority-hidden-slot',
      'undo-card-priority-hidden-slot',
      'hideFrontExtrasCmd', // Hide Front Extras: a flashcard-only queue-display tweak
    ],
    // flashcard_repetition_history: the card history popup (Forgetting Curve, FSRS
    // table) — denied 2026-10-10; repetition_history.tsx hides the button that opened it.
    widgets: ['card_info_bar', 'batch_card_priority', 'flashcard_repetition_history'],
    menuItems: ['batch_card_priority_menuitem'],
    css: ['incremental-everything-card-info-bar-dock'],
  },
  {
    enabled: FORK_FEATURES.shields,
    commands: ['open-priority-shield', 'open-weighted-shield'],
    widgets: ['priority_shield_graph', 'weighted_shield_popup', 'weighted_shield_popup_wide'],
    menuItems: ['priority-shield-history-menu-item-id', 'priority_shield_document_menuitem'],
  },
  {
    enabled: FORK_FEATURES.studyDashboard,
    commands: ['open-study-dashboard'],
    widgets: ['study_dashboard'],
  },
  {
    enabled: FORK_FEATURES.practicedQueues,
    widgets: ['practiced_queues'],
  },
  {
    enabled: FORK_FEATURES.upstreamQueueToolbarPriority,
    // queue_beautiful_bar carries the same badge in RemNote's Beautiful queue variant.
    widgets: ['queue_toolbar_priority', 'queue_beautiful_bar'],
    css: ['queue-beautiful-bar'],
  },
  {
    enabled: FORK_FEATURES.clozeTools,
    commands: [
      'create-cloze-deletion',
      'create-cloze-deletion-with-priority',
      // True or False cards (bb758b8 sync): card authoring, so they live with the clozes;
      // their always-on cluster tracker is guarded on this flag in widgets/index.tsx.
      'trueFalseTrueCmd',
      'trueFalseFalseCmd',
      'trueFalseConvertTagsCmd',
      'trueFalseClearCmd',
    ],
    css: ['true-false-cards', 'true-false-cluster-card'],
  },
  {
    enabled: FORK_FEATURES.outlineTools,
    commands: [
      'restructure_outline_by_headings',
      'revert_last_outline_restructure',
      'apply-toc-headings',
      'demote-heading-level',
      'promote-heading-level',
      'revert-last-heading-assign',
      'set-next-heading-level',
      'bulletize-inline-selection',
      'inlinize-detected-list',
      'break-inline-list-to-children',
      'restore-list-rem',
      'text-case-converter',
      'convert-extracted-markup', // bb758b8 sync: PDF-extraction markup clean-up
    ],
    widgets: [
      'outline_restructure_preview',
      'outline_restructure_undo',
      'heading_assign_preview',
      'heading_assign_undo',
    ],
  },
  {
    enabled: FORK_FEATURES.referenceFinder,
    commands: ['find-insert-reference'],
    widgets: ['reference_finder'],
  },
  {
    enabled: FORK_FEATURES.videoSurface,
    commands: ['debug-video'],
    widgets: ['video_debug'],
  },
  {
    enabled: FORK_FEATURES.debugTools,
    commands: [
      'debug-incremental-everything',
      'probe-slot-api',
      'dump-raw-powerup-slots',
      'test-console-function',
      'jump-to-rem-by-id',
      'test-mobile-detection',
      'debug_clear_flashcard_history',
      // bb758b8 sync: flashcard maintenance + diagnostics (owner: clutter)
      'card-enablement-audit',
      'delete-empty-ecd-rems',
      'debug-probe-ecd',
      'toggle-priority-band-logging',
    ],
    widgets: ['debug', 'jump_to_rem_input', 'card_enablement_audit', 'empty_ecd_popup'],
    menuItems: ['card_enablement_audit_menuitem'],
  },
  {
    enabled: FORK_FEATURES.priorityReviewDocs,
    // bb758b8 sync: upstream rewrote this as the 'Priority Queue' (Learn / clean) and
    // added a sidebar hub whose main button drives it, plus queue cooling that the
    // engine depends on — all of it is this subsystem. Guards in widgets/index.tsx and
    // register/events.ts use the same flag.
    commands: ['create-priority-review', 'clean-priority-review', 'practice-priority-queue-kb', 'ie_show_plugin_hub'],
    // review_document_creator was deleted upstream (5b5ab31, bb758b8 sync); its successor
    // is priority_queue_popup. webpack.config.js asserts every denied widget id has a
    // source file, so a stale id here would silently rebuild ALL widget bundles.
    widgets: ['priority_queue_popup', 'prd_cleanup_popup', 'priority_review_graph', 'plugin_hub', 'onboarding_tips'],
    menuItems: ['create_priority_review_menuitem', 'create_priority_review_queue_menuitem'],
    css: ['sidebar-end-padding', 'learn-new-cooling-mask'],
  },
  {
    // The three upstream history tabs are replaced by the fork's combined tab.
    enabled: !FORK_FEATURES.combinedHistoryTab,
    widgets: ['incremental_history', 'flashcard_history', 'rem_history'],
  },
  {
    enabled: FORK_FEATURES.historyImport,
    // + transfer-increm-to-parent (bb758b8 sync): moves an IncRem's data to its parent.
    commands: ['import-incremental-history', 'transfer-increm-to-parent'],
    widgets: ['import_increm_history'],
  },
  {
    enabled: FORK_FEATURES.remSourceCopyPaste,
    commands: ['copy-rem-sources', 'paste-rem-sources'],
  },
  {
    enabled: FORK_FEATURES.mediaTools,
    commands: ['localize-external-media', 'localize-external-media-tree', 'cycle-image-size'],
  },
  {
    enabled: FORK_FEATURES.editorReviewTimer,
    commands: ['review-increm-in-editor'],
    widgets: ['editor_review', 'editor_review_timer'],
  },
];

const denied = (key: Exclude<keyof GateGroup, 'enabled'>): Set<string> =>
  new Set(GROUPS.filter((g) => !g.enabled).flatMap((g) => g[key] ?? []));

// Native RemNote-panel settings the fork removes (Deviation 13). Their reads
// fall back to defaults via readRawSetting's try/catch — which are exactly the
// fork's desired values: prioritisation off, performance 'light', light-mode
// auto-switching on.
export const DENIED_NATIVE_SETTINGS: ReadonlySet<string> = new Set(
  FORK_FEATURES.nativeModeSettings
    ? []
    : [
        'enable-flashcard-prioritisation',
        'performanceMode',
        'always-use-light-mode-on-mobile',
        'alwaysUseLightModeOnWeb',
      ]
);

/**
 * Fork overrides applied to upstream command registrations before the
 * "Incremental: " prefix. Keyed by command id (stable across upstream wording
 * changes) so a rename upstream cannot silently drop ours.
 *
 * - `name`        — the prefix makes upstream's own "Incremental"/"Inc Rem"
 *                   wording stutter; several names also described features this
 *                   fork disabled, or were longer than an omnibar row.
 * - `description` — corrections where upstream's text describes flashcard
 *                   behaviour this fork disabled, or states a wrong default.
 * - `keyboardShortcut` — defaults moved off Chrome DevTools bindings
 *                   (Ctrl+Shift+J = console, Ctrl+Shift+I = inspector), which
 *                   matter because this fork is used in a browser tab. Both stay
 *                   rebindable in RemNote → Settings → Shortcuts.
 */
const FORK_COMMAND_OVERRIDES: Record<
  string,
  // `keyboardShortcut: null` REMOVES the default binding (2026-10-10).
  { name?: string; description?: string; keyboardShortcut?: string | null }
> = {
  // De-stutter (the prefix already says "Incremental")
  // FORK (2026-10-10): Opt+X now runs the make/dismiss TOGGLE ('toggle-incremental',
  // register/commands.ts); this explicit command keeps its omnibar entry, unbound.
  'incremental-everything': { name: 'Extract / Tag Rem', keyboardShortcut: null },
  'open-incremental-editor': { name: 'Open Editor' },
  // FORK (2026-10-10): Ctrl+D unbound — one shortcut (Opt+X) toggles make/dismiss.
  'dismiss-inc-rem': { name: 'Dismiss Rem', keyboardShortcut: null },
  'reschedule-incremental': { name: 'Reschedule Rem' },
  'open-inc-rem-main-view': { name: 'Open Rems Table' },
  // Say what it does, not how it's implemented
  'review-increm-in-editor': {
    name: 'Review in Editor (Timer)',
    // Ctrl+Shift+J is Chrome's DevTools console.
    keyboardShortcut: 'ctrl+shift+e',
  },
  'preserve-history-and-remove': { name: 'Delete Rem, Keep Study History' },
  'cancel-no-inc-rem-timer': { name: 'Cancel Queue Pause Timer' },
  'quick-increase-priority': {
    name: 'Make Less Important',
    description:
      'Raises the priority number by the Priority Step Size (default 5), making the rem LESS important.',
  },
  'quick-decrease-priority': {
    name: 'Make More Important',
    description:
      'Lowers the priority number by the Priority Step Size (default 5), making the rem MORE important.',
  },
  removeParentCmd: { name: 'Remove Parent from Card' },
  removeGrandparentCmd: { name: 'Remove Grandparent from Card' },
  // Drop a disabled feature from the label; clarify scope
  'refresh-priority-bands': { name: 'Refresh Priority Badges (Tables)' },
  'open-sorting-criteria': { name: 'Open Queue Sorting Criteria' },
  'next-in-queue-alt': { name: 'Next Item in Queue (alt shortcut)' },
  // Flashcard priorities are disabled in this fork.
  'set-priority-light': { description: 'Instant popup to set an Incremental Rem\'s priority.' },
  // Ctrl+Shift+I is Chrome's DevTools inspector.
  'toggle-ignore-tag': { keyboardShortcut: 'ctrl+shift+g' },
};

export function installForkGates(plugin: ReactRNPlugin) {
  // FORK (2026-08-14, bug-hunt #49): install once. Nothing untangles these
  // wrappers (there is no onDeactivate teardown), so a second call would wrap the
  // wrappers — permanently, for all six methods. It happens to be harmless today
  // only because every transform is idempotent, and that is luck: add one command
  // override whose name does not re-derive to itself and a double install
  // silently double-prefixes. HMR in `npm run dev` is the realistic trigger.
  const gatesHost = plugin.app as any;
  if (gatesHost.__forkGatesInstalled) {
    console.log('[ForkGates] already installed — skipping');
    return;
  }
  gatesHost.__forkGatesInstalled = true;
  const deniedCommands = denied('commands');
  const deniedWidgets = denied('widgets');
  const deniedMenuItems = denied('menuItems');
  const deniedCSS = denied('css');

  const app: any = plugin.app;
  const settingsNs: any = plugin.settings;

  // Drop denied native settings at registration; readRawSetting's fallback
  // supplies their defaults to every reader.
  for (const method of [
    'registerBooleanSetting',
    'registerNumberSetting',
    'registerStringSetting',
    'registerDropdownSetting',
  ] as const) {
    const orig = settingsNs[method];
    if (typeof orig !== 'function') continue;
    settingsNs[method] = async (opts: any) => {
      if (opts?.id && DENIED_NATIVE_SETTINGS.has(opts.id)) return;
      return orig(opts);
    };
  }

  const origRegisterCommand = app.registerCommand;
  app.registerCommand = async (command: any) => {
    if (command?.id && deniedCommands.has(command.id)) return;
    // FORK: apply per-command overrides (name / description / shortcut), then
    // prefix "Incremental: " so the plugin's whole command set is discoverable
    // by typing one word.
    if (typeof command?.name === 'string' && command.name.length > 0) {
      const ov = (command.id && FORK_COMMAND_OVERRIDES[command.id]) || {};
      const bare = (ov.name ?? command.name).replace(/^Incremental (?:Everything|RemNote):\s*/i, '');
      command = {
        ...command,
        name: bare.startsWith('Incremental: ') ? bare : `Incremental: ${bare}`,
        ...(ov.description ? { description: ov.description } : {}),
        ...(ov.keyboardShortcut ? { keyboardShortcut: ov.keyboardShortcut } : {}),
      };
      // FORK (2026-10-10): an explicit `null` removes upstream's default binding.
      if (ov.keyboardShortcut === null) delete command.keyboardShortcut;
    }
    return origRegisterCommand(command);
  };

  const origRegisterWidget = app.registerWidget;
  app.registerWidget = async (fileName: string, location: any, options: any) => {
    if (deniedWidgets.has(fileName)) return;
    return origRegisterWidget(fileName, location, options);
  };

  const origRegisterMenuItem = app.registerMenuItem;
  app.registerMenuItem = async (menuItem: any) => {
    if (menuItem?.id && deniedMenuItems.has(menuItem.id)) return;
    return origRegisterMenuItem(menuItem);
  };

  const origRegisterCSS = app.registerCSS;
  app.registerCSS = async (id: string, css: string) => {
    if (deniedCSS.has(id)) return;
    return origRegisterCSS(id, css);
  };

  console.log(
    `[ForkGates] installed — denying ${deniedCommands.size} commands, ` +
      `${deniedWidgets.size} widgets, ${deniedMenuItems.size} menu items, ${deniedCSS.size} CSS blocks, ` +
      `${DENIED_NATIVE_SETTINGS.size} native settings`
  );
}

/**
 * The single row the fork leaves in RemNote's own plugin-settings panel: an
 * inert one-option dropdown pointing at the plugin's settings window (the panel
 * has no text-only row type, so a control must carry the text). Called from
 * index.tsx after registerPluginSettings.
 */
export async function registerForkSettingsSignpost(plugin: ReactRNPlugin) {
  try {
    await plugin.settings.registerDropdownSetting({
      id: 'fork-more-settings-pointer',
      title: 'Settings have moved',
      description:
        'All of this plugin\'s settings live in its own settings window. ' +
        'Open it from the omnibar: "Incremental: Settings" (or type: is).',
      defaultValue: 'info',
      options: [
        { key: 'info', label: 'Open via omnibar → "Incremental: Settings" (is)', value: 'info' },
      ],
    });
  } catch (e) {
    console.warn('[ForkGates] settings signpost registration failed:', e);
  }
}

/** Fork-only widget registrations (called after upstream's registerWidgets). */
export async function registerForkWidgets(plugin: ReactRNPlugin) {
  // FORK (Deviation 14): the queue toolbar's P-chip, replacing upstream's denied
  // `queue_toolbar_priority`. Registered unconditionally — its own setting
  // (queue-toolbar-priority-mode) decides whether it renders anything.
  await plugin.app.registerWidget('queue_priority_chip', WidgetLocation.QueueToolbar, {
    dimensions: { width: 'auto', height: 'auto' },
  });

  // FORK (Deviation 14): info bar for non-IncRem queue items. FlashcardUnder
  // mounts for every queue item; the widget itself bails out for IncRems, whose
  // bar is drawn by answer_buttons (FlashcardAnswerButtons is Plugin-filtered
  // and so can never render for a flashcard).
  await plugin.app.registerWidget('queue_info_bar', WidgetLocation.FlashcardUnder, {
    dimensions: { width: '100%', height: 'auto' },
  });

  if (FORK_FEATURES.combinedHistoryTab) {
    await plugin.app.registerWidget('history_sidebar', WidgetLocation.RightSidebar, {
      dimensions: { width: '100%', height: 'auto' },
      widgetTabIcon: 'https://cdn-icons-png.flaticon.com/512/3626/3626838.png',
      widgetTabTitle: 'History',
    });
  }
}
