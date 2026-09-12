import { describe, expect, it, vi } from 'vitest';
import { AI_PLAYER_NAME, ClientAction, forfeitGame, GameRuleError } from '@qcw/game-core';
import { AiService } from '../src/game/ai.service';
import { DEFAULT_REJOIN_GRACE_MS, GameService, Room } from '../src/game/game.service';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ruleErrorOf(fn: () => unknown): GameRuleError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(GameRuleError);
    return error as GameRuleError;
  }
  throw new Error('Expected the operation to throw a GameRuleError.');
}

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

describe('GameService lane selection (END-1)', () => {
  it('defaults to the classic four lanes when no selection is supplied', () => {
    const service = new GameService();
    const created = service.createRoom('s1', 'Alice');
    expect(created.room.players[0].laneTypes).toEqual(['antlion', 'combine', 'rebel', 'zombie']);
    service.joinRoom('s2', created.room.code, 'Bob');
    // Both sides mirror the creator → symmetric classic board.
    for (const playerId of service.roomForSocket('s1')!.game!.playerOrder) {
      expect(service.roomForSocket('s1')!.game!.lanes.map((lane) => lane.sideTypes[playerId])).toEqual([
        'antlion',
        'combine',
        'rebel',
        'zombie',
      ]);
    }
  });

  it('stores a valid custom selection in canonical pool order and starts the game with it', () => {
    const service = new GameService();
    // Deliberately out-of-pool-order input.
    const created = service.createRoom('s1', 'Alice', undefined, false, ['wraith', 'guardian', 'combine', 'antlion']);
    expect(created.room.players[0].laneTypes).toEqual(['antlion', 'combine', 'guardian', 'wraith']);
    const view = service.roomView(created.room);
    expect(view.players[0].laneTypes).toEqual(['antlion', 'combine', 'guardian', 'wraith']);
    service.joinRoom('s2', created.room.code, 'Bob');
    for (const playerId of service.roomForSocket('s1')!.game!.playerOrder) {
      expect(service.roomForSocket('s1')!.game!.lanes.map((lane) => lane.sideTypes[playerId])).toEqual([
        'antlion',
        'combine',
        'guardian',
        'wraith',
      ]);
    }
  });

  it('accepts a selection with a repeated lane type and stores it in canonical pool order', () => {
    const service = new GameService();
    // Two antlion lanes, supplied out of pool order — must be preserved & reordered.
    const created = service.createRoom(
      's1',
      'Alice',
      undefined,
      false,
      ['antlion', 'guardian', 'antlion', 'zombie'],
    );
    expect(created.room.players[0].laneTypes).toEqual(['antlion', 'antlion', 'zombie', 'guardian']);
    service.joinRoom('s2', created.room.code, 'Bob');
    for (const playerId of service.roomForSocket('s1')!.game!.playerOrder) {
      expect(service.roomForSocket('s1')!.game!.lanes.map((lane) => lane.sideTypes[playerId])).toEqual([
        'antlion',
        'antlion',
        'zombie',
        'guardian',
      ]);
    }
  });

  it('rejects selections that are not exactly 4 pool members', () => {
    const bad = [
      ['antlion', 'combine', 'rebel'], // too few
      ['antlion', 'combine', 'rebel', 'zombie', 'wraith'], // too many
      ['antlion', 'combine', 'rebel', 'gmod'], // unknown type
      'antlion', // not an array
      ['antlion', 'combine', 'rebel', null], // non-string entry
    ];
    for (const laneTypes of bad) {
      const service = new GameService();
      const error = ruleErrorOf(() => service.createRoom('s1', 'Alice', undefined, false, laneTypes));
      expect(error.code).toBe('INVALID_LANE_TYPES');
    }
  });

  it('does not disturb the caller\'s current room when the selection is invalid', () => {
    const service = new GameService();
    const first = service.createRoom('s1', 'Alice');
    service.joinRoom('s2', first.room.code, 'Bob');
    // A duplicate lane type is now valid; use a genuinely invalid (unknown) type here.
    expect(() =>
      service.createRoom('s1', 'Alice', undefined, false, ['antlion', 'combine', 'rebel', 'gmod']),
    ).toThrowError(GameRuleError);
    // s1 is still in the original room, still a player, game untouched.
    const room = service.roomForSocket('s1')!;
    expect(room.code).toBe(first.room.code);
    expect(service.playerForSocket('s1')).not.toBeNull();
    expect(room.game).not.toBeNull();
  });

  it('keeps the room lane selection across rematches', () => {
    const service = new GameService();
    const created = service.createRoom('s1', 'Alice', undefined, false, ['antlion', 'combine', 'guardian', 'wraith']);
    service.joinRoom('s2', created.room.code, 'Bob');
    const room = service.roomForSocket('s1')!;
    // Simulate a finished match, then both players rematch.
    room.game!.status = 'finished';
    room.game!.winnerId = created.playerId;
    service.rematch('s1');
    const after = service.rematch('s2');
    expect(after.game!.status).toBe('playing');
    for (const playerId of after.game!.playerOrder) {
      expect(after.game!.lanes.map((lane) => lane.sideTypes[playerId])).toEqual([
        'antlion',
        'combine',
        'guardian',
        'wraith',
      ]);
    }
  });

  it('starts solo rooms with the selected lanes', () => {
    const service = new GameService();
    const created = service.createRoom('s1', 'Alice', undefined, true, ['guardian', 'wraith', 'rebel', 'zombie']);
    expect(created.room.game).not.toBeNull();
    for (const playerId of created.room.game!.playerOrder) {
      expect(created.room.game!.lanes.map((lane) => lane.sideTypes[playerId])).toEqual([
        'rebel',
        'zombie',
        'guardian',
        'wraith',
      ]);
    }
    expect(created.room.players.find((seat) => seat.ai)?.name).toBe(AI_PLAYER_NAME);
  });

  it('gives the joiner their own lanes while the creator keeps theirs', () => {
    const service = new GameService();
    const created = service.createRoom('s1', 'Alice', undefined, false, ['antlion', 'antlion', 'antlion', 'antlion']);
    service.joinRoom('s2', created.room.code, 'Bob', undefined, ['rebel', 'rebel', 'rebel', 'rebel']);
    const room = service.roomForSocket('s1')!;
    expect(room.players[0].laneTypes).toEqual(['antlion', 'antlion', 'antlion', 'antlion']);
    expect(room.players[1].laneTypes).toEqual(['rebel', 'rebel', 'rebel', 'rebel']);
    const [p1, p2] = room.game!.playerOrder;
    expect(room.game!.lanes.map((lane) => lane.sideTypes[p1])).toEqual([
      'antlion',
      'antlion',
      'antlion',
      'antlion',
    ]);
    expect(room.game!.lanes.map((lane) => lane.sideTypes[p2])).toEqual(['rebel', 'rebel', 'rebel', 'rebel']);
    // The room view exposes both selections; invalid join lanes are rejected.
    const view = service.roomView(room);
    expect(view.players[1].laneTypes).toEqual(['rebel', 'rebel', 'rebel', 'rebel']);
  });

  it('rejects invalid joiner lanes without starting the game or stranding the joiner', () => {
    const service = new GameService();
    const created = service.createRoom('s1', 'Alice');
    const error = ruleErrorOf(() =>
      service.joinRoom('s2', created.room.code, 'Bob', undefined, ['antlion', 'combine', 'rebel']),
    );
    expect(error.code).toBe('INVALID_LANE_TYPES');
    expect(service.roomForSocket('s1')!.game).toBeNull();
  });

  it('gives the solo AI its own lanes when aiLaneTypes are supplied', () => {
    const service = new GameService();
    const created = service.createRoom(
      's1',
      'Alice',
      undefined,
      true,
      ['antlion', 'antlion', 'antlion', 'antlion'],
      ['wraith', 'wraith', 'wraith', 'wraith'],
    );
    const room = created.room;
    const human = room.players.find((seat) => !seat.ai)!;
    const ai = room.players.find((seat) => seat.ai)!;
    expect(human.laneTypes).toEqual(['antlion', 'antlion', 'antlion', 'antlion']);
    expect(ai.laneTypes).toEqual(['wraith', 'wraith', 'wraith', 'wraith']);
    expect(room.game!.lanes.map((lane) => lane.sideTypes[human.playerId])).toEqual([
      'antlion',
      'antlion',
      'antlion',
      'antlion',
    ]);
    expect(room.game!.lanes.map((lane) => lane.sideTypes[ai.playerId])).toEqual([
      'wraith',
      'wraith',
      'wraith',
      'wraith',
    ]);
  });

  it('rejects invalid AI lanes at solo creation', () => {
    const service = new GameService();
    const error = ruleErrorOf(() =>
      service.createRoom('s1', 'Alice', undefined, true, undefined, ['antlion', 'combine']),
    );
    expect(error.code).toBe('INVALID_LANE_TYPES');
  });
});

describe('GameService rejoin grace (P1-04)', () => {
  it('defaults to a 120 second grace window', () => {
    expect(DEFAULT_REJOIN_GRACE_MS).toBe(120_000);
    expect(new GameService().rejoinGraceMs).toBe(120_000);
  });

  it('issues a single-use session token on create and join', () => {
    const service = new GameService();
    const created = service.createRoom('s1', 'Alice');
    expect(created.token).toBeTruthy();
    const joined = service.joinRoom('s2', created.room.code, 'Bob');
    expect(joined.token).toBeTruthy();
    expect(joined.token).not.toBe(created.token);
  });

  it('keeps the seat pre-game on disconnect, then rejoins within the grace window', () => {
    const service = new GameService();
    service.rejoinGraceMs = 10_000;
    const created = service.createRoom('s1', 'Alice');
    const joined = service.joinRoom('s2', created.room.code, 'Bob'); // starts the game
    const room = service.roomForSocket('s2')!;
    const bob = service.playerForSocket('s2')!;
    const revisionBefore = room.game!.revision;

    service.disconnectBySocket('s2');
    const afterDisconnect = service.roomForSocket('s1')!;
    expect(afterDisconnect.players).toHaveLength(2);
    expect(afterDisconnect.players.find((p) => p.playerId === bob.playerId)!.connected).toBe(false);
    expect(service.gameView(afterDisconnect, created.playerId)!.players[bob.playerId].connected).toBe(false);

    // A fresh socket for the same seat rejoins with the token.
    const result = service.rejoin('s3', created.room.code, joined.token);
    expect(result.player.playerId).toBe(bob.playerId);
    const after = service.roomForSocket('s3')!;
    const seat = after.players.find((p) => p.playerId === bob.playerId)!;
    expect(seat.connected).toBe(true);
    expect(seat.socketId).toBe('s3');
    // Same game, same revision lineage (one bump per connect/disconnect flip).
    expect(after.game).not.toBeNull();
    expect(after.game!.revision).toBe(revisionBefore + 2);
    expect(service.gameView(after, bob.playerId)!.players[bob.playerId].connected).toBe(true);
    // The token was consumed: replaying it fails, and a fresh token was issued.
    expect(result.token).not.toBe(joined.token);
    expect(ruleErrorOf(() => service.rejoin('s4', created.room.code, joined.token)).code).toBe('REJOIN_INVALID');
  });

  it('rejects an invalid rejoin token', () => {
    const service = new GameService();
    service.rejoinGraceMs = 10_000;
    const created = service.createRoom('s1', 'Alice');
    service.joinRoom('s2', created.room.code, 'Bob');
    service.disconnectBySocket('s2');
    expect(ruleErrorOf(() => service.rejoin('s9', created.room.code, 'not-a-token')).code).toBe('REJOIN_INVALID');
    // Seat is untouched by the failed attempt.
    expect(service.roomForSocket('s1')!.players).toHaveLength(2);
  });

  it('supports a second rejoin cycle (in-game reload, then tab close and reopen)', () => {
    const service = new GameService();
    service.rejoinGraceMs = 10_000;
    const created = service.createRoom('s1', 'Alice');
    const joined = service.joinRoom('s2', created.room.code, 'Bob'); // starts the game
    const bobId = joined.playerId;

    // Cycle 1: a reload — the old socket disconnects, a fresh socket rejoins.
    service.disconnectBySocket('s2');
    const first = service.rejoin('s3', created.room.code, joined.token);
    expect(first.player.playerId).toBe(bobId);

    // Cycle 2: the tab closes and a brand-new page rejoins with the rotated token.
    service.disconnectBySocket('s3');
    const second = service.rejoin('s4', created.room.code, first.token);
    expect(second.player.playerId).toBe(bobId);
    const seat = second.room.players.find((p) => p.playerId === bobId)!;
    expect(seat.connected).toBe(true);
    expect(seat.socketId).toBe('s4');
    expect(second.room.game!.players[bobId].connected).toBe(true);
  });

  it('rejects a superseded token even when the public player id is supplied', () => {
    const service = new GameService();
    service.rejoinGraceMs = 10_000;
    const created = service.createRoom('s1', 'Alice');
    const joined = service.joinRoom('s2', created.room.code, 'Bob');
    const bobId = joined.playerId;
    const tokenA = joined.token;

    // A faster rejoin from the same seat rotates the token away from A...
    service.disconnectBySocket('s2');
    const fast = service.rejoin('s3', created.room.code, tokenA);
    // ...and the seat disconnects again, arming the rotated token.
    service.disconnectBySocket('s3');

    // A stale token plus a public player id must not reclaim a disconnected
    // seat. Only the rotated token issued to the real player can rejoin.
    expect(ruleErrorOf(() => service.rejoin('s4', created.room.code, tokenA)).code).toBe('REJOIN_INVALID');
    expect(service.roomForSocket('s1')!.players.find((p) => p.playerId === bobId)!.socketId).toBe('s3');
    expect(fast.token).not.toBe(tokenA);
  });

  it('never lets a stale token hijack a connected seat', () => {
    const service = new GameService();
    service.rejoinGraceMs = 10_000;
    const created = service.createRoom('s1', 'Alice');
    const joined = service.joinRoom('s2', created.room.code, 'Bob');
    const bobId = joined.playerId;

    // Rotate token A while the seat ends up connected on s3.
    service.disconnectBySocket('s2');
    service.rejoin('s3', created.room.code, joined.token);

    // A stale client holding token A cannot claim the live seat.
    expect(ruleErrorOf(() => service.rejoin('s9', created.room.code, joined.token)).code).toBe('REJOIN_INVALID');
    expect(service.roomForSocket('s3')!.players.find((p) => p.playerId === bobId)!.socketId).toBe('s3');
  });

  it('still reports REJOIN_EXPIRED after the window lapses, even with the seat id', async () => {
    const service = new GameService();
    service.rejoinGraceMs = 20;
    const created = service.createRoom('s1', 'Alice');
    const joined = service.joinRoom('s2', created.room.code, 'Bob');
    service.disconnectBySocket('s2');
    await sleep(80);
    expect(ruleErrorOf(() => service.rejoin('s3', created.room.code, joined.token)).code).toBe(
      'REJOIN_EXPIRED',
    );
  });

  it('pre-game: grace expiry removes the seat and deletes an empty room', async () => {
    const service = new GameService();
    service.rejoinGraceMs = 500;
    const created = service.createRoom('s1', 'Alice');

    // Seat is preserved immediately after the disconnect: a rejoin within the
    // window succeeds and still shows the solo seat.
    service.disconnectBySocket('s1');
    const rejoined = service.rejoin('s1b', created.room.code, created.token);
    expect(rejoined.room.players).toHaveLength(1);
    expect(rejoined.room.game).toBeNull();

    // After the grace window elapses the (empty) room is deleted.
    service.disconnectBySocket('s1b');
    await sleep(800);
    expect(() => service.joinRoom('s2', created.room.code, 'Bob')).toThrowError(/room not found/i);
    // The seat is gone, so its session records are cleared too: the old token
    // now resolves to nothing at all (generic invalid, not expired).
    expect(ruleErrorOf(() => service.rejoin('s3', created.room.code, rejoined.token)).code).toBe('REJOIN_INVALID');
  });

  it('pre-game: grace expiry clears the seat session records (no sessions/tokenIndex leak)', async () => {
    const service = new GameService();
    service.rejoinGraceMs = 20;
    const created = service.createRoom('s1', 'Alice');
    const seatKey = `${created.room.code}:${created.playerId}`;
    const internals = service as unknown as { sessions: Map<string, unknown>; tokenIndex: Map<string, string> };

    service.disconnectBySocket('s1');
    await sleep(80);

    expect(internals.sessions.get(seatKey)).toBeUndefined();
    expect(internals.tokenIndex.get(created.token)).toBeUndefined();
  });

  it('rejects a rejoin after the grace window with REJOIN_EXPIRED', async () => {
    const service = new GameService();
    service.rejoinGraceMs = 20;
    const created = service.createRoom('s1', 'Alice');
    const joined = service.joinRoom('s2', created.room.code, 'Bob');
    service.disconnectBySocket('s2');
    await sleep(80);
    expect(ruleErrorOf(() => service.rejoin('s3', created.room.code, joined.token)).code).toBe('REJOIN_EXPIRED');
  });

  it('in-game: grace expiry auto-forfeits to the remaining connected player', async () => {
    const service = new GameService();
    service.rejoinGraceMs = 20;
    const created = service.createRoom('s1', 'Alice');
    service.joinRoom('s2', created.room.code, 'Bob');
    let broadcast = 0;
    service.onRoomChanged(() => {
      broadcast += 1;
    });

    service.disconnectBySocket('s2');
    await sleep(80);

    const room = service.roomForSocket('s1')!;
    expect(room.game!.status).toBe('finished');
    expect(room.game!.winnerId).toBe(created.playerId);
    expect(
      room.game!.log.some((entry) => /forfeited \(opponent did not rejoin\)/.test(entry.text)),
    ).toBe(true);
    // The remaining player is notified via the room-changed listener.
    expect(broadcast).toBe(1);
  });

  it('explicit leave cancels the rejoin session (no late rejoin)', async () => {
    const service = new GameService();
    service.rejoinGraceMs = 20;
    const created = service.createRoom('s1', 'Alice');
    service.joinRoom('s2', created.room.code, 'Bob');
    service.leaveBySocket('s2');
    await sleep(80);
    expect(ruleErrorOf(() => service.rejoin('s3', created.room.code, 'whatever')).code).toBe('REJOIN_INVALID');
  });

  it('in-game explicit leave forfeits the match to the remaining connected player', () => {
    const service = new GameService();
    const created = service.createRoom('s1', 'Alice');
    service.joinRoom('s2', created.room.code, 'Bob');
    let broadcast = 0;
    service.onRoomChanged(() => {
      broadcast += 1;
    });

    // Bob deliberately leaves mid-match: the match ends immediately — it can
    // never sit in 'playing' against an un-rejoinable seat.
    service.leaveBySocket('s2');
    const room = service.roomForSocket('s1')!;
    expect(room.game!.status).toBe('finished');
    expect(room.game!.winnerId).toBe(created.playerId);
    expect(room.game!.log.some((entry) => /left the match/.test(entry.text))).toBe(true);
    // The remaining player is notified via the room-changed listener.
    expect(broadcast).toBe(1);

    // When the winner leaves too, no connected players remain: room is deleted.
    service.leaveBySocket('s1');
    expect(service.roomForSocket('s1')).toBeNull();
    expect(service.roomForSocket('s2')).toBeNull();
  });

  it('in-game explicit leave with no remaining connected player deletes the room', () => {
    const service = new GameService();
    service.rejoinGraceMs = 10_000;
    const created = service.createRoom('s1', 'Alice');
    service.joinRoom('s2', created.room.code, 'Bob');
    const internals = service as unknown as { rooms: Map<string, unknown> };

    // Bob's socket drops (seat kept, grace armed), then Alice leaves explicitly.
    service.disconnectBySocket('s2');
    service.leaveBySocket('s1');

    // Nobody connected is left: the room is deleted (no forfeit to run).
    expect(service.roomForSocket('s1')).toBeNull();
    expect(service.roomForSocket('s2')).toBeNull();
    expect(internals.rooms.get(created.room.code)).toBeUndefined();
  });

  it('invalid token cannot reclaim an explicitly-left in-game seat', () => {
    const service = new GameService();
    service.rejoinGraceMs = 10_000;
    const created = service.createRoom('s1', 'Alice');
    service.joinRoom('s2', created.room.code, 'Bob');
    const bob = service.playerForSocket('s2')!;

    // Bob explicitly leaves mid-match: the seat is kept (finished match) but
    // his rejoin session is cancelled, so there is no live grace to claim.
    service.leaveBySocket('s2');

    // A fresh socket holding no seat must NOT claim Bob's seat with a garbage
    // token + his (publicly visible) playerId.
    expect(ruleErrorOf(() => service.rejoin('s9', created.room.code, 'garbage-token')).code).toBe(
      'REJOIN_INVALID',
    );
    // Seat is untouched by the failed attempt.
    const seat = service.roomForSocket('s1')!.players.find((p) => p.playerId === bob.playerId)!;
    expect(seat.connected).toBe(false);
    expect(seat.socketId).toBe('s2');
  });

  it('invalid token cannot reclaim an expired in-game seat', async () => {
    const service = new GameService();
    service.rejoinGraceMs = 20;
    const created = service.createRoom('s1', 'Alice');
    const joined = service.joinRoom('s2', created.room.code, 'Bob');
    const bobId = joined.playerId;

    // Bob's grace lapses while Alice is still connected: the match auto-
    // forfeits and the session entry is retained (for REJOIN_EXPIRED).
    service.disconnectBySocket('s2');
    await sleep(80);
    expect(ruleErrorOf(() => service.rejoin('s3', created.room.code, joined.token)).code).toBe('REJOIN_EXPIRED');

    expect(ruleErrorOf(() => service.rejoin('s4', created.room.code, 'stale-token')).code).toBe(
      'REJOIN_INVALID',
    );
    const room = service.roomForSocket('s1')!;
    const seat = room.players.find((p) => p.playerId === bobId)!;
    expect(seat.connected).toBe(false);
    expect(seat.socketId).toBe('s2');
  });

  it('in-game: both seats gone deletes the room and clears all session records (no leak)', async () => {
    const service = new GameService();
    service.rejoinGraceMs = 20;
    const created = service.createRoom('s1', 'Alice');
    const joined = service.joinRoom('s2', created.room.code, 'Bob');
    const code = created.room.code;
    const internals = service as unknown as {
      rooms: Map<string, unknown>;
      sessions: Map<string, unknown>;
      tokenIndex: Map<string, string>;
    };

    // Both sockets drop mid-match and both grace windows lapse.
    service.disconnectBySocket('s2');
    service.disconnectBySocket('s1');
    await sleep(80);

    expect(internals.rooms.get(code)).toBeUndefined();
    for (const key of internals.sessions.keys()) {
      expect(key.startsWith(`${code}:`)).toBe(false);
    }
    expect(internals.tokenIndex.get(created.token)).toBeUndefined();
    expect(internals.tokenIndex.get(joined.token)).toBeUndefined();
  });

  it('a bogus token plus a public playerId cannot claim a disconnected seat', () => {
    const service = new GameService();
    service.rejoinGraceMs = 10_000;
    const created = service.createRoom('s1', 'Alice');
    const joined = service.joinRoom('s2', created.room.code, 'Bob');
    const bobId = joined.playerId;
    service.disconnectBySocket('s2');

    // A fresh socket that knows Bob's public player id still lacks his
    // credential, so it must not take the disconnected seat.
    // Simulate an old/malicious wire payload that includes playerId. JS will
    // deliver surplus arguments, but the service must ignore the public id.
    const rejoinWithUntrustedPlayerId = service.rejoin.bind(service) as unknown as (
      socketId: string,
      code: string,
      token: string,
      playerId: string,
    ) => unknown;
    expect(ruleErrorOf(() => rejoinWithUntrustedPlayerId('s9', created.room.code, 'bogus-token', bobId)).code).toBe(
      'REJOIN_INVALID',
    );
    // Bob's seat is untouched by the failed attempt.
    const seat = service.roomForSocket('s1')!.players.find((p) => p.playerId === bobId)!;
    expect(seat.connected).toBe(false);
    expect(seat.socketId).toBe('s2');
  });

  it('rejoin resolves a deferred forfeit when the other seat has no live grace', async () => {
    const service = new GameService();
    service.rejoinGraceMs = 100; // A's grace: [0,100), B's grace: [60,160)
    const created = service.createRoom('s1', 'Alice');
    const joined = service.joinRoom('s2', created.room.code, 'Bob');
    const code = created.room.code;
    const internals = service as unknown as { rooms: Map<string, Room> };
    let broadcast = 0;
    service.onRoomChanged(() => {
      broadcast += 1;
    });

    // A disconnects at T+0, B disconnects at T+60.
    service.disconnectBySocket('s1');
    await sleep(60);
    service.disconnectBySocket('s2');

    // At T+100 A's grace lapses: no connected seat remains, B is still inside
    // its live grace → forfeit deferred, room and match preserved.
    await sleep(60);
    expect(internals.rooms.get(code)).toBeDefined();
    expect(internals.rooms.get(code)!.game!.status).toBe('playing');
    expect(broadcast).toBe(0);

    // At T+120 B rejoins with a valid token (still inside his own [60,160)
    // grace). A is expired with no live grace:
    // the deferred forfeit must resolve to B instead of stranding the match.
    const result = service.rejoin('s3', code, joined.token);
    expect(result.player.playerId).toBe(joined.playerId);
    expect(result.room.game!.status).toBe('finished');
    expect(result.room.game!.winnerId).toBe(joined.playerId);
    expect(result.room.game!.log.some((entry) => /did not return in time/.test(entry.text))).toBe(
      true,
    );
    // The rejoiner is notified via the room-changed listener, and the room
    // state is consistent (kept, B connected on the new socket).
    expect(broadcast).toBe(1);
    const room = internals.rooms.get(code)!;
    expect(room.players.find((p) => p.playerId === joined.playerId)!.connected).toBe(true);
    expect(room.players.find((p) => p.playerId === created.playerId)!.connected).toBe(false);
  });

  it('solo: a single rematch confirmation starts a fresh game (AI auto-rematches)', () => {
    const service = new GameService();
    const created = service.createRoom('s1', 'Alice', 42, true, ['guardian', 'wraith', 'rebel', 'zombie']);
    const room = service.roomForSocket('s1')!;
    // Simulate a finished match.
    room.game!.status = 'finished';
    room.game!.winnerId = created.playerId;

    const after = service.rematch('s1');
    expect(after.game!.status).toBe('playing');
    expect(after.game!.revision).toBe(0);
    expect(after.game!.players).toHaveProperty(created.playerId);
    expect(after.game!.players).toHaveProperty(service.aiSeat(after)!.playerId);
    // The room's lane selection survives the rematch (canonical order, both sides).
    for (const playerId of after.game!.playerOrder) {
      expect(after.game!.lanes.map((lane) => lane.sideTypes[playerId])).toEqual([
        'rebel',
        'zombie',
        'guardian',
        'wraith',
      ]);
    }
  });

  it('finished-room leave clears the other seat\'s session records (no leak)', async () => {
    const service = new GameService();
    service.rejoinGraceMs = 20;
    const created = service.createRoom('s1', 'Alice');
    const joined = service.joinRoom('s2', created.room.code, 'Bob');
    const code = created.room.code;
    const internals = service as unknown as {
      rooms: Map<string, unknown>;
      sessions: Map<string, unknown>;
      tokenIndex: Map<string, string>;
    };

    // Bob drops and his grace lapses: the match forfeits to Alice (finished).
    service.disconnectBySocket('s2');
    await sleep(80);
    const room = service.roomForSocket('s1')!;
    expect(room.game!.status).toBe('finished');
    expect(room.game!.winnerId).toBe(created.playerId);

    // The winner leaves back to the lobby: nobody connected remains, so the
    // room is deleted AND both seats' session/token records are cleared.
    service.leaveBySocket('s1');
    expect(internals.rooms.get(code)).toBeUndefined();
    for (const key of internals.sessions.keys()) {
      expect(key.startsWith(`${code}:`)).toBe(false);
    }
    expect(internals.tokenIndex.get(created.token)).toBeUndefined();
    expect(internals.tokenIndex.get(joined.token)).toBeUndefined();
  });
});

describe('GameService solo AI (Phase D D-1)', () => {
  it('creates a started solo room with an always-connected AI seat', () => {
    const service = new GameService();
    const created = service.createRoom('s1', 'Alice', 42, true);
    const room = created.room;
    expect(room.players).toHaveLength(2);
    const ai = service.aiSeat(room);
    expect(ai).not.toBeNull();
    expect(ai!.name).toBe(AI_PLAYER_NAME);
    expect(ai!.connected).toBe(true);
    expect(room.game).not.toBeNull();
    expect(room.game!.status).toBe('playing');
    expect(service.aiRooms()).toHaveLength(1);
  });

  it('does not start a game for a non-solo created room', () => {
    const service = new GameService();
    const created = service.createRoom('s1', 'Alice');
    expect(created.room.game).toBeNull();
    expect(service.aiSeat(created.room)).toBeNull();
    expect(service.aiRooms()).toHaveLength(0);
  });

  it('applyAiAction is a no-op while it is not the AI turn', () => {
    const service = new GameService();
    const created = service.createRoom('s1', 'Alice', 42, true);
    const room = service.roomForSocket('s1')!;
    let broadcasts = 0;
    service.onRoomChanged(() => broadcasts++);
    const revision = room.game!.revision;
    service.applyAiAction(room); // the human (player 1) starts the match
    expect(room.game!.revision).toBe(revision);
    expect(broadcasts).toBe(0);
  });

  it('applyAiAction advances the AI turn by exactly one legal action and broadcasts', () => {
    const service = new GameService();
    const created = service.createRoom('s1', 'Alice', 42, true);
    const room = service.roomForSocket('s1')!;
    // End the human's opening turn through the normal socket path so the AI is active.
    const endTurn = { type: 'end-turn', expectedRevision: room.game!.revision } as ClientAction;
    service.applySocketAction('s1', endTurn);
    expect(room.game!.activePlayerId).toBe(service.aiSeat(room)!.playerId);

    let broadcasts = 0;
    service.onRoomChanged(() => broadcasts++);
    const revisionBefore = room.game!.revision;
    service.applyAiAction(room);
    expect(room.game!.revision).toBe(revisionBefore + 1);
    expect(broadcasts).toBe(1);
  });

  it('AiService.tick() advances the AI by exactly one action per tick, no-ops otherwise', () => {
    const service = new GameService();
    const ai = new AiService(service);
    // Even seed: the first player (the human) starts the match.
    const created = service.createRoom('s1', 'Alice', 8, true);
    const room = service.roomForSocket('s1')!;
    const aiSeat = service.aiSeat(room)!;
    service.applySocketAction('s1', { type: 'end-turn', expectedRevision: room.game!.revision } as ClientAction);
    expect(room.game!.activePlayerId).toBe(aiSeat.playerId);

    const revisionBefore = room.game!.revision;
    ai.tick();
    // The AI takes exactly one action on its own turn.
    expect(room.game!.revision).toBe(revisionBefore + 1);

    if (room.game!.activePlayerId === aiSeat.playerId) {
      // First action was a card/special: the next tick takes one more.
      const afterFirst = room.game!.revision;
      ai.tick();
      expect(room.game!.revision).toBe(afterFirst + 1);
    } else {
      // First action ended the AI's turn: ticks are no-ops on the human turn.
      const afterFirst = room.game!.revision;
      ai.tick();
      expect(room.game!.revision).toBe(afterFirst);
    }
  });

  it('solo: leave/disconnect deletes the room immediately (no grace, no forfeit to the AI)', async () => {
    const service = new GameService();
    service.rejoinGraceMs = 20;
    const created = service.createRoom('s1', 'Alice', 42, true);
    const code = created.room.code;
    const internals = service as unknown as { rooms: Map<string, unknown>; sessions: Map<string, unknown> };

    service.disconnectBySocket('s1');
    expect(service.roomForSocket('s1')).toBeNull();
    await sleep(80);
    expect(internals.rooms.get(code)).toBeUndefined();
    for (const key of internals.sessions.keys()) {
      expect(key.startsWith(`${code}:`)).toBe(false);
    }

    const second = service.createRoom('s2', 'Alice', 43, true);
    service.leaveBySocket('s2');
    expect(service.roomForSocket('s2')).toBeNull();
    expect(internals.rooms.get(second.room.code)).toBeUndefined();
  });

  it('solo rematch re-rolls the seed so the next match is not a replay (L2)', () => {
    const service = new GameService();
    const created = service.createRoom('s1', 'Alice', 42, true);
    const room = service.roomForSocket('s1')!;
    const humanId = created.playerId;
    expect(room.seed).toBe(42);

    // Capture the original match's full card order for the human (hand + deck).
    const originalOrder = [...room.game!.players[humanId].hand, ...room.game!.players[humanId].deck]
      .map((c) => c.cardId);

    // Finish the match so a rematch is legal.
    room.game = forfeitGame(room.game!, humanId, 'test finish');

    // Hermetic reseed: mock Math.random so the new seed is deterministic. The
    // engine's shuffle uses its own seeded PRNG, so Math.random is only consumed
    // by the reseed line — the mock cannot leak into deck building.
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    try {
      service.rematch('s1');
    } finally {
      randomSpy.mockRestore();
    }

    expect(room.game).not.toBeNull();
    expect(room.game!.status).toBe('playing');
    // The re-rolled seed is deterministic under the mocked RNG and differs from the original.
    expect(room.seed).toBe(Math.floor(0.5 * 0x7fffffff));
    expect(room.seed).not.toBe(42);
    // The new match's deck order differs from the original (not a replay).
    const newOrder = [...room.game!.players[humanId].hand, ...room.game!.players[humanId].deck]
      .map((c) => c.cardId);
    expect(newOrder).not.toEqual(originalOrder);
  });
});
