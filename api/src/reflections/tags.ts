import { parseHashtags } from '@chat/shared';

export type StoredTag = { tag: string; label: string };

export function readStoredTags(raw: unknown): StoredTag[] {
  if (Array.isArray(raw)) {
    return parseHashtags(raw.map((item) => {
      if (typeof item === 'string') return item;
      if (item && typeof item === 'object' && 'tag' in item) {
        return String((item as { label?: string; tag: string }).label ?? (item as { tag: string }).tag);
      }
      return String(item);
    }));
  }
  if (typeof raw === 'string' && raw.trim()) {
    try {
      return readStoredTags(JSON.parse(raw) as unknown);
    } catch {
      return parseHashtags(raw);
    }
  }
  return [];
}

export function tagsJson(tags: StoredTag[]): string {
  return JSON.stringify(tags);
}
