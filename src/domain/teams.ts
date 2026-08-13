/**
 * Team identity: logo lookup with a monogram fallback.
 *
 * Logos are optional. `npm run assets` fetches them from Leaguepedia into
 * `public/assets/teams/`; without that step every team simply renders its
 * derived tag, which is why nothing in the UI branches on "has logo" beyond
 * choosing between an `<img>` and text.
 */

import { assetKey } from './assetKeys.ts';
import { localTeamLogo } from '../assets/manifest.ts';

/**
 * Local logo path for a team name, or `null` when none was downloaded.
 *
 * Falls back to progressively shorter forms of the name so that
 * `Hanwha Life Esports` still matches a logo stored as `Hanwha Life`, and
 * `Gen.G Esports` matches `Gen.G`.
 */
export function teamLogoUrl(teamName: string): string | null {
  const direct = localTeamLogo(assetKey(teamName));
  if (direct) return direct;

  const withoutSuffix = teamName.replace(
    /\s+(esports?|e-sports?|gaming|team|club)\s*$/i,
    '',
  );
  if (withoutSuffix !== teamName) {
    const trimmed = localTeamLogo(assetKey(withoutSuffix));
    if (trimmed) return trimmed;
  }
  return null;
}

export { assetKey };
