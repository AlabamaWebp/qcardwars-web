import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as ioClient, Socket } from 'socket.io-client';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { IoAdapter } from '@nestjs/platform-socket.io';
import type { AddressInfo } from 'net';
import { AppModule } from '../src/app.module';
import { getCard, ClientGameView } from '@qcw/game-core';

let app: NestExpressApplication;
let port: number;

interface Client {
  socket: Socket;
  view: ClientGameView | null;
  identity: { playerId: string; roomCode: string } | null;
  errors: Array<{ code: string; message: string }>;
}

const clients: Client[] = [];

function connect(url: string): Promise<Client> {
  return new Promise((resolve, reject) => {
    // forceNew: each client gets its own Manager/transport (like separate
    // browser tabs) — reusing the first Manager corrupts the shared WS
    // transport for later sockets.
    const socket = ioClient(url, {
      transports: ['websocket', 'polling'],
      reconnection: false,
      forceNew: true,
    });
    const client: Client = { socket, view: null, identity: null, errors: [] };
    clients.push(client);
    socket.on('game:state', (v: ClientGameView) => {
      client.view = v;
    });
    socket.on('room:state', () => { /* room roster change */ });
    socket.on('session:identity', (v) => { client.identity = v; });
    socket.on('server:error', (e) => { client.errors.push(e); });
    socket.once('connect', () => resolve(client));
    socket.once('connect_error', reject);
    setTimeout(() => {
      if (!clients.includes(client)) reject(new Error(`connect timeout for ${url}`));
    }, 6000);
  });
}

/** Resolve when two clients have equal revisions and `match` is satisfied. */
function waitForViews(
  a: Client,
  b: Client,
  match: (a: ClientGameView, b: ClientGameView) => boolean,
  timeout = 8000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      const va = a.view;
      const vb = b.view;
      if (va && vb && va.revision === vb.revision && match(va, vb)) {
        clearInterval(timer);
        resolve();
      }
    }, 20);
    setTimeout(() => { clearInterval(timer); reject(new Error('waitForViews timeout')); }, timeout);
  });
}

/** Resolve when both clients have equal revisions and `match` is satisfied. */
function waitForBoth(match: (a: ClientGameView, b: ClientGameView) => boolean, timeout = 8000): Promise<void> {
  return waitForViews(clients[0], clients[1], match, timeout);
}

function laneFor(def: ReturnType<typeof getCard>, self: string, view: ClientGameView): number | null {
  if (def.faction === 'universal') {
    const free = view.lanes.find((l) => !view.lanes[l.index].sides[self].unit);
    return free ? free.index : null;
  }
  const idx = view.lanes.find((l) => l.sideTypes[self] === def.faction && !view.lanes[l.index].sides[self].unit);
  return idx ? idx.index : null;
}

/**
 * Find one of the player's ready unit specials (survived a turn, uses left,
 * mana available) whose target can be resolved from the current view. Returns
 * null when no special can be activated right now.
 */
function findReadySpecial(view: ClientGameView): { laneIndex: number; targetLaneIndex?: number } | null {
  const me = view.selfPlayerId;
  const opp = view.playerOrder.find((id) => id !== me)!;
  const mana = view.players[me].mana;
  for (const lane of view.lanes) {
    const unit = lane.sides[me].unit;
    if (!unit || unit.turnsSurvived < 1 || unit.specialUsesRemaining <= 0) continue;
    const def = getCard(unit.cardId);
    if (def.kind !== 'unit' || !def.special || def.special.cost > mana) continue;
    const target = def.special.target;
    if (target === 'none' || target === 'self' || target === 'enemy-hero') return { laneIndex: lane.index };
    if (target === 'enemy-unit') {
      const t = view.lanes.find((l) => l.sides[opp].unit);
      if (t) return { laneIndex: lane.index, targetLaneIndex: t.index };
    }
    if (target === 'friendly-unit') {
      const t = view.lanes.find((l) => l.sides[me].unit);
      if (t) return { laneIndex: lane.index, targetLaneIndex: t.index };
    }
  }
  return null;
}

/**
 * Compute + emit one legal action for the active player using that player's
 * OWN view. Returns which kind of action was taken.
 */
async function actForClient(actor: Client, other: Client): Promise<'unit' | 'special' | 'power' | 'end-turn'> {
  const view = actor.view!;
  const me = view.selfPlayerId;
  const opp = view.playerOrder.find((id) => id !== me)!;
  const hand = view.players[me].hand!;
  const mana = view.players[me].mana;
  // 1) cheapest affordable unit on a free, faction-allowed lane
  let unit = null;
  for (const h of hand) {
    const def = getCard(h.cardId);
    if (def.kind !== 'unit' || def.cost > mana) continue;
    const lane = laneFor(def, me, view);
    if (lane === null) continue;
    // onPlay 'enemy-unit' cards must be played into a lane already holding the
    // opponent's unit — mirrors the engine's atomic INVALID_TARGET check (see
    // playUnit). Emitting such a play without the occupant would be rejected
    // server-side, the revision would never advance, and lock-step would wedge.
    if (def.onPlay?.target === 'enemy-unit' && !view.lanes[lane].sides[opp].unit) continue;
    unit = { h, def, lane };
    break;
  }
  if (unit) {
    actor.socket.emit('game:action', {
      type: 'play-card', expectedRevision: view.revision, handCardUid: unit.h.uid, laneIndex: unit.lane,
    });
    await waitForViews(actor, other, (a) => a.revision === view.revision + 1);
    return 'unit';
  }
  // 2) ready unit special (the Phase D D-4 wire path)
  const special = findReadySpecial(view);
  if (special) {
    actor.socket.emit('game:action', {
      type: 'activate-special', expectedRevision: view.revision,
      laneIndex: special.laneIndex, targetLaneIndex: special.targetLaneIndex,
    });
    await waitForViews(actor, other, (a) => a.revision === view.revision + 1);
    return 'special';
  }
  // 3) affordable enemy-hero power (no target lane needed) — adds burst
  for (const h of hand) {
    const def = getCard(h.cardId);
    if (def.kind !== 'power' || def.cost > mana || def.target !== 'enemy-hero') continue;
    actor.socket.emit('game:action', {
      type: 'play-card', expectedRevision: view.revision, handCardUid: h.uid,
    });
    await waitForViews(actor, other, (a) => a.revision === view.revision + 1);
    return 'power';
  }
  // 4) else end turn
  actor.socket.emit('game:action', { type: 'end-turn', expectedRevision: view.revision });
  await waitForViews(actor, other, (a) => a.revision === view.revision + 1);
  return 'end-turn';
}

/** Compute + emit one legal action for the active player using that player's OWN view. */
async function actForActive(activeClient: Client): Promise<void> {
  const other = clients.find((c) => c !== activeClient && c.view !== null);
  if (!other) return;
  await actForClient(activeClient, other);
}

// File-level app lifecycle: both describes below drive matches against the
// SAME server instance. (Per-describe beforeAll/afterAll would close the app
// after the first describe, so the second describe's sockets hit a dead port.)
beforeAll(async () => {
  app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: false });
  // NestJS defaults to the raw `ws` adapter; the web client speaks the Socket.IO
  // protocol, so attach the Socket.IO adapter for a real end-to-end match.
  app.useWebSocketAdapter(new IoAdapter(app));
  // This Nest build exposes getHttpServer() rather than useHttpServer(); listening
  // on an ephemeral port lets Nest create and bind its own server.
  await app.listen(0);
  const srv = app.getHttpServer();
  port = (srv.address() as AddressInfo).port;
}, 30000);

afterAll(async () => {
  await app.close();
  for (const c of clients) c.socket.disconnect();
});

describe('two-client socket smoke (P1-07)', () => {
  const SEED = 20240517;

  it('two clients create/join, stay in lock-step, and reach a shared victory', async () => {
    const url = `http://localhost:${port}`;
    const sockA = await connect(url);
    const sockB = await connect(url);

    sockA.socket.emit('room:create', { name: 'Alice', seed: SEED });
    const idA = await new Promise<{ playerId: string; roomCode: string }>((resolve, reject) => {
      sockA.socket.once('session:identity', (v) => resolve(v));
      setTimeout(() => reject(new Error('no identity A')), 6000);
    });
    sockB.socket.emit('room:join', { code: idA.roomCode, name: 'Bob', seed: SEED });
    const idB = await new Promise<{ playerId: string; roomCode: string }>((resolve, reject) => {
      sockB.socket.once('session:identity', (v) => resolve(v));
      setTimeout(() => reject(new Error('no identity B')), 6000);
    });

    expect(idA.roomCode).toBe(idB.roomCode);
    expect(sockA.identity!.playerId).not.toBe(sockB.identity!.playerId);

    // both have a playing game, same revision
    await waitForBoth((a, b) => a.status === 'playing' && b.status === 'playing', 8000);
    expect(sockA.view!.revision).toBe(sockB.view!.revision);
    expect(sockA.view!.status).toBe('playing');

    // both clients agree on the opponent's hand being hidden
    const selfA = sockA.view!.selfPlayerId;
    const oppA = sockA.view!.playerOrder.find((id) => id !== selfA)!;
    expect(sockA.view!.players[oppA].hand).toBeNull();

    // drive the match until someone wins, asserting lock-step every action
    let guard = 0;
    while (true) {
      guard += 1;
      if (guard > 200) throw new Error('victory not reached within turn budget');
      await waitForBoth((a, b) => a.revision === b.revision, 8000);
      const view = sockA.view!;
      if (view.status === 'finished') break;

      const active = view.activePlayerId;
      const activeClient = active === sockA.identity!.playerId ? sockA : sockB;
      if (activeClient.errors.length) throw new Error(`active client error: ${JSON.stringify(activeClient.errors)}`);
      await actForActive(activeClient);
    }

    // final: both clients observe the same finished state + winner
    expect(sockA.view!.status).toBe('finished');
    expect(sockB.view!.status).toBe('finished');
    expect(sockA.view!.revision).toBe(sockB.view!.revision);
    expect(sockA.view!.winnerId).toBe(sockB.view!.winnerId);
    expect(sockA.view!.winnerId).not.toBeNull();
    const loserId = sockA.view!.winnerId === sockA.view!.selfPlayerId
      ? sockA.view!.playerOrder.find((id) => id !== sockA.view!.selfPlayerId)!
      : sockA.view!.selfPlayerId;
    expect(sockA.view!.players[loserId].hp).toBe(0);
  }, 60000);
});

describe('activate-special socket exchange (Phase D D-4)', () => {
  const SEED = 20240517;

  it('special activations are accepted and stay in lock-step on both clients', async () => {
    const url = `http://localhost:${port}`;
    const sockA = await connect(url);
    const sockB = await connect(url);

    sockA.socket.emit('room:create', { name: 'Alice', seed: SEED });
    const idA = await new Promise<{ playerId: string; roomCode: string }>((resolve, reject) => {
      sockA.socket.once('session:identity', (v) => resolve(v));
      setTimeout(() => reject(new Error('no identity A')), 6000);
    });
    sockB.socket.emit('room:join', { code: idA.roomCode, name: 'Bob', seed: SEED });
    await new Promise<void>((resolve, reject) => {
      sockB.socket.once('session:identity', () => resolve());
      setTimeout(() => reject(new Error('no identity B')), 6000);
    });

    await waitForViews(sockA, sockB, (a, b) => a.status === 'playing' && b.status === 'playing', 8000);

    let specialActivations = 0;
    let guard = 0;
    while (true) {
      guard += 1;
      if (guard > 200) throw new Error('victory not reached within turn budget');
      await waitForViews(sockA, sockB, (a, b) => a.revision === b.revision, 8000);
      const view = sockA.view!;
      if (view.status === 'finished') break;

      const active = view.activePlayerId;
      const activeClient = active === sockA.identity!.playerId ? sockA : sockB;
      const passiveClient = activeClient === sockA ? sockB : sockA;
      if (activeClient.errors.length) throw new Error(`active client error: ${JSON.stringify(activeClient.errors)}`);
      const action = await actForClient(activeClient, passiveClient);
      if (action === 'special') specialActivations += 1;
    }

    // The deck is fixed and seeded: 20 of 32 units carry specials, so a full
    // match is guaranteed to exercise the activate-special wire path at least
    // once — and every activation stayed in lock-step (asserted per action).
    expect(specialActivations).toBeGreaterThanOrEqual(1);
    expect(sockA.view!.status).toBe('finished');
    expect(sockB.view!.status).toBe('finished');
    expect(sockA.view!.revision).toBe(sockB.view!.revision);
    expect(sockA.view!.winnerId).toBe(sockB.view!.winnerId);
    expect(sockA.view!.winnerId).not.toBeNull();
  }, 60000);
});
