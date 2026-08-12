import { describe, expect, it } from 'vitest';
import {
  MAX_QUESTION_SCORE,
  QUESTION_TIME_MS,
  SCORING,
  scoreAnswer,
  scoreEfficiency,
  ratingFor,
} from './scoring.ts';

describe('scoreAnswer', () => {
  it('gives base plus a full speed bonus for an instant correct call', () => {
    const score = scoreAnswer({
      prediction: 'blue',
      winner: 'blue',
      responseMs: 0,
      streakBefore: 0,
    });
    expect(score.outcome).toBe('correct');
    expect(score.base).toBe(SCORING.base);
    expect(score.speedBonus).toBe(SCORING.maxSpeedBonus);
    expect(score.total).toBe(SCORING.base + SCORING.maxSpeedBonus);
  });

  it('scales the speed bonus linearly with time remaining', () => {
    const half = scoreAnswer({
      prediction: 'red',
      winner: 'red',
      responseMs: QUESTION_TIME_MS / 2,
      streakBefore: 0,
    });
    expect(half.speedBonus).toBe(SCORING.maxSpeedBonus / 2);
    expect(half.total).toBe(SCORING.base + SCORING.maxSpeedBonus / 2);
  });

  it('gives no speed bonus for an answer on the buzzer', () => {
    const late = scoreAnswer({
      prediction: 'blue',
      winner: 'blue',
      responseMs: QUESTION_TIME_MS,
      streakBefore: 0,
    });
    expect(late.speedBonus).toBe(0);
    expect(late.total).toBe(SCORING.base);
  });

  it('adds a streak bonus that caps out', () => {
    const third = scoreAnswer({
      prediction: 'blue',
      winner: 'blue',
      responseMs: QUESTION_TIME_MS,
      streakBefore: 2,
    });
    expect(third.streakBonus).toBe(2 * SCORING.streakBonusPerStep);

    const deep = scoreAnswer({
      prediction: 'blue',
      winner: 'blue',
      responseMs: QUESTION_TIME_MS,
      streakBefore: 40,
    });
    expect(deep.streakBonus).toBe(SCORING.maxStreakBonus);
  });

  it('never exceeds the advertised maximum', () => {
    const best = scoreAnswer({
      prediction: 'blue',
      winner: 'blue',
      responseMs: 0,
      streakBefore: 99,
    });
    expect(best.total).toBe(MAX_QUESTION_SCORE);
  });

  it('scores zero for a wrong call, however fast', () => {
    const wrong = scoreAnswer({
      prediction: 'red',
      winner: 'blue',
      responseMs: 10,
      streakBefore: 5,
    });
    expect(wrong.outcome).toBe('incorrect');
    expect(wrong.total).toBe(0);
  });

  it('scores zero for a timeout', () => {
    const timeout = scoreAnswer({
      prediction: null,
      winner: 'blue',
      responseMs: QUESTION_TIME_MS,
      streakBefore: 5,
    });
    expect(timeout.outcome).toBe('timeout');
    expect(timeout.total).toBe(0);
    expect(timeout.speedFactor).toBe(0);
  });

  it('clamps out-of-range response times', () => {
    const early = scoreAnswer({
      prediction: 'blue',
      winner: 'blue',
      responseMs: -500,
      streakBefore: 0,
    });
    expect(early.speedBonus).toBe(SCORING.maxSpeedBonus);

    const late = scoreAnswer({
      prediction: 'blue',
      winner: 'blue',
      responseMs: QUESTION_TIME_MS * 3,
      streakBefore: 0,
    });
    expect(late.speedBonus).toBe(0);
  });
});

describe('scoreEfficiency', () => {
  it('reports the share of the theoretical maximum', () => {
    expect(scoreEfficiency(MAX_QUESTION_SCORE * 10, 10)).toBe(100);
    expect(scoreEfficiency(0, 10)).toBe(0);
    expect(scoreEfficiency(0, 0)).toBe(0);
  });
});

describe('ratingFor', () => {
  it('bands on accuracy, with efficiency gating the top tier', () => {
    expect(ratingFor(90, 80).tone).toBe('legendary');
    expect(ratingFor(90, 20).tone).toBe('great');
    expect(ratingFor(60, 40).tone).toBe('good');
    expect(ratingFor(48, 30).tone).toBe('ok');
    expect(ratingFor(10, 5).tone).toBe('poor');
  });
});
