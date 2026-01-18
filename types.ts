export interface AudioGenerationState {
  isProcessing: boolean;
  isConvertingDialect: boolean;
  isGeneratingAudio: boolean;
  error: string | null;
  progress: number;
}

export interface BookContent {
  originalText: string;
  dialectText: string;
  audioUrl: string | null;
  fileName: string | null;
}

export interface Chunk {
  id: number;
  text: string;
  audioUrl: string | null;
  isGenerated: boolean;
  isProcessing: boolean;
  isPreviewing: boolean;
  previewAudioUrl: string | null;
  previewVoice?: VoiceName;
  previewGenre?: TextGenre;
  previewProsodyKey?: string;
  lastVoice?: VoiceName;
  lastGenre?: TextGenre;
  lastProsody?: any;
  lastProsodyKey?: string;
  isDialectConverted?: boolean;
}

export enum VoiceName {
  DUONG_QUA = 'DUONG_QUA',
  TIEU_LONG_NU = 'TIEU_LONG_NU',
  HOANG_DUNG = 'HOANG_DUNG',
  QUACH_TINH = 'QUACH_TINH',
}

export enum TextGenre {
  LITERATURE = 'Văn học / Truyện',
  NEWS = 'Tin tức / Báo chí',
  FORMAL = 'Phi hư cấu (Sách học)',
  GENERAL = 'Thông thường'
}
