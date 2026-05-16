import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToOne,
  JoinColumn,
} from 'typeorm';
import { Message } from './message.entity';

@Entity('music_results')
export class MusicResult {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'message_id' })
  message_id: string;

  @OneToOne(() => Message, (message) => message.music_result, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'message_id' })
  message: Message;

  // Thay đổi 1: Lưu label cao nhất (Top 1) để filter nhanh
  @Column({ nullable: true })
  label: string; // Ví dụ: "RAP"

  // Thay đổi 2: Lưu điểm tin cậy của Top 1
  @Column({ type: 'float', nullable: true })
  score: number; // Ví dụ: 90.5

  // Thay đổi 3: Lưu toàn bộ dict(results) Top 3 vào đây
  // Kiểu Record<string, number> sẽ giúp TypeScript hiểu đây là { "KEY": VALUE }
  @Column({ type: 'json', nullable: true })
  top_three: Record<string, number>;

  // Giữ lại nếu sau này bạn dùng thêm model nhận diện bài hát/ca sĩ
  @Column({ nullable: true })
  song_name: string;

  @Column({ nullable: true })
  artist: string;
}
