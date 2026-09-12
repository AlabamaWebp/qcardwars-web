# QCardWars gameplay improvements report

Companion to `docs/gameplay-audit.md` (the findings) and `docs/balance-notes.md` (the measured
balance pass). This document records **what was changed, why, and the evidence** for each change.

## Summary

The audit found a game with no combat decisions (GA-1), no interaction between players (GA-2), no
comeback (GA-3), no card synergy (GA-4), weak variation (GA-5), flat pacing (GA-6), and UX gaps
(GA-8). All findings were addressed in five milestones:

| Milestone | Commit(s) | What |
|---|---|---|
| M1 rules | `7f786ec` | Stagger, finite-deck fatigue, War Drums escalation, second-player card, `stun`/`bounce-unit`/`discard-random` effects, `onPlay`/`swarm`/`drawOnKill` unit fields, `effectiveAttack` export |
| M2 content | `2a6287d` | 15 new cards (catalog 72 → 87) using every new mechanic |
| M3 client | `6de03ba` + `420cac8` | Server-computed `effectiveAtk`, stagger/stun/dot badges, fatigue indicator |
| M4 AI + balance | `f17f456`, `cbfdbde`, `64d0ad9` | Deterministic heuristic AI, seeded AI-vs-AI simulation harness, 3 measured balance cycles |
| M5 docs + gate | this pass | This report, `SPEC.md` update, final `pnpm verify` + `pnpm e2e` |

No stack, architecture, protocol, or multiplayer-model changes. All new rules are data-driven
extensions of the existing authoritative engine; clients still submit intents only.

## Changes by theme

### 1. Depth and decisions — stagger (GA-1)

A freshly played unit arrives with `turnsSurvived` 0 and **does not attack** on the turn it is
played; it attacks from its owner's next turn, but **blocks as a defender immediately**. This
creates the missing core decision: spend tempo to block a lane now, or hold and push. It aligns
unit readiness with the existing special-readiness rule and automatically weakens pure aggro.

### 2. Interaction and counterplay (GA-2)

Three new non-kill interaction primitives (data-driven `Effect` entries, no new targeting UI):

- **`stun { turns }`** — the unit skips its next ready-turn attack(s); single slot, replaces
  (never stacks). Cards: *Stasis Field* (universal 2c power), *Phantom Harrier* (wraith special).
- **`bounce-unit`** — non-lethal removal: the unit returns to its owner's hand as a fresh card
  (buffs/dots/stuns lost; discarded if hand full). Card: *Metro Bouncer* (combine special).
- **`discard-random { amount }`** — the opponent discards N seeded-random cards. Card:
  *Terror Raid* (universal 2c power).

Together with the existing debuff/dot/AOE/destroy tools, every board state now has an answer and
the mid/late game regains decision density.

### 3. Comeback and pacing (GA-3, GA-6)

- **Finite-deck fatigue** — decks are 36 cards and stay that way. Drawing from an empty deck
  deals escalating damage (1, 2, 3, …). Ends infinite stalling and makes the deck's last third
  meaningful. Supersedes the old infinite-`bucket` fallback.
- **`drawOnKill`** — trades pay: *Wrench Tinker* draws 1 when destroyed in combat. Real
  card-advantage comeback for the side winning trades.
- **War Drums escalation** — from personal turn 15 (`config.escalationTurn`, configurable), each
  player's surviving units gain +1 ATK permanently every turn start. Guarantees every match
  resolves and rewards board survival.
- **Second player +1 starting card** — standard initiative compensation (GA-5a).

Target pacing (measured, see below): threats from turn 2 via on-play effects, decision density
from turn 3 via stagger blocking, resolution by ~turn 20–25 via escalation + fatigue.

### 4. Combos and synergy (GA-4)

- **`onPlay`** — lane-relative on-play effects with atomic target validation (no target → the whole
  play fails). Cards: *Tunnel Harrier* / *Chitin Skirmisher* (on-play debuff), *Metro Riot Marshal*
  (draw on play), *Propaganda Runner* (1 hero damage on play), *Drill Sergeant* (self-buff),
  *Rotting Warden* (on-play dot), *Sacred Sentinel* (self-protect on play).
- **`swarm`** — +N ATK per other friendly unit on the board: *Demolition Volunteer*, *Nectar Swarm*.
  Board presence now has strategic weight beyond single-lane blocking.

### 5. New content (GA-5) — 15 cards

All 15 use at least one new mechanic and spread across tiers 1–3 and every faction (incl.
guardian/wraith, which the default lane set never draws):

| Card | Faction, cost | New mechanic |
|---|---|---|
| Stasis Field | universal 2, power | stun |
| Terror Raid | universal 2, power | discard-random |
| Drill Sergeant | universal 1 | onPlay self-buff |
| Demolition Volunteer | universal 2 | swarm |
| Tunnel Harrier | antlion 1 | onPlay debuff |
| Chitin Skirmisher | antlion 3 | onPlay debuff |
| Nectar Swarm | antlion 2 | swarm |
| Metro Riot Marshal | combine 4 | onPlay draw |
| Metro Bouncer | combine 5 | special bounce |
| Propaganda Runner | rebel 2 | onPlay hero damage |
| Wrench Tinker | rebel 3 | drawOnKill |
| Rotting Warden | zombie 3 | onPlay dot |
| Plague Bearer | zombie 4 | special dot |
| Phantom Harrier | wraith 2 | special stun |
| Sacred Sentinel | guardian 6 | onPlay self-buff |

### 6. Gameplay UX (GA-8)

The board now shows what the rules imply, computed **server-side** and exposed through
`ClientUnitView` (clients display; they never recompute rules):

- effective ATK (base + own-lane building bonus + swarm) replaces raw ATK;
- stagger indicator (unit just arrived, attacks next turn);
- stun and dot badges;
- per-player fatigue level.

Verified live at desktop (1440×900) and mobile (390×844): no overlap/overflow, zero
console/network errors.

## Evidence

### Tests

- `pnpm --filter @qcw/game-core test`: **141 tests** (engine 115 incl. 40+ for the new rules,
  AI 19, simulation 7).
- `pnpm --filter @qcw/server test`: **42 tests** (incl. two-client lock-step smoke and
  special-activation socket exchange).
- `pnpm verify` (typecheck ×3 + all tests + build ×3): green.
- `pnpm e2e` (Puppeteer, real browser, real server): all 3 specs green — two-client match to
  shared victory in lock-step, reload/rejoin, and solo AI match on the new policy.

### Simulation (AI vs AI, real engine, seeded)

Harness: `pnpm --filter @qcw/game-core sim <games> <seed>`. Full per-cycle data in
`docs/balance-notes.md`; headline numbers (400 games, seed 1000):

| Metric | Baseline (new rules, pre-tweaks) | Final (post balance pass) |
|---|---|---|
| finished / capped | 400 / 0 | 400 / 0 |
| p1 : p2 wins | 207 : 193 | 211 : 189 |
| first-mover win rate | 63.75% | 63.25% |
| turns avg / median (min–max) | 20.3 / 20 (11–34) | 20.2 / 20 (11–34) |
| actions per game | 48.6 | 48.5 |
| avg damage p1 / p2 | 46.9 / 45.9 | 46.7 / 45.1 |

Read: symmetric seats, zero stalls, ~20-turn matches, mildly elevated (and slightly reduced)
first-mover rate. The new interaction rules did **not** degenerate the game — no dead states, no
one-sided collapse.

### Balance pass (3 measured cycles, data-only)

| Card | Change | Reason |
|---|---|---|
| `power-shelling` | cost 4 → 5 | most-played pure face damage; nudged first-mover rate down |
| `universal-drill-sergeant` | onPlay +1/+1 → +1/+0 | most cost-efficient 1-drop; trimmed |
| `zombie-rotting-warden` | body 2/3 → 2/4 | least-played effective card; strengthened |

Methodology note: per-card play-rate is an **AI artifact** (the policy is cost-greedy), so balance
decisions were anchored on structural metrics (seat symmetry, first-mover rate, stall count, turn
length). See `docs/balance-notes.md`.

## How to re-run everything

```bash
pnpm install
pnpm verify                                   # typecheck + all unit tests + build
pnpm e2e                                     # browser E2E (spawns its own server + web)
pnpm dev                                     # real dev servers (server + Angular web)
pnpm --filter @qcw/game-core sim 400 1000    # 400-game seeded AI-vs-AI balance report
```

Determinism: the engine's RNG is seed-driven xorshift32 and the AI uses no randomness, so a given
seed always reproduces the same matches and the same report.

## Assumptions and known deviations

- **Original-game fidelity:** stagger, fatigue, escalation, second-player card, stun/bounce/
  discard, onPlay/swarm/drawOnKill are **web-baseline design choices** resolving the audit
  findings; they are not claimed to match the original addon. All are configurable in
  `GameConfig` (`escalationTurn`) or are data-driven (every other rule is per-card data).
- **M2 content naming:** the 15 depth cards are original clean-room names/stats (only 3 of the
  planned IDs from the audit draft were kept); mechanic coverage of the plan is complete.
- **AI strength:** the solo AI is a deliberate heuristic baseline (one action per call,
  cost-greedy, no lookahead) — enough for solo play and simulation, not a challenge opponent.
- **Balance scope:** only 3 stat-level changes were warranted by the simulation; the guardian and
  wraith cards were left untouched (unreachable in the default 4-lane set; reachable when a room
  picks those lanes).
- **Hand cap:** 10-card soft cap with excess draw discarded (unchanged baseline).
- **Rematch:** keeps the room's lane selection; decks are rebuilt and re-seeded.
