/**
 * Blind mode's own board.
 *
 * Deliberately separate from the timed quiz's leaderboard rather than another
 * category on it. The two measure different things: a quiz run is scored on
 * speed, streaks and a length you choose, a blind run on four fixed questions
 * where the only currencies are which rungs you read correctly and how many
 * hints you needed. Folding them together would mean an entry shape where half
 * the fields are meaningless whichever mode wrote it.
 *
 * Same storage pattern as the main board: an interface with a `localStorage`
 * implementation, so a hosted backend is one more class.
 */

import { BLIND_LEVELS, MAX_BLIND_SCORE, type BlindLevel, type BlindRun } from '../quiz/blind.ts';

export interface BlindBoardEntry {
  id: string;
  username: string;
  score: number;
  /** Rungs answered correctly, 0–4. */
  cleared: number;
  /** Hints spent across the run. */
  hints: number;
  /**
   * Total time on the clock across the four levels, in milliseconds.
   * Absent on runs recorded before blind mode had a clock.
   */
  timeMs?: number;
  /** Which rungs were read correctly, for the recap column. */
  levelsCleared: BlindLevel[];
  /** ISO timestamp of when the run finished. */
  date: string;
  /** True when the run used the synthetic development dataset. */
  demoData: boolean;
}

export interface BlindBoardRepository {
  list(): Promise<BlindBoardEntry[]>;
  add(entry: Omit<BlindBoardEntry, 'id'>): Promise<BlindBoardEntry>;
  clear(): Promise<void>;
}

const STORAGE_KEY = 'draftcall:blind-board:v1';
const MAX_ENTRIES = 200;

function makeId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `blind-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function isEntry(value: unknown): value is BlindBoardEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<BlindBoardEntry>;
  return (
    typeof entry.id === 'string' &&
    typeof entry.username === 'string' &&
    typeof entry.score === 'number' &&
    typeof entry.cleared === 'number'
  );
}

export class LocalBlindBoardRepository implements BlindBoardRepository {
  private available(): boolean {
    try {
      return typeof localStorage !== 'undefined';
    } catch {
      return false;
    }
  }

  private read(): BlindBoardEntry[] {
    if (!this.available()) return [];
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter(isEntry) : [];
    } catch {
      return [];
    }
  }

  private write(entries: BlindBoardEntry[]): void {
    if (!this.available()) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
    } catch {
      // Storage full or blocked — this session's board still works in memory.
    }
  }

  async list(): Promise<BlindBoardEntry[]> {
    return this.read();
  }

  async add(entry: Omit<BlindBoardEntry, 'id'>): Promise<BlindBoardEntry> {
    const full: BlindBoardEntry = { ...entry, id: makeId() };
    this.write([full, ...this.read()].sort(compareBlindEntries));
    return full;
  }

  async clear(): Promise<void> {
    if (!this.available()) return;
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Nothing else to clean up.
    }
  }
}

export const blindBoardRepository: BlindBoardRepository = new LocalBlindBoardRepository();

/* ------------------------------------------------------------------ */
/* Ranking                                                             */
/* ------------------------------------------------------------------ */

/**
 * Score first, then the run that needed fewer hints, then the faster one.
 *
 * Two runs can bank the same points very differently — four clean rungs against
 * three hinted ones — and the unhinted read is the better one, so hints break
 * the tie before anything else does. Time comes after that: speed is already
 * priced into the score, so it settles what is left rather than counting twice.
 */
export function compareBlindEntries(a: BlindBoardEntry, b: BlindBoardEntry): number {
  if (b.score !== a.score) return b.score - a.score;
  if (a.hints !== b.hints) return a.hints - b.hints;
  if (b.cleared !== a.cleared) return b.cleared - a.cleared;
  const aTime = a.timeMs ?? Number.POSITIVE_INFINITY;
  const bTime = b.timeMs ?? Number.POSITIVE_INFINITY;
  if (aTime !== bTime) return aTime - bTime;
  return Date.parse(b.date) - Date.parse(a.date);
}

export function rankBlindEntries(entries: readonly BlindBoardEntry[]): BlindBoardEntry[] {
  return [...entries].sort(compareBlindEntries);
}

export function blindPersonalBest(
  entries: readonly BlindBoardEntry[],
  username: string,
): BlindBoardEntry | null {
  const name = username.trim().toLowerCase();
  return rankBlindEntries(entries.filter((e) => e.username.toLowerCase() === name))[0] ?? null;
}

/** A finished run, in the shape the board stores. */
export function entryFromRun(
  run: BlindRun,
  username: string,
  demoData: boolean,
): Omit<BlindBoardEntry, 'id'> {
  return {
    username: username.trim() || 'Anonymous',
    score: run.score,
    cleared: run.results.filter((result) => result.correct).length,
    hints: run.hintsTotal,
    timeMs: run.timeMs,
    levelsCleared: run.results.filter((r) => r.correct).map((r) => r.level),
    date: new Date().toISOString(),
    demoData,
  };
}

/** Share of the maximum a score represents, for the progress meter. */
export function blindScorePct(score: number): number {
  return MAX_BLIND_SCORE > 0 ? Math.round((score / MAX_BLIND_SCORE) * 100) : 0;
}

export function clearedLabel(levels: readonly BlindLevel[]): string {
  if (levels.length === 0) return 'none';
  if (levels.length === BLIND_LEVELS.length) return 'all four';
  return levels.join(', ');
}
