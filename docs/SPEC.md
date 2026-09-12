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
- Starting hand: 4; the second player draws one extra card at match start (second-player compensation)
- Draw: 1 at the start of each player's turn
- Hand soft cap: 10; excess draw is discarded/logged
- First active player: chosen deterministically from match seed for tests; randomized for normal rooms
- Player's first turn starts with 1/1 mana. Each subsequent personal turn increases max mana by 1 up to 10 and
  refills current mana to max.
- Deck exhaustion (finite-deck fatigue, supersedes the old `Bucket` fallback baseline): decks are finite. Drawing
  from an empty deck instead increments that player's `fatigue` counter by 1 and deals damage equal to the counter
  (1, 2, 3, …). Fatigue damage can end the match at 0 HP.
- Stagger: a freshly played unit arrives with `turnsSurvived` 0 and does NOT attack on the turn it is played; it
  attacks from its owner's next turn. It still blocks as a defender from the moment it is placed.
- War Drums escalation: from personal turn `escalationTurn` (default 15, configurable via
  `GameConfig.escalationTurn`) onward, at the start of each of that player's turns every surviving unit of that
  player gains +1 ATK permanently. Guarantees every match eventually resolves.

## Lane model

The room creator picks exactly 4 lane types from the 6-type pool (server-validated; an invalid selection — wrong
count or unknown type — is rejected with `INVALID_LANE_TYPES`). Lane types may now repeat (e.g. two antlion
lanes): the pick is a multiset, not a set of four distinct types, so a faction may fill more than one lane. The
engine re-validates in `createGame` and normalizes the selection to canonical pool order while preserving
multiplicities. Rematches in a room keep the same selection. Decks are built from universal cards plus cards of the
selected lane factions only, so a card from a lane type the room is not using can never be drawn.

Each lane has one shared type and two sides. Each player may have at most:

- 1 unit in that lane;
- 1 building in that lane.

A non-universal unit can only be played into a lane matching its faction. Buildings/powers define their targeting
rules in data.

## Turn flow

1. Start turn: increment/refill mana, draw one card (fatigue damage if the deck is empty), apply start-turn
   building effects, apply War Drums escalation when due, age surviving units (`turnsSurvived` +1), tick any
   damage-over-time on this player's units.
2. Action phase: active player may play any number of affordable legal cards and activate legal specials.
3. End turn: active player's surviving units attack lane-by-lane from index 0→3.
4. If opposing unit exists, attacker deals its effective ATK (base + own-lane building bonus + swarm bonus) to that
   unit. Baseline has **no automatic retaliation**; the opponent attacks on its own turn. Dead units are removed
   immediately after each lane resolves. A unit that kills an enemy unit triggers its owner's `drawOnKill` if set.
5. Staggered units (`turnsSurvived` 0) skip their attack; a stunned READY unit skips its attack and the stun slot
   ticks down (a staggered stunned unit keeps its slot — it had no attack to skip).
6. If no opposing unit exists at attack resolution, deal ATK to opposing hero.
7. If hero HP <= 0, end match immediately. Otherwise pass active player and begin their turn.

This attack timing is a web-baseline choice because exact original timing is not reliably confirmed in public
text. Keep combat isolated so it can be changed without rewriting networking/UI.

## Card kinds

### Unit

Required data: cost, faction/universal, ATK, HP. Optional special.

Optional keyword fields (all data-driven, engine-enforced):

- `onPlay`: effect applied immediately after placement. Targeting is lane-relative only (`'self'`,
  `'friendly-unit'`, `'enemy-unit'` in the played lane, `'enemy-hero'`, or `'none'`). Target validation happens
  BEFORE placement: if the required target is missing the whole play fails atomically (no mana spent, no unit
  placed).
- `swarm`: +N ATK per OTHER friendly unit anywhere on the board (included in the unit's effective ATK).
- `drawOnKill`: draws N cards when this unit destroys an enemy UNIT in combat.

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

## Card/effect vocabulary

The engine is data-driven. The full supported effect set:

- `damage-unit`, `damage-hero`
- `aoe` (lane-wide damage to every enemy unit in the target lane)
- `heal-unit`, `heal-hero`
- `buff-unit` (`attack`, `health`), `debuff-unit`
- `dot` (`amount` per turn, `turns`; a new dot REPLACES an existing one — dots never stack)
- `stun` (`turns`; the target skips its next attack(s) on ready turns; a new stun REPLACES an existing one)
- `bounce-unit` (removed from the lane; a FRESH hand card with new uid returns to the owner — buffs/dots/stuns are
  lost; discarded if the owner's hand is full)
- `discard-random` (`amount`; the opponent discards that many random cards — seeded, deterministic; whole hand if
  fewer)
- `draw`, `gain-mana`, `add-card` (specific cardId), `destroy-unit`, `destroy-building`
- Building passives: `heal-own-lane-unit-at-turn-start`, `attack-bonus-own-lane`

Do not build a general scripting language; extend only by adding discrete, tested primitives like the above.

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

The client view exposes server-computed per-unit fields (`ClientUnitView`): `effectiveAtk` (base + own-lane building
bonus + swarm), `turnsSurvived`, and the current `stun`/`dot` slots, plus per-player `fatigue`. Clients DISPLAY these
values; they must never recompute rules locally (effective attack, stagger, stun/dot ticks are authoritative).

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

## Content

Catalog: 87 cards (72 baseline + 15 gameplay-depth cards from the M1–M2 depth pass), all six lane factions +
universal, all 3 card kinds, many units with specials. Decks contain one copy of every card whose faction is in
play. Balance is maintained by the AI-vs-AI simulation harness (see below); the current measured state and the
last balance pass are recorded in `docs/balance-notes.md`.

## Solo AI (M4)

The server can fill the second seat with a deterministic heuristic AI (no `Math.random`; fully seed-driven for
reproducibility). `chooseAiAction(state, playerId)` returns exactly one legal action (or an end-turn intent) using:

- lane scoring for plays: kill priority (stagger-aware landing attack), outmatched-lane avoidance, block value,
  `onPlay` target vetoes, swarm/board-presence bonus, building co-location;
- target scoring for powers/specials: stun the highest effective-attack enemy, lethal/destroy bonuses, bounce
  unblocked threats, heal the most-wounded ally, buff the strongest ally, AOE → highest enemy value in a lane;
- negative target scores are hard vetoes (a card is never wasted on an already-stunned enemy or a full-health
  ally);
- every candidate is trial-applied against a pure clone of the state before being returned, so legality is always
  engine-validated; fallback is end-turn.

## Simulation harness (M4)

`simulation.ts` drives real engine matches (AI vs AI, seeded decks, 4000-action cap per game) and reports seat
win counts, first-mover win rate, turn-length distribution, capped-game count, per-seat damage, and top card
frequency. Run: `pnpm --filter @qcw/game-core sim <games> <seed>` (default 400 games, seed 1000). Identical seeds
produce identical reports (determinism is pinned by tests). Use it before/after any catalog or stat change;
treat per-card play-rate as an AI artifact (the policy is cost-greedy) and anchor balance decisions on structural
metrics (seat symmetry, first-mover rate, stall/cap rate, turn length).
