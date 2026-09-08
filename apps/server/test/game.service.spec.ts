import { describe, expect, it } from 'vitest';
import { GameService } from '../src/game/game.service';

describe('GameService rooms', () => {
  it('creates and starts a room when the second player joins', () => {
    const service = new GameService();
    const created = service.createRoom('s1', 'Alice');
    expect(created.room.game).toBeNull();
    const joined = service.joinRoom('s2', created.room.code, 'Bob');
    expect(joined.room.game).not.toBeNull();
    expect(joined.room.players).toHaveLength(2);
  });

  it('does not leak opponent hand identities through personalized game views', () => {
    const service = new GameService();
    const a = service.createRoom('s1', 'Alice');
    service.joinRoom('s2', a.room.code, 'Bob');
    const room = service.roomForSocket('s1')!;
    const p1 = service.playerForSocket('s1')!;
    const p2 = service.playerForSocket('s2')!;
    const view1 = service.gameView(room, p1.playerId)!;
    expect(view1.players[p1.playerId].hand).not.toBeNull();
    expect(view1.players[p2.playerId].hand).toBeNull();
  });

  it('requires both players to request a rematch before starting a new game', () => {
    const service = new GameService();
    const created = service.createRoom('s1', 'Alice');
    service.joinRoom('s2', created.room.code, 'Bob');
    const room = service.roomForSocket('s1')!;
    // Simulate a finished match.
    room.game!.status = 'finished';
    room.game!.winnerId = created.playerId;

    // First request: no new game yet.
    service.rematch('s1');
    expect(service.roomForSocket('s1')!.game!.status).toBe('finished');

    // Second request: a fresh, playable game starts with the same players.
    const after = service.rematch('s2');
    expect(after.game).not.toBeNull();
    expect(after.game!.status).toBe('playing');
    expect(after.game!.revision).toBe(0);
    expect(after.game!.players).toHaveProperty(created.playerId);
    expect(after.game!.players).toHaveProperty(service.playerForSocket('s2')!.playerId);
  });

  it('rejects a rematch when the opponent is disconnected (no solo game)', () => {
    const service = new GameService();
    const created = service.createRoom('s1', 'Alice');
    service.joinRoom('s2', created.room.code, 'Bob');
    const bob = service.playerForSocket('s2')!;
    const room = service.roomForSocket('s1')!;
    // Simulate a finished match, then Bob's socket leaving ("Return to lobby").
    room.game!.status = 'finished';
    service.leaveBySocket('s2');
    expect(bob.connected).toBe(false);

    // Alice requesting a rematch now fails cleanly instead of playing solo.
    expect(() => service.rematch('s1')).toThrowError(/not connected/i);
    expect(service.roomForSocket('s1')!.game!.status).toBe('finished');
  });
});
