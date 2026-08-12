/**
 * Synthetic development dataset.
 *
 * The app ships with no real match data. This module generates a plausible
 * Oracle's Elixir-shaped CSV so every screen is exercisable before a real
 * export is imported — and, importantly, so the demo data travels through the
 * exact same parse -> ingest -> validate path as a real file. There is no
 * separate "demo mode" branch anywhere downstream.
 *
 * The games are invented. Team names are real organizations and player names
 * are drawn from real regional player pools so the draft screen reads
 * naturally, but the rosters are illustrative and none of the results
 * happened. Every game is flagged `demo: true` and the UI says so wherever the
 * dataset is used.
 */

import { createRng, type Rng } from '../quiz/rng.ts';
import { ingestRows } from './ingest.ts';
import { parseCsvText } from './parseCsv.ts';
import type { Dataset } from '../domain/types.ts';

export const DEMO_SEED = 'draftcall-demo-v1';

interface RosterTemplate {
  team: string;
  players: [string, string, string, string, string];
}

/** Illustrative rosters — not an accurate record of any season's line-ups. */
const LCK_TEAMS: RosterTemplate[] = [
  { team: 'T1', players: ['Doran', 'Oner', 'Faker', 'Gumayusi', 'Keria'] },
  { team: 'Gen.G', players: ['Kiin', 'Canyon', 'Chovy', 'Peyz', 'Duro'] },
  { team: 'Hanwha Life Esports', players: ['Zeus', 'Peanut', 'Zeka', 'Viper', 'Delight'] },
  { team: 'Dplus KIA', players: ['Siwoo', 'Lucid', 'ShowMaker', 'Aiming', 'BeryL'] },
  { team: 'KT Rolster', players: ['PerfecT', 'Cuzz', 'Bdd', 'deokdam', 'Way'] },
  { team: 'Nongshim RedForce', players: ['Kingen', 'GIDEON', 'Fisher', 'Jiwoo', 'Lehends'] },
  { team: 'BNK FearX', players: ['Clear', 'Raptor', 'VicLa', 'Diable', 'Kellin'] },
  { team: 'OKSavingsBank BRION', players: ['Morgan', 'Willer', 'Karis', 'Teddy', 'Pollu'] },
];

const LPL_TEAMS: RosterTemplate[] = [
  { team: 'Bilibili Gaming', players: ['Bin', 'Xun', 'knight', 'Elk', 'ON'] },
  { team: 'JD Gaming', players: ['Xiaoxu', 'Junjia', 'Hongq', 'GALA', 'Vampire'] },
  { team: 'Top Esports', players: ['Wayward', 'Tian', 'Creme', 'JackeyLove', 'Crisp'] },
  { team: 'Weibo Gaming', players: ['Breathe', 'Tarzan', 'Xiaohu', 'Light', 'Hang'] },
  { team: 'LNG Esports', players: ['Zika', 'Weiwei', 'Scout', 'Wako', 'Zhuo'] },
  { team: 'Invictus Gaming', players: ['TheShy', 'Tianzhen', 'Rookie', 'Ahn', 'Wink'] },
  { team: 'FunPlus Phoenix', players: ['Xiaolaohu', 'Milkyway', 'Care', 'Ueno', 'Junjia'] },
  { team: 'Anyone’s Legend', players: ['Flandre', 'Tarzan', 'Shanks', 'Hope', 'Kael'] },
];

const LEC_TEAMS: RosterTemplate[] = [
  { team: 'G2 Esports', players: ['BrokenBlade', 'Yike', 'Caps', 'Hans Sama', 'Labrov'] },
  { team: 'Fnatic', players: ['Oscarinin', 'Razork', 'Humanoid', 'Noah', 'Jun'] },
  { team: 'MAD Lions KOI', players: ['Myrwn', 'Elyoya', 'Jojopyun', 'Supa', 'Alvaro'] },
  { team: 'Team Vitality', players: ['Naak Nako', 'Lyncas', 'Vetheo', 'Carzzy', 'Hylissang'] },
  { team: 'Team BDS', players: ['Adam', 'Sheo', 'nuc', 'Ice', 'Labrov'] },
  { team: 'SK Gaming', players: ['Irrelevant', 'Isma', 'Nisqy', 'Exakick', 'Doss'] },
  { team: 'Karmine Corp', players: ['Canna', 'Yike', 'Vladi', 'Upset', 'Targamas'] },
  { team: 'Rogue', players: ['Szygenda', 'Markoon', 'Larssen', 'Comp', 'Trymbi'] },
];

const LCS_TEAMS: RosterTemplate[] = [
  { team: 'Team Liquid', players: ['Impact', 'UmTi', 'APA', 'Yeon', 'CoreJJ'] },
  { team: 'Cloud9', players: ['Thanatos', 'Blaber', 'Jojopyun', 'Berserker', 'VULCAN'] },
  { team: 'FlyQuest', players: ['Bwipo', 'Inspired', 'Quad', 'Massu', 'Busio'] },
  { team: '100 Thieves', players: ['Sniper', 'River', 'Quid', 'FBI', 'Eyla'] },
  { team: 'NRG', players: ['Dhokla', 'Contractz', 'Palafox', 'FBI', 'huhi'] },
  { team: 'Dignitas', players: ['Srtty', 'Sheiden', 'Jensen', 'Tomo', 'Isles'] },
  { team: 'Immortals', players: ['Castle', 'Kenvi', 'Mask', 'Tactical', 'Fleshy'] },
  { team: 'Shopify Rebellion', players: ['Fudge', 'Bugi', 'Insanity', 'Bvoy', 'Zeyzal'] },
];

const CHAMPION_POOL: Record<string, string[]> = {
  top: [
    'Aatrox', 'Camille', 'Cho’Gath', 'Gnar', 'Gragas', 'Jax', 'Jayce', 'K’Sante', 'Malphite',
    'Ornn', 'Renekton', 'Rumble', 'Sion', 'Gwen', 'Ambessa', 'Poppy', 'Yorick',
  ],
  jungle: [
    'Bel’Veth', 'Brand', 'Ivern', 'Jarvan IV', 'Kindred', 'Lee Sin', 'Maokai', 'Nidalee',
    'Sejuani', 'Vi', 'Viego', 'Wukong', 'Xin Zhao', 'Nocturne', 'Skarner', 'Pantheon',
  ],
  mid: [
    'Ahri', 'Akali', 'Aurora', 'Azir', 'Corki', 'Hwei', 'Orianna', 'Sylas', 'Taliyah',
    'Twisted Fate', 'Viktor', 'Yone', 'Zoe', 'LeBlanc', 'Galio', 'Ryze',
  ],
  bot: [
    'Aphelios', 'Ashe', 'Caitlyn', 'Draven', 'Ezreal', 'Jhin', 'Jinx', 'Kai’Sa', 'Kalista',
    'Lucian', 'Miss Fortune', 'Senna', 'Varus', 'Xayah', 'Zeri', 'Smolder',
  ],
  support: [
    'Alistar', 'Bard', 'Blitzcrank', 'Braum', 'Karma', 'Leona', 'Lulu', 'Nautilus', 'Nami',
    'Rakan', 'Renata Glasc', 'Rell', 'Thresh', 'Milio', 'Poppy', 'Neeko',
  ],
};

const ROLE_ORDER = ['top', 'jungle', 'mid', 'bot', 'support'] as const;
const POSITION_CODES: Record<(typeof ROLE_ORDER)[number], string> = {
  top: 'top',
  jungle: 'jng',
  mid: 'mid',
  bot: 'bot',
  support: 'sup',
};

interface EventPlan {
  league: string;
  year: number;
  /** Splits with their date window, stage flags and target series count. */
  blocks: {
    split: string;
    playoffs: 0 | 1;
    startDay: number;
    endDay: number;
    series: number;
    bestOf: 1 | 3 | 5;
  }[];
  pool: RosterTemplate[];
}

/** Day 0 of the synthetic calendar. */
const SEASON_START = Date.UTC(2025, 0, 12, 9, 0, 0);
const DAY_MS = 24 * 60 * 60 * 1000;

/** Patch buckets by day offset, so meta stats vary across the season. */
const PATCH_SCHEDULE: { fromDay: number; patch: string }[] = [
  { fromDay: 0, patch: '15.01' },
  { fromDay: 21, patch: '15.02' },
  { fromDay: 42, patch: '15.04' },
  { fromDay: 70, patch: '15.06' },
  { fromDay: 100, patch: '15.08' },
  { fromDay: 135, patch: '15.10' },
  { fromDay: 175, patch: '15.13' },
  { fromDay: 215, patch: '15.15' },
  { fromDay: 255, patch: '15.18' },
  { fromDay: 290, patch: '15.20' },
];

function patchForDay(day: number): string {
  let patch = PATCH_SCHEDULE[0]!.patch;
  for (const entry of PATCH_SCHEDULE) {
    if (day >= entry.fromDay) patch = entry.patch;
  }
  return patch;
}

function buildPlans(): EventPlan[] {
  const regional = (league: string, pool: RosterTemplate[]): EventPlan => ({
    league,
    year: 2025,
    pool,
    blocks: [
      { split: 'Winter', playoffs: 0, startDay: 4, endDay: 46, series: 30, bestOf: 3 },
      { split: 'Winter', playoffs: 1, startDay: 48, endDay: 58, series: 7, bestOf: 5 },
      { split: 'Summer', playoffs: 0, startDay: 150, endDay: 205, series: 32, bestOf: 3 },
      { split: 'Summer', playoffs: 1, startDay: 210, endDay: 224, series: 7, bestOf: 5 },
    ],
  });

  const internationalPool = (): RosterTemplate[] => [
    ...LCK_TEAMS.slice(0, 4),
    ...LPL_TEAMS.slice(0, 4),
    ...LEC_TEAMS.slice(0, 3),
    ...LCS_TEAMS.slice(0, 3),
  ];

  return [
    regional('LCK', LCK_TEAMS),
    regional('LPL', LPL_TEAMS),
    regional('LEC', LEC_TEAMS),
    regional('LCS', LCS_TEAMS),
    {
      league: 'FST',
      year: 2025,
      pool: internationalPool().slice(0, 6),
      blocks: [
        { split: 'Main Event', playoffs: 0, startDay: 62, endDay: 68, series: 18, bestOf: 3 },
        { split: 'Main Event', playoffs: 1, startDay: 69, endDay: 71, series: 5, bestOf: 5 },
      ],
    },
    {
      league: 'MSI',
      year: 2025,
      pool: internationalPool().slice(0, 10),
      blocks: [
        { split: 'Play-In', playoffs: 0, startDay: 108, endDay: 113, series: 10, bestOf: 3 },
        { split: 'Main Event', playoffs: 1, startDay: 115, endDay: 126, series: 9, bestOf: 5 },
      ],
    },
    {
      league: 'EWC',
      year: 2025,
      pool: internationalPool().slice(0, 8),
      blocks: [
        { split: 'Group Stage', playoffs: 0, startDay: 190, endDay: 196, series: 17, bestOf: 3 },
        { split: 'Knockout', playoffs: 1, startDay: 197, endDay: 200, series: 7, bestOf: 5 },
      ],
    },
    {
      league: 'WLDs',
      year: 2025,
      pool: internationalPool(),
      blocks: [
        { split: 'Play-In', playoffs: 0, startDay: 262, endDay: 266, series: 8, bestOf: 1 },
        { split: 'Swiss Stage', playoffs: 0, startDay: 268, endDay: 278, series: 20, bestOf: 3 },
        { split: 'Quarterfinal', playoffs: 1, startDay: 284, endDay: 287, series: 4, bestOf: 5 },
        { split: 'Semifinal', playoffs: 1, startDay: 291, endDay: 292, series: 2, bestOf: 5 },
        { split: 'Final', playoffs: 1, startDay: 298, endDay: 298, series: 1, bestOf: 5 },
      ],
    },
  ];
}

const CSV_COLUMNS = [
  'gameid', 'datacompleteness', 'league', 'year', 'split', 'playoffs', 'date', 'game', 'patch',
  'participantid', 'side', 'position', 'playername', 'playerid', 'teamname', 'teamid', 'champion',
  'ban1', 'ban2', 'ban3', 'ban4', 'ban5', 'gamelength', 'result',
];

function csvEscape(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function pickUnique(rng: Rng, pool: string[], used: Set<string>): string {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const candidate = pool[rng.int(pool.length)]!;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
  const fallback = pool.find((champ) => !used.has(champ)) ?? pool[0]!;
  used.add(fallback);
  return fallback;
}

/** Hidden per-team strength so the demo quiz rewards reading the draft, not coin flips. */
function teamStrength(rng: Rng, teams: RosterTemplate[]): Map<string, number> {
  const strengths = new Map<string, number>();
  teams.forEach((team) => {
    if (!strengths.has(team.team)) strengths.set(team.team, 0.35 + rng.next() * 0.4);
  });
  return strengths;
}

/** Build the synthetic CSV text. Deterministic for a given seed. */
export function generateDemoCsv(seed: string = DEMO_SEED): string {
  const rng = createRng(seed);
  const plans = buildPlans();
  const allTeams = plans.flatMap((plan) => plan.pool);
  const strengths = teamStrength(rng, allTeams);

  const lines: string[] = [CSV_COLUMNS.join(',')];
  let gameCounter = 0;

  for (const plan of plans) {
    for (const block of plan.blocks) {
      const span = Math.max(1, block.endDay - block.startDay);
      for (let s = 0; s < block.series; s += 1) {
        const day = block.startDay + Math.floor((s / block.series) * span);
        const [teamA, teamB] = pickMatchup(rng, plan.pool);
        const gamesInSeries =
          block.bestOf === 1 ? 1 : block.bestOf === 3 ? 2 + rng.int(2) : 3 + rng.int(3);

        for (let g = 1; g <= gamesInSeries; g += 1) {
          gameCounter += 1;
          const gameId = `DEMO-${plan.league}-${plan.year}-${String(gameCounter).padStart(5, '0')}`;
          // Sides alternate through a series, as they do in a real bracket.
          const blue = g % 2 === 1 ? teamA : teamB;
          const red = g % 2 === 1 ? teamB : teamA;
          const timestamp = SEASON_START + day * DAY_MS + (g - 1) * 55 * 60 * 1000 + rng.int(90) * 60 * 1000;

          const blueStrength = strengths.get(blue.team) ?? 0.5;
          const redStrength = strengths.get(red.team) ?? 0.5;
          // Blue side keeps a small historical edge on top of team strength.
          const blueWinChance = 0.52 + (blueStrength - redStrength) * 0.9;
          const blueWins = rng.next() < clamp(blueWinChance, 0.12, 0.88);

          lines.push(
            ...renderGameRows({
              gameId,
              plan,
              block,
              gameNumber: g,
              timestamp,
              blue,
              red,
              blueWins,
              rng,
            }),
          );
        }
      }
    }
  }

  return lines.join('\n');
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function pickMatchup(rng: Rng, pool: RosterTemplate[]): [RosterTemplate, RosterTemplate] {
  const a = rng.int(pool.length);
  let b = rng.int(pool.length);
  if (b === a) b = (b + 1 + rng.int(pool.length - 1)) % pool.length;
  return [pool[a]!, pool[b]!];
}

interface RenderInput {
  gameId: string;
  plan: EventPlan;
  block: EventPlan['blocks'][number];
  gameNumber: number;
  timestamp: number;
  blue: RosterTemplate;
  red: RosterTemplate;
  blueWins: boolean;
  rng: Rng;
}

function renderGameRows(input: RenderInput): string[] {
  const { gameId, plan, block, gameNumber, timestamp, blue, red, blueWins, rng } = input;
  const day = Math.floor((timestamp - SEASON_START) / DAY_MS);
  const patch = patchForDay(day);
  const date = new Date(timestamp).toISOString().replace('T', ' ').slice(0, 19);
  const gameLength = 1500 + rng.int(1500);

  const used = new Set<string>();
  const bluePicks = ROLE_ORDER.map((role) => pickUnique(rng, CHAMPION_POOL[role]!, used));
  const redPicks = ROLE_ORDER.map((role) => pickUnique(rng, CHAMPION_POOL[role]!, used));
  const banPool = Object.values(CHAMPION_POOL).flat();
  const blueBans = Array.from({ length: 5 }, () => pickUnique(rng, banPool, used));
  const redBans = Array.from({ length: 5 }, () => pickUnique(rng, banPool, used));

  const base = [
    gameId,
    'complete',
    plan.league,
    String(plan.year),
    block.split,
    String(block.playoffs),
    date,
    String(gameNumber),
    patch,
  ];

  const rows: string[] = [];
  const emit = (tail: (string | number)[]) =>
    rows.push([...base, ...tail].map(csvEscape).join(','));

  const sides = [
    { team: blue, picks: bluePicks, bans: blueBans, side: 'Blue', firstId: 1, teamId: 100, win: blueWins },
    { team: red, picks: redPicks, bans: redBans, side: 'Red', firstId: 6, teamId: 200, win: !blueWins },
  ] as const;

  for (const entry of sides) {
    ROLE_ORDER.forEach((role, index) => {
      emit([
        entry.firstId + index,
        entry.side,
        POSITION_CODES[role],
        entry.team.players[index]!,
        `demo-${slug(entry.team.players[index]!)}`,
        entry.team.team,
        `demo-${slug(entry.team.team)}`,
        entry.picks[index]!,
        '', '', '', '', '',
        gameLength,
        entry.win ? 1 : 0,
      ]);
    });
  }

  for (const entry of sides) {
    emit([
      entry.teamId,
      entry.side,
      'team',
      '',
      '',
      entry.team.team,
      `demo-${slug(entry.team.team)}`,
      '',
      ...entry.bans,
      gameLength,
      entry.win ? 1 : 0,
    ]);
  }

  return rows;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** Parse + ingest the synthetic CSV into a ready-to-use dataset. */
export function buildDemoDataset(seed: string = DEMO_SEED): Dataset {
  const csv = generateDemoCsv(seed);
  const parsed = parseCsvText(csv);
  const { games, stats } = ingestRows(parsed.rows, parsed.headers, { demo: true });
  return {
    games,
    stats,
    source: { kind: 'demo', label: 'Synthetic demo data' },
    importedAt: new Date().toISOString(),
  };
}
