import { describe, expect, it } from 'vitest';
import {
  CARD_BY_ID,
  CARD_CATALOG,
  createGame,
  applyAction,
  forfeitGame,
  setPlayerConnected,
  GameRuleError,
  toClientView,
  LANE_TYPES,
  LaneType,
  CardDefinition,
  Effect,
} from './index';

function game(seed = 2) {
  return createGame({
    roomCode: 'ABC123',
    players: [
      { id: 'p1', name: 'Alice' },
      { id: 'p2', name: 'Bob' },
    ],
    seed,
  });
}

function giveCard(state: ReturnType<typeof game>, playerId: string, cardId: string) {
  const next = structuredClone(state);
  const uid = `test-${cardId}-${next.nextUid++}`;
  next.players[playerId].hand.push({ uid, cardId });
  return { state: next, uid };
}

describe('game-core baseline', () => {
  it('creates four typed lanes and hides opponent hand identities', () => {
    const state = game();
    expect(state.lanes.map((lane) => lane.type)).toEqual(['antlion', 'combine', 'rebel', 'zombie']);
    const view = toClientView(state, 'p1');
    expect(view.players.p1.hand).not.toBeNull();
    expect(view.players.p2.hand).toBeNull();
    expect(view.players.p2.handCount).toBeGreaterThan(0);
  });

  it('rejects wrong-lane unit placement atomically', () => {
    let state = game();
    state.activePlayerId = 'p1';
    state.players.p1.mana = 10;
    const provided = giveCard(state, 'p1', 'combine-metrocop');
    state = provided.state;
    expect(() =>
      applyAction(state, {
        type: 'play-card',
        playerId: 'p1',
        expectedRevision: state.revision,
        handCardUid: provided.uid,
        laneIndex: 0,
      }),
    ).toThrow(GameRuleError);
    expect(state.players.p1.mana).toBe(10);
    expect(state.players.p1.hand.some((c) => c.uid === provided.uid)).toBe(true);
  });

  it('plays a unit, spends mana, then attacks an open lane on end turn', () => {
    let state = game();
    state.activePlayerId = 'p1';
    state.players.p1.mana = 10;
    state.players.p1.maxMana = 10;
    const provided = giveCard(state, 'p1', 'combine-metrocop');
    state = applyAction(provided.state, {
      type: 'play-card',
      playerId: 'p1',
      expectedRevision: provided.state.revision,
      handCardUid: provided.uid,
      laneIndex: 1,
    });
    expect(state.players.p1.mana).toBe(8);
    const hpBefore = state.players.p2.hp;
    state = applyAction(state, {
      type: 'end-turn',
      playerId: 'p1',
      expectedRevision: state.revision,
    });
    expect(state.players.p2.hp).toBe(hpBefore - 2);
    expect(state.activePlayerId).toBe('p2');
  });

  it('requires a special unit to survive a turn before activation', () => {
    let state = game();
    state.activePlayerId = 'p1';
    state.players.p1.mana = 10;
    const provided = giveCard(state, 'p1', 'rebel-medic');
    state = applyAction(provided.state, {
      type: 'play-card',
      playerId: 'p1',
      expectedRevision: provided.state.revision,
      handCardUid: provided.uid,
      laneIndex: 2,
    });
    expect(() =>
      applyAction(state, {
        type: 'activate-special',
        playerId: 'p1',
        expectedRevision: state.revision,
        laneIndex: 2,
        targetLaneIndex: 2,
      }),
    ).toThrowError(/survive/i);
  });

  it('catalog contains all three kinds and four factions', () => {
    expect(new Set(CARD_CATALOG.map((card) => card.kind))).toEqual(new Set(['unit', 'building', 'power']));
    for (const faction of ['antlion', 'combine', 'rebel', 'zombie']) {
      expect(CARD_CATALOG.some((card) => card.faction === faction)).toBe(true);
    }
  });

  it('stops combat after a hero-killing hit (no overkill onto later lanes)', () => {
    let state = game();
    state.activePlayerId = 'p1';
    state.players.p1.mana = 10;
    state.players.p1.maxMana = 10;
    const attacker = (atk: number) =>
      ({
        uid: 'u',
        cardId: 'rebel-scout',
        ownerId: 'p1',
        attack: atk,
        health: atk,
        maxHealth: atk,
        turnsSurvived: 1,
        specialUsesRemaining: 0,
      } as const);
    // Lane 0 is open and lethal → kills the hero on the first lane.
    state.lanes[0].sides.p1.unit = attacker(9);
    // Lane 1 has a defender that must NOT get to be attacked (hero already dead).
    state.lanes[1].sides.p1.unit = attacker(5);
    state.lanes[1].sides.p2.unit = {
      uid: 'd',
      cardId: 'rebel-scout',
      ownerId: 'p2',
      attack: 1,
      health: 3,
      maxHealth: 3,
      turnsSurvived: 1,
      specialUsesRemaining: 0,
    };
    state.players.p2.hp = 2; // a single open-lane hit is fatal
    state = endTurn(state, 'p1');
    expect(state.status).toBe('finished');
    const defender = state.lanes[1].sides.p2.unit;
    expect(defender).not.toBeNull();
    expect(defender!.health).toBe(3); // untouched — combat halted after hero death
  });

  it('shows the opponent real current mana (max-only baseline retired)', () => {
    const state = game();
    state.players.p1.mana = 3; // p1 spent some mana this turn
    state.players.p2.maxMana = 5;
    state.players.p2.mana = 2; // p2 spent 3 of 5 mana this turn
    const view = toClientView(state, 'p1');
    // Own current mana stays visible (needed to play cards).
    expect(view.players.p1.mana).toBe(3);
    // Opponent's *current* mana is visible, not just the maximum.
    expect(view.players.p2.mana).toBe(2);
    expect(view.players.p2.maxMana).toBe(5);
    // Symmetric: p2 sees p1's real current mana too.
    const view2 = toClientView(state, 'p2');
    expect(view2.players.p1.mana).toBe(3);
  });

  it('shows the opponent real current HP while keeping the hand hidden', () => {
    const state = game();
    state.players.p1.hp = 21; // p1 took 9 damage
    state.players.p2.hp = 17; // p2 took 13 damage
    const view = toClientView(state, 'p1');
    // Own current HP stays visible.
    expect(view.players.p1.hp).toBe(21);
    // Opponent's *current* HP is visible, not just the maximum.
    expect(view.players.p2.hp).toBe(17);
    // Hand identities remain hidden; counts remain visible.
    expect(view.players.p2.hand).toBeNull();
    expect(view.players.p2.handCount).toBe(state.players.p2.hand.length);
  });

  it('forfeitGame ends a playing match for the given winner with a log entry', () => {
    const state = game();
    const next = forfeitGame(state, 'p2', 'Alice forfeited (opponent did not rejoin). Bob wins.');
    expect(next.status).toBe('finished');
    expect(next.winnerId).toBe('p2');
    expect(next.revision).toBe(state.revision + 1);
    expect(next.log.at(-1)?.text).toBe('Alice forfeited (opponent did not rejoin). Bob wins.');
    // The input state is untouched (side-effect free).
    expect(state.status).toBe('playing');
    expect(state.winnerId).toBeNull();
    // A finished game cannot be forfeited twice.
    expect(() => forfeitGame(next, 'p1', 'again')).toThrowError(GameRuleError);
  });

  it('setPlayerConnected flips the flag without bumping revision on a finished game', () => {
    const finished = forfeitGame(game(), 'p2', 'Alice forfeited.');
    const next = setPlayerConnected(finished, 'p1', false);
    expect(next.players.p1.connected).toBe(false);
    expect(next.revision).toBe(finished.revision);
    // On a still-playing match the flip does bump the revision.
    const playing = game();
    const playingNext = setPlayerConnected(playing, 'p1', false);
    expect(playingNext.revision).toBe(playing.revision + 1);
    expect(playingNext.players.p1.connected).toBe(false);
  });
});

// =============================================================================
// Regression coverage of effect primitives + illegal actions (P1-08)
// =============================================================================

function setActive(state: ReturnType<typeof game>, playerId: string) {
  const next = structuredClone(state);
  next.activePlayerId = playerId;
  next.players[playerId].mana = 10;
  next.players[playerId].maxMana = 10;
  return next;
}

function playCard(
  state: ReturnType<typeof game>,
  playerId: string,
  cardId: string,
  laneIndex?: number,
  targetLaneIndex?: number,
) {
  const provided = giveCard(state, playerId, cardId);
  return applyAction(provided.state, {
    type: 'play-card',
    playerId,
    expectedRevision: provided.state.revision,
    handCardUid: provided.uid,
    laneIndex,
    targetLaneIndex,
  });
}

function endTurn(state: ReturnType<typeof game>, playerId: string) {
  return applyAction(state, {
    type: 'end-turn',
    playerId,
    expectedRevision: state.revision,
  });
}

function activateSpecial(
  state: ReturnType<typeof game>,
  playerId: string,
  laneIndex: number,
  targetLaneIndex?: number,
) {
  const next = structuredClone(state);
  next.activePlayerId = playerId;
  return applyAction(next, {
    type: 'activate-special',
    playerId,
    expectedRevision: next.revision,
    laneIndex,
    targetLaneIndex,
  });
}

/** Run a thunk and return the GameRuleError code it throws (asserting one was thrown). */
function ruleCode(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof GameRuleError) return error.code;
    throw error;
  }
  throw new Error('Expected a GameRuleError but none was thrown');
}

describe('effect primitives via play-card powers', () => {
  it('Focused Strike removes a fully-wounded enemy unit (damage-unit)', () => {
    let state = game(5);
    state = setActive(state, 'p2');
    state = playCard(state, 'p2', 'combine-metrocop', 1);
    state = endTurn(state, 'p2');
    // The newly active player starts their first turn with 0 mana until re-granted.
    state = setActive(state, 'p1');
    expect(state.activePlayerId).toBe('p1');
    expect(state.lanes[1].sides.p2.unit?.health).toBe(3);

    state = playCard(state, 'p1', 'power-strike', 1);
    expect(state.lanes[1].sides.p2.unit).toBeNull();
    expect(state.players.p1.mana).toBe(8);
  });

  it('Shelling reduces hero HP and finishes the game at 0 (damage-hero)', () => {
    let state = game(6);
    state = setActive(state, 'p1');
    state.players.p2.hp = 4;
    state = playCard(state, 'p1', 'power-shelling', 0);
    expect(state.players.p2.hp).toBe(0);
    expect(state.status).toBe('finished');
    expect(state.winnerId).toBe('p1');
  });

  it('Field Treatment heals a friendly unit, clamped at maxHealth (heal-unit)', () => {
    let state = game(7);
    state = setActive(state, 'p1');
    state = playCard(state, 'p1', 'rebel-medic', 2);
    state = structuredClone(state);
    const unit = state.lanes[2].sides.p1.unit!;
    unit.health = 1;
    unit.turnsSurvived = 1;
    const maxHealth = unit.maxHealth;

    state = activateSpecial(state, 'p1', 2, 2);
    const healed = state.lanes[2].sides.p1.unit!;
    expect(healed.maxHealth).toBe(maxHealth);
    expect(healed.health).toBe(Math.min(maxHealth, 1 + 4));
    expect(healed.health).toBe(4);
  });

  it('Reinforce raises a friendly unit attack and both health values (buff-unit)', () => {
    let state = game(8);
    state = setActive(state, 'p1');
    state = playCard(state, 'p1', 'combine-soldier', 1);
    state = structuredClone(state);
    const unit = state.lanes[1].sides.p1.unit!;
    expect(unit.attack).toBe(4);
    expect(unit.maxHealth).toBe(4);
    unit.turnsSurvived = 1;

    state = activateSpecial(state, 'p1', 1, 1);
    const buffed = state.lanes[1].sides.p1.unit!;
    expect(buffed.attack).toBe(6);
    expect(buffed.maxHealth).toBe(5);
    expect(buffed.health).toBe(5);
    expect(state.players.p1.mana).toBe(4);
  });

  it('Sabotage removes an enemy building (destroy-building)', () => {
    let state = game(9);
    state = setActive(state, 'p2');
    state = playCard(state, 'p2', 'building-nest', 0);
    state = endTurn(state, 'p2');
    expect(state.lanes[0].sides.p2.building).not.toBeNull();
    state = setActive(state, 'p1');

    state = playCard(state, 'p1', 'power-sabotage', 0);
    expect(state.lanes[0].sides.p2.building).toBeNull();
  });

  it('Resupply increases hand size by the draw amount (draw/resupply)', () => {
    let state = game(10);
    const handBefore = state.players.p1.hand.length;
    state = setActive(state, 'p1');
    state = playCard(state, 'p1', 'power-resupply', 0);
    expect(state.players.p1.hand.length).toBe(handBefore + 2);
  });
});

describe('building passives', () => {
  it('Ammo Cache adds +1 attack in combat when the enemy lane is open (attack-bonus-own-lane)', () => {
    let state = game(11);
    state = setActive(state, 'p1');
    state = playCard(state, 'p1', 'combine-metrocop', 1);
    state = playCard(state, 'p1', 'building-ammo-cache', 1);
    expect(state.lanes[1].sides.p1.unit?.attack).toBe(2);

    const hpBefore = state.players.p2.hp;
    state = endTurn(state, 'p1');
    expect(state.players.p2.hp).toBe(hpBefore - 3);
  });

  it('Field Hospital heals a wounded unit at the start of its owner turn (heal passive)', () => {
    let state = game(12);
    state = setActive(state, 'p1');
    state = playCard(state, 'p1', 'rebel-medic', 2);
    state = playCard(state, 'p1', 'building-field-hospital', 2);
    state = structuredClone(state);
    state.lanes[2].sides.p1.unit!.health = 2;
    expect(state.lanes[2].sides.p1.unit!.health).toBe(2);

    // p1 ends: the enemy turn starts but does not heal p1's unit
    state = endTurn(state, 'p1');
    expect(state.lanes[2].sides.p1.unit!.health).toBe(2);

    // p2 ends: p1's turn starts and the Field Hospital heals +1
    state = endTurn(state, 'p2');
    expect(state.lanes[2].sides.p1.unit!.health).toBe(3);
  });
});

describe('special readiness (P0-11)', () => {
  it('cannot activate a special before the unit survives a turn, then can', () => {
    let state = game(13);
    state = setActive(state, 'p1');
    state = playCard(state, 'p1', 'rebel-medic', 2);

    expect(() => activateSpecial(state, 'p1', 2, 2)).toThrowError(/survive/i);
    expect(state.lanes[2].sides.p1.unit?.specialUsesRemaining).toBe(2);

    state = endTurn(state, 'p1');
    state = endTurn(state, 'p2');
    expect(state.lanes[2].sides.p1.unit?.turnsSurvived).toBe(1);
    state = setActive(state, 'p1');

    let result: ReturnType<typeof game>;
    expect(() => {
      result = activateSpecial(state, 'p1', 2, 2);
    }).not.toThrow();
    expect(result!.lanes[2].sides.p1.unit?.specialUsesRemaining).toBe(1);
  });
});

describe('illegal actions', () => {
  it('rejects an action by the wrong player (NOT_YOUR_TURN)', () => {
    const state = game(14);
    const nonActive = state.playerOrder.find((id) => id !== state.activePlayerId)!;
    expect(ruleCode(() => endTurn(state, nonActive))).toBe('NOT_YOUR_TURN');
  });

  it('rejects a stale revision (STALE_REVISION)', () => {
    const state = game(15);
    expect(
      ruleCode(() =>
        applyAction(state, {
          type: 'end-turn',
          playerId: state.activePlayerId,
          expectedRevision: state.revision - 1,
        }),
      ),
    ).toBe('STALE_REVISION');
  });

  it('rejects playing into a finished game (GAME_FINISHED)', () => {
    let state = game(16);
    state = setActive(state, 'p1');
    state.players.p2.hp = 1;
    state = playCard(state, 'p1', 'power-shelling', 0);
    expect(state.status).toBe('finished');

    const provided = giveCard(state, 'p1', 'power-strike');
    expect(
      ruleCode(() =>
        applyAction(state, {
          type: 'play-card',
          playerId: 'p1',
          expectedRevision: state.revision,
          handCardUid: provided.uid,
          laneIndex: 1,
        }),
      ),
    ).toBe('GAME_FINISHED');
  });

  it('rejects a unit on a mismatched lane type (WRONG_LANE_TYPE)', () => {
    let state = game(17);
    state = setActive(state, 'p1');
    const provided = giveCard(state, 'p1', 'antlion-runner');
    expect(
      ruleCode(() =>
        applyAction(provided.state, {
          type: 'play-card',
          playerId: 'p1',
          expectedRevision: provided.state.revision,
          handCardUid: provided.uid,
          laneIndex: 1,
        }),
      ),
    ).toBe('WRONG_LANE_TYPE');
    // Rejected atomically: no mana spent, card still in hand.
    expect(provided.state.players.p1.mana).toBe(10);
    expect(provided.state.players.p1.hand.some((c) => c.cardId === 'antlion-runner')).toBe(true);
  });

  it('rejects occupying an already-occupied unit slot (SLOT_OCCUPIED)', () => {
    let state = game(18);
    state = setActive(state, 'p1');
    state = playCard(state, 'p1', 'combine-metrocop', 1);
    const provided = giveCard(state, 'p1', 'rebel-scout');
    expect(
      ruleCode(() =>
        applyAction(provided.state, {
          type: 'play-card',
          playerId: 'p1',
          expectedRevision: provided.state.revision,
          handCardUid: provided.uid,
          laneIndex: 1,
        }),
      ),
    ).toBe('SLOT_OCCUPIED');
    expect(provided.state.players.p1.mana).toBe(8);
  });

  it('rejects playing a card that costs too much mana (INSUFFICIENT_MANA)', () => {
    let state = game(19);
    state = setActive(state, 'p1');
    state.players.p1.mana = 1;
    const provided = giveCard(state, 'p1', 'combine-metrocop');
    expect(
      ruleCode(() =>
        applyAction(provided.state, {
          type: 'play-card',
          playerId: 'p1',
          expectedRevision: provided.state.revision,
          handCardUid: provided.uid,
          laneIndex: 1,
        }),
      ),
    ).toBe('INSUFFICIENT_MANA');
    expect(provided.state.players.p1.mana).toBe(1);
  });

  it('rejects activating a special in a lane with no unit (NO_UNIT)', () => {
    const state = game(20);
    expect(ruleCode(() => activateSpecial(state, 'p1', 0, 0))).toBe('NO_UNIT');
  });
});

describe('victory freeze', () => {
  it('never evolves once the game is finished (GAME_FINISHED)', () => {
    let state = game(21);
    state = setActive(state, 'p1');
    state.players.p2.hp = 1;
    state = playCard(state, 'p1', 'power-shelling', 0);
    expect(state.status).toBe('finished');

    expect(ruleCode(() =>
      applyAction(state, {
        type: 'end-turn',
        playerId: 'p1',
        expectedRevision: state.revision,
      }),
    )).toBe('GAME_FINISHED');
    expect(state.status).toBe('finished');
  });
});

describe('hidden info', () => {
  it('hides opponent hand but reveals own hand and grows it on draw', () => {
    let state = game(22);
    state = setActive(state, 'p1');
    const viewBefore = toClientView(state, 'p1');
    state = playCard(state, 'p1', 'power-resupply', 0);
    const view = toClientView(state, 'p1');

    expect(view.players.p1.hand).not.toBeNull();
    expect(view.players.p1.hand!.length).toBe(viewBefore.players.p1.hand!.length + 2);
    expect(view.players.p1.hand!.length).toBeGreaterThan(0);
    expect(view.players.p2.hand).toBeNull();
    expect(view.players.p2.handCount).toBeGreaterThan(0);
  });
});

describe('determinism', () => {
  it('produces identical states for the same seed', () => {
    const a = game(23);
    const b = game(23);
    expect(a.players).toEqual(b.players);
    expect(a.lanes.map((l) => l.type)).toEqual(b.lanes.map((l) => l.type));
    expect(a.players.p1.deck.map((c) => c.cardId)).toEqual(b.players.p1.deck.map((c) => c.cardId));
    expect(a.players.p1.deck.map((c) => c.uid)).toEqual(b.players.p1.deck.map((c) => c.uid));
  });
});

// =============================================================================
// Coverage of newly added catalog content (P1-01 follow-up)
// =============================================================================

describe('new catalog content', () => {
  it('rebel-commander "Morale" (target none, draw 1) charges/uses/draws via handleSpecial', () => {
    let state = game(30);
    state = setActive(state, 'p1');
    state = playCard(state, 'p1', 'rebel-commander', 2);
    state = endTurn(state, 'p1');
    state = endTurn(state, 'p2'); // unit now survived a turn
    state = setActive(state, 'p1');

    const handBefore = state.players.p1.hand.length;
    const usesBefore = state.lanes[2].sides.p1.unit!.specialUsesRemaining;

    const result = activateSpecial(state, 'p1', 2);
    expect(result.players.p1.mana).toBe(state.players.p1.mana - 1);
    expect(result.lanes[2].sides.p1.unit!.specialUsesRemaining).toBe(usesBefore - 1);
    expect(result.players.p1.hand.length).toBe(handBefore + 1);
    expect(result.log.some((e) => /activates\s+Morale/i.test(e.text))).toBe(true);
  });

  it('combine-laser "Targeting Laser" (buff-unit health:0) raises attack only', () => {
    let state = game(31);
    state = setActive(state, 'p1');
    state = playCard(state, 'p1', 'combine-laser', 1);
    state = endTurn(state, 'p1');
    state = endTurn(state, 'p2'); // survived a turn
    state = setActive(state, 'p1');

    const before = state.lanes[1].sides.p1.unit!;
    expect(before.attack).toBe(3);
    expect(before.maxHealth).toBe(5);

    const after = activateSpecial(state, 'p1', 1, 1);
    const buffed = after.lanes[1].sides.p1.unit!;
    expect(buffed.attack).toBe(5);
    expect(buffed.maxHealth).toBe(5);
    expect(buffed.health).toBe(5);
  });

  it('zombie-bloater "Detonate" damages the enemy hero then self-destructs', () => {
    let state = game(32);
    state = setActive(state, 'p1');
    state = playCard(state, 'p1', 'zombie-bloater', 3);
    state = endTurn(state, 'p1');
    state = endTurn(state, 'p2'); // survived a turn
    state = setActive(state, 'p1');

    const hpBefore = state.players.p2.hp;
    state = activateSpecial(state, 'p1', 3);
    expect(state.players.p2.hp).toBe(hpBefore - 1);
    expect(state.lanes[3].sides.p1.unit).toBeNull();
    expect(state.log.some((e) => /activates\s+Detonate/i.test(e.text))).toBe(true);
    expect(state.log.some((e) => /sacrifices itself/i.test(e.text))).toBe(true);
  });

  it('antlion-tinker "Spitter" removes a fully-wounded enemy unit (enemy-unit special)', () => {
    let state = game(33);
    state = setActive(state, 'p1');
    state = playCard(state, 'p1', 'antlion-tinker', 0);
    state = endTurn(state, 'p1'); // p2 turn
    state = playCard(state, 'p2', 'combine-metrocop', 1);
    state = endTurn(state, 'p2'); // antlion-tinker survived
    state = setActive(state, 'p1');

    expect(state.lanes[0].sides.p1.unit?.turnsSurvived).toBe(1);
    const usesBefore = state.lanes[0].sides.p1.unit!.specialUsesRemaining;

    state = activateSpecial(state, 'p1', 0, 1);
    expect(state.lanes[1].sides.p2.unit).toBeNull(); // metrocop 3 - 3 = 0, destroyed
    expect(state.lanes[0].sides.p1.unit!.specialUsesRemaining).toBe(usesBefore - 1);
  });

  it('Bunker (universal attack-bonus-own-lane) boosts attack in any lane', () => {
    let state = game(34);
    state = setActive(state, 'p1');
    state = playCard(state, 'p1', 'antlion-runner', 0); // attack 2
    state = playCard(state, 'p1', 'building-bunker', 0); // universal -> lane 0 ok
    expect(state.lanes[0].sides.p1.unit?.attack).toBe(2);

    const hpBefore = state.players.p2.hp;
    state = endTurn(state, 'p1');
    expect(state.players.p2.hp).toBe(hpBefore - 3); // 2 + 1 building bonus
  });

  it('Berserk (buff-unit health:0) raises attack only via play-card', () => {
    let state = game(35);
    state = setActive(state, 'p1');
    state = playCard(state, 'p1', 'combine-metrocop', 1);
    state = playCard(state, 'p1', 'power-berserk', 1);
    expect(state.lanes[1].sides.p1.unit?.attack).toBe(4);
    expect(state.lanes[1].sides.p1.unit?.maxHealth).toBe(3);
    expect(state.lanes[1].sides.p1.unit?.health).toBe(3);
  });
});

// =============================================================================
// Phase B effect primitives: debuff-unit, dot, aoe, add-card, gain-mana,
// heal-hero, destroy-unit.
// =============================================================================

describe('phase B effect primitives', () => {
  it('dot ticks at the start of the target owner turns and replaces instead of stacking (dot)', () => {
    let state = game(40);
    state = setActive(state, 'p2');
    state = playCard(state, 'p2', 'combine-metrocop', 1); // 2/3, p2
    state = endTurn(state, 'p2');
    state = setActive(state, 'p1');

    state = playCard(state, 'p1', 'power-venom', 1); // dot 2/2, no immediate damage
    expect(state.lanes[1].sides.p2.unit?.dot).toEqual({ amount: 2, turns: 2 });
    expect(state.lanes[1].sides.p2.unit?.health).toBe(3);
    expect(state.players.p1.mana).toBe(8);

    // p1 ends: p2's turn starts → tick 1 (3-2=1)
    state = endTurn(state, 'p1');
    expect(state.lanes[1].sides.p2.unit?.health).toBe(1);
    expect(state.lanes[1].sides.p2.unit?.dot).toEqual({ amount: 2, turns: 1 });

    // p2's turn: venom is enemy-unit, so p2 cannot re-poison its own unit. p2 just ends;
    // p2's unit does NOT tick during p1's turn.
    state = endTurn(state, 'p2');
    expect(state.lanes[1].sides.p2.unit?.health).toBe(1);
    expect(state.lanes[1].sides.p2.unit?.dot).toEqual({ amount: 2, turns: 1 });

    // p1 re-applies venom to the SAME p2 unit: the dot slot is REPLACED, not stacked.
    state = setActive(state, 'p1');
    state = playCard(state, 'p1', 'power-venom', 1);
    expect(state.lanes[1].sides.p2.unit?.dot).toEqual({ amount: 2, turns: 2 });
    expect(state.lanes[1].sides.p2.unit?.health).toBe(1); // no immediate damage

    // p1 ends: p2's turn starts → the REPLACED dot ticks (1-2 → destroyed).
    state = endTurn(state, 'p1');
    expect(state.lanes[1].sides.p2.unit).toBeNull();
    expect(state.log.some((e) => /is destroyed in lane 2/.test(e.text))).toBe(true);
  });

  it('aoe damages units on both sides of the target lane (aoe)', () => {
    let state = game(41);
    state = setActive(state, 'p2');
    state = playCard(state, 'p2', 'combine-metrocop', 1); // 2/3
    state = endTurn(state, 'p2');
    state = setActive(state, 'p1');
    state = playCard(state, 'p1', 'combine-metrocop', 1); // 2/3
    state = structuredClone(state);
    state.lanes[1].sides.p2.unit!.health = 2; // aoe (2) kills p2's, wounds p1's

    state = playCard(state, 'p1', 'power-scorch', 1);
    expect(state.lanes[1].sides.p1.unit?.health).toBe(1);
    expect(state.lanes[1].sides.p2.unit).toBeNull();
    expect(state.players.p1.mana).toBe(5); // 10 - 2 (metrocop) - 3 (scorch)
    expect(state.log.some((e) => /damage hits both sides of lane 2/.test(e.text))).toBe(true);
    // Other lanes are untouched.
    expect(state.lanes[0].sides.p1.unit).toBeNull();
    expect(state.lanes[2].sides.p2.unit).toBeNull();
  });

  it('debuff clamps attack at 0 and kills the unit when health reaches 0 (debuff-unit)', () => {
    let state = game(42);
    state = setActive(state, 'p2');
    state = playCard(state, 'p2', 'combine-metrocop', 1); // 2/3
    state = endTurn(state, 'p2');
    state = setActive(state, 'p1');

    state = playCard(state, 'p1', 'power-wither', 1); // -2 atk, 1 dmg
    let unit = state.lanes[1].sides.p2.unit!;
    expect(unit.attack).toBe(0); // 2 - 2, clamped at 0
    expect(unit.health).toBe(2);

    state = playCard(state, 'p1', 'power-wither', 1);
    unit = state.lanes[1].sides.p2.unit!;
    expect(unit.attack).toBe(0); // stays clamped
    expect(unit.health).toBe(1);

    state = playCard(state, 'p1', 'power-wither', 1); // 1 - 1 = 0 → destroyed
    expect(state.lanes[1].sides.p2.unit).toBeNull();
    expect(state.log.some((e) => /is destroyed in lane 2/.test(e.text))).toBe(true);
  });

  it('add-card appends a catalog card to the actor hand and no-ops with a log when full (add-card)', () => {
    let state = game(43);
    state = setActive(state, 'p1');
    const handBefore = state.players.p1.hand.length;

    state = playCard(state, 'p1', 'power-salvage', 0);
    expect(state.players.p1.hand.length).toBe(handBefore + 1);
    expect(state.players.p1.hand.some((c) => c.cardId === 'universal-mercenary')).toBe(true);
    expect(state.log.some((e) => /adds\s+Mercenary to their hand/.test(e.text))).toBe(true);

    // Full hand: pad to handCap-1 so that giveCard (inside playCard) brings the hand to
    // exactly the cap — the played card is one of a full hand. The play still succeeds,
    // the added card is NOT appended (no room), and the log explains why.
    state = structuredClone(state);
    while (state.players.p1.hand.length < state.config.handCap - 1) {
      state.players.p1.hand.push({ uid: `pad-${state.players.p1.hand.length}`, cardId: 'bucket' });
    }
    const expected = state.config.handCap - 1; // hand returns to this after consuming the power card
    const mercsBefore = state.players.p1.hand.filter((c) => c.cardId === 'universal-mercenary').length;
    state = playCard(state, 'p1', 'power-salvage', 0);
    expect(state.players.p1.hand.length).toBe(expected);
    expect(state.players.p1.hand.filter((c) => c.cardId === 'universal-mercenary').length).toBe(mercsBefore);
    expect(state.log.some((e) => /hand is full/.test(e.text))).toBe(true);
  });

  it('gain-mana raises actor mana, clamped at maxMana (gain-mana)', () => {
    let state = game(44);
    state = setActive(state, 'p1');
    state.players.p1.mana = 5;
    state = playCard(state, 'p1', 'power-overcharge', 0); // 5 + 2 - 1
    expect(state.players.p1.mana).toBe(6);
    expect(state.log.some((e) => /gains 2 mana/.test(e.text))).toBe(true);

    state = structuredClone(state);
    state.players.p1.mana = 9;
    state = playCard(state, 'p1', 'power-overcharge', 0); // 9 + 2 clamped to 10, - 1
    expect(state.players.p1.mana).toBe(9);
  });

  it('heal-hero restores actor hero HP, clamped at startingHp, and never touches the enemy (heal-hero)', () => {
    let state = game(46);
    state = setActive(state, 'p1');
    state.players.p1.hp = 25;
    state = playCard(state, 'p1', 'power-mend', 0);
    expect(state.players.p1.hp).toBe(28);
    expect(state.players.p2.hp).toBe(30); // enemy untouched

    state = structuredClone(state);
    state.players.p1.hp = 29;
    state = playCard(state, 'p1', 'power-mend', 0); // 29 + 3 clamped at 30
    expect(state.players.p1.hp).toBe(30);
  });

  it('destroy-unit removes the target unit outright (destroy-unit)', () => {
    let state = game(48);
    state = setActive(state, 'p2');
    state = playCard(state, 'p2', 'zombie-poison', 3); // 4/8
    state = endTurn(state, 'p2');
    state = setActive(state, 'p1');

    state = playCard(state, 'p1', 'power-execution', 3);
    expect(state.lanes[3].sides.p2.unit).toBeNull();
    expect(state.log.some((e) => /Poison Zombie is destroyed in lane 4/.test(e.text))).toBe(true);
    expect(state.players.p1.mana).toBe(5); // 10 - 5
  });

  it('antlion-spitter "Venom Coating" applies a dot via a special (dot special)', () => {
    let state = game(49);
    state = setActive(state, 'p1');
    state = playCard(state, 'p1', 'antlion-spitter', 0);
    state = endTurn(state, 'p1');
    state = endTurn(state, 'p2'); // spitter survived a turn
    state = setActive(state, 'p1');
    state = structuredClone(state);
    state.lanes[0].sides.p2.unit = {
      uid: 'd',
      cardId: 'combine-metrocop',
      ownerId: 'p2',
      attack: 2,
      health: 3,
      maxHealth: 3,
      turnsSurvived: 1,
      specialUsesRemaining: 0,
    };

    state = activateSpecial(state, 'p1', 0, 0);
    expect(state.lanes[0].sides.p2.unit?.dot).toEqual({ amount: 2, turns: 2 });
    expect(state.lanes[0].sides.p2.unit?.health).toBe(3); // no immediate damage
  });

  it('combine-drone "Overtap" grants mana via a target-none special (gain-mana special)', () => {
    let state = game(50);
    state = setActive(state, 'p1');
    state = playCard(state, 'p1', 'combine-drone', 1);
    state = endTurn(state, 'p1');
    state = endTurn(state, 'p2'); // drone survived a turn
    state = setActive(state, 'p1'); // mana 10 / maxMana 10
    state.players.p1.mana = 8; // leave headroom under the cap so the gain is observable

    const manaBefore = state.players.p1.mana; // 8
    state = activateSpecial(state, 'p1', 1);
    // Overtap: pay 1 (8 → 7), then gain min(2, maxMana - 7) = 2 → 9. Net +1.
    expect(state.players.p1.mana).toBe(manaBefore + 1);
  });

  it('rebel-engineer "Field Medkit" heals the actor hero via a target-none special (heal-hero special)', () => {
    let state = game(56);
    state = setActive(state, 'p1');
    state.players.p1.hp = 20;
    state = playCard(state, 'p1', 'rebel-engineer', 2);
    state = endTurn(state, 'p1');
    state = endTurn(state, 'p2'); // engineer survived a turn
    state = setActive(state, 'p1');

    state = activateSpecial(state, 'p1', 2);
    expect(state.players.p1.hp).toBe(22);
  });

  it('aoe damages units on both sides but never touches buildings or heroes (aoe vs buildings)', () => {
    let state = game(61);
    state = setActive(state, 'p2');
    state = playCard(state, 'p2', 'combine-metrocop', 1); // 2/3, p2
    state = playCard(state, 'p2', 'building-ammo-cache', 1);
    state = endTurn(state, 'p2');
    state = setActive(state, 'p1');
    state = playCard(state, 'p1', 'combine-metrocop', 1);
    state = structuredClone(state);
    state.lanes[1].sides.p2.unit!.health = 2; // scorch (2) kills p2's, wounds p1's
    const p1HpBefore = state.players.p1.hp;
    const p2HpBefore = state.players.p2.hp;
    const buildingUid = state.lanes[1].sides.p2.building!.uid;

    state = playCard(state, 'p1', 'power-scorch', 1);
    expect(state.lanes[1].sides.p1.unit?.health).toBe(1); // 3 - 2
    expect(state.lanes[1].sides.p2.unit).toBeNull(); // 2 - 2 = 0, destroyed
    // The lane's building survives untouched (not destroyed, not damaged).
    expect(state.lanes[1].sides.p2.building!.uid).toBe(buildingUid);
    expect(state.lanes[1].sides.p1.building).toBeNull();
    // Heroes are not damaged by aoe.
    expect(state.players.p1.hp).toBe(p1HpBefore);
    expect(state.players.p2.hp).toBe(p2HpBefore);
  });

  it('dot tick at turn start can kill a unit before its owner combat resolves the same round (dot + combat order)', () => {
    let state = game(60);
    state.activePlayerId = 'p2'; // p1's turn is about to begin
    const hpBefore = state.players.p2.hp;

    // p1's lane 1: poisoned to death by this tick (2 HP - 2 dot = 0).
    state.lanes[0].sides.p1.unit = {
      uid: 'dot-u',
      cardId: 'rebel-scout',
      ownerId: 'p1',
      attack: 4,
      health: 2,
      maxHealth: 3,
      turnsSurvived: 1,
      specialUsesRemaining: 0,
      dot: { amount: 2, turns: 2 },
    };
    // p1's lane 2: unpoisoned attacker into an open lane.
    state.lanes[1].sides.p1.unit = {
      uid: 'atk-u',
      cardId: 'rebel-scout',
      ownerId: 'p1',
      attack: 3,
      health: 3,
      maxHealth: 3,
      turnsSurvived: 1,
      specialUsesRemaining: 0,
    };

    // p2 ends: p1's turn starts → the dot ticks first (lane 1 unit dies).
    state = endTurn(state, 'p2');
    expect(state.lanes[0].sides.p1.unit).toBeNull(); // died to the dot tick
    // Then p1's turn ends → combat runs with only the surviving lane 2 unit.
    state = endTurn(state, 'p1');
    expect(state.lanes[1].sides.p1.unit).not.toBeNull();
    // Exact numbers: only the surviving unit dealt damage (3, not 3 + 4).
    expect(state.players.p2.hp).toBe(hpBefore - 3);
    // Exact order: the dot tick (start of p1's turn) precedes p1's combat.
    const dotSeq = state.log.find((e) => /suffers 2 dot damage in lane 1/.test(e.text))!.seq;
    const atkSeq = state.log.find((e) => /deals 3 direct damage/.test(e.text))!.seq;
    expect(dotSeq).toBeLessThan(atkSeq);
  });

  it('toClientView carries the dot slot through to the lane view (client view flow)', () => {
    let state = game(51);
    state = setActive(state, 'p2');
    state = playCard(state, 'p2', 'combine-metrocop', 1);
    state = endTurn(state, 'p2');
    state = setActive(state, 'p1');
    state = playCard(state, 'p1', 'power-venom', 1);

    const view = toClientView(state, 'p1');
    expect(view.lanes[1].sides.p2.unit?.dot).toEqual({ amount: 2, turns: 2 });
  });
});

describe('illegal actions (phase B)', () => {
  /** Temporarily register a test-only card definition, restored in `finally`. */
  function withFakeCard(card: CardDefinition, fn: () => void): void {
    (CARD_CATALOG as CardDefinition[]).push(card);
    CARD_BY_ID.set(card.id, card);
    try {
      fn();
    } finally {
      CARD_BY_ID.delete(card.id);
      const mutable = CARD_CATALOG as CardDefinition[];
      mutable.splice(mutable.indexOf(card), 1);
    }
  }

  it('rejects an aoe power whose target is not a lane (AOE_REQUIRES_LANE)', () => {
    withFakeCard(
      {
        id: 'test-aoe-bad',
        name: 'Bad AOE',
        kind: 'power',
        faction: 'universal',
        tier: 1,
        cost: 1,
        description: 'test',
        target: 'none',
        effects: [{ type: 'aoe', amount: 1 }],
      },
      () => {
        let state = game(52);
        const active = state.activePlayerId;
        state = setActive(state, active);
        const provided = giveCard(state, active, 'test-aoe-bad');
        expect(
          ruleCode(() =>
            applyAction(provided.state, {
              type: 'play-card',
              playerId: active,
              expectedRevision: provided.state.revision,
              handCardUid: provided.uid,
            }),
          ),
        ).toBe('AOE_REQUIRES_LANE');
      },
    );
  });

  it('rejects a lane-target power played without a lane (INVALID_TARGET)', () => {
    let state = game(53);
    const active = state.activePlayerId;
    state = setActive(state, active);
    const provided = giveCard(state, active, 'power-scorch');
    expect(
      ruleCode(() =>
        applyAction(provided.state, {
          type: 'play-card',
          playerId: active,
          expectedRevision: provided.state.revision,
          handCardUid: provided.uid,
        }),
      ),
    ).toBe('INVALID_TARGET');
  });

  it('rejects an add-card effect referencing an unknown cardId (UNKNOWN_CARD)', () => {
    withFakeCard(
      {
        id: 'test-salvage-bad',
        name: 'Bad Salvage',
        kind: 'power',
        faction: 'universal',
        tier: 1,
        cost: 1,
        description: 'test',
        target: 'none',
        effects: [{ type: 'add-card', cardId: 'no-such-card' }],
      },
      () => {
        let state = game(55);
        const active = state.activePlayerId;
        state = setActive(state, active);
        const provided = giveCard(state, active, 'test-salvage-bad');
        expect(
          ruleCode(() =>
            applyAction(provided.state, {
              type: 'play-card',
              playerId: active,
              expectedRevision: provided.state.revision,
              handCardUid: provided.uid,
            }),
          ),
        ).toBe('UNKNOWN_CARD');
      },
    );
  });

  it('rejects a unit special whose add-card effect references a missing id BEFORE spending (UNKNOWN_CARD atomicity)', () => {
    const badUnit: CardDefinition = {
      id: 'test-salvager-bad',
      name: 'Bad Salvager',
      kind: 'unit',
      faction: 'universal',
      tier: 1,
      cost: 1,
      description: 'test',
      attack: 1,
      health: 1,
      special: {
        name: 'Bad Salvage',
        description: 'test',
        cost: 2,
        uses: 2,
        target: 'none',
        effects: [{ type: 'add-card', cardId: 'no-such-card' }],
      },
    };
    withFakeCard(badUnit, () => {
      let state = game(62);
      state = setActive(state, 'p1');
      state = playCard(state, 'p1', 'test-salvager-bad', 0); // universal → lane 0 ok
      state = endTurn(state, 'p1');
      state = endTurn(state, 'p2'); // unit has survived a turn
      state = setActive(state, 'p1');

      // Mana below the special's cost (2): if the engine checked resources before
      // validating effect card ids, this would be INSUFFICIENT_MANA instead.
      state.players.p1.mana = 1;
      const usesBefore = state.lanes[0].sides.p1.unit!.specialUsesRemaining; // 2
      expect(ruleCode(() => activateSpecial(state, 'p1', 0))).toBe('UNKNOWN_CARD');
      // Atomic: the special's cost and use are NOT consumed.
      expect(state.players.p1.mana).toBe(1);
      expect(state.lanes[0].sides.p1.unit!.specialUsesRemaining).toBe(usesBefore);
      expect(state.lanes[0].sides.p1.unit).not.toBeNull();
    });
  });

  it('rejects destroy-unit when the target lane has no enemy unit (INVALID_TARGET)', () => {
    let state = game(54);
    const active = state.activePlayerId;
    state = setActive(state, active);
    const provided = giveCard(state, active, 'power-execution');
    expect(
      ruleCode(() =>
        applyAction(provided.state, {
          type: 'play-card',
          playerId: active,
          expectedRevision: provided.state.revision,
          handCardUid: provided.uid,
          laneIndex: 0,
        }),
      ),
    ).toBe('INVALID_TARGET');
  });
});

describe('catalog coverage (B-4, updated for Phase C)', () => {
  const PRIMITIVES = ['debuff-unit', 'dot', 'aoe', 'add-card', 'gain-mana', 'heal-hero', 'destroy-unit'];

  function cardEffects(card: CardDefinition): readonly Effect[] {
    if (card.kind === 'power') return card.effects;
    if (card.kind === 'unit' && card.special) return card.special.effects;
    return [];
  }

  it('stays in the 70-75 card window with no faction below 6 cards', () => {
    expect(CARD_CATALOG.length).toBeGreaterThanOrEqual(70);
    expect(CARD_CATALOG.length).toBeLessThanOrEqual(75);
    for (const faction of LANE_TYPES) {
      expect(
        CARD_CATALOG.filter((card) => card.faction === faction).length,
        `${faction} should have 6+ cards`,
      ).toBeGreaterThanOrEqual(6);
    }
    const universals = CARD_CATALOG.filter((card) => card.faction === 'universal').length;
    expect(universals).toBeGreaterThanOrEqual(11);
    expect(universals).toBeLessThanOrEqual(13);
  });

  it('has 10+ buildings, at least one per lane type, and costs spanning 1-8', () => {
    const buildings = CARD_CATALOG.filter((card) => card.kind === 'building');
    expect(buildings.length).toBeGreaterThanOrEqual(10);
    for (const faction of LANE_TYPES) {
      expect(buildings.some((card) => card.faction === faction)).toBe(true);
    }
    const costs = new Set(CARD_CATALOG.map((card) => card.cost));
    for (const cost of [1, 2, 3, 4, 5, 6, 7, 8]) expect(costs.has(cost)).toBe(true);
  });

  it('exercises all 7 Phase B primitives, each across multiple cards and factions', () => {
    for (const primitive of PRIMITIVES) {
      const using = CARD_CATALOG.filter((card) =>
        cardEffects(card).some((effect) => effect.type === primitive),
      );
      expect(using.length, `${primitive} should be used by 2+ cards`).toBeGreaterThanOrEqual(2);
      expect(
        new Set(using.map((card) => card.faction)).size,
        `${primitive} should be used across 2+ factions`,
      ).toBeGreaterThanOrEqual(2);
    }
  });

  it('keeps the Phase B card ids present', () => {
    const ids = [
      'power-venom',
      'power-rot',
      'power-scorch',
      'power-mend',
      'power-overcharge',
      'power-salvage',
      'power-execution',
      'power-wither',
      'antlion-spitter',
      'rebel-engineer',
      'combine-drone',
    ];
    for (const id of ids) expect(CARD_BY_ID.has(id)).toBe(true);
  });
});

describe('Phase D LOW-5: dot replacement, heal clamp, contested-lane attack bonus', () => {
  it('a second dot REPLACES the first (dots never stack)', () => {
    let state = game(9);
    state = setActive(state, 'p1');
    // A healthy enemy unit on the combine lane to poison twice.
    state.lanes[1].sides.p2.unit = {
      uid: 'victim',
      cardId: 'combine-metrocop',
      ownerId: 'p2',
      attack: 2,
      health: 5,
      maxHealth: 5,
      turnsSurvived: 1,
      specialUsesRemaining: 0,
    };
    // Venom: dot 2/2.
    state = playCard(state, 'p1', 'power-venom', 1);
    expect(state.lanes[1].sides.p2.unit!.dot).toEqual({ amount: 2, turns: 2 });
    // Rot: dot 1/3. Must replace venom, not stack into 3/5.
    state = playCard(state, 'p1', 'power-rot', 1);
    expect(state.lanes[1].sides.p2.unit!.dot).toEqual({ amount: 1, turns: 3 });
  });

  it('building passive heal restores a wounded unit but clamps at maxHealth', () => {
    let state = game(9);
    state = setActive(state, 'p2'); // so ending p2's turn starts p1's turn
    // Wounded p1 unit (4/5) + Field Hospital (+1 at turn start) on the rebel lane.
    state.lanes[2].sides.p1.unit = {
      uid: 'medic',
      cardId: 'rebel-medic',
      ownerId: 'p1',
      attack: 2,
      health: 4,
      maxHealth: 5,
      turnsSurvived: 1,
      specialUsesRemaining: 0,
    };
    state.lanes[2].sides.p1.building = { uid: 'hospital', cardId: 'building-field-hospital', ownerId: 'p1' };

    state = endTurn(state, 'p2'); // starts p1's turn → heal 4→5
    expect(state.lanes[2].sides.p1.unit!.health).toBe(5);

    // A full-heal turn must NOT over-heal past maxHealth (5, not 6).
    state = endTurn(state, 'p1'); // p1 ends → p2's turn
    state = endTurn(state, 'p2'); // p2 ends → p1's turn (heal attempt again)
    expect(state.lanes[2].sides.p1.unit!.health).toBe(5);
  });

  it('attack-bonus-own-lane adds +2 to a contested-lane attack (not the open lane)', () => {
    let state = game(9);
    state = setActive(state, 'p1');
    // p1 unit (2 ATK) + Power Substation (+2) on the combine lane, contested by p2.
    state.lanes[1].sides.p1.unit = {
      uid: 'attacker',
      cardId: 'combine-metrocop',
      ownerId: 'p1',
      attack: 2,
      health: 5,
      maxHealth: 5,
      turnsSurvived: 1,
      specialUsesRemaining: 0,
    };
    state.lanes[1].sides.p1.building = { uid: 'substation', cardId: 'building-power-substation', ownerId: 'p1' };
    state.lanes[1].sides.p2.unit = {
      uid: 'defender',
      cardId: 'combine-metrocop',
      ownerId: 'p2',
      attack: 2,
      health: 5,
      maxHealth: 5,
      turnsSurvived: 1,
      specialUsesRemaining: 0,
    };

    state = endTurn(state, 'p1'); // p1 attacks: 2 base + 2 substation = 4 to the defender
    const defender = state.lanes[1].sides.p2.unit;
    expect(defender).not.toBeNull();
    expect(defender!.health).toBe(1); // 5 - 4, so the +2 bonus was applied
    // The bonus only buffs the attacker; p1's unit took no retaliation.
    expect(state.lanes[1].sides.p1.unit!.health).toBe(5);
  });
});

describe('Phase D D-2: match summary stats', () => {
  it('tracks turnsTaken and cardsPlayed, and exposes stats in the client view', () => {
    const fresh = game(); // seed even → p1 opens: the opening turn is already counted
    expect(fresh.stats.p1).toEqual({ turnsTaken: 1, cardsPlayed: 0, unitsDestroyed: 0, damageDealt: 0 });
    expect(fresh.stats.p2).toEqual({ turnsTaken: 0, cardsPlayed: 0, unitsDestroyed: 0, damageDealt: 0 });

    let state = fresh;
    state = setActive(state, 'p1');
    state = playCard(state, 'p1', 'combine-metrocop', 1);
    state = endTurn(state, 'p1'); // p2's turn starts
    state = endTurn(state, 'p2'); // p1's turn starts again
    expect(state.stats.p1.turnsTaken).toBe(2);
    expect(state.stats.p2.turnsTaken).toBe(1);
    expect(state.stats.p1.cardsPlayed).toBe(1);
    expect(state.stats.p2.cardsPlayed).toBe(0);

    // Both players see both stats blocks (aggregates are public).
    const view = toClientView(state, 'p1');
    expect(view.stats.p1).toEqual(state.stats.p1);
    expect(view.stats.p2).toEqual(state.stats.p2);
  });

  it('credits combat damage (building bonus + open-lane hero hits) and kills', () => {
    let state = game();
    state = setActive(state, 'p1');
    state.lanes[1].sides.p1.unit = {
      uid: 'a1', cardId: 'combine-metrocop', ownerId: 'p1',
      attack: 2, health: 5, maxHealth: 5, turnsSurvived: 1, specialUsesRemaining: 0,
    };
    state.lanes[1].sides.p1.building = { uid: 'b1', cardId: 'building-power-substation', ownerId: 'p1' };
    state.lanes[1].sides.p2.unit = {
      uid: 'd1', cardId: 'combine-metrocop', ownerId: 'p2',
      attack: 1, health: 3, maxHealth: 3, turnsSurvived: 1, specialUsesRemaining: 0,
    };
    state.lanes[0].sides.p1.unit = {
      uid: 'a0', cardId: 'antlion-spitter', ownerId: 'p1',
      attack: 3, health: 4, maxHealth: 4, turnsSurvived: 1, specialUsesRemaining: 0,
    };
    const hpBefore = state.players.p2.hp;
    state = endTurn(state, 'p1'); // lane 1: 2+2=4 kills the 3-HP defender; lane 0: 3 direct
    expect(state.players.p2.hp).toBe(hpBefore - 3);
    expect(state.stats.p1.damageDealt).toBe(7); // 4 (unit) + 3 (hero)
    expect(state.stats.p1.unitsDestroyed).toBe(1);
    expect(state.stats.p2.damageDealt).toBe(0);
    expect(state.stats.p2.unitsDestroyed).toBe(0);
  });

  it('credits dot damage and dot kills to the dot owner (the opponent)', () => {
    let state = game();
    state = setActive(state, 'p1');
    state.lanes[1].sides.p2.unit = {
      uid: 'v', cardId: 'combine-metrocop', ownerId: 'p2',
      attack: 1, health: 2, maxHealth: 2, turnsSurvived: 1, specialUsesRemaining: 0,
    };
    state = playCard(state, 'p1', 'power-venom', 1); // dot 2/2
    state = endTurn(state, 'p1'); // p2's turn starts → dot tick kills the 2-HP unit
    expect(state.lanes[1].sides.p2.unit).toBeNull();
    expect(state.stats.p1.damageDealt).toBe(2);
    expect(state.stats.p1.unitsDestroyed).toBe(1);
    expect(state.stats.p2.damageDealt).toBe(0);
  });

  it('aoe self-hit is not counted as damage dealt and the death is credited to nobody (L1)', () => {
    let state = game();
    state = setActive(state, 'p1');
    // p1's own unit in lane 1 is low HP (the aoe self-hit kills it); p2's unit
    // is high HP (it survives the aoe).
    state.lanes[1].sides.p1.unit = {
      uid: 'own', cardId: 'combine-metrocop', ownerId: 'p1',
      attack: 1, health: 1, maxHealth: 3, turnsSurvived: 1, specialUsesRemaining: 0,
    };
    state.lanes[1].sides.p2.unit = {
      uid: 'foe', cardId: 'combine-metrocop', ownerId: 'p2',
      attack: 1, health: 5, maxHealth: 5, turnsSurvived: 1, specialUsesRemaining: 0,
    };
    state = playCard(state, 'p1', 'power-scorch', 1); // aoe amount 2
    expect(state.lanes[1].sides.p1.unit).toBeNull(); // self-hit destroyed it
    expect(state.lanes[1].sides.p2.unit?.health).toBe(3); // opponent unit survived
    // Only the hit on the opponent is "damage dealt"; the self-hit is not counted.
    expect(state.stats.p1.damageDealt).toBe(2);
    // The self-destroyed unit is credited to nobody: the opponent did NOT kill it.
    expect(state.stats.p2.unitsDestroyed).toBe(0);
    // p1's aoe did not destroy any enemy unit (p2's survived), so no kill credit.
    expect(state.stats.p1.unitsDestroyed).toBe(0);
  });
});

describe('selectable lanes (END-1)', () => {
  function gameWithLanes(seed: number, laneTypes: readonly string[]): ReturnType<typeof game> {
    return createGame({
      roomCode: 'END1',
      players: [
        { id: 'p1', name: 'Alice' },
        { id: 'p2', name: 'Bob' },
      ],
      seed,
      config: { laneTypes: laneTypes as readonly LaneType[] },
    });
  }

  it('defaults to the classic four lanes when no selection is supplied', () => {
    expect(game(7).lanes.map((lane) => lane.type)).toEqual(['antlion', 'combine', 'rebel', 'zombie']);
  });

  it('builds lanes in canonical pool order for an arbitrary 4-of-6 selection', () => {
    const state = gameWithLanes(7, ['wraith', 'guardian', 'combine', 'antlion']);
    expect(state.lanes.map((lane) => lane.type)).toEqual(['antlion', 'combine', 'guardian', 'wraith']);
  });

  it('rejects lane selections that are not exactly 4 distinct pool members', () => {
    const bad = [
      ['antlion', 'combine', 'rebel'], // too few
      ['antlion', 'combine', 'rebel', 'zombie', 'wraith'], // too many
      ['antlion', 'antlion', 'rebel', 'zombie'], // duplicate
      ['antlion', 'combine', 'rebel', 'gmod'], // unknown type
    ];
    for (const laneTypes of bad) {
      expect(
        ruleCode(() =>
          createGame({
            roomCode: 'BAD',
            players: [
              { id: 'p1', name: 'A' },
              { id: 'p2', name: 'B' },
            ],
            seed: 3,
            config: { laneTypes: laneTypes as readonly LaneType[] },
          }),
        ),
      ).toBe('INVALID_LANE_TYPES');
    }
  });

  it('decks contain only cards whose faction is universal or a selected lane', () => {
    const state = gameWithLanes(11, ['antlion', 'combine', 'guardian', 'wraith']);
    const selected = new Set<string>(['antlion', 'combine', 'guardian', 'wraith']);
    for (const playerId of ['p1', 'p2']) {
      for (const handCard of [...state.players[playerId].deck, ...state.players[playerId].hand]) {
        const faction = CARD_BY_ID.get(handCard.cardId)!.faction;
        expect(faction === 'universal' || selected.has(faction)).toBe(true);
      }
    }
  });

  it('draws the new factions into decks when their lanes are selected', () => {
    const state = gameWithLanes(11, ['antlion', 'combine', 'guardian', 'wraith']);
    const factions = new Set(
      [
        ...state.players.p1.deck,
        ...state.players.p1.hand,
        ...state.players.p2.deck,
        ...state.players.p2.hand,
      ].map((handCard) => CARD_BY_ID.get(handCard.cardId)!.faction),
    );
    expect(factions.has('guardian')).toBe(true);
    expect(factions.has('wraith')).toBe(true);
  });

  it('lets a guardian unit play only into the guardian lane', () => {
    const state = gameWithLanes(13, ['antlion', 'combine', 'guardian', 'wraith']);
    const active = setActive(state, 'p1');
    const played = playCard(active, 'p1', 'guardian-priest', 2);
    expect(played.lanes[2].sides.p1.unit?.cardId).toBe('guardian-priest');
    const rejected = giveCard(active, 'p1', 'guardian-priest');
    expect(
      ruleCode(() =>
        applyAction(rejected.state, {
          type: 'play-card',
          playerId: 'p1',
          expectedRevision: rejected.state.revision,
          handCardUid: rejected.uid,
          laneIndex: 0, // antlion lane
        }),
      ),
    ).toBe('WRONG_LANE_TYPE');
  });

  it('wraith Death Touch kills a 3-HP enemy unit in another lane', () => {
    let state = gameWithLanes(17, ['rebel', 'zombie', 'guardian', 'wraith']);
    state = setActive(state, 'p1');
    state = playCard(state, 'p1', 'wraith-reaper', 3); // 3/2 in the wraith lane
    state = endTurn(state, 'p1');
    state = playCard(state, 'p2', 'rebel-scout', 0); // 1/3 in the rebel lane
    state = endTurn(state, 'p2'); // p1's turn starts; reaper has survived a turn
    state = activateSpecial(state, 'p1', 3, 0);
    expect(state.lanes[0].sides.p2.unit).toBeNull();
  });

  it('applies every effect of a multi-effect power (Soul Theft: debuff + damage + hero heal)', () => {
    let state = gameWithLanes(19, ['rebel', 'zombie', 'guardian', 'wraith']);
    state = setActive(state, 'p1');
    state = structuredClone(state);
    state.players.p1.hp = 25;
    state.lanes[3].sides.p2.unit = {
      uid: 'target',
      cardId: 'wraith-stalker',
      ownerId: 'p2',
      attack: 4,
      health: 5,
      maxHealth: 5,
      turnsSurvived: 1,
      specialUsesRemaining: 0,
    };
    state = playCard(state, 'p1', 'power-soul-theft', 3, 3);
    const target = state.lanes[3].sides.p2.unit!;
    expect(target.attack).toBe(3); // 4 - 1 debuff
    expect(target.health).toBe(3); // 5 - 2 debuff damage
    expect(state.players.p1.hp).toBe(27); // 25 + 2 hero heal
  });

  it('sacred shrine heals the guardian-lane unit at the start of its owner\'s turn', () => {
    let state = gameWithLanes(23, ['antlion', 'combine', 'guardian', 'wraith']);
    state = setActive(state, 'p1');
    state = playCard(state, 'p1', 'guardian-sentinel', 2); // 1/5 in the guardian lane
    state = playCard(state, 'p1', 'building-sacred-shrine', 2);
    state = structuredClone(state);
    state.lanes[2].sides.p1.unit!.health = 2;
    state = endTurn(state, 'p1'); // p2's turn
    state = endTurn(state, 'p2'); // p1's turn starts → shrine heals 1
    expect(state.lanes[2].sides.p1.unit?.health).toBe(3);
  });

  it('universal cards play in any lane of any selection', () => {
    const state = gameWithLanes(29, ['guardian', 'wraith', 'antlion', 'zombie']);
    const played = playCard(setActive(state, 'p1'), 'p1', 'universal-mercenary', 2);
    expect(played.lanes[2].sides.p1.unit?.cardId).toBe('universal-mercenary');
  });

  it('rejects playing a faction power whose lane is not in the match', () => {
    const state = gameWithLanes(31, ['antlion', 'combine', 'rebel', 'zombie']);
    const active = setActive(state, 'p1');
    const rejected = giveCard(active, 'p1', 'power-sacred-light');
    expect(
      ruleCode(() =>
        applyAction(rejected.state, {
          type: 'play-card',
          playerId: 'p1',
          expectedRevision: rejected.state.revision,
          handCardUid: rejected.uid,
        }),
      ),
    ).toBe('WRONG_LANE_TYPE');
  });
});
