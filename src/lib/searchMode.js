/**
 * Prisma's `contains` filter behaves differently per database:
 *
 * - SQLite: compiles to SQL `LIKE`, which SQLite makes case-insensitive
 *   for ASCII text by default — no extra option needed, and none exists
 *   (Prisma's `mode: "insensitive"` throws "Unknown argument `mode`" if
 *   passed on SQLite, since that option is only implemented for
 *   PostgreSQL/MongoDB).
 * - PostgreSQL: `LIKE` is case-sensitive by default, so `mode:
 *   "insensitive"` is required for a search box to behave the way a
 *   non-technical user expects ("john" finding "John").
 *
 * The README documents switching `provider` to "postgresql" as the
 * intended production path (just changing DATABASE_URL, no other code
 * changes) — without this helper, that switch would silently make every
 * search case-sensitive with no error to signal it. Spread the result of
 * caseInsensitive() into any `contains`/`startsWith`/`endsWith` filter
 * object to stay correct on both.
 */
function isPostgres() {
  const url = process.env.DATABASE_URL || "";
  return url.startsWith("postgres://") || url.startsWith("postgresql://");
}

function caseInsensitive() {
  return isPostgres() ? { mode: "insensitive" } : {};
}

module.exports = { isPostgres, caseInsensitive };
