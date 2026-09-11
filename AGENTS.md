# QCardWars Web — development guide

This file is the repository-local operating guide for people and coding agents. It is intended to work with Codex, OpenCode, and a manual development workflow. Do not rely on machine-specific instruction files, absolute paths, model names, or a particular agent runner.

## Mission

Turn this scaffold into a ~90% complete, genuinely playable local/LAN QCardWars-style web game in one unattended development session. Prioritize an end-to-end playable match over breadth, perfect art, abstraction, or production infrastructure.

Before changing gameplay or architecture, read these documents in order:

1. `docs/GAME_RESEARCH.md`
2. `docs/SPEC.md`
3. `docs/ARCHITECTURE.md`
4. `docs/ACCEPTANCE.md`
5. `docs/NIGHT_PLAN.md`

## Non-negotiable architecture and scope

- Use an Angular client, NestJS server, Socket.IO transport, and shared TypeScript `game-core`.
- The server is authoritative: clients submit intents only. Clients must not decide legal moves, damage, mana, draws, random outcomes, or victory.
- Keep core rules deterministic and side-effect free where practical.
- Keep match state in memory for the MVP. Do not add a database until all P0/P1 acceptance work is green.
- Support only 1v1 matches with four lanes. Do not add 3+ player support.
- Work clean-room: do not copy, download, or embed original addon source code or assets. Recreate mechanics only from public descriptions and project research.
- Generic CSS and placeholder art are acceptable. Playability takes priority over asset hunting.
- Do not replace the chosen stack merely because another framework or architecture seems preferable.

## Workflow and coordination

Work autonomously on routine implementation decisions. Resolve ambiguity using the simplest choice consistent with `docs/SPEC.md`. If original behavior cannot be verified, make the baseline configurable where reasonable and record the assumption.

Use this strictly sequential capability-based workflow whenever delegation is available:

1. Scout only when reconnaissance, documentation lookup, or a narrow investigation is needed.
2. Implementer makes the scoped change and runs relevant checks.
3. Reviewer performs a read-only review, focusing on authoritative multiplayer behavior, state-machine bugs, regressions, and missing tests.
4. Implementer fixes confirmed findings and re-verifies.

Never run these stages in parallel. If delegation is unavailable, a single agent or developer must perform the same stages in that order. OpenCode roles, if present, are optional capabilities defined in `.opencode/agents`; they do not override this `AGENTS.md`, and an unavailable role must not block the work. Do not require named roles, fixed models, or a specific local inference setup.

`rtk` tooling is optional: use it only when it is installed, accessible, and compatible with the current environment. Use Playwright only when it is configured for interactive browser review.

## Safety and delivery behavior

- Do not ask routine implementation questions; proceed with documented requirements and record material assumptions.
- Do not stop at a plan or partial prototype; continue toward the playable acceptance target.
- When a command fails, diagnose it and make a bounded corrective attempt. Do not repeat an unchanged failing command in a loop.
- Prefer small, coherent milestones and local commits when Git is available.
- Preserve unrelated working-tree changes.
- Never push, publish, deploy externally, delete unrelated files, or access resources outside this repository without explicit authorization.

## Quality gates

After each meaningful milestone, run the cheapest relevant checks first:

```bash
pnpm --filter @qcw/game-core test
pnpm --filter @qcw/game-core typecheck
pnpm --filter @qcw/server typecheck
pnpm --filter @qcw/web typecheck
```

At major milestones, run:

```bash
pnpm test
pnpm typecheck
pnpm build
```

Before declaring the work complete, run:

```bash
pnpm verify
```

When the browser prerequisites are available, also run `pnpm e2e`.

## Definition of done

A stranger on the LAN can:

1. Start the server.
2. Open the game on two devices or tabs.
3. Create or join a room.
4. See both players and four typed lanes.
5. Draw and play legal cards using mana.
6. Use units, buildings, powers, and specials.
7. End turns and resolve combat consistently on both clients.
8. Reach a victory state at 0 HP.
9. Rematch or return to the lobby without restarting the process.

No known P0 desync, illegal-action exploit, stuck-turn bug, or unhandled server crash may remain.

## Progress ledger

Maintain `.opencode/NIGHT_STATUS.md` throughout the run. Keep it concise and update it after every reviewer pass with:

- current milestone;
- completed acceptance IDs;
- failing checks;
- next three concrete tasks;
- assumptions and known deviations from the original mechanics.
