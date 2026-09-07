import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { GameGateway } from './game/game.gateway';
import { GameService } from './game/game.service';

@Module({
  controllers: [AppController],
  providers: [GameService, GameGateway],
})
export class AppModule {}
