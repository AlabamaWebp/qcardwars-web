# QCardWars Web

A clean-room web recreation of the public gameplay concept of **QCardWars - Card Game in GMod!**.
The project intentionally does **not** contain the original addon source code, models, textures, sounds,
or other copyrighted game assets.

The goal of this repository is a playable 1v1 LAN/browser card game that preserves the public mechanical
identity of the addon: four typed lanes, mana that grows with turns, units, buildings, powers and unit specials.

## Stack

- Angular 22 standalone client
- NestJS 12 authoritative multiplayer server
- Socket.IO 4.8.x
- Shared deterministic TypeScript game engine in `packages/game-core`
- pnpm workspace

## Requirements

- Node.js >= 22.22.3
- pnpm 12.x (`corepack enable` is recommended)

## First run

```bash
pnpm install
pnpm dev
```

Open `http://localhost:4200` on this computer. From another device on the same LAN, open
`http://<this-computer-LAN-IP>:4200` (for example `http://192.168.1.50:4200`). One player creates a room;
the other joins using its code. `pnpm dev` binds both Angular and Nest to `0.0.0.0`; if another device cannot
connect, allow private-network access for Node.js in the OS firewall and make sure TCP ports 4200 and 3000 are open.

The Nest server runs on port `3000`. In development the Angular client automatically connects to
`http://<current-hostname>:3000`, so opening the dev server from another device on the LAN works.

## Production-style run

```bash
pnpm verify
pnpm start
```

After a successful build, Nest serves the Angular build and Socket.IO from `http://0.0.0.0:3000`.

## Repository map

- `apps/web` — Angular UI
- `apps/server` — NestJS lobby + authoritative game gateway
- `packages/game-core` — deterministic game state, rules, card catalog and validation
- `docs` — research, exact MVP scope, architecture, acceptance criteria and autonomous night plan
- `.opencode/agents` — local Tiel scout/coder/reviewer/orchestrator setup
- `.opencode/command/night-build.md` — optional `/night-build` command
- `START_PROMPT.md` — prompt for the orchestrator

## Status

The project is feature-complete against `docs/ACCEPTANCE.md`: all P0 and P1 items pass and `pnpm verify` is green,
including the automated two-client socket smoke test (a full deterministic match reaching a shared victory). The
live per-session ledger — completed acceptance IDs, exact run instructions, and known deviations — is kept in
`.opencode/NIGHT_STATUS.md`.

## Conventions & gotchas (read before editing)

- **Server authoritative.** Clients submit intents only; the server computes legal moves, damage, mana, draws and
  victory. Never re-implement rule legality on the client.
- **Engine is pure/immutable.** `applyAction`, `playCard`, `endTurn`, `activateSpecial`, etc. return a **new**
  `GameState`. Callers **must** assign the return value (`room.game = applyAction(room.game, action)`). Discarding it
  silently loses the whole turn.
- **Exact two-player game.** `createGame` builds a 2-player game; a room only auto-starts with exactly two connected
  players. 3+ player support is intentionally out of scope.
- **Deterministic by seed.** Tests and the smoke test use seed `20240517` for a fully reproducible match; the
  two-client smoke binds an ephemeral port with the Socket.IO adapter and asserts lock-step to a shared victory.
- **One revision per mutation.** `revision` increments exactly once per canonical game mutation; the client must echo
  the latest revision or its intent is rejected as stale.
- **Sanitized views.** Each player sees their own current HP/mana and full hand; the opponent sees only max HP
  (`config.startingHp` = 30) and max mana, plus counts, and a `null` hand (see `SPEC.md` Visibility + `engine.toClientView`).
- **Rematch requires both connected.** `rematch` throws `NOT_CONNECTED` when any player is disconnected, so a departed
  socket can never be revived into a solo game.
- **Draw fallback.** `drawOne` returns a `'bucket'` placeholder when a deck is empty (no fatigue damage).
- **Hero damage sources.** Only `enemy-hero` powers/damage specials harm heroes; units attack units only.
