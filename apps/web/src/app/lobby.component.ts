import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
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
          <button class="primary" (click)="create()" [disabled]="!client.connected()">Create room</button>
          <div class="join-row">
            <input class="code" [(ngModel)]="code" maxlength="6" placeholder="ROOM CODE" />
            <button (click)="join()" [disabled]="!client.connected() || code.trim().length < 4">Join</button>
          </div>
        } @else {
          <div class="room">
            <div>Room <strong>{{ client.room()!.code }}</strong></div>
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

  create() {
    this.persistName();
    this.client.createRoom(this.name);
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
