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
  | { type: 'debuff-unit'; attack: number; health: number }
  | { type: 'dot'; amount: number; turns: number }
  | { type: 'aoe'; amount: number }
  | { type: 'add-card'; cardId: string }
  | { type: 'gain-mana'; amount: number }
  | { type: 'heal-hero'; amount: number }
  | { type: 'draw'; amount: number }
  | { type: 'destroy-building' }
  | { type: 'destroy-unit' };

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
  target: 'friendly-unit' | 'enemy-unit' | 'enemy-hero' | 'enemy-building' | 'lane' | 'none';
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
  /**
   * Single damage-over-time slot. Ticks at the START of the unit owner's turn
   * (before that player's combat) for `turns` ticks. Applying a new dot
   * REPLACES this slot — dots never stack.
   */
  dot?: { amount: number; turns: number };
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

/**
 * Per-player match statistics (Phase D, D-2). Accumulated deterministically by
 * the engine and shown in the end-of-match summary. Public to both players —
 * they are aggregates, not hidden information.
 */
export interface PlayerStats {
  /** Turns this player started (the opening turn counts). */
  turnsTaken: number;
  /** Cards played from hand (special activations do not count). */
  cardsPlayed: number;
  /** Enemy units destroyed as a result of this player's actions. */
  unitsDestroyed: number;
  /** Damage dealt to enemy units and the enemy hero (including dot ticks). */
  damageDealt: number;
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
  stats: Record<PlayerId, PlayerStats>;
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
  stats: Record<PlayerId, PlayerStats>;
  /**
   * True when at least one seat is an AI (a solo match). Derived by the server
   * from the room's seat configuration (L3) rather than the client matching the
   * AI's display name, which would break if the AI name changed.
   */
  solo: boolean;
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
