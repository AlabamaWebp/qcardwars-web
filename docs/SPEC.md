# MVP gameplay specification

This spec resolves unknown original details into explicit, testable web defaults. Confirmed public mechanics in
`GAME_RESEARCH.md` take priority. Unknown details below are intentionally configurable.

## Match constants (baseline)

- Players: 2
- Lanes: 4 mirrored lanes
- Default lane order: Antlion, Combine, Rebel, Zombie
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

- full public board and both HP/mana maximums/current active player;
- their own full hand;
- their own exact deck count, not order;
- opponent hand count and deck count, never card identities/order.

The server must produce a per-player sanitized view.

Enforcement (`engine.toClientView`): each player sees their own current HP/mana; the opponent's HP is shown only as
`config.startingHp` (maximum) and their mana only as `maxMana`; the opponent's hand is `null` (card identities hidden),
while hand and deck counts are still shown. Showing the opponent's *current* HP/mana is not claimed as original.

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
- Disconnect marks player disconnected; keep room for a short grace period (P1). Rejoin token support is P1.
- At game over both players can request rematch; when both accept, create a fresh seeded match with same players.
- Baseline: a rematch is rejected while the opponent's socket is disconnected (e.g. they "Return to lobby"), so a
  single connected player can never start a solo game. Both players must be connected to accept.
- Either player can leave back to lobby.

## Content target for overnight build

Minimum playable catalog: 24–32 cards total, spread across four factions + universal, all 3 card kinds, and at
least 6 units with specials. Exact balance is secondary to diversity and correctness.
