// lib/phone.ts
// FORK-ONLY (2026-11-14).

/**
 * True in RemNote's phone apps (iPhone, Android phones). Read from the user agent, so it
 * is known before the first render; the plugin's isMobileDeviceKey is set later,
 * asynchronously, and is also true on tablets. RemNote does not run its web app in a
 * phone browser, so a phone user agent means the app. Tablets are not matched: they have
 * the room for the desktop layout.
 */
export const isPhone: boolean = (() => {
  try {
    const ua = navigator.userAgent || '';
    return /iPhone|iPod/.test(ua) || /Android.*Mobile/i.test(ua);
  } catch {
    return false;
  }
})();

/**
 * FORK (2026-11-15, review). The answer row and the queue body import `rn_theme_vars.css`
 * for the phone, where RemNote's colour variables never arrive. On desktop that sheet changes
 * nothing — RemNote's own values outrank it — except for one line: `--rn-clr-border-primary`,
 * which RemNote does not define at all (checked in RemNote 1.30: empty on its own page). So
 * off the phone the import alone gave every `border: 1px solid var(--rn-clr-border-primary)`
 * in those two frames a hairline border it never had — the grey buttons, the Options panel,
 * the offset row — and moved the isolated card's borders off their literal colours.
 *
 * Called once at module load by those two widgets. Off the phone the variable is put back to
 * "not defined": `initial` is a custom property's guaranteed-invalid value, and an inline
 * declaration on the root outranks the sheet. The frames then render as before the import.
 */
export function keepBorderVariableUndefinedOffPhone(): void {
  if (isPhone) return;
  try {
    document.documentElement.style.setProperty('--rn-clr-border-primary', 'initial');
  } catch {
    // no document (a test run): nothing to keep
  }
}
