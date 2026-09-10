import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DEFAULT_LANE_TYPES, LANE_TYPES, LaneType } from '@qcw/game-core';
import { FACTION_THEME } from './faction-theme';
import { GameClientService } from './game-client.service';

@Component({
  selector: 'qcw-lobby',
  standalone: true,
  imports: [FormsModule],
  template: `
    <main class="lobby-shell">
      <section class="panel hero">
        <div>
          <div class="eyebrow">browser / LAN prototype</div>
          <h1>QCardWars Web</h1>
          <p>Four lanes. Typed units. Growing mana. Build pressure, use powers, survive long enough to trigger specials.</p>
        </div>
        <div class="connection" [class.online]="client.connected()">
          {{ client.connected() ? 'server connected' : 'connecting…' }}
        </div>
      </section>

      <section class="panel form-panel">
        <label>Player name <input [(ngModel)]="name" maxlength="24" /></label>
        @if (!client.room()) {
          <div class="lanes">
            <div class="lane-heading">
              Choose the 4 lanes for your room
              <span class="count">{{ selectedLanes().length }}/4</span>
            </div>
            <div class="lane-grid">
              @for (type of laneTypes; track type) {
                @let accent = laneAccent(type);
                @let selected = selectedLanes().includes(type);
                <button
                  class="lane-chip"
                  [attr.aria-pressed]="selected"
                  [class.selected]="selected"
                  [style.border-color]="selected ? accent : undefined"
                  [style.color]="accent"
                  [style.box-shadow]="selected ? '0 0 14px ' + accent + '45' : undefined"
                  (click)="toggleLane(type)"
                >{{ type }}</button>
              }
            </div>
            <div class="lane-hint">Exactly four lanes — the board is shared by both players.</div>
          </div>
          <div class="create-row">
            <button
              class="primary"
              (click)="create()"
              [disabled]="!client.connected() || selectedLanes().length !== 4"
            >Create room</button>
            <button
              (click)="createSolo()"
              [disabled]="!client.connected() || selectedLanes().length !== 4"
            >Play solo (vs AI)</button>
          </div>
          <div class="join-row">
            <input class="code" [(ngModel)]="code" maxlength="6" placeholder="ROOM CODE" />
            <button (click)="join()" [disabled]="!client.connected() || code.trim().length < 4">Join</button>
          </div>
        } @else {
          <div class="room">
            <div>Room <strong>{{ client.room()!.code }}</strong></div>
            <div class="room-lanes">Lanes: {{ client.room()!.laneTypes.join(' · ') }}</div>
            <p>Share the code with player 2. Match starts automatically.</p>
            @for (player of client.room()!.players; track player.id) {
              <div class="player">{{ player.name }} <span [class.offline]="!player.connected">{{ player.connected ? 'ready' : 'disconnected — waiting to rejoin…' }}</span></div>
            }
            <button (click)="client.leaveRoom()">Leave room</button>
          </div>
        }
        @if (client.reconnected()) { <div class="notice">Reconnected — session restored.</div> }
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
    .form-panel { display:grid; gap:14px; }
    label { display:grid; gap:7px; color:#b8c0cf; font-size:13px; }
    input { width:100%; border:1px solid #363d4c; background:#0b0e13; color:#fff; padding:12px 14px; border-radius:10px; outline:none; }
    button { border:1px solid #3e4655; background:#202632; color:#fff; border-radius:10px; padding:12px 16px; font-weight:700; }
    .primary { background:#d7b76c; color:#111; border-color:#d7b76c; }
    .lanes { display:grid; gap:9px; }
    .lane-heading { color:#b8c0cf; font-size:13px; display:flex; gap:9px; align-items:center; }
    .lane-heading .count { color:#d7b76c; font-weight:800; }
    .lane-grid { display:grid; grid-template-columns:repeat(3, 1fr); gap:8px; }
    .lane-chip { padding:10px 8px; border-radius:10px; background:#0b0e13; border:1px solid #363d4c; text-transform:capitalize; font-weight:700; opacity:.55; }
    .lane-chip:hover { opacity:.85; }
    .lane-chip.selected { opacity:1; background:#141a24; }
    .lane-hint { color:#7c8598; font-size:11px; }
    .create-row { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
    .room-lanes { color:#7c8598; font-size:12px; text-transform:capitalize; }
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
  name = localStorage.getItem('qcw-name') || 'Player';
  code = '';

  /** END-1 — the 6-type lane pool and the creator's selection (default: classic four). */
  readonly laneTypes = LANE_TYPES;
  readonly selectedLanes = signal<LaneType[]>([...DEFAULT_LANE_TYPES]);

  laneAccent(type: LaneType): string {
    return FACTION_THEME[type].accent;
  }

  /**
   * Toggle a lane. The selection may dip to three (the swap intermediate:
   * deselect, then select) but never below three or above four. The create
   * buttons are disabled while the count is not exactly four, and the server
   * still validates the payload (defense in depth).
   */
  toggleLane(type: LaneType) {
    const current = this.selectedLanes();
    if (current.includes(type)) {
      if (current.length < 4) return;
      this.selectedLanes.set(current.filter((entry) => entry !== type));
    } else {
      if (current.length >= 4) return;
      this.selectedLanes.set([...current, type]);
    }
  }

  create() {
    this.persistName();
    this.client.createRoom(this.name, false, this.selectedLanes());
  }

  /** Phase D D-1 — solo match vs the server-side AI (starts immediately). */
  createSolo() {
    this.persistName();
    this.client.createRoom(this.name, true, this.selectedLanes());
  }

  join() {
    this.persistName();
    this.client.joinRoom(this.code, this.name);
  }

  private persistName() {
    const cleaned = this.name.trim() || 'Player';
    this.name = cleaned;
    localStorage.setItem('qcw-name', cleaned);
  }
}
