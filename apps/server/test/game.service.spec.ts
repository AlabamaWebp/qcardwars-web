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
});
