// lib/action_guard.ts
// FORK-ONLY (2026-08-14, bug-hunt issues #5/#6). Drop-if-in-flight guard for the
// queue actions that mutate a rem and then destroy the widget.
//
// NOT withQueueMutex (lib/mutex.ts): that SERIALISES — it chains the second call
// after the first and still runs it. For a double-press that is exactly wrong;
// the second press must be discarded, not queued.
//
// Why this matters, concretely: every queue action performs several sequential
// IPC round trips before its destructive step, and nothing disables the control
// meanwhile. A second press re-enters with the same captured state. For Dismiss
// that made `transferToDismissed` take its `alreadyDismissed` merge branch and
// append the rem's ENTIRE history a second time — persisted to the rem, with a
// duplicate 'dismissed' marker — while `removeCurrentCardFromQueue` fired twice
// and silently consumed the following card unreviewed.
//
// Scope: one flag per JS context. The commands (main plugin bundle) and the
// answer buttons (their own widget iframe) therefore guard independently — a
// module-level flag cannot span iframes. That covers repeated presses of the
// same control, which is the realistic case; it does not cover pressing Ctrl+D
// while clicking Dismiss. Guarding across contexts would need session storage,
// which is itself racy, and is not worth it for that.

let inFlight = false;

/**
 * Runs `fn` unless a guarded action is already running in this context.
 *
 * @returns `fn`'s result, or `undefined` when the call was dropped.
 */
export async function runQueueActionOnce<T>(fn: () => Promise<T>): Promise<T | undefined> {
  if (inFlight) {
    console.log('[ActionGuard] dropped a re-entrant queue action');
    return undefined;
  }
  inFlight = true;
  try {
    return await fn();
  } finally {
    // Deliberately unconditional. Several of these actions destroy the widget
    // sandbox on their way out, so this may simply never run — which is fine,
    // the context is gone. What must not happen is the flag sticking `true` in a
    // context that survives, e.g. when the action throws.
    inFlight = false;
  }
}
