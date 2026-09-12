import { getCard } from './cards';
import { applyAction, effectiveAttack } from './engine';
import {
  BuildingCardDefinition,
  CardDefinition,
  Effect,
  GameAction,
  GameState,
  LaneState,
  PlayerId,
  PowerCardDefinition,
  UnitCardDefinition,
} from './types';

/** Display name of the solo AI seat (shared so the client can recognize solo matches). */
export const AI_PLAYER_NAME = 'AI Opponent';

/**
 * M4 — deterministic solo-AI policy with lane/target heuristics.
 *
 * Chooses exactly ONE action per call; the server drives one call per tick
 * (~700 ms) so the AI plays at a readable pace. Legality is never
 * re-implemented here: every candidate is validated by trial-applying it
 * through `applyAction` (which is pure — it clones before mutating), and the
 * first candidate that applies cleanly wins. When nothing else is legal the
 * AI ends its turn, so a solo match can never wedge on the AI's turn.
 *
 * Policy (greedy spend, heuristic placement):
 *   1. Play the highest-cost hand card with a legal play, choosing the lane
 *      / target with the best score (see scoreUnitLane / chooseTarget).
 *   2. Otherwise activate the best ready special (same target scorers).
 *   3. Otherwise end the turn.
 *
 * No Math.random anywhere: every choice is a total order over the board, so
 * identical states yield identical actions.
 */
export function chooseAiAction(state: GameState, playerId: PlayerId): GameAction | null {
  if (state.status !== 'playing' || state.activePlayerId !== playerId) return null;
  const player = state.players[playerId];
  const revision = state.revision;

  // 1) Cards, highest cost first (stable sort: ties keep hand order).
  const hand = [...player.hand].sort((a, b) => getCard(b.cardId).cost - getCard(a.cardId).cost);
  for (const handCard of hand) {
    const card = getCard(handCard.cardId);
    if (card.cost > player.mana) continue;
    const action = cardPlayAction(state, revision, playerId, handCard.uid, card);
    if (action && tryApply(state, action)) return action;
  }

  // 2) Specials: the best ready activation across all own lanes.
  const special = bestSpecialAction(state, revision, playerId);
  if (special && tryApply(state, special)) return special;

  // 3) End the turn (always legal on your own playing turn).
  return { type: 'end-turn', expectedRevision: revision, playerId };
}

/**
 * Build the play-card action for one hand card using heuristic lane/target
 * selection. Returns null when no candidate target exists (the card is then
 * skipped; the trial-apply in chooseAiAction is the final legality gate).
 */
function cardPlayAction(
  state: GameState,
  revision: number,
  playerId: PlayerId,
  handCardUid: string,
  card: CardDefinition,
): GameAction | null {
  if (card.kind === 'unit') {
    const laneIndex = bestScoringLane(state, playerId, card.faction, (lane) =>
      scoreUnitLane(state, lane, playerId, card),
    );
    if (laneIndex === null) return null;
    return { type: 'play-card', expectedRevision: revision, playerId, handCardUid, laneIndex };
  }
  if (card.kind === 'building') {
    const laneIndex = bestScoringLane(state, playerId, card.faction, (lane) =>
      scoreBuildingLane(state, lane, playerId),
    );
    if (laneIndex === null) return null;
    return { type: 'play-card', expectedRevision: revision, playerId, handCardUid, laneIndex };
  }
  const power = card;
  const target = chooseTarget(state, playerId, power.target, power.effects);
  if (!target) return null;
  if (target.laneIndex === undefined) {
    // 'none' and 'enemy-hero' powers need no lane.
    return { type: 'play-card', expectedRevision: revision, playerId, handCardUid };
  }
  return {
    type: 'play-card',
    expectedRevision: revision,
    playerId,
    handCardUid,
    laneIndex: target.laneIndex,
    targetLaneIndex: target.laneIndex,
  };
}

/**
 * M4 lane selection for units. A lane scores higher when:
 *  - playing here KILLS the occupant next turn (stagger: a fresh unit attacks
 *    from its owner's NEXT turn) — the strongest incentive, plus the threat
 *    the occupant was dealing and any drawOnKill value;
 *  - the occupant threatens the hero and the new unit SURVIVES its hit
 *    (block value scales with the damage prevented per turn);
 *  - the occupant is a strong threat but would kill the new unit without being
 *    killed in return — it still blocks one turn, so it scores the threat
 *    value minus a dead-weight penalty;
 *  - the lane is open — a small face-pressure bonus.
 * Faction/lane-type legality is pre-filtered by bestScoringLane; the trial
 * apply in chooseAiAction remains the authoritative gate.
 */
function scoreUnitLane(state: GameState, lane: LaneState, playerId: PlayerId, card: UnitCardDefinition): number {
  if (lane.sides[playerId].unit) return -1000; // unit slot already occupied
  const enemyId = otherPlayerId(state, playerId);
  const enemyUnit = lane.sides[enemyId].unit;
  const myAtk = landingAttack(state, lane, playerId, card);

  let score = 0;
  if (enemyUnit) {
    const threat = effectiveAttack(state, lane, enemyId);
    if (myAtk >= enemyUnit.health) {
      // Wins the fight next turn: kill bonus plus the threat it was dealing.
      score += threat + 4 + (card.drawOnKill ?? 0) * 2;
    } else if (threat >= card.health) {
      // Outclassed: dies next turn without a trade. Still absorbs one turn of
      // damage, but is mostly dead weight.
      score += threat - 8;
    } else {
      // Survives at least one hit: a solid block.
      score += threat + 2;
    }
  } else {
    score += 1; // open lane: face pressure from next turn.
  }

  // GA-4a onPlay targeting: 'enemy-unit' requires an occupant (the engine
  // fails the play atomically otherwise), and the effect is worth something.
  if (card.onPlay) {
    if (card.onPlay.target === 'enemy-unit') {
      if (!enemyUnit) return -1000;
      score += 2;
    }
    // 'self' / 'enemy-hero' / 'none' / 'friendly-unit' impose no lane constraint.
  }

  // GA-4b swarm: board presence makes swarm units stronger; prefer playing
  // when friendlies are already on the board.
  if (card.swarm) score += 0.5 * countUnits(state, playerId);

  return score;
}

/**
 * M4 lane selection for buildings: they only help the unit in their own lane,
 * so prefer a lane that already has a friendly unit, then a contested lane,
 * then any free building slot.
 */
function scoreBuildingLane(state: GameState, lane: LaneState, playerId: PlayerId): number {
  if (lane.sides[playerId].building) return -1000; // building slot occupied
  let score = 0;
  if (lane.sides[playerId].unit) score += 4; // immediately useful
  const enemyId = otherPlayerId(state, playerId);
  if (lane.sides[enemyId].unit) score += 2; // contested lane: the bonus/heal will matter
  return score;
}

/**
 * M4 target selection for powers (and specials, via bestSpecialAction).
 * Returns the best lane (undefined lane = 'none'/'enemy-hero'/'self' target)
 * with a score, or null when no candidate target exists at all.
 */
function chooseTarget(
  state: GameState,
  playerId: PlayerId,
  target: PowerCardDefinition['target'] | 'self',
  effects: readonly Effect[],
): { laneIndex?: number; score: number } | null {
  const enemyId = otherPlayerId(state, playerId);
  switch (target) {
    case 'none':
    case 'enemy-hero':
    case 'self':
      return { score: 0 };
    case 'enemy-unit': {
      let best: { laneIndex: number; score: number } | null = null;
      for (const lane of state.lanes) {
        const unit = lane.sides[enemyId].unit;
        if (!unit) continue;
        const score = scoreEnemyUnit(state, lane, playerId, effects);
        if (!best || score > best.score) best = { laneIndex: lane.index, score };
      }
      return best;
    }
    case 'friendly-unit': {
      let best: { laneIndex: number; score: number } | null = null;
      for (const lane of state.lanes) {
        const unit = lane.sides[playerId].unit;
        if (!unit) continue;
        const score = scoreFriendlyUnit(state, lane, playerId, effects);
        if (!best || score > best.score) best = { laneIndex: lane.index, score };
      }
      return best;
    }
    case 'lane': {
      // AOE: hit the lane with the most enemy value (effective attack + HP).
      let best: { laneIndex: number; score: number } | null = null;
      for (const lane of state.lanes) {
        const enemy = lane.sides[enemyId].unit;
        if (!enemy) continue; // nothing enemy-side to hit
        const score = effectiveAttack(state, lane, enemyId) + enemy.health;
        if (!best || score > best.score) best = { laneIndex: lane.index, score };
      }
      return best;
    }
    case 'enemy-building': {
      for (const lane of state.lanes) {
        if (lane.sides[enemyId].building) return { laneIndex: lane.index, score: 0 };
      }
      return null;
    }
  }
}

/**
 * Score an enemy unit as a target. Base weight is its effective attack (the
 * biggest threats matter most for stun/debuff/dot). Lethal damage and
 * destroy-unit get large bonuses; bounce prefers units that threaten the hero
 * (an unblocked lane).
 */
function scoreEnemyUnit(
  state: GameState,
  lane: LaneState,
  playerId: PlayerId,
  effects: readonly Effect[],
): number {
  const enemyId = otherPlayerId(state, playerId);
  const unit = lane.sides[enemyId].unit;
  if (!unit) return -1000;
  let score = effectiveAttack(state, lane, enemyId) * 2;
  for (const effect of effects) {
    if (effect.type === 'stun' && unit.stun) return -1000; // already stunned: do not waste
    if (effect.type === 'damage-unit' && effect.amount >= unit.health) score += 10; // lethal
    if (effect.type === 'destroy-unit') score += 8;
    if (effect.type === 'debuff-unit' && unit.attack > 0) score += 1;
    // Bouncing a unit that threatens the hero (unblocked lane) frees the lane.
    if (effect.type === 'bounce-unit' && !lane.sides[playerId].unit) score += 5;
  }
  return score;
}

/**
 * Score a friendly unit as a target: heals go to the most wounded (a full
 * unit is never chosen), buffs go to the strongest unit.
 */
function scoreFriendlyUnit(state: GameState, lane: LaneState, playerId: PlayerId, effects: readonly Effect[]): number {
  const unit = lane.sides[playerId].unit;
  if (!unit) return -1000;
  const hasHeal = effects.some((effect) => effect.type === 'heal-unit');
  const hasBuff = effects.some(
    (effect) => effect.type === 'buff-unit' && (effect.attack > 0 || effect.health > 0),
  );
  if (hasHeal) {
    const missing = unit.maxHealth - unit.health;
    if (missing <= 0) return -1; // at full health: do not waste
    return missing * 2;
  }
  if (hasBuff) return effectiveAttack(state, lane, playerId) * 2;
  return effectiveAttack(state, lane, playerId);
}

/**
 * Best ready special across all own lanes, using the same target scorers as
 * powers. Only ONE candidate per special (its best target); the trial-apply in
 * chooseAiAction is the final legality gate.
 */
function bestSpecialAction(
  state: GameState,
  revision: number,
  playerId: PlayerId,
): GameAction | null {
  let best: { action: GameAction; score: number } | null = null;
  for (const lane of state.lanes) {
    const unit = lane.sides[playerId].unit;
    if (!unit) continue;
    const card = getCard(unit.cardId);
    if (card.kind !== 'unit' || !card.special) continue;
    const special = card.special;
    if (unit.turnsSurvived < 1 || unit.specialUsesRemaining <= 0) continue;
    if (state.players[playerId].mana < special.cost) continue;

    const target = chooseTarget(state, playerId, special.target, special.effects);
    if (!target) continue;

    const action: GameAction = {
      type: 'activate-special',
      expectedRevision: revision,
      playerId,
      laneIndex: lane.index,
    };
    if (special.target === 'self') {
      action.targetLaneIndex = lane.index;
    } else if (special.target !== 'none' && special.target !== 'enemy-hero') {
      // enemy-unit / friendly-unit: use the chosen target lane.
      if (target.laneIndex === undefined) continue;
      action.targetLaneIndex = target.laneIndex;
    }
    if (!best || target.score > best.score) best = { action, score: target.score };
  }
  return best ? best.action : null;
}

/**
 * The attack a freshly-played unit would land with in `lane`: card attack +
 * own-lane building bonus + swarm bonus (swarm × other friendly units, any
 * lane). Mirrors the engine's effectiveAttack for a unit that is NOT yet on
 * the board (so the swarm count is the OTHER friendlies).
 */
function landingAttack(state: GameState, lane: LaneState, playerId: PlayerId, card: UnitCardDefinition): number {
  let total = card.attack;
  const building = lane.sides[playerId].building;
  if (building) {
    const buildingCard = getCard(building.cardId) as BuildingCardDefinition;
    if (buildingCard.passive.type === 'attack-bonus-own-lane') {
      total += buildingCard.passive.amount;
    }
  }
  if (card.swarm) total += card.swarm * countUnits(state, playerId);
  return Math.max(0, total);
}

function countUnits(state: GameState, playerId: PlayerId): number {
  return state.lanes.filter((lane) => lane.sides[playerId].unit).length;
}

/**
 * Pick the highest-scoring lane where the card is legally placeable (faction
 * matches the lane type). Occupied-slot and onPlay-target vetoes come from the
 * score itself (negative below VETO_SCORE). Ties keep the lowest lane index
 * (total order → deterministic).
 */
const VETO_SCORE = -500;

function bestScoringLane(
  state: GameState,
  playerId: PlayerId,
  cardFaction: string,
  scoreLane: (lane: LaneState) => number,
): number | null {
  let best: { index: number; score: number } | null = null;
  for (const lane of state.lanes) {
    if (cardFaction !== 'universal' && cardFaction !== lane.type) continue; // WRONG_LANE_TYPE
    const score = scoreLane(lane);
    if (score < VETO_SCORE) continue; // occupied slot / missing onPlay target
    if (!best || score > best.score) best = { index: lane.index, score };
  }
  return best ? best.index : null;
}

/**
 * Trial-apply an action. `applyAction` is pure (clones before mutating), so a
 * passing OR failing trial leaves `state` untouched; the caller re-applies the
 * returned action for real.
 */
function tryApply(state: GameState, action: GameAction): boolean {
  try {
    applyAction(state, action);
    return true;
  } catch {
    return false;
  }
}

function otherPlayerId(state: GameState, playerId: PlayerId): PlayerId {
  return state.playerOrder[0] === playerId ? state.playerOrder[1] : state.playerOrder[0];
}
