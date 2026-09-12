import { describe, expect, it } from 'vitest';
import { formatSimReport, simulateGame, simulateGames } from './simulation';

/**
 * M4 — simulation harness invariants. These are rule-level invariants (no
 * statistical assertions), so they are stable and cheap.
 */
describe('M4: simulateGame', () => {
  it('is deterministic: the same seed replays identically', () => {
    expect(simulateGame(1234)).toEqual(simulateGame(1234));
  });

  it('derives the first mover from seed parity (even -> p1, odd -> p2)', () => {
    expect(simulateGame(100).firstMover).toBe('p1');
    expect(simulateGame(101).firstMover).toBe('p2');
  });

  it('always finishes with a valid winner before the safety cap', () => {
    for (const seed of [7, 100, 258, 999]) {
      const result = simulateGame(seed);
      expect(result.finished).toBe(true);
      expect(['p1', 'p2']).toContain(result.winnerId);
    }
  });
});

describe('M4: simulateGames', () => {
  it('is deterministic: two runs with the same base seed are identical', () => {
    const a = simulateGames({ games: 30, seed: 42 });
    const b = simulateGames({ games: 30, seed: 42 });
    // durationMs is wall-clock, not a game statistic: compare everything else.
    const { durationMs: _da, ...detA } = a;
    const { durationMs: _db, ...detB } = b;
    expect(detA).toEqual(detB);
  });

  it('accounts for every game exactly once', () => {
    const report = simulateGames({ games: 30, seed: 42 });
    expect(report.games).toBe(30);
    expect(report.finishedGames + report.cappedGames).toBe(30);
    const winnerSum = Object.values(report.winners).reduce((sum, n) => sum + n, 0);
    expect(winnerSum).toBe(report.finishedGames);
    expect(report.firstMoverWins).toBeLessThanOrEqual(report.finishedGames);
  });

  it('completes every game without hitting the safety cap', () => {
    const report = simulateGames({ games: 30, seed: 42 });
    expect(report.cappedGames).toBe(0);
  });

  it('renders a stable text report', () => {
    const report = simulateGames({ games: 5, seed: 42 });
    const text = formatSimReport(report);
    expect(text).toContain(`games: ${report.games}`);
    expect(text).toContain(`finished: ${report.finishedGames}`);
    expect(text).toBe(formatSimReport(simulateGames({ games: 5, seed: 42 })));
  });
});
