/**
 * Thay ba chấm giữa hai từ thành dấu phẩy để tiết kiệm ký tự và giữ nhịp tự nhiên hơn khi đọc
 * Ví dụ: "Là gì nhỉ? Sally... Sue?" => "Là gì nhỉ? Sally, Sue?"
 */
export function fixEllipsisBetweenWords(text: string): string {
  // Thay "từ... từ" hoặc "từ ... từ" thành "từ, từ"
  return text.replace(/(\w)\s*\.\.\.\s*(\w)/g, '$1, $2');
}
/**
 * Thay dấu '-' thành '.' sau từ 'Chương <số>' để ngắt nhịp hợp lý khi đọc
 * Ví dụ: "Chương 1 - Tiếng nói bên trong" => "Chương 1. Tiếng nói bên trong"
 */
export function fixChapterDash(text: string, separator: string = '.'): string {
  // Regex: tìm "Chương <số> - " hoặc "Chương <số>- "
  return text.replace(/(Chương\s+\d+)\s*-\s+/g, `$1${separator} `);
}
/**
 * Dọn dẹp văn bản để loại bỏ các ký tự không có ý nghĩa
 * Giúp tiết kiệm credits khi gửi lên API
 */

export function cleanText(text: string, options?: { preserveNewlines?: boolean; dashReplacement?: string }): string {
  if (!text || text.trim().length === 0) {
    return '';
  }

  const dashReplacement = options?.dashReplacement ?? ',';

  let cleaned = text;

  // 1. Loại bỏ Markdown syntax (Obsidian, CommonMark, etc.)
  // Wikilink Image Captions: ![[image.png|**Caption**|size]] -> **Caption**, ![[image.png]] -> ""
  cleaned = cleaned.replace(/!\[\[[^\]|]+(?:\|([^\]|]+))?(?:\|[^\]]+)?\]\]/g, (_, caption) => caption || '');

  // Links: [[link]] hoặc [text](url)
  cleaned = cleaned.replace(/\[\[([^\]]+)\]\]/g, '$1'); // [[link]] -> link
  cleaned = cleaned.replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1'); // [text](url) -> text

  // Headers: # ## ###
  cleaned = cleaned.replace(/^#{1,6}\s+/gm, '');

  // Bold/Italic: **text** hoặc *text* hoặc _text_
  cleaned = cleaned.replace(/\*\*([^\*]+)\*\*/g, '$1'); // **bold** -> bold
  cleaned = cleaned.replace(/\*([^\*]+)\*/g, '$1'); // *italic* -> italic
  cleaned = cleaned.replace(/__([^_]+)__/g, '$1'); // __bold__ -> bold
  cleaned = cleaned.replace(/_([^_]+)_/g, '$1'); // _italic_ -> italic

  // Strikethrough: ~~text~~
  cleaned = cleaned.replace(/~~([^~]+)~~/g, '$1');

  // Code blocks: ```code``` hoặc `code`
  cleaned = cleaned.replace(/```[\s\S]*?```/g, ''); // Remove code blocks
  cleaned = cleaned.replace(/`([^`]+)`/g, '$1'); // `code` -> code

  // Images: ![alt](url)
  cleaned = cleaned.replace(/!\[([^\]]*)\]\([^\)]+\)/g, '');

  // Horizontal rules: --- hoặc ***
  cleaned = cleaned.replace(/^[-*]{3,}$/gm, '');

  // Blockquotes: >
  cleaned = cleaned.replace(/^>\s+/gm, '');

  // Lists: - * + hoặc 1. 2.
  cleaned = cleaned.replace(/^[\s]*[-*+]\s+/gm, '');
  cleaned = cleaned.replace(/^[\s]*\d+\.\s+/gm, '');

  // Tags: #tag hoặc #tag/subtag
  cleaned = cleaned.replace(/#[\w\/-]+/g, '');

  // 2. Loại bỏ HTML entities nếu có
  cleaned = cleaned.replace(/&nbsp;/g, ' ');
  cleaned = cleaned.replace(/&amp;/g, '&');
  cleaned = cleaned.replace(/&lt;/g, '<');
  cleaned = cleaned.replace(/&gt;/g, '>');
  cleaned = cleaned.replace(/&quot;/g, '"');
  cleaned = cleaned.replace(/&#39;/g, "'");

  // 3. Loại bỏ whitespace thừa
  cleaned = cleaned.replace(/\r\n/g, '\n'); // Normalize line endings
  cleaned = cleaned.replace(/\r/g, '\n');
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n'); // Max 2 newlines
  // Nếu preserveNewlines=true thì giữ nguyên ngắt dòng và chỉ tối giản khoảng trắng trong dòng
  if (options && options.preserveNewlines) {
    // Trim spaces at line ends/starts but keep line breaks
    cleaned = cleaned.split('\n').map(line => line.replace(/[ \t]+/g, ' ').trim()).join('\n');
  } else {
    cleaned = cleaned.replace(/[ \t]+/g, ' '); // Multiple spaces -> single space
    cleaned = cleaned.replace(/[ \t]+\n/g, '\n'); // Spaces before newline
    cleaned = cleaned.replace(/\n[ \t]+/g, '\n'); // Spaces after newline
  }

  // 4. Loại bỏ các ký tự "nguy hiểm" và emoji (chỉ giữ chữ, số, .,!?;:())
  cleaned = cleaned.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}\u2600-\u26FF\u2700-\u27BF]+/gu, '');
  cleaned = cleaned.replace(/[—]/g, dashReplacement);
  cleaned = cleaned.replace(/[\*\=\#\_\~]{2,}/g, ' ');
  cleaned = cleaned.replace(/-{2,}/g, dashReplacement);
  cleaned = cleaned.replace(/\s+-\s+/g, `${dashReplacement} `);
  cleaned = cleaned.replace(/(\d)[-_](\d)/g, '$1 $2');
  cleaned = cleaned.replace(/([A-Za-zÀ-ỹ])[-/](?=[A-Za-zÀ-ỹ])/g, '$1 ');
  cleaned = cleaned.replace(/[_\/\+\@\=\^]/g, ' ');
  cleaned = cleaned.replace(/-/g, dashReplacement);
  cleaned = cleaned.replace(/[^\p{L}\p{N}\s.,!?;:()]/gu, '');

  // 5. Loại bỏ dòng trống ở đầu và cuối
  cleaned = cleaned.trim();

  // 6. Loại bỏ các đoạn quá ngắn (có thể là formatting artifacts)
  // Giữ lại các dòng có ít nhất 2 ký tự (trừ dòng trống)
  const lines = cleaned.split('\n');
  const filteredLines = lines.filter(line => {
    const trimmed = line.trim();
    return trimmed.length === 0 || trimmed.length >= 2;
  });
  cleaned = filteredLines.join('\n');

  // 7. Loại bỏ khoảng trắng thừa giữa các từ
  // Chuyển khoảng trống giữa đoạn thành dấu chấm để giữ nhịp (khoảng trống > 1 newline)
  cleaned = cleaned.replace(/\n{2,}/g, '. ');
  // Nếu preserveNewlines, chỉ collapse spaces within lines to keep line breaks
  if (options && options.preserveNewlines) {
    cleaned = cleaned.split('\n').map(line => line.replace(/\s+/g, ' ').trim()).join('\n');
  } else {
    cleaned = cleaned.replace(/\s+/g, ' ');
  }

  // Thay dấu '-' sau "Chương <số>" thành dấu ngắt nhịp
  cleaned = fixChapterDash(cleaned, dashReplacement === ',' ? '.' : dashReplacement);
  // Thay ba chấm giữa hai từ thành dấu phẩy
  cleaned = fixEllipsisBetweenWords(cleaned);
  // 8. Final trim
  cleaned = cleaned.trim();

  return cleaned;
}

/**
 * Thống kê số ký tự đã loại bỏ
 */
export function getCleanStats(original: string, cleaned: string): {
  originalLength: number;
  cleanedLength: number;
  removed: number;
  percentage: number;
} {
  const originalLength = original.length;
  const cleanedLength = cleaned.length;
  const removed = originalLength - cleanedLength;
  const percentage = originalLength > 0
    ? Math.round((removed / originalLength) * 100)
    : 0;

  return {
    originalLength,
    cleanedLength,
    removed,
    percentage
  };
}
