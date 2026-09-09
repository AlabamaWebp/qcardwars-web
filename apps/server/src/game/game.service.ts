import { Injectable } from '@nestjs/common';
import {
  applyAction,
  ClientAction,
  ClientGameView,
  createGame,
  forfeitGame,
  GameAction,
  GameRuleError,
  GameState,
  setPlayerConnected,
  toClientView,
} from '@qcw/game-core';

export interface RoomPlayer {
  playerId: string;
  socketId: string;
  name: string;
  connected: boolean;
}

export interface Room {
  code: string;
  players: RoomPlayer[];
  game: GameState | null;
  seed?: number;
}

export interface RoomView {
  code: string;
  players: Array<{ id: string; name: string; connected: boolean }>;
  started: boolean;
}

/** Default rejoin grace window (SPEC "Room lifecycle"): 120 seconds. */
export const DEFAULT_REJOIN_GRACE_MS = 120_000;

/**
 * One rejoin session per seat (roomCode + playerId). The token is issued when
 * the player joins/creates (or after a successful rejoin) and becomes armed —
 * with an expiry timestamp and a cleanup timer — when their socket disconnects.
 * Tokens are single-use: a successful rejoin consumes the token and issues a
 * fresh one (delivered via `session:identity`).
 */
interface SessionToken {
  token: string;
  code: string;
  playerId: string;
  /** When the rejoin window expires; null until the session is armed by a disconnect. */
  expiresAt: number | null;
  timer: ReturnType<typeof setTimeout> | null;
}

@Injectable()
export class GameService {
  /** Configurable grace window; tests may shorten this. Not env-plumbed for MVP. */
  rejoinGraceMs = DEFAULT_REJOIN_GRACE_MS;
  /** Injectable clock so expiry is deterministic in tests. */
  now: () => number = () => Date.now();

  private readonly rooms = new Map<string, Room>();
  private readonly socketToRoom = new Map<string, string>();
  private readonly rematchRequests = new Map<string, Set<string>>();
  private readonly sessions = new Map<string, SessionToken>();
  private readonly tokenIndex = new Map<string, string>();
  private readonly roomChangedListeners: Array<(room: Room) => void> = [];

  /**
   * Lets the gateway react to server-driven room changes (grace expiry: seat
   * removal or auto-forfeit) by rebroadcasting the current views.
   */
  onRoomChanged(listener: (room: Room) => void): void {
    this.roomChangedListeners.push(listener);
  }

  createRoom(socketId: string, rawName: string, seed?: number): { room: Room; playerId: string; token: string } {
    this.leaveBySocket(socketId);
    const code = this.generateRoomCode();
    const playerId = this.generatePlayerId();
    const room: Room = {
      code,
      players: [{ playerId, socketId, name: this.cleanName(rawName), connected: true }],
      game: null,
      seed: seed ?? undefined,
    };
    this.rooms.set(code, room);
    this.socketToRoom.set(socketId, code);
    return { room, playerId, token: this.issueSessionToken(code, playerId) };
  }

  joinRoom(socketId: string, rawCode: string, rawName: string, seed?: number): { room: Room; playerId: string; token: string } {
    this.leaveBySocket(socketId);
    const code = rawCode.trim().toUpperCase();
    const room = this.rooms.get(code);
    if (!room) throw new GameRuleError('ROOM_NOT_FOUND', 'Room not found.');
    if (room.players.length >= 2) throw new GameRuleError('ROOM_FULL', 'Room is full.');
    if (room.game) throw new GameRuleError('GAME_ALREADY_STARTED', 'Game already started.');

    const playerId = this.generatePlayerId();
    room.seed = seed ?? room.seed;
    room.players.push({ playerId, socketId, name: this.cleanName(rawName), connected: true });
    this.socketToRoom.set(socketId, code);
    this.startIfReady(room);
    return { room, playerId, token: this.issueSessionToken(code, playerId) };
  }

  roomForSocket(socketId: string): Room | null {
    const code = this.socketToRoom.get(socketId);
    return code ? this.rooms.get(code) ?? null : null;
  }

  playerForSocket(socketId: string): RoomPlayer | null {
    const room = this.roomForSocket(socketId);
    return room?.players.find((player) => player.socketId === socketId) ?? null;
  }

  applySocketAction(socketId: string, action: ClientAction): Room {
    const room = this.requireRoom(socketId);
    const player = this.requirePlayer(room, socketId);
    if (!room.game) throw new GameRuleError('GAME_NOT_STARTED', 'Waiting for opponent.');
    const serverAction = { ...action, playerId: player.playerId } as GameAction;
    room.game = applyAction(room.game, serverAction);
    return room;
  }

  /**
   * Explicit leave ("Return to lobby"): the seat is dropped immediately
   * pre-game, any pending rejoin session is cancelled, and — in-game with a
   * still-playing match — the match forfeits immediately to the remaining
   * connected player (same path as grace expiry), so a deliberate leave can
   * never strand the opponent in an un-rejoinable `playing` match.
   */
  leaveBySocket(socketId: string): Room | null {
    const room = this.roomForSocket(socketId);
    if (!room) return null;
    const player = room.players.find((entry) => entry.socketId === socketId);
    this.socketToRoom.delete(socketId);
    if (!player) return room;

    this.markPlayerDisconnected(room, player);
    this.cancelSession(room.code, player.playerId);

    if (room.game && room.game.status === 'playing') {
      const remaining = room.players.find((seat) => seat.playerId !== player.playerId && seat.connected);
      if (remaining) {
        const winner = room.game.players[remaining.playerId];
        room.game = forfeitGame(
          room.game,
          remaining.playerId,
          `${player.name} left the match. ${winner.name} wins.`,
        );
        for (const listener of this.roomChangedListeners) listener(room);
      } else {
        // Nobody connected is left: cancel every seat's rejoin session (the
        // remaining seat's would otherwise keep a dangling grace timer/entry)
        // and drop the room.
        this.deleteRoomAndClearSessions(room);
      }
      return room;
    }

    if (!room.game) {
      room.players = room.players.filter((entry) => entry.socketId !== socketId);
    }
    // Pre-game leave removes the seat; a finished-match leave keeps it (rematch
    // guard). In either case a room with no connected players is cleaned up —
    // including the OTHER seat's retained session/token records and any
    // pending grace timer (helper is idempotent; explicit-leave seats have
    // already cancelled their own sessions).
    if (!room.players.some((seat) => seat.connected)) this.deleteRoomAndClearSessions(room);
    return room;
  }

  /**
   * Socket disconnect (crash, tab close, network drop): the seat is preserved
   * — pre-game OR in-game — and a rejoin grace window is armed for the player.
   * When the window elapses, the sweeper removes pre-game seats or
   * auto-forfeits an in-progress match to the remaining connected player.
   */
  disconnectBySocket(socketId: string): Room | null {
    const room = this.roomForSocket(socketId);
    if (!room) return null;
    const player = room.players.find((entry) => entry.socketId === socketId);
    this.socketToRoom.delete(socketId);
    if (!player) return room;

    this.markPlayerDisconnected(room, player);
    this.armSessionGrace(room.code, player.playerId);
    return room;
  }

  /**
   * Rejoin with a previously issued session token. Reattaches the seat to the
   * new socket, restores `connected`, and returns a fresh single-use token.
   * Throws GameRuleError REJOIN_INVALID / REJOIN_EXPIRED / ROOM_NOT_FOUND.
   *
   * Stale-token fallback: a client can transiently hold a superseded token
   * (a page reload that raced a faster rejoin from the same seat rotates the
   * token before the slow client's `room:rejoin` arrives). Instead of
   * stranding the seat, the server reissues the token for the seat the client
   * names (`playerId`) — but only while that seat is still disconnected, so a
   * stale client can never hijack a live seat, and a seat whose grace window
   * has lapsed (or was cancelled by an explicit leave) is no longer claimable
   * either — even though room code + playerId are visible to room members.
   */
  rejoin(
    socketId: string,
    rawCode: string,
    rawToken: string,
    rawPlayerId?: string,
  ): { room: Room; player: RoomPlayer; token: string } {
    const code = String(rawCode ?? '').trim().toUpperCase();
    const token = String(rawToken ?? '');
    const seatKey = this.tokenIndex.get(token);
    const entry = seatKey ? this.sessions.get(seatKey) : undefined;
    const playerId = entry ? entry.playerId : String(rawPlayerId ?? '');

    if (entry) {
      // An un-armed token (player has not disconnected yet — e.g. a page
      // reload that races the old socket's disconnect) is still valid:
      // reattaching the seat to the new socket is safe and resolves the race.
      if (entry.expiresAt !== null && this.now() > entry.expiresAt) {
        this.cancelSession(entry.code, entry.playerId);
        throw new GameRuleError('REJOIN_EXPIRED', 'The rejoin window has expired.');
      }
      if (entry.code !== code) {
        this.cancelSession(entry.code, entry.playerId);
        throw new GameRuleError('REJOIN_INVALID', 'Rejoin token does not match this room.');
      }
    } else {
      // Stale-token fallback: reclaim the named seat only while it is still
      // disconnected (inside its grace window).
      const fallbackRoom = this.rooms.get(code);
      // A legitimate rejoiner always arrives on a FRESH socket that holds no
      // seat; an in-room opponent's socket always holds its own seat. So any
      // socket that already occupies a seat in this room is never a
      // legitimate rejoiner and is rejected outright. (Do NOT gate on
      // "last holding socket" identity — legitimate rejoins use new sockets,
      // and that check would break the fallback.)
      if (fallbackRoom?.players.some((candidate) => candidate.socketId === socketId)) {
        throw new GameRuleError('REJOIN_INVALID', 'Invalid rejoin session.');
      }
      // Residual limitation (acceptable for MVP LAN): code + every seat's
      // playerId are visible to room members, so a FRESH-TAB socket holding
      // no seat can claim a live-grace seat directly via code + playerId —
      // no abandonment of its own seat is required — including a mid-match
      // takeover of a disconnected seat within the grace window (an in-room
      // opponent would need to first abandon their own seat to reach this
      // path, but a brand-new tab of theirs never holds a seat).
      const seat = fallbackRoom?.players.find((candidate) => candidate.playerId === playerId);
      if (!seat || seat.connected) {
        throw new GameRuleError('REJOIN_INVALID', 'Invalid rejoin session.');
      }
      // The seat must be inside a LIVE grace window. An in-game session entry
      // is deliberately retained past expiry so an original-token late rejoin
      // can report REJOIN_EXPIRED — that retained-but-expired (or cancelled/
      // un-armed) entry must never make the seat claimable via the public
      // code + playerId fallback.
      const grace = this.sessions.get(this.seatKey(code, playerId));
      if (!grace || grace.expiresAt === null || this.now() > grace.expiresAt) {
        throw new GameRuleError('REJOIN_INVALID', 'Invalid rejoin session.');
      }
    }

    const room = this.rooms.get(code);
    const player = room?.players.find((seat) => seat.playerId === playerId);
    if (!room || !player) {
      if (entry) this.cancelSession(code, entry.playerId);
      throw new GameRuleError('ROOM_NOT_FOUND', 'Room no longer exists.');
    }

    // Consume the token (single-use), then reattach the seat to the new socket.
    this.cancelSession(code, player.playerId);
    player.socketId = socketId;
    player.connected = true;
    this.socketToRoom.set(socketId, code);
    if (room.game) room.game = setPlayerConnected(room.game, player.playerId, true);

    // If a forfeit was deferred while this seat was absent (no connected seat
    // remained when the other seat's grace timer fired), the rejoiner is now
    // the only connected player and no timer is left to resolve the match:
    // forfeit it here instead of leaving the game stuck in 'playing'.
    if (room.game && room.game.status === 'playing') {
      for (const seat of room.players) {
        if (seat.playerId === player.playerId || seat.connected) continue;
        const other = this.sessions.get(this.seatKey(code, seat.playerId));
        const liveGrace =
          other !== undefined && other.expiresAt !== null && this.now() <= other.expiresAt;
        if (!liveGrace) {
          const winner = room.game.players[player.playerId];
          room.game = forfeitGame(
            room.game,
            player.playerId,
            `${seat.name} did not return in time. ${winner.name} wins.`,
          );
          for (const listener of this.roomChangedListeners) listener(room);
          break;
        }
      }
    }
    return { room, player, token: this.issueSessionToken(code, player.playerId) };
  }

  private markPlayerDisconnected(room: Room, player: RoomPlayer): void {
    player.connected = false;
    if (room.game) room.game = setPlayerConnected(room.game, player.playerId, false);
    // Drop any pending rematch handshake so a lone requester can't leave a
    // dangling entry that would later wedge the room.
    this.rematchRequests.delete(room.code);
  }

  private seatKey(code: string, playerId: string): string {
    return `${code}:${playerId}`;
  }

  /** True when any seat in the room has an armed, not-yet-expired rejoin grace. */
  private hasLiveGrace(room: Room): boolean {
    return room.players.some((seat) => {
      const entry = this.sessions.get(this.seatKey(room.code, seat.playerId));
      return entry !== undefined && entry.expiresAt !== null && this.now() < entry.expiresAt;
    });
  }

  /** Cancel every seat's rejoin session and delete the room (cleanup path). */
  private deleteRoomAndClearSessions(room: Room): void {
    for (const seat of room.players) this.cancelSession(room.code, seat.playerId);
    this.rooms.delete(room.code);
  }

  /** Issue a fresh single-use token for a seat, replacing any previous one. */
  private issueSessionToken(code: string, playerId: string): string {
    const key = this.seatKey(code, playerId);
    const existing = this.sessions.get(key);
    if (existing) this.cancelSession(code, playerId);
    const entry: SessionToken = { token: crypto.randomUUID(), code, playerId, expiresAt: null, timer: null };
    this.sessions.set(key, entry);
    this.tokenIndex.set(entry.token, key);
    return entry.token;
  }

  /** Arm (or re-arm) the grace window for a seat: expiry timestamp + cleanup timer. */
  private armSessionGrace(code: string, playerId: string): void {
    const key = this.seatKey(code, playerId);
    if (!this.sessions.has(key)) this.issueSessionToken(code, playerId);
    const entry = this.sessions.get(key);
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    entry.expiresAt = this.now() + this.rejoinGraceMs;
    entry.timer = setTimeout(() => this.onSessionExpired(key), this.rejoinGraceMs);
    if (typeof entry.timer.unref === 'function') entry.timer.unref();
  }

  private cancelSession(code: string, playerId: string): void {
    const entry = this.sessions.get(this.seatKey(code, playerId));
    if (!entry) return;
    this.sessions.delete(this.seatKey(code, playerId));
    this.tokenIndex.delete(entry.token);
    if (entry.timer) clearTimeout(entry.timer);
  }

  /** Grace sweeper: pre-game → drop seat; in-game → forfeit to the remaining player. */
  private onSessionExpired(key: string): void {
    const entry = this.sessions.get(key);
    if (!entry) return;
    // The entry is kept past its expiry timestamp ONLY in the in-game branch,
    // where the room and seat survive, so a late rejoin attempt can report
    // REJOIN_EXPIRED instead of a generic invalid token. The pre-game branch
    // removes the seat entirely and clears the session (same as an explicit
    // leave), so late attempts there report REJOIN_INVALID.
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = null;
    const room = this.rooms.get(entry.code);
    if (!room) return;
    const player = room.players.find((seat) => seat.playerId === entry.playerId);
    if (!player) return;

    if (room.game) {
      if (room.game.status !== 'playing') {
        // Finished match: nothing to forfeit. If nobody is connected and no
        // seat is inside a live rejoin grace, the room is dead weight — delete
        // it and clear both seats' sessions instead of leaking forever.
        if (!room.players.some((seat) => seat.connected) && !this.hasLiveGrace(room)) {
          this.deleteRoomAndClearSessions(room);
        }
        return;
      }
      const remaining = room.players.find((seat) => seat.playerId !== entry.playerId && seat.connected);
      if (!remaining) {
        // Both seats disconnected: keep the room only while the OTHER seat is
        // still inside its live grace window; otherwise clean up entirely.
        if (!this.hasLiveGrace(room)) {
          this.deleteRoomAndClearSessions(room);
        }
        return;
      }
      const winner = room.game.players[remaining.playerId];
      room.game = forfeitGame(room.game, remaining.playerId, `${player.name} forfeited (opponent did not rejoin). ${winner.name} wins.`);
    } else {
      room.players = room.players.filter((seat) => seat.playerId !== entry.playerId);
      // The seat is gone for good: clear the session records too, otherwise
      // stale sessions/tokenIndex entries leak for every expired seat.
      this.cancelSession(entry.code, entry.playerId);
      if (room.players.length === 0) {
        this.rooms.delete(room.code);
        return;
      }
    }
    for (const listener of this.roomChangedListeners) listener(room);
  }

  roomView(room: Room): RoomView {
    return {
      code: room.code,
      players: room.players.map((player) => ({
        id: player.playerId,
        name: player.name,
        connected: player.connected,
      })),
      started: Boolean(room.game),
    };
  }

  gameView(room: Room, playerId: string): ClientGameView | null {
    return room.game ? toClientView(room.game, playerId) : null;
  }

  /**
   * Rematch handshake: each player calls once. The first player to request waits for
   * the second; once both have confirmed, a fresh deterministic game starts with the
   * same two players and the same seed.
   */
  rematch(socketId: string): Room {
    const room = this.requireRoom(socketId);
    const player = this.requirePlayer(room, socketId);
    if (!room.game || room.game.status !== 'finished') {
      throw new GameRuleError('INVALID_STATE', 'There is no finished match to rematch.');
    }

    // Never strand the requester in a game with no connected opponent. If a
    // player left ("Return to lobby") their socket is gone and `connected` is
    // false; a rematch would otherwise create a game only one player sees.
    if (!room.players.every((p) => p.connected)) {
      throw new GameRuleError('NOT_CONNECTED', 'Your opponent is not connected. Rematch not available.');
    }

    const requests = this.rematchRequests.get(room.code) ?? new Set<string>();
    requests.add(player.playerId);
    this.rematchRequests.set(room.code, requests);

    if (requests.size < 2) return room;

    const [a, b] = room.players;
    if (!a || !b) throw new GameRuleError('INVALID_STATE', 'Rematch requires two active players.');
    room.game = createGame({
      roomCode: room.code,
      players: [
        { id: a.playerId, name: a.name },
        { id: b.playerId, name: b.name },
      ],
      seed: room.seed,
    });
    this.rematchRequests.delete(room.code);
    return room;
  }

  private startIfReady(room: Room): void {
    if (room.players.length !== 2 || room.game) return;
    room.game = createGame({
      roomCode: room.code,
      players: [
        { id: room.players[0].playerId, name: room.players[0].name },
        { id: room.players[1].playerId, name: room.players[1].name },
      ],
      seed: room.seed,
    });
  }

  private requireRoom(socketId: string): Room {
    const room = this.roomForSocket(socketId);
    if (!room) throw new GameRuleError('NOT_IN_ROOM', 'You are not in a room.');
    return room;
  }

  private requirePlayer(room: Room, socketId: string): RoomPlayer {
    const player = room.players.find((entry) => entry.socketId === socketId);
    if (!player) throw new GameRuleError('NOT_A_PLAYER', 'You are not a player in this room.');
    return player;
  }

  private generateRoomCode(): string {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    for (let attempt = 0; attempt < 100; attempt += 1) {
      let code = '';
      for (let i = 0; i < 6; i += 1) code += alphabet[Math.floor(Math.random() * alphabet.length)];
      if (!this.rooms.has(code)) return code;
    }
    throw new Error('Could not allocate room code.');
  }

  private generatePlayerId(): string {
    return `p_${crypto.randomUUID().slice(0, 8)}`;
  }

  private cleanName(value: string): string {
    const name = String(value ?? '').trim().slice(0, 24);
    return name || 'Player';
  }
}
