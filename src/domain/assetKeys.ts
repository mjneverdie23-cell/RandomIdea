/**
 * Browser-side copy of the naming rule in `scripts/lib/assetNames.mjs`.
 *
 * The downloader (plain Node ESM) and the app (bundled TypeScript) can't share
 * a module without extra build configuration, so the rule is duplicated here
 * and `teams.test.ts` imports both and asserts they agree on a spread of real
 * team names. Keep this identical to the script's `assetKey`.
 */

/**
 * Lookup key for a team name: lowercase, alphanumerics only.
 * `Gen.G` -> `geng`, `Anyone's Legend` -> `anyoneslegend`.
 */
export function assetKey(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}
