import { Module } from '@nestjs/common';
import { ChatService } from './chat.service';
import { ChatController } from './chat.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../entities/user.entity';
import { Conversation } from '../entities/conversation.entity';
import { Message } from '../entities/message.entity';
import { AudioMetadata } from '../entities/audio.metada.entity';
import { MusicResult } from '../entities/music.result.entity';
import { AuthModule } from '../auth/auth.module';
import { ModelModule } from '../model/model.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      Conversation,
      Message,
      AudioMetadata,
      MusicResult,
    ]),
    AuthModule,
    ModelModule,
  ],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
