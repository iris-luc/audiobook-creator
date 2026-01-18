import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { Chunk, VoiceName, TextGenre } from './types';
import { extractTextFromFile } from './utils/fileProcessors';
import { calculateTextStats, formatNumber } from './utils/textStats';
import { analyzeAndSplitText, updateChunkText, areAllChunksGenerated, replaceAllInChunks, splitChunk, mergeWithNext, deleteChunk } from './utils/chunkManager';
import { generateTTSChunk, CustomProsody } from './services/cloudTtsService';
import { createAudioBlobFromBase64, mergeAudioUrls } from './utils/audio-utils';
import { convertToSouthernDialectCached } from './services/geminiService';
import { extractPreviewText } from './utils/textPreview';
import { getVoiceDisplayName, getVoiceInfo } from './utils/voiceMapping';
import { getReadingStyle } from './utils/readingStyles';
import { cleanText } from './utils/textCleaner';
import { findNextMatch, replaceAllLiteral, replaceAtRange, textMatchesAt } from './utils/findReplace';
import type { FindReplaceMatch } from './utils/findReplace';
import STYLE_CONFIG from './utils/readingStyles.config.js';

type PersistedBatchQueueV1 = {
  version: 1;
  savedAt: number;
  fileName: string | null;
  useSouthernDialect: boolean;
  selectedVoice: VoiceName;
  selectedGenre: TextGenre;
  advancedProsodyEnabled: boolean;
  customRate: string;
  customPitch: string;
  customBreakMs: string;
  chunks: Array<{ id: number; text: string; isDialectConverted?: boolean }>;
  completedChunkIds: number[];
  failedChunkIds: number[];
  isRunning: boolean;
  batchProgress: number;
};

const BATCH_QUEUE_STORAGE_KEY = 'audiobookCreator.batchQueue.v1';

function loadBatchQueue(): PersistedBatchQueueV1 | null {
  try {
    const raw = localStorage.getItem(BATCH_QUEUE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== 1) return null;
    if (!Array.isArray(parsed.chunks)) return null;
    return parsed as PersistedBatchQueueV1;
  } catch {
    return null;
  }
}

function saveBatchQueue(queue: PersistedBatchQueueV1): { ok: true } | { ok: false; reason: string } {
  try {
    localStorage.setItem(BATCH_QUEUE_STORAGE_KEY, JSON.stringify(queue));
    return { ok: true };
  } catch (err: any) {
    const msg = err?.message ? String(err.message) : 'unknown';
    return { ok: false, reason: msg };
  }
}

function clearBatchQueue() {
  try {
    localStorage.removeItem(BATCH_QUEUE_STORAGE_KEY);
  } catch {
    // ignore
  }
}

const App: React.FC = () => {
  const DEFAULT_VOICE = VoiceName.DUONG_QUA;
  const DEFAULT_GENRE = TextGenre.GENERAL;

  const [originalText, setOriginalText] = useState('');
  const [cleanedText, setCleanedText] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [useSouthernDialect, setUseSouthernDialect] = useState(false);
  const [selectedVoice, setSelectedVoice] = useState<VoiceName>(DEFAULT_VOICE);
  const [selectedGenre, setSelectedGenre] = useState<TextGenre>(DEFAULT_GENRE);
  const [advancedProsodyEnabled, setAdvancedProsodyEnabled] = useState(false);
  const [customRate, setCustomRate] = useState('');
  const [customPitch, setCustomPitch] = useState('');
  const [customBreakMs, setCustomBreakMs] = useState('');
  const [notice, setNotice] = useState<{ type: 'error' | 'info' | 'success'; message: string } | null>(null);
  const customProsody: CustomProsody | undefined = useMemo(() => {
    if (!advancedProsodyEnabled) return undefined;
    const payload: CustomProsody = {};
    const parsedRate = parseFloat(customRate);
    if (!Number.isNaN(parsedRate)) payload.rate = parsedRate;
    if (customPitch.trim()) payload.pitch = customPitch.trim();
    if (customBreakMs.trim()) payload.breakTime = `${customBreakMs.trim()}ms`;
    return Object.keys(payload).length ? payload : undefined;
  }, [advancedProsodyEnabled, customRate, customPitch, customBreakMs]);
  const customProsodyKey = useMemo(() => JSON.stringify(customProsody || {}), [customProsody]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isBatchGenerating, setIsBatchGenerating] = useState(false);
  const [batchProgress, setBatchProgress] = useState(0);
  const [mergedAudioUrl, setMergedAudioUrl] = useState<string | null>(null);
  const [isMerging, setIsMerging] = useState(false);
  const [playingChunkId, setPlayingChunkId] = useState<number | null>(null);
  const [continuousPlay, setContinuousPlay] = useState(false);
  const [availableVoices, setAvailableVoices] = useState<string[] | null>(null);
  const [presetPreviewUrl, setPresetPreviewUrl] = useState<string | null>(null);
  const [isPresetPreviewing, setIsPresetPreviewing] = useState(false);
  const [presetPreviewKey, setPresetPreviewKey] = useState<string | null>(null);
  const [backendHealth, setBackendHealth] = useState<{ ok: boolean; encodeBodyLimit?: string } | null>(null);
  const [backendHealthError, setBackendHealthError] = useState<string | null>(null);
  const [savedBatchQueue, setSavedBatchQueue] = useState<PersistedBatchQueueV1 | null>(null);
  const [resumeAfterRestore, setResumeAfterRestore] = useState(false);

  const apiBaseUrl =
    ((import.meta as any).env.VITE_API_BASE_URL as string) ||
    ((import.meta as any).env.VITE_TTS_SERVER_URL as string) ||
    'http://localhost:3001';

  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioRefs = useRef<{ [key: number]: HTMLAudioElement | null }>({});
  const originalTextAreaRef = useRef<HTMLTextAreaElement>(null);
  const chunkTextAreaRefs = useRef<{ [key: number]: HTMLTextAreaElement | null }>({});
  const findInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);

  type FindScope = 'original' | 'chunks' | 'both';
  const [findQuery, setFindQuery] = useState('');
  const [replaceQuery, setReplaceQuery] = useState('');
  const [findScope, setFindScope] = useState<FindScope>('original');
  const [findCaseSensitive, setFindCaseSensitive] = useState(false);
  const [lastMatch, setLastMatch] = useState<FindReplaceMatch | null>(null);

  const effectiveFindScope: FindScope = useMemo(() => {
    if (chunks.length > 0) return findScope;
    return findScope === 'chunks' ? 'original' : findScope;
  }, [chunks.length, findScope]);

  const revokeIfExists = useCallback((url?: string | null) => {
    if (url) URL.revokeObjectURL(url);
  }, []);

  const revokeAllChunkUrls = useCallback(
    (items: Chunk[]) => {
      items.forEach((chunk) => {
        revokeIfExists(chunk.audioUrl);
        revokeIfExists(chunk.previewAudioUrl);
      });
    },
    [revokeIfExists]
  );

  const pushNotice = useCallback((type: 'error' | 'info' | 'success', message: string) => {
    setNotice({ type, message });
  }, []);

  const friendlyError = useCallback((err: unknown, context?: string) => {
    const rawMessage =
      err instanceof Error
        ? err.message
        : typeof err === 'string'
          ? err
          : 'Đã có lỗi xảy ra.';

    const messageLower = rawMessage.toLowerCase();
    const prefix = context ? `${context}: ` : '';

    if (
      messageLower.includes('failed to fetch') ||
      messageLower.includes('networkerror') ||
      messageLower.includes('could not connect') ||
      messageLower.includes('econnrefused')
    ) {
      return (
        prefix +
        'Không kết nối được backend TTS. Hãy chạy `npm run dev:server` (port 3002) và kiểm tra `VITE_API_BASE_URL`.'
      );
    }

    if (messageLower.includes('invalid argument') || messageLower.includes('invalid_argument')) {
      return prefix + 'Tham số SSML/giọng không hợp lệ. Hãy kiểm tra lại Rate/Pitch/Break và thử lại.';
    }

    return prefix + rawMessage;
  }, []);

  const stopAllAudio = useCallback(() => {
    Object.values(audioRefs.current).forEach((audio) => {
      if (!audio) return;
      try {
        const el = audio as HTMLAudioElement;
        el.pause();
        el.currentTime = 0;
      } catch {
        // ignore
      }
    });
    setPlayingChunkId(null);
    setContinuousPlay(false);
  }, []);

  const resetAdvancedProsody = useCallback(() => {
    setAdvancedProsodyEnabled(false);
    setCustomRate('');
    setCustomPitch('');
    setCustomBreakMs('');
    pushNotice('info', 'Đã reset SSML nâng cao về mặc định.');
  }, [pushNotice]);

  const resetSettings = useCallback(() => {
    stopAllAudio();
    setSelectedGenre(DEFAULT_GENRE);
    setSelectedVoice(DEFAULT_VOICE);
    resetAdvancedProsody();
    pushNotice('success', 'Đã reset cài đặt về mặc định.');
  }, [DEFAULT_GENRE, DEFAULT_VOICE, pushNotice, resetAdvancedProsody, stopAllAudio]);

  useEffect(() => {
    setSavedBatchQueue(loadBatchQueue());
  }, []);

  const advancedProsodyValidation = useMemo(() => {
    if (!advancedProsodyEnabled) return { isValid: true, errors: {} as Record<string, string> };

    const errors: Record<string, string> = {};

    if (customRate.trim()) {
      const parsed = Number(customRate);
      if (!Number.isFinite(parsed)) errors.rate = 'Rate phải là số.';
      else if (parsed < 0.5 || parsed > 2.0) errors.rate = 'Rate nên nằm trong khoảng 0.50 – 2.00.';
    }

    if (customPitch.trim()) {
      const pitch = customPitch.trim();
      const match = pitch.match(/^([+-]?\d+(?:\.\d+)?)st$/i);
      if (!match) {
        errors.pitch = 'Pitch đúng định dạng ví dụ: -1st, 0st, +0.5st.';
      } else {
        const value = Number(match[1]);
        if (!Number.isFinite(value)) errors.pitch = 'Pitch phải là số.';
        else if (value < -20 || value > 20) errors.pitch = 'Pitch nên nằm trong khoảng -20st – +20st.';
      }
    }

    if (customBreakMs.trim()) {
      const parsed = Number(customBreakMs);
      if (!Number.isFinite(parsed)) errors.breakMs = 'Break phải là số (ms).';
      else if (parsed < 100 || parsed > 2000) errors.breakMs = 'Break nên nằm trong khoảng 100 – 2000ms.';
    }

    return { isValid: Object.keys(errors).length === 0, errors };
  }, [advancedProsodyEnabled, customBreakMs, customPitch, customRate]);

  const effectiveProsody = useMemo(() => {
    const fallbackKey = Object.keys(STYLE_CONFIG)[0] as keyof typeof STYLE_CONFIG;
    const base = (STYLE_CONFIG as any)[selectedGenre] || (STYLE_CONFIG as any)[DEFAULT_GENRE] || (STYLE_CONFIG as any)[fallbackKey];
    const gender = getVoiceInfo(selectedVoice).gender;
    const basePitch = gender === 'nam' ? base.pitchMale : base.pitchFemale;

    const rateOverride = advancedProsodyEnabled && customRate.trim() ? Number(customRate) : undefined;
    const pitchOverride = advancedProsodyEnabled && customPitch.trim() ? customPitch.trim() : undefined;
    const breakOverride =
      advancedProsodyEnabled && customBreakMs.trim()
        ? `${customBreakMs.trim()}ms`
        : undefined;

    return {
      rate: String(rateOverride ?? base.rate),
      pitch: pitchOverride ?? basePitch ?? base.pitchDefault,
      breakTime: breakOverride ?? base.breakTime,
      isOverridden: advancedProsodyEnabled && !!(rateOverride || pitchOverride || breakOverride),
    };
  }, [DEFAULT_GENRE, advancedProsodyEnabled, customBreakMs, customPitch, customRate, selectedGenre, selectedVoice]);

  // --- START REFACTOR: Memoization ---
  const textStats = useMemo(() => {
    if (!originalText || chunks.length === 0) return null;
    return calculateTextStats(originalText, cleanedText, chunks, useSouthernDialect);
  }, [originalText, cleanedText, chunks, useSouthernDialect]);

  const allGenerated = useMemo(() => areAllChunksGenerated(chunks), [chunks]);
  // --- END REFACTOR ---

  // Audio event handlers cho continuous play
  useEffect(() => {
    if (!continuousPlay) return;

    const handlers = new Map<number, () => void>();

    const createAndAddHandler = (chunkId: number) => {
      const handler = () => {
        const currentIndex = chunks.findIndex(c => c.id === chunkId);
        if (currentIndex >= 0 && currentIndex < chunks.length - 1) {
          const nextChunk = chunks[currentIndex + 1];
          if (nextChunk.audioUrl) {
            const audio = audioRefs.current[nextChunk.id];
            if (audio) {
              audio.play();
              setPlayingChunkId(nextChunk.id);
            }
          }
        } else {
          setPlayingChunkId(null);
          setContinuousPlay(false);
        }
      };

      handlers.set(chunkId, handler);
      const audio = audioRefs.current[chunkId];
      if (audio) {
        audio.addEventListener('ended', handler);
      }
    };

    Object.keys(audioRefs.current).forEach(key => {
      if (audioRefs.current[Number(key)]) {
        createAndAddHandler(Number(key));
      }
    });

    return () => {
      handlers.forEach((handler, chunkId) => {
        const audio = audioRefs.current[chunkId];
        if (audio) {
          audio.removeEventListener('ended', handler);
        }
      });
    };
  }, [chunks, continuousPlay]);



  // Fetch available voices from server to disable unavailable options
  useEffect(() => {
    const fetchAvailable = async () => {
      try {
        const res = await fetch(`${apiBaseUrl}/api/voices`);
        if (!res.ok) throw new Error('Server responded with an error');
        const data = await res.json();
        const voices = (data.voices || []).map((v: any) => v.name);
        setAvailableVoices(voices);
      } catch (err) {
        console.warn('Không thể lấy danh sách voices:', err);
        setAvailableVoices(null); // Keep it null to signify the fetch failed
      }
    };
    fetchAvailable();
  }, [apiBaseUrl]);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);

    const checkHealth = async () => {
      try {
        const res = await fetch(`${apiBaseUrl}/api/health`, { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setBackendHealth(data);
        setBackendHealthError(null);
      } catch (err) {
        setBackendHealth(null);
        setBackendHealthError(friendlyError(err, 'Backend'));
      } finally {
        clearTimeout(timeout);
      }
    };

    checkHealth();
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [apiBaseUrl, friendlyError]);

  useEffect(() => {
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      pushNotice('error', friendlyError(event.reason, 'Lỗi không mong muốn'));
    };
    const handleWindowError = (event: ErrorEvent) => {
      pushNotice('error', friendlyError(event.error || event.message, 'Lỗi ứng dụng'));
    };

    window.addEventListener('unhandledrejection', handleUnhandledRejection);
    window.addEventListener('error', handleWindowError);
    return () => {
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
      window.removeEventListener('error', handleWindowError);
    };
  }, [friendlyError, pushNotice]);

  useEffect(() => {
    if (!notice) return;
    if (notice.type === 'error') return;
    const t = window.setTimeout(() => setNotice(null), 6000);
    return () => window.clearTimeout(t);
  }, [notice]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isMod = event.ctrlKey || event.metaKey;
      if (!isMod) return;

      if (event.key.toLowerCase() === 'f') {
        event.preventDefault();
        window.setTimeout(() => findInputRef.current?.focus(), 0);
      }

      if (event.key.toLowerCase() === 'h') {
        event.preventDefault();
        window.setTimeout(() => replaceInputRef.current?.focus(), 0);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    setChunks(prev => {
      let changed = false;
      const next = prev.map(c => {
        const hasPreviewState = c.previewAudioUrl || c.isPreviewing || c.previewVoice || c.previewGenre || c.previewProsodyKey;
        if (!hasPreviewState) return c;
        changed = true;
        revokeIfExists(c.previewAudioUrl);
        return {
          ...c,
          previewAudioUrl: null,
          isPreviewing: false,
          previewVoice: undefined,
          previewGenre: undefined,
          previewProsodyKey: undefined,
        };
      });
      return changed ? next : prev;
    });
  }, [selectedVoice, selectedGenre, customProsodyKey, revokeIfExists]);

  useEffect(() => {
    if (!presetPreviewUrl) return;
    const key = `${selectedVoice}|${selectedGenre}|${customProsodyKey}`;
    if (presetPreviewKey !== key) {
      revokeIfExists(presetPreviewUrl);
      setPresetPreviewUrl(null);
    }
  }, [customProsodyKey, presetPreviewKey, presetPreviewUrl, revokeIfExists, selectedGenre, selectedVoice]);

  // --- START REFACTOR: useCallback ---
  const handleFileUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      clearBatchQueue();
      setSavedBatchQueue(null);
      const text = await extractTextFromFile(file);
      revokeAllChunkUrls(chunks);
      revokeIfExists(mergedAudioUrl);
      pushNotice('info', 'Đã tải file, sẵn sàng để phân tích.');
      setOriginalText(text);
      const cleaned = cleanText(text);
      setCleanedText(cleaned);
      setFileName(file.name);
      setChunks([]);
      setMergedAudioUrl(null);
    } catch (err: any) {
      pushNotice('error', friendlyError(err, 'Lỗi khi upload'));
    }
  }, [chunks, friendlyError, mergedAudioUrl, pushNotice, revokeAllChunkUrls, revokeIfExists]);

  const handleAnalyze = useCallback(async () => {
    if (!originalText.trim()) {
      pushNotice('error', 'Vui lòng nhập hoặc upload văn bản trước khi phân tích.');
      return;
    }

    clearBatchQueue();
    setSavedBatchQueue(null);
    setIsAnalyzing(true);
    revokeAllChunkUrls(chunks);
    revokeIfExists(mergedAudioUrl);
    setMergedAudioUrl(null);
    stopAllAudio();
    try {
      let textToAnalyze: string;
      let isDialectConverted = false;

      if (useSouthernDialect) {
        const cleanedForDialect = cleanText(originalText, { preserveNewlines: true, dashReplacement: ':' });
        setCleanedText(cleanedForDialect);
        textToAnalyze = await convertToSouthernDialectCached(cleanedForDialect, selectedGenre);
        isDialectConverted = true;
      } else {
        const cleanedForAnalysis = cleanText(originalText, { dashReplacement: ':' });
        setCleanedText(cleanedForAnalysis);
        textToAnalyze = cleanedForAnalysis;
      }

      const newChunks = analyzeAndSplitText(textToAnalyze, {
        skipCleaning: useSouthernDialect,
        isDialectConverted
      });

      // Smart reuse logic:
      const smartChunks = newChunks.map(nc => {
        // Find a chunk in the current state that matches the text
        const existing = chunks.find(oc => oc.text === nc.text);
        if (existing && existing.isGenerated && existing.audioUrl) {
          // Check if generation parameters match
          const settingsMatch =
            existing.lastVoice === selectedVoice &&
            existing.lastGenre === selectedGenre &&
            existing.lastProsodyKey === customProsodyKey;

          if (settingsMatch) {
            return { ...existing, id: nc.id }; // Reuse chunk but keep new ID for order
          }
        }
        return nc;
      });

      // Revoke URLs for chunks that are NOT in the smartChunks list
      const reusedUrls = new Set(smartChunks.map(c => c.audioUrl).filter(Boolean));
      chunks.forEach(c => {
        if (c.audioUrl && !reusedUrls.has(c.audioUrl)) {
          revokeIfExists(c.audioUrl);
        }
        if (c.previewAudioUrl) revokeIfExists(c.previewAudioUrl);
      });

      setChunks(smartChunks);
      pushNotice('success', 'Đã phân tích & tách đoạn. Các đoạn cũ được giữ lại nếu nội dung & cài đặt không đổi.');
    } catch (err: any) {
      pushNotice('error', friendlyError(err, 'Lỗi khi phân tích'));
    } finally {
      setIsAnalyzing(false);
    }
  }, [chunks, friendlyError, mergedAudioUrl, originalText, pushNotice, revokeAllChunkUrls, revokeIfExists, selectedGenre, stopAllAudio, useSouthernDialect]);


  const handleChunkTextChange = useCallback((chunkId: number, newText: string) => {
    setChunks(prev => {
      const current = prev.find(c => c.id === chunkId);
      if (current && current.text !== newText) {
        revokeIfExists(current.audioUrl);
        revokeIfExists(current.previewAudioUrl);
      }
      return updateChunkText(prev, chunkId, newText);
    });
  }, [revokeIfExists]);

  useEffect(() => {
    setLastMatch(null);
  }, [effectiveFindScope, findCaseSensitive, findQuery]);

  const focusAndSelectMatch = useCallback((match: FindReplaceMatch) => {
    const run = () => {
      if (match.key === 'original') {
        const el = originalTextAreaRef.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(match.start, match.end);
        return;
      }

      if (match.key.startsWith('chunk:')) {
        const chunkId = Number(match.key.slice('chunk:'.length));
        const el = chunkTextAreaRefs.current[chunkId];
        if (!el) return;
        el.focus();
        el.setSelectionRange(match.start, match.end);
      }
    };

    window.requestAnimationFrame(run);
  }, []);

  const getFindItems = useCallback(() => {
    const items: { key: string; text: string }[] = [];

    if (effectiveFindScope === 'original' || effectiveFindScope === 'both') {
      items.push({ key: 'original', text: originalText });
    }

    if (effectiveFindScope === 'chunks' || effectiveFindScope === 'both') {
      chunks.forEach((chunk) => items.push({ key: `chunk:${chunk.id}`, text: chunk.text }));
    }

    return items;
  }, [chunks, effectiveFindScope, originalText]);

  const handleFindNext = useCallback(() => {
    if (!findQuery) {
      pushNotice('error', 'Nhập nội dung cần tìm.');
      return;
    }

    const items = getFindItems();
    if (items.length === 0) {
      pushNotice('info', 'Không có vùng văn bản nào để tìm.');
      return;
    }

    const from = (() => {
      if (!lastMatch) return undefined;
      const itemIndex = items.findIndex((item) => item.key === lastMatch.key);
      if (itemIndex === -1) return undefined;
      return { itemIndex, offset: lastMatch.end };
    })();

    const next = findNextMatch(items, findQuery, { caseSensitive: findCaseSensitive }, from);
    if (!next) {
      pushNotice('info', 'Không tìm thấy.');
      return;
    }

    setLastMatch(next);
    focusAndSelectMatch(next);
  }, [findCaseSensitive, findQuery, focusAndSelectMatch, getFindItems, lastMatch, pushNotice]);

  const handleReplaceCurrent = useCallback(() => {
    if (!findQuery) {
      pushNotice('error', 'Nhập nội dung cần tìm trước khi thay.');
      return;
    }

    if (!lastMatch) {
      handleFindNext();
      return;
    }

    const caseOptions = { caseSensitive: findCaseSensitive };

    if (lastMatch.key === 'original') {
      if (!textMatchesAt(originalText, lastMatch.start, lastMatch.end, findQuery, caseOptions)) {
        pushNotice('info', 'Vị trí đang chọn không còn khớp. Thử tìm lại.');
        setLastMatch(null);
        return;
      }

      const nextText = replaceAtRange(originalText, lastMatch.start, lastMatch.end, replaceQuery);
      setOriginalText(nextText);
      const updated: FindReplaceMatch = {
        ...lastMatch,
        end: lastMatch.start + replaceQuery.length,
      };
      setLastMatch(updated);
      focusAndSelectMatch(updated);
      return;
    }

    if (lastMatch.key.startsWith('chunk:')) {
      const chunkId = Number(lastMatch.key.slice('chunk:'.length));
      const currentChunk = chunks.find((c) => c.id === chunkId);
      if (!currentChunk) return;

      if (!textMatchesAt(currentChunk.text, lastMatch.start, lastMatch.end, findQuery, caseOptions)) {
        pushNotice('info', 'Vị trí đang chọn không còn khớp. Thử tìm lại.');
        setLastMatch(null);
        return;
      }

      const nextText = replaceAtRange(currentChunk.text, lastMatch.start, lastMatch.end, replaceQuery);
      if (currentChunk.text !== nextText) {
        revokeIfExists(currentChunk.audioUrl);
        revokeIfExists(currentChunk.previewAudioUrl);
      }

      setChunks((prev) => updateChunkText(prev, chunkId, nextText));
      const updated: FindReplaceMatch = {
        ...lastMatch,
        end: lastMatch.start + replaceQuery.length,
      };
      setLastMatch(updated);
      focusAndSelectMatch(updated);
    }
  }, [
    chunks,
    findCaseSensitive,
    findQuery,
    focusAndSelectMatch,
    handleFindNext,
    lastMatch,
    originalText,
    pushNotice,
    replaceQuery,
    revokeIfExists,
  ]);

  const handleReplaceAll = useCallback(() => {
    if (!findQuery) {
      pushNotice('error', 'Nhập nội dung cần tìm trước khi thay tất cả.');
      return;
    }

    const caseOptions = { caseSensitive: findCaseSensitive };
    let total = 0;

    if (effectiveFindScope === 'original' || effectiveFindScope === 'both') {
      const replaced = replaceAllLiteral(originalText, findQuery, replaceQuery, caseOptions);
      total += replaced.count;
      if (replaced.count > 0) setOriginalText(replaced.text);
    }

    if (effectiveFindScope === 'chunks' || effectiveFindScope === 'both') {
      const replaced = replaceAllInChunks(chunks, findQuery, replaceQuery, { caseSensitive: findCaseSensitive });
      total += replaced.count;

      if (replaced.count > 0) {
        const prevById = new Map<number, Chunk>(chunks.map((c) => [c.id, c]));
        replaced.chunks.forEach((nextChunk) => {
          const prevChunk = prevById.get(nextChunk.id);
          if (prevChunk && prevChunk.text !== nextChunk.text) {
            revokeIfExists(prevChunk.audioUrl);
            revokeIfExists(prevChunk.previewAudioUrl);
          }
        });
        setChunks(replaced.chunks);
      }
    }

    if (total === 0) {
      pushNotice('info', 'Không có kết quả để thay thế.');
      return;
    }

    setLastMatch(null);
    pushNotice('success', `Đã thay ${total} vị trí.`);
  }, [chunks, effectiveFindScope, findCaseSensitive, findQuery, originalText, pushNotice, replaceQuery, revokeIfExists]);

  const handleGenerateChunk = useCallback(async (chunk: Chunk) => {
    if (!chunk.text.trim()) return;

    if (advancedProsodyEnabled && !advancedProsodyValidation.isValid) {
      pushNotice('error', 'SSML nâng cao chưa hợp lệ. Vui lòng sửa lỗi đỏ trong phần Cài Đặt.');
      return;
    }

    setChunks(prev => prev.map(c =>
      c.id === chunk.id ? { ...c, isProcessing: true } : c
    ));

    try {
      const { audioContent, mimeType, meta } = await generateTTSChunk(chunk.text, selectedVoice, selectedGenre, customProsody);
      const audioBlob = createAudioBlobFromBase64(audioContent, mimeType);
      const audioUrl = URL.createObjectURL(audioBlob);

      setChunks(prev => prev.map(c =>
        c.id === chunk.id
          ? (() => {
            revokeIfExists(c.audioUrl);
            return {
              ...c,
              audioUrl,
              isGenerated: true,
              isProcessing: false,
              lastProsody: meta?.prosody,
              lastGenre: selectedGenre,
              lastVoice: selectedVoice,
              lastProsodyKey: customProsodyKey,
            };
          })()
          : c
      ));
    } catch (err: any) {
      pushNotice('error', friendlyError(err, 'Lỗi khi tạo audio'));
      setChunks(prev => prev.map(c =>
        c.id === chunk.id ? { ...c, isProcessing: false } : c
      ));
      // Re-throw to be caught by batch generator
      throw err;
    }
  }, [advancedProsodyEnabled, advancedProsodyValidation.isValid, customProsody, friendlyError, pushNotice, revokeIfExists, selectedGenre, selectedVoice]);


  const handlePreview = useCallback(async (chunk: Chunk) => {
    if (!chunk.text.trim()) return;

    if (advancedProsodyEnabled && !advancedProsodyValidation.isValid) {
      pushNotice('error', 'SSML nâng cao chưa hợp lệ. Vui lòng sửa lỗi đỏ trong phần Cài Đặt.');
      return;
    }

    const canReusePreview =
      chunk.previewAudioUrl &&
      !chunk.isPreviewing &&
      chunk.previewVoice === selectedVoice &&
      chunk.previewGenre === selectedGenre &&
      chunk.previewProsodyKey === customProsodyKey;
    if (canReusePreview) {
      const audio = audioRefs.current[chunk.id];
      if (audio) {
        stopAllAudio();
        audio.src = chunk.previewAudioUrl;
        audio.play();
        setPlayingChunkId(chunk.id);
      }
      return;
    }

    setChunks(prev => prev.map(c =>
      c.id === chunk.id
        ? (() => {
          revokeIfExists(c.previewAudioUrl);
          return {
            ...c,
            isPreviewing: true,
            previewAudioUrl: null,
            previewVoice: undefined,
            previewGenre: undefined,
            previewProsodyKey: undefined,
          };
        })()
        : c
    ));

    try {
      const previewText = extractPreviewText(chunk.text, 30);
      const { audioContent, mimeType, meta } = await generateTTSChunk(previewText, selectedVoice, selectedGenre, customProsody);
      const audioBlob = createAudioBlobFromBase64(audioContent, mimeType);
      const previewUrl = URL.createObjectURL(audioBlob);

      setChunks(prev => prev.map(c =>
        c.id === chunk.id
          ? (() => {
            revokeIfExists(c.previewAudioUrl);
            return {
              ...c,
              previewAudioUrl: previewUrl,
              isPreviewing: false,
              previewVoice: selectedVoice,
              previewGenre: selectedGenre,
              previewProsodyKey: customProsodyKey,
              lastProsody: meta?.prosody,
              lastGenre: meta?.genre,
            };
          })()
          : c
      ));

      setTimeout(() => {
        const audio = audioRefs.current[chunk.id];
        if (audio && previewUrl) {
          stopAllAudio();
          audio.src = previewUrl;
          audio.play();
          setPlayingChunkId(chunk.id);
        }
      }, 100);
    } catch (err: any) {
      pushNotice('error', friendlyError(err, 'Lỗi khi preview'));
      setChunks(prev => prev.map(c =>
        c.id === chunk.id
          ? { ...c, isPreviewing: false, previewVoice: undefined, previewGenre: undefined, previewProsodyKey: undefined }
          : c
      ));
    }
  }, [advancedProsodyEnabled, advancedProsodyValidation.isValid, customProsody, customProsodyKey, friendlyError, pushNotice, revokeIfExists, selectedGenre, selectedVoice, stopAllAudio]);

  const handlePresetPreview = useCallback(async () => {
    if (advancedProsodyEnabled && !advancedProsodyValidation.isValid) {
      pushNotice('error', 'SSML nâng cao chưa hợp lệ. Vui lòng sửa lỗi đỏ trong phần Cài Đặt.');
      return;
    }

    const key = `${selectedVoice}|${selectedGenre}|${customProsodyKey}`;
    if (presetPreviewUrl && presetPreviewKey === key && !isPresetPreviewing) {
      const audio = audioRefs.current[-1];
      if (audio) {
        stopAllAudio();
        audio.src = presetPreviewUrl;
        audio.play();
      }
      return;
    }

    setIsPresetPreviewing(true);
    try {
      const voiceLabel = getVoiceInfo(selectedVoice).displayName;
      const previewText = `Chào mừng bạn đến với ứng dụng Sách Nói Phương Nam, đây là giọng ${voiceLabel} đang đọc với phong cách ${selectedGenre}`;
      const { audioContent, mimeType } = await generateTTSChunk(previewText, selectedVoice, selectedGenre, customProsody);
      const audioBlob = createAudioBlobFromBase64(audioContent, mimeType);
      const url = URL.createObjectURL(audioBlob);
      revokeIfExists(presetPreviewUrl);
      setPresetPreviewUrl(url);
      setPresetPreviewKey(key);

      setTimeout(() => {
        const audio = audioRefs.current[-1];
        if (audio) {
          stopAllAudio();
          audio.src = url;
          audio.play();
        }
      }, 50);
    } catch (err) {
      pushNotice('error', friendlyError(err, 'Lỗi khi nghe thử preset'));
    } finally {
      setIsPresetPreviewing(false);
    }
  }, [
    advancedProsodyEnabled,
    advancedProsodyValidation.isValid,
    chunks,
    cleanedText,
    customProsody,
    customProsodyKey,
    friendlyError,
    isPresetPreviewing,
    originalText,
    presetPreviewKey,
    presetPreviewUrl,
    pushNotice,
    revokeIfExists,
    selectedGenre,
    selectedVoice,
    stopAllAudio,
  ]);


  const handleBatchGenerate = useCallback(async () => {
    if (chunks.length === 0 || isBatchGenerating) return;

    if (advancedProsodyEnabled && !advancedProsodyValidation.isValid) {
      pushNotice('error', 'SSML nâng cao chưa hợp lệ. Vui lòng sửa lỗi đỏ trong phần Cài Đặt.');
      return;
    }

    setIsBatchGenerating(true);
    setBatchProgress(0);

    const chunksToProcess = chunks.filter(c => c.text.trim() && (!c.isGenerated || !c.audioUrl));
    const totalChunks = chunks.length;
    let completedChunks = chunks.filter(c => c.isGenerated && !!c.audioUrl).length;
    const completedChunkIds = new Set<number>(chunks.filter(c => c.isGenerated && !!c.audioUrl).map(c => c.id));
    const failedChunkIds = new Set<number>();

    const initialQueue: PersistedBatchQueueV1 = {
      version: 1,
      savedAt: Date.now(),
      fileName,
      useSouthernDialect,
      selectedVoice,
      selectedGenre,
      advancedProsodyEnabled,
      customRate,
      customPitch,
      customBreakMs,
      chunks: chunks.map(c => ({ id: c.id, text: c.text, isDialectConverted: c.isDialectConverted })),
      completedChunkIds: Array.from(completedChunkIds),
      failedChunkIds: [],
      isRunning: true,
      batchProgress: 0,
    };

    const persist = (progressValue: number) => {
      const payload: PersistedBatchQueueV1 = {
        ...initialQueue,
        savedAt: Date.now(),
        completedChunkIds: Array.from(completedChunkIds),
        failedChunkIds: Array.from(failedChunkIds),
        isRunning: true,
        batchProgress: progressValue,
      };
      const out = saveBatchQueue(payload);
      if (!out.ok) {
        console.warn('Không thể lưu batch queue vào localStorage:', out.reason);
      } else {
        setSavedBatchQueue(payload);
      }
    };

    setBatchProgress(Math.round((completedChunks / totalChunks) * 100));
    persist(Math.round((completedChunks / totalChunks) * 100));

    const generateAndTrackProgress = async (chunk: Chunk) => {
      try {
        await handleGenerateChunk(chunk);
        completedChunkIds.add(chunk.id);
        failedChunkIds.delete(chunk.id);
      } catch (error) {
        console.error(`Lỗi trong quá trình tạo batch cho đoạn ${chunk.id}:`, error);
        failedChunkIds.add(chunk.id);
      } finally {
        completedChunks++;
        const nextProgress = Math.round((completedChunks / totalChunks) * 100);
        setBatchProgress(nextProgress);
        persist(nextProgress);
      }
    };

    const concurrency = 3;
    const queue = [...chunksToProcess];
    const workers = Array(concurrency).fill(null).map(async () => {
      while (queue.length > 0) {
        const task = queue.shift();
        if (task) await generateAndTrackProgress(task);
      }
    });

    try {
      await Promise.all(workers);
    } catch (err: any) {
      pushNotice('error', friendlyError(err, 'Lỗi trong quá trình tạo batch'));
    } finally {
      setIsBatchGenerating(false);
      const finalProgress = Math.round((completedChunks / totalChunks) * 100);
      const finalQueue: PersistedBatchQueueV1 = {
        ...initialQueue,
        savedAt: Date.now(),
        completedChunkIds: Array.from(completedChunkIds),
        failedChunkIds: Array.from(failedChunkIds),
        isRunning: false,
        batchProgress: finalProgress,
      };
      const out = saveBatchQueue(finalQueue);
      if (out.ok) setSavedBatchQueue(finalQueue);
    }
  }, [
    advancedProsodyEnabled,
    advancedProsodyValidation.isValid,
    chunks,
    customBreakMs,
    customPitch,
    customRate,
    fileName,
    friendlyError,
    handleGenerateChunk,
    isBatchGenerating,
    pushNotice,
    selectedGenre,
    selectedVoice,
    useSouthernDialect,
  ]);

  const encodeMergedAudio = useCallback(async (mergedBlob: Blob, baseUrl: string): Promise<string> => {
    const res = await fetch(`${baseUrl}/api/encode`, {
      method: 'POST',
      headers: { 'Content-Type': mergedBlob.type || 'application/octet-stream' },
      body: mergedBlob,
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => null);
      if (errJson?.error) throw new Error(errJson.error);
      const errText = await res.text().catch(() => '');
      throw new Error(errText || `Không thể encode audio (HTTP ${res.status})`);
    }

    const encodedBuffer = await res.arrayBuffer();
    const outputType = res.headers.get('content-type') || 'audio/mpeg';
    const audioBlob = new Blob([encodedBuffer], { type: outputType });
    return URL.createObjectURL(audioBlob);
  }, []);

  const handleMergeAudio = useCallback(async () => {
    const audioUrls = chunks
      .filter(c => c.audioUrl)
      .sort((a, b) => a.id - b.id)
      .map(c => c.audioUrl!);

    if (audioUrls.length === 0) {
      pushNotice('error', 'Chưa có audio để tải. Hãy bấm “Tạo Audiobook” trước.');
      return;
    }

    setIsMerging(true);
    try {
      const mergedBlob = await mergeAudioUrls(audioUrls);
      const mergedUrl = await encodeMergedAudio(mergedBlob, apiBaseUrl);
      revokeIfExists(mergedAudioUrl);
      setMergedAudioUrl(mergedUrl);
      pushNotice('success', 'Đã merge & encode xong. Bạn có thể nghe và tải xuống.');
    } catch (err: any) {
      pushNotice('error', friendlyError(err, 'Lỗi khi merge audio'));
    } finally {
      setIsMerging(false);
    }
  }, [chunks, apiBaseUrl, encodeMergedAudio, friendlyError, mergedAudioUrl, pushNotice, revokeIfExists]);

  const handlePlayChunk = useCallback((chunkId: number) => {
    const audio = audioRefs.current[chunkId];
    if (!audio) return;

    if (playingChunkId === chunkId) {
      audio.pause();
      setPlayingChunkId(null);
    } else {
      Object.values(audioRefs.current).forEach(a => a?.pause());
      audio.currentTime = 0;
      audio.play();
      setPlayingChunkId(chunkId);
    }
  }, [playingChunkId]);
  const handleSplitChunk = useCallback((chunkId: number) => {
    const el = chunkTextAreaRefs.current[chunkId];
    if (!el) return;
    const splitIndex = el.selectionStart;
    setChunks(prev => splitChunk(prev, chunkId, splitIndex));
    pushNotice('success', `Đã chia đoạn ${chunkId} tại vị trí con trỏ.`);
  }, [pushNotice]);

  const handleMergeChunk = useCallback((chunkId: number) => {
    setChunks(prev => mergeWithNext(prev, chunkId));
    pushNotice('success', `Đã gộp đoạn ${chunkId} với đoạn kế tiếp.`);
  }, [pushNotice]);

  const handleDeleteChunk = useCallback((chunkId: number) => {
    if (window.confirm(`Bạn có chắc muốn xoá đoạn ${chunkId}?`)) {
      setChunks(prev => deleteChunk(prev, chunkId));
      pushNotice('info', `Đã xoá đoạn ${chunkId}.`);
    }
  }, [pushNotice]);

  const handleCleanInput = useCallback(() => {
    if (!originalText.trim()) return;
    const cleaned = cleanText(originalText);
    setOriginalText(cleaned);
    pushNotice('success', 'Đã dọn dẹp văn bản gốc.');
  }, [originalText, pushNotice]);

  const getCharLimitColor = (length: number) => {
    if (length < 3000) return 'bg-green-500';
    if (length < 4500) return 'bg-amber-500';
    return 'bg-red-500';
  };
  // --- END REFACTOR ---

  const readingStyle = getReadingStyle(selectedGenre);

  const restoreBatchQueue = useCallback((options?: { autoResume?: boolean }) => {
    const saved = savedBatchQueue;
    if (!saved) return;

    stopAllAudio();
    revokeAllChunkUrls(chunks);
    revokeIfExists(mergedAudioUrl);
    setMergedAudioUrl(null);

    setFileName(saved.fileName);
    setUseSouthernDialect(saved.useSouthernDialect);
    setSelectedVoice(saved.selectedVoice);
    setSelectedGenre(saved.selectedGenre);
    setAdvancedProsodyEnabled(saved.advancedProsodyEnabled);
    setCustomRate(saved.customRate);
    setCustomPitch(saved.customPitch);
    setCustomBreakMs(saved.customBreakMs);

    const completed = new Set(saved.completedChunkIds || []);
    const restoredChunks: Chunk[] = saved.chunks.map((c) => ({
      id: c.id,
      text: c.text,
      audioUrl: null,
      isGenerated: completed.has(c.id),
      isProcessing: false,
      isPreviewing: false,
      previewAudioUrl: null,
      previewVoice: undefined,
      previewGenre: undefined,
      previewProsodyKey: undefined,
      lastProsody: undefined,
      lastGenre: undefined,
      isDialectConverted: !!c.isDialectConverted,
    }));

    setOriginalText(saved.chunks.map(c => c.text).join('\n\n'));
    setCleanedText(saved.chunks.map(c => c.text).join('\n\n'));
    setChunks(restoredChunks);

    pushNotice('success', 'Đã khôi phục batch queue từ localStorage.');
    if (options?.autoResume) setResumeAfterRestore(true);
  }, [chunks, mergedAudioUrl, pushNotice, revokeAllChunkUrls, revokeIfExists, savedBatchQueue, stopAllAudio]);

  useEffect(() => {
    if (!resumeAfterRestore) return;
    if (chunks.length === 0) return;
    if (isBatchGenerating) return;
    setResumeAfterRestore(false);
    handleBatchGenerate();
  }, [chunks.length, handleBatchGenerate, isBatchGenerating, resumeAfterRestore]);

  return (
    <div className="min-h-screen pb-20 bg-gradient-to-b from-amber-50 to-white">
      <header className="py-12 px-6 max-w-7xl mx-auto text-center">
        <h1 className="text-5xl font-serif text-amber-900 mb-4 tracking-tight">Sách Nói Phương Nam</h1>
        <p className="text-slate-600 max-w-2xl mx-auto text-lg leading-relaxed">
          Tối ưu chi phí với quản lý từng đoạn văn bản
        </p>
      </header>

      <main className="max-w-7xl mx-auto px-6 space-y-6">
        {notice && (
          <div
            className={`rounded-2xl px-5 py-4 border shadow-sm flex items-start justify-between gap-4 ${notice.type === 'error'
              ? 'bg-red-50 border-red-200 text-red-900'
              : notice.type === 'success'
                ? 'bg-green-50 border-green-200 text-green-900'
                : 'bg-slate-50 border-slate-200 text-slate-900'
              }`}
            role={notice.type === 'error' ? 'alert' : 'status'}
          >
            <div className="text-sm whitespace-pre-wrap">{notice.message}</div>
            <button
              className="text-sm px-2 py-1 rounded-lg hover:bg-black/5"
              onClick={() => setNotice(null)}
              aria-label="Đóng thông báo"
              title="Đóng"
            >
              ✕
            </button>
          </div>
        )}

        {savedBatchQueue && chunks.length === 0 && (
          <div className="rounded-2xl px-5 py-4 border shadow-sm bg-blue-50 border-blue-200 text-blue-900 flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm">
              Tìm thấy batch queue đã lưu (tiến độ {savedBatchQueue.batchProgress || 0}%). Bạn có thể khôi phục để tiếp tục sau khi F5.
            </div>
            <div className="flex gap-2">
              <button
                className="text-sm px-3 py-2 rounded-lg bg-white border border-blue-200 hover:bg-blue-100"
                onClick={() => restoreBatchQueue({ autoResume: false })}
                type="button"
              >
                Khôi phục
              </button>
              <button
                className="text-sm px-3 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700"
                onClick={() => restoreBatchQueue({ autoResume: true })}
                type="button"
              >
                Khôi phục & chạy tiếp
              </button>
              <button
                className="text-sm px-3 py-2 rounded-lg bg-white border border-blue-200 hover:bg-blue-100"
                onClick={() => {
                  clearBatchQueue();
                  setSavedBatchQueue(null);
                  pushNotice('info', 'Đã xoá batch queue đã lưu.');
                }}
                type="button"
              >
                Xoá
              </button>
            </div>
          </div>
        )}

        {/* Input Section */}
        <div className="glass rounded-3xl p-8 shadow-sm border border-amber-100">
          <h2 className="text-xl font-bold mb-6 flex items-center gap-2 text-amber-800">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18 18.246 18.477 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
            Nhập Văn Bản
          </h2>

          <textarea
            ref={originalTextAreaRef}
            className="w-full h-48 p-4 rounded-xl border border-amber-200 focus:ring-2 focus:ring-amber-500 focus:border-transparent resize-none bg-white/50 text-slate-700"
            placeholder="Dán văn bản hoặc upload file..."
            value={originalText}
            onChange={(e) => setOriginalText(e.target.value)}
          />

          <div className="mt-4 flex flex-wrap gap-3 items-center">
            <input type="file" ref={fileInputRef} className="hidden" accept=".txt,.pdf,.docx" onChange={handleFileUpload} />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="px-4 py-2 bg-amber-50 text-amber-700 rounded-lg hover:bg-amber-100 transition-colors flex items-center gap-2 text-sm font-medium border border-amber-200"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              Upload File
            </button>
            {fileName && (
              <span className="text-xs text-amber-600 bg-amber-50/50 px-3 py-2 rounded-lg border border-amber-100 italic">
                {fileName}
              </span>
            )}
            <div className="flex items-center gap-3 ml-auto">
              <input
                type="checkbox"
                id="dialect"
                checked={useSouthernDialect}
                onChange={(e) => setUseSouthernDialect(e.target.checked)}
                className="w-5 h-5 rounded text-amber-600"
                title="Nếu bật, toàn bộ văn bản sẽ được chuyển sang phương ngữ Nam trước khi tách đoạn. Giữ nguyên ngắt dòng và nhịp đọc."
              />
              <label htmlFor="dialect" className="text-sm font-medium text-slate-700" title="Nếu bật, toàn bộ văn bản sẽ được chuyển sang phương ngữ Nam trước khi tách đoạn. Giữ nguyên ngắt dòng và nhịp đọc.">
                Chuyển phương ngữ Nam
              </label>
            </div>
            <button
              onClick={handleAnalyze}
              disabled={!originalText.trim() || isAnalyzing}
              className={`px-6 py-2 rounded-lg font-medium transition-all flex items-center gap-2 ${!originalText.trim() || isAnalyzing
                ? 'bg-slate-300 text-slate-500 cursor-not-allowed'
                : 'bg-gradient-to-r from-amber-600 to-amber-700 text-white hover:shadow-lg'
                }`}
            >
              {isAnalyzing ? (
                <>
                  <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Đang phân tích...
                </>
              ) : (
                <>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                  🔍 Phân tích & Tách đoạn
                </>
              )}
            </button>
            <button
              onClick={handleCleanInput}
              disabled={!originalText.trim()}
              className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-colors flex items-center gap-2 text-sm font-medium border border-slate-300"
              title="Loại bỏ emoji, ký tự thừa và chuẩn hóa whitespace để tiết kiệm credits."
            >
              🧹 Dọn dẹp Text
            </button>
          </div>

          {/* Statistics Panel */}
          {textStats && (
            <div className="mt-4 p-6 bg-amber-50 rounded-xl border border-amber-200">
              <h3 className="text-lg font-bold text-amber-800 mb-4 flex items-center gap-2">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
                Thống Kê Chi Tiết
              </h3>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-amber-600 font-medium">Tổng ký tự ban đầu:</span>
                  <span className="ml-2 text-amber-900 font-bold">{formatNumber(textStats.originalCharacters)}</span>
                </div>
                <div>
                  <span className="text-amber-600 font-medium">Tổng ký tự sau làm sạch:</span>
                  <span className="ml-2 text-amber-900 font-bold">{formatNumber(textStats.cleanedCharacters)}</span>
                </div>
                <div>
                  <span className="text-amber-600 font-medium">Số lượng đoạn:</span>
                  <span className="ml-2 text-amber-900 font-bold">{textStats.chunkCount}</span>
                </div>
                <div>
                  <span className="text-amber-600 font-medium">Ký tự trung bình/đoạn:</span>
                  <span className="ml-2 text-amber-900 font-bold">{formatNumber(textStats.avgCharsPerChunk)}</span>
                </div>
                <div>
                  <span className="text-amber-600 font-medium">Số request TTS dự kiến:</span>
                  <span className="ml-2 text-amber-900 font-bold">{textStats.expectedTTSRequests}</span>
                </div>
                <div>
                  <span className="text-amber-600 font-medium">Giọng sử dụng:</span>
                  <span className="ml-2 text-amber-900 font-bold">{getVoiceDisplayName(selectedVoice)}</span>
                </div>
                <div>
                  <span className="text-amber-600 font-medium">Credits ước tính:</span>
                  <span className="ml-2 text-amber-900 font-bold text-lg">${textStats.credits.total.toFixed(4)}</span>
                </div>
              </div>
              <div className="mt-2 text-xs text-amber-600">
                <div className="flex justify-between">
                  <span>• Giá TTS (Standard / 1M ký tự):</span>
                  <span>${textStats.credits.ratePerMillion.toFixed(2)}</span>
                </div>
              </div>
              <div className="mt-4 pt-4 border-t border-amber-200 text-xs text-amber-600">
                <div className="flex justify-between mb-1">
                  <span>• Cloud TTS (Standard):</span>
                  <span>${textStats.credits.tts.toFixed(4)}</span>
                </div>
                {textStats.credits.gemini !== undefined && (
                  <div className="flex justify-between">
                    <span>• Gemini (chuyển phương ngữ):</span>
                    <span>${textStats.credits.gemini.toFixed(4)}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Find & Replace */}
        <div className="glass rounded-3xl p-6 shadow-sm border border-amber-100">
          <div className="flex items-center justify-between gap-4 mb-4">
            <h3 className="text-lg font-bold text-amber-800">Tìm & Thay Thế</h3>
            <div className="text-xs text-slate-500">
              Phím tắt: <span className="font-mono">Ctrl/Cmd+F</span>, <span className="font-mono">Ctrl/Cmd+H</span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-slate-600 mb-1">Tìm</label>
              <input
                ref={findInputRef}
                value={findQuery}
                onChange={(e) => setFindQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleFindNext();
                }}
                className="w-full px-3 py-2 rounded-lg border border-amber-200 bg-white"
                placeholder="Nhập chữ/ký tự cần tìm..."
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-slate-600 mb-1">Thay bằng</label>
              <input
                ref={replaceInputRef}
                value={replaceQuery}
                onChange={(e) => setReplaceQuery(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-amber-200 bg-white"
                placeholder="Nhập nội dung thay thế..."
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Phạm vi</label>
              <select
                value={effectiveFindScope}
                onChange={(e) => setFindScope(e.target.value as FindScope)}
                className="w-full px-3 py-2 rounded-lg border border-amber-200 bg-white"
              >
                <option value="original">Văn bản gốc</option>
                <option value="chunks" disabled={chunks.length === 0}>
                  Các đoạn (chunks)
                </option>
                <option value="both" disabled={chunks.length === 0}>
                  Cả hai
                </option>
              </select>
            </div>

            <div className="flex items-end gap-3">
              <label className="flex items-center gap-2 text-sm text-slate-700 select-none">
                <input
                  type="checkbox"
                  checked={findCaseSensitive}
                  onChange={(e) => setFindCaseSensitive(e.target.checked)}
                  className="w-4 h-4 rounded text-amber-600"
                />
                Phân biệt hoa/thường
              </label>
            </div>

            <div className="md:col-span-4 flex flex-wrap gap-2 items-center">
              <button
                onClick={handleFindNext}
                className="px-4 py-2 rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors text-sm font-medium border border-blue-200"
              >
                🔎 Tìm tiếp
              </button>
              <button
                onClick={handleReplaceCurrent}
                className="px-4 py-2 rounded-lg bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors text-sm font-medium border border-amber-200"
              >
                ↔ Thay
              </button>
              <button
                onClick={handleReplaceAll}
                className="px-4 py-2 rounded-lg bg-green-50 text-green-700 hover:bg-green-100 transition-colors text-sm font-medium border border-green-200"
              >
                🧹 Thay tất cả
              </button>

              {lastMatch && (
                <div className="text-xs text-slate-500 ml-auto">
                  Đang chọn:{' '}
                  {lastMatch.key === 'original'
                    ? 'Văn bản gốc'
                    : lastMatch.key.startsWith('chunk:')
                      ? `Đoạn ${lastMatch.key.slice('chunk:'.length)}`
                      : lastMatch.key}
                </div>
              )}
            </div>

            {(effectiveFindScope === 'chunks' || effectiveFindScope === 'both') && chunks.length > 0 && (
              <div className="md:col-span-4 text-xs text-slate-500">
                Lưu ý: Thay thế trong chunks sẽ reset audio/preview của đoạn bị thay.
              </div>
            )}
          </div>
        </div>

        {/* Settings */}
        {chunks.length > 0 && (
          <div className="glass rounded-3xl p-6 shadow-sm border border-amber-100">
            <div className="flex items-center justify-between gap-3 mb-4">
              <div className="flex items-center gap-3">
                <h3 className="text-lg font-bold text-amber-800">Cài Đặt</h3>
                {backendHealth?.ok ? (
                  <span
                    className="text-xs px-2 py-1 rounded-full bg-green-50 text-green-700 border border-green-200"
                    title={backendHealth.encodeBodyLimit ? `ENCODE_BODY_LIMIT=${backendHealth.encodeBodyLimit}` : 'Backend OK'}
                  >
                    Backend: OK
                  </span>
                ) : backendHealthError ? (
                  <span className="text-xs px-2 py-1 rounded-full bg-red-50 text-red-700 border border-red-200" title={backendHealthError}>
                    Backend: lỗi kết nối
                  </span>
                ) : (
                  <span className="text-xs px-2 py-1 rounded-full bg-slate-50 text-slate-700 border border-slate-200">
                    Backend: ...
                  </span>
                )}
              </div>
              <button
                onClick={resetSettings}
                className="px-3 py-2 text-sm rounded-lg border border-slate-200 bg-white hover:bg-slate-50 transition-colors"
                title="Reset phong cách, giọng và SSML nâng cao"
              >
                Reset về mặc định
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Phong cách đọc</label>
                <div className="flex gap-2">
                  <select
                    value={selectedGenre}
                    onChange={(e) => setSelectedGenre(e.target.value as TextGenre)}
                    className="w-full px-3 py-2 rounded-lg border border-amber-200 bg-white"
                  >
                    {Object.values(TextGenre).map(genre => (
                      <option key={genre} value={genre}>{genre}</option>
                    ))}
                  </select>
                  <button
                    onClick={handlePresetPreview}
                    disabled={isPresetPreviewing || (advancedProsodyEnabled && !advancedProsodyValidation.isValid)}
                    className="shrink-0 px-3 py-2 rounded-lg border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors disabled:opacity-50"
                    title="Nghe thử nhanh theo cài đặt hiện tại (tiết kiệm credits)"
                  >
                    {isPresetPreviewing ? '⏳' : '🔊 Nghe nhanh'}
                  </button>
                </div>
                {readingStyle && (
                  <div className="mt-2 p-3 bg-amber-50 rounded-lg border border-amber-100">
                    <p className="text-xs font-medium text-amber-800 mb-1">{readingStyle.name}</p>
                    <p className="text-xs text-amber-600 mb-2">{readingStyle.description}</p>
                    <div className="text-xs text-amber-500 space-y-1">
                      {readingStyle.characteristics.map((char, i) => (
                        <div key={i}>• {char}</div>
                      ))}
                    </div>
                  </div>
                )}
                <div className="mt-3 p-3 bg-white rounded-xl border border-slate-200">
                  <p className="text-xs font-medium text-slate-700">SSML hiệu lực</p>
                  <div className="mt-1 text-xs text-slate-600 flex flex-wrap gap-2">
                    <span className="px-2 py-0.5 bg-slate-100 rounded-full">Rate: {effectiveProsody.rate}</span>
                    <span className="px-2 py-0.5 bg-slate-100 rounded-full">Pitch: {effectiveProsody.pitch || '0st'}</span>
                    <span className="px-2 py-0.5 bg-slate-100 rounded-full">Break: {effectiveProsody.breakTime}</span>
                    {effectiveProsody.isOverridden && (
                      <span className="px-2 py-0.5 bg-amber-100 text-amber-800 rounded-full">Đang override</span>
                    )}
                  </div>
                </div>

                <details className="mt-4 p-3 bg-white rounded-xl border border-slate-200">
                  <summary className="cursor-pointer text-sm font-medium text-slate-700 select-none">
                    Tùy chỉnh SSML nâng cao (tuỳ chọn)
                  </summary>
                  <div className="mt-3">
                    <div className="flex items-center justify-between">
                      <label htmlFor="advanced-prosody" className="text-sm font-medium text-slate-700">
                        Bật override Rate / Pitch / Break
                      </label>
                      <input
                        id="advanced-prosody"
                        type="checkbox"
                        checked={advancedProsodyEnabled}
                        onChange={(e) => setAdvancedProsodyEnabled(e.target.checked)}
                        className="w-4 h-4 text-amber-600 focus:ring-amber-500 border-slate-300 rounded"
                      />
                    </div>
                    <p className="text-xs text-slate-500 mt-2">
                      Preset vẫn dùng bình thường; nếu bạn nhập tham số, hệ thống sẽ override lên preset.
                    </p>

                    <div className={`mt-3 grid gap-3 sm:grid-cols-3 ${advancedProsodyEnabled ? '' : 'opacity-50 pointer-events-none'}`}>
                      <label className="text-xs text-slate-500">
                        Rate (0.50–2.00)
                        <input
                          type="number"
                          min="0.5"
                          max="2.0"
                          step="0.01"
                          value={customRate}
                          onChange={(e) => setCustomRate(e.target.value)}
                          placeholder="Ví dụ 0.90"
                          className={`mt-1 w-full px-2 py-1 text-sm border rounded focus:ring-amber-500 focus:border-amber-500 ${advancedProsodyValidation.errors.rate ? 'border-red-300 bg-red-50' : 'border-slate-200'
                            }`}
                        />
                        {advancedProsodyValidation.errors.rate && (
                          <div className="mt-1 text-[11px] text-red-600">{advancedProsodyValidation.errors.rate}</div>
                        )}
                      </label>
                      <label className="text-xs text-slate-500">
                        Pitch (st)
                        <input
                          type="text"
                          value={customPitch}
                          onChange={(e) => setCustomPitch(e.target.value)}
                          placeholder="-1st / +0.5st"
                          className={`mt-1 w-full px-2 py-1 text-sm border rounded focus:ring-amber-500 focus:border-amber-500 ${advancedProsodyValidation.errors.pitch ? 'border-red-300 bg-red-50' : 'border-slate-200'
                            }`}
                        />
                        {advancedProsodyValidation.errors.pitch && (
                          <div className="mt-1 text-[11px] text-red-600">{advancedProsodyValidation.errors.pitch}</div>
                        )}
                      </label>
                      <label className="text-xs text-slate-500">
                        Break đoạn (ms)
                        <input
                          type="number"
                          min="100"
                          max="2000"
                          step="50"
                          value={customBreakMs}
                          onChange={(e) => setCustomBreakMs(e.target.value)}
                          placeholder="Ví dụ 450"
                          className={`mt-1 w-full px-2 py-1 text-sm border rounded focus:ring-amber-500 focus:border-amber-500 ${advancedProsodyValidation.errors.breakMs ? 'border-red-300 bg-red-50' : 'border-slate-200'
                            }`}
                        />
                        {advancedProsodyValidation.errors.breakMs && (
                          <div className="mt-1 text-[11px] text-red-600">{advancedProsodyValidation.errors.breakMs}</div>
                        )}
                      </label>
                    </div>

                    <div className="mt-3 flex items-center justify-between">
                      <button
                        onClick={resetAdvancedProsody}
                        className="px-3 py-2 text-sm rounded-lg border border-slate-200 bg-white hover:bg-slate-50 transition-colors"
                        type="button"
                      >
                        Reset SSML nâng cao
                      </button>
                      {!advancedProsodyValidation.isValid && advancedProsodyEnabled && (
                        <span className="text-xs text-red-600">Vui lòng sửa lỗi đỏ để tạo/preview audio.</span>
                      )}
                    </div>
                  </div>
                </details>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Giọng đọc</label>
                <select
                  value={selectedVoice}
                  onChange={(e) => setSelectedVoice(e.target.value as VoiceName)}
                  className="w-full px-3 py-2 rounded-lg border border-amber-200 bg-white"
                >
                  {Object.values(VoiceName).map(voice => {
                    const voiceInfo = getVoiceInfo(voice);
                    const tech = voiceInfo.technicalName;
                    const isAvailable = availableVoices ? availableVoices.includes(tech) : true;
                    return (
                      <option
                        key={voice}
                        value={voice}
                        disabled={!isAvailable}
                        title={!isAvailable ? `Voice không có sẵn trong tài khoản của bạn: ${tech}` : voiceInfo.description}
                      >
                        {getVoiceDisplayName(voice)}
                        {!isAvailable ? ' (Không hỗ trợ)' : ''}
                      </option>
                    );
                  })}
                </select>
                <p className="text-xs text-slate-500 mt-1">
                  {getVoiceInfo(selectedVoice).characteristics.join(', ')}
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Phương ngữ</label>
                <div className="text-sm text-slate-600">
                  {useSouthernDialect ? 'Đang chuyển sang phương ngữ Nam (sẽ áp dụng khi phân tích)' : 'Giữ nguyên văn bản gốc'}
                </div>
              </div>
            </div>
            <button
              onClick={handleBatchGenerate}
              disabled={isBatchGenerating || allGenerated}
              className={`mt-4 w-full py-3 rounded-lg font-medium transition-all ${isBatchGenerating || allGenerated
                ? 'bg-slate-300 text-slate-500 cursor-not-allowed'
                : 'bg-gradient-to-r from-amber-600 to-amber-700 text-white hover:shadow-lg'
                }`}
            >
              {isBatchGenerating ? (
                `Đang tạo audio... ${batchProgress}%`
              ) : allGenerated ? (
                '✅ Tất cả đoạn đã có audio'
              ) : (
                '🎧 Tạo Audiobook (Tất cả đoạn)'
              )}
            </button>
          </div>
        )}

        {/* Chunks Display */}
        {chunks.length > 0 && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-xl font-bold text-amber-800">
                Các Đoạn Văn ({chunks.length} đoạn)
              </h3>
              {allGenerated && (
                <button
                  onClick={handleMergeAudio}
                  disabled={isMerging}
                  className={`px-6 py-2 rounded-lg font-medium transition-all ${isMerging
                    ? 'bg-slate-300 text-slate-500 cursor-not-allowed'
                    : 'bg-green-600 text-white hover:bg-green-700'
                    }`}
                >
                  {isMerging ? 'Đang merge...' : '📥 Tải Audiobook Hoàn Chỉnh'}
                </button>
              )}
            </div>

            {chunks.map((chunk) => (
              <div key={chunk.id} className="glass rounded-2xl p-6 shadow-sm border border-amber-100">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="font-bold text-amber-800">Đoạn {chunk.id}</h4>
                      {chunk.isDialectConverted && (
                        <span className="text-xs bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full">Phương ngữ Nam</span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      {chunk.text.length} ký tự
                      {chunk.isGenerated && <span className="ml-2 text-green-600">✓ Đã tạo audio</span>}
                    </p>
                    {(chunk.lastGenre || chunk.lastProsody) && (
                      <div className="text-xs text-slate-500 mt-1 flex flex-wrap gap-2">
                        {chunk.lastGenre && (
                          <span className="px-2 py-0.5 bg-slate-100 rounded-full">
                            Phong cách: {chunk.lastGenre}
                          </span>
                        )}
                        {chunk.lastProsody && (
                          <>
                            <span className="px-2 py-0.5 bg-slate-100 rounded-full">
                              Rate: {chunk.lastProsody.rate}
                            </span>
                            <span className="px-2 py-0.5 bg-slate-100 rounded-full">
                              Pitch: {chunk.lastProsody.pitch || '0st'}
                            </span>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handlePreview(chunk)}
                      disabled={chunk.isPreviewing || !chunk.text.trim()}
                      className="px-3 py-1.5 text-xs rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors disabled:opacity-50"
                      title="Nghe thử 1 câu đầu (tiết kiệm credits)"
                    >
                      {chunk.isPreviewing ? '⏳' : '🔊 Nghe thử (1 câu)'}
                    </button>
                    <button
                      onClick={() => handleGenerateChunk(chunk)}
                      disabled={chunk.isProcessing || !chunk.text.trim()}
                      className="px-3 py-1.5 text-xs rounded-lg bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors disabled:opacity-50"
                    >
                      {chunk.isProcessing ? '⏳' : chunk.isGenerated ? '🎧 Tạo lại' : '🎧 Tạo audio'}
                    </button>
                    {chunk.audioUrl && (
                      <button
                        onClick={() => handlePlayChunk(chunk.id)}
                        className="px-3 py-1.5 text-xs rounded-lg bg-green-50 text-green-700 hover:bg-green-100 transition-colors"
                      >
                        {playingChunkId === chunk.id ? '⏸ Nghe' : '▶ Nghe'}
                      </button>
                    )}
                  </div>
                </div>

                <div className="relative">
                  <textarea
                    value={chunk.text}
                    onChange={(e) => handleChunkTextChange(chunk.id, e.target.value)}
                    ref={(el) => {
                      chunkTextAreaRefs.current[chunk.id] = el;
                    }}
                    className="w-full h-40 p-3 rounded-lg border border-amber-200 focus:ring-2 focus:ring-amber-500 resize-none text-sm bg-white"
                    placeholder="Nội dung đoạn văn..."
                  />

                  {/* Character limit feedback */}
                  <div className="absolute bottom-3 right-3 flex items-center gap-2 pointer-events-none">
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${chunk.text.length > 4500 ? 'bg-red-100 text-red-600' :
                        chunk.text.length > 3000 ? 'bg-amber-100 text-amber-600' :
                          'bg-slate-100 text-slate-500'
                      }`}>
                      {chunk.text.length} / 5000
                    </span>
                    <div className="w-20 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                      <div
                        className={`h-full transition-all ${getCharLimitColor(chunk.text.length)}`}
                        style={{ width: `${Math.min(100, (chunk.text.length / 5000) * 100)}%` }}
                      />
                    </div>
                  </div>
                </div>

                <div className="mt-3 flex gap-2 justify-end">
                  <button
                    onClick={() => handleSplitChunk(chunk.id)}
                    className="px-3 py-1 text-[11px] rounded bg-white border border-slate-200 text-slate-600 hover:bg-amber-50 hover:border-amber-200 transition-colors"
                    title="Chia đoạn này làm hai tại vị trí con trỏ"
                  >
                    ✂ Chia tại con trỏ
                  </button>
                  {chunks.findIndex(c => c.id === chunk.id) < chunks.length - 1 && (
                    <button
                      onClick={() => handleMergeChunk(chunk.id)}
                      className="px-3 py-1 text-[11px] rounded bg-white border border-slate-200 text-slate-600 hover:bg-blue-50 hover:border-blue-200 transition-colors"
                      title="Gộp đoạn này với đoạn kế tiếp"
                    >
                      🔗 Gộp với đoạn sau
                    </button>
                  )}
                  <button
                    onClick={() => handleDeleteChunk(chunk.id)}
                    className="px-3 py-1 text-[11px] rounded bg-white border border-slate-200 text-red-500 hover:bg-red-50 hover:border-red-200 transition-colors"
                    title="Xoá đoạn này"
                  >
                    🗑 Xoá
                  </button>
                </div>

                <audio
                  ref={(el) => { audioRefs.current[chunk.id] = el; }}
                  src={chunk.audioUrl || chunk.previewAudioUrl || undefined}
                  className="hidden"
                  onPlay={() => setPlayingChunkId(chunk.id)}
                  onPause={() => setPlayingChunkId(prev => (prev === chunk.id ? null : prev))}
                />
              </div>
            ))}

            {/* hidden audio ref for preset preview */}
            <audio ref={(el) => { audioRefs.current[-1] = el; }} className="hidden" />
          </div>
        )}

        {/* Merged Audio Player */}
        {mergedAudioUrl && (
          <div className="glass rounded-3xl p-8 shadow-2xl border-2 border-green-300">
            <h3 className="text-xl font-bold mb-4 text-green-800">Audiobook Hoàn Chỉnh</h3>
            <audio controls src={mergedAudioUrl} className="w-full" />
            <a
              href={mergedAudioUrl}
              download={`${fileName?.split('.')[0] || 'audiobook'}_complete.mp3`}
              className="mt-4 inline-block px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-medium"
            >
              📥 Tải Xuống
            </a>
          </div>
        )}
      </main>
    </div>
  );
};

export default App;
