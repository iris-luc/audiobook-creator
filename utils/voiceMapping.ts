import { VoiceName } from '../types';
// Import the single source of truth for technical voice names
import { VOICE_MAP } from './voiceMap.js';

export interface VoiceInfo {
  technicalName: string;
  displayName: string;
  gender: 'nam' | 'nữ';
  description: string;
  region: 'Bắc' | 'Nam Bộ' | 'Trung tính';
  quality: 'Wavenet' | 'Neural2' | 'Standard' | 'Chirp3-HD' | 'Gemini-Flash';
  characteristics: string[];
}

// VOICE_MAPPING now combines static UI metadata with the dynamic technical name
// from the shared voiceMap.js file.
export const VOICE_MAPPING: Record<VoiceName, VoiceInfo> = {
  [VoiceName.DUONG_QUA]: {
    technicalName: VOICE_MAP[VoiceName.DUONG_QUA],
    displayName: 'Dương Quá',
    gender: 'nam',
    region: 'Trung tính',
    quality: 'Standard',
    description: 'Giọng tiếng Việt Standard (Cloud TTS).',
    characteristics: ['Cloud TTS Standard', 'Tiếng Việt chuẩn'],
  },
  [VoiceName.TIEU_LONG_NU]: {
    technicalName: VOICE_MAP[VoiceName.TIEU_LONG_NU],
    displayName: 'Tiểu Long Nữ',
    gender: 'nữ',
    region: 'Trung tính',
    quality: 'Standard',
    description: 'Giọng tiếng Việt Standard (Cloud TTS).',
    characteristics: ['Cloud TTS Standard', 'Tiếng Việt chuẩn'],
  },
  [VoiceName.HOANG_DUNG]: {
    technicalName: VOICE_MAP[VoiceName.HOANG_DUNG],
    displayName: 'Hoàng Dung',
    gender: 'nữ',
    region: 'Trung tính',
    quality: 'Standard',
    description: 'Giọng tiếng Việt Standard (Cloud TTS).',
    characteristics: ['Cloud TTS Standard', 'Tiếng Việt chuẩn'],
  },
  [VoiceName.QUACH_TINH]: {
    technicalName: VOICE_MAP[VoiceName.QUACH_TINH],
    displayName: 'Quách Tĩnh',
    gender: 'nam',
    region: 'Trung tính',
    quality: 'Standard',
    description: 'Giọng tiếng Việt Standard (Cloud TTS).',
    characteristics: ['Cloud TTS Standard', 'Tiếng Việt chuẩn'],
  },
};

export const getGroupedVoices = () => {
  const voices = Object.values(VoiceName).map(key => ({
    key: key,
    ...VOICE_MAPPING[key]
  }));

  return {
    male: voices.filter(v => v.gender === 'nam'),
    female: voices.filter(v => v.gender === 'nữ'),
  };
};

export function getVoiceInfo(voice: VoiceName): VoiceInfo {
  return VOICE_MAPPING[voice];
}

export function getVoiceDisplayName(voice: VoiceName): string {
  const info = VOICE_MAPPING[voice];
  const genderLabel = info.gender === 'nam' ? 'Nam' : 'Nữ';
  return `${info.displayName} - ${genderLabel} - ${info.technicalName}`;
}

export function getVoiceTechnicalName(voice: VoiceName): string {
  return VOICE_MAPPING[voice].technicalName;
}
