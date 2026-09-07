# QCardWars Web — autonomous night implementation prompt

Continue this repository from its current scaffold into a ~90% complete, playable web recreation of the public
QCardWars gameplay concept by the end of this autonomous session.

You are the `orchestrator`. Read `AGENTS.md`, then all files in `docs/`, inspect the code, initialize/update
`.opencode/NIGHT_STATUS.md`, and start implementing immediately.

Use our local agents exactly like this and **strictly sequentially**:

- `dev-scout` → `local/tiel-low` for narrow reconnaissance only;
- `coder` → `local/tiel-medium` for implementation;
- `reviewer` → `local/tiel-high` for high-rigor read-only review;
- you (`orchestrator`) → `local/tiel-medium` for task selection, integration and final verification.

The local llama-server effectively has one inference slot (`-np 1`), so never run child agents concurrently.

## Product target

The result must support a complete 1v1 browser/LAN match with four typed lanes, growing mana, deck/hand/draw,
units, buildings, one-shot powers, activatable unit specials after surviving a turn, combat, hero damage, victory,
lobby/room flow, disconnect handling sufficient for local play, and rematch/return-to-lobby. Preserve confirmed
public QCardWars mechanics from `docs/GAME_RESEARCH.md`; use `docs/SPEC.md` defaults where the original behavior
is unknown.

## Engineering constraints

- Keep Angular 22 + NestJS 12 + Socket.IO + shared TypeScript `game-core`.
- Server authoritative: clients send intents only.
- No database required for MVP; in-memory rooms are intentional.
- Do not import/copy original GMod addon code, models, textures or sounds.
- Do not redesign the entire architecture or chase production infrastructure while gameplay is incomplete.
- Keep every game action validated and deterministic enough to test.
- No external deployment/push and no work outside the repository.

## Execution order

Drive `docs/ACCEPTANCE.md` from P0 to P1. Prefer vertical slices that make the game actually playable. A good
order is: baseline boot → rules/core → 2-client network flow → complete interaction UI → all four card mechanics
→ endgame/rematch → reconnect/error paths → content/balance → mobile/layout polish → tests/e2e → final hardening.

For each substantial slice:

1. scout only if needed;
2. coder implements + tests;
3. run relevant checks;
4. reviewer audits the diff;
5. coder fixes BLOCKER/HIGH findings;
6. update `.opencode/NIGHT_STATUS.md`;
7. move on without waiting for the user.

Do not stop at a plan. Do not ask routine questions. If one optional feature becomes expensive, document it,
keep the core game working, and move to the next acceptance item.

## Final gate

Before stopping, run `pnpm verify` and, if feasible, an automated or manual-equivalent two-client smoke path.
Do not report success if there is a known P0 turn/desync/crash/illegal-action bug. Leave a concise final status in
`.opencode/NIGHT_STATUS.md` with completed acceptance IDs, commands/results, remaining limitations, and exact
run instructions.
