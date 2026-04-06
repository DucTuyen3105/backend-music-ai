import { Module } from '@nestjs/common';
import { ChatService } from './chat.service';
import { ChatController } from './chat.controller';
import {TypeOrmModule} from "@nestjs/typeorm";
import {User} from "../entities/user.entity";
import {Conversation} from "../entities/conversation.entity";

@Module({
  imports: [
    TypeOrmModule.forFeature([User,Conversation]),
  ],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
