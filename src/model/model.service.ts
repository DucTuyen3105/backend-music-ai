import { Injectable, InternalServerErrorException } from '@nestjs/common';

export interface MusicPrediction {
  label: string;
  score: number;
  top_three: Record<string, number>;
}

interface PredictorResponse {
  ok: boolean;
  prediction?: MusicPrediction;
  detail?: string;
  message?: string;
}

@Injectable()
export class ModelService {
  private readonly modelApiUrl = new URL(
    process.env.MODEL_API_URL || 'http://127.0.0.1:8001/predict',
  );
  private readonly timeoutMs = Number(process.env.MODEL_TIMEOUT_MS ?? 120000);

  async predict(audioPath: string): Promise<MusicPrediction> {
    try {
      const response = await fetch(this.modelApiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ audio_path: audioPath }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      const payload = (await response.json()) as PredictorResponse;
      if (!response.ok || !payload.ok || !payload.prediction) {
        throw new Error(
          payload.detail || payload.message || 'Model returned no prediction',
        );
      }
      return payload.prediction;
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unable to connect to model API';
      throw new InternalServerErrorException(
        `Model API request failed: ${message}`,
      );
    }
  }
}
