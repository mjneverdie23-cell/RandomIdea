/**
 * State that belongs to one tab, but still outlives the browser closing.
 *
 * The predictor's draft and match queue are a *working document*, not shared
 * reference data, and `localStorage` is per-origin rather than per-tab. Two
 * tabs open on two simultaneous series therefore wrote the same two keys, last
 * writer won, and whichever tab reloaded next came back holding the other tab's
 * series — one composition silently destroyed by the other.
 *
 * `sessionStorage` has exactly the right lifetime for the live copy: private to
 * one tab, and it survives a reload. What it does not survive is closing the
 * tab, and the draft is documented as surviving a closed browser. So both are
 * written, and reads prefer the tab's own copy:
 *
 *   write   sessionStorage (this tab)  +  localStorage (most recent, any tab)
 *   read    sessionStorage first, falling back to localStorage
 *
 * A tab that has written anything is then immune to every other tab: its own
 * copy always answers the read. A freshly opened tab has no copy yet and picks
 * up the last-saved one, which is the wanted behaviour for reopening the app —
 * and harmless for a second concurrent tab, because inheriting a starting point
 * is not the same as overwriting the first tab's work.
 *
 * Every access is wrapped: private browsing, a full quota and storage disabled
 * by policy all throw rather than return null, and persistence here is a
 * convenience — the session keeps working without it.
 */

/** The tab's own copy, then the shared most-recent one. */
export function readTabScoped(key: string): string | null {
  try {
    const own = sessionStorage.getItem(key);
    if (own !== null) return own;
  } catch {
    // No sessionStorage — fall through to the shared copy.
  }
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Write both copies.
 *
 * The `localStorage` mirror is deliberately overwritten by whichever tab saved
 * most recently. Nothing reads it while a tab has its own copy, so it only
 * decides where a *new* tab starts.
 */
export function writeTabScoped(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // Persisting is a convenience; the value still works for this session.
  }
  try {
    localStorage.setItem(key, value);
  } catch {
    // Same.
  }
}

/**
 * Forget both copies.
 *
 * Clearing the shared copy cannot strand another tab: that tab reads its own
 * `sessionStorage` entry first, and still has one.
 */
export function clearTabScoped(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // Nothing further to clean up.
  }
  try {
    localStorage.removeItem(key);
  } catch {
    // Nothing further to clean up.
  }
}
