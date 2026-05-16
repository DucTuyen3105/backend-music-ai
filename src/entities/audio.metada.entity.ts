import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToOne,
  JoinColumn,
} from 'typeorm';
import { Message } from './message.entity';

@Entity('audio_metadata')
export class AudioMetadata {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  file_path: string;

  @Column({ nullable: true })
  cut_file_path: string;

  @Column({ type: 'float', default: 0.0 })
  start_time: number;

  @Column({ type: 'float', nullable: true })
  end_time: number;

  @Column({ nullable: true })
  original_name: string;

  @Column({ nullable: true })
  mime_type: string;

  @Column({ type: 'int', default: 0 })
  size_bytes: number;

  @Column({ type: 'float', default: 0.0 })
  original_duration_seconds: number;

  @Column({ nullable: true })
  original_duration_text: string;

  @Column({ type: 'float', nullable: true })
  clip_duration_seconds: number;

  @OneToOne(() => Message, (message) => message.audio_metadata, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'message_id' })
  message: Message;
}
