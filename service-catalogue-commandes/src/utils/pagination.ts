export const DEFAULT_PAGE = 1;
export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

export interface Pagination {
  page: number;
  limit: number;
  skip: number;
  take: number;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export function buildPagination(page: number, limit: number): Pagination {
  const safeLimit = Math.min(limit, MAX_LIMIT);
  return {
    page,
    limit: safeLimit,
    skip: (page - 1) * safeLimit,
    take: safeLimit,
  };
}

export function buildMeta(pagination: Pagination, total: number): PaginationMeta {
  return {
    page: pagination.page,
    limit: pagination.limit,
    total,
    totalPages: pagination.limit > 0 ? Math.ceil(total / pagination.limit) : 0,
  };
}
