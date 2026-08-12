/**
 * Leaderboard storage.
 *
 * Runs are kept behind a `LeaderboardRepository` interface with a
 * `localStorage` implementation. Swapping in a hosted backend means writing
 * one more class that satisfies the same three methods — no page or component
 * touches storage directly.
 */

import type { CompetitionId } from '../domain/types.ts';

export interface LeaderboardEntry {
  id: string;
  username: string;
  score: number;
  questionCount: number;
  /** 0-100. */
  accuracy: number;
  correct: number;
  incorrect: number;
  timeouts: number;
  bestStreak: number;
  /** `null` when every question timed out. */
  averageResponseMs: number | null;
  /** `MIXED` or a `CompetitionId`. */
  sourceKey: string;
  sourceLabel: string;
  /** ISO timestamp of when the run finished. */
  date: string;
  /** Quiz seed, so a run can be replayed. */
  seed: string;
  /** True when the run used the synthetic development dataset. */
  demoData: boolean;
}

export interface LeaderboardRepository {
  list(): Promise<LeaderboardEntry[]>;
  add(entry: Omit<LeaderboardEntry, 'id'>): Promise<LeaderboardEntry>;
  remove(id: string): Promise<void>;
  clear(): Promise<void>;
}

const STORAGE_KEY = 'draftcall:leaderboard:v1';
/** Keeps the store bounded; the board only ever shows the top slice anyway. */
const MAX_ENTRIES = 500;

function makeId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function isEntry(value: unknown): value is LeaderboardEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<LeaderboardEntry>;
  return (
    typeof entry.id === 'string' &&
    typeof entry.username === 'string' &&
    typeof entry.score === 'number' &&
    typeof entry.questionCount === 'number'
  );
}

export class LocalLeaderboardRepository implements LeaderboardRepository {
  private available(): boolean {
    try {
      return typeof localStorage !== 'undefined';
    } catch {
      return false;
    }
  }

  private read(): LeaderboardEntry[] {
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

  private write(entries: LeaderboardEntry[]): void {
    if (!this.available()) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
    } catch {
      // Storage full or blocked — the in-memory board for this session still works.
    }
  }

  async list(): Promise<LeaderboardEntry[]> {
    return this.read();
  }

  async add(entry: Omit<LeaderboardEntry, 'id'>): Promise<LeaderboardEntry> {
    const full: LeaderboardEntry = { ...entry, id: makeId() };
    const next = [full, ...this.read()].sort(compareEntries);
    this.write(next);
    return full;
  }

  async remove(id: string): Promise<void> {
    this.write(this.read().filter((entry) => entry.id !== id));
  }

  async clear(): Promise<void> {
    if (!this.available()) return;
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore — nothing else to clean up.
    }
  }
}

export const leaderboardRepository: LeaderboardRepository = new LocalLeaderboardRepository();

/* ------------------------------------------------------------------ */
/* Ranking + filtering (pure, so the page stays dumb)                  */
/* ------------------------------------------------------------------ */

/** Score first; ties broken by accuracy, then by the faster average answer. */
export function compareEntries(a: LeaderboardEntry, b: LeaderboardEntry): number {
  if (b.score !== a.score) return b.score - a.score;
  if (b.accuracy !== a.accuracy) return b.accuracy - a.accuracy;
  const aTime = a.averageResponseMs ?? Number.POSITIVE_INFINITY;
  const bTime = b.averageResponseMs ?? Number.POSITIVE_INFINITY;
  if (aTime !== bTime) return aTime - bTime;
  return Date.parse(b.date) - Date.parse(a.date);
}

export interface LeaderboardFilters {
  /** `null` = any length. */
  questionCount: number | null;
  /** `null` = any source; otherwise `MIXED` or a `CompetitionId`. */
  sourceKey: string | null;
}

export const ALL_FILTERS: LeaderboardFilters = { questionCount: null, sourceKey: null };

export function filterEntries(
  entries: readonly LeaderboardEntry[],
  filters: LeaderboardFilters,
): LeaderboardEntry[] {
  return entries.filter((entry) => {
    if (filters.questionCount !== null && entry.questionCount !== filters.questionCount) {
      return false;
    }
    if (filters.sourceKey !== null && entry.sourceKey !== filters.sourceKey) return false;
    return true;
  });
}

export function rankEntries(entries: readonly LeaderboardEntry[]): LeaderboardEntry[] {
  return [...entries].sort(compareEntries);
}

/** Personal-best score per source, for the "your best" row on the dashboard. */
export function personalBest(
  entries: readonly LeaderboardEntry[],
  username: string,
): LeaderboardEntry | null {
  const mine = entries.filter(
    (entry) => entry.username.toLowerCase() === username.trim().toLowerCase(),
  );
  return rankEntries(mine)[0] ?? null;
}

export function competitionOfEntry(entry: LeaderboardEntry): CompetitionId | null {
  return entry.sourceKey === 'MIXED' ? null : (entry.sourceKey as CompetitionId);
}
