# Acceptance checklist

The orchestrator should mark IDs in `.opencode/NIGHT_STATUS.md` as they become verified.

## P0 — must work before calling the game playable

- **P0-01 Boot** — `pnpm install`, `pnpm dev`, web loads, server health/socket connect works.
- **P0-02 Room** — player A creates a room, player B joins by code, both see the same match start.
- **P0-03 State privacy** — each player sees own hand identities; opponent only hand/deck counts.
- **P0-04 Four lanes** — four mirrored typed lanes render and faction restrictions are enforced server-side.
- **P0-05 Mana/draw** — personal max mana grows/refills by turn, draw occurs, card costs are enforced.
- **P0-06 Units** — legal unit placement consumes card/mana; occupied/wrong-type placements are rejected.
- **P0-07 Combat** — end turn resolves attacks deterministically, units die correctly, open lanes damage hero.
- **P0-08 Victory** — hero <=0 ends match once, freezes normal actions, winner visible to both clients.
- **P0-09 Buildings** — can coexist with unit, at least two passive behaviors work, normal attack doesn't destroy.
- **P0-10 Powers** — at least four one-shot power behaviors/targets work and are validated.
- **P0-11 Specials** — readiness requires surviving one turn, cost/uses/targets enforced, at least six unit specials.
- **P0-12 Invalid actions** — wrong player/stale revision/invalid target/insufficient mana do not mutate state.
- **P0-13 UI complete path** — game is playable from UI without devtools/API calls.
- **P0-14 Build** — `pnpm typecheck`, `pnpm test`, `pnpm build` all pass.

## P1 — required for the requested ~90% overnight result

- **P1-01 Content** — 24–32 usable cards across all factions/kinds, enough for varied matches.
- **P1-02 UX feedback** — card selection/targets, current turn, mana, errors and combat log/status are clear.
- **P1-03 Responsive** — usable on desktop plus a typical phone in landscape/portrait without critical controls offscreen.
- **P1-04 Disconnect** — disconnect does not crash room; player gets clear state, short grace/rejoin path if feasible.
- **P1-05 Rematch** — both players can rematch without restarting server/browser.
- **P1-06 Return lobby** — leave/finished room can return to clean lobby.
- **P1-07 Network smoke** — automated two-socket smoke test covers room→play→turn→state sync.
- **P1-08 Rules tests** — core has regression tests for every card effect primitive and main illegal actions.
- **P1-09 No P0 defects** — reviewer reports no BLOCKER/HIGH gameplay/desync issue.
- **P1-10 Verify** — final `pnpm verify` passes.

## P2 — only after P0/P1

- animations/audio;
- deck builder/custom content editor;
- sophisticated ability scripting language;
- persistence/accounts/match history;
- spectator mode;
- matchmaking/internet deployment;
- polished original art pipeline;
- AI opponent.
