import type { Prisma } from "@prisma/client";

export interface PaginationParams {
  page: number;
  limit: number;
}

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export function parsePagination(query: Record<string, unknown>): PaginationParams {
  const pageRaw = query.page;
  const limitRaw = query.limit;
  const page =
    typeof pageRaw === "string" && /^\d+$/.test(pageRaw)
      ? Math.max(1, parseInt(pageRaw, 10))
      : DEFAULT_PAGE;
  const limit =
    typeof limitRaw === "string" && /^\d+$/.test(limitRaw)
      ? Math.min(MAX_LIMIT, Math.max(1, parseInt(limitRaw, 10)))
      : DEFAULT_LIMIT;
  return { page, limit };
}

export function prismaSkipTake(params: PaginationParams): { skip: number; take: number } {
  return {
    skip: (params.page - 1) * params.limit,
    take: params.limit,
  };
}

export function buildPaginatedMeta(
  total: number,
  params: PaginationParams,
): {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
} {
  const totalPages = Math.max(1, Math.ceil(total / params.limit));
  return {
    page: params.page,
    limit: params.limit,
    total,
    totalPages,
  };
}

export type PrismaTx = Prisma.TransactionClient;
