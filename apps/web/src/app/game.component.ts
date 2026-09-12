import { Component, DestroyRef, ElementRef, HostListener, computed, effect, inject, signal } from '@angular/core';
import type { CardDefinition, ClientUnitView, Faction, GameLogEntry } from '@qcw/game-core';
import { getCard, HandCard, ClientLaneState, PlayerId } from '@qcw/game-core';
import { cardArtUrl, hideBrokenArt } from './card-art';
import { CardComponent } from './card.component';
import { I18nService } from './i18n.service';
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
        <header [class.my-turn]="client.isMyTurn()">
          <div>
            <button class="ghost" (click)="client.leaveRoom()">{{ i18n.t('game.lobby') }}</button>
            <strong class="room-code"><span>{{ i18n.t('game.room') }}</span> {{ g.roomCode }}</strong>
          </div>
          <div class="turn" [class.mine]="client.isMyTurn()" aria-live="polite">
            @if (client.reconnected()) { <span class="reconnected">{{ i18n.t('game.reconnected') }}</span> }
            {{ g.status === 'finished' ? i18n.t('game.over') : (client.isMyTurn() ? i18n.t('game.yourTurn') : i18n.t('game.oppTurn')) }}
          </div>
          <div class="header-right">
            <button
              type="button"
              class="ghost lang"
              [title]="i18n.t('lang.label')"
              (click)="i18n.toggle()"
            >{{ i18n.t('lang.toggle') }}</button>
            <!-- Phase A.2: sound toggle. Persisted in localStorage (qcw.sound), default on. -->
            <button
              class="ghost sound"
              aria-label="Sound"
              [attr.aria-pressed]="sound.enabled() ? 'true' : 'false'"
              [title]="sound.enabled() ? i18n.t('game.soundOn') : i18n.t('game.soundOff')"
              (click)="sound.toggle()"
            >{{ sound.enabled() ? '🔊' : '🔇' }}</button>
            <button class="end" (click)="endTurn()" [disabled]="!client.isMyTurn()"><span aria-hidden="true">↪</span>{{ i18n.t('game.endTurn') }}</button>
          </div>
        </header>

        <section
          class="opponent playerbar"
          [class.hero-targetable]="isHeroTargetable()"
          [attr.role]="isHeroTargetable() ? 'button' : null"
          [attr.tabindex]="isHeroTargetable() ? 0 : null"
          [attr.data-player-bar]="opponentId()"
          (click)="opponentHeroClick()"
          (keydown.enter)="opponentHeroClick()"
          (keydown.space)="opponentHeroClick(); $event.preventDefault()"
        >
          <div class="identity"><b>{{ opponent().name }}</b><span>{{ opponent().connected ? i18n.t('game.online') : i18n.t('game.offline') }}</span></div>
          <div class="resource hp"><span>{{ i18n.t('game.hp') }}</span><strong>{{ opponent().hp }}</strong></div>
          <div class="resource mana"><span>{{ i18n.t('game.mana') }}</span><strong>{{ opponent().mana }}/{{ opponent().maxMana }}</strong></div>
          <div class="resource cards"><span>{{ i18n.t('game.hand') }} / {{ i18n.t('game.deck') }}</span><strong>{{ opponent().handCount }} / {{ opponent().deckCount }}</strong></div>
          @if (isHeroTargetable()) { <div class="hero-callout">{{ i18n.t('game.targetHero') }}</div> }
          @if (opponent().fatigue > 0) {
            <div class="fatigue" [title]="i18n.t('game.fatigueFoe') + ' ' + opponent().fatigue + ' ' + i18n.t('game.fatigueTail')">☄ {{ i18n.t('game.fatigue') }} {{ opponent().fatigue }}</div>
          }
        </section>

        <section class="board">
          @for (lane of g.lanes; track lane.index) {
            <article
              class="lane"
              [attr.data-lane-index]="lane.index"
              [class.targetable]="isLaneTargetable(lane)"
              [class.blocked]="hasTargetSelection() && !isLaneTargetable(lane)"
              [attr.role]="isLaneTargetable(lane) ? 'button' : null"
              [attr.tabindex]="isLaneTargetable(lane) ? 0 : null"
              [style.--lane-accent]="laneAccent(ownSideType(lane))"
              [style.--lane-glow]="laneGlow(ownSideType(lane))"
              (click)="laneClick(lane.index)"
              (keydown.enter)="laneClick(lane.index)"
              (keydown.space)="laneClick(lane.index); $event.preventDefault()"
            >
              <div class="lane-name">
                @if (ownSideType(lane) === enemySideType(lane)) {
                  {{ i18n.faction(ownSideType(lane)) }} <span>#{{ lane.index + 1 }}</span>
                } @else {
                  <span class="side you" [style.color]="laneAccent(ownSideType(lane))">{{ i18n.t('game.you') }}: {{ i18n.faction(ownSideType(lane)) }}</span>
                  <span class="vs">·</span>
                  <span class="side foe" [style.color]="laneAccent(enemySideType(lane))">{{ i18n.t('game.foe') }}: {{ i18n.faction(enemySideType(lane)) }}</span>
                  <span>#{{ lane.index + 1 }}</span>
                }
              </div>
              <div class="slot enemy">
                @if (side(lane, opponentId()).unit; as unit) {
                  <div class="chip-shell"><button class="unit" [attr.data-unit-uid]="unit.uid" [style.--chip-accent]="chipAccent(unit.cardId)" (click)="selectTarget(lane.index, $event)">
                    <img class="thumb" [src]="artFor(unit.cardId)" [alt]="cardName(unit.cardId)" loading="lazy" (error)="hideArt($event)" />
                    <span class="chip-body">
                    <b>{{ cardName(unit.cardId) }}</b><span>{{ i18n.attackLabel(unit.effectiveAtk) }} · {{ i18n.healthLabel(unit.health, unit.maxHealth) }}</span>
                    @if (unit.dot || unit.stun || unit.turnsSurvived === 0 || willAttack(unit)) {
                      <span class="badges">
                        @if (unit.dot) { <span class="dot-badge" [title]="i18n.t('game.poisoned')">☠ {{ unit.dot.turns }}</span> }
                        @if (unit.stun) { <span class="stun-badge" [title]="i18n.t('game.stunnedNext') + ' ' + unit.stun.turns">✦ {{ unit.stun.turns }}</span> }
                        @if (unit.turnsSurvived === 0) { <span class="stagger-badge" [title]="i18n.t('game.justArrivedEnemy')">💤</span> }
                        @if (willAttack(unit)) { <span class="attack-badge" [title]="i18n.t('game.attacksNow')">⚔</span> }
                      </span>
                    }
                    <span class="tip">
                      <span class="tip-name">{{ cardName(unit.cardId) }}</span>
                      <span class="tip-meta">{{ i18n.cardKind(getDef(unit.cardId).kind) }} · {{ i18n.faction(getDef(unit.cardId).faction) }} · {{ i18n.tier(getDef(unit.cardId).tier) }}</span>
                      <span class="tip-stats">{{ i18n.attackLabel(unit.effectiveAtk) }} · {{ i18n.healthLabel(unit.health, unit.maxHealth) }}</span>
                      @if (unit.effectiveAtk > unit.attack) { <span class="tip-bonus">+{{ unit.effectiveAtk - unit.attack }} {{ i18n.t('game.attackBonus') }}</span> }
                      @if (unit.dot) { <span class="tip-poison">{{ i18n.t('game.poison') }}: {{ unit.dot.amount }} {{ i18n.t('game.damageAtOwnerTurn') }}, {{ unit.dot.turns }}.</span> }
                      @if (unit.stun) { <span class="tip-stun">{{ i18n.t('game.stunned') }}: {{ i18n.t('game.skipsNextAttacks') }} {{ unit.stun.turns }}.</span> }
                      @if (unit.turnsSurvived === 0) { <span class="tip-stagger">{{ i18n.t('game.justArrivedEnemy') }}</span> }
                      <span class="tip-desc">{{ i18n.cardDescription(unit.cardId, getDef(unit.cardId).description) }}</span>
                    </span>
                    </span>
                  </button><button type="button" class="chip-inspect" [attr.aria-label]="i18n.t('game.cardDetails') + ': ' + cardName(unit.cardId)" [title]="i18n.t('game.cardDetails')" (click)="inspectDeployedCard(unit.cardId, $event)">ⓘ</button></div>
                } @else { <span class="empty">{{ i18n.t('game.enemyUnit') }}</span> }
                @if (side(lane, opponentId()).building; as building) {
                  <div class="chip-shell"><button class="building" [attr.data-building-uid]="building.uid" [style.--chip-accent]="chipAccent(building.cardId)" (click)="selectTarget(lane.index, $event)">
                    <img class="thumb" [src]="artFor(building.cardId)" [alt]="cardName(building.cardId)" loading="lazy" (error)="hideArt($event)" />
                    <span class="building-name">⌂ {{ cardName(building.cardId) }}</span>
                    <span class="tip">
                      <span class="tip-name">{{ cardName(building.cardId) }}</span>
                      <span class="tip-meta">{{ i18n.cardKind(getDef(building.cardId).kind) }} · {{ i18n.faction(getDef(building.cardId).faction) }} · {{ i18n.tier(getDef(building.cardId).tier) }}</span>
                      <span class="tip-desc">{{ i18n.cardDescription(building.cardId, getDef(building.cardId).description) }}</span>
                    </span>
                  </button><button type="button" class="chip-inspect" [attr.aria-label]="i18n.t('game.cardDetails') + ': ' + cardName(building.cardId)" [title]="i18n.t('game.cardDetails')" (click)="inspectDeployedCard(building.cardId, $event)">ⓘ</button></div>
                }
              </div>
              <div class="divider"></div>
              <div class="slot own">
                @if (side(lane, g.selfPlayerId).unit; as unit) {
                  <div class="chip-shell"><button class="unit" [attr.data-unit-uid]="unit.uid" [style.--chip-accent]="chipAccent(unit.cardId)" (click)="ownUnitClick(lane.index, $event)">
                    <img class="thumb" [src]="artFor(unit.cardId)" [alt]="cardName(unit.cardId)" loading="lazy" (error)="hideArt($event)" />
                    <span class="chip-body">
                    <b>{{ cardName(unit.cardId) }}</b><span>{{ i18n.attackLabel(unit.effectiveAtk) }} · {{ i18n.healthLabel(unit.health, unit.maxHealth) }}</span>
                    @if (unit.dot || unit.stun || unit.turnsSurvived === 0 || willAttack(unit)) {
                      <span class="badges">
                        @if (unit.dot) { <span class="dot-badge" [title]="i18n.t('game.poisoned')">☠ {{ unit.dot.turns }}</span> }
                        @if (unit.stun) { <span class="stun-badge" [title]="i18n.t('game.stunnedNext') + ' ' + unit.stun.turns">✦ {{ unit.stun.turns }}</span> }
                        @if (unit.turnsSurvived === 0) { <span class="stagger-badge" [title]="i18n.t('game.justArrivedYou')">💤</span> }
                        @if (willAttack(unit)) { <span class="attack-badge" [title]="i18n.t('game.attacksNow')">⚔</span> }
                      </span>
                    }
                    @if (specialLabel(unit.cardId); as label) {
                      <small [class.ready]="canActivateSpecial(unit)">{{ canActivateSpecial(unit) ? '⚡' : '◇' }} {{ label }} · {{ specialState(unit) }}</small>
                    }
                    <span class="tip">
                      <span class="tip-name">{{ cardName(unit.cardId) }}</span>
                      <span class="tip-meta">{{ i18n.cardKind(getDef(unit.cardId).kind) }} · {{ i18n.faction(getDef(unit.cardId).faction) }} · {{ i18n.tier(getDef(unit.cardId).tier) }}</span>
                      <span class="tip-stats">{{ i18n.attackLabel(unit.effectiveAtk) }} · {{ i18n.healthLabel(unit.health, unit.maxHealth) }}</span>
                      @if (unit.effectiveAtk > unit.attack) { <span class="tip-bonus">+{{ unit.effectiveAtk - unit.attack }} {{ i18n.t('game.attackBonus') }}</span> }
                      @if (unit.dot) { <span class="tip-poison">{{ i18n.t('game.poison') }}: {{ unit.dot.amount }} {{ i18n.t('game.damageAtOwnerTurn') }}, {{ unit.dot.turns }}.</span> }
                      @if (unit.stun) { <span class="tip-stun">{{ i18n.t('game.stunned') }}: {{ i18n.t('game.skipsNextAttacks') }} {{ unit.stun.turns }}.</span> }
                      @if (unit.turnsSurvived === 0) { <span class="tip-stagger">{{ i18n.t('game.justArrivedYou') }}</span> }
                      <span class="tip-desc">{{ i18n.cardDescription(unit.cardId, getDef(unit.cardId).description) }}</span>
                    </span>
                    </span>
                  </button><button type="button" class="chip-inspect" [attr.aria-label]="i18n.t('game.cardDetails') + ': ' + cardName(unit.cardId)" [title]="i18n.t('game.cardDetails')" (click)="inspectDeployedCard(unit.cardId, $event)">ⓘ</button></div>
                } @else { <span class="empty">{{ i18n.t('game.yourUnit') }}</span> }
                @if (side(lane, g.selfPlayerId).building; as building) {
                  <div class="chip-shell"><div class="building" tabindex="0" [attr.data-building-uid]="building.uid" [style.--chip-accent]="chipAccent(building.cardId)">
                    <img class="thumb" [src]="artFor(building.cardId)" [alt]="cardName(building.cardId)" loading="lazy" (error)="hideArt($event)" />
                    <span class="building-name">⌂ {{ cardName(building.cardId) }}</span>
                    <span class="tip">
                      <span class="tip-name">{{ cardName(building.cardId) }}</span>
                      <span class="tip-meta">{{ i18n.cardKind(getDef(building.cardId).kind) }} · {{ i18n.faction(getDef(building.cardId).faction) }} · {{ i18n.tier(getDef(building.cardId).tier) }}</span>
                      <span class="tip-desc">{{ i18n.cardDescription(building.cardId, getDef(building.cardId).description) }}</span>
                    </span>
                  </div><button type="button" class="chip-inspect" [attr.aria-label]="i18n.t('game.cardDetails') + ': ' + cardName(building.cardId)" [title]="i18n.t('game.cardDetails')" (click)="inspectDeployedCard(building.cardId, $event)">ⓘ</button></div>
                }
              </div>
            </article>
          }
        </section>

        <section class="self playerbar" [class.active]="client.isMyTurn()" [attr.data-player-bar]="g.selfPlayerId">
          <div class="identity"><b>{{ self().name }}</b><span>{{ self().connected ? i18n.t('game.online') : i18n.t('game.offline') }}</span></div>
          <div class="resource hp"><span>{{ i18n.t('game.hp') }}</span><strong>{{ self().hp }}</strong></div>
          <div class="resource mana"><span>{{ i18n.t('game.mana') }}</span><strong>{{ self().mana }}/{{ self().maxMana }}</strong></div>
          <div class="resource cards"><span>{{ i18n.t('game.hand') }} / {{ i18n.t('game.deck') }}</span><strong>{{ self().handCount }} / {{ self().deckCount }}</strong></div>
          @if (self().fatigue > 0) {
            <div class="fatigue" [title]="i18n.t('game.fatigueYou') + ' ' + self().fatigue + ' ' + i18n.t('game.fatigueTail')">☄ {{ i18n.t('game.fatigue') }} {{ self().fatigue }}</div>
          }
        </section>

        <section class="hand-zone">
          <div class="hand-head">
            <span>{{ i18n.t('game.yourHand') }}</span>
            <span>{{ playableCardCount() }} {{ i18n.t('game.playableNow') }}</span>
          </div>
          <div class="hand">
            @for (card of self().hand ?? []; track card.uid) {
              <qcw-card
                [card]="card"
                [selected]="selectedCard()?.uid === card.uid"
                [disabled]="!client.isMyTurn() || getDef(card.cardId).cost > self().mana"
                (picked)="pickCard($event)"
                (inspect)="openCardDetails($event.cardId)"
              />
            }
          </div>
        </section>

        <section class="footer-grid">
          <div class="hint" aria-live="polite">
            @if (selectedCard()) {
              <span class="hint-copy"><b>{{ cardName(selectedCard()!.cardId) }}</b> — {{ selectionHint() }}</span>
              <span class="hint-actions">
                @if (canQuickPlay()) { <button class="primary quick-play" (click)="playSelectedInstant()">{{ i18n.t('game.useCard') }}</button> }
                <button class="ghost small" (click)="cancelSelection()">{{ i18n.t('game.cancel') }}</button>
              </span>
            } @else if (selectedSpecialLane() !== null) {
              <span class="hint-copy">{{ i18n.t('game.chooseSpecialTarget') }}</span>
              <button class="ghost small" (click)="cancelSelection()">{{ i18n.t('game.cancel') }}</button>
            } @else {
              <span class="hint-copy">{{ client.isMyTurn() ? i18n.t('game.hintEmpty') : i18n.t('game.waitHint') }}</span>
            }
            @if (client.error()) { <div class="error">{{ client.error()!.message }}</div> }
          </div>
          <div class="log">
            <div class="log-head"><span>{{ i18n.t('game.log') }}</span><button class="ghost small" (click)="showFullLog.set(true)">{{ i18n.t('game.fullLog') }} ({{ g.log.length }})</button></div>
            @for (entry of g.log.slice(-6).reverse(); track entry.seq) {
              <div class="log-entry"><span>{{ localizedLogText(entry) }}</span>@for (cardId of entry.cardIds ?? []; track cardId) { <button type="button" class="log-card" (click)="openCardDetails(cardId)">{{ cardName(cardId) }}</button> }</div>
            }
          </div>
        </section>

        @if (inspectedCard(); as card) {
          <div class="card-detail-backdrop" (click)="closeCardDetails()">
            <section
              class="card-detail"
              role="dialog"
              aria-modal="true"
              [attr.aria-label]="i18n.t('game.cardDetails') + ': ' + i18n.cardName(card.id, card.name)"
              [style.--detail-accent]="laneAccent(card.faction)"
              (click)="$event.stopPropagation()"
            >
              <button class="detail-close" type="button" [attr.aria-label]="i18n.t('game.close')" (click)="closeCardDetails()">×</button>
              <div class="detail-art-frame">
                <img [src]="artFor(card.id)" [alt]="i18n.cardName(card.id, card.name)" (error)="hideArt($event)" />
                <span class="detail-cost">{{ card.cost }}</span>
              </div>
              <div class="detail-copy">
                <div class="eyebrow">{{ i18n.t('game.cardDetails') }}</div>
                <h2>{{ i18n.cardName(card.id, card.name) }}</h2>
                <div class="detail-tags">
                  <span>{{ i18n.cardKind(card.kind) }}</span><span>{{ i18n.faction(card.faction) }}</span><span>{{ i18n.tier(card.tier) }}</span>
                </div>
                @if (card.kind === 'unit') {
                  <div class="detail-stats"><span><b>{{ card.attack }}</b> {{ i18n.t('game.atk') }}</span><span><b>{{ card.health }}</b> {{ i18n.t('game.hpShort') }}</span></div>
                }
              <p class="detail-description">{{ i18n.cardDescription(card.id, card.description) }}</p>
                @if (card.kind === 'power') {
                  <div class="detail-rule"><b>{{ i18n.t('game.target') }}:</b> {{ targetLabel(card.target) }}</div>
                }
                @if (card.kind === 'building') {
                  <div class="detail-rule"><b>{{ i18n.t('game.passive') }}:</b> {{ passiveLabel(card.passive.type, card.passive.amount) }}</div>
                }
                @if (card.kind === 'unit' && card.onPlay) {
                  <div class="detail-rule"><b>{{ i18n.t('game.onPlay') }}:</b> {{ targetLabel(card.onPlay.target) }}</div>
                }
                @if (card.kind === 'unit' && card.swarm) {
                  <div class="detail-rule"><b>{{ i18n.t('game.swarm') }}:</b> +{{ card.swarm }} {{ i18n.t('game.atk') }} {{ i18n.t('game.perAlly') }}</div>
                }
                @if (card.kind === 'unit' && card.drawOnKill) {
                  <div class="detail-rule"><b>{{ i18n.t('game.onKill') }}:</b> {{ i18n.t('game.drawCards') }} {{ card.drawOnKill }}</div>
                }
                @if (card.kind === 'unit' && card.special; as special) {
                  <div class="detail-special">
                    <div><span>⚡ {{ i18n.t('game.special') }}</span><strong>{{ i18n.specialName(card.id, special.name) }}</strong></div>
                    <div class="detail-tags"><span>{{ special.cost }} {{ i18n.t('game.manaShort') }}</span><span>{{ special.uses }} {{ i18n.t('game.uses') }}</span><span>{{ targetLabel(special.target) }}</span></div>
                    <p>{{ i18n.specialDescription(card.id, special.description) }}</p>
                  </div>
                }
                <button class="primary detail-done" type="button" (click)="closeCardDetails()">{{ i18n.t('game.close') }}</button>
              </div>
            </section>
          </div>
        }

        @if (showFullLog()) {
          <div class="modal-backdrop" (click)="showFullLog.set(false)">
            <section class="modal log-modal" (click)="$event.stopPropagation()">
              <div class="eyebrow">{{ i18n.t('game.fullLogTitle') }}</div>
              <h2>{{ i18n.t('game.logTitle') }}</h2>
              <div class="full-log">
                @for (entry of g.log; track entry.seq) {
                  <div class="log-entry"><span><span class="seq">#{{ entry.seq }}</span> {{ localizedLogText(entry) }}</span>@for (cardId of entry.cardIds ?? []; track cardId) { <button type="button" class="log-card" (click)="openCardDetails(cardId)">{{ cardName(cardId) }}</button> }</div>
                }
                @empty { <div>{{ i18n.t('game.noEntries') }}</div> }
              </div>
              <div class="modal-actions">
                <button class="primary" (click)="showFullLog.set(false)">{{ i18n.t('game.close') }}</button>
              </div>
            </section>
          </div>
        }

        @if (g.status === 'finished') {
          <div class="modal-backdrop">
            <section class="modal">
              <div class="eyebrow">{{ i18n.t('game.matchComplete') }}</div>
              <h2>{{ g.winnerId === g.selfPlayerId ? i18n.t('game.victory') : i18n.t('game.defeat') }}</h2>
              <table class="stats">
                <thead>
                  <tr><th></th><th>{{ i18n.t('game.turns') }}</th><th>{{ i18n.t('game.cards') }}</th><th>{{ i18n.t('game.kills') }}</th><th>{{ i18n.t('game.dmg') }}</th></tr>
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
                <p>{{ i18n.t('game.soloNote') }}</p>
              } @else if (!opponent().connected) {
                <p>{{ i18n.t('game.leftNote') }}</p>
              } @else if (!rematchRequested()) {
                <p>{{ i18n.t('game.handshakeNote') }}</p>
              } @else {
                <p class="waiting">{{ isSolo() ? i18n.t('game.startingNote') : i18n.t('game.waitingNote') }}</p>
              }
              <div class="modal-actions">
                @if (opponent().connected && !rematchRequested()) {
                  <button class="primary" (click)="requestRematch()">{{ isSolo() ? i18n.t('game.rematchAi') : i18n.t('game.rematch') }}</button>
                }
                <button class="ghost" (click)="client.leaveRoom()">{{ i18n.t('game.returnLobby') }}</button>
              </div>
            </section>
          </div>
        }
      </main>
    }
  `,
  styles: [`
    .game-shell { height:100dvh; padding:12px; max-width:1500px; margin:0 auto; display:grid; grid-template-rows:auto auto minmax(270px,1fr) auto 258px minmax(82px,auto); gap:8px; overflow:hidden; }
    header { display:grid; grid-template-columns:1fr auto 1fr; align-items:center; gap:10px; background:linear-gradient(135deg,#151b26,#10141c); border:1px solid #2e3746; border-radius:15px; padding:9px 11px; box-shadow:0 10px 30px #0005; position:relative; overflow:hidden; }
    header::before{content:'';position:absolute;inset:0 auto 0 0;width:3px;background:#d7b76c;opacity:.45}header.my-turn::before{background:#76cf8b;opacity:1;box-shadow:0 0 18px #76cf8b}
    header>div:first-child { display:flex; align-items:center; gap:12px; min-width:0; } .ghost{background:transparent;color:#aeb6c5;border:0;} .room-code{display:flex;align-items:baseline;gap:6px;white-space:nowrap}.room-code span{font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:#707a8d}
    .end{justify-self:end;display:flex;align-items:center;gap:7px;background:linear-gradient(135deg,#e6c875,#cfa853);color:#111;border:0;border-radius:10px;padding:10px 16px;font-weight:900;box-shadow:0 6px 16px #0005, inset 0 1px #fff7}.end:not(:disabled):hover{filter:brightness(1.08);transform:translateY(-1px)}
    .turn{font-size:11px;letter-spacing:.14em;color:#e47a80;font-weight:900;padding:6px 10px;border:1px solid #573239;border-radius:999px;background:#201318;text-align:center}.turn.mine{color:#8de39e;border-color:#315b3b;background:#112017}.reconnected{color:#7ad78d;margin-right:8px;text-transform:lowercase;letter-spacing:.04em}
    .playerbar { display:flex; align-items:center; gap:9px; min-width:0; padding:7px 10px; background:linear-gradient(90deg,#111720,#10141b); border:1px solid #293241; border-radius:11px; font-size:12px; transition:border-color .18s,box-shadow .18s; }
    .playerbar.active{border-color:#315b3b;box-shadow:inset 3px 0 #76cf8b,0 0 20px #76cf8b12}.identity{margin-right:auto;display:flex;gap:7px;align-items:baseline;min-width:90px}.identity b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.identity>span{font-size:9px;color:#7ad78d;white-space:nowrap}
    .resource{display:flex;align-items:baseline;gap:5px;padding:2px 9px;border-left:1px solid #27303d;white-space:nowrap}.resource>span{font-size:9px;color:#778195;text-transform:uppercase;letter-spacing:.08em}.resource strong{font-size:16px}.resource.hp strong{color:#ff8c91}.resource.mana strong{color:#74c8ff}.resource.cards strong{color:#d9c486}
    .hero-targetable{cursor:crosshair;border-color:#d7b76c;box-shadow:0 0 0 2px #d7b76c35,0 0 24px #d7b76c20;animation:qcw-target-pulse 1.35s ease-in-out infinite}.hero-callout{font-size:10px;font-weight:900;color:#17130b;background:#d7b76c;padding:5px 9px;border-radius:999px;white-space:nowrap}
    .board { display:grid; grid-template-columns:repeat(4,minmax(170px,1fr)); gap:8px; min-height:0; }
    /* Faction identity (Phase A.1): --lane-accent/--lane-glow are set per lane from
       lane.type via [style.*] bindings; the gold targetable hover still wins. */
    .lane { background:radial-gradient(circle at 50% 45%,var(--lane-glow,transparent),transparent 58%),linear-gradient(#151b25,#0d1118); border:1px solid var(--lane-accent,#2d3441); border-color:color-mix(in srgb,var(--lane-accent,#2d3441) 68%,#2d3441); box-shadow:0 0 16px -5px var(--lane-glow,transparent),inset 0 1px #ffffff08; border-radius:13px; padding:8px; display:grid; grid-template-rows:auto minmax(0,1fr) 1px minmax(0,1fr); gap:6px; min-width:0; position:relative; transition:opacity .18s,border-color .18s,box-shadow .18s,transform .18s; }
    .lane.targetable{cursor:crosshair;border-color:#e4c674;box-shadow:0 0 0 2px #d7b76c35,0 0 24px #d7b76c26,inset 0 1px #fff2}.lane.targetable:hover{transform:translateY(-2px);box-shadow:0 0 0 2px #d7b76c66,0 10px 28px #0008}.lane.targetable::after{content:'+';position:absolute;right:8px;bottom:8px;width:22px;height:22px;display:grid;place-items:center;border-radius:50%;background:#d7b76c;color:#17130b;font-weight:900;box-shadow:0 4px 12px #0008}.lane.blocked{opacity:.48;filter:saturate(.7)}
    .lane-name{text-transform:uppercase;letter-spacing:.1em;font-size:10px;font-weight:900;color:var(--lane-accent,#d7b76c);display:flex;justify-content:space-between;align-items:center;gap:5px;min-height:24px}.lane-name span{color:#687183}.lane-name .vs{color:#687183}.lane-name .side{text-transform:uppercase;letter-spacing:.07em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .slot{display:grid;align-content:center;gap:5px;min-height:0;position:relative}.divider{background:linear-gradient(90deg,transparent,#465063,transparent);position:relative}.divider::after{content:'VS';position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);font-size:8px;line-height:14px;padding:0 5px;border-radius:999px;color:#646f82;background:#111720}.empty{display:grid;place-items:center;height:100%;min-height:54px;border:1px dashed #313b4b;border-radius:9px;color:#566176;font-size:9px;text-transform:uppercase;letter-spacing:.11em;background:#080b101f}
    /* --chip-accent is set per chip from getCard(cardId).faction; the inset shadow
       (not a wider border) tints the left edge with zero layout shift. */
    .unit,.building{width:100%;position:relative;border:1px solid #3c4554;background:linear-gradient(135deg,#222a37,#181e28);color:#fff;border-radius:10px;padding:8px;text-align:left;box-shadow:inset 3px 0 0 0 var(--chip-accent,transparent),0 6px 14px #0004}
    /* Horizontal chips: a fixed square art thumb on the left, text on the right.
       Fixed thumb sizes keep every chip uniform no matter the source file. */
    .unit{display:grid;grid-template-columns:66px minmax(0,1fr);gap:8px;align-items:center}
    .chip-body{display:grid;gap:4px;min-width:0}
    .chip-body>b{font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .chip-body>span,.chip-body>small{font-size:11px;color:#c1c7d2}
    .chip-body>small{color:#8f98a9;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.chip-body>small.ready{color:#f0ce70;font-weight:800;text-shadow:0 0 12px #d7b76c55}
    .building{display:grid;grid-template-columns:48px minmax(0,1fr);gap:7px;align-items:center;font-size:10px;background:linear-gradient(135deg,#292418,#1c1912);border-color:#50462e;color:#e7d49e}
    .building-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .chip-shell{position:relative;display:block;min-width:0;width:100%}.chip-inspect{position:absolute;right:6px;top:6px;z-index:6;width:24px;height:24px;padding:0;display:grid;place-items:center;border:1px solid #ffffff55;border-radius:50%;background:#0b1018dd;color:#fff;font-size:13px;font-weight:900;cursor:pointer;box-shadow:0 3px 8px #0008}.chip-inspect:hover{background:#e5c66f;color:#19150c}.chip-inspect:focus-visible{outline:2px solid #8bd2ff;outline-offset:2px}
    /* Board art: fixed square thumbs with a frame, served from /cards/<id>.png
       (same-faction stand-in while a card has no own art). A missing file hides
       the img via hideArt, leaving the text. */
    .thumb{display:block;width:66px;height:66px;object-fit:cover;border-radius:8px;background:#12161d;border:1px solid #2e3646}
    .building .thumb{width:48px;height:48px}
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
    /* M3 — badge row: poison (☠), stun (✦) and stagger (💤) share one
       absolutely positioned row at the chip's top-right so multiple badges
       never overlap each other or the name. :has() reserves name padding
       scaled to the badge count. */
    .badges{position:absolute;top:5px;right:5px;display:flex;gap:3px;pointer-events:none}
    .dot-badge{font-size:10px;line-height:1.4;font-weight:800;color:#7ad78d;background:#101a13;border:1px solid #2c5c3a;border-radius:6px;padding:0 4px}
    .stun-badge{font-size:10px;line-height:1.4;font-weight:800;color:#e8b44f;background:#20180a;border:1px solid #6e5426;border-radius:6px;padding:0 4px}
    .stagger-badge{font-size:10px;line-height:1.4;font-weight:800;color:#8fb7e8;background:#0f1620;border:1px solid #2d4a6b;border-radius:6px;padding:0 4px}
    .attack-badge{font-size:10px;line-height:1.4;font-weight:900;color:#ffcf72;background:#271b0b;border:1px solid #725122;border-radius:6px;padding:0 4px;box-shadow:0 0 10px #ffb84a35}
    .unit:has(.badges) .chip-body>b{padding-right:34px}
    .unit:has(.badges :nth-child(2)) .chip-body>b{padding-right:62px}
    .unit:has(.badges :nth-child(3)) .chip-body>b{padding-right:90px}
    .unit:has(.badges :nth-child(4)) .chip-body>b{padding-right:116px}
    .tip-poison{display:block;font-size:11px;font-weight:700;color:#7ad78d;margin-top:5px}
    .tip-bonus{display:block;font-size:11px;font-weight:700;color:#d7b76c;margin-top:2px}
    .tip-stun{display:block;font-size:11px;font-weight:700;color:#e8b44f;margin-top:5px}
    .tip-stagger{display:block;font-size:11px;font-weight:700;color:#8fb7e8;margin-top:5px}
    /* M3 — fatigue readout on the player bars (GA-3a finite decks). */
    .fatigue{color:#ff8a5c;font-weight:800;font-size:12px}
    .unit:hover .tip,.unit:focus .tip,.building:hover .tip,.building:focus .tip{display:block}
    @media(max-width:850px){.tip{left:6px;right:6px;width:auto;transform:none}.slot.enemy .tip{bottom:auto;top:calc(100% + 8px)}}
    .hand-zone{display:grid;grid-template-rows:auto minmax(0,1fr);min-height:0;border:1px solid #252e3b;border-radius:13px;background:linear-gradient(#10151d,#0d1117);overflow:hidden}.hand-head{display:flex;justify-content:space-between;align-items:center;padding:7px 10px 5px;color:#d7b76c;text-transform:uppercase;font-size:9px;letter-spacing:.12em;font-weight:900}.hand-head span:last-child{color:#778195;letter-spacing:.04em;text-transform:none}
    .hand { display:flex; gap:8px; overflow-x:auto; overflow-y:hidden; padding:3px 8px 9px; min-height:0; align-items:stretch; scroll-snap-type:x proximity; scrollbar-gutter:stable; }
    .footer-grid{display:grid;grid-template-columns:minmax(280px,.8fr) minmax(0,1.2fr);gap:8px;min-height:0}.hint,.log{background:linear-gradient(135deg,#121823,#0f141c);border:1px solid #293241;border-radius:11px;padding:9px 11px;font-size:11px;color:#aeb6c5;min-height:0;overflow:auto}.hint{display:flex;align-items:center;justify-content:space-between;gap:10px;border-left:3px solid #d7b76c}.hint-copy{line-height:1.4}.hint-actions{display:flex;align-items:center;gap:6px;flex:0 0 auto}.quick-play{padding:6px 10px!important;font-size:10px}.log{display:grid;gap:3px;align-content:start}.log>div:not(.log-head){min-height:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.error{margin-top:5px;color:#ff9da5}
    .log-head{display:flex;align-items:center;justify-content:space-between;gap:8px;color:#d7b76c;text-transform:uppercase;letter-spacing:.1em;font-size:10px;font-weight:800}.log-entry{display:flex;align-items:center;gap:5px;min-width:0}.log-entry>span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.log-card{flex:0 0 auto;padding:2px 6px;border:1px solid #5d5133;border-radius:5px;background:#241f12;color:#e7d49e;font-size:10px;cursor:pointer}.log-card:hover,.log-card:focus-visible{background:#d7b76c;color:#17130b;outline:none}
    .ghost.small{background:transparent;color:#aeb6c5;border:1px solid #3e4655;padding:4px 10px;border-radius:7px;font-size:11px}
    /* Full-log modal: the list scrolls inside the modal, never the page. */
    .log-modal{min-width:min(560px,92vw);text-align:left}
    .full-log{display:grid;gap:4px;max-height:min(60vh,480px);overflow-y:auto;font-size:12px;color:#c1c7d2;margin-top:10px}
    .full-log .seq{color:#687183;margin-right:6px}
    .modal-backdrop{position:fixed;inset:0;background:#000b;display:grid;place-items:center;padding:20px}.modal{background:#151a23;border:1px solid #3b4352;border-radius:18px;padding:28px;max-width:440px;text-align:center}.modal h2{font-size:48px;margin:4px}.modal p{color:#aeb6c5;line-height:1.5}.modal button{background:#d7b76c;border:0;padding:11px 18px;border-radius:9px;font-weight:800}.eyebrow{text-transform:uppercase;letter-spacing:.15em;color:#d7b76c;font-size:10px}
    .card-detail-backdrop{position:fixed;inset:0;z-index:120;background:#05070be8;display:grid;place-items:center;padding:18px;backdrop-filter:blur(8px)}
    .card-detail{width:min(760px,96vw);max-height:min(680px,94dvh);display:grid;grid-template-columns:280px minmax(0,1fr);overflow:hidden;position:relative;background:linear-gradient(145deg,#1a2230,#0e131b);border:1px solid var(--detail-accent,#d7b76c);border-radius:20px;box-shadow:0 30px 90px #000d;box-shadow:0 30px 90px #000d,0 0 40px color-mix(in srgb,var(--detail-accent,#d7b76c) 20%,transparent)}
    .detail-close{position:absolute;right:12px;top:12px;z-index:3;width:34px;height:34px;display:grid;place-items:center;padding:0;border:1px solid #ffffff35;border-radius:50%;background:#090d14d9;color:#fff;font-size:23px;line-height:1}.detail-close:hover{background:#d7b76c;color:#111}
    .detail-art-frame{position:relative;min-height:390px;background:#0a0d12;overflow:hidden;border-right:1px solid #303a49}.detail-art-frame::after{content:'';position:absolute;inset:0;box-shadow:inset 0 0 45px #0008;pointer-events:none}.detail-art-frame img{width:100%;height:100%;display:block;object-fit:cover}.detail-cost{position:absolute;left:14px;top:14px;width:44px;height:44px;display:grid;place-items:center;border-radius:50%;background:var(--detail-accent,#d7b76c);color:#10141b;font-size:20px;font-weight:950;box-shadow:0 5px 18px #000b,inset 0 1px #fff8}
    .detail-copy{padding:30px;overflow-y:auto}.detail-copy h2{font-size:clamp(28px,4vw,42px);line-height:1.05;margin:5px 42px 10px 0;letter-spacing:-.035em}.detail-tags{display:flex;flex-wrap:wrap;gap:6px}.detail-tags span{padding:4px 8px;border:1px solid #3a4658;border-radius:999px;color:#aeb8c9;background:#0b1017;font-size:10px;text-transform:capitalize}.detail-stats{display:flex;gap:10px;margin:18px 0 4px}.detail-stats span{min-width:92px;padding:10px 14px;border-radius:10px;background:#0c1118;border:1px solid #303a49;color:#9ca7ba}.detail-stats b{font-size:25px;color:#fff;margin-right:4px}.detail-description{font-size:15px;line-height:1.6;color:#e0e4eb;margin:18px 0}.detail-rule{font-size:12px;line-height:1.5;color:#bdc5d2;padding:8px 0;border-top:1px solid #293241}.detail-rule b{color:var(--detail-accent,#d7b76c)}
    .detail-special{margin-top:14px;padding:14px;border:1px solid #685d48;border-color:color-mix(in srgb,var(--detail-accent,#d7b76c) 48%,#303a49);border-radius:13px;background:#0b1018}.detail-special>div:first-child{display:grid;gap:3px}.detail-special>div:first-child span{font-size:9px;text-transform:uppercase;letter-spacing:.12em;color:var(--detail-accent,#d7b76c)}.detail-special strong{font-size:17px}.detail-special .detail-tags{margin-top:9px}.detail-special p{margin:10px 0 0;color:#c7ced9;font-size:12px;line-height:1.5}.detail-done{margin-top:18px;width:100%}
    @keyframes qcw-target-pulse{0%,100%{box-shadow:0 0 0 2px #d7b76c22,0 0 18px #d7b76c10}50%{box-shadow:0 0 0 3px #d7b76c55,0 0 28px #d7b76c28}}
    @media(max-width:850px){
      .game-shell{padding:7px;height:100dvh;grid-template-rows:auto auto minmax(190px,1fr) auto minmax(180px,26dvh) minmax(105px,17dvh);gap:6px}
      header{grid-template-columns:minmax(0,1fr) auto;padding:7px 8px}.turn{grid-column:1/-1;grid-row:2;padding:4px 8px;font-size:9px}.header-right{grid-column:2;grid-row:1}.room-code{display:grid;gap:0}.room-code span{display:none}.end{padding:9px 11px;font-size:12px;max-width:112px;line-height:1.1}.end span{display:none}.ghost.lang{padding:6px 8px!important}.sound{padding:7px!important}
      .playerbar{gap:4px;padding:6px 8px;overflow:hidden}.identity{min-width:0}.identity>span{display:none}.resource{padding:1px 5px}.resource>span{font-size:8px}.resource strong{font-size:14px}.resource.cards{display:flex}.resource.cards>span{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}.resource.cards::before{content:'▱';color:#d9c486;font-size:11px}.hero-callout{font-size:8px;padding:4px 6px}
      .board{overflow-x:auto;overflow-y:hidden;overscroll-behavior:contain;grid-template-columns:repeat(4,178px);min-height:0;scroll-snap-type:x mandatory;scrollbar-width:thin}.lane{scroll-snap-align:start;padding:6px;gap:4px;grid-template-rows:21px minmax(0,1fr) 1px minmax(0,1fr)}.lane-name{min-height:21px;font-size:9px}.lane.blocked{opacity:.55}.lane.targetable::after{right:5px;bottom:5px;width:19px;height:19px}
      .slot{min-height:0}.empty{min-height:38px;font-size:8px}.unit{grid-template-columns:42px minmax(0,1fr);gap:6px;padding:5px}.thumb{width:42px;height:42px}.building{grid-template-columns:34px minmax(0,1fr);padding:4px}.building .thumb{width:34px;height:34px}.chip-body{gap:2px}.chip-body>b{font-size:10px}.chip-body>span,.chip-body>small{font-size:9px}.tip{display:none!important}.badges{top:3px;right:3px;gap:2px}.badges>span{font-size:8px;padding:0 3px}.unit:has(.badges) .chip-body>b{padding-right:25px}.unit:has(.badges :nth-child(2)) .chip-body>b{padding-right:46px}.unit:has(.badges :nth-child(3)) .chip-body>b{padding-right:67px}.unit:has(.badges :nth-child(4)) .chip-body>b{padding-right:88px}
      .hand-zone{border-radius:11px}.hand-head{padding:5px 8px 3px}.hand{padding:2px 7px 6px;gap:7px;scroll-snap-type:x mandatory}.footer-grid{grid-template-columns:1fr;grid-template-rows:auto minmax(0,1fr);gap:5px}.hint,.log{padding:7px 9px;max-height:none}.hint{font-size:10px}.log{font-size:10px}.log-head{position:sticky;top:-7px;background:#111720;padding:3px 0}.modal{padding:20px;max-width:94vw}.modal h2{font-size:38px}
      .card-detail-backdrop{padding:8px}.card-detail{width:100%;max-height:96dvh;grid-template-columns:1fr;grid-template-rows:220px minmax(0,1fr);border-radius:16px}.detail-art-frame{min-height:0;border-right:0;border-bottom:1px solid #303a49}.detail-art-frame img{object-position:center 24%}.detail-copy{padding:18px}.detail-copy h2{font-size:28px}.detail-description{font-size:14px;margin:14px 0}.detail-stats{margin:13px 0 3px}.detail-stats span{padding:8px 11px}.detail-close{right:9px;top:9px}
    }
    @media(min-width:851px) and (max-height:820px){.game-shell{grid-template-rows:auto auto minmax(230px,1fr) auto 222px 76px}.unit{grid-template-columns:54px minmax(0,1fr)}.thumb{width:54px;height:54px}.building{grid-template-columns:40px minmax(0,1fr)}.building .thumb{width:40px;height:40px}}
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
    .ghost.lang{background:transparent;color:#d7b76c;border:1px solid #3e4655;padding:6px 10px;border-radius:8px;font-weight:800;font-size:12px}
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
    @media (prefers-reduced-motion: reduce){.pop,.hit,.lane-hit,.pulse,.hero-targetable{animation:none !important}}
  `],
})
export class GameComponent {
  readonly client = inject(GameClientService);
  readonly i18n = inject(I18nService);
  readonly sound = inject(SoundService);
  private readonly el = inject(ElementRef);
  readonly selectedCard = signal<HandCard | null>(null);
  readonly selectedSpecialLane = signal<number | null>(null);
  readonly inspectedCard = signal<CardDefinition | null>(null);
  readonly rematchRequested = signal(false);
  /** Full match-log modal (footer "Full log" button). Local UI state only. */
  readonly showFullLog = signal(false);
  readonly game = this.client.game;
  readonly self = computed(() => this.game()!.players[this.game()!.selfPlayerId]);
  readonly opponentId = computed<PlayerId>(() => {
    const g = this.game()!;
    return g.playerOrder[0] === g.selfPlayerId ? g.playerOrder[1] : g.playerOrder[0];
  });
  readonly opponent = computed(() => this.game()!.players[this.opponentId()]);
  /** Phase D D-1 — solo match: the opponent seat is the server-side AI (auto-rematches). */
  readonly isSolo = computed(() => this.game()?.solo === true);
  readonly selectedDefinition = computed<CardDefinition | null>(() => {
    const card = this.selectedCard();
    return card ? getCard(card.cardId) : null;
  });
  readonly playableCardCount = computed(() => {
    const game = this.game();
    const self = game?.players[game.selfPlayerId];
    if (!game || !self || !this.client.isMyTurn()) return 0;
    return (self.hand ?? []).filter((card) => {
      const def = getCard(card.cardId);
      if (def.cost > self.mana) return false;
      if (def.kind === 'power' && (def.target === 'none' || def.target === 'enemy-hero')) return true;
      return game.lanes.some((lane) => this.isDefinitionTargetable(def, lane));
    }).length;
  });

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
  cardName(cardId: string) {
    const def = getCard(cardId);
    return this.i18n.cardName(cardId, def.name);
  }
  /** This viewer's OWN side type of a lane (frame accent + name). */
  ownSideType(lane: ClientLaneState) { return lane.sideTypes[this.game()!.selfPlayerId]; }
  /** The opponent's side type of a lane (shown when the sides differ). */
  enemySideType(lane: ClientLaneState) { return lane.sideTypes[this.opponentId()]; }
  /** Board/hand art URL for a catalog card (stand-in while art is missing). */
  artFor(cardId: string) { return cardArtUrl(cardId); }
  /** Hide a board thumb whose file is missing (text fallback remains). */
  hideArt(event: Event) { hideBrokenArt(event); }
  /** Faction accent for a lane frame, from the lane's fixed type. */
  laneAccent(faction: Faction) { return FACTION_THEME[faction].accent; }
  laneGlow(faction: Faction) { return FACTION_THEME[faction].glow; }
  /** Faction accent for a board chip, from its card definition ('universal' cards keep the universal tint). */
  chipAccent(cardId: string) { return FACTION_THEME[getCard(cardId).faction].accent; }
  specialLabel(cardId: string) {
    const card = getCard(cardId);
    return card.kind === 'unit' && card.special ? this.i18n.specialName(cardId, card.special.name) : null;
  }
  side(lane: ClientLaneState, playerId: PlayerId) { return lane.sides[playerId]; }

  openCardDetails(cardId: string): void {
    this.showFullLog.set(false);
    this.inspectedCard.set(getCard(cardId));
  }

  /** Explicitly inspect a deployed card without entering target/special mode. */
  inspectDeployedCard(cardId: string, event: Event): void {
    event.stopPropagation();
    this.openCardDetails(cardId);
  }

  /** Translate only identities explicitly attached to a log entry. */
  localizedLogText(entry: GameLogEntry): string {
    if (!this.i18n.isRu() || !entry.cardIds?.length) return entry.text;
    let text = entry.text;
    for (const cardId of [...new Set(entry.cardIds)]) {
      const def = getCard(cardId);
      text = text.split(def.name).join(this.i18n.cardName(cardId, def.name));
      if (def.kind === 'unit' && def.special) {
        text = text.split(def.special.name).join(this.i18n.specialName(cardId, def.special.name));
      }
    }
    return text;
  }

  closeCardDetails(): void {
    this.inspectedCard.set(null);
  }

  @HostListener('document:keydown.escape')
  closeCardDetailsOnEscape(): void {
    if (this.inspectedCard()) this.closeCardDetails();
  }

  targetLabel(target: string): string {
    const labels: Record<string, [string, string]> = {
      self: ['self', 'на себя'],
      'friendly-unit': ['friendly unit', 'союзный юнит'],
      'enemy-unit': ['enemy unit', 'вражеский юнит'],
      'enemy-hero': ['enemy hero', 'герой соперника'],
      'enemy-building': ['enemy building', 'вражеское здание'],
      lane: ['lane', 'линия'],
      none: ['no target', 'без цели'],
    };
    const pair = labels[target] ?? [target, target];
    return this.i18n.isRu() ? pair[1] : pair[0];
  }

  passiveLabel(type: string, amount: number): string {
    if (type === 'heal-own-lane-unit-at-turn-start') {
      return this.i18n.isRu() ? `лечит юнита на этой линии на ${amount} в начале хода` : `heal this lane's unit by ${amount} at turn start`;
    }
    return this.i18n.isRu() ? `+${amount} к атаке юнита на этой линии` : `+${amount} attack to this lane's unit`;
  }

  hasTargetSelection(): boolean {
    return Boolean(this.selectedCard()) || this.selectedSpecialLane() !== null;
  }

  private isDefinitionTargetable(def: CardDefinition, lane: ClientLaneState): boolean {
    const game = this.game();
    if (!game) return false;
    const own = lane.sides[game.selfPlayerId];
    const enemy = lane.sides[this.opponentId()];
    const factionFits = def.faction === 'universal' || def.faction === this.ownSideType(lane);
    if (def.kind === 'unit') {
      return factionFits && !own.unit && (def.onPlay?.target !== 'enemy-unit' || Boolean(enemy.unit));
    }
    if (def.kind === 'building') return factionFits && !own.building;
    switch (def.target) {
      case 'enemy-unit': return Boolean(enemy.unit);
      case 'friendly-unit': return Boolean(own.unit);
      case 'enemy-building': return Boolean(enemy.building);
      case 'lane': return true;
      case 'enemy-hero':
      case 'none': return false;
    }
  }

  isLaneTargetable(lane: ClientLaneState): boolean {
    if (!this.client.isMyTurn()) return false;
    const selected = this.selectedDefinition();
    if (selected) return this.isDefinitionTargetable(selected, lane);
    const sourceLane = this.selectedSpecialLane();
    if (sourceLane === null) return false;
    const game = this.game()!;
    const source = game.lanes[sourceLane].sides[game.selfPlayerId].unit;
    if (!source) return false;
    const def = getCard(source.cardId);
    if (def.kind !== 'unit' || !def.special) return false;
    if (def.special.target === 'enemy-unit') return Boolean(lane.sides[this.opponentId()].unit);
    if (def.special.target === 'friendly-unit') return Boolean(lane.sides[game.selfPlayerId].unit);
    return false;
  }

  isHeroTargetable(): boolean {
    const def = this.selectedDefinition();
    return Boolean(this.client.isMyTurn() && def?.kind === 'power' && def.target === 'enemy-hero');
  }

  canQuickPlay(): boolean {
    const def = this.selectedDefinition();
    return Boolean(def?.kind === 'power' && def.target === 'none');
  }

  selectionHint(): string {
    const def = this.selectedDefinition();
    if (!def) return '';
    if (def.kind === 'unit') return this.i18n.t('game.chooseLane');
    if (def.kind === 'building') return this.i18n.t('game.chooseBuildingLane');
    switch (def.target) {
      case 'enemy-hero': return this.i18n.t('game.chooseHero');
      case 'enemy-unit': return this.i18n.t('game.chooseEnemyUnit');
      case 'friendly-unit': return this.i18n.t('game.chooseFriendlyUnit');
      case 'enemy-building': return this.i18n.t('game.chooseEnemyBuilding');
      case 'lane': return this.i18n.t('game.chooseEffectLane');
      case 'none': return this.i18n.t('game.noTargetNeeded');
    }
  }

  willAttack(unit: ClientUnitView): boolean {
    const game = this.game();
    return Boolean(game?.status === 'playing' && game.activePlayerId === unit.ownerId && unit.turnsSurvived > 0 && !unit.stun);
  }

  canActivateSpecial(unit: ClientUnitView): boolean {
    const game = this.game();
    const def = getCard(unit.cardId);
    return Boolean(
      game && this.client.isMyTurn() && def.kind === 'unit' && def.special &&
      unit.turnsSurvived > 0 && unit.specialUsesRemaining > 0 &&
      game.players[game.selfPlayerId].mana >= def.special.cost && this.specialHasTarget(def.special.target)
    );
  }

  private specialHasTarget(target: 'self' | 'friendly-unit' | 'enemy-unit' | 'enemy-hero' | 'none'): boolean {
    const game = this.game();
    if (!game) return false;
    if (target === 'enemy-unit') return game.lanes.some((lane) => Boolean(lane.sides[this.opponentId()].unit));
    if (target === 'friendly-unit') return game.lanes.some((lane) => Boolean(lane.sides[game.selfPlayerId].unit));
    return true;
  }

  specialState(unit: ClientUnitView): string {
    const def = getCard(unit.cardId);
    if (def.kind !== 'unit' || !def.special) return '';
    if (unit.specialUsesRemaining <= 0) return this.i18n.t('game.specialSpent');
    if (unit.turnsSurvived < 1) return this.i18n.t('game.specialSleeping');
    if (this.self().mana < def.special.cost) return `${def.special.cost} ${this.i18n.t('game.manaShort')}`;
    if (!this.specialHasTarget(def.special.target)) return this.i18n.t('game.specialNoTarget');
    return `${this.i18n.t('game.specialReady')} · ${def.special.cost}`;
  }

  pickCard(card: HandCard) {
    this.client.clearError();
    this.selectedSpecialLane.set(null);
    this.selectedCard.update((selected) => (selected?.uid === card.uid ? null : card));
  }

  laneClick(laneIndex: number) {
    const selected = this.selectedCard();
    const game = this.game();
    if (!selected || !game || !this.client.isMyTurn()) return;
    const lane = game.lanes[laneIndex];
    if (!lane || !this.isLaneTargetable(lane)) return;
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

  opponentHeroClick() {
    if (!this.isHeroTargetable()) return;
    this.sendSelectedPower(0);
  }

  playSelectedInstant() {
    if (!this.canQuickPlay()) return;
    this.sendSelectedPower(0);
  }

  private sendSelectedPower(laneIndex: number) {
    const selected = this.selectedCard();
    const game = this.game();
    if (!selected || !game || !this.client.isMyTurn()) return;
    this.client.sendAction({
      type: 'play-card',
      expectedRevision: game.revision,
      handCardUid: selected.uid,
      laneIndex,
      targetLaneIndex: laneIndex,
    });
    this.selectedCard.set(null);
  }

  cancelSelection() {
    this.selectedCard.set(null);
    this.selectedSpecialLane.set(null);
    this.client.clearError();
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
    if (!this.canActivateSpecial(unit)) return;
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
