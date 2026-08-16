/**
 * Leaderboard storage.
 *
 * Runs are kept behind a `LeaderboardRepository` interface with a
 * `localStorage` implementation. Swapping in a hosted backend means writing
 * one more class that satisfies the same three methods — no page or component
 * touches storage directly.
 */

import { QUESTION_COUNTS, type QuizMode } from '../quiz/config.ts';
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
  /** How questions were drawn. Absent on runs recorded before modes existed. */
  mode?: QuizMode;
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
  /** `null` = any style. */
  mode: QuizMode | null;
}

export const ALL_FILTERS: LeaderboardFilters = {
  questionCount: null,
  sourceKey: null,
  mode: null,
};

export function filterEntries(
  entries: readonly LeaderboardEntry[],
  filters: LeaderboardFilters,
): LeaderboardEntry[] {
  return entries.filter((entry) => {
    if (filters.questionCount !== null && entry.questionCount !== filters.questionCount) {
      return false;
    }
    if (filters.sourceKey !== null && entry.sourceKey !== filters.sourceKey) return false;
    // Runs recorded before styles existed have no mode; they only appear under
    // "any style" rather than being guessed into one bucket.
    if (filters.mode !== null && entry.mode !== filters.mode) return false;
    return true;
  });
}

export function rankEntries(entries: readonly LeaderboardEntry[]): LeaderboardEntry[] {
  return [...entries].sort(compareEntries);
}

/* ------------------------------------------------------------------ */
/* Categories                                                          */
/* ------------------------------------------------------------------ */

/**
 * A board is only meaningful within one style and one length.
 *
 * A 50-question run can score five times what a 10-question run can, so
 * ranking them against each other by raw score just sorts by length. Every
 * ranking in the UI is scoped to a category for that reason.
 */
export interface LeaderboardCategory {
  mode: QuizMode;
  questionCount: number;
}

/** Every style × length combination, in display order. */
export const LEADERBOARD_CATEGORIES: LeaderboardCategory[] = (
  ['matchups', 'games'] as QuizMode[]
).flatMap((mode) => QUESTION_COUNTS.map((questionCount) => ({ mode, questionCount })));

export function categoryKey(category: LeaderboardCategory): string {
  return `${category.mode}:${category.questionCount}`;
}

/** The category a run belongs to, or `null` for pre-style runs. */
export function categoryOf(entry: LeaderboardEntry): LeaderboardCategory | null {
  return entry.mode ? { mode: entry.mode, questionCount: entry.questionCount } : null;
}

export function inCategory(entry: LeaderboardEntry, category: LeaderboardCategory): boolean {
  return entry.mode === category.mode && entry.questionCount === category.questionCount;
}

export function entriesInCategory(
  entries: readonly LeaderboardEntry[],
  category: LeaderboardCategory,
): LeaderboardEntry[] {
  return rankEntries(entries.filter((entry) => inCategory(entry, category)));
}

export interface CategorySummary {
  category: LeaderboardCategory;
  /** Runs recorded in this category. */
  runs: number;
  /** Highest-ranked run, or `null` when nobody has played it. */
  leader: LeaderboardEntry | null;
  /** The named player's best run here, or `null`. */
  personal: LeaderboardEntry | null;
  /** 1-based position of `personal` within the category. */
  personalRank: number | null;
}

/** Per-category standings, for the records grid on the leaderboard page. */
export function summarizeCategories(
  entries: readonly LeaderboardEntry[],
  categories: readonly LeaderboardCategory[],
  username: string,
): CategorySummary[] {
  const name = username.trim().toLowerCase();
  return categories.map((category) => {
    const ranked = entriesInCategory(entries, category);
    const personalIndex = ranked.findIndex((entry) => entry.username.toLowerCase() === name);
    return {
      category,
      runs: ranked.length,
      leader: ranked[0] ?? null,
      personal: personalIndex >= 0 ? ranked[personalIndex]! : null,
      personalRank: personalIndex >= 0 ? personalIndex + 1 : null,
    };
  });
}

/**
 * Best run for a player, optionally within one category.
 *
 * Without a category this is "highest score anywhere", which in practice means
 * their longest run — fine for a headline number, not for comparing players.
 */
export function personalBest(
  entries: readonly LeaderboardEntry[],
  username: string,
  category?: LeaderboardCategory,
): LeaderboardEntry | null {
  const name = username.trim().toLowerCase();
  const mine = entries.filter(
    (entry) =>
      entry.username.toLowerCase() === name && (!category || inCategory(entry, category)),
  );
  return rankEntries(mine)[0] ?? null;
}

export function competitionOfEntry(entry: LeaderboardEntry): CompetitionId | null {
  return entry.sourceKey === 'MIXED' ? null : (entry.sourceKey as CompetitionId);
}
