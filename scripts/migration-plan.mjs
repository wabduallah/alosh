// @ts-check
/**
 * Migration bookkeeping shared by the two appliers — `scripts/migrate.mjs`
 * (deploy, recursive file walk) and `src/lib/db.ts` (PGLite preview,
 * `import.meta.glob`).
 *
 * Applied files are keyed by BASENAME, so the same file applies once no matter
 * which directory it is loaded from. This allows per-game modules under
 * `migrations/games/<game>/` to coexist with core migrations in
 * `migrations/` without duplicate execution.
 */

/**
 * The `_migrations` key for a migration path (or bare filename).
 * @param {string} path
 * @returns {string}
 */
export function migrationName(path) {
  return path.split(/[\\/]/).pop() ?? path;
}

/**
 * @param {string} path
 * @returns {boolean}
 */
export function isMigrationFile(path) {
  return /\.sql$/i.test(path);
}

/**
 * Migrations in `paths` that are not yet in `applied`, in apply order.
 * Supports nested migration directories while deduplicating by basename so a
 * migration is only applied once even if it is discovered from multiple places.
 *
 * @param {Iterable<string>} paths
 * @param {Iterable<string>} applied
 * @returns {Array<{ name: string, path: string }>}
 */
export function pendingMigrations(paths, applied) {
  const done = new Set(applied);
  const seen = new Set();
  const items = [...paths]
    .map((path) => path.replace(/\\/g, "/"))
    .filter(isMigrationFile)
    .map((path) => ({ name: migrationName(path), path }))
    .filter(({ name, path }) => {
      if (done.has(name) || seen.has(name)) return false;
      seen.add(name);
      return true;
    })
    .sort((a, b) => a.path.localeCompare(b.path) || a.name.localeCompare(b.name));

  return items;
}
