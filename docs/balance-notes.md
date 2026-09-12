# M4 Balance Notes

Data-only balance pass over `packages/game-core/src/cards.ts`, measured with the
deterministic AI-vs-AI simulation harness added in this milestone. No engine rules,
new cards, or new mechanics were introduced — only cost / stat / effect-magnitude
changes, each kept consistent with the card's `description`.

## Method

- Harness: `packages/game-core/src/simulation.ts` (`simulateGame` / `simulateGames`).
  Two copies of the same deterministic AI (`chooseAiAction`) play a full match; the
  engine is the sole authority for legality, damage, draws, and victory. The AI uses no
  `Math.random` — all randomness comes from the engine's seeded xorshift32 RNG, so a run
  is fully reproducible from its seed.
- Metric set per run (400 games, base seed 1000): finished/capped counts, per-seat win
  counts, first-mover win rate, turn count (avg/median/min/max), actions per game,
  per-seat average damage dealt, and full per-card play frequency.
- Repro:

  ```bash
  pnpm --filter @qcw/game-core build
  pnpm --filter @qcw/game-core sim 400 1000
  ```

  The `sim` script prints `durationMs` (wall-clock) only on the CLI; it is deliberately
  excluded from `formatSimReport` output so the reported statistics stay reproducible.

## Baseline (before any balance change)

```
games: 400   finished: 400   capped: 0
winners:  p1: 207   p2: 193
first-mover wins: 255 / 400   (63.75%)
turns   avg=20.3   median=20   min=11   max=34
actions avg=48.6
damage dealt avg/game:  p1: 46.9   p2: 45.9
top cards played:
  building-bunker: 242
  power-extermination: 238
  power-shelling: 232
  power-execution: 223
  universal-mercenary: 214
  power-resupply: 202
  bucket: 200
  universal-drill-sergeant: 200
  power-overcharge: 198
  power-venom: 196
lanes: antlion,combine,rebel,zombie
```

Read of the baseline:

- **Seat symmetry is healthy** (207/193, ~52/48) — no structural p1/p2 advantage.
- **No stalls** — 0 of 400 games hit the action cap, so there is no dead-state bug.
- **Game length is reasonable** — ~20 turns, range 11–34.
- **First-mover win rate is a little high** (63.75%) — the one mild structural signal.
- The 14 cards never played are all `guardian`/`wraith` faction cards. That is expected,
  not a balance bug: the default 4-lane setup (`antlion,combine,rebel,zombie`) has no
  guardian/wraith lane, and faction units/buildings require their own lane type.

## Cycle 1 — Shelling cost 4 → 5

- **Target:** `power-shelling` (combine, "Deal 4 damage directly to the enemy hero").
  3rd-most-played card (232) and a pure tempo/face engine feeding the high first-mover rate.
- **Change:** cost `4` → `5` (damage unchanged).
- **Result:** first-mover wins `255 → 251` (63.75% → 62.75%), a mild improvement in the
  intended direction. Notably, Shelling's *play count rose* (232 → 241, becoming #1).
- **Finding:** the AI is cost-greedy — it always plays the most expensive card it can
  afford — so raising a card's cost does not reduce its play rate; it can increase it.
  Play rate is therefore an AI artifact, not a clean balance signal. The 5c figure is
  kept because 5c-for-4-face is a more conservative number and it nudged first-mover
  slightly down.

## Cycle 2 — Drill Sergeant onPlay +1/+1 → +1/+0

- **Target:** `universal-drill-sergeant` (universal 1-cost, 1/3 that buffed itself +1/+1
  on play, i.e. effectively a 2/4 for 1c; ~50% inclusion). The most cost-efficient body
  in the pool.
- **Change:** onPlay buff `attack: 1, health: 1` → `attack: 1, health: 0` (a 2/3 for 1c).
  Description updated to "+1 attack to itself."
- **Result:** no meaningful movement in the aggregate metrics (first-mover 253/400,
  turns 20.2, inclusion still ~50%).
- **Finding:** a 1-cost universal drop is legal on any lane from turn 1, so a modest body
  trim does not change how often the AI reaches for it. Kept as a slightly less efficient
  early body. The engine test that hard-coded the +1/+1 buff
  (`engine.spec.ts` "Drill Sergeant buffs itself…") was updated to the new +1/+0 values.

## Cycle 3 — Rotting Warden body 2/3 → 2/4

- **Target:** `zombie-rotting-warden` (zombie 3-cost, 2/3 with a 2/2 on-play dot on an
  enemy unit) — the least-played card in the effective pool (56/400, ~14%).
- **Change:** health `3` → `4` (body 2/3 → 2/4, dot unchanged).
- **Result:** inclusion `56 → 50`, within seed noise for a 400-game sample; no regression
  on any aggregate metric (first-mover 253/400, turns 20.2, 0 capped).
- **Finding:** the buff makes the card objectively stronger (2/4 + dot vs 2/3 + dot) even
  though the greedy AI's raw play count for this seed range did not rise. Its low count is
  driven mainly by its `onPlay: enemy-unit` targeting constraint (it is only playable
  when an enemy unit is present), not by weak body.

## Final state (after all three cycles)

```
games: 400   finished: 400   capped: 0
winners:  p1: 211   p2: 189
first-mover wins: 253 / 400   (63.25%)
turns   avg=20.2   median=20   min=11   max=34
actions avg=48.5
damage dealt avg/game:  p1: 46.7   p2: 45.1
top cards played:
  power-shelling: 241
  building-bunker: 239
  power-extermination: 237
  power-execution: 225
  universal-mercenary: 216
  universal-drill-sergeant: 204
  power-resupply: 202
  power-overcharge: 197
  bucket: 196
  power-venom: 193
lanes: antlion,combine,rebel,zombie
```

### Before → after summary

| Metric                 | Baseline | Final  | Delta                       |
| ---------------------- | -------- | ------ | --------------------------- |
| finished / capped      | 400 / 0  | 400 / 0| unchanged (no stalls)       |
| p1 : p2 wins           | 207 : 193| 211 : 189| within noise, still ~52/48 |
| first-mover win rate   | 63.75%   | 63.25% | −0.50pp (mild, intended dir)|
| turns avg / median     | 20.3 / 20| 20.2 / 20| unchanged                 |
| turns min / max        | 11 / 34  | 11 / 34| unchanged                   |
| actions per game       | 48.6     | 48.5   | unchanged                   |
| damage p1 / p2 (avg)   | 46.9 / 45.9| 46.7 / 45.1| within noise, still symmetric |

## Card changes (all in `cards.ts`)

| Card                        | Field   | Before | After |
| --------------------------- | ------- | ------ | ----- |
| `power-shelling`            | `cost`  | 4      | 5     |
| `universal-drill-sergeant`  | onPlay  | +1/+1  | +1/+0 |
| `zombie-rotting-warden`     | `health`| 3      | 4     |

## Overall conclusion

The baseline was already in a healthy, playable range: symmetric seats, no stalls,
sensible length, and only a mildly elevated first-mover rate. The three cycles made
small, individually-defensible refinements (a more conservative Shelling, a slightly
less efficient 1-drop, and a stronger weak zombie dot unit) rather than large rebalances,
and the aggregate metrics stayed stable — the expected outcome when the pool is diverse
and the AI is cost-greedy. No change introduced a stall, desync, or regression; all
137 game-core tests pass, typecheck is green, and the full build succeeds.

## Assumptions / known deviations

- Play-rate is treated as a soft signal only, because the deterministic AI is
  cost-greedy and does not represent a human's card-selection heuristics. Balance
  decisions here were anchored on the structural metrics (seat symmetry, first-mover
  rate, stall count, turn length) rather than raw inclusion.
- The guardian/wraith cards were left untouched; they are simply not reachable in the
  default lane set. They would only matter if a match configured guardian or wraith lanes.
