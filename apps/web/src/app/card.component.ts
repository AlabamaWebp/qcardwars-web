import { Component, computed, input, output, signal } from '@angular/core';
import { getCard, HandCard } from '@qcw/game-core';
import { cardArtUrl } from './card-art';
import { FACTION_THEME } from './faction-theme';

@Component({
  selector: 'qcw-card',
  standalone: true,
  template: `
    <button class="card" [class.selected]="selected()" [style.--faction-accent]="accent()" [disabled]="disabled()" (click)="picked.emit(card())">
      <span class="cost">{{ def().cost }}</span>
      <span class="art-frame">
        <img class="art" [src]="art()" alt="" loading="lazy" (error)="artFailed.set(true)" [class.hidden]="artFailed()" />
        <span class="art-name">{{ def().name }}</span>
      </span>
      <div class="kind">{{ def().kind }}</div>
      <small>{{ def().faction }} · tier {{ def().tier }}</small>
      @if (def().kind === 'unit') {
        <div class="stats"><span>ATK {{ unitAtk }}</span><span>HP {{ unitHp }}</span></div>
      }
      <p>{{ def().description }}</p>
    </button>
  `,
  styles: [`
    /* The host is the flex item of .hand: stretch it so every card in a row
       shares the row height, then fill it with the button. */
    :host { display:block; height:100%; }
    .card { width: 160px; height:100%; min-height: 205px; text-align: left; padding: 12px; border-radius: 14px; border: 1px solid #3b4354; background: linear-gradient(155deg,#242a36,#161a22); color: #fff; position: relative; box-shadow: 0 8px 20px #0006; }
    /* Faction identity (Phase A.1): tinted top band + cost badge. The band is a
       pseudo-element so the gold hover/selected box-shadows below always win. */
    .card::before { content:''; position:absolute; top:0; left:0; right:0; height:4px; background: var(--faction-accent, #6b7488); border-radius: 14px 14px 0 0; }
    .card:hover:not(:disabled), .card.selected { transform: translateY(-4px); border-color: #d7b76c; }
    .card.selected { box-shadow: 0 0 0 2px #d7b76c66, 0 8px 20px #0008; }
    .cost { position:absolute; top:8px; right:8px; width:30px; height:30px; display:grid; place-items:center; border-radius:50%; background: var(--faction-accent, #4f77d1); color:#10141b; font-weight:800; z-index:1; }
    /* Card art is the hero of the card: one uniform PORTRAIT frame for every
       card (the generated art is portrait-oriented; a landscape frame cropped
       it into postage stamps). aspect-ratio keeps all cards the same size no
       matter the source file; a missing file hides the img and the tinted
       frame stays as placeholder. The name sits on a gradient scrim so the
       art stays full-bleed. */
    .art-frame { position:relative; display:block; width:100%; aspect-ratio:4/5; overflow:hidden; border-radius:10px; margin:2px 0 10px; background:linear-gradient(135deg,#232c3d 0%,#12161e 70%); border:1px solid #2e3646; }
    .art { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; display:block; }
    .art.hidden { display:none; }
    .art-name { position:absolute; left:0; right:0; bottom:0; padding:20px 9px 8px; font-weight:800; font-size:13px; line-height:1.2; color:#fff; text-shadow:0 1px 5px #000, 0 0 2px #000; background:linear-gradient(transparent, #000c 75%); text-align:left; }
    .kind { text-transform:uppercase; font-size:10px; letter-spacing:.12em; color:#aab2c2; margin-bottom:6px; }
    small { display:block; color: var(--faction-accent, #9ea7b7); margin-top:4px; text-transform:capitalize; }
    p { font-size:12px; color:#cbd0da; line-height:1.35; margin:8px 0 0; }
    .stats { display:flex; justify-content:space-between; gap:8px; margin-top:12px; font-size:12px; font-weight:700; }
  `],
})
export class CardComponent {
  readonly card = input.required<HandCard>();
  readonly selected = input(false);
  readonly disabled = input(false);
  readonly picked = output<HandCard>();
  readonly def = () => getCard(this.card().cardId);
  readonly accent = computed(() => FACTION_THEME[this.def().faction].accent);
  /** Hides the art img when the file is missing (CSS text fallback remains). */
  readonly artFailed = signal(false);
  readonly art = computed(() => cardArtUrl(this.card().cardId));
  get unitAtk(): number {
    const def = this.def();
    return def.kind === 'unit' ? def.attack : 0;
  }
  get unitHp(): number {
    const def = this.def();
    return def.kind === 'unit' ? def.health : 0;
  }
}
