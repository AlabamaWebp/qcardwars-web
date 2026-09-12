import { Component, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DEFAULT_LANE_TYPES, LANE_TYPES, LaneType } from '@qcw/game-core';
import { FACTION_THEME } from './faction-theme';
import { GameClientService } from './game-client.service';
import { I18nService } from './i18n.service';

/** Random 4-lane pick (lobby convenience only — the server re-validates). */
export function randomLanes(): LaneType[] {
  const pool = [...LANE_TYPES];
  const pick: LaneType[] = [];
  while (pick.length < 4) {
    pick.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  }
  return pick;
}

/**
 * One 4-lane multiset picker (repeats allowed). Dumb component: the parent
 * owns the signal and binds `[value]` / `(valueChange)`.
 */
@Component({
  selector: 'qcw-lane-picker',
  standalone: true,
  template: `
    <div class="lanes">
      <div class="lane-heading">
        {{ title() }}
        <span class="count">{{ value().length }}/4</span>
      </div>
      <div class="lane-grid">
        @for (type of laneTypes; track type) {
          @let accent = laneAccent(type);
          @let count = value().filter((lane) => lane === type).length;
          @let selected = count > 0;
          <button
            type="button"
            class="lane-chip"
            [attr.aria-pressed]="selected"
            [class.selected]="selected"
            [class.locked]="value().length >= 4 && !selected"
            [disabled]="value().length >= 4 && !selected"
            [style.border-color]="accent"
            [style.color]="accent"
            [style.box-shadow]="selected ? '0 0 14px ' + accent + '45' : undefined"
            (click)="toggle(type)"
          >
            <span class="lane-chip__name">{{ i18n.faction(type) }}</span>
            @if (selected) {
              <span class="lane-chip__count">{{ count }}</span>
            }
          </button>
        }
      </div>
      <div class="lane-hint">{{ hint() }}</div>
    </div>
  `,
  styles: [`
    .lanes { display:grid; gap:9px; }
    .lane-heading { color:#b8c0cf; font-size:13px; display:flex; gap:9px; align-items:center; }
    .lane-heading .count { color:#d7b76c; font-weight:800; }
    .lane-grid { display:grid; grid-template-columns:repeat(3, 1fr); gap:8px; }
    .lane-chip { padding:10px 8px; border-radius:10px; background:#0b0e13; border:1px solid #363d4c; text-transform:capitalize; font-weight:700; opacity:.55; display:grid; align-items:center; justify-items:center; gap:4px; min-height:44px; }
    .lane-chip:hover { opacity:.85; }
    .lane-chip.selected { opacity:1; background:#141a24; }
    .lane-chip[disabled] { opacity:.3 !important; cursor:not-allowed; }
    .lane-chip[disabled]:hover { opacity:.3 !important; }
    .lane-chip__count { font-size:11px; font-weight:800; opacity:.9; }
    .lane-hint { color:#7c8598; font-size:11px; }
  `],
})
export class LanePickerComponent {
  readonly i18n = inject(I18nService);
  readonly title = input('Choose 4 lanes for your side (repeats allowed)');
  readonly hint = input(
    'Exactly four lanes — repeats allowed, so a faction can fill more than one lane. Only your chosen lane factions fill your deck.',
  );
  readonly value = input<LaneType[]>([]);
  readonly valueChange = output<LaneType[]>();
  readonly laneTypes = LANE_TYPES;

  laneAccent(type: LaneType): string {
    return FACTION_THEME[type].accent;
  }

  /**
   * Toggle a lane toward a four-slot multiset. While under four, tapping a
   * lane adds an instance (repeats allowed); at four, tapping a chosen lane
   * drops one instance of it.
   */
  toggle(type: LaneType) {
    const current = this.value();
    if (current.length >= 4) {
      const index = current.indexOf(type);
      if (index === -1) return;
      this.valueChange.emit([...current.slice(0, index), ...current.slice(index + 1)]);
      return;
    }
    this.valueChange.emit([...current, type]);
  }
}

@Component({
  selector: 'qcw-lobby',
  standalone: true,
  imports: [FormsModule, LanePickerComponent],
  template: `
    <main class="lobby-shell">
      <section class="panel hero">
        <div>
          <div class="eyebrow">{{ i18n.t('lobby.eyebrow') }}</div>
          <h1>QCardWars Web</h1>
          <p>{{ i18n.t('lobby.tagline') }}</p>
        </div>
        <div class="hero-right">
          <button type="button" class="ghost lang" [title]="i18n.t('lang.label')" (click)="i18n.toggle()">{{ i18n.t('lang.toggle') }}</button>
          <div class="connection" [class.online]="client.connected()">
            {{ client.connected() ? i18n.t('lobby.online') : i18n.t('lobby.offline') }}
          </div>
        </div>
      </section>

      <section class="panel form-panel">
        <label>{{ i18n.t('lobby.playerName') }} <input [(ngModel)]="name" maxlength="24" /></label>
        @if (!client.room()) {
          <qcw-lane-picker
            [title]="i18n.t('lobby.yourLanes')"
            [hint]="i18n.t('lobby.yourHint')"
            [value]="selectedLanes()"
            (valueChange)="selectedLanes.set($event)"
          />
          <qcw-lane-picker
            [title]="i18n.t('lobby.aiLanes')"
            [hint]="i18n.t('lobby.aiHint')"
            [value]="aiLanes()"
            (valueChange)="aiLanes.set($event)"
          />
          <div class="create-row">
            <button
              class="primary"
              (click)="create()"
              [disabled]="!client.connected() || selectedLanes().length !== 4"
            >{{ i18n.t('lobby.create') }}</button>
            <div class="solo-row">
              <button
                (click)="createSolo()"
                [disabled]="!client.connected() || selectedLanes().length !== 4 || aiLanes().length !== 4"
              >{{ i18n.t('lobby.solo') }}</button>
              <button
                type="button"
                class="dice"
                [title]="i18n.t('lobby.dice')"
                [attr.aria-label]="i18n.t('lobby.dice')"
                (click)="aiLanes.set(randomLanes())"
              >🎲</button>
            </div>
          </div>
          <qcw-lane-picker
            [title]="i18n.t('lobby.joinTitle')"
            [hint]="i18n.t('lobby.joinHint')"
            [value]="joinLanes()"
            (valueChange)="joinLanes.set($event)"
          />
          <div class="join-row">
            <input class="code" [(ngModel)]="code" maxlength="6" [placeholder]="i18n.t('lobby.code')" />
            <button (click)="join()" [disabled]="!client.connected() || code.trim().length < 4 || joinLanes().length !== 4">{{ i18n.t('lobby.join') }}</button>
          </div>
        } @else {
          <div class="room">
            <div>Room <strong>{{ client.room()!.code }}</strong></div>
            <p>{{ i18n.t('lobby.share') }}</p>
            @for (player of client.room()!.players; track player.id) {
              <div class="player">
                <span>{{ player.name }} <em>{{ laneList(player.laneTypes) }}</em></span>
                <span [class.offline]="!player.connected">{{ player.connected ? i18n.t('lobby.ready') : i18n.t('lobby.waiting') }}</span>
              </div>
            }
            <button (click)="client.leaveRoom()">{{ i18n.t('lobby.leave') }}</button>
          </div>
        }
        @if (client.reconnected()) { <div class="notice">{{ i18n.t('lobby.reconnected') }}</div> }
        @if (client.error()) { <div class="error">{{ client.error()!.message }}</div> }
      </section>
    </main>
  `,
  styles: [`
    .lobby-shell { max-width: 920px; margin: 0 auto; min-height:100vh; display:grid; align-content:center; gap:18px; padding:24px; }
    .panel { border:1px solid #272d38; background:#11151d; border-radius:20px; padding:24px; box-shadow:0 24px 60px #0006; }
    .hero { display:flex; align-items:flex-end; justify-content:space-between; gap:20px; }
    .eyebrow { text-transform:uppercase; letter-spacing:.16em; font-size:11px; color:#d7b76c; }
    h1 { font-size:clamp(34px,6vw,64px); margin:6px 0 4px; }
    p { color:#aeb6c5; max-width:650px; line-height:1.55; }
    .connection { color:#d06767; font-size:12px; } .connection.online { color:#76cf8b; }
    .hero-right { display:grid; gap:8px; justify-items:end; }
    .ghost.lang { background:transparent; color:#d7b76c; border:1px solid #3e4655; padding:6px 12px; border-radius:8px; font-weight:800; }
    .form-panel { display:grid; gap:14px; }
    label { display:grid; gap:7px; color:#b8c0cf; font-size:13px; }
    input { width:100%; border:1px solid #363d4c; background:#0b0e13; color:#fff; padding:12px 14px; border-radius:10px; outline:none; }
    button { border:1px solid #3e4655; background:#202632; color:#fff; border-radius:10px; padding:12px 16px; font-weight:700; }
    .primary { background:#d7b76c; color:#111; border-color:#d7b76c; }
    .create-row { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
    .solo-row { display:grid; grid-template-columns:1fr auto; gap:10px; }
    .dice { padding:12px 14px; }
    .player em { display:block; font-style:normal; color:#7c8598; font-size:11px; text-transform:capitalize; }
    .join-row { display:grid; grid-template-columns:1fr auto; gap:10px; }
    .code { text-transform:uppercase; letter-spacing:.12em; font-weight:800; }
    .room { display:grid; gap:10px; } .room strong { font-size:22px; letter-spacing:.12em; }
    .player { display:flex; justify-content:space-between; gap:10px; background:#0c1016; border-radius:8px; padding:10px 12px; }
    .player span { color:#76cf8b; font-size:12px; }
    .player span.offline { color:#d26f73; }
    .notice { background:#12291c; border:1px solid #2f5c3d; color:#7ad78d; padding:10px 12px; border-radius:9px; }
    .error { background:#3a1719; border:1px solid #6d2d32; color:#ffb7bd; padding:10px 12px; border-radius:9px; }
    @media(max-width:640px){ .hero{align-items:flex-start; flex-direction:column;} .join-row{grid-template-columns:1fr;} }
  `],
})
export class LobbyComponent {
  readonly client = inject(GameClientService);
  readonly i18n = inject(I18nService);
  name = localStorage.getItem('qcw-name') || 'Player';
  code = '';

  /**
   * Each side picks its OWN 4 lanes: `selectedLanes` is used for Create (and
   * as the human side for solo), `aiLanes` is the AI side for solo (dice for
   * a random set), `joinLanes` is the joiner's own side.
   */
  readonly selectedLanes = signal<LaneType[]>([...DEFAULT_LANE_TYPES]);
  readonly aiLanes = signal<LaneType[]>(randomLanes());
  readonly joinLanes = signal<LaneType[]>([...DEFAULT_LANE_TYPES]);
  readonly randomLanes = randomLanes;

  /** Localized lane list for the pre-game room view. */
  laneList(laneTypes: LaneType[]): string {
    return laneTypes.map((type) => this.i18n.faction(type)).join(' · ');
  }

  create() {
    this.persistName();
    this.client.createRoom(this.name, false, this.selectedLanes());
  }

  /** Phase D D-1 — solo match vs the server-side AI (starts immediately). */
  createSolo() {
    this.persistName();
    this.client.createRoom(this.name, true, this.selectedLanes(), this.aiLanes());
  }

  join() {
    this.persistName();
    this.client.joinRoom(this.code, this.name, this.joinLanes());
  }

  private persistName() {
    const cleaned = this.name.trim() || 'Player';
    this.name = cleaned;
    localStorage.setItem('qcw-name', cleaned);
  }
}
