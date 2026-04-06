import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    ManyToOne,
    OneToMany,
    JoinColumn // Thêm cái này
} from 'typeorm';
import { User } from './user.entity';
import { Message } from './message.entity';

@Entity('conversations')
export class Conversation {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ default: 'Cuộc hội thoại mới' })
    title: string;

    @ManyToOne(() => User, (user) => user.conversations, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'user_id' }) // Xác định tên cột trong database là user_id
    user: User;

    @OneToMany(() => Message, (message) => message.conversation)
    messages: Message[];

    @CreateDateColumn()
    created_at: Date;

    @UpdateDateColumn()
    updated_at: Date;
}