import { VoiceName, TextGenre } from "../types";
import { getVoiceTechnicalName } from "../utils/voiceMapping";

// Ưu tiên biến chuẩn VITE_API_BASE_URL, fallback về VITE_TTS_SERVER_URL
const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string) ||
  (import.meta.env.VITE_TTS_SERVER_URL as string) ||
  'http://localhost:3001';

// Tính số bytes của string (UTF-8 encoding)
function getByteLength(str: string): number {
  return new Blob([str]).size;
}

export function splitTextIntoChunks(text: string, maxChars: number = 3000): string[] {
  // Chia văn bản thành các đoạn < 3000 ký tự để tiết kiệm credits
  // Cloud TTS có giới hạn 5000 bytes, nhưng chia nhỏ hơn để:
  // 1. Tiết kiệm credits (tính theo số requests)
  // 2. Dễ xử lý và debug
  // 3. Tránh lỗi do encoding variations

  if (!text || text.trim().length === 0) {
    return [];
  }

  const segments = text.split(/([.?!。\n]+)/);
  const chunks: string[] = [];
  let currentChunk = "";

  for (const segment of segments) {
    const testChunk = currentChunk + segment;

    // Kiểm tra theo số ký tự (không phải bytes) để đơn giản và chính xác hơn
    if (testChunk.length > maxChars && currentChunk !== "") {
      chunks.push(currentChunk.trim());
      currentChunk = segment;
    } else {
      currentChunk = testChunk;
    }
  }

  if (currentChunk.trim() !== "") {
    // Kiểm tra chunk cuối có vượt quá giới hạn không
    const finalLength = currentChunk.trim().length;
    if (finalLength > maxChars) {
      // Nếu vượt quá, chia nhỏ hơn nữa tại vị trí phù hợp
      // Tìm vị trí chia tốt nhất (tại dấu câu hoặc khoảng trắng)
      let splitPoint = Math.floor(currentChunk.length * 0.5);
      const lastPunctuation = currentChunk.lastIndexOf('.', splitPoint);
      const lastSpace = currentChunk.lastIndexOf(' ', splitPoint);

      if (lastPunctuation > currentChunk.length * 0.3) {
        splitPoint = lastPunctuation + 1;
      } else if (lastSpace > currentChunk.length * 0.3) {
        splitPoint = lastSpace + 1;
      }

      const firstHalf = currentChunk.substring(0, splitPoint);
      const secondHalf = currentChunk.substring(splitPoint);
      if (firstHalf.trim()) chunks.push(firstHalf.trim());
      if (secondHalf.trim()) chunks.push(secondHalf.trim());
    } else {
      chunks.push(currentChunk.trim());
    }
  }

  return chunks.filter(chunk => chunk.length > 0); // Loại bỏ chunks rỗng
}

export interface TTSMeta {
  genre: string;
  voice: string;
  prosody: { rate: string; pitch?: string; breakTime?: string };
  paragraphBreak: string;
  textLength: number;
}

export interface CustomProsody {
  rate?: number;
  pitch?: string;
  breakTime?: string;
}

export async function generateTTSChunk(
  text: string,
  voice: VoiceName,
  genre?: TextGenre,
  customProsody?: CustomProsody,
  retries: number = 2
): Promise<{ audioContent: string; mimeType?: string; meta?: TTSMeta }> {
  // Validation: tránh gửi requests không cần thiết
  if (!text || text.trim().length === 0) {
    throw new Error('Text không được rỗng');
  }

  const textBytes = getByteLength(text);
  if (textBytes > 5000) {
    throw new Error(`Text quá dài (${textBytes} bytes). Giới hạn là 5000 bytes.`);
  }

  // Retry logic để xử lý lỗi tạm thời
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(`${API_BASE_URL}/api/tts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: text.trim(),
          voice: getVoiceTechnicalName(voice),
          genre: genre,
          customProsody,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        const errorMessage = error.error || 'Failed to generate TTS';

        // Không retry nếu là lỗi validation (400)
        if (response.status === 400) {
          throw new Error(errorMessage);
        }

        // Retry nếu là lỗi server (500, 503, etc.)
        if (attempt < retries) {
          await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1))); // Exponential backoff
          continue;
        }

        throw new Error(errorMessage);
      }

      const data = await response.json();
      if (!data.audioContent) {
        throw new Error('Không nhận được dữ liệu âm thanh từ server');
      }

      return { audioContent: data.audioContent, mimeType: data.mimeType, meta: data.meta }; // Base64 encoded audio
    } catch (error: any) {
      lastError = error;
      // Nếu không phải lỗi network, không retry
      if (error.message.includes('quá dài') || error.message.includes('không được rỗng')) {
        throw error;
      }

      if (attempt < retries) {
        console.warn(`TTS request failed, retrying... (${attempt + 1}/${retries})`);
        await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
        continue;
      }
    }
  }

  throw new Error(`Không thể tạo dữ liệu âm thanh sau ${retries + 1} lần thử: ${lastError?.message || 'Unknown error'}`);
}
