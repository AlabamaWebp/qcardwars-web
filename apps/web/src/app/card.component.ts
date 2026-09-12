import { Component, computed, inject, input, output, signal } from '@angular/core';
import { getCard, HandCard } from '@qcw/game-core';
import { cardArtUrl } from './card-art';
import { FACTION_THEME } from './faction-theme';
import { I18nService } from './i18n.service';

@Component({
  selector: 'qcw-card',
  standalone: true,
  template: `
    <div class="card-wrap" [style.--faction-accent]="accent()">
      <button class="card" [class.selected]="selected()" [disabled]="disabled()" [attr.aria-pressed]="selected()" [title]="def().description" (click)="picked.emit(card())">
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
      <button
        type="button"
        class="inspect"
        [attr.aria-label]="i18n.t('game.cardDetails') + ': ' + def().name"
        [title]="i18n.t('game.cardDetails')"
        (click)="inspect.emit(card())"
      >ⓘ</button>
    </div>
  `,
  styles: [`
    /* The host is the flex item of .hand: stretch it so every card in a row
       shares the row height, then fill it with the button. */
    :host { display:block; height:100%; flex:0 0 auto; scroll-snap-align:start; }
    .card-wrap{width:154px;height:100%;position:relative}
    .card { width:100%; height:100%; min-height:0; text-align:left; padding:9px; border-radius:13px; border:1px solid #3b4354; background:linear-gradient(155deg,#252d3a,#151a23); color:#fff; position:relative; overflow:hidden; box-shadow:0 7px 18px #0006; transition:transform .16s,border-color .16s,box-shadow .16s,filter .16s; }
    /* Faction identity (Phase A.1): tinted top band + cost badge. The band is a
       pseudo-element so the gold hover/selected box-shadows below always win. */
    .card::before { content:''; position:absolute; top:0; left:0; right:0; height:4px; background: var(--faction-accent, #6b7488); border-radius: 14px 14px 0 0; }
    .card:hover:not(:disabled), .card.selected { transform:translateY(-2px); border-color:#e4c674; }
    .card.selected { box-shadow:0 0 0 2px #d7b76c88,0 0 24px #d7b76c24,0 8px 20px #0008; }
    .card:focus-visible{outline:2px solid #8bd2ff;outline-offset:-3px}.card:disabled{filter:saturate(.55);opacity:.48}.card:disabled .art{filter:brightness(.62)}
    .cost { position:absolute; top:7px; right:7px; width:29px; height:29px; display:grid; place-items:center; border-radius:50%; background:var(--faction-accent,#4f77d1); color:#10141b; font-weight:900; z-index:2; box-shadow:0 3px 10px #0009,inset 0 1px #fff7; }
    /* Card art is the hero of the card: one uniform PORTRAIT frame for every
       card (the generated art is portrait-oriented; a landscape frame cropped
       it into postage stamps). aspect-ratio keeps all cards the same size no
       matter the source file; a missing file hides the img and the tinted
       frame stays as placeholder. The name sits on a gradient scrim so the
       art stays full-bleed. */
    .art-frame { position:relative; display:block; width:100%; height:128px; overflow:hidden; border-radius:9px; margin:1px 0 7px; background:linear-gradient(135deg,#232c3d 0%,#12161e 70%); border:1px solid #2e3646; }
    .art { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; display:block; }
    .art.hidden { display:none; }
    .art-name { position:absolute; left:0; right:0; bottom:0; padding:18px 8px 7px; font-weight:900; font-size:12px; line-height:1.15; color:#fff; text-shadow:0 1px 5px #000,0 0 2px #000; background:linear-gradient(transparent,#000d 72%); text-align:left; }
    .kind { text-transform:uppercase; font-size:8px; letter-spacing:.14em; color:#aab2c2; margin-bottom:3px; }
    small { display:block; color:var(--faction-accent,#9ea7b7); margin-top:2px; text-transform:capitalize; font-size:9px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    p { font-size:10px; color:#cbd0da; line-height:1.3; margin:5px 0 0; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
    .stats { display:flex; justify-content:space-between; gap:8px; margin-top:6px; font-size:10px; font-weight:800; }
    .inspect{position:absolute;top:40px;right:7px;z-index:3;width:29px;height:29px;display:grid;place-items:center;padding:0;border:1px solid #ffffff44;border-radius:50%;background:#0b1018dd;color:#fff;font-size:15px;font-weight:900;box-shadow:0 4px 12px #0009;backdrop-filter:blur(5px)}
    .inspect:hover{color:#19150c;background:#e5c66f;border-color:#e5c66f;transform:scale(1.06)}.inspect:focus-visible{outline:2px solid #8bd2ff;outline-offset:2px}
    @media(max-width:850px){.card{padding:8px}.art-frame{height:116px}.art-name{font-size:11px}.stats{margin-top:5px}p{-webkit-line-clamp:1}.inspect{top:38px}}
  `],
})
export class CardComponent {
  readonly i18n = inject(I18nService);
  readonly card = input.required<HandCard>();
  readonly selected = input(false);
  readonly disabled = input(false);
  readonly picked = output<HandCard>();
  readonly inspect = output<HandCard>();
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
