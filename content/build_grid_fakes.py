"""Builds supabase/grid_fakes_v1.sql and the «إجابات مزيفة» column of tahadiyat-alesh-questions.csv
from grid_fakes_a.py and grid_fakes_b.py. Run: python3 content/build_grid_fakes.py"""
import csv, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from grid_fakes_a import FAKES_A  # noqa: E402
from grid_fakes_b import FAKES_B  # noqa: E402

F = FAKES_A + FAKES_B
CSV = os.path.join(HERE, "tahadiyat-alesh-questions.csv")
raw = open(CSV, encoding="utf-8-sig").read()
reader = csv.DictReader(raw.splitlines())
fields = list(reader.fieldnames)
rows = list(reader)
assert len(F) == len(rows), (len(F), len(rows))


def norm(s):
    """Same idea as public.name_norm + grid_label: no parentheses, diacritics, or letter variants."""
    s = re.sub(r"\s*\([^)]*\)", "", s)
    s = re.sub("[ًٌٍَُِّْٰـ]", "", s).lower()
    s = s.translate(str.maketrans("أإآٱىةؤئ", "اااايهوي"))
    return re.sub(r"\s+", " ", re.sub(r"[^0-9a-zء-ي٠-٩]+", " ", s)).strip()


bad = 0
for i, (r, f) in enumerate(zip(rows, F)):
    parts = f.split("|")
    ns = [norm(x) for x in parts]
    if len(parts) != 5 or len(set(ns)) != 5 or norm(r["الإجابة"]) in ns or any(not n for n in ns):
        print("BAD", i, r["السؤال"], r["الإجابة"], f)
        bad += 1
if bad:
    sys.exit(1)

q = lambda s: "'" + s.replace("'", "''") + "'"
vals = ",\n".join(f"    ({q(r['السؤال'])}, {q(json.dumps(f.split('|'), ensure_ascii=False))}::jsonb)" for r, f in zip(rows, F))
sql = f"""-- =============================================================================
-- «تحديات العش»: 5 إجابات خاطئة مختارة لكل سؤال من الـ {len(F)} (fake_answers)، لخيارات التصويت.
-- يُشغَّل بعد grid_v2.sql، وتشغيله مرة ثانية آمن. لا يغيّر سؤالًا كتب له المدير إجابات خاطئة بنفسه.
-- يُبنى من content/grid_fakes_a.py و grid_fakes_b.py بالأمر: python3 content/build_grid_fakes.py
-- =============================================================================

update public.questions_bank q set fake_answers = v.fakes
  from (values
{vals}
  ) as v(question_text, fakes)
 where q.game_slug = 'tactical-grid' and q.question_text = v.question_text
   and coalesce(jsonb_array_length(case when jsonb_typeof(q.fake_answers) = 'array' then q.fake_answers end), 0) = 0;

create table if not exists public.app_migrations (name text primary key, applied_at timestamptz not null default now());
alter table public.app_migrations enable row level security;
revoke all on public.app_migrations from anon, authenticated;
insert into public.app_migrations (name) values ('grid_fakes_v1.sql') on conflict do nothing;
"""
open(os.path.join(HERE, "..", "supabase", "grid_fakes_v1.sql"), "w").write(sql)
for r, f in zip(rows, F):
    r["إجابات مزيفة"] = f
with open(CSV, "w", encoding="utf-8-sig", newline="") as fh:
    w = csv.DictWriter(fh, fieldnames=fields, lineterminator="\n")
    w.writeheader()
    w.writerows(rows)
print(f"ok: {len(F)} questions")
