import { Component, inject } from '@angular/core';
import { GameClientService } from './game-client.service';
import { GameComponent } from './game.component';
import { LobbyComponent } from './lobby.component';

@Component({
  selector: 'qcw-root',
  standalone: true,
  imports: [LobbyComponent, GameComponent],
  template: `
    @if (client.game()) {
      <qcw-game />
    } @else if (client.restoring()) {
      <div class="restoring">
        <div>Restoring session…</div>
        <button type="button" class="cancel" (click)="client.cancelRestore()">Go to lobby</button>
      </div>
    } @else {
      <qcw-lobby />
    }
  `,
  styles: [
    `.restoring {
      display: grid;
      place-items: center;
      gap: 0.75rem;
      min-height: 40vh;
      font-size: 1.2rem;
      opacity: 0.7;
    }
    .restoring button.cancel {
      font-size: 0.85rem;
      padding: 0.4rem 0.9rem;
      cursor: pointer;
    }`,
  ],
})
export class AppComponent {
  readonly client = inject(GameClientService);
}
