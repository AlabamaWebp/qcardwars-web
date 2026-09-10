# Architecture

## Design goal

Optimize for one unattended night of implementation and a reliable LAN game, not internet-scale deployment.

## Workspace

```text
apps/web       Angular standalone UI
apps/server    NestJS HTTP + Socket.IO authoritative server
packages/game-core  pure-ish rules/types/card catalog
```

## Authority boundary

The server owns `Room` and `GameState`. The Angular app never mutates game state optimistically beyond transient
selection/animation state. It submits intents (`play-card`, `activate-special`, `end-turn`) and renders the next
server snapshot.

This is intentionally snapshot-first rather than event-sourcing. At this scale a full state is small, and fresh
snapshots eliminate a large class of missed-event/desync bugs.

## Game core

`packages/game-core` should contain:

- canonical domain types;
- constants/config;
- card catalog/data;
- deterministic deck generation/shuffle from injected seed;
- `createGame`;
- `applyAction` and legal-action validation;
- turn/combat/effect resolution;
- state sanitization (`toClientView`);
- tests.

No sockets, Angular, Nest decorators or filesystem access in core.

## Server

`GameService` maps room codes and socket IDs to players/rooms. Gateway responsibilities:

- create/join/leave/rejoin/rematch commands;
- validate membership and route game intents;
- call core engine only on server;
- broadcast personalized room/game snapshots;
- return recoverable errors rather than crash the socket handler.

For MVP, in-memory state is correct. Persistence/auth/accounts are intentionally out of scope.

## Client

Client state should have three layers:

1. connection/lobby state;
2. latest server `ClientGameView`;
3. local-only UI state (selected hand card, target lane, animation/toast).

Avoid duplicating rule legality in complex client code. It is fine to use server-sent state to disable obviously
illegal controls, but the server remains final authority.

## Production LAN serving

Build Angular first. Nest/Express static serving points at `apps/web/dist/web/browser`, allowing one `:3000` origin for
HTTP and Socket.IO. Development keeps Angular on `:4200` and Nest on `:3000`.

## Testing strategy

Highest ROI order:

1. pure core unit tests (actions, turn, combat, special readiness, building/power effects, win);
2. server service/gateway integration tests for room membership and illegal actions;
3. 2-socket smoke test;
4. browser e2e (`pnpm e2e`): two-client match smoke, reload rejoin, solo AI.

UI unit-test breadth is lower priority than an actual two-client match smoke test.

## Browser e2e (how to run)

`pnpm e2e` (root script; **not** part of `pnpm verify` — it is slow) builds game-core, spawns isolated
dev servers (Nest on `PORT=3111`, Angular on `:4222`), and drives the system Chrome via
`puppeteer-core` (no bundled browser; override with `CHROME_PATH`). Each client gets an isolated browser
context (a shared context shares localStorage and would hijack the other seat's rejoin session). The app
loads with `?backendPort=3111`, which points Socket.IO at the isolated server port; without the parameter
the defaults are unchanged (`:4200` → `:3000`, otherwise same origin). Ports are overridable via
`E2E_SERVER_PORT` / `E2E_WEB_PORT`. Specs: (A) two clients create/join and play a full lock-step match to a
shared Victory/Defeat; (B) two-player room, mid-match reload auto-rejoins with the board restored and no
lobby flash (solo rooms are destroyed on human disconnect by design, so rejoin is only meaningful in 2P);
(C) solo vs AI with the AI acting without human input and no console errors.

## Gotchas / non-obvious invariants

These bite fresh edits. Keep them green.

- **Engine is pure/immutable.** Every resolver returns a new state; the caller must assign it
  (`room.game = applyAction(room.game, action)`). Throwing away the return loses the whole turn.
- **Exact two-player game.** `createGame` builds a 2-player game and a room only auto-starts with exactly two
  connected players. No 3+ player support by design.
- **One revision per mutation.** `revision` increments exactly once per canonical game mutation; the client must echo
  the latest revision or the intent is rejected as stale.
- **Sanitized views.** `toClientView` gives each player their own HP/mana/hand and the opponent only max HP
  (`config.startingHp`) + max mana + counts; opponent hand is `null`. This is per `SPEC.md` Visibility.
- **Rematch requires both connected.** `rematch` throws `NOT_CONNECTED` if any player is disconnected, so a departed
  socket can never be revived into a solo game.
- **Deterministic by seed.** Tests/smoke use seed `20240517`; the 2-client smoke binds an ephemeral port with the
  Socket.IO adapter and asserts lock-step to a shared victory.
- **Draw fallback.** `drawOne` returns a `'bucket'` placeholder when a deck is empty (no fatigue).
- **Hero damage.** Only `enemy-hero` powers/damage specials harm heroes; units attack units only.
