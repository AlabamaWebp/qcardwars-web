import { Injectable, computed, signal } from '@angular/core';
import { ClientAction, ClientGameView, PlayerId } from '@qcw/game-core';
import { io, Socket } from 'socket.io-client';

/**
 * Phase A.2 — presentational visual events, derived on the client by diffing
 * consecutive `game:state` broadcasts (the server sends the full view per
 * revision; there is no dedicated event stream, and none is added).
 */
export type VisualEventType =
  | 'unit-placed'
  | 'building-placed'
  | 'unit-damaged'
  | 'unit-destroyed'
  | 'building-destroyed'
  | 'hero-damaged'
  | 'turn-changed'
  | 'match-finished';

export interface VisualEvent {
  /** Monotonic per-client id so consumers can process each event exactly once. */
  id: number;
  type: VisualEventType;
  laneIndex?: number;
  playerId?: PlayerId;
  uid?: string;
  amount?: number;
  winnerId?: PlayerId | null;
}

/**
 * Diff two full client views (O(lanes) + O(players)) into visual events.
 * Buildings have no health in the view (`BuildingInstance` is uid/cardId/
 * ownerId only), so only placement and destruction are derivable for them.
 * `match-finished` is derived from the status transition; victory/defeat
 * direction is up to the consumer (compare `winnerId` with `selfPlayerId`).
 */
export function diffClientViews(prev: ClientGameView, next: ClientGameView): VisualEvent[] {
  const events: VisualEvent[] = [];

  for (const id of next.playerOrder) {
    const oldHp = prev.players[id]?.hp;
    const newHp = next.players[id]?.hp;
    if (oldHp !== undefined && newHp !== undefined && newHp < oldHp) {
      events.push({ id: 0, type: 'hero-damaged', playerId: id, amount: oldHp - newHp });
    }
  }

  for (const lane of next.lanes) {
    const oldLane = prev.lanes[lane.index];
    if (!oldLane) continue;
    for (const playerId of next.playerOrder) {
      const oldSide = oldLane.sides[playerId];
      const side = lane.sides[playerId];
      const oldUnit = oldSide?.unit ?? null;
      const newUnit = side.unit;
      if (newUnit && (!oldUnit || oldUnit.uid !== newUnit.uid)) {
        events.push({ id: 0, type: 'unit-placed', laneIndex: lane.index, playerId, uid: newUnit.uid });
      } else if (newUnit && oldUnit && newUnit.health < oldUnit.health) {
        events.push({
          id: 0,
          type: 'unit-damaged',
          laneIndex: lane.index,
          playerId,
          uid: newUnit.uid,
          amount: oldUnit.health - newUnit.health,
        });
      } else if (!newUnit && oldUnit) {
        events.push({ id: 0, type: 'unit-destroyed', laneIndex: lane.index, playerId, uid: oldUnit.uid });
      }

      const oldBuilding = oldSide?.building ?? null;
      const newBuilding = side.building;
      if (newBuilding && (!oldBuilding || oldBuilding.uid !== newBuilding.uid)) {
        events.push({ id: 0, type: 'building-placed', laneIndex: lane.index, playerId, uid: newBuilding.uid });
      } else if (!newBuilding && oldBuilding) {
        events.push({ id: 0, type: 'building-destroyed', laneIndex: lane.index, playerId, uid: oldBuilding.uid });
      }
    }
  }

  if (next.activePlayerId !== prev.activePlayerId) {
    events.push({ id: 0, type: 'turn-changed', playerId: next.activePlayerId });
  }
  if (next.status === 'finished' && prev.status !== 'finished') {
    events.push({ id: 0, type: 'match-finished', winnerId: next.winnerId });
  }
  return events;
}

export interface RoomView {
  code: string;
  players: Array<{ id: string; name: string; connected: boolean }>;
  started: boolean;
}

export interface ServerErrorView {
  code: string;
  message: string;
}

interface SessionIdentity {
  playerId: string;
  roomCode: string;
  token: string;
}

interface StoredSession {
  code: string;
  playerId: string;
  token: string;
}

/** Server error codes that mean a stored session can no longer be restored. */
const SESSION_GONE_CODES = new Set(['REJOIN_INVALID', 'REJOIN_EXPIRED', 'ROOM_NOT_FOUND']);

@Injectable({ providedIn: 'root' })
export class GameClientService {
  private static readonly SESSION_KEY = 'qcw.session';
  private static readonly RECONNECT_NOTICE_MS = 3000;

  private readonly socket: Socket;
  private pendingRejoin = false;
  private reconnectNoticeTimer: ReturnType<typeof setTimeout> | null = null;
  /** Last full view received, used to derive visual events (Phase A.2). */
  private lastView: ClientGameView | null = null;
  private fxSeq = 0;

  readonly connected = signal(false);
  readonly room = signal<RoomView | null>(null);
  readonly game = signal<ClientGameView | null>(null);
  /**
   * Derived visual events (Phase A.2), newest last. Capped so the array
   * stays small; consumers track the highest `id` they have processed.
   */
  readonly visualEvents = signal<VisualEvent[]>([]);
  readonly playerId = signal<string | null>(null);
  readonly error = signal<ServerErrorView | null>(null);
  /** Brief "reconnected" notice after a successful socket reconnect + rejoin. */
  readonly reconnected = signal(false);
  readonly isMyTurn = computed(() => {
    const game = this.game();
    return Boolean(game && game.activePlayerId === game.selfPlayerId && game.status === 'playing');
  });

  constructor() {
    const devUrl = `${location.protocol}//${location.hostname}:3000`;
    const url = location.port === '4200' ? devUrl : undefined;
    this.socket = io(url, { autoConnect: true, transports: ['websocket', 'polling'] });

    this.socket.on('connect', () => {
      this.connected.set(true);
      // App boot or socket.io auto-reconnect (new socket id): if a session was
      // stored, try to reattach to the room with its grace token.
      const session = this.readStoredSession();
      if (session) {
        this.pendingRejoin = true;
        // The playerId lets the server recover a seat whose token was
        // superseded by a faster rejoin from the same seat (reload race).
        this.socket.emit('room:rejoin', { code: session.code, token: session.token, playerId: session.playerId });
      }
    });
    this.socket.on('disconnect', () => this.connected.set(false));
    this.socket.on('session:identity', (value: SessionIdentity) => {
      this.playerId.set(value.playerId);
      this.storeSession({ code: value.roomCode, playerId: value.playerId, token: value.token });
      if (this.pendingRejoin) {
        this.pendingRejoin = false;
        this.reconnected.set(true);
        if (this.reconnectNoticeTimer) clearTimeout(this.reconnectNoticeTimer);
        this.reconnectNoticeTimer = setTimeout(() => this.reconnected.set(false), GameClientService.RECONNECT_NOTICE_MS);
      }
    });
    this.socket.on('session:cleared', () => {
      this.pendingRejoin = false;
      this.storeSession(null);
      this.resetLocalSession();
    });
    this.socket.on('room:state', (value: RoomView) => this.room.set(value));
    this.socket.on('game:state', (value: ClientGameView) => {
      // NOTE: do NOT clear `error` here. The gateway re-broadcasts state right
      // after emitting server:error on a rejected action, which would wipe the
      // message before the user can read it. Errors are cleared by sendAction /
      // createRoom / joinRoom / rematch / clearError / resetLocalSession.
      const prev = this.lastView;
      this.lastView = value;
      this.game.set(value);
      // Derive visual events only for forward revisions of the same room
      // (a revision drop means a fresh match/room — anchor, don't diff).
      if (prev && prev.roomCode === value.roomCode && value.revision > prev.revision) {
        const events = diffClientViews(prev, value).map((event) => ({ ...event, id: ++this.fxSeq }));
        if (events.length) {
          this.visualEvents.update((list) => [...list, ...events].slice(-64));
        }
      }
    });
    this.socket.on('server:error', (value: ServerErrorView) => {
      if (value && SESSION_GONE_CODES.has(value.code)) {
        // A failed rejoin means the stored session is gone: back to the lobby.
        // Clear the session FIRST so resetLocalSession() doesn't wipe the
        // error we are about to surface (the lobby must show it).
        this.pendingRejoin = false;
        this.storeSession(null);
        this.resetLocalSession();
      }
      this.error.set(value);
    });
  }

  createRoom(name: string) {
    this.error.set(null);
    this.socket.emit('room:create', { name });
  }

  joinRoom(code: string, name: string) {
    this.error.set(null);
    this.socket.emit('room:join', { code, name });
  }

  sendAction(action: ClientAction) {
    this.error.set(null);
    this.socket.emit('game:action', action);
  }

  leaveRoom() {
    this.pendingRejoin = false;
    this.socket.emit('room:leave');
    this.storeSession(null);
    this.resetLocalSession();
  }

  rematch() {
    this.error.set(null);
    this.socket.emit('room:rematch');
  }

  clearError() {
    this.error.set(null);
  }

  private resetLocalSession() {
    this.room.set(null);
    this.game.set(null);
    this.playerId.set(null);
    this.error.set(null);
    // Drop the diff anchor and derived events: the next room starts clean.
    this.lastView = null;
    this.visualEvents.set([]);
  }

  private readStoredSession(): StoredSession | null {
    try {
      const raw = localStorage.getItem(GameClientService.SESSION_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<StoredSession> | null;
      if (
        parsed &&
        typeof parsed.code === 'string' &&
        parsed.code.length > 0 &&
        typeof parsed.playerId === 'string' &&
        typeof parsed.token === 'string' &&
        parsed.token.length > 0
      ) {
        return { code: parsed.code, playerId: parsed.playerId, token: parsed.token };
      }
    } catch {
      // Corrupt storage: treat as no session.
    }
    return null;
  }

  private storeSession(session: StoredSession | null) {
    try {
      if (session) localStorage.setItem(GameClientService.SESSION_KEY, JSON.stringify(session));
      else localStorage.removeItem(GameClientService.SESSION_KEY);
    } catch {
      // Storage unavailable (private mode etc.): rejoin just won't work.
    }
  }
}
