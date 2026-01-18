/**
 * Thống kê văn bản: ký tự và credits
 */

export interface TextStats {
  originalCharacters: number; // Tổng số ký tự ban đầu
  cleanedCharacters: number; // Tổng số ký tự sau khi làm sạch
  chunkCount: number; // Số lượng đoạn (chunks)
  avgCharsPerChunk: number; // Số ký tự trung bình / đoạn
  expectedTTSRequests: number; // Số request TTS dự kiến
  credits: {
    tts: number; // Credits cho Cloud TTS (Standard)
    gemini?: number; // Credits cho Gemini (nếu bật chuyển phương ngữ)
    total: number; // Tổng credits
    ratePerMillion?: number; // Giá TTS (per 1M characters)
    geminiRatePerMillion?: number; // Giá Gemini text (per 1M tokens)
  };
}

// Giá credits ước tính
const CREDITS_PRICE = {
  TTS_STANDARD: 4.0, // Cloud TTS Standard (per 1M characters)
  GEMINI_TEXT_FLASH: 0.075, // Gemini Flash text (per 1M input tokens)
  GEMINI_CHARS_PER_TOKEN: 4.0, // Ước tính 1 token ≈ 4 ký tự
};

/**
 * Tính credits cho Gemini API (chuyển phương ngữ)
 * Gemini 1.5 Flash: ~$0.075 per 1M input tokens
 * Ước tính: 1 token ≈ 4 characters
 */
function calculateGeminiCredits(characters: number): number {
  const tokens = characters / CREDITS_PRICE.GEMINI_CHARS_PER_TOKEN;
  return (tokens / 1_000_000) * CREDITS_PRICE.GEMINI_TEXT_FLASH;
}

/**
 * Tính toán thống kê văn bản
 */
export function calculateTextStats(
  originalText: string,
  cleanedText: string,
  chunks: any[],
  useGemini: boolean = false
): TextStats {
  const originalChars = originalText.length;
  const cleanedChars = cleanedText.length;
  const chunkCount = chunks.length;
  const avgCharsPerChunk = chunkCount > 0 ? Math.round(cleanedChars / chunkCount) : 0;
  const expectedTTSRequests = chunkCount; // Mỗi chunk = 1 request

  const ttsCredits = (cleanedChars / 1_000_000) * CREDITS_PRICE.TTS_STANDARD;

  let geminiCredits: number | undefined;
  if (useGemini) {
    geminiCredits = calculateGeminiCredits(cleanedChars);
  }

  const totalCredits = ttsCredits + (geminiCredits || 0);

  return {
    originalCharacters: originalChars,
    cleanedCharacters: cleanedChars,
    chunkCount,
    avgCharsPerChunk,
    expectedTTSRequests,
    credits: {
      tts: ttsCredits,
      gemini: geminiCredits,
      total: totalCredits,
      ratePerMillion: CREDITS_PRICE.TTS_STANDARD,
      geminiRatePerMillion: CREDITS_PRICE.GEMINI_TEXT_FLASH,
    },
  };
}

/**
 * Format số với dấu phẩy ngăn cách
 */
export function formatNumber(num: number): string {
  return num.toLocaleString('vi-VN');
}
