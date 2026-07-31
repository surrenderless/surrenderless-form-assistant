/**
 * Test-only mock support for the `applyKeysetCursor`/`nextKeysetCursor` pagination chain used
 * by reconciler crons (see `reconcilerKeysetPagination.ts`). Not imported by any production
 * code — only by `*.test.ts` files that need to simulate a real Postgres `ORDER BY updated_at,
 * id` + composite keyset filter against an in-memory row array.
 */

export type KeysetMockRow = { id: string; updated_at: string };

/** Parses the exact filter string `applyKeysetCursor` generates back into a cursor. */
export function parseKeysetOrFilter(filter: string): { updatedAt: string; id: string } | null {
  const match = filter.match(/^updated_at\.gt\.(.*),and\(updated_at\.eq\.(.*),id\.gt\.(.*)\)$/);
  if (!match) return null;
  return { updatedAt: match[1], id: match[3] };
}

export function sortByUpdatedAtThenId<T extends KeysetMockRow>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    if (a.updated_at !== b.updated_at) return a.updated_at < b.updated_at ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * Builds the `.or()?.order().order().limit()` suffix of a mocked query chain. `getCandidates`
 * should return the current rows matching every filter applied BEFORE the pagination clause
 * (e.g. `.is("archived_at", null)`), re-evaluated fresh each call so a test can mutate/insert
 * rows mid-scan the same way real reconciler processing does.
 */
export function keysetPaginatedTerminal<T extends KeysetMockRow>(getCandidates: () => T[]) {
  function orderAndLimit(rows: T[]) {
    const sorted = sortByUpdatedAtThenId(rows);
    return {
      order: () => ({
        order: () => ({
          limit: async (n: number) => ({ data: sorted.slice(0, n), error: null }),
        }),
      }),
    };
  }

  return {
    or: (filter: string) => {
      const cursor = parseKeysetOrFilter(filter);
      if (!cursor) {
        throw new Error(`keysetPaginatedTerminal: unparseable .or() filter: ${filter}`);
      }
      const filtered = getCandidates().filter(
        (row) =>
          row.updated_at > cursor.updatedAt ||
          (row.updated_at === cursor.updatedAt && row.id > cursor.id)
      );
      return orderAndLimit(filtered);
    },
    ...orderAndLimit(getCandidates()),
  };
}
