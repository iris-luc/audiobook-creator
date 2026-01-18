import { TextGenre } from '../types';

/**
 * Preset phong cách đọc theo nguyên tắc UX: nghe thoải mái, không mệt
 * Ưu tiên nghe lâu 30-60 phút không mệt
 */
export interface ReadingStyle {
  name: string; // Tên hiển thị phong cách
  description: string; // Mô tả mục đích/cảm nhận
  speakingRate: number; // 0.5 - 2.0
  pitch: number; // -20.0 to +20.0 semitones
  breakMs: number; // Độ dài ngắt nghỉ giữa các câu (ms)
  volumeGainDb: number; // -96.0 to +16.0 dB
  characteristics: string[];
}

export const READING_STYLES: Record<TextGenre, ReadingStyle> = {
  [TextGenre.LITERATURE]: {
    name: 'Văn học / Truyện',
    description: 'Trầm ấm, kể chuyện chậm rãi, giúp người nghe thấm cảm xúc.',
    speakingRate: 0.88, // 0.85 - 0.90
    pitch: -1.0, // Nữ: -1.0st, Nam: -2.0st
    breakMs: 700, // 600-800ms
    volumeGainDb: 0.0,
    characteristics: [
      'Tốc độ: 0.85 - 0.90',
      'Pitch: -2.0st (Nam), -1.0st (Nữ)',
      'Ngắt nghỉ: 600-800ms',
      'Trầm ấm, giảm cảm giác robot',
    ],
  },
  [TextGenre.FORMAL]: {
    name: 'Phi hư cấu (Sách học)',
    description: 'Rõ ràng, mạch lạc, tin cậy – đủ chậm để thu nạp kiến thức.',
    speakingRate: 0.95,
    pitch: -0.5, // Nữ: -0.5st, Nam: -1.0st
    breakMs: 450, // 400-500ms
    volumeGainDb: 0.0,
    characteristics: [
      'Tốc độ: 0.95',
      'Pitch: -1.0st (Nam), -0.5st (Nữ)',
      'Ngắt nghỉ: 400-500ms',
      'Rõ ràng, mạch lạc, không buồn ngủ',
    ],
  },
  [TextGenre.GENERAL]: {
    name: 'Thông thường',
    description: 'Giọng như nói chuyện hàng ngày, nhẹ nhàng và thân mật.',
    speakingRate: 1.0,
    pitch: 0.0,
    breakMs: 300,
    volumeGainDb: 0.0,
    characteristics: [
      'Tốc độ: 1.00',
      'Pitch: 0st',
      'Ngắt nghỉ: 300ms',
      'Tự nhiên, hội thoại',
    ],
  },
  [TextGenre.NEWS]: {
    name: 'Tin tức / Báo chí',
    description: 'Nhanh, khách quan, giống phát thanh viên bản tin.',
    speakingRate: 1.08, // 1.05 - 1.10
    pitch: 0.5, // +0.5st hoặc 0
    breakMs: 220, // 200-250ms
    volumeGainDb: 0.0,
    characteristics: [
      'Tốc độ: 1.05 - 1.10',
      'Pitch: +0.5st',
      'Ngắt nghỉ: 200-250ms',
      'Nhanh, khách quan, bản tin',
    ],
  },
};

/**
 * Lấy style config theo genre
 */
export function getReadingStyle(genre: TextGenre): ReadingStyle {
  return READING_STYLES[genre];
}

