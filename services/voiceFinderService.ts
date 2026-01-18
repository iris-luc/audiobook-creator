import { GoogleGenAI, Type } from '@google/genai';
import { VoiceName } from '../types';
import { getVoiceInfo } from '../utils/voiceMapping';

export interface VoiceProfile {
  name: string;
  technicalName: string;
  gender: 'nam' | 'nữ';
  characteristics: string[];
  localeHint: string;
}

export interface VoiceRecommendation {
  voiceNames: string[];
  systemInstruction: string;
  sampleText: string;
}

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || process.env.API_KEY || '' });

// Hint chung cho Cloud TTS Standard voices.
const LOCALE_HINTS: Record<string, string> = {
  'vi-VN-Standard-A': 'Tiếng Việt chuẩn, nữ',
  'vi-VN-Standard-B': 'Tiếng Việt chuẩn, nam',
  'vi-VN-Standard-C': 'Tiếng Việt chuẩn, nữ',
  'vi-VN-Standard-D': 'Tiếng Việt chuẩn, nam',
};

export function getVoiceProfiles(): VoiceProfile[] {
  return Object.values(VoiceName).map((voice) => {
    const info = getVoiceInfo(voice);
    return {
      name: info.displayName,
      technicalName: info.technicalName,
      gender: info.gender,
      characteristics: info.characteristics,
      localeHint: LOCALE_HINTS[info.technicalName] || info.region,
    };
  });
}

export function buildVoiceFinderPrompt(query: string, voices: VoiceProfile[]): string {
  return `
Bạn là đạo diễn casting giọng nói cho sách nói.
Hệ thống đang dùng Google Cloud TTS Standard với các giọng sau:
${JSON.stringify(voices)}

Yêu cầu người dùng: "${query}"

Nhiệm vụ:
1) Chọn tối đa 3 giọng phù hợp nhất.
2) Tạo systemInstruction mô tả persona + địa phương (dùng để chuẩn bị nội dung,
   KHÔNG chèn trực tiếp vào văn bản gửi TTS để tránh bị đọc).
3) Viết đoạn sampleText 2-3 câu để test giọng.

Trả về JSON theo schema đã yêu cầu.
  `.trim();
}

export async function recommendVoices(
  query: string,
  voices: VoiceProfile[] = getVoiceProfiles()
): Promise<VoiceRecommendation> {
  if (!query.trim()) {
    throw new Error('Query không được rỗng');
  }

  const prompt = buildVoiceFinderPrompt(query, voices);

  const response = await ai.models.generateContent({
    model: 'gemini-2.0-flash',
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          recommendedVoices: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
          systemInstruction: {
            type: Type.STRING,
          },
          sampleText: {
            type: Type.STRING,
          },
        },
        required: ['recommendedVoices', 'systemInstruction', 'sampleText'],
      },
    },
  });

  const result = JSON.parse(response.text || '{}');
  if (!result.recommendedVoices || result.recommendedVoices.length === 0) {
    throw new Error('Không tìm thấy giọng phù hợp');
  }

  return {
    voiceNames: result.recommendedVoices,
    systemInstruction: result.systemInstruction,
    sampleText: result.sampleText,
  };
}
