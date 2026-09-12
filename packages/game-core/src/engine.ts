import { CARD_BY_ID, CARD_CATALOG, getCard } from './cards';
import { shuffle } from './random';
import {
  BuildingCardDefinition,
  ClientGameView,
  ClientLaneState,
  Effect,
  GameAction,
  GameConfig,
  GameRuleError,
  GameState,
  HandCard,
  LaneState,
  PlayerId,
  PlayerState,
  PowerCardDefinition,
  SpecialDefinition,
  UnitCardDefinition,
  UnitInstance,
  LANE_TYPES,
  LaneType,
  DEFAULT_GAME_CONFIG,
} from './types';

export interface CreateGameOptions {
  roomCode: string;
  players: [{ id: string; name: string }, { id: string; name: string }];
  seed?: number;
  config?: Partial<GameConfig>;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function fail(code: string, message: string): never {
  throw new GameRuleError(code, message);
}

function uid(state: GameState, prefix: string): string {
  const value = `${prefix}-${state.nextUid}`;
  state.nextUid += 1;
  return value;
}

function addLog(state: GameState, text: string): void {
  state.log.push({ seq: state.log.length ? state.log[state.log.length - 1].seq + 1 : 1, text });
  if (state.log.length > 40) state.log.splice(0, state.log.length - 40);
}

function cardAllowedByLanes(cardId: string, laneTypes: readonly string[]): boolean {
  const card = getCard(cardId);
  return card.faction === 'universal' || laneTypes.includes(card.faction);
}

function buildDeck(state: GameState): HandCard[] {
  const eligible = CARD_CATALOG.filter((card) => cardAllowedByLanes(card.id, state.config.laneTypes));
  const tiers = [...new Set(eligible.map((card) => card.tier))].sort((a, b) => a - b);
  const cardIds: string[] = [];

  for (const tier of tiers) {
    const pool = eligible.filter((card) => card.tier === tier);
    if (!pool.length) continue;
    // Public author description: approximately 12 random matching cards from every tier.
    // We sample with replacement to keep the deck large even with a small placeholder catalog.
    let localSeed = state.seed + tier * 97 + state.nextUid * 13;
    for (let i = 0; i < 12; i += 1) {
      const shuffled = shuffle(pool, localSeed);
      localSeed = shuffled.seed;
      cardIds.push(shuffled.values[0].id);
    }
  }

  const shuffledDeck = shuffle(cardIds, state.seed + state.nextUid * 31);
  state.seed = shuffledDeck.seed;
  return shuffledDeck.values.map((cardId) => ({ uid: uid(state, 'card'), cardId }));
}

function drawOne(state: GameState, player: PlayerState): void {
  if (state.status === 'finished') return;
  const card = player.deck.shift();
  if (!card) {
    // GA-3a: finite deck — an exhausted deck deals escalating fatigue damage
    // (1, 2, 3, …) instead of drawing the old infinite 'bucket' filler.
    player.fatigue += 1;
    player.hp -= player.fatigue;
    addLog(state, `${player.name} has no cards left and suffers ${player.fatigue} fatigue damage.`);
    maybeFinish(state, player.id);
    return;
  }
  if (player.hand.length >= state.config.handCap) {
    player.discard.push(card);
    addLog(state, `${player.name} burns a draw because their hand is full.`);
    return;
  }
  player.hand.push(card);
}

function startTurn(state: GameState, playerId: PlayerId): void {
  const player = state.players[playerId];
  player.turnsStarted += 1;
  player.maxMana = Math.min(state.config.manaCap, player.turnsStarted);
  player.mana = player.maxMana;
  state.stats[playerId].turnsTaken += 1;

  for (const lane of state.lanes) {
    const side = lane.sides[playerId];
    if (!side.unit) continue;
    side.unit.turnsSurvived += 1;
    // Dot tick: one slot per unit, applied at the start of the owner's turn,
    // before this player's combat. A new dot REPLACES any existing dot — dots
    // never stack. Dot damage kills at 0 like normal damage.
    if (side.unit.dot) {
      // Dots can only come from the opponent, so the tick credits them.
      state.stats[otherPlayerId(state, playerId)].damageDealt += side.unit.dot.amount;
      side.unit.health -= side.unit.dot.amount;
      addLog(state, `${getCard(side.unit.cardId).name} suffers ${side.unit.dot.amount} dot damage in lane ${lane.index + 1}.`);
      if (side.unit.dot.turns <= 1) side.unit.dot = undefined;
      else side.unit.dot.turns -= 1;
      if (side.unit.health <= 0) {
        addLog(state, `${getCard(side.unit.cardId).name} is destroyed in lane ${lane.index + 1}.`);
        state.stats[otherPlayerId(state, playerId)].unitsDestroyed += 1;
        side.unit = null;
      }
    }
    if (side.building && side.unit) {
      const building = getCard(side.building.cardId);
      if (
        building.kind === 'building' &&
        building.passive.type === 'heal-own-lane-unit-at-turn-start'
      ) {
        side.unit.health = Math.min(side.unit.maxHealth, side.unit.health + building.passive.amount);
      }
    }
  }

  drawOne(state, player);
  // GA-3c "War Drums": from escalationTurn onward, at the start of each of
  // this player's turns every SURVIVING unit (already dot-ticked above) gains
  // +1 ATK permanently. Skipped if the fatigue draw above ended the match.
  if (state.status === 'playing' && player.turnsStarted >= state.config.escalationTurn) {
    let boosted = 0;
    for (const lane of state.lanes) {
      const unit = lane.sides[playerId].unit;
      if (unit) {
        unit.attack += 1;
        boosted += 1;
      }
    }
    if (boosted > 0) {
      addLog(state, `War Drums: ${player.name}'s ${boosted} unit(s) each gain +1 ATK.`);
    }
  }
  addLog(state, `${player.name} starts turn ${state.turnNumber} with ${player.mana} mana.`);
}

function otherPlayerId(state: GameState, playerId: PlayerId): PlayerId {
  return state.playerOrder[0] === playerId ? state.playerOrder[1] : state.playerOrder[0];
}

function getLane(state: GameState, laneIndex: number | undefined): LaneState {
  if (laneIndex === undefined || !Number.isInteger(laneIndex)) fail('INVALID_TARGET', 'A lane is required.');
  const lane = state.lanes[laneIndex];
  if (!lane) fail('INVALID_TARGET', 'Lane does not exist.');
  return lane;
}

function assertMutableAction(state: GameState, action: GameAction): void {
  if (state.status !== 'playing') fail('GAME_FINISHED', 'The game is already finished.');
  if (action.expectedRevision !== state.revision) {
    fail('STALE_REVISION', `Expected revision ${state.revision}, got ${action.expectedRevision}.`);
  }
  if (!state.players[action.playerId]) fail('NOT_A_PLAYER', 'Unknown player.');
  if (state.activePlayerId !== action.playerId) fail('NOT_YOUR_TURN', 'It is not your turn.');
}

function maybeFinish(state: GameState, damagedPlayerId: PlayerId): void {
  const player = state.players[damagedPlayerId];
  if (player.hp > 0 || state.status === 'finished') return;
  player.hp = 0;
  state.status = 'finished';
  state.winnerId = otherPlayerId(state, damagedPlayerId);
  addLog(state, `${state.players[state.winnerId].name} wins the match.`);
}

function removeDeadUnit(state: GameState, lane: LaneState, ownerId: PlayerId): void {
  const unit = lane.sides[ownerId].unit;
  if (unit && unit.health <= 0) {
    addLog(state, `${getCard(unit.cardId).name} is destroyed in lane ${lane.index + 1}.`);
    // In 1v1 every unit death results from the opponent (combat, effects, dots),
    // so the kill is credited to the dead unit's opponent.
    state.stats[otherPlayerId(state, ownerId)].unitsDestroyed += 1;
    lane.sides[ownerId].unit = null;
  }
}

function targetUnit(
  state: GameState,
  actingPlayerId: PlayerId,
  target: 'self' | 'friendly-unit' | 'enemy-unit',
  sourceLaneIndex: number,
  targetLaneIndex?: number,
): { lane: LaneState; ownerId: PlayerId; unit: UnitInstance } {
  const lane = getLane(state, target === 'self' ? sourceLaneIndex : targetLaneIndex ?? sourceLaneIndex);
  const ownerId = target === 'enemy-unit' ? otherPlayerId(state, actingPlayerId) : actingPlayerId;
  const unit = lane.sides[ownerId].unit;
  if (!unit) fail('INVALID_TARGET', 'The selected lane has no valid target unit.');
  return { lane, ownerId, unit };
}

function applyEffects(
  state: GameState,
  actorId: PlayerId,
  effects: readonly Effect[],
  targetKind: SpecialDefinition['target'] | PowerCardDefinition['target'],
  sourceLaneIndex: number,
  targetLaneIndex?: number,
): void {
  const enemyId = otherPlayerId(state, actorId);
  for (const effect of effects) {
    if (state.status === 'finished') break;
    switch (effect.type) {
      case 'damage-hero': {
        if (targetKind !== 'enemy-hero') fail('INVALID_EFFECT_TARGET', 'Hero damage requires enemy hero target.');
        state.players[enemyId].hp -= effect.amount;
        state.stats[actorId].damageDealt += effect.amount;
        maybeFinish(state, enemyId);
        break;
      }
      case 'damage-unit': {
        if (targetKind !== 'enemy-unit') fail('INVALID_EFFECT_TARGET', 'Unit damage requires enemy unit target.');
        const target = targetUnit(state, actorId, 'enemy-unit', sourceLaneIndex, targetLaneIndex);
        target.unit.health -= effect.amount;
        state.stats[actorId].damageDealt += effect.amount;
        removeDeadUnit(state, target.lane, target.ownerId);
        break;
      }
      case 'heal-unit': {
        const resolvedTarget = targetKind === 'self' ? 'self' : 'friendly-unit';
        if (targetKind !== 'self' && targetKind !== 'friendly-unit') {
          fail('INVALID_EFFECT_TARGET', 'Healing requires a friendly unit target.');
        }
        const target = targetUnit(state, actorId, resolvedTarget, sourceLaneIndex, targetLaneIndex);
        target.unit.health = Math.min(target.unit.maxHealth, target.unit.health + effect.amount);
        break;
      }
      case 'buff-unit': {
        if (targetKind !== 'self' && targetKind !== 'friendly-unit') {
          fail('INVALID_EFFECT_TARGET', 'Buff requires a friendly unit target.');
        }
        const resolvedTarget = targetKind === 'self' ? 'self' : 'friendly-unit';
        const target = targetUnit(state, actorId, resolvedTarget, sourceLaneIndex, targetLaneIndex);
        target.unit.attack += effect.attack;
        target.unit.maxHealth += effect.health;
        target.unit.health += effect.health;
        break;
      }
      case 'debuff-unit': {
        const resolvedTarget =
          targetKind === 'self' ? 'self' : targetKind === 'enemy-unit' ? 'enemy-unit' : 'friendly-unit';
        if (targetKind !== 'self' && targetKind !== 'enemy-unit' && targetKind !== 'friendly-unit') {
          fail('INVALID_EFFECT_TARGET', 'Debuff requires a unit target.');
        }
        const target = targetUnit(state, actorId, resolvedTarget, sourceLaneIndex, targetLaneIndex);
        target.unit.attack = Math.max(0, target.unit.attack - effect.attack);
        target.unit.health -= effect.health;
        addLog(state, `${getCard(target.unit.cardId).name} loses ${effect.attack} ATK and ${effect.health} HP in lane ${target.lane.index + 1}.`);
        if (target.ownerId === actorId) {
          // Friendly self-hit (unreachable with the current catalog — every
          // debuff is enemy-unit — but guarded for future cards): not "damage
          // dealt" and not an opponent kill; a self-destruction credits nobody
          // (same convention as the AOE self-hit branch).
          if (target.unit.health <= 0) {
            addLog(state, `${getCard(target.unit.cardId).name} is destroyed in lane ${target.lane.index + 1}.`);
            target.lane.sides[actorId].unit = null;
          }
        } else {
          state.stats[actorId].damageDealt += effect.health;
          removeDeadUnit(state, target.lane, target.ownerId);
        }
        break;
      }
      case 'dot': {
        const resolvedTarget =
          targetKind === 'self' ? 'self' : targetKind === 'enemy-unit' ? 'enemy-unit' : 'friendly-unit';
        if (targetKind !== 'self' && targetKind !== 'enemy-unit' && targetKind !== 'friendly-unit') {
          fail('INVALID_EFFECT_TARGET', 'Dot requires a unit target.');
        }
        const target = targetUnit(state, actorId, resolvedTarget, sourceLaneIndex, targetLaneIndex);
        // One dot slot per unit: assigning here replaces any existing dot.
        target.unit.dot = { amount: effect.amount, turns: effect.turns };
        addLog(state, `${getCard(target.unit.cardId).name} is poisoned: ${effect.amount} damage for ${effect.turns} turns.`);
        break;
      }
      case 'aoe': {
        if (targetKind !== 'lane') fail('INVALID_EFFECT_TARGET', 'AOE requires a lane target.');
        const lane = getLane(state, targetLaneIndex);
        for (const ownerId of [actorId, enemyId]) {
          const unit = lane.sides[ownerId].unit;
          if (!unit) continue;
          unit.health -= effect.amount;
          if (ownerId === enemyId) {
            // Hitting the opponent: count the damage and credit the kill normally.
            state.stats[actorId].damageDealt += effect.amount;
            removeDeadUnit(state, lane, ownerId);
          } else if (unit.health <= 0) {
            // Self-hit: the actor's own AOE taking out the actor's OWN unit is
            // not "damage dealt" and is not an opponent kill, so the death is
            // credited to NOBODY (neither the actor nor the opponent).
            addLog(state, `${getCard(unit.cardId).name} is destroyed in lane ${lane.index + 1}.`);
            lane.sides[actorId].unit = null;
          }
        }
        addLog(state, `${effect.amount} damage hits both sides of lane ${lane.index + 1}.`);
        break;
      }
      case 'add-card': {
        const added = CARD_BY_ID.get(effect.cardId);
        if (!added) fail('UNKNOWN_CARD', `Unknown card id in effect: ${effect.cardId}.`);
        const player = state.players[actorId];
        if (player.hand.length >= state.config.handCap) {
          addLog(state, `${player.name}'s hand is full; ${added.name} was not added.`);
        } else {
          player.hand.push({ uid: uid(state, 'card'), cardId: added.id });
          addLog(state, `${player.name} adds ${added.name} to their hand.`);
        }
        break;
      }
      case 'gain-mana': {
        const player = state.players[actorId];
        const gained = Math.min(effect.amount, Math.max(0, player.maxMana - player.mana));
        player.mana += gained;
        addLog(
          state,
          gained > 0
            ? `${player.name} gains ${gained} mana.`
            : `${player.name} has no room to gain mana.`,
        );
        break;
      }
      case 'heal-hero': {
        const player = state.players[actorId];
        const healed = Math.min(effect.amount, Math.max(0, state.config.startingHp - player.hp));
        player.hp += healed;
        addLog(state, `${player.name} restores ${healed} hero HP.`);
        break;
      }
      case 'draw': {
        for (let i = 0; i < effect.amount; i += 1) drawOne(state, state.players[actorId]);
        break;
      }
      case 'destroy-building': {
        if (targetKind !== 'enemy-building') {
          fail('INVALID_EFFECT_TARGET', 'Destroy building requires enemy building target.');
        }
        const lane = getLane(state, targetLaneIndex ?? sourceLaneIndex);
        if (!lane.sides[enemyId].building) fail('INVALID_TARGET', 'No enemy building in target lane.');
        lane.sides[enemyId].building = null;
        break;
      }
      case 'destroy-unit': {
        const resolvedTarget =
          targetKind === 'self' ? 'self' : targetKind === 'enemy-unit' ? 'enemy-unit' : 'friendly-unit';
        if (targetKind !== 'self' && targetKind !== 'enemy-unit' && targetKind !== 'friendly-unit') {
          fail('INVALID_EFFECT_TARGET', 'Destroy unit requires a unit target.');
        }
        const target = targetUnit(state, actorId, resolvedTarget, sourceLaneIndex, targetLaneIndex);
        target.unit.health = 0;
        removeDeadUnit(state, target.lane, target.ownerId);
        break;
      }
      case 'stun': {
        const resolvedTarget =
          targetKind === 'self' ? 'self' : targetKind === 'enemy-unit' ? 'enemy-unit' : 'friendly-unit';
        if (targetKind !== 'self' && targetKind !== 'enemy-unit' && targetKind !== 'friendly-unit') {
          fail('INVALID_EFFECT_TARGET', 'Stun requires a unit target.');
        }
        const target = targetUnit(state, actorId, resolvedTarget, sourceLaneIndex, targetLaneIndex);
        // One stun slot per unit: assigning here replaces any existing stun.
        target.unit.stun = { turns: effect.turns };
        addLog(state, `${getCard(target.unit.cardId).name} is stunned for ${effect.turns} turn(s) in lane ${target.lane.index + 1}.`);
        break;
      }
      case 'bounce-unit': {
        const resolvedTarget =
          targetKind === 'self' ? 'self' : targetKind === 'enemy-unit' ? 'enemy-unit' : 'friendly-unit';
        if (targetKind !== 'self' && targetKind !== 'enemy-unit' && targetKind !== 'friendly-unit') {
          fail('INVALID_EFFECT_TARGET', 'Bounce requires a unit target.');
        }
        const target = targetUnit(state, actorId, resolvedTarget, sourceLaneIndex, targetLaneIndex);
        const owner = state.players[target.ownerId];
        const card = getCard(target.unit.cardId);
        target.lane.sides[target.ownerId].unit = null;
        // Fresh hand card: new uid, same cardId — any buffs/dots/stuns are lost.
        const returned: HandCard = { uid: uid(state, 'card'), cardId: target.unit.cardId };
        if (owner.hand.length >= state.config.handCap) {
          owner.discard.push(returned);
          addLog(state, `${card.name} is bounced, but ${owner.name}'s hand is full — it is discarded (buffs lost).`);
        } else {
          owner.hand.push(returned);
          addLog(state, `${card.name} is returned to ${owner.name}'s hand (buffs lost).`);
        }
        break;
      }
      case 'discard-random': {
        if (targetKind !== 'none') fail('INVALID_EFFECT_TARGET', 'Discard random requires no target.');
        const victim = state.players[enemyId];
        for (let i = 0; i < effect.amount; i += 1) {
          if (victim.hand.length === 0) {
            addLog(state, `${victim.name} has no cards left to discard.`);
            break;
          }
          // Seeded random pick: shuffle the hand, discard the first card, and
          // consume the seed so successive picks are deterministic and distinct.
          const shuffled = shuffle(victim.hand, state.seed);
          state.seed = shuffled.seed;
          const discarded = shuffled.values[0];
          const index = victim.hand.findIndex((c) => c.uid === discarded.uid);
          victim.hand.splice(index, 1);
          victim.discard.push(discarded);
          addLog(state, `${victim.name} discards ${getCard(discarded.cardId).name} at random.`);
        }
        break;
      }
      default: {
        const exhaustive: never = effect;
        throw new Error(`Unhandled effect ${(exhaustive as Effect).type}`);
      }
    }
  }
}

function playUnit(
  state: GameState,
  playerId: PlayerId,
  card: UnitCardDefinition,
  laneIndex: number | undefined,
): void {
  const lane = getLane(state, laneIndex);
  if (lane.sides[playerId].unit) fail('SLOT_OCCUPIED', 'That lane already has your unit.');
  if (card.faction !== 'universal' && card.faction !== lane.type) {
    fail('WRONG_LANE_TYPE', `${card.name} must be played on ${/^[aeiou]/i.test(card.faction) ? 'an' : 'a'} ${card.faction} lane.`);
  }
  // GA-4a onPlay: validate the lane-relative target BEFORE placement so a
  // failing target is an atomic play failure (no mana spent, no unit placed).
  // 'self'/'friendly-unit' always resolve to the unit being placed (the lane's
  // friendly slot was just validated as empty), 'enemy-hero'/'none' need no
  // lane occupant — only 'enemy-unit' requires an occupant right now.
  if (card.onPlay) {
    validateEffects(card.onPlay.effects);
    if (card.onPlay.target === 'enemy-unit' && !lane.sides[otherPlayerId(state, playerId)].unit) {
      fail('INVALID_TARGET', `${card.name} must be played into a lane occupied by an enemy unit.`);
    }
  }
  lane.sides[playerId].unit = {
    uid: uid(state, 'unit'),
    cardId: card.id,
    ownerId: playerId,
    attack: card.attack,
    health: card.health,
    maxHealth: card.health,
    turnsSurvived: 0,
    specialUsesRemaining: card.special?.uses ?? 0,
  };
  if (card.onPlay) {
    applyEffects(state, playerId, card.onPlay.effects, card.onPlay.target, lane.index, lane.index);
    addLog(state, `${card.name} triggers its on-play effect.`);
  }
}

function playBuilding(
  state: GameState,
  playerId: PlayerId,
  card: BuildingCardDefinition,
  laneIndex: number | undefined,
): void {
  const lane = getLane(state, laneIndex);
  if (lane.sides[playerId].building) fail('SLOT_OCCUPIED', 'That lane already has your building.');
  if (card.faction !== 'universal' && card.faction !== lane.type) {
    fail('WRONG_LANE_TYPE', `${card.name} must be played on ${/^[aeiou]/i.test(card.faction) ? 'an' : 'a'} ${card.faction} lane.`);
  }
  lane.sides[playerId].building = { uid: uid(state, 'building'), cardId: card.id, ownerId: playerId };
}

/**
 * Play-time validation of effect payloads. The catalog is static, so this is a
 * defense-in-depth check (a corrupted/extended card can never smuggle a bad
 * `add-card` reference past the engine): it must run BEFORE any effect is
 * applied or resources spent, so failures stay atomic.
 */
function validateEffects(effects: readonly Effect[]): void {
  for (const effect of effects) {
    if (effect.type === 'add-card' && !CARD_BY_ID.has(effect.cardId)) {
      fail('UNKNOWN_CARD', `Unknown card id in effect: ${effect.cardId}.`);
    }
  }
}

function playPower(
  state: GameState,
  playerId: PlayerId,
  card: PowerCardDefinition,
  targetLaneIndex: number | undefined,
): void {
  if (card.faction !== 'universal' && !state.config.laneTypes.includes(card.faction)) {
    fail('WRONG_LANE_TYPE', 'Power faction is not present in this match.');
  }
  if (card.effects.some((effect) => effect.type === 'aoe') && card.target !== 'lane') {
    fail('AOE_REQUIRES_LANE', 'AOE powers must declare a lane target.');
  }
  validateEffects(card.effects);
  // 'lane' (and every other target except 'none'/'enemy-hero') requires a lane:
  // getLane fails with INVALID_TARGET when targetLaneIndex is missing.
  if (card.target !== 'none' && card.target !== 'enemy-hero') getLane(state, targetLaneIndex);
  applyEffects(state, playerId, card.effects, card.target, targetLaneIndex ?? 0, targetLaneIndex);
}

function handlePlayCard(state: GameState, action: Extract<GameAction, { type: 'play-card' }>): void {
  const player = state.players[action.playerId];
  const handIndex = player.hand.findIndex((card) => card.uid === action.handCardUid);
  if (handIndex < 0) fail('CARD_NOT_IN_HAND', 'Card is not in your hand.');
  const handCard = player.hand[handIndex];
  const card = getCard(handCard.cardId);
  if (player.mana < card.cost) fail('INSUFFICIENT_MANA', 'Not enough mana.');

  // Resolve against a clone first at applyAction level. It is safe to mutate here after all validation for the kind.
  if (card.kind === 'unit') playUnit(state, action.playerId, card, action.laneIndex);
  if (card.kind === 'building') playBuilding(state, action.playerId, card, action.laneIndex);
  if (card.kind === 'power') playPower(state, action.playerId, card, action.targetLaneIndex ?? action.laneIndex);

  player.mana -= card.cost;
  player.hand.splice(handIndex, 1);
  player.discard.push(handCard);
  state.stats[action.playerId].cardsPlayed += 1;
  addLog(state, `${player.name} plays ${card.name}.`);
}

function handleSpecial(state: GameState, action: Extract<GameAction, { type: 'activate-special' }>): void {
  const lane = getLane(state, action.laneIndex);
  const unit = lane.sides[action.playerId].unit;
  if (!unit) fail('NO_UNIT', 'No unit in that lane.');
  const card = getCard(unit.cardId);
  if (card.kind !== 'unit' || !card.special) fail('NO_SPECIAL', 'That unit has no special ability.');
  if (unit.turnsSurvived < 1) fail('SPECIAL_NOT_READY', 'Unit must survive at least one turn.');
  if (unit.specialUsesRemaining <= 0) fail('SPECIAL_EXHAUSTED', 'No special uses remaining.');
  validateEffects(card.special.effects);
  const player = state.players[action.playerId];
  if (player.mana < card.special.cost) fail('INSUFFICIENT_MANA', 'Not enough mana for special.');

  // Resolve target before spending resources so invalid targets are atomic failures.
  // 'none' and 'enemy-hero' specials need no unit resolution (e.g. draw, hero damage).
  if (card.special.target === 'self') targetUnit(state, action.playerId, 'self', action.laneIndex);
  if (card.special.target === 'friendly-unit') {
    targetUnit(state, action.playerId, 'friendly-unit', action.laneIndex, action.targetLaneIndex);
  }
  if (card.special.target === 'enemy-unit') {
    targetUnit(state, action.playerId, 'enemy-unit', action.laneIndex, action.targetLaneIndex);
  }

  player.mana -= card.special.cost;
  unit.specialUsesRemaining -= 1;
  applyEffects(
    state,
    action.playerId,
    card.special.effects,
    card.special.target,
    action.laneIndex,
    action.targetLaneIndex,
  );
  addLog(state, `${player.name} activates ${card.special.name}.`);

  if (card.special.destroySelfAfter && lane.sides[action.playerId].unit?.uid === unit.uid) {
    lane.sides[action.playerId].unit = null;
    addLog(state, `${card.name} sacrifices itself.`);
  }
}

function attackBonus(state: GameState, lane: LaneState, playerId: PlayerId): number {
  const building = lane.sides[playerId].building;
  if (!building) return 0;
  const card = getCard(building.cardId);
  if (card.kind !== 'building' || card.passive.type !== 'attack-bonus-own-lane') return 0;
  return card.passive.amount;
}

/**
 * GA-4b — the total attack a unit would deal in `lane` for `playerId`: base
 * attack + own-lane building bonus + swarm bonus (swarm × number of OTHER
 * friendly units on the board, any lane). Exported so the UI can display
 * effective ATK instead of raw stats. Returns 0 when the side has no unit.
 */
export function effectiveAttack(state: GameState, lane: LaneState, playerId: PlayerId): number {
  const unit = lane.sides[playerId].unit;
  if (!unit) return 0;
  let total = unit.attack + attackBonus(state, lane, playerId);
  const card = getCard(unit.cardId);
  if (card.kind === 'unit' && card.swarm) {
    const otherFriendlies = state.lanes.filter((l) => l !== lane && l.sides[playerId].unit).length;
    total += card.swarm * otherFriendlies;
  }
  return Math.max(0, total);
}

function resolveCombat(state: GameState, attackerId: PlayerId): void {
  const defenderId = otherPlayerId(state, attackerId);
  for (const lane of state.lanes) {
    if (state.status === 'finished') break;
    const attacker = lane.sides[attackerId].unit;
    if (!attacker || attacker.health <= 0) continue;
    // GA-1a stagger: a freshly-played unit (0 turns survived) arrives in the
    // lane but does not attack until its owner's NEXT turn. It still blocks
    // damage as a defender on this turn.
    if (attacker.turnsSurvived === 0) {
      addLog(state, `${getCard(attacker.cardId).name} arrives in lane ${lane.index + 1} and will attack from next turn.`);
      continue;
    }
    // GA-2a stun: a stunned READY unit skips the attack it would make and the
    // slot ticks down. A staggered unit (handled above) keeps its slot because
    // it had no attack to skip.
    if (attacker.stun) {
      addLog(state, `${getCard(attacker.cardId).name} is stunned and skips its attack in lane ${lane.index + 1}.`);
      if (attacker.stun.turns <= 1) attacker.stun = undefined;
      else attacker.stun.turns -= 1;
      continue;
    }
    const damage = effectiveAttack(state, lane, attackerId);
    state.stats[attackerId].damageDealt += damage;
    const defender = lane.sides[defenderId].unit;
    if (defender) {
      defender.health -= damage;
      addLog(state, `${getCard(attacker.cardId).name} deals ${damage} to ${getCard(defender.cardId).name}.`);
      const killed = defender.health <= 0;
      removeDeadUnit(state, lane, defenderId);
      // GA-3b trades pay: a combat kill of an enemy UNIT (never a hero, never
      // effect damage) draws for the killer.
      const attackerCard = getCard(attacker.cardId);
      if (killed && attackerCard.kind === 'unit' && attackerCard.drawOnKill) {
        for (let i = 0; i < attackerCard.drawOnKill; i += 1) drawOne(state, state.players[attackerId]);
        addLog(state, `${attackerCard.name} draws ${attackerCard.drawOnKill} card(s) from the kill.`);
      }
    } else {
      state.players[defenderId].hp -= damage;
      addLog(state, `${getCard(attacker.cardId).name} deals ${damage} direct damage.`);
      maybeFinish(state, defenderId);
    }
  }
}

function handleEndTurn(state: GameState, action: Extract<GameAction, { type: 'end-turn' }>): void {
  resolveCombat(state, action.playerId);
  if (state.status === 'finished') return;
  const next = otherPlayerId(state, action.playerId);
  state.activePlayerId = next;
  state.turnNumber += 1;
  startTurn(state, next);
}

/**
 * END-2 — a match runs exactly 4 lanes drawn from the 6-type pool; lane types
 * may now repeat (e.g. two antlion lanes) so a creator can concentrate the
 * board. Rejects a wrong count or an unknown type so the core never builds a
 * malformed board even if a caller (client, test, future code) passes a bad
 * selection. Duplicates are intentionally allowed.
 */
function assertValidLaneTypes(laneTypes: readonly LaneType[]): void {
  if (!Array.isArray(laneTypes) || laneTypes.length !== 4) {
    fail(
      'INVALID_LANE_TYPES',
      `A match uses exactly 4 lanes, got ${Array.isArray(laneTypes) ? laneTypes.length : 0}.`,
    );
  }
  const pool = new Set<string>(LANE_TYPES);
  for (const type of laneTypes) {
    if (!pool.has(type)) fail('INVALID_LANE_TYPES', `Unknown lane type: ${String(type)}.`);
  }
}

export function createGame(options: CreateGameOptions): GameState {
  const config: GameConfig = { ...DEFAULT_GAME_CONFIG, ...options.config };
  assertValidLaneTypes(config.laneTypes);
  // END-2: normalize to canonical pool order while preserving the creator's
  // lane multiplicities (duplicates allowed). The board layout stays
  // deterministic regardless of the order a selection was supplied in
  // (e.g. the room creator's click order), and nothing is dropped — a lane
  // chosen twice stays twice.
  const laneCounts = new Map<LaneType, number>();
  for (const type of config.laneTypes) {
    laneCounts.set(type, (laneCounts.get(type) ?? 0) + 1);
  }
  config.laneTypes = [...LANE_TYPES].flatMap((type) =>
    new Array(laneCounts.get(type) ?? 0).fill(type),
  );
  const seed = (options.seed ?? Math.floor(Math.random() * 0x7fffffff)) || 1;
  const [first, second] = options.players;
  const firstActive = seed % 2 === 0 ? first.id : second.id;
  const order: [PlayerId, PlayerId] = [first.id, second.id];
  const players: Record<PlayerId, PlayerState> = {};

  const state: GameState = {
    roomCode: options.roomCode,
    status: 'playing',
    revision: 0,
    turnNumber: 1,
    activePlayerId: firstActive,
    playerOrder: order,
    players,
    lanes: [],
    winnerId: null,
    log: [],
    config,
    seed,
    nextUid: 1,
    stats: {},
  };

  for (const player of options.players) {
    players[player.id] = {
      id: player.id,
      name: player.name,
      hp: config.startingHp,
      mana: 0,
      maxMana: 0,
      turnsStarted: 0,
      deck: [],
      hand: [],
      discard: [],
      connected: true,
      fatigue: 0,
    };
    state.stats[player.id] = { turnsTaken: 0, cardsPlayed: 0, unitsDestroyed: 0, damageDealt: 0 };
  }

  state.lanes = config.laneTypes.map((type, index) => ({
    index,
    type,
    sides: {
      [first.id]: { unit: null, building: null },
      [second.id]: { unit: null, building: null },
    },
  }));

  for (const playerId of state.playerOrder) {
    const player = players[playerId];
    player.deck = buildDeck(state);
    for (let i = 0; i < config.startingHand; i += 1) drawOne(state, player);
    // GA-5a initiative compensation: the player who does NOT start the match
    // draws one extra card.
    if (playerId !== state.activePlayerId) {
      drawOne(state, player);
      addLog(state, `${player.name} draws an extra starting card (second-player compensation).`);
    }
  }

  startTurn(state, firstActive);
  return state;
}

export function applyAction(state: GameState, action: GameAction): GameState {
  assertMutableAction(state, action);
  const next = clone(state);

  if (action.type === 'play-card') handlePlayCard(next, action);
  if (action.type === 'activate-special') handleSpecial(next, action);
  if (action.type === 'end-turn') handleEndTurn(next, action);

  next.revision += 1;
  return next;
}

/**
 * End a still-playing match by forfeit: the given player wins and the provided
 * reason is appended to the log. Used by the server's disconnect grace window
 * when the opponent never rejoins. Deterministic and side-effect free.
 */
export function forfeitGame(state: GameState, winnerId: PlayerId, reason: string): GameState {
  if (!state.players[winnerId]) fail('NOT_A_PLAYER', 'Winner is not a player in this game.');
  if (state.status !== 'playing') fail('GAME_FINISHED', 'The game is already finished.');
  const next = clone(state);
  next.status = 'finished';
  next.winnerId = winnerId;
  addLog(next, reason);
  next.revision += 1;
  return next;
}

export function setPlayerConnected(state: GameState, playerId: PlayerId, connected: boolean): GameState {
  if (!state.players[playerId]) return state;
  const next = clone(state);
  next.players[playerId].connected = connected;
  // A finished match is terminal: flipping a seat's connected flag is cosmetic
  // (it only feeds the client view), so it must not consume a revision.
  if (next.status !== 'finished') next.revision += 1;
  return next;
}

/**
 * M3 — map one internal lane to its client view: clone unit/building state
 * (no internal fields leak) and attach the server-computed effectiveAtk so
 * the UI shows the real number the unit would attack with.
 */
function toClientLane(state: GameState, lane: LaneState): ClientLaneState {
  const sides: ClientLaneState['sides'] = {} as ClientLaneState['sides'];
  for (const id of state.playerOrder) {
    const side = lane.sides[id];
    const unit = side.unit
      ? { ...clone(side.unit), effectiveAtk: effectiveAttack(state, lane, id) }
      : null;
    sides[id] = {
      unit,
      building: side.building ? clone(side.building) : null,
    };
  }
  return { index: lane.index, type: lane.type, sides };
}

export function toClientView(
  state: GameState,
  viewerId: PlayerId,
  solo = false,
): ClientGameView {
  if (!state.players[viewerId]) fail('NOT_A_PLAYER', 'Viewer is not a player in this game.');
  const players: ClientGameView['players'] = {};
  for (const id of state.playerOrder) {
    const player = state.players[id];
    players[id] = {
      id,
      name: player.name,
      // SPEC "Visibility": the opponent's *current* HP is public. Both players
      // always see both current HP values (max HP is constant = config.startingHp).
      hp: player.hp,
      // SPEC "Visibility": the opponent's *current* mana is public. Both players
      // always see both current mana values (maxMana is kept separately as-is).
      mana: player.mana,
      maxMana: player.maxMana,
      hand: id === viewerId ? clone(player.hand) : null,
      handCount: player.hand.length,
      deckCount: player.deck.length,
      discardCount: player.discard.length,
      connected: player.connected,
      fatigue: player.fatigue,
    };
  }

  return {
    roomCode: state.roomCode,
    status: state.status,
    revision: state.revision,
    turnNumber: state.turnNumber,
    activePlayerId: state.activePlayerId,
    selfPlayerId: viewerId,
    playerOrder: [...state.playerOrder] as [PlayerId, PlayerId],
    players,
    lanes: state.lanes.map((lane) => toClientLane(state, lane)),
    winnerId: state.winnerId,
    log: clone(state.log),
    config: clone(state.config),
    stats: clone(state.stats),
    solo,
  };
}
