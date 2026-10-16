#!/usr/bin/env node
/**
 * Supabase SQL files, in order, with one command.
 *
 *   npm run db:supabase                 apply the pending files of supabase/manifest.txt
 *   npm run db:supabase -- --dry-run    only list what would run
 *   npm run db:supabase -- --baseline   record every file as already applied (a project set up by hand)
 *   npm run db:bundle -- court_v7.sql   write supabase/bundle.sql: that file and every one after it,
 *                                       to paste once in Supabase → SQL Editor (no connection needed)
 *
 * The connection is SUPABASE_DB_URL only (Supabase → Project Settings → Database → connection string).
 * DATABASE_URL is never used here, so this cannot touch another database by mistake.
 * Applied files are recorded in public.app_migrations (supabase/app_v1.sql) by basename.
 * Each file runs in its own transaction: a failure leaves the database as it was before that file.
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { basename, dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const supabaseDir = join(root, "supabase");
const args = process.argv.slice(2);
const flag = (f) => args.includes(f);

async function manifest() {
  const text = await readFile(join(supabaseDir, "manifest.txt"), "utf8");
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((rel) => ({ rel, name: basename(rel), path: join(supabaseDir, rel) }));
}

async function bundle(from) {
  const files = await manifest();
  const start = files.findIndex((f) => f.name === from);
  if (start < 0) {
    console.error(`[db] «${from}» ليس في supabase/manifest.txt`);
    process.exit(1);
  }
  const parts = [];
  for (const f of files.slice(start)) {
    parts.push(`-- ===== ${f.rel} =====\n${await readFile(f.path, "utf8")}\n`);
  }
  const out = join(supabaseDir, "bundle.sql");
  await writeFile(out, parts.join("\n"));
  console.log(`[db] كُتب supabase/bundle.sql: ${files.length - start} ملف من ${from}. الصقه مرة واحدة في Supabase → SQL Editor.`);
}

async function migrate() {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) {
    console.error("[db] SUPABASE_DB_URL غير مضبوط. خذه من Supabase → Project Settings → Database → Connection string.");
    process.exit(1);
  }
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false } });
  await client.connect();
  try {
    const host = new URL(url).hostname;
    const hasGames = (await client.query("select to_regclass('public.game_rooms') is not null as ok")).rows[0].ok;
    console.log(`[db] القاعدة: ${host}${hasGames ? "" : " (فارغة: لا يوجد game_rooms)"}`);
    await client.query("create table if not exists public.app_migrations (name text primary key, applied_at timestamptz not null default now())");
    await client.query("alter table public.app_migrations enable row level security");
    const applied = new Set((await client.query("select name from public.app_migrations")).rows.map((r) => r.name));
    const files = await manifest();

    if (flag("--baseline")) {
      for (const f of files) await client.query("insert into public.app_migrations (name) values ($1) on conflict do nothing", [f.name]);
      console.log(`[db] سُجّلت ${files.length} ملفات على أنها مشغّلة. لم يُشغَّل شيء.`);
      return;
    }

    const pending = files.filter((f) => !applied.has(f.name));
    if (!pending.length) return console.log("[db] لا شيء جديد: كل الملفات مشغّلة.");
    if (flag("--dry-run")) {
      console.log("[db] سيُشغَّل:");
      for (const f of pending) console.log(`  - ${f.rel}`);
      return;
    }
    for (const f of pending) {
      const sql = await readFile(f.path, "utf8");
      try {
        await client.query("begin");
        await client.query(sql);
        await client.query("insert into public.app_migrations (name) values ($1) on conflict do nothing", [f.name]);
        await client.query("commit");
        console.log(`[db] ✓ ${f.rel}`);
      } catch (err) {
        await client.query("rollback").catch(() => {});
        console.error(`[db] ✗ ${f.rel}: ${err?.message ?? err}`);
        process.exit(1);
      }
    }
    console.log(`[db] تم: ${pending.length} ملف.`);
  } finally {
    await client.end();
  }
}

const bundleAt = args.indexOf("--bundle");
if (bundleAt >= 0) await bundle(args[bundleAt + 1] ?? "");
else await migrate();
