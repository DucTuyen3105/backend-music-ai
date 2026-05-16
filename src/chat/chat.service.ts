import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStaticPath from 'ffmpeg-static';
import * as fs from 'node:fs';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import * as mm from 'music-metadata';
import { Repository } from 'typeorm';
import { AnalyzeAudioDTO, CreateConversationDTO } from '../DTO/chat.dto';
import { AudioMetadata } from '../entities/audio.metada.entity';
import { Conversation } from '../entities/conversation.entity';
import { Message } from '../entities/message.entity';
import { MusicResult } from '../entities/music.result.entity';
import { User } from '../entities/user.entity';
import { MessageRole, MessageStatus } from '../utils/Enum';
import { ModelService } from '../model/model.service';

const ALLOWED_AUDIO_EXTENSIONS = new Set([
  '.mp3',
  '.wav',
  '.flac',
  '.m4a',
  '.aac',
  '.ogg',
  '.oga',
  '.webm',
]);

const ALLOWED_AUDIO_MIME_PREFIXES = ['audio/'];
const ALLOWED_AUDIO_MIME_TYPES = new Set([
  'application/ogg',
  'video/webm',
  'video/mp4',
]);

@Injectable()
export class ChatService {
  private readonly uploadRoot = path.join(process.cwd(), 'uploads', 'music');
  private readonly originalDir = path.join(this.uploadRoot, 'originals');
  private readonly clipDir = path.join(this.uploadRoot, 'clips');
  private readonly maxAudioFileSize = Number(
    process.env.MAX_AUDIO_FILE_BYTES ?? 50 * 1024 * 1024,
  );
  private readonly maxAudioDurationSeconds = Number(
    process.env.MAX_AUDIO_DURATION_SECONDS ?? 10 * 60,
  );
  private readonly maxAnalysisDurationSeconds = Number(
    process.env.MAX_ANALYSIS_SECONDS ?? 30,
  );

  constructor(
    @InjectRepository(Conversation)
    private readonly conversationRepository: Repository<Conversation>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Message)
    private readonly messageRepository: Repository<Message>,
    @InjectRepository(AudioMetadata)
    private readonly audioMetadataRepository: Repository<AudioMetadata>,
    @InjectRepository(MusicResult)
    private readonly musicResultRepository: Repository<MusicResult>,
    private readonly modelService: ModelService,
  ) {
    const configuredFfmpegPath = process.env.FFMPEG_PATH || ffmpegStaticPath;
    if (configuredFfmpegPath) {
      ffmpeg.setFfmpegPath(configuredFfmpegPath);
    }
    if (process.env.FFPROBE_PATH) {
      ffmpeg.setFfprobePath(process.env.FFPROBE_PATH);
    }
    fs.mkdirSync(this.originalDir, { recursive: true });
    fs.mkdirSync(this.clipDir, { recursive: true });
  }

  public async createConversation(
    userId: string,
    requestBody: CreateConversationDTO,
  ): Promise<any> {
    const user = await this.userRepository.findOneBy({ id: userId });
    if (!user) {
      throw new BadRequestException('User does not exist');
    }

    const conversation = this.conversationRepository.create({
      title: requestBody.title?.trim() || 'Cuộc hội thoại mới',
      user,
    });
    const savedConversation =
      await this.conversationRepository.save(conversation);
    return this.toPublicConversation(savedConversation);
  }

  public async listConversations(userId: string): Promise<any> {
    const conversations = await this.conversationRepository.find({
      where: { user: { id: userId } },
      relations: { messages: true },
      order: { updated_at: 'DESC' },
    });

    return conversations.map((conversation) => ({
      ...this.toPublicConversation(conversation),
      message_count: conversation.messages?.length ?? 0,
    }));
  }

  public async getConversation(
    userId: string,
    conversationId: string,
  ): Promise<any> {
    const conversation = await this.findOwnedConversation(
      userId,
      conversationId,
    );
    const messages = await this.messageRepository.find({
      where: { conversation: { id: conversation.id } },
      relations: {
        audio_metadata: true,
        music_result: true,
      },
      order: { created_at: 'ASC' },
    });

    return {
      ...this.toPublicConversation(conversation),
      messages: messages.map((message) => this.toPublicMessage(message)),
    };
  }

  public async deleteConversation(
    userId: string,
    conversationId: string,
  ): Promise<any> {
    const conversation = await this.findOwnedConversation(userId, conversationId);
    await this.conversationRepository.delete({ id: conversation.id });
    return { deleted: true, id: conversation.id };
  }

  public async uploadAudio(
    userId: string,
    conversationId: string,
    file: Express.Multer.File,
  ): Promise<any> {
    const conversation = await this.findOwnedConversation(
      userId,
      conversationId,
    );
    const validation = await this.validateAudioFile(file);
    const extension = path.extname(file.originalname).toLowerCase();
    const fileName = `${randomUUID()}${extension}`;
    const absolutePath = path.join(this.originalDir, fileName);
    const relativePath = this.toRelativeUploadPath(absolutePath);

    await mkdir(this.originalDir, { recursive: true });
    await writeFile(absolutePath, file.buffer);

    const message = await this.messageRepository.save(
      this.messageRepository.create({
        conversation,
        role: MessageRole.USER,
        content: `Uploaded ${file.originalname}`,
        status: MessageStatus.PENDING,
      }),
    );

    const audioMetadata = await this.audioMetadataRepository.save(
      this.audioMetadataRepository.create({
        message,
        file_path: relativePath,
        original_name: path.basename(file.originalname),
        mime_type: file.mimetype,
        size_bytes: file.size,
        original_duration_seconds: validation.durationSeconds,
        original_duration_text: this.formatDuration(validation.durationSeconds),
      }),
    );

    await this.touchConversation(conversation.id);

    return this.toPublicMessage({
      ...message,
      audio_metadata: audioMetadata,
    } as Message);
  }

  public async analyzeAudio(
    userId: string,
    messageId: string,
    requestBody: AnalyzeAudioDTO,
  ): Promise<any> {
    const message = await this.findOwnedMessage(userId, messageId);
    if (!message.audio_metadata) {
      throw new BadRequestException('Message has no audio file');
    }

    const startTime = Number(requestBody.start_time);
    const endTime = Number(requestBody.end_time);
    this.validateAnalysisRange(
      startTime,
      endTime,
      message.audio_metadata.original_duration_seconds,
    );

    const duration = endTime - startTime;
    const inputPath = this.fromRelativeUploadPath(
      message.audio_metadata.file_path,
    );
    if (!fs.existsSync(inputPath)) {
      throw new NotFoundException('Uploaded audio file not found');
    }

    const extension =
      path.extname(message.audio_metadata.original_name || inputPath) || '.mp3';
    const clipFileName = `${randomUUID()}${extension.toLowerCase()}`;
    const clipPath = path.join(this.clipDir, clipFileName);
    const relativeClipPath = this.toRelativeUploadPath(clipPath);

    await mkdir(this.clipDir, { recursive: true });
    await this.removeIfExists(clipPath);

    message.status = MessageStatus.PROCESSING;
    await this.messageRepository.update(message.id, {
      status: MessageStatus.PROCESSING,
    });

    try {
      await this.cutAudio(inputPath, clipPath, startTime, duration);
      message.audio_metadata.start_time = startTime;
      message.audio_metadata.end_time = endTime;
      message.audio_metadata.clip_duration_seconds = duration;
      message.audio_metadata.cut_file_path = relativeClipPath;
      await this.audioMetadataRepository.save(message.audio_metadata);

      const prediction = await this.modelService.predict(clipPath);
      const result = await this.saveMusicResult(message, prediction);

      message.status = MessageStatus.COMPLETED;
      message.content = `Predicted ${prediction.label}`;
      await this.messageRepository.update(message.id, {
        status: MessageStatus.COMPLETED,
        content: message.content,
      });
      await this.touchConversation(message.conversation.id);

      return this.toPublicMessage({
        ...message,
        audio_metadata: message.audio_metadata,
        music_result: result,
      } as Message);
    } catch (error) {
      message.status = MessageStatus.FAILED;
      message.content = error instanceof Error ? error.message : String(error);
      await this.messageRepository.update(message.id, {
        status: MessageStatus.FAILED,
        content: message.content,
      });
      throw error;
    }
  }

  private async saveMusicResult(
    message: Message,
    prediction: {
      label: string;
      score: number;
      top_three: Record<string, number>;
    },
  ): Promise<MusicResult> {
    if (!message.id) {
      throw new BadRequestException('Message id is required');
    }

    const payload = {
      message_id: message.id,
      label: prediction.label,
      score: prediction.score,
      top_three: prediction.top_three,
    };
    const existing = await this.musicResultRepository.findOne({
      where: { message_id: message.id },
    });

    if (existing) {
      await this.musicResultRepository.update(existing.id, payload);
      return this.musicResultRepository.findOneByOrFail({ id: existing.id });
    }

    return this.musicResultRepository.save(
      this.musicResultRepository.create(payload),
    );
  }

  private async findOwnedConversation(
    userId: string,
    conversationId: string,
  ): Promise<Conversation> {
    const conversation = await this.conversationRepository.findOne({
      where: { id: conversationId, user: { id: userId } },
      relations: { user: true },
    });
    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }
    return conversation;
  }

  private async findOwnedMessage(
    userId: string,
    messageId: string,
  ): Promise<Message> {
    const message = await this.messageRepository.findOne({
      where: {
        id: messageId,
        conversation: { user: { id: userId } },
      },
      relations: {
        conversation: { user: true },
        audio_metadata: true,
        music_result: true,
      },
    });
    if (!message) {
      throw new ForbiddenException('Message not found in your conversations');
    }
    return message;
  }

  private async validateAudioFile(file: Express.Multer.File): Promise<{
    durationSeconds: number;
  }> {
    if (!file) {
      throw new BadRequestException('No audio file uploaded');
    }
    if (!file.buffer?.length) {
      throw new BadRequestException('Uploaded file is empty');
    }
    if (file.size > this.maxAudioFileSize) {
      throw new BadRequestException(
        `Audio file is too large. Max ${this.maxAudioFileSize} bytes`,
      );
    }

    const extension = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_AUDIO_EXTENSIONS.has(extension)) {
      throw new BadRequestException('Unsupported audio file extension');
    }

    const mimeType = file.mimetype || '';
    const mimeAllowed =
      ALLOWED_AUDIO_MIME_PREFIXES.some((prefix) =>
        mimeType.startsWith(prefix),
      ) || ALLOWED_AUDIO_MIME_TYPES.has(mimeType);
    if (!mimeAllowed) {
      throw new BadRequestException('Unsupported audio MIME type');
    }

    try {
      const metadata = await mm.parseBuffer(file.buffer);
      const duration = metadata.format.duration ?? 0;
      if (!Number.isFinite(duration) || duration <= 0) {
        throw new BadRequestException('Cannot detect audio duration');
      }
      if (duration > this.maxAudioDurationSeconds) {
        throw new BadRequestException(
          `File âm thanh không được dài quá ${Math.floor(this.maxAudioDurationSeconds / 60)} phút`,
        );
      }

      return { durationSeconds: Number(duration.toFixed(3)) };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new BadRequestException(
        `Invalid or corrupted audio file: ${message}`,
      );
    }
  }

  private validateAnalysisRange(
    startTime: number,
    endTime: number,
    originalDuration: number,
  ) {
    if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) {
      throw new BadRequestException('Start time and end time must be numbers');
    }
    if (startTime < 0 || endTime <= 0) {
      throw new BadRequestException('Audio time range is invalid');
    }
    if (endTime <= startTime) {
      throw new BadRequestException('End time must be greater than start time');
    }
    if (startTime >= originalDuration || endTime > originalDuration) {
      throw new BadRequestException('Selected range exceeds audio duration');
    }
  }

  private cutAudio(
    inputPath: string,
    outputPath: string,
    startTime: number,
    duration: number,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .setStartTime(startTime)
        .setDuration(duration)
        .outputOptions(['-vn'])
        .on('end', () => resolve())
        .on('error', (error) => reject(error))
        .save(outputPath);
    });
  }

  private toPublicConversation(conversation: Conversation) {
    return {
      id: conversation.id,
      title: conversation.title,
      created_at: conversation.created_at,
      updated_at: conversation.updated_at,
    };
  }

  private toPublicMessage(message: Message) {
    const audio = message.audio_metadata;
    const result = message.music_result;
    return {
      id: message.id,
      role: message.role,
      content: message.content,
      status: message.status,
      created_at: message.created_at,
      audio: audio
        ? {
            original_name: audio.original_name,
            original_url: this.toPublicUrl(audio.file_path),
            cut_url: audio.cut_file_path
              ? this.toPublicUrl(audio.cut_file_path)
              : null,
            mime_type: audio.mime_type,
            size_bytes: audio.size_bytes,
            start_time: audio.start_time,
            end_time: audio.end_time,
            original_duration_seconds: audio.original_duration_seconds,
            original_duration_minutes: this.toMinutes(
              audio.original_duration_seconds,
            ),
            original_duration_text: audio.original_duration_text,
            clip_duration_seconds: audio.clip_duration_seconds,
            clip_duration_minutes: audio.clip_duration_seconds
              ? this.toMinutes(audio.clip_duration_seconds)
              : null,
          }
        : null,
      prediction: result
        ? {
            label: result.label,
            score: result.score,
            top_three: result.top_three,
            song_name: result.song_name,
            artist: result.artist,
          }
        : null,
    };
  }

  private toRelativeUploadPath(absolutePath: string): string {
    return path.relative(process.cwd(), absolutePath).replace(/\\/g, '/');
  }

  private fromRelativeUploadPath(relativePath: string): string {
    return path.join(process.cwd(), ...relativePath.split('/'));
  }

  private toPublicUrl(relativePath: string): string {
    return `/${relativePath.replace(/\\/g, '/')}`;
  }

  private toMinutes(seconds: number): number {
    return Number((seconds / 60).toFixed(2));
  }

  private formatDuration(totalSeconds: number): string {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = Math.round(totalSeconds % 60);
    return `${minutes}m ${seconds}s (${Number(totalSeconds.toFixed(2))}s)`;
  }

  private async touchConversation(conversationId: string) {
    await this.conversationRepository.update(conversationId, {
      updated_at: new Date(),
    });
  }

  private async removeIfExists(filePath: string) {
    try {
      await unlink(filePath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        throw error;
      }
    }
  }
}
