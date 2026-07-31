/**
 * Shared keyset ("seek method") pagination for reconciler cron scans over `justice_cases` /
 * `justice_case_tasks`. Stable oldest-first order: `updated_at ASC, id ASC` (id breaks ties
 * within the same timestamp, since many rows can share one).
 *
 * Why keyset, not offset (`.range(offset, offset + pageSize - 1)`): offset pagination identifies
 * a page by position ("skip N rows"), so if a row's `updated_at` changes while a scan is in
 * progress — exactly what happens here, since these reconcilers write to the very rows/cases
 * they're scanning — a row can shift across the page boundary and either be skipped entirely or
 * revisited, depending on which direction it moved. Keyset pagination instead identifies a page
 * by content ("rows strictly after this specific (updated_at, id) I've already seen"), which is
 * immune to that: a row already returned can never re-enter a later page (its position only
 * moves forward, past pages we won't reach again this run), and a row not yet reached is either
 * still ahead of the cursor (found on the next page, as normal) or has jumped to "now" without
 * us having touched it yet (also still ahead of the cursor — found normally). Nothing is skipped.
 *
 * The cursor predicate MUST be evaluated server-side as a true composite comparison:
 * `updated_at > cursor.updatedAt OR (updated_at = cursor.updatedAt AND id > cursor.id)`.
 * A `.gte("updated_at", cursor.updatedAt)` filter plus a client-side post-filter is NOT
 * equivalent and can loop forever: whenever more than one page's worth of rows shares the same
 * updated_at, `.gte()` alone can't express "and id > X" at the database level, so Postgres keeps
 * returning the identical top slice of that tied group on every subsequent page — the client-side
 * filter drops all of it (already seen), the raw page size never shrinks below a full page, and
 * the cursor computed from that unchanged raw page never advances. Composite server-side
 * filtering avoids this: every page Postgres returns is guaranteed to be genuinely new rows.
 */

export type KeysetCursor = { updatedAt: string; id: string } | null;

/**
 * Minimal shape this helper needs from a Supabase/PostgREST query builder. Deliberately not
 * typed against the real (deeply generic) builder type — threading that through a shared helper
 * causes TS2589 "type instantiation is excessively deep." Callers pass their real builder in;
 * its actual richer type still applies to whatever they chain after this call (e.g. `.limit()`),
 * since the return is cast back to the caller's own `Q`.
 */
interface KeysetPageable {
  or(filters: string): KeysetPageable;
  order(col: string, opts: { ascending: boolean }): KeysetPageable;
}

/**
 * Applies the stable order and, when resuming, the true composite keyset predicate via
 * PostgREST's `or`/`and` filter syntax: `updated_at.gt.X,and(updated_at.eq.X,id.gt.Y)`.
 * Evaluated entirely server-side, so every page returned is guaranteed to contain only rows
 * not yet seen — no client-side de-duplication is needed or performed.
 */
export function applyKeysetCursor<Q extends KeysetPageable>(query: Q, cursor: KeysetCursor): Q {
  const withFilter = (
    cursor
      ? query.or(
          `updated_at.gt.${cursor.updatedAt},and(updated_at.eq.${cursor.updatedAt},id.gt.${cursor.id})`
        )
      : query
  ) as Q;
  return withFilter.order("updated_at", { ascending: true }).order("id", { ascending: true }) as Q;
}

/** The cursor for the next page: the last row of the current fetched page. */
export function nextKeysetCursor<T extends { updated_at: string; id: string }>(
  fetchedRows: readonly T[]
): KeysetCursor {
  if (fetchedRows.length === 0) return null;
  const last = fetchedRows[fetchedRows.length - 1];
  return { updatedAt: last.updated_at, id: last.id };
}
