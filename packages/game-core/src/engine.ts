import { CARD_CATALOG, getCard } from './cards';
import { shuffle } from './random';
import {
  BuildingCardDefinition,
  ClientGameView,
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
  let card = player.deck.shift();
  if (!card) card = { uid: uid(state, 'card'), cardId: 'bucket' };
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

  for (const lane of state.lanes) {
    const side = lane.sides[playerId];
    if (side.unit) side.unit.turnsSurvived += 1;
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
        maybeFinish(state, enemyId);
        break;
      }
      case 'damage-unit': {
        if (targetKind !== 'enemy-unit') fail('INVALID_EFFECT_TARGET', 'Unit damage requires enemy unit target.');
        const target = targetUnit(state, actorId, 'enemy-unit', sourceLaneIndex, targetLaneIndex);
        target.unit.health -= effect.amount;
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
    fail('WRONG_LANE_TYPE', `${card.name} must be played on a ${card.faction} lane.`);
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
    fail('WRONG_LANE_TYPE', `${card.name} must be played on a ${card.faction} lane.`);
  }
  lane.sides[playerId].building = { uid: uid(state, 'building'), cardId: card.id, ownerId: playerId };
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
  const player = state.players[action.playerId];
  if (player.mana < card.special.cost) fail('INSUFFICIENT_MANA', 'Not enough mana for special.');

  // Resolve target before spending resources so invalid targets are atomic failures.
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

function resolveCombat(state: GameState, attackerId: PlayerId): void {
  const defenderId = otherPlayerId(state, attackerId);
  for (const lane of state.lanes) {
    if (state.status === 'finished') break;
    const attacker = lane.sides[attackerId].unit;
    if (!attacker || attacker.health <= 0) continue;
    const damage = Math.max(0, attacker.attack + attackBonus(state, lane, attackerId));
    const defender = lane.sides[defenderId].unit;
    if (defender) {
      defender.health -= damage;
      addLog(state, `${getCard(attacker.cardId).name} deals ${damage} to ${getCard(defender.cardId).name}.`);
      removeDeadUnit(state, lane, defenderId);
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

export function createGame(options: CreateGameOptions): GameState {
  const config: GameConfig = { ...DEFAULT_GAME_CONFIG, ...options.config };
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
    };
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

export function setPlayerConnected(state: GameState, playerId: PlayerId, connected: boolean): GameState {
  if (!state.players[playerId]) return state;
  const next = clone(state);
  next.players[playerId].connected = connected;
  next.revision += 1;
  return next;
}

export function toClientView(state: GameState, viewerId: PlayerId): ClientGameView {
  if (!state.players[viewerId]) fail('NOT_A_PLAYER', 'Viewer is not a player in this game.');
  const players: ClientGameView['players'] = {};
  for (const id of state.playerOrder) {
    const player = state.players[id];
    players[id] = {
      id,
      name: player.name,
      hp: player.hp,
      mana: player.mana,
      maxMana: player.maxMana,
      hand: id === viewerId ? clone(player.hand) : null,
      handCount: player.hand.length,
      deckCount: player.deck.length,
      discardCount: player.discard.length,
      connected: player.connected,
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
    lanes: clone(state.lanes),
    winnerId: state.winnerId,
    log: clone(state.log),
    config: clone(state.config),
  };
}
