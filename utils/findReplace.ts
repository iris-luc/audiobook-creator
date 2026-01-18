export type FindReplaceItem = {
  key: string;
  text: string;
};

export type FindReplaceMatch = {
  key: string;
  itemIndex: number;
  start: number;
  end: number;
};

function normalize(input: string, caseSensitive: boolean): string {
  return caseSensitive ? input : input.toLowerCase();
}

export function findNextMatch(
  items: FindReplaceItem[],
  query: string,
  options: { caseSensitive: boolean },
  from?: { itemIndex: number; offset: number }
): FindReplaceMatch | null {
  const trimmedQuery = query;
  if (!trimmedQuery) return null;
  if (items.length === 0) return null;

  const needle = normalize(trimmedQuery, options.caseSensitive);

  const startItemIndex =
    from && Number.isInteger(from.itemIndex) && from.itemIndex >= 0 && from.itemIndex < items.length ? from.itemIndex : 0;
  const startOffset = from && Number.isInteger(from.offset) && from.offset >= 0 ? from.offset : 0;

  for (let i = 0; i < items.length; i++) {
    const itemIndex = (startItemIndex + i) % items.length;
    const item = items[itemIndex];
    const haystack = normalize(item.text, options.caseSensitive);
    const offset = i === 0 ? startOffset : 0;

    const start = haystack.indexOf(needle, offset);
    if (start === -1) continue;

    return {
      key: item.key,
      itemIndex,
      start,
      end: start + trimmedQuery.length,
    };
  }

  return null;
}

export function textMatchesAt(
  text: string,
  start: number,
  end: number,
  query: string,
  options: { caseSensitive: boolean }
): boolean {
  if (start < 0 || end < start || end > text.length) return false;
  const slice = text.slice(start, end);
  if (options.caseSensitive) return slice === query;
  return slice.toLowerCase() === query.toLowerCase();
}

export function replaceAtRange(text: string, start: number, end: number, replacement: string): string {
  if (start < 0 || end < start || start > text.length) return text;
  return text.slice(0, start) + replacement + text.slice(end);
}

export function replaceAllLiteral(
  text: string,
  query: string,
  replacement: string,
  options: { caseSensitive: boolean }
): { text: string; count: number } {
  if (!query) return { text, count: 0 };
  if (text.length === 0) return { text, count: 0 };

  if (options.caseSensitive) {
    if (!text.includes(query)) return { text, count: 0 };
    const parts = text.split(query);
    return { text: parts.join(replacement), count: parts.length - 1 };
  }

  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();

  let result = '';
  let offset = 0;
  let count = 0;

  while (true) {
    const index = haystack.indexOf(needle, offset);
    if (index === -1) break;
    result += text.slice(offset, index) + replacement;
    offset = index + query.length;
    count += 1;
  }

  if (count === 0) return { text, count: 0 };
  result += text.slice(offset);
  return { text: result, count };
}

