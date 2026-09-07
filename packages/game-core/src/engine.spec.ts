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
