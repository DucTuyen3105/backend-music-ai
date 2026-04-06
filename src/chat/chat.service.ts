import {BadRequestException, Injectable} from '@nestjs/common';
import {InjectRepository} from "@nestjs/typeorm";
import {User} from "../entities/user.entity";
import {Repository} from "typeorm";
import {Conversation} from "../entities/conversation.entity";
import {CreateConversationDTO} from "../DTO/chat.dto";
import * as mm from 'music-metadata';
import * as fs from 'fs';
import * as path from 'path';
import ffmpeg from 'fluent-ffmpeg';
@Injectable()
export class ChatService {
    private readonly UPLOAD_DIR = path.join(process.cwd(), 'uploads/music');
    constructor(@InjectRepository(Conversation)
                private readonly conversationRepository: Repository<Conversation>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>) {
        if (!fs.existsSync(this.UPLOAD_DIR)) {
            fs.mkdirSync(this.UPLOAD_DIR, { recursive: true });
        }
    }
    public async createConversation(requestBody:CreateConversationDTO):Promise<any>{
        const checkUser = await this.userRepository.findOneBy({id : requestBody.user_id})
        if(!checkUser) {
            throw new BadRequestException('User does not exist')
        }
        const conversation = this.conversationRepository.create({
            ...requestBody,
            user: checkUser,
        });
        const savedConversation = await this.conversationRepository.save(conversation);
        return {
            id: savedConversation.id,
            title: savedConversation.title,
            createdAt: savedConversation.created_at,
            updatedAt: savedConversation.updated_at,
            user_id: checkUser.id,
        };
    }
    public async uploadMessageFromUser(
        file: Express.Multer.File,
        conversationId: string,
        startTime: Date, // Nhận dạng Date từ Controller
        endTime: Date
    ): Promise<any> {

        // 1. Tính toán thời gian (Giây)
        const startInSeconds = new Date(startTime).getTime() / 1000;
        const endInSeconds = new Date(endTime).getTime() / 1000;
        const duration = endInSeconds - startInSeconds;

        if (duration <= 0) {
            throw new BadRequestException('Thời gian kết thúc phải lớn hơn thời gian bắt đầu');
        }

        // 2. Trích xuất Metadata gốc
        const metadata = await mm.parseBuffer(file.buffer);
        const originalDuration = metadata.format.duration || 0;

        if (startInSeconds > originalDuration) {
            throw new BadRequestException('Thời gian bắt đầu vượt quá độ dài file gốc');
        }

        // 3. Thiết lập đường dẫn file
        const fileName = `cut-${Date.now()}-${file.originalname}`;
        const tempInputPath = path.join(this.UPLOAD_DIR, `temp-${fileName}`);
        const finalOutputPath = path.join(this.UPLOAD_DIR, fileName);

        try {
            // Ghi file gốc ra bộ nhớ tạm để FFmpeg xử lý
            fs.writeFileSync(tempInputPath, file.buffer);

            // 4. Xử lý cắt bằng FFmpeg
            await new Promise((resolve, reject) => {
                ffmpeg(tempInputPath)
                    .setStartTime(startInSeconds)
                    .setDuration(duration)
                    .outputOptions([
                        '-metadata', `title=${metadata.common.title || 'AI Music'} (Cut)`,
                        '-metadata', `artist=${metadata.common.artist || 'LLMO System'}`
                    ])
                    .on('end', resolve)
                    .on('error', (err) => reject(new Error(`FFmpeg error: ${err.message}`)))
                    .save(finalOutputPath);
            });

            // 5. Xóa file tạm sau khi cắt xong
            if (fs.existsSync(tempInputPath)) fs.unlinkSync(tempInputPath);

            // 6. Giả sử bạn lưu vào DB (Entity Message/Conversation)
            // Ở đây tôi trả về thông tin để bạn dùng lưu vào Entity của mình
            return {
                audio_url: `uploads/music/${fileName}`,
                duration: duration,
                metadata: {
                    title: metadata.common.title,
                    artist: metadata.common.artist,
                    bitrate: metadata.format.bitrate,
                    sampleRate: metadata.format.sampleRate
                }
            };

        } catch (error) {
            if (fs.existsSync(tempInputPath)) fs.unlinkSync(tempInputPath);
            throw new BadRequestException(`Lỗi xử lý âm thanh: ${error.message}`);
        }
    }

    private async validateAudioFile(file: Express.Multer.File) {
        if (!file) {
            throw new BadRequestException('No file uploaded.');
        }

        try {
            let metadata;

            // Logic to handle both Memory Storage and Disk Storage
            if (file.buffer) {
                // Use parseBuffer if file is in RAM
                metadata = await mm.parseBuffer(file.buffer);
            } else if (file.path) {
                // Use parseFile if file is saved on Disk (diskStorage)
                metadata = await mm.parseFile(file.path);
            } else {
                throw new BadRequestException('Invalid file data for analysis.');
            }

            // Check if it's a valid audio structure
            if (!metadata.format || !metadata.format.container) {
                throw new BadRequestException('Invalid audio format or corrupted file.');
            }

            // Optional: Check duration (e.g., max 10 minutes)
            const duration = metadata.format.duration;
            if (duration && duration > 600) {
                throw new BadRequestException('Audio duration is too long (max 10 minutes).');
            }
            return metadata;
        } catch (error) {
            // Catch all parsing errors (e.g., if user uploads a .txt renamed to .mp3)
            throw new BadRequestException(`Failed to parse audio metadata: ${error.message}`);
        }
    }

}
