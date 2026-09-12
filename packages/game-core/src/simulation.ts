import { AI_PLAYER_NAME, chooseAiAction } from './ai';
import { applyAction, createGame } from './engine';
import { DEFAULT_GAME_CONFIG, GameConfig, GameState } from './types';

/**
 * M4 — deterministic simulation harness.
 *
 * Plays full AI-vs-AI matches (both seats driven by `chooseAiAction`, which is
 * a pure function of the state) and aggregates statistics used for balance
 * iterations. The engine is the only rules authority and the only source of
 * randomness (its seeded xorshift32), so a run of N games from a fixed base
 * seed is fully reproducible.
 *
 * This module is side-effect free: `simulateGames` returns a plain report and
 * `formatSimReport` renders it. `scripts/sim.cjs` is the thin manual runner.
 */

export interface SimOptions {
  /** Number of games to play. Default 400. */
  games?: number;
  /** Base seed; game i uses `seed + i`. Default 1000. */
  seed?: number;
  /** Config override merged over DEFAULT_GAME_CONFIG (data-only balance knobs). */
  config?: Partial<GameConfig>;
  /** Safety cap on actions per game. Default 4000 (a normal game is < 600). */
  maxActionsPerGame?: number;
}

export interface SimGameResult {
  seed: number;
  /** True when the match reached a winner before the action cap. */
  finished: boolean;
  winnerId: string | null;
  /** The seat that acted first (seed parity: even → p1, odd → p2). */
  firstMover: string;
  /** Player-turns played (engine `turnNumber`). */
  turnNumber: number;
  /** Engine actions applied (AI intents). */
  actions: number;
  /** Cards each seat played from hand (cardId -> count). */
  cardsPlayed: Record<string, number>;
  /** Total damage each seat dealt (units + hero, engine-tracked). */
  damageDealt: Record<string, number>;
}

/**
 * Play ONE full AI-vs-AI match from `seed` and return its outcome. Pure with
 * respect to the module (no shared state); the engine holds all randomness.
 */
export function simulateGame(
  seed: number,
  config?: Partial<GameConfig>,
  maxActionsPerGame = 4000,
): SimGameResult {
  const effectiveConfig: GameConfig = { ...DEFAULT_GAME_CONFIG, ...(config ?? {}) };
  let state: GameState = createGame({
    roomCode: `SIM-${seed}`,
    players: [
      { id: 'p1', name: 'Sim P1' },
      { id: 'p2', name: AI_PLAYER_NAME },
    ],
    seed,
    config: effectiveConfig,
  });
  const firstMover = state.activePlayerId;
  let actions = 0;
  const cardsPlayed: Record<string, number> = {};
  while (state.status === 'playing' && actions < maxActionsPerGame) {
    const actor = state.activePlayerId;
    const action = chooseAiAction(state, actor);
    if (!action) break; // hard wedge: stop rather than hang (see simulateGames)
    if (action.type === 'play-card') {
      const handCard = state.players[actor].hand.find((h) => h.uid === action.handCardUid);
      if (handCard) cardsPlayed[handCard.cardId] = (cardsPlayed[handCard.cardId] ?? 0) + 1;
    }
    state = applyAction(state, action);
    actions++;
  }
  const damageDealt: Record<string, number> = {};
  for (const id of state.playerOrder) {
    damageDealt[id] = state.stats[id]?.damageDealt ?? 0;
  }
  return {
    seed,
    finished: state.status === 'finished',
    winnerId: state.winnerId,
    firstMover,
    turnNumber: state.turnNumber,
    actions,
    cardsPlayed,
    damageDealt,
  };
}

export interface SimReport {
  games: number;
  /** Games that reached a winner before the safety cap. */
  finishedGames: number;
  /** Games aborted by the safety cap (should be ~0). */
  cappedGames: number;
  /** Winner id -> number of finished games won. */
  winners: Record<string, number>;
  /** Finished games won by the player who moved first. */
  firstMoverWins: number;
  /** Finished games won by the player who moved second. */
  /** Total player-turns across finished games. */
  turnsTotal: number;
  turnsAvg: number;
  turnsMedian: number;
  turnsMin: number;
  turnsMax: number;
  /** Total engine actions across finished games. */
  actionsTotal: number;
  actionsAvg: number;
  /** Total plays of each card across finished games (cardId -> count). */
  cardFrequency: Record<string, number>;
  /** Average damage dealt per finished game, by seat id. */
  damageDealtAvg: Record<string, number>;
  /** Wall-clock time of the whole run (not part of determinism). */
  durationMs: number;
  /** Effective config lane types (informational). */
  laneTypes: readonly string[];
}

/**
 * Play `options.games` full AI-vs-AI matches and aggregate statistics.
 * Deterministic for a fixed (games, seed, config): every random draw, shuffle,
 * and discard happens inside the engine from its seeded RNG.
 */
export function simulateGames(options: SimOptions = {}): SimReport {
  const games = options.games ?? 400;
  const baseSeed = options.seed ?? 1000;
  const maxActionsPerGame = options.maxActionsPerGame ?? 4000;
  const config: GameConfig = { ...DEFAULT_GAME_CONFIG, ...(options.config ?? {}) };

  const winners: Record<string, number> = {};
  const cardFrequency: Record<string, number> = {};
  const damageTotal: Record<string, number> = {};
  let finishedGames = 0;
  let cappedGames = 0;
  let firstMoverWins = 0;
  let turnsTotal = 0;
  let actionsTotal = 0;
  const turnSamples: number[] = [];

  const started = Date.now();
  for (let i = 0; i < games; i++) {
    const result = simulateGame(baseSeed + i, config, maxActionsPerGame);
    if (!result.finished) {
      cappedGames++;
      continue;
    }
    finishedGames++;
    const winnerId = result.winnerId ?? 'unknown';
    winners[winnerId] = (winners[winnerId] ?? 0) + 1;
    if (winnerId === result.firstMover) firstMoverWins++;
    turnsTotal += result.turnNumber;
    turnSamples.push(result.turnNumber);
    actionsTotal += result.actions;
    for (const [cardId, n] of Object.entries(result.cardsPlayed)) {
      cardFrequency[cardId] = (cardFrequency[cardId] ?? 0) + n;
    }
    for (const [seat, n] of Object.entries(result.damageDealt)) {
      damageTotal[seat] = (damageTotal[seat] ?? 0) + n;
    }
  }
  const durationMs = Date.now() - started;
  const damageDealtAvg: Record<string, number> = {};
  for (const seat of Object.keys(damageTotal)) {
    damageDealtAvg[seat] = finishedGames ? damageTotal[seat] / finishedGames : 0;
  }

  turnSamples.sort((a, b) => a - b);
  const median =
    turnSamples.length === 0
      ? 0
      : turnSamples.length % 2 === 1
        ? turnSamples[(turnSamples.length - 1) / 2]
        : (turnSamples[turnSamples.length / 2 - 1] + turnSamples[turnSamples.length / 2]) / 2;

  return {
    games,
    finishedGames,
    cappedGames,
    winners,
    firstMoverWins,
    turnsTotal,
    turnsAvg: finishedGames ? turnsTotal / finishedGames : 0,
    turnsMedian: median,
    turnsMin: turnSamples.length ? turnSamples[0] : 0,
    turnsMax: turnSamples.length ? turnSamples[turnSamples.length - 1] : 0,
    actionsTotal,
    actionsAvg: finishedGames ? actionsTotal / finishedGames : 0,
    cardFrequency,
    damageDealtAvg,
    durationMs,
    laneTypes: [...config.laneTypes],
  };
}

/** Render a report as a compact, diff-friendly text block for the balance doc. */
export function formatSimReport(report: SimReport): string {
  const winnerLines = Object.keys(report.winners)
    .sort()
    .map((id) => `  ${id}: ${report.winners[id]}`);
  const damageLines = Object.keys(report.damageDealtAvg)
    .sort()
    .map((seat) => `  ${seat}: ${round1(report.damageDealtAvg[seat])}`);
  const topCards = Object.entries(report.cardFrequency)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 10)
    .map(([cardId, n]) => `  ${cardId}: ${n}`);
  const lines = [
    `games: ${report.games}`,
    `finished: ${report.finishedGames}`,
    `capped: ${report.cappedGames}`,
    `winners:`,
    ...(winnerLines.length ? winnerLines : ['  (none)']),
    `first-mover wins: ${report.firstMoverWins} / ${report.finishedGames}`,
    `turns  avg=${round1(report.turnsAvg)}  median=${report.turnsMedian}  min=${report.turnsMin}  max=${report.turnsMax}`,
    `actions avg=${round1(report.actionsAvg)}`,
    `damage dealt avg/game:`,
    ...(damageLines.length ? damageLines : ['  (none)']),
    `top cards played:`,
    ...(topCards.length ? topCards : ['  (none)']),
    `lanes: ${report.laneTypes.join(',')}`,
  ];
  // durationMs is intentionally omitted: it is wall-clock, not a deterministic
  // game statistic, so the rendered text stays reproducible.
  return lines.join('\n');
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
