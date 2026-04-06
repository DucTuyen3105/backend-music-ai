import {
  Body,
  Controller, FileTypeValidator,
  MaxFileSizeValidator,
  Param,
  ParseFilePipe,
  Post, Query,
  UploadedFile,
  UseInterceptors
} from '@nestjs/common';
import { ChatService } from './chat.service';
import {CreateConversationDTO} from "../DTO/chat.dto";
import {FileInterceptor} from "@nestjs/platform-express";

@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}
  @Post("/create-conversation")
  public async createConversation(@Body() requestBody:CreateConversationDTO):Promise<any>
  {
    return this.chatService.createConversation(requestBody);
  }
  @Post('/message/:conversationId/upload')
  @UseInterceptors(FileInterceptor('file'))
  async uploadMessageFromUser(
      @UploadedFile(
          new ParseFilePipe({
            validators: [
              new MaxFileSizeValidator({ maxSize: 10485760, message: 'File không được quá 5MB' }),
            ],
          }),
      )
      file: Express.Multer.File,@Param('conversationId') conversationId:string,
      @Query("start-time") startTime:Date, @Query("end-time") endTime:Date
  ): Promise<any> {
    const result = await this.chatService.uploadMessageFromUser(file, conversationId,startTime,endTime);
  }
}