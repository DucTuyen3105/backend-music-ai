import {Column, CreateDateColumn, Index, JoinColumn, ManyToOne, OneToOne, PrimaryGeneratedColumn} from "typeorm";
import {Conversation} from "../entities/conversation.entity";
import {MessageRole, MessageStatus} from "../utils/Enum";
import {AudioMetadata} from "../entities/audio.metada.entity";
import {MusicResult} from "../entities/music.result.entity";

export class CreateConversationDTO{
    user_id:string;
    title:string;
}
export class CreateMessageDTO{
    conversation_id:string
    @Column({ type: 'text', nullable: true })
    content: string;
    @Column({ type: 'enum', enum: MessageStatus, default: MessageStatus.PENDING })
    status: MessageStatus;
    @Index()
    @CreateDateColumn({ type: 'timestamp', precision: 3 })
    created_at: Date;
    @OneToOne(() => AudioMetadata, (audio) => audio.message, { cascade: true })
    audio_metadata: AudioMetadata;
    @OneToOne(() => MusicResult, (result) => result.message, { cascade: true })
    music_result: MusicResult;
}