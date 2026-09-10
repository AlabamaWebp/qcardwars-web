import { Component, DestroyRef, ElementRef, computed, effect, inject, signal } from '@angular/core';
import type { Faction } from '@qcw/game-core';
import { getCard, HandCard, LaneState, PlayerId } from '@qcw/game-core';
import { CardComponent } from './card.component';
import { FACTION_THEME } from './faction-theme';
import { GameClientService, VisualEvent } from './game-client.service';
import { SoundService } from './sound.service';

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
            @if (client.reconnected()) { <span class="reconnected">reconnected</span> }
            {{ g.status === 'finished' ? 'MATCH OVER' : (client.isMyTurn() ? 'YOUR TURN' : 'OPPONENT TURN') }}
          </div>
          <div class="header-right">
            <!-- Phase A.2: sound toggle. Persisted in localStorage (qcw.sound), default on. -->
            <button
              class="ghost sound"
              aria-label="Sound"
              [attr.aria-pressed]="sound.enabled() ? 'true' : 'false'"
              [title]="sound.enabled() ? 'Sound on — click to mute' : 'Sound off — click to unmute'"
              (click)="sound.toggle()"
            >{{ sound.enabled() ? '🔊' : '🔇' }}</button>
            <button class="end" (click)="endTurn()" [disabled]="!client.isMyTurn()">End turn</button>
          </div>
        </header>

        <section class="opponent playerbar" [attr.data-player-bar]="opponentId()">
          <div><b>{{ opponent().name }}</b><span>{{ opponent().connected ? 'online' : 'disconnected' }}</span></div>
          <div>HP <strong>{{ opponent().hp }}</strong></div>
          <div>Mana {{ opponent().mana }}/{{ opponent().maxMana }}</div>
          <div>Hand {{ opponent().handCount }} · Deck {{ opponent().deckCount }}</div>
        </section>

        <section class="board">
          @for (lane of g.lanes; track lane.index) {
            <article class="lane" [attr.data-lane-index]="lane.index" [class.targetable]="selectedCard() && client.isMyTurn()" [style.--lane-accent]="laneAccent(lane.type)" [style.--lane-glow]="laneGlow(lane.type)" (click)="laneClick(lane.index)">
              <div class="lane-name">{{ lane.type }} <span>#{{ lane.index + 1 }}</span></div>
              <div class="slot enemy">
                @if (side(lane, opponentId()).unit; as unit) {
                  <button class="unit" [attr.data-unit-uid]="unit.uid" [style.--chip-accent]="chipAccent(unit.cardId)" (click)="selectTarget(lane.index, $event)">
                    <b>{{ cardName(unit.cardId) }}</b><span>ATK {{ unit.attack }} · HP {{ unit.health }}/{{ unit.maxHealth }}</span>
                    @if (unit.dot) { <span class="dot-badge" title="Poisoned">☠ {{ unit.dot.turns }}</span> }
                    <span class="tip">
                      <span class="tip-name">{{ cardName(unit.cardId) }}</span>
                      <span class="tip-meta">{{ getDef(unit.cardId).kind }} · {{ getDef(unit.cardId).faction }} · tier {{ getDef(unit.cardId).tier }}</span>
                      <span class="tip-stats">ATK {{ unit.attack }} · HP {{ unit.health }}/{{ unit.maxHealth }}</span>
                      @if (unit.dot) { <span class="tip-poison">Poison: {{ unit.dot.amount }} damage at the start of its owner's turn, {{ unit.dot.turns }} {{ unit.dot.turns === 1 ? 'turn' : 'turns' }} left.</span> }
                      <span class="tip-desc">{{ getDef(unit.cardId).description }}</span>
                    </span>
                  </button>
                } @else { <span class="empty">enemy unit</span> }
                @if (side(lane, opponentId()).building; as building) {
                  <button class="building" [attr.data-building-uid]="building.uid" [style.--chip-accent]="chipAccent(building.cardId)" (click)="selectTarget(lane.index, $event)">⌂ {{ cardName(building.cardId) }}
                    <span class="tip">
                      <span class="tip-name">{{ cardName(building.cardId) }}</span>
                      <span class="tip-meta">{{ getDef(building.cardId).kind }} · {{ getDef(building.cardId).faction }} · tier {{ getDef(building.cardId).tier }}</span>
                      <span class="tip-desc">{{ getDef(building.cardId).description }}</span>
                    </span>
                  </button>
                }
              </div>
              <div class="divider"></div>
              <div class="slot own">
                @if (side(lane, g.selfPlayerId).unit; as unit) {
                  <button class="unit" [attr.data-unit-uid]="unit.uid" [style.--chip-accent]="chipAccent(unit.cardId)" (click)="ownUnitClick(lane.index, $event)">
                    <b>{{ cardName(unit.cardId) }}</b><span>ATK {{ unit.attack }} · HP {{ unit.health }}/{{ unit.maxHealth }}</span>
                    @if (unit.dot) { <span class="dot-badge" title="Poisoned">☠ {{ unit.dot.turns }}</span> }
                    @if (specialLabel(unit.cardId); as label) { <small>{{ label }} · survived {{ unit.turnsSurvived }}</small> }
                    <span class="tip">
                      <span class="tip-name">{{ cardName(unit.cardId) }}</span>
                      <span class="tip-meta">{{ getDef(unit.cardId).kind }} · {{ getDef(unit.cardId).faction }} · tier {{ getDef(unit.cardId).tier }}</span>
                      <span class="tip-stats">ATK {{ unit.attack }} · HP {{ unit.health }}/{{ unit.maxHealth }}</span>
                      @if (unit.dot) { <span class="tip-poison">Poison: {{ unit.dot.amount }} damage at the start of your turn, {{ unit.dot.turns }} {{ unit.dot.turns === 1 ? 'turn' : 'turns' }} left.</span> }
                      <span class="tip-desc">{{ getDef(unit.cardId).description }}</span>
                    </span>
                  </button>
                } @else { <span class="empty">your unit</span> }
                @if (side(lane, g.selfPlayerId).building; as building) {
                  <div class="building" tabindex="0" [attr.data-building-uid]="building.uid" [style.--chip-accent]="chipAccent(building.cardId)">⌂ {{ cardName(building.cardId) }}
                    <span class="tip">
                      <span class="tip-name">{{ cardName(building.cardId) }}</span>
                      <span class="tip-meta">{{ getDef(building.cardId).kind }} · {{ getDef(building.cardId).faction }} · tier {{ getDef(building.cardId).tier }}</span>
                      <span class="tip-desc">{{ getDef(building.cardId).description }}</span>
                    </span>
                  </div>
                }
              </div>
            </article>
          }
        </section>

        <section class="self playerbar" [attr.data-player-bar]="g.selfPlayerId">
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
              [disabled]="!client.isMyTurn() || getDef(card.cardId).cost > self().mana"
              (picked)="pickCard($event)"
            />
          }
        </section>

        <section class="footer-grid">
          <div class="hint">
            @if (selectedCard()) {
               Selected <b>{{ getDef(selectedCard()!.cardId).name }}</b>. Click a lane/target to play. Click the card again to cancel.
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
              <table class="stats">
                <thead>
                  <tr><th></th><th>Turns</th><th>Cards</th><th>Kills</th><th>Dmg</th></tr>
                </thead>
                <tbody>
                  @for (pid of g.playerOrder; track pid) {
                    <tr>
                      <td class="who">{{ g.players[pid].name }}</td>
                      <td>{{ g.stats[pid].turnsTaken }}</td>
                      <td>{{ g.stats[pid].cardsPlayed }}</td>
                      <td>{{ g.stats[pid].unitsDestroyed }}</td>
                      <td>{{ g.stats[pid].damageDealt }}</td>
                    </tr>
                  }
                </tbody>
              </table>
              @if (isSolo()) {
                <p>Solo match: the AI auto-rematches, so your confirmation starts the next match immediately.</p>
              } @else if (!opponent().connected) {
                <p>Your opponent has left the match — no rematch is possible. Return to the lobby to create or join a room.</p>
              } @else if (!rematchRequested()) {
                <p>A two-player rematch handshake: both players must confirm.</p>
              } @else {
                <p class="waiting">{{ isSolo() ? 'Starting rematch…' : 'Waiting for your opponent to confirm the rematch…' }}</p>
              }
              <div class="modal-actions">
                @if (opponent().connected && !rematchRequested()) {
                  <button class="primary" (click)="requestRematch()">{{ isSolo() ? 'Rematch vs AI' : 'Request rematch' }}</button>
                }
                <button class="ghost" (click)="client.leaveRoom()">Return to lobby</button>
              </div>
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
    .turn{font-size:12px;letter-spacing:.14em;color:#d26f73;font-weight:900}.turn.mine{color:#7ad78d}.reconnected{color:#7ad78d;margin-right:8px;text-transform:lowercase;letter-spacing:.04em}
    .playerbar { display:flex; align-items:center; gap:18px; flex-wrap:wrap; padding:9px 13px; background:#11151d; border:1px solid #272d38; border-radius:12px; font-size:13px; }
    .playerbar>div:first-child { margin-right:auto; display:flex; gap:8px; align-items:baseline; }.playerbar span{font-size:10px;color:#7ad78d}.playerbar strong{font-size:18px}
    .board { display:grid; grid-template-columns:repeat(4,minmax(150px,1fr)); gap:8px; min-height:420px; }
    /* Faction identity (Phase A.1): --lane-accent/--lane-glow are set per lane from
       lane.type via [style.*] bindings; the gold targetable hover still wins. */
    .lane { background:linear-gradient(#151a23,#0e1117); border:1px solid var(--lane-accent,#2d3441); box-shadow:0 0 14px -3px var(--lane-glow,transparent); border-radius:13px; padding:9px; display:grid; grid-template-rows:auto 1fr 1px 1fr; gap:8px; min-width:0; }
    .lane.targetable:hover{border-color:#d7b76c}.lane-name{text-transform:uppercase;letter-spacing:.12em;font-size:11px;font-weight:900;color:var(--lane-accent,#d7b76c);display:flex;justify-content:space-between}.lane-name span{color:#687183}
    .slot{display:grid;align-content:center;gap:6px;min-height:150px}.divider{background:#343b48}.empty{display:grid;place-items:center;height:100%;border:1px dashed #313847;border-radius:10px;color:#515b6c;font-size:11px;text-transform:uppercase;letter-spacing:.1em}
    /* --chip-accent is set per chip from getCard(cardId).faction; the inset shadow
       (not a wider border) tints the left edge with zero layout shift. */
    .unit,.building{width:100%;position:relative;border:1px solid #3c4554;background:#202631;color:#fff;border-radius:10px;padding:10px;text-align:left;box-shadow:inset 3px 0 0 0 var(--chip-accent,transparent)}.unit{display:grid;gap:5px}.unit>span,.unit>small{font-size:11px;color:#c1c7d2}.unit>small{color:#d7b76c}.building{font-size:11px;background:#242017;border-color:#50462e;color:#e7d49e}
    /* Board tooltips (Phase A.1) — CSS-only, catalog data only (same visibility
       baseline as the existing chips: board units/buildings are already fully
       visible to both players). Absolutely positioned, so they never join the
       .unit grid rows or shift layout. Desktop: above the chip — no ancestor
       clips (no overflow rules on .board/.lane/.slot at >=851px); z-index keeps
       it above the player bars it may overlap.
       Mobile (<=850px): the scrolling .board (overflow-x:auto → computed
       overflow-y:auto) is the only clipping box, so enemy-chip tooltips flip
       below the chip and own-chip tooltips stay above — both remain inside the
       board — and tooltips pin to the chip's horizontal extent so edge lanes
       are never clipped and nothing causes page-level scroll.
       Mobile tap: tapping a chip focuses it (mobile Chrome and iOS Safari focus
       <button>/[tabindex] on tap), so the :focus reveal shows the same tooltip
       with no JS toggle and no change to click behavior — a tap still performs
       the existing selectTarget/ownUnitClick action exactly as before, and
       tapping elsewhere moves focus and dismisses the tooltip. */
    .tip{display:none;position:absolute;bottom:calc(100% + 8px);left:50%;transform:translateX(-50%);width:235px;background:rgba(11,14,20,.97);border:1px solid #454f61;border-radius:10px;padding:10px 11px;z-index:80;pointer-events:none;box-shadow:0 12px 28px #000c;text-align:left}
    .tip-name{display:block;font-weight:800;font-size:12px;color:#fff}
    .tip-meta{display:block;font-size:10px;letter-spacing:.06em;text-transform:capitalize;color:#8b93a5;margin-top:2px}
    .tip-stats{display:block;font-size:11px;font-weight:700;color:#d7b76c;margin-top:5px}
    .tip-desc{display:block;font-size:11px;line-height:1.45;color:#c7ccd7;margin-top:5px}
    /* Phase C — poison badge: absolute so it never joins the .unit grid rows. */
    .dot-badge{position:absolute;top:6px;right:6px;font-size:10px;line-height:1.4;font-weight:800;color:#7ad78d;background:#101a13;border:1px solid #2c5c3a;border-radius:6px;padding:0 4px}
    .tip-poison{display:block;font-size:11px;font-weight:700;color:#7ad78d;margin-top:5px}
    .unit:hover>.tip,.unit:focus>.tip,.building:hover>.tip,.building:focus>.tip{display:block}
    @media(max-width:850px){.tip{left:6px;right:6px;width:auto;transform:none}.slot.enemy .tip{bottom:auto;top:calc(100% + 8px)}.unit:has(.dot-badge)>b{padding-right:38px}}
    .hand { display:flex; gap:8px; overflow-x:auto; padding:10px 2px 14px; min-height:230px; align-items:flex-start; }
    .footer-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.hint,.log{background:#11151d;border:1px solid #272d38;border-radius:12px;padding:12px;font-size:12px;color:#aeb6c5}.log{display:grid;gap:4px}.error{margin-top:8px;color:#ff9da5}
    .modal-backdrop{position:fixed;inset:0;background:#000b;display:grid;place-items:center;padding:20px}.modal{background:#151a23;border:1px solid #3b4352;border-radius:18px;padding:28px;max-width:440px;text-align:center}.modal h2{font-size:48px;margin:4px}.modal p{color:#aeb6c5;line-height:1.5}.modal button{background:#d7b76c;border:0;padding:11px 18px;border-radius:9px;font-weight:800}.eyebrow{text-transform:uppercase;letter-spacing:.15em;color:#d7b76c;font-size:10px}
    @media(max-width:850px){.board{overflow-x:auto;grid-template-columns:repeat(4,180px);min-height:390px}.footer-grid{grid-template-columns:1fr}header{grid-template-columns:1fr auto}.turn{display:none}.playerbar{gap:10px}.game-shell{padding:8px}}
    .modal-actions{display:flex;gap:10px;justify-content:center;margin-top:12px}.modal-actions .ghost{background:transparent;color:#aeb6c5;border:1px solid #3e4655;padding:11px 18px;border-radius:9px}.modal .waiting{color:#d7b76c;min-height:1.5em}
    /* Phase D D-2 — match summary stats in the victory modal. */
    .stats{width:100%;margin:14px 0 4px;border-collapse:collapse;font-size:12px;color:#c1c7d2}
    .stats th{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#687183;padding:4px 8px;border-bottom:1px solid #2d3441}
    .stats td{padding:5px 8px;border-bottom:1px solid #222834;text-align:right}.stats td.who{text-align:left;color:#fff;font-weight:700}
    .stats tr:last-child td{border-bottom:0}
    .primary{background:#d7b76c;color:#111;border-color:#d7b76c;border:0;padding:11px 18px;border-radius:9px;font-weight:800}
    /* Phase A.2 — header-right groups the sound toggle + End turn so the
       existing 3-column (2-column mobile) header grid is undisturbed. */
    .header-right{display:flex;align-items:center;gap:8px;justify-self:end}
    .sound{font-size:16px;line-height:1;padding:8px 9px;border-radius:9px}
    /* Phase A.2 — combat/turn animations. Pure CSS keyframes, non-blocking,
       re-triggered from JS by removing the class, forcing a reflow, re-adding
       it (see GameComponent.retrigger), so rapid successive updates restart
       rather than stack/jitter. No layout shift: only transform/opacity/
       box-shadow/background animate.
       Destruction is rendered as a red flash on the LANE (not a ghost/fade of
       the chip): Angular removes the dead chip's element immediately, so a
       fade-out would need to keep the element alive artificially; the lane
       flash is the simplest robust signal that "something died here". */
    @keyframes qcw-pop{0%{transform:scale(.55);opacity:0}65%{transform:scale(1.07);opacity:1}100%{transform:scale(1)}}
    .pop{animation:qcw-pop .3s ease-out}
    @keyframes qcw-hit{
      0%,100%{box-shadow:inset 3px 0 0 0 var(--chip-accent,transparent);transform:translateX(0)}
      25%{box-shadow:inset 3px 0 0 0 var(--chip-accent,transparent),0 0 12px 2px #e0484e;background-color:#5b2b33;transform:translateX(-3px)}
      50%{transform:translateX(3px)}
      75%{box-shadow:inset 3px 0 0 0 var(--chip-accent,transparent),0 0 10px 1px #e0484e;background-color:#4d2430;transform:translateX(-2px)}
    }
    .unit.hit,.building.hit{animation:qcw-hit .35s ease-in-out}
    @keyframes qcw-hero-hit{0%,100%{border-color:#272d38;background-color:#11151d}35%{border-color:#e0484e;background-color:#2a161c}70%{border-color:#7e3a3f;background-color:#1a141c}}
    .playerbar.hit{animation:qcw-hero-hit .45s ease-in-out}
    @keyframes qcw-lane-hit{0%,100%{box-shadow:0 0 14px -3px var(--lane-glow,transparent)}30%{box-shadow:0 0 18px 2px #e0484e}}
    .lane.lane-hit{animation:qcw-lane-hit .5s ease-in-out}
    @keyframes qcw-pulse{0%,100%{background:transparent}30%{background:rgba(215,183,108,.18)}}
    .turn.pulse{animation:qcw-pulse .6s ease}
    @media (prefers-reduced-motion: reduce){.pop,.hit,.lane-hit,.pulse{animation:none !important}}
  `],
})
export class GameComponent {
  readonly client = inject(GameClientService);
  readonly sound = inject(SoundService);
  private readonly el = inject(ElementRef);
  readonly selectedCard = signal<HandCard | null>(null);
  readonly selectedSpecialLane = signal<number | null>(null);
  readonly rematchRequested = signal(false);
  readonly game = this.client.game;
  readonly self = computed(() => this.game()!.players[this.game()!.selfPlayerId]);
  readonly opponentId = computed<PlayerId>(() => {
    const g = this.game()!;
    return g.playerOrder[0] === g.selfPlayerId ? g.playerOrder[1] : g.playerOrder[0];
  });
  readonly opponent = computed(() => this.game()!.players[this.opponentId()]);
  /** Phase D D-1 — solo match: the opponent seat is the server-side AI (auto-rematches). */
  readonly isSolo = computed(() => this.game()?.solo === true);

  /** Highest visual-event id already applied (Phase A.2). */
  private processedFx = 0;
  /** Pending frameFx rAF ids — cancelled on destroy so no fx write runs after teardown. */
  private pendingFx = new Set<number>();

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      for (const id of this.pendingFx) cancelAnimationFrame(id);
      this.pendingFx.clear();
    });

    // Clear the "waiting for opponent" banner once a fresh match starts.
    effect(() => {
      const g = this.game();
      if (g && g.status === 'playing' && this.rematchRequested()) {
        this.rematchRequested.set(false);
      }
    });

    // Phase A.2: apply each derived visual event exactly once — CSS re-trigger
    // on the matching element plus the matching synthesized sound cue. Runs
    // after change detection, so the DOM already reflects the new view.
    effect(() => {
      for (const event of this.client.visualEvents()) {
        if (event.id <= this.processedFx) continue;
        this.processedFx = event.id;
        this.applyFx(event);
      }
    });
  }

  /** Re-run a CSS animation on an element by toggling its class with a reflow. */
  private retrigger(selector: string, className: string): void {
    const node = this.el.nativeElement.querySelector(selector) as HTMLElement | null;
    if (!node) return;
    node.classList.remove(className);
    void node.offsetWidth; // force reflow so the animation restarts instead of stacking
    node.classList.add(className);
  }

  /**
   * DOM writes are deferred to the next animation frame: a signal effect can
   * run before the view update that creates a freshly placed chip is painted,
   * so an immediate querySelector would miss brand-new elements. rAF also
   * guarantees the write happens after paint (non-blocking) and keeps rapid
   * successive updates from stacking — each frame re-triggers at most once.
   */
  private frameFx(fn: () => void): void {
    const id = requestAnimationFrame(() => {
      this.pendingFx.delete(id);
      fn();
    });
    this.pendingFx.add(id);
  }

  private applyFx(event: VisualEvent): void {
    const game = this.game();
    switch (event.type) {
      case 'unit-placed':
      case 'building-placed': {
        this.sound.playCardPlayed();
        if (event.uid) {
          const attr = event.type === 'unit-placed' ? 'data-unit-uid' : 'data-building-uid';
          const uid = event.uid;
          this.frameFx(() => this.retrigger(`[${attr}="${uid}"]`, 'pop'));
        }
        break;
      }
      case 'unit-damaged': {
        this.sound.playUnitDamaged();
        if (event.uid) {
          const uid = event.uid;
          this.frameFx(() => this.retrigger(`[data-unit-uid="${uid}"]`, 'hit'));
        }
        break;
      }
      case 'unit-destroyed':
      case 'building-destroyed': {
        // Simplest robust choice (see CSS comment): flash the lane, not the
        // already-removed chip.
        this.sound.playDestroyed();
        if (event.laneIndex !== undefined) {
          const laneIndex = event.laneIndex;
          this.frameFx(() => this.retrigger(`[data-lane-index="${laneIndex}"]`, 'lane-hit'));
        }
        break;
      }
      case 'hero-damaged': {
        this.sound.playHeroHit();
        if (event.playerId) {
          const playerId = event.playerId;
          this.frameFx(() => this.retrigger(`[data-player-bar="${playerId}"]`, 'hit'));
        }
        break;
      }
      case 'turn-changed': {
        this.frameFx(() => this.retrigger('.turn', 'pulse'));
        break;
      }
      case 'match-finished': {
        this.sound.playMatchEnd(Boolean(game && event.winnerId === game.selfPlayerId));
        break;
      }
    }
  }

  getDef = getCard;
  cardName(cardId: string) { return getCard(cardId).name; }
  /** Faction accent for a lane frame, from the lane's fixed type. */
  laneAccent(faction: Faction) { return FACTION_THEME[faction].accent; }
  laneGlow(faction: Faction) { return FACTION_THEME[faction].glow; }
  /** Faction accent for a board chip, from its card definition ('universal' cards keep the universal tint). */
  chipAccent(cardId: string) { return FACTION_THEME[getCard(cardId).faction].accent; }
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
    if (card.special.target === 'self' || card.special.target === 'enemy-hero' || card.special.target === 'none') {
      this.client.sendAction({
        type: 'activate-special',
        expectedRevision: game.revision,
        laneIndex,
      });
    } else {
      this.selectedSpecialLane.set(laneIndex);
    }
  }

  /**
   * Clicks on the player's own units.
   *
   * When a `friendly-unit` special is active, this lets the player aim the
   * special at one of their own lanes (self by default, or a different unit
   * by clicking another of their units). `selectTarget` only covers enemy
   * pieces, so it can't supply a friendly target on its own.
   */
  ownUnitClick(laneIndex: number, event: Event) {
    event.stopPropagation();
    const game = this.game();
    if (!game || !this.client.isMyTurn()) return;
    const specialLane = this.selectedSpecialLane();
    if (specialLane !== null) {
      this.client.sendAction({
        type: 'activate-special',
        expectedRevision: game.revision,
        laneIndex: specialLane,
        targetLaneIndex: laneIndex,
      });
      this.selectedSpecialLane.set(null);
      return;
    }
    this.special(laneIndex, event);
  }

  endTurn() {
    const game = this.game();
    if (!game || !this.client.isMyTurn()) return;
    this.selectedCard.set(null);
    this.selectedSpecialLane.set(null);
    this.client.sendAction({ type: 'end-turn', expectedRevision: game.revision });
  }

  requestRematch() {
    this.rematchRequested.set(true);
    this.client.rematch();
  }
}
