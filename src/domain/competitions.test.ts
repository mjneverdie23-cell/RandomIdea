import { describe, expect, it } from 'vitest';
import { isEligibleLeague, normalizeLeagueString, resolveCompetition } from './competitions.ts';

describe('normalizeLeagueString', () => {
  it('uppercases and collapses punctuation and whitespace', () => {
    expect(normalizeLeagueString('  lck-cl ')).toBe('LCK CL');
    expect(normalizeLeagueString('Mid-Season Invitational')).toBe('MID SEASON INVITATIONAL');
    expect(normalizeLeagueString('LPL.China')).toBe('LPL CHINA');
  });
});

describe('resolveCompetition', () => {
  it('maps the Oracle’s Elixir short codes', () => {
    expect(resolveCompetition('LCK')).toBe('LCK');
    expect(resolveCompetition('LEC')).toBe('LEC');
    expect(resolveCompetition('LCS')).toBe('LCS');
    expect(resolveCompetition('LPL')).toBe('LPL');
    expect(resolveCompetition('WLDs')).toBe('WORLDS');
    expect(resolveCompetition('MSI')).toBe('MSI');
    expect(resolveCompetition('FST')).toBe('FIRST_STAND');
    expect(resolveCompetition('EWC')).toBe('EWC');
  });

  it('is insensitive to casing and spacing', () => {
    expect(resolveCompetition('  lck ')).toBe('LCK');
    expect(resolveCompetition('worlds')).toBe('WORLDS');
    expect(resolveCompetition('First Stand')).toBe('FIRST_STAND');
    expect(resolveCompetition('Esports World Cup')).toBe('EWC');
  });

  it('tolerates season labels riding along in the league column', () => {
    expect(resolveCompetition('LCK 2024 Summer')).toBe('LCK');
    expect(resolveCompetition('Worlds 2023')).toBe('WORLDS');
    expect(resolveCompetition('MSI 2025 Main Event')).toBe('MSI');
  });

  it('keeps historical names of the same competition', () => {
    expect(resolveCompetition('NA LCS')).toBe('LCS');
    expect(resolveCompetition('EU LCS')).toBe('LEC');
  });

  it('rejects academy, challenger and development leagues', () => {
    expect(resolveCompetition('LCK CL')).toBeNull();
    expect(resolveCompetition('LDL')).toBeNull();
    expect(resolveCompetition('NACL')).toBeNull();
    expect(resolveCompetition('LCS Academy')).toBeNull();
    expect(resolveCompetition('LPL Challengers')).toBeNull();
  });

  it('rejects competitions outside the configured set', () => {
    expect(resolveCompetition('LCP')).toBeNull();
    expect(resolveCompetition('LTA North')).toBeNull();
    expect(resolveCompetition('PCS')).toBeNull();
    expect(resolveCompetition('VCS')).toBeNull();
    expect(resolveCompetition('CBLOL')).toBeNull();
    expect(resolveCompetition('Demacia Cup')).toBeNull();
    expect(resolveCompetition('')).toBeNull();
    expect(resolveCompetition(null)).toBeNull();
  });
});

describe('isEligibleLeague', () => {
  it('is a thin boolean wrapper over resolveCompetition', () => {
    expect(isEligibleLeague('LPL')).toBe(true);
    expect(isEligibleLeague('LDL')).toBe(false);
  });
});
