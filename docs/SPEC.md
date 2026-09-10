# MVP gameplay specification

This spec resolves unknown original details into explicit, testable web defaults. Confirmed public mechanics in
`GAME_RESEARCH.md` take priority. Unknown details below are intentionally configurable.

## Match constants (baseline)

- Players: 2
- Lanes: 4 mirrored lanes, chosen at room creation from a six-type pool (END-1)
- Lane pool: Antlion, Combine, Rebel, Zombie, Guardian, Wraith
- Default selection (no selection supplied): the classic four — Antlion, Combine, Rebel, Zombie; the board is
  always laid out in canonical pool order
- Starting HP: 30 (web default; not claimed original)
- Mana cap: 10 (web default; not claimed original)
- Starting hand: 4
- Draw: 1 at the start of each player's turn
- Hand soft cap: 10; excess draw is discarded/logged
- First active player: chosen deterministically from match seed for tests; randomized for normal rooms
- Player's first turn starts with 1/1 mana. Each subsequent personal turn increases max mana by 1 up to 10 and
  refills current mana to max.
- Deck exhaustion: draw a `Bucket` fallback rather than fatigue damage for baseline fidelity to the fallback idea.

## Lane model

The room creator picks exactly 4 of the 6 lane types in the pool (server-validated; an invalid selection — wrong
count, unknown type, or duplicate — is rejected with `INVALID_LANE_TYPES`). The engine re-validates in
`createGame` and normalizes the selection to canonical pool order. Rematches in a room keep the same selection.
Decks are built from universal cards plus cards of the four selected factions.

Each lane has one shared type and two sides. Each player may have at most:

- 1 unit in that lane;
- 1 building in that lane.

A non-universal unit can only be played into a lane matching its faction. Buildings/powers define their targeting
rules in data.

## Turn flow

1. Start turn: increment/refill mana, draw one card, apply start-turn building effects, age surviving units.
2. Action phase: active player may play any number of affordable legal cards and activate legal specials.
3. End turn: active player's surviving units attack lane-by-lane from index 0→3.
4. If opposing unit exists, attacker deals its current ATK to that unit. Baseline has **no automatic retaliation**;
   the opponent attacks on its own turn. Dead units are removed immediately after each lane resolves.
5. If no opposing unit exists at attack resolution, deal ATK to opposing hero.
6. If hero HP <= 0, end match immediately. Otherwise pass active player and begin their turn.

This attack timing is a web-baseline choice because exact original timing is not reliably confirmed in public
text. Keep combat isolated so it can be changed without rewriting networking/UI.

## Card kinds

### Unit

Required data: cost, faction/universal, ATK, HP. Optional special.

Special baseline rules:

- unit must have `turnsSurvived >= 1`;
- active player must own the unit;
- pay special mana cost;
- decrement remaining uses;
- validate target according to special effect data;
- special does not itself end the turn.

### Building

Can be placed in the player's building slot on a lane. It is not damaged by normal unit attacks. Passive effects
are defined by card data and invoked at start-turn or combat calculation. A power can explicitly destroy one.

### Power

One-shot card. Pay mana, validate target, resolve immediately, move card to discard.

## Baseline card/effect vocabulary

Keep the engine data-driven but intentionally small for the overnight build:

- `damage-unit`
- `damage-hero`
- `heal-unit`
- `buff-unit`
- `draw`
- `destroy-building`
- `heal-own-lane-unit-at-turn-start` (building)
- `attack-bonus-own-lane` (building)

Do not build a general scripting language until P0/P1 acceptance is complete.

## Visibility

A player may see:

- full public board, **both players' current HP and current mana**, and the current active player;
- their own full hand;
- their own exact deck count, not order;
- opponent hand count and deck count, never card identities/order.

The server must produce a per-player sanitized view.

Enforcement (`engine.toClientView`): each player sees their own current HP/mana **and the opponent's real current HP
and real current mana** (`maxMana` is also always reported). The opponent's hand is `null` (card identities hidden),
while hand and deck counts are still shown. Showing the opponent's current HP/mana is a web-baseline choice (a
supersession of the earlier max-only baseline); it is not claimed as original.

## Networking/revision rules

- Every canonical game mutation increments `revision` exactly once.
- Server broadcasts a fresh per-player view after accepted actions.
- Client actions include only intent data + known `revision` where practical.
- Stale revision actions are rejected with a recoverable error and a fresh state snapshot.
- Duplicate/out-of-turn/illegal actions are rejected without mutating state.

## Room lifecycle

- Create room → 6-character code.
- Join room by code.
- Auto-start when exactly two connected players are present.
- **Disconnect + rejoin grace (P1-04 baseline):**
   - On create/join the server issues a single-use rejoin token for the seat and sends it to the client
     (`session:identity`); the client persists `{ code, playerId, token }` to `localStorage` (`qcw.session`).
     Two tabs of the same browser share that single session slot, so play two players on separate devices or
     in private windows (documented MVP limitation).
  - A socket disconnect (pre-game OR in-game) marks the player disconnected, **keeps the seat** (`connected: false`,
    visible in the lobby room view), and arms the grace window for that seat.
  - The grace window defaults to **120 seconds** and is configurable server-side (module constant / service property;
    no env plumbing in the MVP).
  - A client that reconnects (socket.io auto-reconnect or page reload) emits `room:rejoin { code, token }`. On
    success the seat reattaches to the new socket, `connected` becomes true again, and the client receives the same
    room + game views a fresh joiner gets, plus a fresh token. On failure the server emits `server:error` with
    `REJOIN_INVALID`, `REJOIN_EXPIRED` or `ROOM_NOT_FOUND`; the client clears the stored session and shows the lobby.
  - When the grace window elapses: pre-game → the seat is removed (the room is deleted if empty and the remaining
    player is notified); in-game → the match **auto-forfeits** to the remaining connected player with a log entry
    "… forfeited (opponent did not rejoin)", and the final view is broadcast.
  - An explicit "Leave room" is not a disconnect: pre-game the seat is dropped immediately, the rejoin session is
    cancelled, and the stored client session is cleared. **In-game, an explicit leave forfeits the match
    immediately** to the remaining connected player (same forfeit + log + broadcast path as grace expiry) — a
    deliberate leave can never leave the opponent stuck in a `playing` match against an un-rejoinable seat. If no
    connected player remains after the leave, the room is deleted.
- At game over both players can request rematch; when both accept, create a fresh seeded match with same players.
- Baseline: a rematch is rejected while the opponent's socket is disconnected (e.g. they "Return to lobby"), so a
  single connected player can never start a solo game. Both players must be connected to accept.
- Either player can leave back to lobby.

## Content target for overnight build

Minimum playable catalog: 24–32 cards total, spread across four factions + universal, all 3 card kinds, and at
least 6 units with specials. Exact balance is secondary to diversity and correctness.
