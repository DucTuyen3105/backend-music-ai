import { Entity, PrimaryGeneratedColumn, Column, OneToOne, JoinColumn } from 'typeorm';
import { Message } from './message.entity';

@Entity('audio_metadata')
export class AudioMetadata {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column()
    file_path: string;

    @Column({ type: 'float', default: 0.0 })
    start_time: number;

    @Column({ type: 'float', nullable: true })
    end_time: number;

    @Column({ nullable: true })
    original_name: string;

    @OneToOne(() => Message, (message) => message.audio_metadata)
    @JoinColumn({name : "message_id"})
    message: Message;
}