import { describe, expect, it } from 'vitest';
import { createQuizState, currentGame, quizReducer, summarize } from './session.ts';
import { QUESTION_TIME_MS } from './scoring.ts';
import { ALL_PERIOD, MIXED_SOURCE, type QuizConfig } from './config.ts';
import type { CompetitionId, Game, Side } from '../domain/types.ts';

const CONFIG: QuizConfig = {
  source: MIXED_SOURCE,
  period: ALL_PERIOD,
  questionCount: 10,
  mode: 'matchups',
  seed: 'TEST',
};

function fakeGame(id: string, winner: Side, competition: CompetitionId = 'LCK'): Game {
  const side = (s: Side, team: string) => ({
    side: s,
    teamName: team,
    teamId: null,
    tag: team.slice(0, 3).toUpperCase(),
    players: [],
    bans: [],
  });
  return {
    gameId: id,
    competition,
    sourceLeague: competition,
    tournamentLabel: `${competition} 2024`,
    season: '2024',
    split: null,
    date: '2024-06-01T00:00:00.000Z',
    patch: '14.11',
    stage: { kind: 'regular', label: 'Regular Season', elimination: false },
    seriesFormat: 'BO3',
    seriesFormatInferred: true,
    gameNumber: 1,
    blue: side('blue', 'Blue Team'),
    red: side('red', 'Red Team'),
    winner,
    durationSeconds: 1800,
    demo: true,
  };
}

const GAMES = [fakeGame('a', 'blue'), fakeGame('b', 'red', 'LEC'), fakeGame('c', 'blue', 'LEC')];

describe('quizReducer', () => {
  it('starts on the first question', () => {
    const state = createQuizState(CONFIG, GAMES);
    expect(state.phase).toBe('question');
    expect(currentGame(state)?.gameId).toBe('a');
    expect(state.totalScore).toBe(0);
  });

  it('moves to reveal on an answer and accumulates score + streak', () => {
    let state = createQuizState(CONFIG, GAMES);
    state = quizReducer(state, { type: 'answer', prediction: 'blue', responseMs: 0 });

    expect(state.phase).toBe('reveal');
    expect(state.answers).toHaveLength(1);
    expect(state.answers[0]!.outcome).toBe('correct');
    expect(state.totalScore).toBe(200);
    expect(state.streak).toBe(1);
    expect(state.bestStreak).toBe(1);
  });

  it('ignores a second answer for the same question', () => {
    let state = createQuizState(CONFIG, GAMES);
    state = quizReducer(state, { type: 'answer', prediction: 'blue', responseMs: 0 });
    const after = quizReducer(state, { type: 'answer', prediction: 'red', responseMs: 10 });
    expect(after).toBe(state);
  });

  it('advances to the next question and resets the phase', () => {
    let state = createQuizState(CONFIG, GAMES);
    state = quizReducer(state, { type: 'answer', prediction: 'blue', responseMs: 0 });
    state = quizReducer(state, { type: 'next' });
    expect(state.phase).toBe('question');
    expect(state.index).toBe(1);
    expect(currentGame(state)?.gameId).toBe('b');
  });

  it('resets the streak on a wrong call', () => {
    let state = createQuizState(CONFIG, GAMES);
    state = quizReducer(state, { type: 'answer', prediction: 'blue', responseMs: 0 });
    state = quizReducer(state, { type: 'next' });
    state = quizReducer(state, { type: 'answer', prediction: 'blue', responseMs: 0 });
    expect(state.answers[1]!.outcome).toBe('incorrect');
    expect(state.streak).toBe(0);
    expect(state.bestStreak).toBe(1);
  });

  it('charges a timeout the full clock and scores nothing', () => {
    let state = createQuizState(CONFIG, GAMES);
    state = quizReducer(state, { type: 'answer', prediction: null, responseMs: 10_450 });
    expect(state.answers[0]!.outcome).toBe('timeout');
    expect(state.answers[0]!.responseMs).toBe(QUESTION_TIME_MS);
    expect(state.totalScore).toBe(0);
  });

  it('finishes after the last question', () => {
    let state = createQuizState(CONFIG, GAMES);
    for (let i = 0; i < GAMES.length; i += 1) {
      state = quizReducer(state, { type: 'answer', prediction: 'blue', responseMs: 1000 });
      state = quizReducer(state, { type: 'next' });
    }
    expect(state.phase).toBe('finished');
    expect(state.finishedAt).not.toBeNull();
  });

  it('ignores `next` while a question is live', () => {
    const state = createQuizState(CONFIG, GAMES);
    expect(quizReducer(state, { type: 'next' })).toBe(state);
  });
});

describe('summarize', () => {
  it('aggregates outcomes, timings and per-competition performance', () => {
    let state = createQuizState(CONFIG, GAMES);
    // correct (2s) -> wrong -> timeout
    state = quizReducer(state, { type: 'answer', prediction: 'blue', responseMs: 2000 });
    state = quizReducer(state, { type: 'next' });
    state = quizReducer(state, { type: 'answer', prediction: 'blue', responseMs: 4000 });
    state = quizReducer(state, { type: 'next' });
    state = quizReducer(state, { type: 'answer', prediction: null, responseMs: QUESTION_TIME_MS });
    state = quizReducer(state, { type: 'next' });

    const summary = summarize(state);
    expect(summary.correct).toBe(1);
    expect(summary.incorrect).toBe(1);
    expect(summary.timeouts).toBe(1);
    expect(summary.accuracy).toBeCloseTo(33.33, 1);
    expect(summary.averageResponseMs).toBe(3000);
    expect(summary.fastestResponseMs).toBe(2000);
    expect(summary.questionCount).toBe(3);
    expect(summary.byCompetition.map((c) => c.competition).sort()).toEqual(['LCK', 'LEC']);
  });

  it('reports null timings when every question timed out', () => {
    let state = createQuizState(CONFIG, GAMES);
    for (let i = 0; i < GAMES.length; i += 1) {
      state = quizReducer(state, { type: 'answer', prediction: null, responseMs: QUESTION_TIME_MS });
      state = quizReducer(state, { type: 'next' });
    }
    const summary = summarize(state);
    expect(summary.averageResponseMs).toBeNull();
    expect(summary.fastestResponseMs).toBeNull();
    expect(summary.accuracy).toBe(0);
    expect(summary.totalScore).toBe(0);
  });
});
