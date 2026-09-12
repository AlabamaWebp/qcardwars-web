import { describe, expect, it } from 'vitest';
import { AI_PLAYER_NAME, chooseAiAction } from './ai';
import { applyAction, createGame, forfeitGame, GameState, PlayerId } from './index';

function game(seed = 7): GameState {
  return createGame({
    roomCode: 'SOLO1',
    players: [
      { id: 'p1', name: 'Human' },
      { id: 'p2', name: AI_PLAYER_NAME },
    ],
    seed,
  });
}

function giveCard(state: GameState, playerId: PlayerId, cardId: string): { state: GameState; uid: string } {
  const next = structuredClone(state);
  const uid = `test-${cardId}-${next.nextUid++}`;
  next.players[playerId].hand.push({ uid, cardId });
  return { state: next, uid };
}

/** Put the AI (p2) on a turn with a full mana pool. */
function aiTurn(state: GameState): GameState {
  state.activePlayerId = 'p2';
  state.players.p2.mana = 10;
  state.players.p2.maxMana = 10;
  return state;
}

function placeUnit(
  state: GameState,
  laneIndex: number,
  playerId: PlayerId,
  cardId: string,
  turnsSurvived: number,
  specialUsesRemaining = 0,
) {
  state.lanes[laneIndex].sides[playerId].unit = {
    uid: `test-unit-${cardId}-${playerId}`,
    cardId,
    ownerId: playerId,
    attack: 2,
    health: 4,
    maxHealth: 4,
    turnsSurvived,
    specialUsesRemaining,
  };
}

describe('Phase D D-1: chooseAiAction', () => {
  it('returns null when it is not the AI turn or the match is finished', () => {
    expect(chooseAiAction(aiTurn(game()), 'p1')).toBeNull();
    const finished = forfeitGame(aiTurn(game()), 'p2', 'test');
    expect(chooseAiAction(finished, 'p2')).toBeNull();
  });

  it('plays the highest-cost legal card first', () => {
    let state = aiTurn(game());
    state.players.p2.hand = []; // hermetic: ignore the initial draw
    const elite = giveCard(state, 'p2', 'combine-elite'); // cost 6, combine lane 1
    state = elite.state;
    const bucket = giveCard(state, 'p2', 'bucket'); // cost 1
    state = bucket.state;

    const action = chooseAiAction(state, 'p2');
    expect(action).toEqual({
      type: 'play-card',
      playerId: 'p2',
      expectedRevision: state.revision,
      handCardUid: elite.uid,
      laneIndex: 1,
    });
    const next = applyAction(state, action);
    expect(next.lanes[1].sides.p2.unit?.cardId).toBe('combine-elite');
    expect(next.players.p2.mana).toBe(4);
  });

  it('skips unaffordable cards and plays the next best', () => {
    let state = aiTurn(game());
    state.players.p2.hand = []; // hermetic: ignore the initial draw
    state.players.p2.mana = 2;
    const titan = giveCard(state, 'p2', 'zombie-titan'); // cost 7 — unaffordable
    state = titan.state;
    const bucket = giveCard(state, 'p2', 'bucket'); // cost 1, universal
    state = bucket.state;

    const action = chooseAiAction(state, 'p2');
    expect(action?.type).toBe('play-card');
    if (action?.type === 'play-card') {
      expect(action.handCardUid).toBe(bucket.uid);
      expect(action.laneIndex).toBe(0); // first lane (universal fits anywhere)
    }
  });

  it('plays a no-target power without a lane', () => {
    let state = aiTurn(game());
    state.players.p2.hand = []; // hermetic: ignore the initial draw
    state.players.p2.mana = 1;
    const resupply = giveCard(state, 'p2', 'power-resupply'); // target 'none'
    state = resupply.state;

    const action = chooseAiAction(state, 'p2');
    expect(action).toEqual({
      type: 'play-card',
      playerId: 'p2',
      expectedRevision: state.revision,
      handCardUid: resupply.uid,
    });
    const next = applyAction(state, action);
    expect(next.players.p2.hand).toHaveLength(2); // played resupply, drew 2
  });

  it('falls back to a ready special when no card can be played', () => {
    let state = aiTurn(game());
    state.players.p2.hand = []; // hermetic: ignore the initial draw
    state.players.p2.mana = 2;
    state = structuredClone(state);
    placeUnit(state, 1, 'p2', 'combine-drone', 1, 2); // Overtap: cost 1, target 'none', ready

    const action = chooseAiAction(state, 'p2');
    expect(action).toEqual({
      type: 'activate-special',
      playerId: 'p2',
      expectedRevision: state.revision,
      laneIndex: 1,
    });
    const next = applyAction(state, action);
    expect(next.lanes[1].sides.p2.unit?.specialUsesRemaining).toBe(1);
    expect(next.players.p2.mana).toBe(3); // spent 1, gained 2
  });

  it('targets the best enemy unit with a targeted special', () => {
    let state = aiTurn(game());
    state.players.p2.hand = []; // hermetic: ignore the initial draw
    state.players.p2.mana = 2;
    state = structuredClone(state);
    placeUnit(state, 0, 'p1', 'bucket', 1); // legal enemy target in lane 0
    placeUnit(state, 0, 'p2', 'antlion-tinker', 1, 1); // Spitter: cost 1, enemy-unit, ready

    const action = chooseAiAction(state, 'p2');
    expect(action).toEqual({
      type: 'activate-special',
      playerId: 'p2',
      expectedRevision: state.revision,
      laneIndex: 0,
      targetLaneIndex: 0,
    });
    const next = applyAction(state, action);
    expect(next.lanes[0].sides.p1.unit?.health).toBe(1); // 4 - 3
  });

  it('ends the turn when nothing legal remains', () => {
    let state = aiTurn(game());
    state.players.p2.hand = []; // hermetic: ignore the initial draw
    state.players.p2.mana = 0;
    const bucket = giveCard(state, 'p2', 'bucket'); // unaffordable
    state = bucket.state;

    const action = chooseAiAction(state, 'p2');
    expect(action).toEqual({ type: 'end-turn', playerId: 'p2', expectedRevision: state.revision });
    const next = applyAction(state, action);
    expect(next.activePlayerId).toBe('p1');
  });

  it('is deterministic: identical states yield identical actions', () => {
    const a = aiTurn(game(42));
    const b = aiTurn(game(42));
    expect(chooseAiAction(b, 'p2')).toEqual(chooseAiAction(a, 'p2'));
  });
});

describe('M4: heuristic lane and target selection', () => {
  /** Place an enemy/own unit with custom stats (bucket card def: no swarm/building interplay). */
  function placeCustomUnit(
    state: GameState,
    laneIndex: number,
    playerId: PlayerId,
    attack: number,
    health: number,
    turnsSurvived = 1,
  ): void {
    state.lanes[laneIndex].sides[playerId].unit = {
      uid: `test-custom-${playerId}-${laneIndex}-${attack}x${health}`,
      cardId: 'bucket',
      ownerId: playerId,
      attack,
      health,
      maxHealth: health,
      turnsSurvived,
      specialUsesRemaining: 0,
    };
  }

  it('prefers killing a high-threat enemy over a safe block', () => {
    let state = aiTurn(game());
    state.players.p2.hand = [];
    state = structuredClone(state);
    placeCustomUnit(state, 0, 'p1', 2, 5); // low threat: mercenary (3/3) survives the trade
    placeCustomUnit(state, 1, 'p1', 8, 2); // high threat but killable next turn (3 atk >= 2 hp)
    const mercenary = giveCard(state, 'p2', 'universal-mercenary'); // 3/3, universal
    state = mercenary.state;

    const action = chooseAiAction(state, 'p2');
    expect(action?.type).toBe('play-card');
    if (action?.type === 'play-card') {
      expect(action.handCardUid).toBe(mercenary.uid);
      expect(action.laneIndex).toBe(1); // kill the 8-threat unit, not the safe lane 0
    }
    const next = applyAction(state, action!);
    expect(next.lanes[1].sides.p2.unit?.cardId).toBe('universal-mercenary');
  });

  it('avoids an outmatched lane in favor of an open lane', () => {
    let state = aiTurn(game());
    state.players.p2.hand = [];
    state = structuredClone(state);
    placeCustomUnit(state, 0, 'p1', 6, 8); // would kill the 3/2 volunteer without a trade
    const volunteer = giveCard(state, 'p2', 'universal-demolition-volunteer'); // 3/2, universal
    state = volunteer.state;

    const action = chooseAiAction(state, 'p2');
    expect(action?.type).toBe('play-card');
    if (action?.type === 'play-card') {
      expect(action.laneIndex).toBe(1); // open lane beats the dead-weight block in lane 0
    }
  });

  it('stuns the highest-attack enemy unit', () => {
    let state = aiTurn(game());
    state.players.p2.hand = [];
    state = structuredClone(state);
    placeUnit(state, 0, 'p1', 'bucket', 1); // 2/4
    placeCustomUnit(state, 2, 'p1', 5, 3); // 5/3 — bigger threat
    const stasis = giveCard(state, 'p2', 'power-stasis-field'); // cost 2, enemy-unit stun
    state = stasis.state;

    const action = chooseAiAction(state, 'p2');
    expect(action).toEqual({
      type: 'play-card',
      playerId: 'p2',
      expectedRevision: state.revision,
      handCardUid: stasis.uid,
      laneIndex: 2,
      targetLaneIndex: 2,
    });
  });

  it('plays a building on a lane that already has a friendly unit', () => {
    let state = aiTurn(game());
    state.players.p2.hand = [];
    state = structuredClone(state);
    placeUnit(state, 0, 'p2', 'bucket', 1); // friendly unit occupies the unit slot
    const bunker = giveCard(state, 'p2', 'building-bunker'); // universal, cost 4
    state = bunker.state;

    const action = chooseAiAction(state, 'p2');
    expect(action?.type).toBe('play-card');
    if (action?.type === 'play-card') {
      expect(action.laneIndex).toBe(0); // unit + building coexist in lane 0
    }
    const next = applyAction(state, action!);
    expect(next.lanes[0].sides.p2.building?.cardId).toBe('building-bunker');
    expect(next.lanes[0].sides.p2.unit?.cardId).toBe('bucket'); // unit untouched
  });

  it('does not play an onPlay enemy-unit card when no enemy is on the board', () => {
    let state = aiTurn(game());
    state.players.p2.hand = [];
    const harrier = giveCard(state, 'p2', 'antlion-tunnel-harrier'); // onPlay needs an enemy unit
    state = harrier.state;

    expect(chooseAiAction(state, 'p2')).toEqual({
      type: 'end-turn',
      playerId: 'p2',
      expectedRevision: state.revision,
    });

    // Once an enemy occupies the antlion lane, the same card plays there.
    state = structuredClone(state);
    placeCustomUnit(state, 0, 'p1', 2, 4);
    const action = chooseAiAction(state, 'p2');
    expect(action?.type).toBe('play-card');
    if (action?.type === 'play-card') {
      expect(action.laneIndex).toBe(0);
    }
  });

  it('does not waste a stun on an already-stunned enemy (plays a cheaper card instead)', () => {
    let state = aiTurn(game());
    state.players.p2.hand = [];
    state = structuredClone(state);
    placeUnit(state, 0, 'p1', 'bucket', 1);
    state.lanes[0].sides.p1.unit!.stun = { turns: 1 }; // already stunned
    const stasis = giveCard(state, 'p2', 'power-stasis-field'); // cost 2 — would be a waste
    state = stasis.state;
    const bucket = giveCard(state, 'p2', 'bucket'); // cost 1 fallback
    state = bucket.state;

    const action = chooseAiAction(state, 'p2');
    expect(action?.type).toBe('play-card');
    if (action?.type === 'play-card') {
      expect(action.handCardUid).toBe(bucket.uid); // stasis vetoed, not played
      // Lane 0 is outmatched (stunned 2/4 beats the 1/2 bucket), so it goes to lane 1.
      expect(action.laneIndex).toBe(1);
    }
  });

  it('aims a lane AOE power at the lane with the most enemy value', () => {
    let state = aiTurn(game());
    state.players.p2.hand = [];
    state = structuredClone(state);
    placeCustomUnit(state, 0, 'p1', 2, 4); // value 6
    placeCustomUnit(state, 2, 'p1', 5, 3); // value 8 — better target
    const scorch = giveCard(state, 'p2', 'power-scorch'); // cost 3, target 'lane'
    state = scorch.state;

    const action = chooseAiAction(state, 'p2');
    expect(action).toEqual({
      type: 'play-card',
      playerId: 'p2',
      expectedRevision: state.revision,
      handCardUid: scorch.uid,
      laneIndex: 2,
      targetLaneIndex: 2,
    });
  });

  it('destroys the enemy building in the lowest-indexed occupied lane', () => {
    let state = aiTurn(game());
    state.players.p2.hand = [];
    state = structuredClone(state);
    state.lanes[1].sides.p1.building = { uid: 'test-bldg-1', cardId: 'building-bunker', ownerId: 'p1' };
    state.lanes[3].sides.p1.building = { uid: 'test-bldg-3', cardId: 'building-bunker', ownerId: 'p1' };
    const sabotage = giveCard(state, 'p2', 'power-sabotage'); // cost 2, enemy-building
    state = sabotage.state;

    const action = chooseAiAction(state, 'p2');
    expect(action?.type).toBe('play-card');
    if (action?.type === 'play-card') {
      expect(action.laneIndex).toBe(1);
      expect(action.targetLaneIndex).toBe(1);
    }
    const next = applyAction(state, action!);
    expect(next.lanes[1].sides.p1.building).toBeNull();
    expect(next.lanes[3].sides.p1.building?.cardId).toBe('building-bunker'); // untouched
  });

  it('uses a friendly-unit special across lanes on the strongest ally', () => {
    let state = aiTurn(game());
    state.players.p2.hand = [];
    state = structuredClone(state);
    placeUnit(state, 1, 'p2', 'combine-laser', 1, 1); // Targeting Laser: +2 ATK, cost 1, ready
    placeCustomUnit(state, 0, 'p2', 5, 3); // stronger ally in a DIFFERENT lane

    const action = chooseAiAction(state, 'p2');
    expect(action).toEqual({
      type: 'activate-special',
      playerId: 'p2',
      expectedRevision: state.revision,
      laneIndex: 1,
      targetLaneIndex: 0, // cross-lane: buff the 5-attack ally, not the 2-attack caster
    });
    const next = applyAction(state, action);
    expect(next.lanes[0].sides.p2.unit?.attack).toBe(7); // 5 + 2
  });

  it('does not waste a stun on a 0-ATK enemy (debuffed units have nothing to skip)', () => {
    let state = aiTurn(game());
    state.players.p2.hand = [];
    state = structuredClone(state);
    placeCustomUnit(state, 0, 'p1', 0, 4); // ready (turnsSurvived 1) but debuffed to 0 ATK
    const stasis = giveCard(state, 'p2', 'power-stasis-field'); // cost 2 — would be a waste
    state = stasis.state;
    const bucket = giveCard(state, 'p2', 'bucket'); // cost 1 fallback
    state = bucket.state;

    const action = chooseAiAction(state, 'p2');
    expect(action?.type).toBe('play-card');
    if (action?.type === 'play-card') {
      expect(action.handCardUid).toBe(bucket.uid); // stasis vetoed, not played
    }
  });
});

describe('M2 catalog: AI plays the new cards legally', () => {
  it('plays the highest-cost new M2 unit legally and it applies cleanly', () => {
    let state = aiTurn(game());
    state.players.p2.hand = []; // hermetic: ignore the initial draw
    const sergeant = giveCard(state, 'p2', 'universal-drill-sergeant'); // cost 1, universal
    state = sergeant.state;
    const marshal = giveCard(state, 'p2', 'combine-riot-marshal'); // cost 4, combine
    state = marshal.state;

    const action = chooseAiAction(state, 'p2');
    expect(action?.type).toBe('play-card');
    if (action?.type === 'play-card') {
      expect(action.handCardUid).toBe(marshal.uid); // highest-cost first
      expect(action.laneIndex).toBe(1); // combine lane
    }
    const next = applyAction(state, action!);
    expect(next.lanes[1].sides.p2.unit?.cardId).toBe('combine-riot-marshal');
  });

  it('targets an occupied lane with the new universal Stasis Field power', () => {
    let state = aiTurn(game());
    state.players.p2.hand = []; // hermetic: ignore the initial draw
    state.players.p2.mana = 3;
    state = structuredClone(state);
    placeUnit(state, 0, 'p1', 'bucket', 1); // legal enemy target in lane 0
    const stasis = giveCard(state, 'p2', 'power-stasis-field'); // cost 2, enemy-unit
    state = stasis.state;

    const action = chooseAiAction(state, 'p2');
    expect(action).toEqual({
      type: 'play-card',
      playerId: 'p2',
      expectedRevision: state.revision,
      handCardUid: stasis.uid,
      laneIndex: 0,
      targetLaneIndex: 0,
    });
    const next = applyAction(state, action);
    expect(next.lanes[0].sides.p1.unit?.stun).toEqual({ turns: 1 });
  });
});
