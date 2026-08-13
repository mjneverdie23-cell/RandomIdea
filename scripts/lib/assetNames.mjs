/**
 * Naming rules shared by the downloader and the app.
 *
 * `src/domain/assetKeys.ts` re-implements `assetKey` for the browser bundle;
 * `src/domain/teams.test.ts` asserts the two stay in agreement. Keep this
 * function trivial so that guarantee is easy to hold.
 */

/**
 * Lookup key for a team name: lowercase, alphanumerics only.
 * `Gen.G` -> `geng`, `Anyone's Legend` -> `anyoneslegend`, `100 Thieves` -> `100thieves`.
 */
export function assetKey(name) {
  return String(name)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * On-disk file name for a team logo — readable in a directory listing, unlike
 * the lookup key. The app never derives this; it reads it from the manifest.
 * `Gen.G` -> `gen-g`, `100 Thieves` -> `100-thieves`.
 */
export function teamFileSlug(name) {
  return String(name)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['’`]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
