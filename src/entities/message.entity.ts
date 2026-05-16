import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  OneToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Conversation } from './conversation.entity';
import { AudioMetadata } from './audio.metada.entity';
import { MusicResult } from './music.result.entity';
import { MessageRole, MessageStatus } from '../utils/Enum';

@Entity('messages')
export class Message {
  @PrimaryGeneratedColumn('uuid')
  id: string;
  @Index()
  @ManyToOne(() => Conversation, (conv) => conv.messages, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'conversation_id' })
  conversation: Conversation;
  @Column({ type: 'enum', enum: MessageRole })
  role: MessageRole;
  @Column({ type: 'text', nullable: true })
  content: string;
  @Column({ type: 'enum', enum: MessageStatus, default: MessageStatus.PENDING })
  status: MessageStatus;
  @Index()
  @CreateDateColumn()
  created_at: Date;
  @OneToOne(() => AudioMetadata, (audio) => audio.message, { cascade: true })
  audio_metadata: AudioMetadata;
  @OneToOne(() => MusicResult, (result) => result.message, { cascade: true })
  music_result: MusicResult;
}
