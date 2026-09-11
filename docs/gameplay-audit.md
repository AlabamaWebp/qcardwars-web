# QCardWars gameplay audit

Scope: deep review of the current rule system, card catalog, interaction design, pacing, comeback
potential, match-to-match variation, and gameplay UX. Findings are concrete, tied to code locations,
and each has a proposed fix. This audit drives the improvement plan implemented alongside this document.

Sources reviewed:

- `packages/game-core/src/engine.ts` (turn flow, combat, effects, deck/draw)
- `packages/game-core/src/cards.ts` (72-card catalog)
- `packages/game-core/src/types.ts` (rule data model, `GameConfig`)
- `packages/game-core/src/ai.ts` (solo AI policy)
- `apps/web/src/app/game.component.ts` (board/hand/log UI)
- `docs/SPEC.md` (baseline rules), `docs/ACCEPTANCE.md` (current state)

## Current loop (as implemented)

Each player: pick up to one unit + one building per lane (4 lanes), then **End turn** — all of the
active player's units automatically deal ATK to the opposing lane's unit (or the hero if the lane is
open). No retaliation. Units played this turn attack immediately at end of turn. Mana ramps 1→10.
Draw 1/turn from a 36-card deck; an exhausted deck falls back to infinite `bucket` filler. Victory at
0 hero HP (30).

## Findings

### GA-1 — Combat has no decisions (CRITICAL)

`resolveCombat` (engine.ts:492) attacks unconditionally with every unit every turn, and units attack
the very turn they are played (`turnsSurvived === 0`). The entire turn reduces to: spend mana on the
most expensive affordable card, end turn. There is no tempo tradeoff, no "attack vs. develop", no
reason to hold a card. Consequences:

- Aggro snowballs: a 4/1 (wraith-stalker) played on turn 2 hits for 4 on turn 2.
- Playing a body into a threatened lane has no defensive timing value — you could play it 3 turns
  earlier with the same result, so "when" never matters, only "what".
- Specials already require surviving one turn (`SPECIAL_NOT_READY`), so attack timing and special
  timing are inconsistent.

**Fix (GA-1a): stagger rule.** A unit with `turnsSurvived === 0` does not attack at end of turn; it
"arrives" and attacks from its owner's next turn. This creates the core decision the game is missing:
play a body **now** to block a lane (absorb direct hero damage) at the cost of tempo, or hold cards
and mana to push. It aligns with the existing special-readiness rule and weakens pure aggro
automatically (better comeback, see GA-3).

### GA-2 — No interaction: the game is two solitaire board races (CRITICAL)

The only ways to affect an enemy unit are: kill it in combat, `debuff-unit`, `dot`, `aoe`,
`destroy-unit` (one special, Juggernaut), `execution-protocol` (5-mana power). There is no way to
remove a unit without damage, no way to disable it without damage, and no way to attack hand/mana
resources. Once both sides fill their 8 slots (~turn 6-10) the match becomes a deterministic damage
clock: every remaining turn is the same, with only special/power timing left. Mid-late game has
near-zero decision density.

**Fixes (GA-2a/b/c): three new interaction primitives**, all data-driven in the existing
`Effect` union, no new targeting UI (unit targets reuse the lane-target flow already used by powers
and specials):

- `stun` (turns): the unit skips its next N owner-turn attacks (slot on `UnitInstance`, like `dot`;
  decremented/cleared when the skipped attack would happen). Cheap tempo tool for control.
- `bounce-unit`: return the target unit to its owner's hand (buffs lost; discarded if hand full).
  Non-lethal removal — strong answer to big bodies, and the unit can come back, so it's a trade, not
  a burn.
- `discard-random` (amount): opponent discards N random cards (seeded shuffle → deterministic).
  Hand disruption for control.

Supporting content (M2) gives each faction access: universal powers *Recall Beam* (bounce) and
*Stasis Field* (stun), *Terror Raid* (discard), plus faction specials using the same primitives.

### GA-3 — No comeback: open lanes compound forever (HIGH)

Direct hero damage from open lanes is permanent and compounding: each new open lane the leader
establishes adds ATK to their damage-per-turn with no answer other than matching bodies (which now
stagger, GA-1a). There is no card-advantage tool for the loser (no trades that pay), no end-game
pressure on the winner, and deck exhaustion is *free* (infinite `bucket`), so a stalling side can
torture the match indefinitely with zero risk.

**Fixes:**

- **GA-3a — finite deck + fatigue.** The 36-card deck is the deck. Drawing from an empty deck deals
  escalating fatigue damage (1, 2, 3, …) to your own hero (`PlayerState.fatigue`). Ends stalemates,
  punishes infinite stalling, and makes the last third of the deck meaningful. (Supersedes the
  `bucket` fallback in SPEC.md; `bucket` remains a normal rare card in decks.)
- **GA-3b — trades pay: `drawOnKill`.** Units with `drawOnKill: N` draw N when they destroy an enemy
  unit in combat. Gives the losing side a card-advantage engine if it can win trades — real comeback
  via play, not rubber-banding.
- **GA-3c — global escalation ("War Drums").** From `config.escalationTurn` (default 15), at the
  start of each player's turn every surviving unit of that player gains +1 ATK (permanent, logged).
  Guarantees every match resolves, accelerates the endgame, and rewards keeping bodies alive.

### GA-4 — Cards don't combine: everything is independent (HIGH)

No card has a conditional or on-play effect; the catalog is 72 self-contained stat lines plus
specials. There is no "play A to set up B" sequencing, no board-wide synergy, no reason for a curve
beyond cost. Every hand is the same shape: bodies, then a big body.

**Fixes:**

- **GA-4a — `onPlay` effects on units.** A unit may define `onPlay: { target, effects }` with
  lane-relative targets (`none`, `self`, the enemy unit in the lane it's played into, a friendly unit
  in that lane). No new UI: the placement click already carries `laneIndex`. Creates instant
  sequencing decisions — e.g. a unit that deals 1 damage to the occupant of its lane on play, a
  unit that draws on play, a 2-damage-into-face unit on play.
- **GA-4b — `swarm` synergy trait.** A unit with `swarm: N` gets +N ATK per other friendly unit on
  the board (computed in combat + exported helper for the UI). Board presence becomes strategically
  valuable beyond single-lane blocking, and the opponent's board-wide tools (GA-2 stun/bounce)
  gain weight.

### GA-5 — Weak/absent match-to-match variation (MEDIUM)

Variation exists only via lane selection (multiset of 4 from 6) and first-player (seed parity).
Decks are 12 random-with-replacement per tier, so decks differ, but the *shape* of every match is
identical: same curve, same endgame, same damage clock. First player also has an uncompensated
initiative advantage (acts first, attacks first, open-lane pressure first).

**Fixes:**

- **GA-5a — second player +1 starting card** (standard initiative compensation; logged at match
  start).
- **GA-5b — new content spread across tiers/factions** (M2) changes the deck shape per match.
- Lane selection + random first player already provide structural variance; the escalation turn
  (GA-3c) is deterministic and readable, deliberately not randomized.

### GA-6 — Pacing: front-load is flat, endgame is a clock (MEDIUM)

Turns 1-4 are near-empty (1-4 mana, no threats can land before ~turn 3). The endgame (GA-3) is a
deterministic clock. With GA-1a (stagger) the early game slows further, so compensation comes from:
on-play effects (GA-4a) giving turn-2 cards immediate bite, the escalation (GA-3c) forcing
resolution, and fatigue (GA-3a) capping the tail. Target shape: threats from turn 2 (on-play),
decision density from turn 3 (stagger blocking), resolution guaranteed by ~turn 25 (escalation +
fatigue).

### GA-7 — Catalog balance notes (LOW, verify by simulation)

- `wraith-stalker` 4/1 cost 2 — best raw ATK-per-cost; still acceptable after stagger (1 HP bait),
  re-check in simulation.
- `universal-mercenary` 3/3 cost 3 playable in **any** lane — strong vanilla, re-check.
- `power-overcharge` (cost 1, +2) / drone `overtap` — net +1 each; fine, but mana-flood curves are
  rare in the catalog, re-check.
- Decks sample **with replacement**, so duplicate cards and `bucket` filler are possible; acceptable
  for the baseline but simulation should confirm games don't feel stale.
- `zombie-titan` 6/10 cost 7 is a hard wall with no interaction answer pre-GA-2; bounce/stun give it
  an answer now.

### GA-8 — Gameplay UX readability gaps (MEDIUM, after rules land)

- No indicator for which units attack this turn (stagger will make this essential).
- ATK shown is raw; building + swarm bonuses are invisible until combat resolves.
- No fatigue/escalation state visible to players; escalation must be announced at match start.
- New statuses (stun) need the same badge treatment the poison dot already has.
- Log is the only combat explanation; new rules (stagger skip, stun skip, fatigue) must log clearly.

## Roadmap (implemented in this pass)

| Milestone | Content | Acceptance |
|---|---|---|
| M1 | Engine rules: stagger, finite deck + fatigue, second-player card, escalation, `stun`/`bounce-unit`/`discard-random` effects, `onPlay`/`swarm`/`drawOnKill` unit fields, `effectiveAttack` export | `pnpm --filter @qcw/game-core test` green; new behavior covered by tests; server/web typecheck green |
| M2 | ~14 new cards using the new mechanics across factions + targeted rebalances | Catalog guards + engine tests; no P0 legality gaps |
| M3 | Web: stagger/stun badges, effective ATK, fatigue + escalation visibility, log clarity | Browser verification desktop + mobile; no console/network errors |
| M4 | AI heuristics for the new tools + simulation harness (hundreds of games, stats) + 3 balance iteration cycles | Stats in `docs/gameplay-improvements.md`; no degenerate strategies in simulation |
| M5 | Docs (improvements report, SPEC update), `pnpm verify`, `pnpm e2e`, reviewer pass | Final gate green |

Priorities respected: gameplay depth/decisions (GA-1..GA-4) > balance (GA-7, M4) > UX (GA-8) >
visuals. No architecture changes: same stack, same authoritative server, same action protocol,
same 1v1/4-lane shape; all new rules are data-driven extensions of the existing engine.
