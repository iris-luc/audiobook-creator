import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import * as textToSpeech from '@google-cloud/text-to-speech';
import { spawn } from 'child_process';
import os from 'os';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

// --- START REFACTOR ---
// Refactored to use shared voice map and add caching
import { VOICE_MAP } from './utils/voiceMap.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cacheDir = path.join(__dirname, 'cache');

const app = express();
app.use(cors());
app.use(express.json({ limit: '200mb' }));

const ttsClient = new textToSpeech.TextToSpeechClient();

const AVAILABLE_VOICES = new Set(Object.values(VOICE_MAP));
const DEFAULT_VOICE = Object.values(VOICE_MAP)[0] || 'vi-VN-Standard-A';
const CACHE_ENABLED = process.env.CACHE_ENABLED !== 'false';
const ENCODE_BODY_LIMIT = process.env.ENCODE_BODY_LIMIT || '1024mb';
const CACHE_TTL_DAYS = Number.parseInt(process.env.CACHE_TTL_DAYS || '7', 10);
const CACHE_MAX_GB = Number.parseFloat(process.env.CACHE_MAX_GB || '2');
const CACHE_TTL_MS = Number.isFinite(CACHE_TTL_DAYS) ? CACHE_TTL_DAYS * 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
const CACHE_MAX_BYTES = Number.isFinite(CACHE_MAX_GB) ? Math.floor(CACHE_MAX_GB * 1024 * 1024 * 1024) : 2 * 1024 * 1024 * 1024;

import STYLE_CONFIG from './utils/readingStyles.config.js';

const MALE_VOICES = ['vi-VN-Standard-D', 'vi-VN-Standard-B'];
const FEMALE_VOICES = ['vi-VN-Standard-C', 'vi-VN-Standard-A'];

const PARAGRAPH_BREAK = (breakTime) => `<break time="${breakTime}"/>`;

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Promise Rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getErrorCode(err) {
  if (!err) return undefined;
  return err.code ?? err.statusCode ?? err.status;
}

function isRateLimitError(err) {
  const code = getErrorCode(err);
  if (code === 8 || code === 429) return true; // gRPC RESOURCE_EXHAUSTED / HTTP Too Many Requests
  const message = (err?.message || '').toString();
  return /resource_exhausted|quota|rate limit|too many requests/i.test(message);
}

function isRetryableTtsError(err) {
  const code = getErrorCode(err);
  if (isRateLimitError(err)) return true;
  if (code === 14 || code === 503) return true; // gRPC UNAVAILABLE / HTTP Service Unavailable
  const message = (err?.message || '').toString();
  return /unavailable|timed out|timeout|econnreset|socket hang up/i.test(message);
}

async function ensureCacheDir() {
  if (!CACHE_ENABLED) return;
  try {
    await fs.mkdir(cacheDir, { recursive: true });
  } catch (error) {
    console.error('Error creating cache directory:', error);
  }
}

// --- END REFACTOR ---

let isCacheCleanupRunning = false;
async function cleanupCache() {
  if (!CACHE_ENABLED) return;
  if (isCacheCleanupRunning) return;
  isCacheCleanupRunning = true;

  try {
    const now = Date.now();
    const entries = await fs.readdir(cacheDir).catch(() => []);
    const files = entries.filter((name) => name.endsWith('.json'));

    const kept = [];
    let deletedExpired = 0;

    // 1) TTL cleanup (by mtime)
    for (const name of files) {
      const filePath = path.join(cacheDir, name);
      try {
        const stat = await fs.stat(filePath);
        const ageMs = now - stat.mtimeMs;
        if (ageMs > CACHE_TTL_MS) {
          await fs.unlink(filePath).catch(() => { });
          deletedExpired++;
          continue;
        }
        kept.push({ filePath, size: stat.size, mtimeMs: stat.mtimeMs });
      } catch {
        // ignore broken entries
      }
    }

    // 2) Size limit cleanup (delete oldest first)
    let totalBytes = kept.reduce((sum, f) => sum + f.size, 0);
    let deletedBySize = 0;
    if (totalBytes > CACHE_MAX_BYTES) {
      kept.sort((a, b) => a.mtimeMs - b.mtimeMs);
      for (const f of kept) {
        if (totalBytes <= CACHE_MAX_BYTES) break;
        try {
          await fs.unlink(f.filePath).catch(() => { });
          totalBytes -= f.size;
          deletedBySize++;
        } catch {
          // ignore
        }
      }
    }

    if (deletedExpired || deletedBySize) {
      console.log(
        `[CACHE CLEANUP] TTL deleted=${deletedExpired}, size deleted=${deletedBySize}, totalBytes=${totalBytes}`
      );
    }
  } catch (err) {
    console.error('Cache cleanup error:', err);
  } finally {
    isCacheCleanupRunning = false;
  }
}

function parseSampleRate(mimeType, fallback = 24000) {
  if (!mimeType) return fallback;
  const match = mimeType.match(/rate=(\d+)/i);
  if (!match) return fallback;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function escapeSsml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function resolveStyleConfig(genre) {
  if (genre && STYLE_CONFIG[genre]) {
    return STYLE_CONFIG[genre];
  }
  const fallback = STYLE_CONFIG['Thông thường'] || Object.values(STYLE_CONFIG)[0];
  return fallback;
}

function resolveProsody(genre, voiceName) {
  const style = resolveStyleConfig(genre);
  let pitch = style.pitchDefault;
  if (MALE_VOICES.includes(voiceName)) {
    pitch = style.pitchMale;
  } else if (FEMALE_VOICES.includes(voiceName)) {
    pitch = style.pitchFemale;
  }
  return {
    rate: style.rate,
    pitch,
    breakTime: style.breakTime,
  };
}

function buildSsml(text, prosody) {
  const normalized = text.replace(/\r\n/g, '\n');
  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((part) => part.replace(/\n/g, ' ').trim())
    .filter(Boolean);

  const paragraphBreak = PARAGRAPH_BREAK(prosody.breakTime || '500ms');
  const escapedText = paragraphs.map(escapeSsml).join(paragraphBreak);
  const pitchAttr = prosody.pitch ? ` pitch="${prosody.pitch}"` : '';

  return `<speak><prosody rate="${prosody.rate}"${pitchAttr}>${escapedText}</prosody></speak>`;
}

function encodeToMp3(inputBuffer, inputMimeType) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const safeResolve = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const safeReject = (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    };

    const args = ['-hide_banner', '-loglevel', 'error'];
    if (inputMimeType && /audio\/L16|audio\/pcm|audio\/linear16/i.test(inputMimeType)) {
      const sampleRate = parseSampleRate(inputMimeType, 24000);
      args.push('-f', 's16le', '-ar', String(sampleRate), '-ac', '1', '-i', 'pipe:0');
    } else {
      // wav/mp3/etc
      args.push('-i', 'pipe:0');
    }

    // MP3 is streamable, so we can output to stdout safely.
    args.push('-c:a', 'libmp3lame', '-b:a', '96k', '-f', 'mp3', 'pipe:1');

    const ffmpeg = spawn('ffmpeg', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const stdout = [];
    const stderr = [];

    ffmpeg.stdout.on('data', (chunk) => stdout.push(chunk));
    ffmpeg.stderr.on('data', (chunk) => stderr.push(chunk));
    ffmpeg.on('error', (err) => safeReject(err));
    ffmpeg.on('close', (code) => {
      if (code === 0) {
        safeResolve(Buffer.concat(stdout));
        return;
      }
      safeReject(new Error(Buffer.concat(stderr).toString() || `ffmpeg exited with code ${code}`));
    });

    // Avoid crashing the whole server if the client disconnects mid-stream (EPIPE).
    ffmpeg.stdin.on('error', (err) => {
      if (err && err.code === 'EPIPE') return;
      safeReject(err);
    });

    try {
      ffmpeg.stdin.end(inputBuffer);
    } catch (err) {
      safeReject(err);
    }
  });
}

app.post('/api/tts', async (req, res) => {
  try {
    const { text, voice, genre, customProsody } = req.body;

    if (!text) {
      return res.status(400).json({ error: 'Text is required' });
    }

    const trimmedText = text.trim();
    if (!trimmedText) {
      return res.status(400).json({ error: 'Text không được rỗng' });
    }

    const allTechnicalNames = Object.values(VOICE_MAP);
    const voiceName = VOICE_MAP[voice] || (allTechnicalNames.includes(voice) ? voice : DEFAULT_VOICE);

    if (!AVAILABLE_VOICES.has(voiceName)) {
      const available = Array.from(AVAILABLE_VOICES).join(', ');
      return res.status(400).json({ error: `Voice không được hỗ trợ: ${voiceName}. Các voice hiện có: ${available}` });
    }

    const finalGenre = genre || 'Thông thường';
    const prosody = resolveProsody(finalGenre, voiceName);
    const customHasValue = customProsody && (customProsody.rate || customProsody.pitch || customProsody.breakTime);
    const finalProsody = customHasValue
      ? {
        rate: typeof customProsody.rate === 'number' ? customProsody.rate : prosody.rate,
        pitch: customProsody.pitch || prosody.pitch,
        breakTime: customProsody.breakTime || prosody.breakTime,
      }
      : prosody;
    const paragraphBreak = PARAGRAPH_BREAK(finalProsody.breakTime || '500ms');
    const ssml = buildSsml(trimmedText, finalProsody);

    // --- START REFACTOR: Caching logic ---
    const cacheKey = crypto
      .createHash('sha256')
      .update(JSON.stringify({ ssml, voice: voiceName }))
      .digest('hex');
    const cacheFile = path.join(cacheDir, `${cacheKey}.json`);

    if (CACHE_ENABLED) {
      try {
        const cachedData = await fs.readFile(cacheFile, 'utf-8');
        console.log(`[CACHE HIT] Serving TTS from cache for voice: ${voiceName}`);
        return res.json(JSON.parse(cachedData));
      } catch (error) {
        // File not found, proceed to generate
      }
    }
    // --- END REFACTOR ---

    console.log(`[CACHE MISS] Calling Cloud TTS with voice: ${voiceName}`);

    const TTS_MAX_RETRIES = Number.parseInt(process.env.TTS_MAX_RETRIES || '4', 10);
    const TTS_RETRY_BASE_MS = Number.parseInt(process.env.TTS_RETRY_BASE_MS || '500', 10);
    const TTS_RETRY_MAX_MS = Number.parseInt(process.env.TTS_RETRY_MAX_MS || '8000', 10);

    let response;
    let lastTtsError;
    for (let attempt = 0; attempt <= TTS_MAX_RETRIES; attempt++) {
      try {
        const [ttsResponse] = await ttsClient.synthesizeSpeech({
          input: { ssml },
          voice: {
            languageCode: 'vi-VN',
            name: voiceName,
          },
          audioConfig: {
            audioEncoding: 'MP3',
            // sampleRateHertz: 24000, // MP3 uses its own sample rate, setting this might be ignored or causes issues with MP3
          },
        });
        response = ttsResponse;
        lastTtsError = undefined;
        break;
      } catch (err) {
        lastTtsError = err;

        if (attempt >= TTS_MAX_RETRIES || !isRetryableTtsError(err)) {
          break;
        }

        const rawDelay = Math.min(TTS_RETRY_MAX_MS, TTS_RETRY_BASE_MS * Math.pow(2, attempt));
        const jitter = 0.7 + Math.random() * 0.6;
        const delayMs = Math.floor(rawDelay * jitter);

        console.warn(
          `[TTS RETRY] attempt=${attempt + 1}/${TTS_MAX_RETRIES} code=${getErrorCode(err)} delayMs=${delayMs} message=${err?.message || err}`
        );
        await sleep(delayMs);
      }
    }

    if (!response) {
      if (isRateLimitError(lastTtsError)) {
        return res.status(429).json({
          error:
            'Google TTS đang bị giới hạn (429/RESOURCE_EXHAUSTED). Hãy thử lại sau ít phút hoặc giảm concurrency.',
        });
      }
      throw lastTtsError;
    }

    if (!response.audioContent) {
      console.warn('Cloud TTS response missing audio data.');
      return res.status(500).json({ error: 'Không thể tạo dữ liệu âm thanh từ Cloud TTS.' });
    }

    const audioBuffer =
      typeof response.audioContent === 'string'
        ? Buffer.from(response.audioContent, 'base64')
        : Buffer.from(response.audioContent);

    const meta = {
      style: finalGenre,
      genre: finalGenre,
      voice: voiceName,
      prosody: finalProsody,
      paragraphBreak,
      textLength: trimmedText.length,
      customProsody: customHasValue ? customProsody : undefined,
    };

    const result = {
      audioContent: audioBuffer.toString('base64'),
      mimeType: 'audio/mpeg',
      meta,
    };

    // --- START REFACTOR: Save to cache ---
    if (CACHE_ENABLED) {
      try {
        await fs.writeFile(cacheFile, JSON.stringify(result), 'utf-8');
        console.log(`[CACHE WRITE] Saved TTS result to cache for voice: ${voiceName}`);
        // Run cleanup in background to enforce TTL + size limits
        cleanupCache().catch(() => { });
      } catch (error) {
        console.error('Error writing to cache:', error);
      }
    }
    // --- END REFACTOR ---

    res.json(result);
  } catch (error) {
    console.error('Error synthesizing speech:', error);
    let errorMessage = 'An unknown error occurred during speech synthesis.';
    if (error instanceof Error) {
      errorMessage = error.message;
      if (error.message.includes('voice')) {
        errorMessage = `Voice không hợp lệ. Voice được yêu cầu: ${req.body.voice || 'unknown'}. Vui lòng chọn voice hợp lệ.`;
      }
    }
    res.status(500).json({ error: errorMessage });
  }
});

app.post(
  '/api/encode',
  express.raw({
    type: [
      'audio/wav',
      'audio/mpeg',
      'audio/L16',
      'audio/pcm',
      'audio/linear16',
      'application/octet-stream',
    ],
    limit: ENCODE_BODY_LIMIT,
  }),
  async (req, res) => {
    try {
      let inputBuffer = null;
      let inputMimeType = req.headers['content-type'];

      if (Buffer.isBuffer(req.body) && req.body.length > 0) {
        inputBuffer = req.body;
      } else if (req.body && req.body.audioContent) {
        inputBuffer = Buffer.from(req.body.audioContent, 'base64');
        inputMimeType = req.body.mimeType || inputMimeType;
      }

      if (!inputBuffer) {
        return res.status(400).json({ error: 'audioContent is required' });
      }

      const encoded = await encodeToMp3(inputBuffer, inputMimeType);
      res.setHeader('Content-Type', 'audio/mpeg');
      res.send(encoded);
    } catch (error) {
      console.error('Error encoding audio:', error);
      res.status(500).json({ error: error.message || 'Failed to encode audio' });
    }
  }
);

// Friendly error for large payloads (e.g., big merged WAV)
app.use((err, req, res, next) => {
  if (err && (err.type === 'entity.too.large' || err.status === 413)) {
    return res.status(413).json({
      error:
        'File audio quá lớn để encode qua API. Hãy thử giảm độ dài, merge ít đoạn hơn mỗi lần, hoặc tăng ENCODE_BODY_LIMIT (ví dụ: 1024mb).',
    });
  }
  return next(err);
});

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    cacheEnabled: CACHE_ENABLED,
    cacheTtlDays: CACHE_TTL_DAYS,
    cacheMaxGb: CACHE_MAX_GB,
    encodeBodyLimit: ENCODE_BODY_LIMIT,
    defaultVoice: DEFAULT_VOICE,
  });
});

// Endpoint: list available voices (useful for debugging available provider voices)
app.get('/api/voices', async (req, res) => {
  try {
    const voices = Array.from(AVAILABLE_VOICES).map(name => ({ name }));
    res.json({ voices });
  } catch (err) {
    console.error('Error listing voices:', err.message || err);
    res.status(500).json({ error: err.message || 'Failed to list voices' });
  }
});

// ====== GOOGLE DRIVE AUDIO PROXY ======
// Proxy endpoint to stream audio from Google Drive (bypasses CORS)
app.get('/api/drive-audio/:fileId', async (req, res) => {
  const { fileId } = req.params;
  if (!fileId || fileId.length < 10) {
    return res.status(400).json({ error: 'Invalid file ID' });
  }

  try {
    const fetch = (await import('node-fetch')).default;
    const rangeHeader = req.headers.range;

    const baseHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': '*/*',
    };

    const getSetCookieHeader = (response) => {
      try {
        // node-fetch exposes raw() for multi-value headers
        const raw = response.headers.raw?.();
        const cookies = raw?.['set-cookie'] || [];
        if (!cookies.length) return undefined;
        return cookies.map(c => c.split(';')[0]).join('; ');
      } catch {
        return undefined;
      }
    };

    const isProbablyHtml = (contentType) => {
      if (!contentType) return false;
      return contentType.includes('text/html') || contentType.includes('text/plain');
    };

    const makeDriveUrl = (confirmToken) => {
      const base = `https://drive.google.com/uc?export=download&id=${fileId}`;
      return confirmToken ? `${base}&confirm=${encodeURIComponent(confirmToken)}` : base;
    };

    const fetchDrive = async ({ confirmToken, cookie, range }) => {
      const headers = { ...baseHeaders };
      if (cookie) headers['Cookie'] = cookie;
      if (range) headers['Range'] = range;
      return fetch(makeDriveUrl(confirmToken), { redirect: 'follow', headers });
    };

    // First try: honor Range directly (better for streaming)
    let driveResponse = await fetchDrive({ confirmToken: undefined, cookie: undefined, range: rangeHeader });
    let cookie = getSetCookieHeader(driveResponse);
    let contentType = driveResponse.headers.get('content-type') || '';

    // If Drive returns an HTML confirmation / permission page, parse confirm token then retry.
    if (driveResponse.ok && isProbablyHtml(contentType)) {
      const html = await driveResponse.text();
      // Typical pattern contains confirm=<token>
      const m = html.match(/confirm=([0-9A-Za-z_\-]+)&/);
      const confirmToken = m?.[1];

      if (!confirmToken) {
        // Likely not public / requires login, or unexpected page.
        return res.status(403).json({
          error: 'Google Drive trả về trang HTML (có thể file chưa public hoặc cần xác nhận tải). Hãy bật Share: Anyone with the link → Viewer.'
        });
      }

      // Retry with confirm token. If the client requested Range, keep it.
      driveResponse = await fetchDrive({ confirmToken, cookie, range: rangeHeader });
      contentType = driveResponse.headers.get('content-type') || '';
    }

    if (!driveResponse.ok) {
      return res.status(driveResponse.status).json({ error: 'Failed to fetch from Google Drive' });
    }

    // If still HTML, bail early (not playable)
    if (isProbablyHtml(contentType)) {
      return res.status(415).json({
        error: `Google Drive không trả về audio (content-type=${contentType || 'unknown'}). File có thể chưa public hoặc link không đúng.`
      });
    }

    // Forward important headers (especially for Range/seek)
    res.setHeader('Content-Type', contentType || 'application/octet-stream');
    res.setHeader('Accept-Ranges', driveResponse.headers.get('accept-ranges') || 'bytes');

    const contentLength = driveResponse.headers.get('content-length');
    if (contentLength) res.setHeader('Content-Length', contentLength);

    const contentRange = driveResponse.headers.get('content-range');
    if (contentRange) res.setHeader('Content-Range', contentRange);

    const cacheControl = driveResponse.headers.get('cache-control');
    if (cacheControl) res.setHeader('Cache-Control', cacheControl);

    // Propagate status (200 or 206)
    res.status(driveResponse.status);

    // Stream body
    driveResponse.body.pipe(res);
  } catch (error) {
    console.error('Drive proxy error:', error);
    res.status(500).json({ error: 'Proxy error: ' + error.message });
  }
});

// Final JSON error handler (avoid Express default HTML errors)
app.use((err, req, res, next) => {
  if (!err) return next();
  if (res.headersSent) return next(err);

  const isBodySyntaxError = err instanceof SyntaxError && err.message?.includes('JSON');
  const status = err.status || (isBodySyntaxError ? 400 : 500);

  const message =
    status === 400 && isBodySyntaxError
      ? 'Request JSON không hợp lệ.'
      : err.message || 'Internal server error';

  console.error('Unhandled Express error:', err);
  res.status(status).json({ error: message });
});

const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0'; // Cho phép truy cập từ mọi interface

// Lấy IP address của máy
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

app.listen(PORT, HOST, async () => {
  await ensureCacheDir(); // Ensure cache directory exists on startup
  await cleanupCache(); // Best-effort cleanup on startup
  setInterval(() => cleanupCache().catch(() => { }), 60 * 60 * 1000).unref?.(); // hourly
  const localIP = getLocalIP();
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📝 API endpoint: http://localhost:${PORT}/api/tts`);
  console.log(`🌐 External access: http://${localIP}:${PORT}`);
  console.log(`   (Truy cập từ máy khác trong cùng mạng)`);
  console.log(`💡 TTS Caching is ${CACHE_ENABLED ? 'ENABLED' : 'DISABLED'}`);
});
