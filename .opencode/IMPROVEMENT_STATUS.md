# QCardWars Web — Improvement Ledger (multi-phase upgrade)

Last updated: Phase B complete — committed `1bf52e1`, reviewer **PASS** (1 MED + 3 LOW, non-blocking; LOW-2 stale-error-behind-modal already fixed + browser-verified). MED (poison/dot UI indicator) + test gaps + optional special-click fix folded into the Phase C brief. `pnpm verify` green. Phase A committed `1943c8a` (reviewer PASS). Phase 0a + 0b committed. 0c still optional.

## Phase plan
- **Phase 0 — defects & foundation**
  - [x] 0a Rejoin grace token + configurable disconnect timeout (server + client + service tests + SPEC.md) — DONE; 16 service tests incl. stale-token fallback, connected-seat protection, expiry precedence, double rejoin cycle.
  - [x] 0b Opponent real HP/mana visible in `toClientView` (hand stays count-only) + tests + UI + SPEC.md — DONE.
  - [ ] 0c Playwright e2e foundation + two-client browser smoke (manual multi-context matrix already done; scratch script exists at `.opencode/browser-check/`, gitignored; codify as a repeatable test if budget allows)
- [x] **Phase A — design/UX**: faction visual identity, card tooltips, combat animations, sound effects (toggleable) — DONE + committed `1943c8a` (A.1 CSS-only; A.2 presentational FX + WebAudio; 5 reviewer findings fixed; browser-verified; `pnpm verify` green).
- [x] **Phase B — rules**: 7 of 8 planned primitives delivered — `debuff-unit`, `dot`, `aoe`, `add-card`, `gain-mana`, `heal-hero`, `destroy-unit` (min-5 constraint satisfied; `move-unit` deliberately deferred as lowest-value/least-orthogonal) + 11 catalog cards + 16 new engine tests (51 total) + 2 new error codes + `validateEffects()` hardening. Browser-verified: full 2-client matches to victory, new cards seen and accepted in live play (Scorched Earth aoe, Overcharge gain-mana).
- [ ] **Phase C — content**: expand catalog to 40–60 cards across factions/kinds (reuse the 7 primitives, no new engine branching) + poison/dot UI indicator (reviewer MED: chip badge + tooltip; `ClientGameView` already carries the data) + reviewer test gaps (aoe on lane with building, `UNKNOWN_CARD` via `handleSpecial`, dot + combat same round) + optional: `target:'none'` specials execute on first click.
- [ ] **Phase D — modes**: solo AI opponent, rejoin e2e (browser), match summary screen; spectator optional (drop first if needed).
- [ ] **End task**: player-selectable 4 lane types at game start (lobby UI + createGame config + server validation).

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
1. Phase C (coder): catalog 40–60 cards + poison/dot UI indicator + reviewer test gaps + optional special first-click execution. Then reviewer pass → commit.
2. Phase D (modes): solo AI opponent, rejoin e2e (browser), match summary screen; spectator optional (drop first if needed).
3. Phase 0c (e2e codification) remains optional; do it if budget allows.

## Phase B verification notes (this pass)
- Dev-config: `apps/web/tsconfig.json` `paths` map `@qcw/game-core` → package source + `"rootDir": "../../"` so Vite compiles the package directly instead of reusing the never-invalidated `.vite` pre-bundle of a linked dep (this had served stale engine code in the browser across restarts); `tsc --noEmit` stays green thanks to `rootDir`.
- Client fix: `game:state` handler no longer clears the error signal — rule-rejection messages (WRONG_LANE_TYPE, insufficient mana, …) previously vanished within one re-broadcast. Verified live: illegal play shows + persists, legal play clears.
- Cosmetic: vowel-aware article in `WRONG_LANE_TYPE` messages.
