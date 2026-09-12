/**
 * The pool of selectable lane types. Each player picks their OWN 4 lanes from
 * this pool (room creator, joiner via the join form, AI via the solo form), so
 * the two sides of a lane — and the two decks — may differ. A match always
 * runs exactly 4 lane positions; position `i` pairs side A's `i`-th lane with
 * side B's `i`-th lane (each side normalized to canonical pool order).
 */
export const LANE_TYPES = ['antlion', 'combine', 'rebel', 'zombie', 'guardian', 'wraith'] as const;
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
  /**
   * GA-3c ("War Drums") — from this turn number (per player, 1-based) onward,
   * at the start of each player's turn every surviving unit of that player
   * gains +1 ATK permanently. Guarantees every match resolves.
   */
  escalationTurn: number;
}

/**
 * END-1 — the default lane selection (the classic four). A match always runs
 * exactly 4 lanes; the room creator picks which 4 of the 6-pool, and this is
 * the fallback when no selection is supplied.
 */
export const DEFAULT_LANE_TYPES: readonly LaneType[] = ['antlion', 'combine', 'rebel', 'zombie'];

export const DEFAULT_GAME_CONFIG: GameConfig = {
  startingHp: 30,
  manaCap: 10,
  startingHand: 4,
  handCap: 10,
  laneTypes: DEFAULT_LANE_TYPES,
  escalationTurn: 15,
};

/**
 * Per-player lane selections, positional: `first` belongs to the first player
 * in `CreateGameOptions.players`, `second` to the other one. Each side holds
 * exactly 4 validated lane types. Used by `createGame`; absent sides fall back
 * to the shared `GameConfig.laneTypes` (mirrored board, legacy behavior).
 */
export interface PerPlayerLanes {
  first: readonly LaneType[];
  second: readonly LaneType[];
}

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
  | { type: 'destroy-unit' }
  /**
   * GA-2a — stun. The target unit skips the attack it WOULD make (it must be
   * ready, i.e. `turnsSurvived >= 1`; a staggered unit keeps its slot). A
   * single stun slot per unit: applying a new stun REPLACES the old one.
   */
  | { type: 'stun'; turns: number }
  /**
   * GA-2b — bounce-unit. The target unit is removed from the lane and a FRESH
   * hand card (new uid, same cardId) is returned to its owner — any buffs or
   * dots/stuns are lost. If the owner's hand is full the card is discarded.
   */
  | { type: 'bounce-unit' }
  /**
   * GA-2c — discard-random. The OPPONENT discards `amount` cards chosen at
   * random (seeded, deterministic) from their hand. Requires `targetKind`
   * 'none'. If the hand has fewer cards, the whole hand is discarded.
   */
  | { type: 'discard-random'; amount: number };

/**
 * GA-4a — on-play effect targeting. The target is always LANE-RELATIVE (no
 * separate targeting UI): 'enemy-unit' means the enemy unit in the lane the
 * unit is played into, 'enemy-hero' the enemy hero, 'self'/'friendly-unit'
 * the placed unit itself (the only friendly unit in that lane afterwards).
 */
export type OnPlayTarget = 'none' | 'self' | 'enemy-unit' | 'enemy-hero' | 'friendly-unit';

/**
 * GA-4a — an effect applied immediately after the unit is placed. Target
 * validation happens BEFORE placement: if the required target is missing the
 * whole play fails atomically (no mana spent, no unit placed).
 */
export interface OnPlayDefinition {
  target: OnPlayTarget;
  effects: readonly Effect[];
}

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
  /** GA-4a — effect applied immediately after placement (lane-relative target). */
  onPlay?: OnPlayDefinition;
  /** GA-4b — swarm: +N ATK per OTHER friendly unit on the board (any lane). */
  swarm?: number;
  /** GA-3b — draws N cards when this unit destroys an enemy UNIT in combat. */
  drawOnKill?: number;
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
  /**
   * GA-2a — single stun slot. The unit skips its attack on the owner's next
   * READY turn and the slot ticks down; a staggered unit (turnsSurvived 0)
   * keeps its slot because it had no attack to skip. Applying a new stun
   * REPLACES this slot — stuns never stack.
   */
  stun?: { turns: number };
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
  /**
   * Per-side lane type: each player plays their faction cards into lanes of
   * THEIR OWN side's type. The two sides of one position may differ (each
   * player chose their own 4 lanes), in which case each deck is also built
   * from its owner's lane factions only.
   */
  sideTypes: Record<PlayerId, LaneType>;
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
  /**
   * GA-3a — finite-deck fatigue. Incremented by 1 every time this player
   * would draw from an empty deck; the damage equals the counter (1, 2, 3, …)
   * and accumulates. Replaces the old infinite 'bucket' filler card.
   */
  fatigue: number;
}

export interface GameLogEntry {
  seq: number;
  text: string;
  /** Public card identities explicitly mentioned by this entry. */
  cardIds?: string[];
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

/**
 * M3 — the unit side of a lane as exposed to clients. Mirrors UnitInstance's
 * public fields and adds the server-computed effective attack. All unit state
 * here is public information (SPEC "Visibility"): both players see all lanes.
 * Clients never recompute rules from this view.
 */
export interface ClientUnitView {
  uid: string;
  cardId: string;
  ownerId: PlayerId;
  attack: number;
  health: number;
  maxHealth: number;
  specialUsesRemaining: number;
  dot?: { amount: number; turns: number };
  /** GA-1a — 0 = "just arrived" (stagger): attacks from the owner's next turn. */
  turnsSurvived: number;
  /** GA-2a — the unit skips its next attack(s); present only while stunned. */
  stun?: { turns: number };
  /** GA-4b — base ATK + own-lane building bonus + swarm bonus (server-computed). */
  effectiveAtk: number;
}

export interface ClientPlayerLaneState {
  unit: ClientUnitView | null;
  building: BuildingInstance | null;
}

export interface ClientLaneState {
  index: number;
  /** Per-side lane type (see LaneState.sideTypes) — public to both players. */
  sideTypes: Record<PlayerId, LaneType>;
  sides: Record<PlayerId, ClientPlayerLaneState>;
}

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
  /** GA-3a — current fatigue damage level (see PlayerState.fatigue). */
  fatigue: number;
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
  lanes: ClientLaneState[];
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
