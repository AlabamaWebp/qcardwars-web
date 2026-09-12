#!/usr/bin/env node
/**
 * M4 — manual simulation runner (CommonJS, requires the built `dist/`).
 *
 * Usage (from the repo root or packages/game-core):
 *   node scripts/sim.cjs [games] [baseSeed]
 * Defaults: 400 games, base seed 1000.
 *
 * This is a thin wrapper over the pure `simulateGames` in dist/simulation.js;
 * it only parses argv and prints the report. Build first:
 *   pnpm --filter @qcw/game-core build
 */
'use strict';

const { simulateGames, formatSimReport } = require('../dist/simulation.js');

function parseArg(name, raw, fallback) {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    console.error(`error: ${name} must be a positive integer (got ${raw})`);
    process.exit(1);
  }
  return n;
}

const [games, baseSeed] = process.argv.slice(2);
const report = simulateGames({
  games: parseArg('games', games, 400),
  seed: parseArg('baseSeed', baseSeed, 1000),
});

console.log(formatSimReport(report));
console.log(`duration: ${report.durationMs}ms`);
