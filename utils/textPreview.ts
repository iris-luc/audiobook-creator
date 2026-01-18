/**
 * Trích xuất số lượng chữ đầu để preview
 * Mục tiêu: Giảm tối đa credits khi nghe thử
 */

export function extractPreviewText(text: string, maxWords: number = 30): string {
  if (!text || text.trim().length === 0) {
    return '';
  }

  const trimmed = text.trim();
  const words = trimmed.split(/\s+/);
  if (words.length <= maxWords) {
    return trimmed;
  }
  return `${words.slice(0, maxWords).join(' ')}...`;
}

