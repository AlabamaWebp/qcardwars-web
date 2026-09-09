import { Injectable, signal } from '@angular/core';

/**
 * Phase A.2 — tiny synthesized sound cues (Web Audio API, no asset files).
 *
 * Every cue is a short (<150 ms) oscillator blip with an exponential gain
 * decay, gain 0.05–0.12, no loops. The AudioContext is created/resumed
 * lazily on the first user gesture (pointerdown/keydown) to satisfy browser
 * autoplay policies; until then `ensureContext()` may return a suspended
 * context and cues are simply silent.
 */
@Injectable({ providedIn: 'root' })
export class SoundService {
  private static readonly STORAGE_KEY = 'qcw.sound';

  private ctx: AudioContext | null = null;
  private unlocked = false;

  /** Sound on/off. Default ON; persisted in localStorage under `qcw.sound`. */
  readonly enabled = signal<boolean>(SoundService.readStored());

  constructor() {
    const unlock = () => {
      if (this.unlocked) return;
      this.unlocked = true;
      this.ensureContext();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock);
  }

  toggle() {
    const next = !this.enabled();
    try {
      localStorage.setItem(SoundService.STORAGE_KEY, next ? '1' : '0');
    } catch {
      // Storage unavailable (private mode etc.): the toggle still works for this session.
    }
    this.enabled.set(next);
  }

  private static readStored(): boolean {
    try {
      return localStorage.getItem(SoundService.STORAGE_KEY) !== '0';
    } catch {
      return true;
    }
  }

  private ensureContext(): AudioContext | null {
    if (!this.ctx) {
      const Ctor = window.AudioContext;
      if (!Ctor) return null;
      this.ctx = new Ctor();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  /** One short tone: frequency ramps from `from` to `to` over `duration` seconds. */
  private tone(from: number, to: number, duration: number, gain: number, type: OscillatorType, delay = 0): void {
    if (!this.enabled()) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + duration);
    amp.gain.setValueAtTime(gain, t0);
    amp.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(amp).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  /** Card played: soft triangle pluck (660→520 Hz, 90 ms, gain 0.09). */
  playCardPlayed() { this.tone(660, 520, 0.09, 0.09, 'triangle'); }

  /** Unit damaged: low sine thud (130→65 Hz, 110 ms, gain 0.11). */
  playUnitDamaged() { this.tone(130, 65, 0.11, 0.11, 'sine'); }

  /** Unit/building destroyed: descending square blip (440→150 Hz, 140 ms, gain 0.07). */
  playDestroyed() { this.tone(440, 150, 0.14, 0.07, 'square'); }

  /** Hero damaged: deeper sine thud (85→42 Hz, 140 ms, gain 0.12). */
  playHeroHit() { this.tone(85, 42, 0.14, 0.12, 'sine'); }

  /** Match end: short two-tone (70 ms tones). Victory rises C5→E5, defeat falls G4→C4. */
  playMatchEnd(victory: boolean) {
    if (victory) {
      this.tone(523.25, 523.25, 0.07, 0.09, 'triangle');
      this.tone(659.25, 659.25, 0.07, 0.09, 'triangle', 0.08);
    } else {
      this.tone(392, 392, 0.07, 0.09, 'triangle');
      this.tone(261.63, 261.63, 0.07, 0.09, 'triangle', 0.08);
    }
  }
}
