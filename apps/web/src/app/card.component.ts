import { Component, input, output } from '@angular/core';
import { getCard, HandCard } from '@qcw/game-core';

@Component({
  selector: 'qcw-card',
  standalone: true,
  template: `
    <button class="card" [class.selected]="selected()" [disabled]="disabled()" (click)="picked.emit(card())">
      <span class="cost">{{ def().cost }}</span>
      <div class="kind">{{ def().kind }}</div>
      <strong>{{ def().name }}</strong>
      <small>{{ def().faction }} · tier {{ def().tier }}</small>
      @if (def().kind === 'unit') {
        <div class="stats"><span>ATK {{ unitAtk }}</span><span>HP {{ unitHp }}</span></div>
      }
      <p>{{ def().description }}</p>
    </button>
  `,
  styles: [`
    .card { width: 150px; min-height: 205px; text-align: left; padding: 12px; border-radius: 14px; border: 1px solid #3b4354; background: linear-gradient(155deg,#242a36,#161a22); color: #fff; position: relative; box-shadow: 0 8px 20px #0006; }
    .card:hover:not(:disabled), .card.selected { transform: translateY(-4px); border-color: #d7b76c; }
    .card.selected { box-shadow: 0 0 0 2px #d7b76c66, 0 8px 20px #0008; }
    .cost { position:absolute; top:8px; right:8px; width:30px; height:30px; display:grid; place-items:center; border-radius:50%; background:#4f77d1; font-weight:800; }
    .kind { text-transform:uppercase; font-size:10px; letter-spacing:.12em; color:#aab2c2; margin-bottom:8px; }
    strong { display:block; padding-right:26px; }
    small { display:block; color:#9ea7b7; margin-top:6px; text-transform:capitalize; }
    p { font-size:12px; color:#cbd0da; line-height:1.35; margin:10px 0 0; }
    .stats { display:flex; justify-content:space-between; gap:8px; margin-top:12px; font-size:12px; font-weight:700; }
  `],
})
export class CardComponent {
  readonly card = input.required<HandCard>();
  readonly selected = input(false);
  readonly disabled = input(false);
  readonly picked = output<HandCard>();
  readonly def = () => getCard(this.card().cardId);
  get unitAtk(): number {
    const def = this.def();
    return def.kind === 'unit' ? def.attack : 0;
  }
  get unitHp(): number {
    const def = this.def();
    return def.kind === 'unit' ? def.health : 0;
  }
}
