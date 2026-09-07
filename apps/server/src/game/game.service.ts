import { Injectable } from '@nestjs/common';
import {
  applyAction,
  ClientGameView,
  createGame,
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
}

export interface RoomView {
  code: string;
  players: Array<{ id: string; name: string; connected: boolean }>;
  started: boolean;
}

@Injectable()
export class GameService {
  private readonly rooms = new Map<string, Room>();
  private readonly socketToRoom = new Map<string, string>();

  createRoom(socketId: string, rawName: string): { room: Room; playerId: string } {
    this.leaveBySocket(socketId);
    const code = this.generateRoomCode();
    const playerId = this.generatePlayerId();
    const room: Room = {
      code,
      players: [{ playerId, socketId, name: this.cleanName(rawName), connected: true }],
      game: null,
    };
    this.rooms.set(code, room);
    this.socketToRoom.set(socketId, code);
    return { room, playerId };
  }

  joinRoom(socketId: string, rawCode: string, rawName: string): { room: Room; playerId: string } {
    this.leaveBySocket(socketId);
    const code = rawCode.trim().toUpperCase();
    const room = this.rooms.get(code);
    if (!room) throw new GameRuleError('ROOM_NOT_FOUND', 'Room not found.');
    if (room.players.length >= 2) throw new GameRuleError('ROOM_FULL', 'Room is full.');
    if (room.game) throw new GameRuleError('GAME_ALREADY_STARTED', 'Game already started.');

    const playerId = this.generatePlayerId();
    room.players.push({ playerId, socketId, name: this.cleanName(rawName), connected: true });
    this.socketToRoom.set(socketId, code);
    this.startIfReady(room);
    return { room, playerId };
  }

  roomForSocket(socketId: string): Room | null {
    const code = this.socketToRoom.get(socketId);
    return code ? this.rooms.get(code) ?? null : null;
  }

  playerForSocket(socketId: string): RoomPlayer | null {
    const room = this.roomForSocket(socketId);
    return room?.players.find((player) => player.socketId === socketId) ?? null;
  }

  applySocketAction(socketId: string, action: Omit<GameAction, 'playerId'>): Room {
    const room = this.requireRoom(socketId);
    const player = this.requirePlayer(room, socketId);
    if (!room.game) throw new GameRuleError('GAME_NOT_STARTED', 'Waiting for opponent.');
    const serverAction = { ...action, playerId: player.playerId } as GameAction;
    room.game = applyAction(room.game, serverAction);
    return room;
  }

  leaveBySocket(socketId: string): Room | null {
    const room = this.roomForSocket(socketId);
    if (!room) return null;
    const player = room.players.find((entry) => entry.socketId === socketId);
    this.socketToRoom.delete(socketId);
    if (!player) return room;

    player.connected = false;
    if (room.game) room.game = setPlayerConnected(room.game, player.playerId, false);

    // Scaffold behavior: before a game starts, remove the player immediately.
    // P1 task: preserve/rejoin active rooms with a grace token and cleanup timeout.
    if (!room.game) {
      room.players = room.players.filter((entry) => entry.socketId !== socketId);
      if (room.players.length === 0) this.rooms.delete(room.code);
    }
    return room;
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

  private startIfReady(room: Room): void {
    if (room.players.length !== 2 || room.game) return;
    room.game = createGame({
      roomCode: room.code,
      players: [
        { id: room.players[0].playerId, name: room.players[0].name },
        { id: room.players[1].playerId, name: room.players[1].name },
      ],
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
