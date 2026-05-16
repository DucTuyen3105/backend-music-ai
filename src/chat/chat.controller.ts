import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AnalyzeAudioDTO, CreateConversationDTO } from '../DTO/chat.dto';
import type { AuthenticatedRequest } from '../auth/jwt.strategy';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ChatService } from './chat.service';

const MAX_AUDIO_FILE_SIZE = 50 * 1024 * 1024;

@UseGuards(JwtAuthGuard)
@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post('/conversations')
  public async createConversation(
    @Req() request: AuthenticatedRequest,
    @Body() requestBody: CreateConversationDTO,
  ): Promise<any> {
    return this.chatService.createConversation(
      request.user.userId,
      requestBody,
    );
  }

  @Get('/conversations')
  public async listConversations(
    @Req() request: AuthenticatedRequest,
  ): Promise<any> {
    return this.chatService.listConversations(request.user.userId);
  }

  @Get('/conversations/:conversationId')
  public async getConversation(
    @Req() request: AuthenticatedRequest,
    @Param('conversationId') conversationId: string,
  ): Promise<any> {
    return this.chatService.getConversation(
      request.user.userId,
      conversationId,
    );
  }

  @Delete('/conversations/:conversationId')
  public async deleteConversation(
    @Req() request: AuthenticatedRequest,
    @Param('conversationId') conversationId: string,
  ): Promise<any> {
    return this.chatService.deleteConversation(
      request.user.userId,
      conversationId,
    );
  }

  @Post('/conversations/:conversationId/audio')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_AUDIO_FILE_SIZE },
    }),
  )
  async uploadAudio(
    @Req() request: AuthenticatedRequest,
    @UploadedFile() file: Express.Multer.File,
    @Param('conversationId') conversationId: string,
  ): Promise<any> {
    return this.chatService.uploadAudio(
      request.user.userId,
      conversationId,
      file,
    );
  }

  @Post('/messages/:messageId/analyze')
  async analyzeAudio(
    @Req() request: AuthenticatedRequest,
    @Param('messageId') messageId: string,
    @Body() requestBody: AnalyzeAudioDTO,
  ): Promise<any> {
    return this.chatService.analyzeAudio(
      request.user.userId,
      messageId,
      requestBody,
    );
  }
}
