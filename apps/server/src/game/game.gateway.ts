import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { ClientAction, GameRuleError } from '@qcw/game-core';
import { Server, Socket } from 'socket.io';
import { GameService, Room } from './game.service';

interface RoomCreatePayload {
  name: string;
  seed?: number;
}

interface RoomJoinPayload {
  code: string;
  name: string;
  seed?: number;
}

type ClientGameAction = ClientAction;

@WebSocketGateway({ cors: { origin: true, credentials: true } })
export class GameGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  constructor(private readonly games: GameService) {}

  handleConnection(client: Socket) {
    client.emit('connection:ready', { socketId: client.id });
  }

  handleDisconnect(client: Socket) {
    const room = this.games.leaveBySocket(client.id);
    if (room) this.broadcastRoom(room);
  }

  @SubscribeMessage('room:create')
  createRoom(@ConnectedSocket() client: Socket, @MessageBody() payload: RoomCreatePayload) {
    return this.guard(client, () => {
      const { room, playerId } = this.games.createRoom(client.id, payload?.name, payload?.seed);
      client.join(room.code);
      client.emit('session:identity', { playerId, roomCode: room.code });
      this.broadcastRoom(room);
      return { ok: true, code: room.code };
    });
  }

  @SubscribeMessage('room:join')
  joinRoom(@ConnectedSocket() client: Socket, @MessageBody() payload: RoomJoinPayload) {
    return this.guard(client, () => {
      const { room, playerId } = this.games.joinRoom(client.id, payload?.code, payload?.name, payload?.seed);
      client.join(room.code);
      client.emit('session:identity', { playerId, roomCode: room.code });
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
