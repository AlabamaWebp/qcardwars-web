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

Open `http://localhost:4200` in two browser tabs or two devices on the same LAN. One player creates a room;
the other joins using its code.

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

## Current scaffold status

The scaffold already contains:

- deterministic baseline engine;
- four mirrored typed lanes;
- deck/hand/mana/HP state;
- units, buildings, powers and specials;
- a small original-placeholder card set;
- room create/join and two-player Socket.IO flow;
- public/private game-state filtering;
- initial Angular lobby and board;
- core unit tests;
- project-specific autonomous agent instructions.

It is deliberately a **starting implementation**, not the finished game. See `docs/NIGHT_PLAN.md` and
`docs/ACCEPTANCE.md` for the required overnight completion work.
