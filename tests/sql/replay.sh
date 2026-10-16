#!/bin/sh
# يبني قاعدة فارغة ويشغّل كل ملفات supabase/manifest.txt بالترتيب، ثم اختبارات tests/sql/*.test.sql.
# يحتاج Postgres محليًا (psql). الاستخدام: npm run db:replay   (أو: sh tests/sql/replay.sh [اسم القاعدة])
set -e
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
DB=${1:-al3sh_replay}
PSQL=${PSQL:-psql}
# Supabase يرفض DELETE/UPDATE بلا WHERE حتى داخل الدوال، والقاعدة المحلية لا: نفحصه هنا.
if command -v python3 >/dev/null 2>&1; then
  python3 "$ROOT/tests/sql/lint_where.py" || exit 1
fi
$PSQL -q -d postgres -c "drop database if exists $DB" -c "create database $DB" >/dev/null
$PSQL -q -v ON_ERROR_STOP=1 -d "$DB" -f "$ROOT/tests/sql/00_supabase_stub.sql" >/dev/null
n=0
grep -v '^\s*#' "$ROOT/supabase/manifest.txt" | grep -v '^\s*$' | while read -r f; do
  if ! $PSQL -q -v ON_ERROR_STOP=1 -d "$DB" -f "$ROOT/supabase/$f" >/dev/null 2>/tmp/al3sh_replay_err; then
    echo "✗ $f"; cat /tmp/al3sh_replay_err; exit 1
  fi
  echo "✓ $f"
done
$PSQL -q -v ON_ERROR_STOP=1 -d "$DB" -f "$ROOT/tests/sql/01_fixtures.sql" >/dev/null
for t in "$ROOT"/tests/sql/*.test.sql; do
  [ -e "$t" ] || continue
  if ! $PSQL -q -v ON_ERROR_STOP=1 -d "$DB" -f "$t" >/dev/null 2>/tmp/al3sh_replay_err; then
    echo "✗ $(basename "$t")"; grep -v "^NOTICE\|^HINT\|wal_level" /tmp/al3sh_replay_err; exit 1
  fi
  echo "✓ $(basename "$t")"
done
echo "تم: كل الملفات والاختبارات نجحت على $DB"
