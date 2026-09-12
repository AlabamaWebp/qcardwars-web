import { Component, inject } from '@angular/core';
import { GameClientService } from './game-client.service';
import { GameComponent } from './game.component';
import { I18nService } from './i18n.service';
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
        <div>{{ i18n.t('app.restoring') }}</div>
        <button type="button" class="cancel" (click)="client.cancelRestore()">{{ i18n.t('app.goLobby') }}</button>
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
  readonly i18n = inject(I18nService);
}
