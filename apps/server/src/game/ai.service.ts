import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { GameService } from './game.service';

/** Solo AI pace: one action every ~700 ms (readable, not instant). */
export const AI_TICK_MS = 700;

/**
 * Phase D D-1 — solo AI driver.
 *
 * Ticks every ~700 ms and advances the AI seat in every solo room by exactly
 * one action through `GameService.applyAiAction` (chooseAiAction + the
 * server-authoritative `applyAction` path, then a room re-broadcast). The AI
 * is therefore indistinguishable from a second player on the wire: clients
 * only ever see the broadcasted authoritative state.
 */
@Injectable()
export class AiService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AiService.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly games: GameService) {}

  onModuleInit(): void {
    this.timer = setInterval(() => this.tick(), AI_TICK_MS);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * One pass over all solo rooms. Public so tests can drive the AI without
   * waiting for (or faking) the interval.
   */
  tick(): void {
    for (const room of this.games.aiRooms()) {
      try {
        this.games.applyAiAction(room);
      } catch (error) {
        // Never let one bad room kill the interval; the next tick retries.
        this.logger.warn(`AI tick failed for room ${room.code}: ${String(error)}`);
      }
    }
  }
}
