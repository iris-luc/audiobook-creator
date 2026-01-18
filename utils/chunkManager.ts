import { cleanText } from './textCleaner';
import { Chunk } from '../types';
import { replaceAllLiteral } from './findReplace';

/**
 * Phân tích và tách văn bản thành các chunk < 3000 ký tự
 */
export function analyzeAndSplitText(text: string, options?: { skipCleaning?: boolean; isDialectConverted?: boolean }): Chunk[] {
  if (!text || text.trim().length === 0) {
    return [];
  }

  // Bước 1: Làm sạch văn bản (nếu cần)
  const cleanedText = options && options.skipCleaning ? text : cleanText(text);

  // Bước 2: Tách thành các đoạn (paragraphs)
  const paragraphs = cleanedText.split(/\n\s*\n/).filter(p => p.trim().length > 0);

  // Bước 3: Tạo chunks từ paragraphs
  const chunks: Chunk[] = [];
  let currentChunk = '';
  let chunkId = 1;

  for (const paragraph of paragraphs) {
    const trimmedParagraph = paragraph.trim();

    // Nếu đoạn hiện tại + đoạn mới <= 3000 ký tự, thêm vào
    if ((currentChunk + '\n\n' + trimmedParagraph).length <= 3000) {
      if (currentChunk) {
        currentChunk += '\n\n' + trimmedParagraph;
      } else {
        currentChunk = trimmedParagraph;
      }
    } else {
      // Lưu chunk hiện tại nếu có
      if (currentChunk) {
        chunks.push({
          id: chunkId++,
          text: currentChunk,
          audioUrl: null,
          isGenerated: false,
          isProcessing: false,
          isPreviewing: false,
          previewAudioUrl: null,
          previewVoice: undefined,
          previewGenre: undefined,
          isDialectConverted: !!options?.isDialectConverted,
        });
      }

      // Xử lý đoạn mới
      if (trimmedParagraph.length <= 3000) {
        currentChunk = trimmedParagraph;
      } else {
        // Đoạn quá dài, cần chia nhỏ hơn
        const subChunks = splitLongParagraph(trimmedParagraph, 3000);
        for (const subChunk of subChunks) {
          chunks.push({
            id: chunkId++,
            text: subChunk,
            audioUrl: null,
            isGenerated: false,
            isProcessing: false,
            isPreviewing: false,
            previewAudioUrl: null,
            previewVoice: undefined,
            previewGenre: undefined,
            isDialectConverted: !!options?.isDialectConverted,
          });
        }
        currentChunk = '';
      }
    }
  }

  // Lưu chunk cuối cùng
  if (currentChunk) {
    chunks.push({
      id: chunkId++,
      text: currentChunk,
      audioUrl: null,
      isGenerated: false,
      isProcessing: false,
      isPreviewing: false,
      previewAudioUrl: null,
      previewVoice: undefined,
      previewGenre: undefined,
      isDialectConverted: !!options?.isDialectConverted,
    });
  }

  return chunks;
}

/**
 * Chia đoạn văn dài thành các chunk nhỏ hơn
 */
function splitLongParagraph(paragraph: string, maxLength: number): string[] {
  const chunks: string[] = [];
  let currentChunk = '';

  // Tách theo câu
  const sentences = paragraph.split(/([.?!。\n]+)/);

  for (const sentence of sentences) {
    const testChunk = currentChunk + sentence;

    if (testChunk.length > maxLength && currentChunk) {
      chunks.push(currentChunk.trim());
      currentChunk = sentence;
    } else {
      currentChunk = testChunk;
    }
  }

  if (currentChunk.trim()) {
    // Nếu chunk cuối vẫn quá dài, chia tại khoảng trắng
    if (currentChunk.length > maxLength) {
      let remaining = currentChunk;
      while (remaining.length > maxLength) {
        const splitPoint = remaining.lastIndexOf(' ', maxLength);
        if (splitPoint > 0) {
          chunks.push(remaining.substring(0, splitPoint).trim());
          remaining = remaining.substring(splitPoint);
        } else {
          // Không tìm thấy khoảng trắng, chia cứng
          chunks.push(remaining.substring(0, maxLength).trim());
          remaining = remaining.substring(maxLength);
        }
      }
      if (remaining.trim()) {
        chunks.push(remaining.trim());
      }
    } else {
      chunks.push(currentChunk.trim());
    }
  }

  return chunks.filter(chunk => chunk.length > 0);
}

/**
 * Cập nhật text của một chunk
 */
export function updateChunkText(chunks: Chunk[], chunkId: number, newText: string): Chunk[] {
  return chunks.map(chunk => {
    if (chunk.id === chunkId) {
      // Nếu text thay đổi, reset audio
      const textChanged = chunk.text !== newText;
      return {
        ...chunk,
        text: newText,
        audioUrl: textChanged ? null : chunk.audioUrl,
        isGenerated: textChanged ? false : chunk.isGenerated,
        previewAudioUrl: textChanged ? null : chunk.previewAudioUrl,
        isPreviewing: textChanged ? false : chunk.isPreviewing,
        previewVoice: textChanged ? undefined : chunk.previewVoice,
        previewGenre: textChanged ? undefined : chunk.previewGenre,
        lastProsody: textChanged ? undefined : chunk.lastProsody,
        lastGenre: textChanged ? undefined : chunk.lastGenre,
        // Nếu người sửa lại đoạn, bỏ cờ đã chuyển phương ngữ (cần chuyển lại nếu muốn)
        isDialectConverted: textChanged ? false : chunk.isDialectConverted,
      };
    }
    return chunk;
  });
}

/**
 * Kiểm tra tất cả chunks đã có audio chưa
 */
export function areAllChunksGenerated(chunks: Chunk[]): boolean {
  return chunks.length > 0 && chunks.every(chunk => chunk.isGenerated && chunk.audioUrl !== null);
}

export function replaceAllInChunks(
  chunks: Chunk[],
  query: string,
  replacement: string,
  options?: { caseSensitive?: boolean }
): { chunks: Chunk[]; count: number } {
  const caseSensitive = options?.caseSensitive ?? true;
  if (!query) return { chunks, count: 0 };

  let nextChunks = chunks;
  let count = 0;

  for (const chunk of chunks) {
    const replaced = replaceAllLiteral(chunk.text, query, replacement, { caseSensitive });
    if (replaced.count === 0) continue;
    count += replaced.count;
    nextChunks = updateChunkText(nextChunks, chunk.id, replaced.text);
  }

  return { chunks: nextChunks, count };
}

/**
 * Chia một chunk thành hai tại vị trí chỉ định
 */
export function splitChunk(chunks: Chunk[], chunkId: number, splitIndex: number): Chunk[] {
  const index = chunks.findIndex(c => c.id === chunkId);
  if (index === -1) return chunks;

  const chunk = chunks[index];
  const textBefore = chunk.text.substring(0, splitIndex).trim();
  const textAfter = chunk.text.substring(splitIndex).trim();

  if (!textBefore || !textAfter) return chunks;

  const newChunks = [...chunks];

  // Cập nhật chunk hiện tại (đoạn đầu)
  newChunks[index] = {
    ...chunk,
    text: textBefore,
    audioUrl: null,
    isGenerated: false,
    isProcessing: false,
    isPreviewing: false,
    previewAudioUrl: null,
  };

  // Thêm chunk mới (đoạn sau)
  const nextChunk: Chunk = {
    id: 0, // Sẽ được re-index bên dưới
    text: textAfter,
    audioUrl: null,
    isGenerated: false,
    isProcessing: false,
    isPreviewing: false,
    previewAudioUrl: null,
    isDialectConverted: chunk.isDialectConverted,
  };

  newChunks.splice(index + 1, 0, nextChunk);

  // Re-index toàn bộ để đảm bảo thứ tự
  return newChunks.map((c, i) => ({ ...c, id: i + 1 }));
}

/**
 * Gộp chunk hiện tại với chunk kế tiếp
 */
export function mergeWithNext(chunks: Chunk[], chunkId: number): Chunk[] {
  const index = chunks.findIndex(c => c.id === chunkId);
  if (index === -1 || index === chunks.length - 1) return chunks;

  const current = chunks[index];
  const next = chunks[index + 1];

  const mergedText = (current.text + '\n\n' + next.text).trim();

  const newChunks = [...chunks];

  // Cập nhật chunk hiện tại
  newChunks[index] = {
    ...current,
    text: mergedText,
    audioUrl: null,
    isGenerated: false,
    isProcessing: false,
    isPreviewing: false,
    previewAudioUrl: null,
    isDialectConverted: current.isDialectConverted && next.isDialectConverted,
  };

  // Xoá chunk kế tiếp
  newChunks.splice(index + 1, 1);

  // Re-index
  return newChunks.map((c, i) => ({ ...c, id: i + 1 }));
}

/**
 * Xoá một chunk
 */
export function deleteChunk(chunks: Chunk[], chunkId: number): Chunk[] {
  const filtered = chunks.filter(c => c.id !== chunkId);
  return filtered.map((c, i) => ({ ...c, id: i + 1 }));
}
