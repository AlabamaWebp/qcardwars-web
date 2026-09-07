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
    } @else {
      <qcw-lobby />
    }
  `,
})
export class AppComponent {
  readonly client = inject(GameClientService);
}
