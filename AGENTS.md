# QCardWars Web — autonomous development rules

## Mission

Turn this scaffold into a ~90% complete, genuinely playable local/LAN QCardWars-style web game in one
unattended development session. Prioritize an end-to-end playable match over breadth, perfect art, abstraction,
or production infrastructure.

Read, in this order:

1. `docs/GAME_RESEARCH.md`
2. `docs/SPEC.md`
3. `docs/ARCHITECTURE.md`
4. `docs/ACCEPTANCE.md`
5. `docs/NIGHT_PLAN.md`

## Non-negotiable architecture

- Angular client + NestJS server + Socket.IO + shared TypeScript `game-core`.
- Server is authoritative. Clients submit intents; clients never decide legal moves, damage, mana, draws or victory.
- Core rules stay deterministic and side-effect free where practical.
- Match state is in memory for MVP. Do not add a database unless all P0/P1 acceptance work is already green.
- Keep the game 1v1 and four lanes. Do not spend the night adding 3+ player support.
- Do not copy or download the original addon source/assets into this repository. Recreate mechanics from public descriptions only.
- Placeholder/generic CSS art is acceptable. Gameplay > asset hunting.

## Agent topology

Use the project agents exactly as intended:

- `dev-scout` (`local/tiel-low`) — reconnaissance, dependency/doc lookup, narrow bug investigation.
- `coder` (`local/tiel-medium`) — implementation and tests.
- `reviewer` (`local/tiel-high`) — read-only correctness review, multiplayer/state-machine bugs, test gaps.
- `orchestrator` (`local/tiel-medium`) — plans, delegates, integrates, verifies and keeps progress moving.

### IMPORTANT: sequential only

The user's local llama-server setup has one effective inference slot (`-np 1`). Do **not** launch subagents in
parallel. Run Scout → Coder → Reviewer → Coder/fix sequentially. Parallel child sessions waste VRAM/context and
can fail model resolution.

## Autonomous behavior

- Do not ask the user routine implementation questions.
- Resolve ambiguity with the simplest choice consistent with `docs/SPEC.md`.
- If exact original behavior is unverified, keep it configurable and document the chosen baseline.
- Do not stop after planning or a partial prototype.
- When a command fails, diagnose and retry with a bounded fix. Never loop the same failing command unchanged.
- Prefer small coherent milestones and local commits if git is available.
- Never push, publish, deploy externally, delete unrelated files, or access outside the repo.
- Do not rewrite the stack because another framework seems nicer.

## Quality gates after each meaningful milestone

Run the cheapest relevant checks first, then broader checks:

```bash
pnpm --filter @qcw/game-core test
pnpm --filter @qcw/game-core typecheck
pnpm --filter @qcw/server typecheck
pnpm --filter @qcw/web typecheck
```

At major milestones run:

```bash
pnpm test
pnpm typecheck
pnpm build
```

Before final completion run:

```bash
pnpm verify
```

If browser automation is added, also run the 2-client smoke/e2e suite.

## Definition of success

A stranger on the LAN can:

1. start the server;
2. open the game on two devices/tabs;
3. create/join a room;
4. see four typed lanes and both players;
5. draw and play legal cards using mana;
6. use units, buildings, powers and specials;
7. end turns and resolve combat consistently on both clients;
8. reach a victory state at 0 HP;
9. rematch or return to lobby without restarting the process.

No known P0 desync, illegal-action exploit, stuck-turn bug or unhandled server crash may remain.

## Progress ledger

Maintain `.opencode/NIGHT_STATUS.md` during the run with:

- current milestone;
- completed acceptance IDs;
- failing checks;
- next 3 concrete tasks;
- assumptions/known deviations from original mechanics.

Keep it concise and update it after each reviewer pass.
