"""Builds supabase/court_cases_v7.sql from court_dual_cases.py. Run: python3 content/build_court_dual_cases.py

Checks every case before writing: two accused (one guilty, one innocent), lengths the table allows,
three evidence rounds, the culprit among the suspects, and optional roles with a fallback when the
case needs what they know."""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from court_dual_cases import CASES  # noqa: E402

errors = []
for c in CASES:
    t = c["title"]
    acc = [r for r in c["roles"] if r["kind"] == "accused"]
    if len(acc) != 2 or sorted(r["guilty"] for r in acc) != [False, True]:
        errors.append(f"{t}: متهمان، واحد مذنب وواحد بريء")
    if not (20 <= len(c["intro"]) <= 2000) or not (10 <= len(c["truth"]) <= 2000) or len(c["summary"]) > 300 or len(c["title"]) > 80:
        errors.append(f"{t}: الأطوال")
    if len(c["roles"]) > 12 or len(c["evidence"]) > 15:
        errors.append(f"{t}: الأدوار حتى 12 والأدلة حتى 15")
    if sorted({e["stage"] for e in c["evidence"]}) != [1, 2, 3]:
        errors.append(f"{t}: ثلاث جولات أدلة")
    if c["culprit"] not in [s["key"] for s in c["suspects"]]:
        errors.append(f"{t}: الفاعل من المشتبهين")
    keys = [r["key"] for r in c["roles"]]
    if len(set(keys)) != len(keys):
        errors.append(f"{t}: مفاتيح الأدوار")
    titles = [e["title"] for e in c["evidence"]]
    if len(set(titles)) != len(titles):
        errors.append(f"{t}: عناوين الأدلة مكررة")
    for r in c["roles"]:
        if len(r.get("exhibits", [])) > 3:
            errors.append(f"{t}: أدلة {r['name']}")
    required = [r for r in c["roles"] if not r.get("optional")]
    if len(required) < 4:
        errors.append(f"{t}: 4 أدوار أساسية")
if errors:
    print("\n".join(errors))
    sys.exit(1)

q = lambda s: "'" + s.replace("'", "''") + "'"
j = lambda x: q(json.dumps(x, ensure_ascii=False, indent=None)) + "::jsonb"

blocks = []
for c in CASES:
    blocks.append(f"""  if not exists (select 1 from public.court_cases where slug = {q(c['slug'])}) then
    insert into public.court_cases (slug, title, category, difficulty, summary, intro, guilty, truth, roles, evidence, suspects, culprit, juror_clues, source)
    values ({q(c['slug'])}, {q(c['title'])}, {q(c['category'])}, {c['difficulty']},
      {q(c['summary'])},
      {q(c['intro'])},
      {'true' if c['guilty'] else 'false'},
      {q(c['truth'])},
      {j(c['roles'])},
      {j(c['evidence'])},
      {j(c['suspects'])},
      {q(c['culprit'])},
      {j(c['juror_clues'])},
      'manual');
  end if;""")

names = "، ".join(f"«{c['title']}»" for c in CASES)
sql = f"""-- =============================================================================
-- «المحكمة»: محتوى الإصدار 7. يُشغَّل بعد court_cases_v6.sql، وتشغيله مرة ثانية آمن.
-- مولَّد من content/court_dual_cases.py (python3 content/build_court_dual_cases.py)، لا تعدّله يدويًا.
--
-- 1) أربع قضايا بمتهمَين، أحدهما مذنب والآخر بريء، وأدلتها على ثلاث جولات:
--    {names}.
--    لكل متهم قصة معقولة يدافع بها، والشهادات تحتمل أكثر من قراءة، والحسم يحتاج ربط الأدلة.
-- 2) court_cases_list ترجع عدد جولات الأدلة وعدد الأدلة، لتقدير مدة كل قضية في شاشة الإعداد.
-- 3) عدد اللاعبين في صفحة اللعبة: 4 إلى 20.
-- =============================================================================

do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'court_cases' and column_name = 'source') then
    raise exception 'شغّل ملفات المحكمة حتى court_v5.sql وcourt_cases_v6.sql أولًا، ثم هذا الملف.';
  end if;
end $$;

-- 1) القضايا -----------------------------------------------------------------------
do $$
begin
{chr(10).join(blocks)}
end $$;

-- 2) قائمة القضايا مع عدد الجولات والأدلة ------------------------------------------------
create or replace function public.court_cases_list()
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id, 'title', c.title, 'category', c.category, 'difficulty', c.difficulty,
           'summary', c.summary, 'min', public.court_case_min(c.roles), 'roles', jsonb_array_length(c.roles),
           'versions', 1 + coalesce(jsonb_array_length(c.variants), 0),
           'accused', (select count(*) from jsonb_array_elements(c.roles) r where r->>'kind' = 'accused'),
           'stages', (select count(distinct e->>'stage') from jsonb_array_elements(c.evidence) e),
           'evidence', jsonb_array_length(c.evidence),
           'parts', (select coalesce(jsonb_agg(jsonb_build_object('k', r->>'kind', 'o', coalesce((r->>'optional')::boolean, false)) order by o), '[]'::jsonb)
                       from jsonb_array_elements(c.roles) with ordinality t(r, o)))
         order by c.difficulty, c.title), '[]'::jsonb)
    from public.court_cases c
   where c.is_active;
$function$;

-- 3) عدد لاعبي المحكمة في صفحة اللعبة: 4 إلى 20 كما في الإعداد (ما لم يغيّره المدير إلى غير القيم القديمة).
update public.games set min_players = 4, max_players = 20
 where slug = 'court' and coalesce(min_players, 1) = 1 and coalesce(max_players, 14) = 14;

create table if not exists public.app_migrations (name text primary key, applied_at timestamptz not null default now());
alter table public.app_migrations enable row level security;
revoke all on public.app_migrations from anon, authenticated;
insert into public.app_migrations (name) values ('court_cases_v7.sql') on conflict do nothing;

notify pgrst, 'reload schema';
"""
out = os.path.join(HERE, "..", "supabase", "court_cases_v7.sql")
open(out, "w", encoding="utf-8").write(sql)
print("wrote", os.path.relpath(out), len(CASES), "cases")
