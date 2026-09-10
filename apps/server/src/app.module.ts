import { Module } from '@nestjs/common';
import { AiService } from './game/ai.service';
import { AppController } from './app.controller';
import { GameGateway } from './game/game.gateway';
import { GameService } from './game/game.service';

@Module({
  controllers: [AppController],
  providers: [GameService, AiService, GameGateway],
})
export class AppModule {}
