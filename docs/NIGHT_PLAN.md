# Autonomous night plan

This is a priority ladder, not a rigid time schedule. The orchestrator should advance as soon as a gate is green.

## Phase 0 — establish a green baseline

- install dependencies if needed;
- make scaffold typecheck/test/build;
- create `.opencode/NIGHT_STATUS.md`;
- fix toolchain/import problems before feature work.

## Phase 1 — harden the game core

Target: P0-04..12.

- expand effect primitives and tests;
- verify mana/draw/turn counters;
- verify unit aging/special readiness;
- verify death/victory and revision semantics;
- expand baseline catalog enough to exercise all primitives.

Reviewer focus: determinism, illegal actions, stale actions, hidden info.

## Phase 2 — complete two-client server flow

Target: P0-02..03, P0-12.

- robust room membership;
- personalized snapshots;
- recoverable socket errors;
- room cleanup and game-over locking.

Add two-socket integration smoke early; it catches more than UI polishing.

## Phase 3 — make the Angular UI fully playable

Target: P0-13, P1-02..03.

- create/join flow;
- hand card selection;
- lane/target selection for each kind;
- special controls;
- end-turn state;
- opponent side, HP/mana/hand counts;
- combat/game log and actionable errors;
- mobile responsive board.

Use CSS/HTML placeholders; do not lose hours sourcing art.

## Phase 4 — feature completeness and content

Target: P0-09..11, P1-01.

- at least 24–32 cards;
- all factions represented at multiple mana tiers;
- 2+ buildings, 4+ powers, 6+ specials;
- tune obvious runaway balance, but do not attempt competitive balancing.

## Phase 5 — lifecycle robustness

Target: P1-04..06.

- disconnect grace/rejoin token or best simple equivalent;
- rematch handshake;
- clean leave/return lobby.

## Phase 6 — final hardening

Target: P1-07..10.

- run full verify;
- run 2-client smoke/e2e;
- reviewer audits final diff/status;
- fix all BLOCKER/HIGH findings;
- document remaining P2/known deviations without obscuring P0 failures.

## Degradation policy

If time/compute becomes constrained, sacrifice in this order:

1. animations/audio;
2. custom card editor;
3. persistence;
4. advanced reconnect sophistication;
5. visual polish;

Never sacrifice legal-action validation, two-client state consistency, core playable UI, victory, or tests just to
claim a larger feature list.
