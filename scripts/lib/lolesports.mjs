/**
 * Read a live pro game off the LoL Esports feeds and turn it into the match
 * JSON the Predictor's "Paste matches" box accepts.
 *
 * Pure: every function here takes parsed JSON and returns plain values. The
 * network lives in `scripts/lolesports-draft.mjs`, so this file can be tested
 * against recorded responses.
 *
 * The feeds are the ones lolesports.com itself uses. They are not an official,
 * documented API: the shapes below are what the site receives, read
 * defensively, and they can change without notice.
 *
 *   esports-api.lolesports.com/persisted/gw/getLive          what is live now
 *   esports-api.lolesports.com/persisted/gw/getSchedule      recent and upcoming
 *   esports-api.lolesports.com/persisted/gw/getEventDetails  games in one match
 *   feed.lolesports.com/livestats/v1/window/<gameId>         champions + gold
 */

export const API_BASE = 'https://esports-api.lolesports.com/persisted/gw';
export const FEED_BASE = 'https://feed.lolesports.com/livestats/v1';
/**
 * The key lolesports.com sends with every request from the browser. It is
 * public — it ships in the site's own JavaScript — and it is the one community
 * tools use. Overridable with `LOLESPORTS_API_KEY` if it is ever rotated.
 */
export const API_KEY = '0TvQnueqKa5mxJntVWt0w4LpLfEkrV1Ta8rQBb9Z';

/* ------------------------------------------------------------------ */
/* Names                                                               */
/* ------------------------------------------------------------------ */

/** Lowercase alphanumerics — the same rule the app uses to match team names. */
export function nameKey(name) {
  return String(name ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Display names for Data Dragon keys that aren't just the name with its
 * spaces and apostrophes removed. The feed reports champions by key
 * (`MonkeyKing`, `Chogath`); the app accepts either, but a person reading the
 * output should see `Wukong` and `Cho'Gath`.
 */
const CHAMPION_NAMES = {
  AurelionSol: 'Aurelion Sol',
  Belveth: "Bel'Veth",
  Chogath: "Cho'Gath",
  DrMundo: 'Dr. Mundo',
  JarvanIV: 'Jarvan IV',
  Kaisa: "Kai'Sa",
  Khazix: "Kha'Zix",
  KogMaw: "Kog'Maw",
  KSante: "K'Sante",
  Leblanc: 'LeBlanc',
  MonkeyKing: 'Wukong',
  Nunu: 'Nunu & Willump',
  RekSai: "Rek'Sai",
  Renata: 'Renata Glasc',
  Velkoz: "Vel'Koz",
};

export function championDisplayName(key) {
  const text = String(key ?? '').trim();
  if (!text) return '';
  if (CHAMPION_NAMES[text]) return CHAMPION_NAMES[text];
  // `MissFortune` -> `Miss Fortune`, `TwistedFate` -> `Twisted Fate`.
  return text.replace(/([a-z])([A-Z])/g, '$1 $2');
}

/**
 * League slugs the app's competition list knows under a different spelling.
 * Anything else is passed through by name and resolved (or flagged) by the
 * app's own importer.
 */
const LEAGUE_NAMES = {
  lck: 'LCK',
  lck_challengers_league: 'LCK CL',
  lpl: 'LPL',
  lec: 'LEC',
  lcs: 'LCS',
  lcp: 'LCP',
  worlds: 'Worlds',
  msi: 'MSI',
  first_stand: 'First Stand',
};

export function competitionFor(league) {
  if (!league) return null;
  return LEAGUE_NAMES[league.slug] ?? league.name ?? null;
}

/** Whether a league matches any of the user's filters, by slug or by name. */
export function leagueMatches(league, filters) {
  if (!filters || filters.length === 0) return true;
  const keys = [nameKey(league?.slug), nameKey(league?.name), nameKey(competitionFor(league))];
  return filters.some((filter) => keys.includes(nameKey(filter)));
}

/* ------------------------------------------------------------------ */
/* Your data's team names                                              */
/* ------------------------------------------------------------------ */

/**
 * Team names from the app's data folder (`data/<year>.json`), newest file
 * first, so a pulled team can be renamed to the spelling your records use.
 */
export function teamsFromSeasons(seasons) {
  const seen = new Map();
  for (const season of seasons) {
    for (const game of season?.games ?? []) {
      for (const side of [game?.blue, game?.red]) {
        const name = side?.teamName;
        if (!name || seen.has(nameKey(name))) continue;
        seen.set(nameKey(name), { name, tag: side.tag ?? null, competition: game.competition ?? null });
      }
    }
  }
  return [...seen.values()];
}

/**
 * The name your data uses for a team LoL Esports calls `name` (code `code`).
 *
 * In order: your alias file, the same name ignoring case and punctuation, the
 * team code against your data's tags, then one name containing the other. Each
 * later step only counts when exactly one team fits, and the step used is
 * returned so a guess is never passed off as a match.
 */
export function snapTeamName(name, code, known, aliases = {}) {
  const alias = Object.entries(aliases).find(([from]) => nameKey(from) === nameKey(name));
  if (alias) return { name: alias[1], via: 'alias' };
  if (!known || known.length === 0) return { name, via: null };

  const key = nameKey(name);
  const exact = known.find((team) => nameKey(team.name) === key);
  if (exact) return { name: exact.name, via: exact.name === name ? 'exact' : 'spelling' };

  const byTag = known.filter((team) => code && team.tag && nameKey(team.tag) === nameKey(code));
  if (byTag.length === 1) return { name: byTag[0].name, via: 'code' };

  const partial = known.filter((team) => {
    const other = nameKey(team.name);
    return key.length >= 3 && other.length >= 3 && (other.includes(key) || key.includes(other));
  });
  if (partial.length === 1) return { name: partial[0].name, via: 'partial' };

  return { name, via: null };
}

/* ------------------------------------------------------------------ */
/* Reading the feeds                                                   */
/* ------------------------------------------------------------------ */

function summarizeEvent(event) {
  const match = event?.match;
  if (!match || event.type !== 'match') return null;
  return {
    matchId: String(match.id ?? event.id),
    startTime: event.startTime ?? null,
    state: event.state ?? null,
    blockName: event.blockName ?? null,
    league: event.league ?? null,
    bestOf: match.strategy?.count ?? null,
    teams: (match.teams ?? []).map((team) => ({
      name: team.name,
      code: team.code ?? null,
      wins: team.result?.gameWins ?? 0,
      outcome: team.result?.outcome ?? null,
    })),
  };
}

/** Matches in a `getLive` response, filtered to the given leagues. */
export function liveMatches(json, leagues) {
  return (json?.data?.schedule?.events ?? [])
    .map(summarizeEvent)
    .filter((event) => event !== null && leagueMatches(event.league, leagues));
}

/** Completed matches in a `getSchedule` response, newest first. */
export function recentMatches(json, leagues, limit = 10) {
  return (json?.data?.schedule?.events ?? [])
    .map(summarizeEvent)
    .filter(
      (event) => event !== null && event.state === 'completed' && leagueMatches(event.league, leagues),
    )
    .sort((a, b) => String(b.startTime).localeCompare(String(a.startTime)))
    .slice(0, limit);
}

/** The match in a `getEventDetails` response, flattened. */
export function readEventDetails(json) {
  const event = json?.data?.event;
  if (!event?.match) return null;
  return {
    matchId: String(event.id),
    league: event.league ?? null,
    blockName: event.blockName ?? null,
    bestOf: event.match.strategy?.count ?? null,
    teams: (event.match.teams ?? []).map((team) => ({
      id: String(team.id),
      name: team.name,
      code: team.code ?? null,
      wins: team.result?.gameWins ?? 0,
    })),
    games: (event.match.games ?? []).map((game) => ({
      id: String(game.id),
      number: game.number,
      state: game.state,
      sides: Object.fromEntries((game.teams ?? []).map((team) => [team.side, String(team.id)])),
    })),
  };
}

/**
 * The game to read: the one asked for, else the one being played, else the
 * last one finished.
 */
export function chooseGame(details, number = null) {
  if (!details) return null;
  if (number !== null) return details.games.find((game) => game.number === number) ?? null;
  return (
    details.games.find((game) => game.state === 'inProgress') ??
    [...details.games].reverse().find((game) => game.state === 'completed') ??
    null
  );
}

const ROLE_KEYS = { top: 'top', jungle: 'jungle', mid: 'mid', bottom: 'bot', bot: 'bot', support: 'support' };
const ROLE_ORDER = ['top', 'jungle', 'mid', 'bot', 'support'];

function readTeam(metadata, code) {
  const picks = {};
  const players = {};
  for (const participant of metadata?.participantMetadata ?? []) {
    const role = ROLE_KEYS[String(participant.role ?? '').toLowerCase()];
    if (!role) continue;
    picks[role] = championDisplayName(participant.championId);
    // The feed prefixes summoner names with the team code: "T1 Faker".
    const summoner = String(participant.summonerName ?? '');
    players[role] = code && summoner.startsWith(`${code} `) ? summoner.slice(code.length + 1) : summoner;
  }
  return { teamId: metadata?.esportsTeamId ? String(metadata.esportsTeamId) : null, picks, players };
}

/**
 * Champions, players and the latest score line from a livestats window.
 * Returns `null` while the game hasn't loaded — the feed has no draft until then.
 */
export function readWindow(json, codes = {}) {
  const meta = json?.gameMetadata;
  if (!meta?.blueTeamMetadata || !meta?.redTeamMetadata) return null;
  const blue = readTeam(meta.blueTeamMetadata, codes[meta.blueTeamMetadata.esportsTeamId]);
  const red = readTeam(meta.redTeamMetadata, codes[meta.redTeamMetadata.esportsTeamId]);
  if (Object.keys(blue.picks).length === 0 && Object.keys(red.picks).length === 0) return null;

  const frames = json.frames ?? [];
  const last = frames[frames.length - 1];
  const live = last
    ? {
        at: last.rfc460Timestamp ?? null,
        state: last.gameState ?? null,
        gold: [last.blueTeam?.totalGold ?? null, last.redTeam?.totalGold ?? null],
        kills: [last.blueTeam?.totalKills ?? null, last.redTeam?.totalKills ?? null],
        towers: [last.blueTeam?.towers ?? null, last.redTeam?.towers ?? null],
      }
    : null;

  return { patch: meta.patchVersion ?? null, blue, red, live };
}

/* ------------------------------------------------------------------ */
/* The paste                                                           */
/* ------------------------------------------------------------------ */

/**
 * One entry for the Predictor's paste box, plus anything worth a warning.
 *
 * Deliberately no winner, like every paste: this is what a predictor would know
 * before the game. The series score is only filled for a game in progress,
 * where the feed's running score is exactly the score before it; for a finished
 * game the feed doesn't say who won the earlier games.
 */
export function buildPasteMatch({ details, game, draft, startTime = null, blockName = null, known = [], aliases = {} }) {
  const warnings = [];
  const byId = Object.fromEntries(details.teams.map((team) => [team.id, team]));

  const side = (which) => {
    const teamId = draft[which].teamId ?? game.sides[which];
    const team = byId[teamId];
    if (!team) {
      warnings.push(`${which} side: team ${teamId ?? '?'} is not in this match.`);
      return { team: null, snapped: null, source: null };
    }
    const snapped = snapTeamName(team.name, team.code, known, aliases);
    if (known.length > 0 && snapped.via === null) {
      warnings.push(
        `"${team.name}" is not a team in your data — rename it in the app, or add it to scripts/lolesports-aliases.json.`,
      );
    } else if (snapped.via === 'code' || snapped.via === 'partial') {
      warnings.push(`"${team.name}" read as "${snapped.name}" (by ${snapped.via === 'code' ? 'team code' : 'partial name'}) — check it.`);
    }
    return { team, snapped: snapped.name, source: team };
  };

  const blue = side('blue');
  const red = side('red');

  for (const which of ['blue', 'red']) {
    const missing = ROLE_ORDER.filter((role) => !draft[which].picks[role]);
    if (missing.length > 0) warnings.push(`${which} side: no champion for ${missing.join(', ')}.`);
  }

  const bestOf = details.bestOf;
  const match = {
    id: `lolesports:${game.id}`,
    date: startTime ? String(startTime).slice(0, 10) : new Date().toISOString().slice(0, 10),
    competition: competitionFor(details.league),
    stage: blockName ?? details.blockName ?? undefined,
    series: bestOf ? `BO${bestOf}` : undefined,
    game: game.number,
  };
  if (game.state === 'inProgress' && blue.team && red.team) {
    match.score = [blue.team.wins, red.team.wins];
  } else if (game.number > 1) {
    warnings.push(`Game ${game.number} is finished, so the series score before it isn't in the feed — set it in the app.`);
  }
  match.blue = { team: blue.snapped, ...orderPicks(draft.blue.picks) };
  match.red = { team: red.snapped, ...orderPicks(draft.red.picks) };

  return { match, warnings };
}

function orderPicks(picks) {
  return Object.fromEntries(ROLE_ORDER.filter((role) => picks[role]).map((role) => [role, picks[role]]));
}

/** The paste box text for one or more matches. */
export function pasteText(matches) {
  return JSON.stringify({ matches }, null, 2);
}
