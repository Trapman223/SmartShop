export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export function buildPage<T>(
  items: T[],
  total: number,
  limit: number,
  offset: number,
): Page<T> {
  return {
    items,
    total,
    limit,
    offset,
    hasMore: offset + items.length < total,
  };
}
