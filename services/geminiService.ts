
import { GoogleGenAI } from "@google/genai";
import { TextGenre } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });

// Simple in-memory cache for dialect conversion to avoid repeated Gemini calls
const STORAGE_KEY = 'audiobookCreator_dialectCache_v1';
const DIALECT_CACHE = new Map<string, string>();
const DIALECT_CACHE_LIMIT = 300; // Increased limit for persistent storage

// Load from localStorage on init if in browser
if (typeof window !== 'undefined') {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      Object.entries(parsed).forEach(([k, v]) => {
        if (typeof v === 'string') DIALECT_CACHE.set(k, v);
      });
    }
  } catch (err) {
    console.warn('Failed to load dialect cache from localStorage:', err);
  }
}

function saveCacheToStorage() {
  if (typeof window === 'undefined') return;
  try {
    const obj = Object.fromEntries(DIALECT_CACHE.entries());
    localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
  } catch (err) {
    console.warn('Failed to save dialect cache to localStorage:', err);
  }
}

function makeCacheKey(text: string, genre: TextGenre) {
  // Simple hash (djb2) to avoid storing very long keys
  let h = 5381;
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) + h) ^ text.charCodeAt(i);
  }
  const hex = (h >>> 0).toString(16);
  return `${genre}:${hex}`;
}

export function splitTextIntoChunks(text: string, maxLength: number = 800): string[] {
  const segments = text.split(/([.?!。\n]+)/);
  const chunks: string[] = [];
  let currentChunk = "";

  for (const segment of segments) {
    if ((currentChunk + segment).length > maxLength && currentChunk !== "") {
      chunks.push(currentChunk.trim());
      currentChunk = "";
    }
    currentChunk += segment;
  }
  if (currentChunk.trim() !== "") {
    chunks.push(currentChunk.trim());
  }
  return chunks;
}

export async function convertToSouthernDialect(text: string, genre: TextGenre): Promise<string> {
  // Tối ưu: tăng chunk size lên 2000 để giảm số requests (Gemini Flash có thể xử lý tốt)
  // Nhưng không quá lớn để đảm bảo chất lượng output
  if (!text || text.trim().length === 0) {
    return text;
  }

  const chunks = splitTextIntoChunks(text, 2000);
  let result = "";

  const genrePrompts = {
    [TextGenre.LITERATURE]: "Chuyển sang phương ngữ Nam Bộ dân dã, giàu hình ảnh, dùng từ 'hổng', 'thiệt', 'dữ à', 'nghen'. Giữ phong cách kể chuyện truyền cảm. Giữ nguyên ý chính, không thêm lời dẫn.",
    [TextGenre.NEWS]: "Chuyển sang phương ngữ Nam Bộ chuẩn mực (Sài Gòn), rõ ràng, hiện đại. Tránh từ cổ hủ. Giữ nguyên ý chính, không thêm lời dẫn.",
    [TextGenre.FORMAL]: "Chuyển sang tiếng Việt phong cách miền Nam lịch sự, chuyên nghiệp. Trang trọng nhưng giữ nét đặc trưng vùng miền. Giữ nguyên ý chính, không thêm lời dẫn.",
    [TextGenre.GENERAL]: "Chuyển sang phương ngữ Nam Bộ tự nhiên, gần gũi. Giữ nguyên ý chính, không thêm lời dẫn."
  };

  const prompt = genrePrompts[genre];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i].trim();
    if (!chunk) continue;

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-1.5-flash', // Model ổn định, nhanh và tiết kiệm credits
        contents: `${prompt}\n\n${chunk}`,
      });
      result += (response.text || chunk) + " ";
    } catch (error: any) {
      console.warn(`Lỗi khi chuyển đổi chunk ${i + 1}/${chunks.length}:`, error.message);
      // Fallback: giữ nguyên text nếu lỗi
      result += chunk + " ";
    }
  }

  return result.trim();
}

// Store results and enforce cache size limit
function cacheDialectResult(key: string, value: string) {
  DIALECT_CACHE.set(key, value);
  if (DIALECT_CACHE.size > DIALECT_CACHE_LIMIT) {
    const first = DIALECT_CACHE.keys().next().value;
    DIALECT_CACHE.delete(first);
  }
  saveCacheToStorage();
}

// Wrap conversion to cache result
export async function convertToSouthernDialectCached(text: string, genre: TextGenre): Promise<string> {
  const key = makeCacheKey(text, genre);
  if (DIALECT_CACHE.has(key)) return DIALECT_CACHE.get(key)!;
  const out = await convertToSouthernDialect(text, genre);
  cacheDialectResult(key, out);
  return out;
}
