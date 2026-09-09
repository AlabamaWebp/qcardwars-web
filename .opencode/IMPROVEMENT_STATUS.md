# QCardWars Web — Improvement Ledger (multi-phase upgrade)

Last updated: Phase 0a + 0b complete and committed (incl. stale-token rejoin hardening + 9 reviewer fixes across 4 review passes, final verdict PASS); 0c next.

## Phase plan
- **Phase 0 — defects & foundation**
  - [x] 0a Rejoin grace token + configurable disconnect timeout (server + client + service tests + SPEC.md) — DONE; 16 service tests incl. stale-token fallback, connected-seat protection, expiry precedence, double rejoin cycle.
  - [x] 0b Opponent real HP/mana visible in `toClientView` (hand stays count-only) + tests + UI + SPEC.md — DONE.
  - [ ] 0c Playwright e2e foundation + two-client browser smoke (manual multi-context matrix already done; codify as a repeatable script/test if budget allows)
- **Phase A — design/UX**: faction visual identity, card tooltips, combat animations, sound effects (toggleable).
- **Phase B — rules**: new effect primitives `debuff`, `dot`, `aoe`, `add-card`, `gain-mana`, `heal-hero`, `move-unit`, `destroy-unit` (min 5 must remain if budget slips) + engine tests per primitive + illegal-action tests.
- **Phase C — content**: expand catalog to 40–60 cards across factions/kinds.
- **Phase D — modes**: solo AI opponent, rejoin e2e (browser), match summary screen; spectator optional (drop first if needed).
- **End task**: player-selectable 4 lane types at game start (lobby UI + createGame config + server validation).

## Constraints (never break)
- Server-authoritative, deterministic core, revision-checked actions.
- No DB/accounts/deploy. In-memory rooms only. 1v1 + 4 lanes.
- Degradation order if time slips: spectator → sound → animations → extra primitives (keep ≥5 new).

## Completed (prior P0/P1 baseline)
- P0-01..P0-14, P1-01..P1-10 PASS; `pnpm verify` green (see `.opencode/NIGHT_STATUS.md`).

## Failing checks
- None.

## Assumptions / deviations
- Visibility baseline CHANGED by this upgrade: opponent's current HP and current mana are now visible to the
  other player (hand identities remain hidden, count only). SPEC.md updated to match.
- Rejoin: grace-token via localStorage; pre-game seat kept with `connected:false`; in-game timeout auto-forfeits
  to the remaining connected player. Timeout configurable, default 120s.
- Rejoin race: `room:rejoin` carries `{ code, token, playerId }`. A superseded (stale) token can still reclaim
  its seat via `playerId`, but only while the seat is disconnected AND a live grace window is armed for that
  seat — a live seat can never be hijacked, and a departed/expired seat can never be claimed (REJOIN_INVALID).
  REJOIN_EXPIRED still takes precedence over the fallback.
- Deferred forfeit: if a seat's grace lapses while the other seat is still inside its own grace, the forfeit is
  deferred; it re-evaluates the moment the other seat rejoins (rejoiner wins immediately if the lapsed seat has
  no live grace) — no stuck `playing` match.

## Next
1. Phase 0c (e2e codification, optional) → Phase A (design/UX: faction visual identity, card tooltips, combat animations, toggleable sound).
