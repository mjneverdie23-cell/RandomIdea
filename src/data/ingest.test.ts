import { describe, expect, it } from 'vitest';
import { deriveTeamTag, IngestError, ingestRows } from './ingest.ts';
import { parseCsvText } from './parseCsv.ts';

const HEADERS = [
  'gameid,datacompleteness,league,year,split,playoffs,date,game,patch,participantid,side,',
  'position,playername,playerid,teamname,teamid,champion,ban1,ban2,ban3,ban4,ban5,gamelength,result',
].join('');

const PICKS: Record<'blue' | 'red', string[]> = {
  blue: ['Aatrox', 'Viego', 'Ahri', 'Jinx', 'Thresh'],
  red: ['Gnar', 'Sejuani', 'Azir', 'Ashe', 'Nautilus'],
};
const BANS: Record<'blue' | 'red', string[]> = {
  blue: ['Rell', 'Zeri', 'Yone', 'Vi', 'Ornn'],
  red: ['Kalista', 'Milio', 'Corki', 'Jax', 'Karma'],
};
const POSITIONS = ['top', 'jng', 'mid', 'bot', 'sup'];

interface GameOptions {
  gameId?: string;
  league?: string;
  blueTeam?: string;
  redTeam?: string;
  blueWins?: boolean;
  date?: string;
  patch?: string;
  playoffs?: 0 | 1;
  split?: string;
  gameNumber?: number;
  omitBans?: boolean;
  omitPlayerRows?: number;
}

/** Build the 12 rows Oracle's Elixir writes for one game. */
function gameRows(options: GameOptions = {}): string[] {
  const {
    gameId = 'G1',
    league = 'LCK',
    blueTeam = 'T1',
    redTeam = 'Gen.G',
    blueWins = true,
    date = '2024-06-12 09:14:00',
    patch = '14.11',
    playoffs = 0,
    split = 'Summer',
    gameNumber = 1,
    omitBans = false,
    omitPlayerRows = 0,
  } = options;

  const base = [gameId, 'complete', league, '2024', split, String(playoffs), date, String(gameNumber), patch];
  const rows: string[] = [];

  const sides = [
    { key: 'blue' as const, label: 'Blue', team: blueTeam, first: 1, teamId: 100, win: blueWins },
    { key: 'red' as const, label: 'Red', team: redTeam, first: 6, teamId: 200, win: !blueWins },
  ];

  for (const side of sides) {
    for (let i = 0; i < 5 - (side.key === 'blue' ? omitPlayerRows : 0); i += 1) {
      rows.push(
        [
          ...base,
          String(side.first + i),
          side.label,
          POSITIONS[i]!,
          `${side.team}-p${i}`,
          `pid-${side.team}-${i}`,
          side.team,
          `tid-${side.team}`,
          PICKS[side.key][i]!,
          '', '', '', '', '',
          '1830',
          side.win ? '1' : '0',
        ].join(','),
      );
    }
  }

  for (const side of sides) {
    rows.push(
      [
        ...base,
        String(side.teamId),
        side.label,
        'team',
        '',
        '',
        side.team,
        `tid-${side.team}`,
        '',
        ...(omitBans ? ['', '', '', '', ''] : BANS[side.key]),
        '1830',
        side.win ? '1' : '0',
      ].join(','),
    );
  }

  return rows;
}

function ingest(rows: string[]) {
  const csv = [HEADERS, ...rows].join('\n');
  const parsed = parseCsvText(csv);
  return ingestRows(parsed.rows, parsed.headers);
}

describe('ingestRows', () => {
  it('builds a normalized game from the 12-row layout', () => {
    const { games } = ingest(gameRows());
    expect(games).toHaveLength(1);

    const game = games[0]!;
    expect(game.gameId).toBe('G1');
    expect(game.competition).toBe('LCK');
    expect(game.tournamentLabel).toBe('LCK 2024 Summer');
    expect(game.patch).toBe('14.11');
    expect(game.durationSeconds).toBe(1830);
    expect(game.winner).toBe('blue');
    expect(game.blue.teamName).toBe('T1');
    expect(game.red.teamName).toBe('Gen.G');
    expect(game.demo).toBe(false);
  });

  it('assigns roles from the position column in draft order', () => {
    const { games } = ingest(gameRows());
    expect(games[0]!.blue.players.map((p) => p.role)).toEqual([
      'top',
      'jungle',
      'mid',
      'bot',
      'support',
    ]);
    expect(games[0]!.blue.players.map((p) => p.champion.name)).toEqual(PICKS.blue);
    expect(games[0]!.red.players.map((p) => p.champion.name)).toEqual(PICKS.red);
  });

  it('reads bans off the team rows', () => {
    const { games } = ingest(gameRows());
    expect(games[0]!.blue.bans.map((b) => b.name)).toEqual(BANS.blue);
    expect(games[0]!.red.bans.map((b) => b.name)).toEqual(BANS.red);
  });

  it('keeps games whose ban columns are empty', () => {
    const { games } = ingest(gameRows({ omitBans: true }));
    expect(games).toHaveLength(1);
    expect(games[0]!.blue.bans).toEqual([]);
  });

  it('reads the winner from the losing team row too', () => {
    const { games } = ingest(gameRows({ blueWins: false }));
    expect(games[0]!.winner).toBe('red');
  });

  it('drops games from competitions outside the configured set', () => {
    const result = ingest([
      ...gameRows({ gameId: 'KEEP', league: 'LEC' }),
      ...gameRows({ gameId: 'DROP', league: 'LCK CL' }),
      ...gameRows({ gameId: 'DROP2', league: 'PCS' }),
    ]);
    expect(result.games.map((g) => g.gameId)).toEqual(['KEEP']);
    expect(result.stats.rejectedByCompetition).toBe(2);
  });

  it('drops games with an incomplete draft and reports why', () => {
    const result = ingest(gameRows({ omitPlayerRows: 2 }));
    expect(result.games).toHaveLength(0);
    expect(result.stats.rejectedIncomplete).toBe(1);
    expect(result.stats.warnings.some((w) => w.code === 'incomplete_game')).toBe(true);
  });

  it('normalizes header casing and spacing', () => {
    const csv = [
      'GameID,League,Year,Split,Playoffs,Date,Game,Patch,ParticipantID,Side,Position,PlayerName,TeamName,Champion,Ban1,Ban2,Ban3,Ban4,Ban5,GameLength,Result',
      ...gameRows()
        .map((row) => row.split(','))
        .map((cells) =>
          [
            cells[0], cells[2], cells[3], cells[4], cells[5], cells[6], cells[7], cells[8],
            cells[9], cells[10], cells[11], cells[12], cells[14], cells[16],
            cells[17], cells[18], cells[19], cells[20], cells[21], cells[22], cells[23],
          ].join(','),
        ),
    ].join('\n');
    const parsed = parseCsvText(csv);
    const { games } = ingestRows(parsed.rows, parsed.headers);
    expect(games).toHaveLength(1);
    expect(games[0]!.blue.teamName).toBe('T1');
  });

  it('rejects a file that is not an Oracle’s Elixir export', () => {
    const parsed = parseCsvText('name,value\nfoo,1');
    expect(() => ingestRows(parsed.rows, parsed.headers)).toThrow(IngestError);
  });

  it('summarizes the import', () => {
    const result = ingest([
      ...gameRows({ gameId: 'A', league: 'LCK', patch: '14.11' }),
      ...gameRows({ gameId: 'B', league: 'LPL', patch: '14.12' }),
      ...gameRows({ gameId: 'C', league: 'LDL' }),
    ]);
    expect(result.stats.gamesBuilt).toBe(3);
    expect(result.stats.gamesKept).toBe(2);
    expect(result.stats.perCompetition).toEqual({ LCK: 1, LPL: 1 });
    expect(result.stats.patches).toEqual(['14.12', '14.11']);
    expect(result.stats.dateRange).not.toBeNull();
  });
});

describe('series format inference', () => {
  it('marks a lone game as BO1', () => {
    const { games } = ingest(gameRows({ gameNumber: 1 }));
    expect(games[0]!.seriesFormat).toBe('BO1');
    expect(games[0]!.seriesFormatInferred).toBe(true);
  });

  it('infers BO3 from a two-game series between the same teams', () => {
    const { games } = ingest([
      ...gameRows({ gameId: 'S1', gameNumber: 1, date: '2024-06-12 09:00:00' }),
      ...gameRows({ gameId: 'S2', gameNumber: 2, date: '2024-06-12 10:00:00' }),
    ]);
    expect(games.map((g) => g.seriesFormat)).toEqual(['BO3', 'BO3']);
  });

  it('infers BO5 from a four-game series', () => {
    const { games } = ingest(
      [1, 2, 3, 4].flatMap((n) =>
        gameRows({
          gameId: `S${n}`,
          gameNumber: n,
          date: `2024-06-12 ${String(8 + n).padStart(2, '0')}:00:00`,
          playoffs: 1,
        }),
      ),
    );
    expect(new Set(games.map((g) => g.seriesFormat))).toEqual(new Set(['BO5']));
  });

  it('splits two meetings of the same teams into separate series', () => {
    const { games } = ingest([
      ...gameRows({ gameId: 'W1G1', gameNumber: 1, date: '2024-06-12 09:00:00' }),
      ...gameRows({ gameId: 'W1G2', gameNumber: 2, date: '2024-06-12 10:00:00' }),
      ...gameRows({ gameId: 'W5G1', gameNumber: 1, date: '2024-07-20 09:00:00' }),
    ]);
    const byId = new Map(games.map((g) => [g.gameId, g]));
    expect(byId.get('W1G1')!.seriesFormat).toBe('BO3');
    expect(byId.get('W5G1')!.seriesFormat).toBe('BO1');
  });
});

describe('stage derivation', () => {
  it('labels regular-season games', () => {
    const { games } = ingest(gameRows({ playoffs: 0, split: 'Summer' }));
    expect(games[0]!.stage.kind).toBe('regular');
    expect(games[0]!.stage.elimination).toBe(false);
  });

  it('labels playoff games', () => {
    const { games } = ingest(gameRows({ playoffs: 1, split: 'Summer' }));
    expect(games[0]!.stage.kind).toBe('playoffs');
    expect(games[0]!.stage.label).toBe('Summer — Playoffs');
  });

  it('recognizes named bracket rounds in the split column', () => {
    const semi = ingest(gameRows({ league: 'WLDs', playoffs: 1, split: 'Semifinal' }));
    expect(semi.games[0]!.stage.kind).toBe('semifinal');
    expect(semi.games[0]!.stage.elimination).toBe(true);

    const playin = ingest(gameRows({ league: 'WLDs', playoffs: 0, split: 'Play-In' }));
    expect(playin.games[0]!.stage.kind).toBe('playin');
  });
});

describe('deriveTeamTag', () => {
  it('keeps short names intact', () => {
    expect(deriveTeamTag('T1')).toBe('T1');
    expect(deriveTeamTag('NRG')).toBe('NRG');
  });

  it('drops org suffixes and initializes the rest', () => {
    expect(deriveTeamTag('G2 Esports')).toBe('G2');
    expect(deriveTeamTag('Team Liquid')).toBe('LIQ');
    expect(deriveTeamTag('JD Gaming')).toBe('JD');
    expect(deriveTeamTag('Top Esports')).toBe('TOP');
  });

  it('never returns an empty tag', () => {
    expect(deriveTeamTag('!!!').length).toBeGreaterThan(0);
  });
});
