import { Component, computed, inject, signal } from '@angular/core';
import { getCard, HandCard, LaneState, PlayerId } from '@qcw/game-core';
import { CardComponent } from './card.component';
import { GameClientService } from './game-client.service';

@Component({
  selector: 'qcw-game',
  standalone: true,
  imports: [CardComponent],
  template: `
    @if (game(); as g) {
      <main class="game-shell">
        <header>
          <div>
            <button class="ghost" (click)="client.leaveRoom()">← Lobby</button>
            <strong>Room {{ g.roomCode }}</strong>
          </div>
          <div class="turn" [class.mine]="client.isMyTurn()">
            {{ g.status === 'finished' ? 'MATCH OVER' : (client.isMyTurn() ? 'YOUR TURN' : 'OPPONENT TURN') }}
          </div>
          <button class="end" (click)="endTurn()" [disabled]="!client.isMyTurn()">End turn</button>
        </header>

        <section class="opponent playerbar">
          <div><b>{{ opponent().name }}</b><span>{{ opponent().connected ? 'online' : 'disconnected' }}</span></div>
          <div>HP <strong>{{ opponent().hp }}</strong></div>
          <div>Mana {{ opponent().mana }}/{{ opponent().maxMana }}</div>
          <div>Hand {{ opponent().handCount }} · Deck {{ opponent().deckCount }}</div>
        </section>

        <section class="board">
          @for (lane of g.lanes; track lane.index) {
            <article class="lane" [class.targetable]="selectedCard() && client.isMyTurn()" (click)="laneClick(lane.index)">
              <div class="lane-name">{{ lane.type }} <span>#{{ lane.index + 1 }}</span></div>
              <div class="slot enemy">
                @if (side(lane, opponentId()).unit; as unit) {
                  <button class="unit" (click)="selectTarget(lane.index, $event)">
                    <b>{{ cardName(unit.cardId) }}</b><span>ATK {{ unit.attack }} · HP {{ unit.health }}/{{ unit.maxHealth }}</span>
                  </button>
                } @else { <span class="empty">enemy unit</span> }
                @if (side(lane, opponentId()).building; as building) {
                  <button class="building" (click)="selectTarget(lane.index, $event)">⌂ {{ cardName(building.cardId) }}</button>
                }
              </div>
              <div class="divider"></div>
              <div class="slot own">
                @if (side(lane, g.selfPlayerId).unit; as unit) {
                  <button class="unit" (click)="special(lane.index, $event)">
                    <b>{{ cardName(unit.cardId) }}</b><span>ATK {{ unit.attack }} · HP {{ unit.health }}/{{ unit.maxHealth }}</span>
                    @if (specialLabel(unit.cardId); as label) { <small>{{ label }} · survived {{ unit.turnsSurvived }}</small> }
                  </button>
                } @else { <span class="empty">your unit</span> }
                @if (side(lane, g.selfPlayerId).building; as building) {
                  <div class="building">⌂ {{ cardName(building.cardId) }}</div>
                }
              </div>
            </article>
          }
        </section>

        <section class="self playerbar">
          <div><b>{{ self().name }}</b><span>{{ self().connected ? 'online' : 'disconnected' }}</span></div>
          <div>HP <strong>{{ self().hp }}</strong></div>
          <div>Mana <strong>{{ self().mana }}/{{ self().maxMana }}</strong></div>
          <div>Deck {{ self().deckCount }}</div>
        </section>

        <section class="hand">
          @for (card of self().hand ?? []; track card.uid) {
            <qcw-card
              [card]="card"
              [selected]="selectedCard()?.uid === card.uid"
              [disabled]="!client.isMyTurn() || getDef(card).cost > self().mana"
              (picked)="pickCard($event)"
            />
          }
        </section>

        <section class="footer-grid">
          <div class="hint">
            @if (selectedCard()) {
              Selected <b>{{ getDef(selectedCard()!).name }}</b>. Click a lane/target to play. Click the card again to cancel.
            } @else {
              Select a card, or click one of your surviving units to attempt its special.
            }
            @if (client.error()) { <div class="error">{{ client.error()!.message }}</div> }
          </div>
          <div class="log">
            @for (entry of g.log.slice(-6).reverse(); track entry.seq) { <div>{{ entry.text }}</div> }
          </div>
        </section>

        @if (g.status === 'finished') {
          <div class="modal-backdrop">
            <section class="modal">
              <div class="eyebrow">match complete</div>
              <h2>{{ g.winnerId === g.selfPlayerId ? 'Victory' : 'Defeat' }}</h2>
              <p>Baseline scaffold reaches the end state. P1 task: add two-player rematch handshake.</p>
              <button (click)="client.leaveRoom()">Return to lobby</button>
            </section>
          </div>
        }
      </main>
    }
  `,
  styles: [`
    .game-shell { min-height:100vh; padding:14px; max-width:1500px; margin:0 auto; display:grid; gap:10px; }
    header { display:grid; grid-template-columns:1fr auto 1fr; align-items:center; gap:10px; background:#11151d; border:1px solid #272d38; border-radius:14px; padding:10px 12px; }
    header>div:first-child { display:flex; align-items:center; gap:12px; } .ghost{background:transparent;color:#aeb6c5;border:0;} .end{justify-self:end;background:#d7b76c;color:#111;border:0;border-radius:9px;padding:10px 18px;font-weight:800;}
    .turn{font-size:12px;letter-spacing:.14em;color:#d26f73;font-weight:900}.turn.mine{color:#7ad78d}
    .playerbar { display:flex; align-items:center; gap:18px; flex-wrap:wrap; padding:9px 13px; background:#11151d; border:1px solid #272d38; border-radius:12px; font-size:13px; }
    .playerbar>div:first-child { margin-right:auto; display:flex; gap:8px; align-items:baseline; }.playerbar span{font-size:10px;color:#7ad78d}.playerbar strong{font-size:18px}
    .board { display:grid; grid-template-columns:repeat(4,minmax(150px,1fr)); gap:8px; min-height:420px; }
    .lane { background:linear-gradient(#151a23,#0e1117); border:1px solid #2d3441; border-radius:13px; padding:9px; display:grid; grid-template-rows:auto 1fr 1px 1fr; gap:8px; min-width:0; }
    .lane.targetable:hover{border-color:#d7b76c}.lane-name{text-transform:uppercase;letter-spacing:.12em;font-size:11px;font-weight:900;color:#d7b76c;display:flex;justify-content:space-between}.lane-name span{color:#687183}
    .slot{display:grid;align-content:center;gap:6px;min-height:150px}.divider{background:#343b48}.empty{display:grid;place-items:center;height:100%;border:1px dashed #313847;border-radius:10px;color:#515b6c;font-size:11px;text-transform:uppercase;letter-spacing:.1em}
    .unit,.building{width:100%;border:1px solid #3c4554;background:#202631;color:#fff;border-radius:10px;padding:10px;text-align:left}.unit{display:grid;gap:5px}.unit span,.unit small{font-size:11px;color:#c1c7d2}.unit small{color:#d7b76c}.building{font-size:11px;background:#242017;border-color:#50462e;color:#e7d49e}
    .hand { display:flex; gap:8px; overflow-x:auto; padding:10px 2px 14px; min-height:230px; align-items:flex-start; }
    .footer-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.hint,.log{background:#11151d;border:1px solid #272d38;border-radius:12px;padding:12px;font-size:12px;color:#aeb6c5}.log{display:grid;gap:4px}.error{margin-top:8px;color:#ff9da5}
    .modal-backdrop{position:fixed;inset:0;background:#000b;display:grid;place-items:center;padding:20px}.modal{background:#151a23;border:1px solid #3b4352;border-radius:18px;padding:28px;max-width:440px;text-align:center}.modal h2{font-size:48px;margin:4px}.modal p{color:#aeb6c5;line-height:1.5}.modal button{background:#d7b76c;border:0;padding:11px 18px;border-radius:9px;font-weight:800}.eyebrow{text-transform:uppercase;letter-spacing:.15em;color:#d7b76c;font-size:10px}
    @media(max-width:850px){.board{overflow-x:auto;grid-template-columns:repeat(4,180px);min-height:390px}.footer-grid{grid-template-columns:1fr}header{grid-template-columns:1fr auto}.turn{display:none}.playerbar{gap:10px}.game-shell{padding:8px}}
  `],
})
export class GameComponent {
  readonly client = inject(GameClientService);
  readonly selectedCard = signal<HandCard | null>(null);
  readonly selectedSpecialLane = signal<number | null>(null);
  readonly game = this.client.game;
  readonly self = computed(() => this.game()!.players[this.game()!.selfPlayerId]);
  readonly opponentId = computed<PlayerId>(() => {
    const g = this.game()!;
    return g.playerOrder[0] === g.selfPlayerId ? g.playerOrder[1] : g.playerOrder[0];
  });
  readonly opponent = computed(() => this.game()!.players[this.opponentId()]);

  getDef = getCard;
  cardName(cardId: string) { return getCard(cardId).name; }
  specialLabel(cardId: string) {
    const card = getCard(cardId);
    return card.kind === 'unit' ? card.special?.name ?? null : null;
  }
  side(lane: LaneState, playerId: PlayerId) { return lane.sides[playerId]; }

  pickCard(card: HandCard) {
    this.client.clearError();
    this.selectedSpecialLane.set(null);
    this.selectedCard.update((selected) => (selected?.uid === card.uid ? null : card));
  }

  laneClick(laneIndex: number) {
    const selected = this.selectedCard();
    const game = this.game();
    if (!selected || !game || !this.client.isMyTurn()) return;
    const def = getCard(selected.cardId);
    const action = {
      type: 'play-card' as const,
      expectedRevision: game.revision,
      handCardUid: selected.uid,
      laneIndex,
      targetLaneIndex: laneIndex,
    };
    this.client.sendAction(action);
    this.selectedCard.set(null);
  }

  selectTarget(laneIndex: number, event: Event) {
    event.stopPropagation();
    const game = this.game();
    if (!game || !this.client.isMyTurn()) return;
    if (this.selectedCard()) {
      this.laneClick(laneIndex);
      return;
    }
    const specialLane = this.selectedSpecialLane();
    if (specialLane !== null) {
      this.client.sendAction({
        type: 'activate-special',
        expectedRevision: game.revision,
        laneIndex: specialLane,
        targetLaneIndex: laneIndex,
      });
      this.selectedSpecialLane.set(null);
    }
  }

  special(laneIndex: number, event: Event) {
    event.stopPropagation();
    const game = this.game();
    if (!game || !this.client.isMyTurn() || this.selectedCard()) return;
    const unit = game.lanes[laneIndex].sides[game.selfPlayerId].unit;
    if (!unit) return;
    const card = getCard(unit.cardId);
    if (card.kind !== 'unit' || !card.special) return;
    if (card.special.target === 'self' || card.special.target === 'enemy-hero') {
      this.client.sendAction({
        type: 'activate-special',
        expectedRevision: game.revision,
        laneIndex,
      });
    } else {
      this.selectedSpecialLane.set(laneIndex);
    }
  }

  endTurn() {
    const game = this.game();
    if (!game || !this.client.isMyTurn()) return;
    this.selectedCard.set(null);
    this.selectedSpecialLane.set(null);
    this.client.sendAction({ type: 'end-turn', expectedRevision: game.revision });
  }
}
