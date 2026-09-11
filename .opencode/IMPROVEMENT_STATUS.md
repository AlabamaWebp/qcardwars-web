# QCardWars Web — Improvement Ledger (multi-phase upgrade)

Last updated: **End task (END-1, selectable lanes) COMPLETE — reviewer PASS (no BLOCKER/HIGH/MEDIUM; 4 LOWs applied by orchestrator + re-verified); `pnpm verify` + `pnpm e2e` + browser loop (4 checks, desktop/mobile) green** (game-core 83, server 41). — Phase D complete — committed `aff1875`, reviewer **PASS twice** (fix re-verification clean; post-round debuff self-hit guard applied). Solo AI (deterministic `ai.ts` + 700 ms `AiService`), match summary stats table, `pnpm e2e` browser suite (3 specs: two-client lock-step, reload rejoin, solo vs AI), STALE_REVISION no-op, restoring-gate watchdog, solo reseed. `pnpm verify` + `pnpm e2e` fully green. Phase C committed `3f68155` (PASS). Phase B committed `1bf52e1` (PASS). Phase A committed `1943c8a` (PASS). Phase 0a + 0b committed. 0c superseded by D-3's repeatable `pnpm e2e`.

## Phase plan
- **Phase 0 — defects & foundation**
  - [x] 0a Rejoin grace token + configurable disconnect timeout (server + client + service tests + SPEC.md) — DONE; 16 service tests incl. stale-token fallback, connected-seat protection, expiry precedence, double rejoin cycle.
  - [x] 0b Opponent real HP/mana visible in `toClientView` (hand stays count-only) + tests + UI + SPEC.md — DONE.
  - [ ] 0c Playwright e2e foundation + two-client browser smoke (manual multi-context matrix already done; scratch script exists at `.opencode/browser-check/`, gitignored; codify as a repeatable test if budget allows)
- [x] **Phase A — design/UX**: faction visual identity, card tooltips, combat animations, sound effects (toggleable) — DONE + committed `1943c8a` (A.1 CSS-only; A.2 presentational FX + WebAudio; 5 reviewer findings fixed; browser-verified; `pnpm verify` green).
- [x] **Phase B — rules**: 7 of 8 planned primitives delivered — `debuff-unit`, `dot`, `aoe`, `add-card`, `gain-mana`, `heal-hero`, `destroy-unit` (min-5 constraint satisfied; `move-unit` deliberately deferred as lowest-value/least-orthogonal) + 11 catalog cards + 16 new engine tests (51 total) + 2 new error codes + `validateEffects()` hardening. Browser-verified: full 2-client matches to victory, new cards seen and accepted in live play (Scorched Earth aoe, Overcharge gain-mana).
- [x] **Phase C — content** — DONE + committed `3f68155` (reviewer PASS): catalog 40→60 cards (antlion 12 / combine 11 / rebel 12 / zombie 12 / universal 13; 32 units, 9 buildings, 19 powers; all 7 primitives on ≥2 cards, ≥9 buildings, costs 1–8; only existing primitives — zero engine branching added); poison/dot UI indicator (☠ badge on unit chips + tooltip line; `ClientGameView` already carried the data); 6 new engine tests (57 total: aoe-with-building, dot-tick-before-combat log sequence, UNKNOWN_CARD atomicity with validation-order pin, B-4 guard rewritten to 4 coverage tests); `target:'none'` unit specials fire on first click. Browser-verified: 2-client live matches, badge + tooltip visible, single-click Field Medkit activation logged, logs identical, no overflow at 1440×900 / 390×844, no console/network errors.
- [x] **Phase D — modes** — DONE + committed `aff1875` (reviewer PASS ×2): solo AI opponent (deterministic `game-core/ai.ts` policy, server `AiService` 700 ms tick, AI seat exempt from grace/forfeit, solo rooms die with the human, solo rematch reseeds), match summary stats (engine `PlayerStats` — turns/cards/units/damage — in victory modal), browser e2e suite `pnpm e2e` (puppeteer-core on isolated ports; specs: two-client lock-step match, reload rejoin no-lobby-flash, solo vs AI), restoring-gate watchdog + "Go to lobby", STALE_REVISION silent no-op, `?backendPort=` override, `activate-special` smoke, dot/heal/contested-lane engine tests, AOE + debuff self-hit stat guards. Spectator (optional) not built.
- [x] **End task — DONE + committed `04f6093`**: player-selectable 4 lane types at game start. Lane pool 4→6 (`guardian` + `wraith`), 12 new data-driven cards (72 total), engine `INVALID_LANE_TYPES` validation + canonical-order normalization, server room validation/storage (rematch keeps the selection), lobby picker UI (exactly-4 enforcement, `aria-pressed`, default from `DEFAULT_LANE_TYPES`), faction themes (guardian teal / wraith magenta), e2e spec C extended (picker swap + board assertion, race-proof count waits). Reviewer PASS; post-review LOWs applied (solo-rematch lane assertion, wraith-stalker balance note). `pnpm verify` (game-core 83, server 41) + `pnpm e2e` + 4-check browser loop (desktop 1440×900 + mobile 390×844, zero console/network errors) fully green.

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
- Rejoin: `room:rejoin` carries `{ code, token }`. The opaque, current token is the only credential; a stale or
  bogus token cannot reclaim a seat using its public `playerId` (REJOIN_INVALID). Normal reloads retain the current
  token and rejoin within the grace window; an expired valid token still reports REJOIN_EXPIRED.
- Deferred forfeit: if a seat's grace lapses while the other seat is still inside its own grace, the forfeit is
  deferred; it re-evaluates the moment the other seat rejoins (rejoiner wins immediately if the lapsed seat has
  no live grace) — no stuck `playing` match.

## Next
1. All planned phases (0a, 0b, A, B, C, D, End) delivered. 0c superseded by D-3's repeatable `pnpm e2e`.
2. Optional carry-overs (no phase assigned): unit-test pure `diffClientViews()`; 4th e2e spec (rematch round 2); balance pass note for `wraith-stalker` (4/1 @ cost 2 is the top cheap attack-per-cost — thematically defensible, no first-strike in engine).

## Phase B verification notes (this pass)
- Dev-config: `apps/web/tsconfig.json` `paths` map `@qcw/game-core` → package source + `"rootDir": "../../"` so Vite compiles the package directly instead of reusing the never-invalidated `.vite` pre-bundle of a linked dep (this had served stale engine code in the browser across restarts); `tsc --noEmit` stays green thanks to `rootDir`.
- Client fix: `game:state` handler no longer clears the error signal — rule-rejection messages (WRONG_LANE_TYPE, insufficient mana, …) previously vanished within one re-broadcast. Verified live: illegal play shows + persists, legal play clears.
- Cosmetic: vowel-aware article in `WRONG_LANE_TYPE` messages.
