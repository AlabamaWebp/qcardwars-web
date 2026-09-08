import { describe, expect, it } from 'vitest';
import { CARD_CATALOG, createGame, applyAction, GameRuleError, toClientView } from './index';

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
