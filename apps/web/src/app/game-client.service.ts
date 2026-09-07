import { Injectable, computed, signal } from '@angular/core';
import { ClientGameView, GameAction } from '@qcw/game-core';
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

@Injectable({ providedIn: 'root' })
export class GameClientService {
  private readonly socket: Socket;

  readonly connected = signal(false);
  readonly room = signal<RoomView | null>(null);
  readonly game = signal<ClientGameView | null>(null);
  readonly playerId = signal<string | null>(null);
  readonly error = signal<ServerErrorView | null>(null);
  readonly isMyTurn = computed(() => {
    const game = this.game();
    return Boolean(game && game.activePlayerId === game.selfPlayerId && game.status === 'playing');
  });

  constructor() {
    const devUrl = `${location.protocol}//${location.hostname}:3000`;
    const url = location.port === '4200' ? devUrl : undefined;
    this.socket = io(url, { autoConnect: true, transports: ['websocket', 'polling'] });

    this.socket.on('connect', () => this.connected.set(true));
    this.socket.on('disconnect', () => this.connected.set(false));
    this.socket.on('session:identity', (value: { playerId: string }) => this.playerId.set(value.playerId));
    this.socket.on('session:cleared', () => this.resetLocalSession());
    this.socket.on('room:state', (value: RoomView) => this.room.set(value));
    this.socket.on('game:state', (value: ClientGameView) => {
      this.game.set(value);
      this.error.set(null);
    });
    this.socket.on('server:error', (value: ServerErrorView) => this.error.set(value));
  }

  createRoom(name: string) {
    this.error.set(null);
    this.socket.emit('room:create', { name });
  }

  joinRoom(code: string, name: string) {
    this.error.set(null);
    this.socket.emit('room:join', { code, name });
  }

  sendAction(action: Omit<GameAction, 'playerId'>) {
    this.error.set(null);
    this.socket.emit('game:action', action);
  }

  leaveRoom() {
    this.socket.emit('room:leave');
    this.resetLocalSession();
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
}
