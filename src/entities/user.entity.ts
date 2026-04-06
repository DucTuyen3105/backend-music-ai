import {Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, OneToMany, UpdateDateColumn} from 'typeorm';
import {Conversation} from "./conversation.entity";


@Entity('users')
export class User {
    @PrimaryGeneratedColumn('uuid')
    id: string;
    @Column({ unique: true })
    username: string;
    @Column({ unique: true })
    email: string;
    @Column()
    password_hash: string;
    @CreateDateColumn()
    created_at: Date;
    @UpdateDateColumn()
    updated_at: Date;
    @OneToMany(() => Conversation, (conversation) => conversation.user)
    conversations: Conversation[];
}