export const LANE_TYPES = ['antlion', 'combine', 'rebel', 'zombie'] as const;
export type LaneType = (typeof LANE_TYPES)[number];
export type Faction = LaneType | 'universal';
export type CardKind = 'unit' | 'building' | 'power';
export type PlayerId = string;

export interface GameConfig {
  startingHp: number;
  manaCap: number;
  startingHand: number;
  handCap: number;
  laneTypes: readonly LaneType[];
}

export const DEFAULT_GAME_CONFIG: GameConfig = {
  startingHp: 30,
  manaCap: 10,
  startingHand: 4,
  handCap: 10,
  laneTypes: LANE_TYPES,
};

export type Effect =
  | { type: 'damage-unit'; amount: number }
  | { type: 'damage-hero'; amount: number }
  | { type: 'heal-unit'; amount: number }
  | { type: 'buff-unit'; attack: number; health: number }
  | { type: 'draw'; amount: number }
  | { type: 'destroy-building' };

export interface SpecialDefinition {
  name: string;
  description: string;
  cost: number;
  uses: number;
  target: 'self' | 'friendly-unit' | 'enemy-unit' | 'enemy-hero' | 'none';
  effects: readonly Effect[];
  destroySelfAfter?: boolean;
}

export interface BuildingPassive {
  type: 'heal-own-lane-unit-at-turn-start' | 'attack-bonus-own-lane';
  amount: number;
}

export interface UnitCardDefinition {
  id: string;
  name: string;
  kind: 'unit';
  faction: Faction;
  tier: number;
  cost: number;
  description: string;
  attack: number;
  health: number;
  special?: SpecialDefinition;
}

export interface BuildingCardDefinition {
  id: string;
  name: string;
  kind: 'building';
  faction: Faction;
  tier: number;
  cost: number;
  description: string;
  passive: BuildingPassive;
}

export interface PowerCardDefinition {
  id: string;
  name: string;
  kind: 'power';
  faction: Faction;
  tier: number;
  cost: number;
  description: string;
  target: 'friendly-unit' | 'enemy-unit' | 'enemy-hero' | 'enemy-building' | 'none';
  effects: readonly Effect[];
}

export type CardDefinition = UnitCardDefinition | BuildingCardDefinition | PowerCardDefinition;

export interface HandCard {
  uid: string;
  cardId: string;
}

export interface UnitInstance {
  uid: string;
  cardId: string;
  ownerId: PlayerId;
  attack: number;
  health: number;
  maxHealth: number;
  turnsSurvived: number;
  specialUsesRemaining: number;
}

export interface BuildingInstance {
  uid: string;
  cardId: string;
  ownerId: PlayerId;
}

export interface PlayerLaneState {
  unit: UnitInstance | null;
  building: BuildingInstance | null;
}

export interface LaneState {
  index: number;
  type: LaneType;
  sides: Record<PlayerId, PlayerLaneState>;
}

export interface PlayerState {
  id: PlayerId;
  name: string;
  hp: number;
  mana: number;
  maxMana: number;
  turnsStarted: number;
  deck: HandCard[];
  hand: HandCard[];
  discard: HandCard[];
  connected: boolean;
}

export interface GameLogEntry {
  seq: number;
  text: string;
}

export interface GameState {
  roomCode: string;
  status: 'playing' | 'finished';
  revision: number;
  turnNumber: number;
  activePlayerId: PlayerId;
  playerOrder: [PlayerId, PlayerId];
  players: Record<PlayerId, PlayerState>;
  lanes: LaneState[];
  winnerId: PlayerId | null;
  log: GameLogEntry[];
  config: GameConfig;
  seed: number;
  nextUid: number;
}

export type GameAction =
  | {
      type: 'play-card';
      playerId: PlayerId;
      expectedRevision: number;
      handCardUid: string;
      laneIndex?: number;
      targetLaneIndex?: number;
    }
  | {
      type: 'activate-special';
      playerId: PlayerId;
      expectedRevision: number;
      laneIndex: number;
      targetLaneIndex?: number;
    }
  | {
      type: 'end-turn';
      playerId: PlayerId;
      expectedRevision: number;
    };

/** Client-submitted intents. Mirrors {@link GameAction} minus the server-assigned `playerId`. */
export type ClientAction =
  | {
      type: 'play-card';
      expectedRevision: number;
      handCardUid: string;
      laneIndex?: number;
      targetLaneIndex?: number;
    }
  | {
      type: 'activate-special';
      expectedRevision: number;
      laneIndex: number;
      targetLaneIndex?: number;
    }
  | {
      type: 'end-turn';
      expectedRevision: number;
    };

export interface ClientPlayerView {
  id: PlayerId;
  name: string;
  hp: number;
  mana: number;
  maxMana: number;
  hand: HandCard[] | null;
  handCount: number;
  deckCount: number;
  discardCount: number;
  connected: boolean;
}

export interface ClientGameView {
  roomCode: string;
  status: GameState['status'];
  revision: number;
  turnNumber: number;
  activePlayerId: PlayerId;
  selfPlayerId: PlayerId;
  playerOrder: [PlayerId, PlayerId];
  players: Record<PlayerId, ClientPlayerView>;
  lanes: LaneState[];
  winnerId: PlayerId | null;
  log: GameLogEntry[];
  config: GameConfig;
}

export class GameRuleError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'GameRuleError';
  }
}
