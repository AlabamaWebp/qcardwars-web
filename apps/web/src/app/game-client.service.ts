import { Injectable, computed, signal } from '@angular/core';
import { ClientAction, ClientGameView } from '@qcw/game-core';
import { io, Socket } from 'socket.io-client';

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

  readonly connected = signal(false);
  readonly room = signal<RoomView | null>(null);
  readonly game = signal<ClientGameView | null>(null);
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
      this.game.set(value);
      this.error.set(null);
    });
    this.socket.on('server:error', (value: ServerErrorView) => {
      this.error.set(value);
      if (value && SESSION_GONE_CODES.has(value.code)) {
        // A failed rejoin means the stored session is gone: back to the lobby.
        this.pendingRejoin = false;
        this.storeSession(null);
        this.resetLocalSession();
      }
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
