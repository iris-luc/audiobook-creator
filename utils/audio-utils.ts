
export function decodeBase64(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

function parseSampleRate(mimeType: string, fallback: number = 24000): number {
  const match = mimeType.match(/rate=(\d+)/i);
  if (!match) return fallback;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

export function concatenateUint8Arrays(arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((acc, arr) => acc + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

// Tạo audio blob từ base64 với mime type phù hợp
export function createAudioBlobFromBase64(base64Audio: string, mimeType: string = 'audio/mpeg'): Blob {
  const audioBytes = decodeBase64(base64Audio);
  const isPcm = /audio\/L16|audio\/pcm|audio\/linear16/i.test(mimeType);
  if (isPcm) {
    const sampleRate = parseSampleRate(mimeType, 24000);
    return createWavBlob(audioBytes, sampleRate);
  }
  return new Blob([audioBytes], { type: mimeType || 'audio/mpeg' });
}

// Concatenate MP3 files (đơn giản nối bytes, có thể cần decoder phức tạp hơn)
export function concatenateMp3Blobs(blobs: Blob[]): Promise<Blob> {
  return new Promise(async (resolve) => {
    if (blobs.length === 0) {
      resolve(new Blob([], { type: 'audio/mpeg' }));
      return;
    }
    
    const arrays = await Promise.all(blobs.map(blob => blob.arrayBuffer()));
    const concatenated = new Uint8Array(
      arrays.reduce((acc, arr) => acc + arr.byteLength, 0)
    );
    let offset = 0;
    for (const arr of arrays) {
      concatenated.set(new Uint8Array(arr), offset);
      offset += arr.byteLength;
    }
    resolve(new Blob([concatenated], { type: 'audio/mpeg' }));
  });
}

/**
 * Merge multiple audio URLs (MP3) thành một file duy nhất
 */
export async function mergeAudioUrls(audioUrls: string[]): Promise<Blob> {
  if (audioUrls.length === 0) {
    throw new Error('Không có audio để merge');
  }

  const blobs: Blob[] = [];
  
  for (const url of audioUrls) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        console.warn(`Failed to fetch audio: ${url}`);
        continue;
      }
      const blob = await response.blob();
      blobs.push(blob);
    } catch (error) {
      console.error(`Error fetching audio ${url}:`, error);
    }
  }

  if (blobs.length === 0) {
    throw new Error('Không thể tải bất kỳ audio nào');
  }

  const allWav = blobs.every(blob => blob.type === 'audio/wav');
  if (allWav) {
    return concatenateWavBlobs(blobs);
  }
  return concatenateMp3Blobs(blobs);
}

function concatenateWavBlobs(blobs: Blob[]): Promise<Blob> {
  return new Promise(async (resolve) => {
    const pcmChunks: Uint8Array[] = [];
    let sampleRate = 24000;

    for (const blob of blobs) {
      const buffer = await blob.arrayBuffer();
      if (buffer.byteLength <= 44) continue;
      const view = new DataView(buffer);
      const rate = view.getUint32(24, true);
      if (rate) sampleRate = rate;
      pcmChunks.push(new Uint8Array(buffer, 44));
    }

    if (pcmChunks.length === 0) {
      resolve(new Blob([], { type: 'audio/wav' }));
      return;
    }

    const mergedPcm = concatenateUint8Arrays(pcmChunks);
    resolve(createWavBlob(mergedPcm, sampleRate));
  });
}

// Giữ lại cho tương thích (nếu cần WAV)
export function createWavBlob(pcmData: Uint8Array, sampleRate: number = 24000): Blob {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = pcmData.length;
  const headerSize = 44;
  const totalSize = headerSize + dataSize;

  const buffer = new ArrayBuffer(headerSize);
  const view = new DataView(buffer);

  // RIFF identifier
  view.setUint32(0, 0x52494646, false); // "RIFF"
  view.setUint32(4, totalSize - 8, true);
  view.setUint32(8, 0x57415645, false); // "WAVE"

  // FMT chunk
  view.setUint32(12, 0x666d7420, false); // "fmt "
  view.setUint32(16, 16, true); // Subchunk1Size
  view.setUint16(20, 1, true); // AudioFormat (1 for PCM)
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  // Data chunk
  view.setUint32(36, 0x64617461, false); // "data"
  view.setUint32(40, dataSize, true);

  return new Blob([buffer, pcmData], { type: 'audio/wav' });
}
