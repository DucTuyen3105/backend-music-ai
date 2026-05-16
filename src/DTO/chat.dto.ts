import { Type } from 'class-transformer';
import {
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';

export class CreateConversationDTO {
  @IsOptional()
  @IsString()
  @Length(1, 120)
  title?: string;
}

export class AnalyzeAudioDTO {
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  start_time: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(3600)
  end_time: number;
}
