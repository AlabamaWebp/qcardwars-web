import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { ClientAction, GameRuleError, LaneType } from '@qcw/game-core';
import { Server, Socket } from 'socket.io';
import { GameService, Room } from './game.service';

interface RoomCreatePayload {
  name: string;
  seed?: number;
  /** Solo match: the second seat is filled by the server-side AI. */
  solo?: boolean;
  /** END-1 — the creator's 4-of-6 lane selection (validated server-side). */
  laneTypes?: LaneType[];
}

interface RoomJoinPayload {
  code: string;
  name: string;
  seed?: number;
}

interface RoomRejoinPayload {
  code: string;
  token: string;
  /** Seat id from the stored session; lets the server recover superseded tokens. */
  playerId?: string;
}

interface SessionIdentity {
  playerId: string;
  roomCode: string;
  token: string;
}

type ClientGameAction = ClientAction;

@WebSocketGateway({ cors: { origin: true, credentials: true } })
export class GameGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  constructor(private readonly games: GameService) {
    // Grace-window expiry (seat removal / auto-forfeit) happens on a timer
    // inside the service; re-broadcast so remaining clients see the outcome.
    this.games.onRoomChanged((room) => this.broadcastRoom(room));
  }

  handleConnection(client: Socket) {
    client.emit('connection:ready', { socketId: client.id });
  }

  handleDisconnect(client: Socket) {
    const room = this.games.disconnectBySocket(client.id);
    if (room) this.broadcastRoom(room);
  }

  @SubscribeMessage('room:create')
  createRoom(@ConnectedSocket() client: Socket, @MessageBody() payload: RoomCreatePayload) {
    return this.guard(client, () => {
      const { room, playerId, token } = this.games.createRoom(
        client.id,
        payload?.name,
        payload?.seed,
        payload?.solo,
        payload?.laneTypes,
      );
      client.join(room.code);
      client.emit('session:identity', { playerId, roomCode: room.code, token });
      this.broadcastRoom(room);
      return { ok: true, code: room.code };
    });
  }

  @SubscribeMessage('room:join')
  joinRoom(@ConnectedSocket() client: Socket, @MessageBody() payload: RoomJoinPayload) {
    return this.guard(client, () => {
      const { room, playerId, token } = this.games.joinRoom(client.id, payload?.code, payload?.name, payload?.seed);
      client.join(room.code);
      client.emit('session:identity', { playerId, roomCode: room.code, token });
      this.broadcastRoom(room);
      return { ok: true, code: room.code };
    });
  }

  @SubscribeMessage('room:rejoin')
  rejoin(@ConnectedSocket() client: Socket, @MessageBody() payload: RoomRejoinPayload) {
    return this.guard(client, () => {
      const { room, player, token } = this.games.rejoin(
        client.id,
        payload?.code ?? '',
        payload?.token ?? '',
        payload?.playerId,
      );
      client.join(room.code);
      client.emit('session:identity', { playerId: player.playerId, roomCode: room.code, token });
      client.emit('room:state', this.games.roomView(room));
      const gameView = this.games.gameView(room, player.playerId);
      if (gameView) client.emit('game:state', gameView);
      // Let the remaining players see the opponent back online.
      this.broadcastRoom(room);
      return { ok: true, code: room.code };
    });
  }

  @SubscribeMessage('game:action')
  gameAction(@ConnectedSocket() client: Socket, @MessageBody() action: ClientGameAction) {
    return this.guard(client, () => {
      if (!action || !['play-card', 'activate-special', 'end-turn'].includes(action.type)) {
        throw new GameRuleError('INVALID_ACTION', 'Unknown game action.');
      }
      const room = this.games.applySocketAction(client.id, action);
      this.broadcastRoom(room);
      return { ok: true };
    });
  }

  @SubscribeMessage('room:leave')
  leaveRoom(@ConnectedSocket() client: Socket) {
    return this.guard(client, () => {
      const room = this.games.leaveBySocket(client.id);
      if (room) {
        client.leave(room.code);
        this.broadcastRoom(room);
      }
      client.emit('session:cleared');
      return { ok: true };
    });
  }

  @SubscribeMessage('room:rematch')
  rematch(@ConnectedSocket() client: Socket) {
    return this.guard(client, () => {
      const room = this.games.rematch(client.id);
      this.broadcastRoom(room);
      return { ok: true };
    });
  }

  private broadcastRoom(room: Room): void {
    for (const player of room.players) {
      if (!player.connected) continue;
      const socket = this.server.sockets.sockets.get(player.socketId);
      if (!socket) continue;
      socket.emit('room:state', this.games.roomView(room));
      const gameView = this.games.gameView(room, player.playerId);
      if (gameView) socket.emit('game:state', gameView);
    }
  }

  private guard<T>(client: Socket, operation: () => T): T | { ok: false; error: unknown } {
    try {
      return operation();
    } catch (error) {
      const payload = this.errorPayload(error);
      client.emit('server:error', payload);
      const room = this.games.roomForSocket(client.id);
      const player = this.games.playerForSocket(client.id);
      if (room && player) {
        const gameView = this.games.gameView(room, player.playerId);
        if (gameView) client.emit('game:state', gameView);
      }
      return { ok: false, error: payload };
    }
  }

  private errorPayload(error: unknown) {
    if (error instanceof GameRuleError) return { code: error.code, message: error.message };
    console.error(error);
    return { code: 'SERVER_ERROR', message: 'Unexpected server error.' };
  }
}
