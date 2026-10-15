-- =============================================================================
-- «المحكمة»، الإصدار 5. يُشغَّل بعد court_v4.sql (و court_cases_v5.sql)، وتشغيله مرة ثانية آمن.
--
-- 1) متهم ثانٍ: القضية تقبل متهمًا أو اثنين، ولكل متهم حقيقته (roles[].guilty) وحكمه.
--    التصويت: حكم لكل متهم، والنقاط تُقسم على عدد المتهمين.
-- 2) تصعيد المنصة مع المؤقت: وقت الاستجواب يُقسم بين الشهود ثم المحقق ثم المتهم (أو المتهمين)،
--    والخادم ينقل المنصة عند كل فاصل (court_tick). السؤال الذهبي يوقف التصعيد. الإعداد escalate.
-- 3) قضية من الغرفة: المضيف يلعب قضية ولّدها وراجعها (p_settings.custom_case)، وتُحفظ في
--    court_cases موقوفة (source = 'ai' أو 'room') ليفعّلها المدير إن أعجبته.
-- 4) سجل طلبات مولّد القضايا (court_ai_log) لحدّ الاستخدام في دالة supabase/functions/court-generate.
-- =============================================================================

do $$
begin
  if to_regclass('public.court_cases') is null then
    raise exception 'جداول المحكمة غير موجودة في هذا المشروع. شغّل أولًا بالترتيب: court_v1.sql ← court_cases_v1.sql ← court_v2.sql ← court_cases_v2.sql ← court_v3.sql ← court_cases_v3.sql، ثم %.', 'court_v5.sql';
  end if;
end $$;

do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'court_cases' and column_name = 'variants') then
    raise exception 'شغّل court_v4.sql ثم court_cases_v5.sql أولًا، ثم court_v5.sql.';
  end if;
end $$;

alter table public.court_cases add column if not exists source text not null default 'manual';
alter table public.court_cases add column if not exists room_id uuid references public.game_rooms (id) on delete set null;
alter table public.room_court_roles add column if not exists guilty boolean;
alter table public.room_court_votes add column if not exists verdicts jsonb not null default '{}'::jsonb;
comment on column public.court_cases.source is 'manual (لوحة الإدارة) أو ai (ولّدها مضيف بالذكاء الاصطناعي) أو room (قالب من غرفة).';

create table if not exists public.court_ai_log (
  id      bigint generated always as identity primary key,
  user_id uuid not null,
  at      timestamptz not null default now(),
  ok      boolean not null default true
);
create index if not exists court_ai_log_user_idx on public.court_ai_log (user_id, at);
alter table public.court_ai_log enable row level security;
revoke all on public.court_ai_log from anon, authenticated;

-- التحقق: متهم أو متهمان.
create or replace function public.court_cases_validate()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  r jsonb;
  e jsonb;
  v_keys text[] := '{}';
  v_kind text;
  v_count jsonb := '{}'::jsonb;
begin
  if jsonb_typeof(new.roles) <> 'array' or jsonb_array_length(new.roles) < 4 or jsonb_array_length(new.roles) > 12 then
    raise exception 'BAD_CASE: الأدوار من 4 إلى 12.';
  end if;
  for r in select * from jsonb_array_elements(new.roles) loop
    v_kind := r->>'kind';
    if v_kind is null or v_kind not in ('accused', 'prosecutor', 'lawyer', 'detective', 'witness') then
      raise exception 'BAD_CASE: نوع دور غير معروف (%).', coalesce(v_kind, '-');
    end if;
    if char_length(btrim(coalesce(r->>'name', ''))) < 2 then
      raise exception 'BAD_CASE: كل دور يحتاج اسمًا.';
    end if;
    if char_length(btrim(coalesce(r->>'secret', ''))) < 5 then
      raise exception 'BAD_CASE: دور «%» يحتاج معلومة سرية.', r->>'name';
    end if;
    if coalesce(r->>'key', '') = '' or (r->>'key') = any (v_keys) then
      raise exception 'BAD_CASE: مفاتيح الأدوار يجب أن تكون مختلفة.';
    end if;
    if r ? 'guilty' and jsonb_typeof(r->'guilty') not in ('boolean', 'null') then
      raise exception 'BAD_CASE: حقيقة المتهم «%» مذنب أو بريء.', r->>'name';
    end if;
    if nullif(r->>'win', '') is not null and (r->>'win') not in ('truth', 'convict', 'acquit') then
      raise exception 'BAD_CASE: طريقة فوز غير معروفة لدور «%».', r->>'name';
    end if;
    v_keys := array_append(v_keys, r->>'key');
    v_count := jsonb_set(v_count, array[v_kind], to_jsonb(coalesce((v_count->>v_kind)::int, 0) + 1));
    if v_kind in ('accused', 'prosecutor', 'lawyer') and coalesce((r->>'optional')::boolean, false) then
      raise exception 'BAD_CASE: المتهم والمدعي والمحامي أدوار أساسية.';
    end if;
  end loop;
  if coalesce((v_count->>'accused')::int, 0) not in (1, 2) or coalesce((v_count->>'prosecutor')::int, 0) <> 1 or coalesce((v_count->>'lawyer')::int, 0) <> 1 then
    raise exception 'BAD_CASE: القضية تحتاج متهمًا أو متهمَين، ومدعيًا واحدًا ومحاميًا واحدًا.';
  end if;
  if (select count(*) from jsonb_array_elements(new.roles) x where not coalesce((x->>'optional')::boolean, false)) < 4 then
    raise exception 'BAD_CASE: تحتاج 4 أدوار أساسية على الأقل (مع شاهد أو محقق).';
  end if;
  if jsonb_typeof(new.evidence) <> 'array' or jsonb_array_length(new.evidence) < 2 or jsonb_array_length(new.evidence) > 15 then
    raise exception 'BAD_CASE: الأدلة من 2 إلى 15.';
  end if;
  for e in select * from jsonb_array_elements(new.evidence) loop
    if coalesce((e->>'stage')::int, 0) not between 1 and 3 then
      raise exception 'BAD_CASE: جولة الدليل 1 أو 2 أو 3.';
    end if;
    if char_length(btrim(coalesce(e->>'title', ''))) < 2 or char_length(btrim(coalesce(e->>'text', ''))) < 5 then
      raise exception 'BAD_CASE: كل دليل يحتاج عنوانًا ونصًا.';
    end if;
  end loop;
  if not exists (select 1 from jsonb_array_elements(new.evidence) ev where (ev->>'stage')::int = 1) then
    raise exception 'BAD_CASE: تحتاج دليلًا واحدًا على الأقل في الجولة الأولى.';
  end if;
  if new.suspects is not null and new.suspects <> '[]'::jsonb then
    if jsonb_typeof(new.suspects) <> 'array' or jsonb_array_length(new.suspects) < 2 or jsonb_array_length(new.suspects) > 6 then
      raise exception 'BAD_CASE: المشتبهون من 2 إلى 6.';
    end if;
    if exists (select 1 from jsonb_array_elements(new.suspects) s where char_length(btrim(coalesce(s->>'name', ''))) < 2 or coalesce(s->>'key', '') = '') then
      raise exception 'BAD_CASE: كل مشتبه يحتاج اسمًا.';
    end if;
    if not exists (select 1 from jsonb_array_elements(new.suspects) s where s->>'key' = new.culprit) then
      raise exception 'BAD_CASE: اختر الفاعل الحقيقي من قائمة المشتبهين.';
    end if;
  else
    new.suspects := null;
    new.culprit := null;
  end if;
  if jsonb_typeof(coalesce(new.juror_clues, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(new.juror_clues, '[]'::jsonb)) > 12 then
    raise exception 'BAD_CASE: معلومات المحلّفين 12 كحد أقصى.';
  end if;
  new.juror_clues := coalesce(new.juror_clues, '[]'::jsonb);
  new.updated_at := now();
  return new;
end;
$$;

-- البداية: مع القضية المولّدة، والتصعيد، وحقيقة كل متهم.
create or replace function public.court_start(p_room_id uuid, p_settings jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sd jsonb;
  v_case public.court_cases%rowtype;
  v_host_plays boolean := coalesce((p_settings->>'host_plays')::boolean, true);
  v_auto boolean := coalesce((p_settings->>'auto')::boolean, false);
  v_quick boolean := coalesce((p_settings->>'quick')::boolean, false);
  v_random_judge boolean := coalesce(p_settings->>'judge', 'host') = 'random';
  v_judge uuid;
  v_judge_name text;
  v_players uuid[];
  v_n int;
  v_used jsonb;
  v_used_v jsonb;
  v_q int := coalesce((p_settings->>'question_seconds')::int, 180);
  v_c int := coalesce((p_settings->>'closing_seconds')::int, 60);
  v_v int := coalesce((p_settings->>'vote_seconds')::int, 60);
  v_variant jsonb;
  v_variant_key text;
  v_applied jsonb;
  v_case_roles jsonb;
  v_roles jsonb := '[]'::jsonb;
  v_extra jsonb := '[]'::jsonb;
  v_evidence jsonb;
  v_clues text[];
  v_clue_i int := 1;
  v_r jsonb;
  v_optional_slots int;
  v_jurors int;
  v_golden_kinds jsonb := '["juror"]'::jsonb;
  v_steps jsonb := '[]'::jsonb;
  v_stage int;
  v_settings jsonb;
  v_evening jsonb;
  v_escalate boolean := coalesce((p_settings->>'escalate')::boolean, true);
  v_custom uuid;
  v_accused_seen int := 0;
  i int;
begin
  if not (public.is_room_host(p_room_id) or public.is_app_admin()) then
    return jsonb_build_object('ok', false, 'reason', 'NOT_HOST');
  end if;
  if not exists (select 1 from public.game_rooms where id = p_room_id and status = 'playing') then
    return jsonb_build_object('ok', false, 'reason', 'NOT_PLAYING');
  end if;
  select state_data into v_sd from public.room_game_state where room_id = p_room_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'NO_STATE');
  end if;
  if v_sd->>'game' = 'court' and coalesce(v_sd->>'phase', '') <> '' then
    return jsonb_build_object('ok', false, 'reason', 'ALREADY_STARTED');
  end if;
  if v_quick then
    v_q := 120; v_c := 30; v_v := 30;
  end if;
  if v_q not in (0, 120, 180, 300) then v_q := 180; end if;
  if v_c not in (0, 30, 45, 60, 90) then v_c := 60; end if;
  if v_v not in (0, 30, 60, 90) then v_v := 60; end if;

  select array_agg(p.id order by random()) into v_players
    from public.room_players p
   where p.room_id = p_room_id and (v_host_plays or v_random_judge or not p.is_host);
  -- القاضي بالقرعة: من الجميع (والمضيف معهم إذا كان يلعب)، ولا يأخذ دورًا.
  if v_random_judge then
    select array_agg(x order by random()) into v_players from unnest(v_players) x
     where v_host_plays or x <> (select id from public.room_players where room_id = p_room_id and is_host limit 1);
    v_judge := v_players[1];
    v_players := v_players[2:];
    select player_name into v_judge_name from public.room_players where id = v_judge;
  end if;
  v_n := coalesce(array_length(v_players, 1), 0);
  if v_n < 4 then
    return jsonb_build_object('ok', false, 'reason', case when v_random_judge then 'NOT_ENOUGH_WITH_JUDGE' else 'NOT_ENOUGH_PLAYERS' end);
  end if;
  if v_n > 12 then
    return jsonb_build_object('ok', false, 'reason', 'TOO_MANY_PLAYERS');
  end if;

  -- قضية ولّدها المضيف وراجعها: تُحفظ موقوفة، وتُلعب في هذه الغرفة.
  if jsonb_typeof(p_settings->'custom_case') = 'object' then
    begin
      insert into public.court_cases (title, category, difficulty, summary, intro, guilty, truth, roles, evidence, suspects, culprit, juror_clues, is_active, source, room_id)
      values (
        left(btrim(coalesce(p_settings->'custom_case'->>'title', '')), 80),
        nullif(left(btrim(coalesce(p_settings->'custom_case'->>'category', '')), 40), ''),
        greatest(1, least(3, coalesce((p_settings->'custom_case'->>'difficulty')::int, 2))),
        left(coalesce(p_settings->'custom_case'->>'summary', ''), 300),
        coalesce(p_settings->'custom_case'->>'intro', ''),
        coalesce((p_settings->'custom_case'->>'guilty')::boolean, true),
        coalesce(p_settings->'custom_case'->>'truth', ''),
        coalesce(p_settings->'custom_case'->'roles', '[]'::jsonb),
        coalesce(p_settings->'custom_case'->'evidence', '[]'::jsonb),
        case when jsonb_typeof(p_settings->'custom_case'->'suspects') = 'array' then p_settings->'custom_case'->'suspects' end,
        nullif(p_settings->'custom_case'->>'culprit', ''),
        case when jsonb_typeof(p_settings->'custom_case'->'juror_clues') = 'array' then p_settings->'custom_case'->'juror_clues' else '[]'::jsonb end,
        false,
        case when coalesce(p_settings->'custom_case'->>'source', '') in ('ai', 'room') then p_settings->'custom_case'->>'source' else 'room' end,
        p_room_id)
      returning id into v_custom;
    exception when others then
      return jsonb_build_object('ok', false, 'reason', 'BAD_CASE', 'detail',
        case when sqlerrm like 'BAD_CASE:%' then btrim(substr(sqlerrm, 10)) else 'القضية غير مكتملة.' end);
    end;
    p_settings := p_settings || jsonb_build_object('case_id', v_custom);
  end if;

  -- القضية: المختارة، أو قضية تناسب العدد وفيها نسخة لم تُلعب في الغرفة.
  v_used := coalesce(v_sd->'last_settings'->'used_cases', '[]'::jsonb);
  v_used_v := coalesce(v_sd->'last_settings'->'used_variants', '[]'::jsonb);
  if nullif(p_settings->>'case_id', '') is not null then
    select * into v_case from public.court_cases where id = (p_settings->>'case_id')::uuid and (is_active or id = v_custom);
    if not found then
      return jsonb_build_object('ok', false, 'reason', 'NO_CASE');
    end if;
  else
    select * into v_case from public.court_cases c
     where c.is_active and public.court_case_min(c.roles) <= v_n
     order by (select count(*) from (select 'base' k union all select x->>'key' from jsonb_array_elements(coalesce(c.variants, '[]'::jsonb)) x) ks
                where not (v_used_v ? (c.id::text || ':' || ks.k))) = 0,
              (v_used ? c.id::text), random()
     limit 1;
    if not found then
      return jsonb_build_object('ok', false, 'reason', 'NO_CASE');
    end if;
  end if;
  if public.court_case_min(v_case.roles) > v_n then
    return jsonb_build_object('ok', false, 'reason', 'CASE_NEEDS_MORE', 'min', public.court_case_min(v_case.roles) + case when v_random_judge then 1 else 0 end);
  end if;

  -- النسخة: عشوائية، والتي لم تُلعب في هذه الغرفة أولًا.
  select k, x into v_variant_key, v_variant
    from (select 'base' k, '{}'::jsonb x
          union all select x->>'key', x from jsonb_array_elements(coalesce(v_case.variants, '[]'::jsonb)) x) vs
   order by (v_used_v ? (v_case.id::text || ':' || k)), random()
   limit 1;
  v_applied := public.court_apply_variant(v_case, v_variant);
  v_case_roles := v_applied->'roles';

  v_optional_slots := v_n - (select count(*) from jsonb_array_elements(v_case_roles) x where not coalesce((x->>'optional')::boolean, false));
  for v_r in select x from jsonb_array_elements(v_case_roles) with ordinality t(x, o) order by o loop
    if coalesce((v_r->>'optional')::boolean, false) then
      if v_optional_slots <= 0 then
        if nullif(btrim(coalesce(v_r->>'fallback', '')), '') is not null then
          v_extra := v_extra || jsonb_build_array(jsonb_build_object(
            'stage', case when v_quick then 1 else greatest(1, least(3, coalesce((v_r->>'fallback_stage')::int, 2))) end,
            'icon', '🗂️', 'title', 'إفادة ' || btrim(v_r->>'name'), 'text', btrim(v_r->>'fallback'),
            'time', nullif(btrim(coalesce(v_r->>'fallback_time', '')), '')));
        end if;
        continue;
      end if;
      v_optional_slots := v_optional_slots - 1;
    end if;
    v_roles := v_roles || jsonb_build_array(v_r);
  end loop;
  v_evidence := (v_applied->'evidence') || v_extra;
  if v_quick then
    select coalesce(jsonb_agg(e || '{"stage":1}'::jsonb order by o), '[]'::jsonb) into v_evidence from jsonb_array_elements(v_evidence) with ordinality t(e, o);
  end if;
  select array_agg(btrim(c) order by random()) into v_clues
    from jsonb_array_elements_text(coalesce(v_applied->'juror_clues', '[]'::jsonb)) c where btrim(c) <> '';
  v_jurors := v_n - jsonb_array_length(v_roles);

  delete from public.room_court where room_id = p_room_id;
  delete from public.room_court_roles where room_id = p_room_id;
  delete from public.room_court_votes where room_id = p_room_id;
  delete from public.room_court_goal_votes where room_id = p_room_id;
  insert into public.room_court (room_id, case_id, guilty, truth, evidence, suspects, culprit, variant, roles, clues)
  values (p_room_id, v_case.id, (v_applied->>'guilty')::boolean, v_applied->>'truth', v_evidence, v_case.suspects,
          nullif(v_applied->>'culprit', ''), v_variant_key, v_case_roles, to_jsonb(coalesce(v_clues, '{}'::text[])));

  for i in 1..v_n loop
    v_r := v_roles->(i - 1);
    if v_r is null then
      insert into public.room_court_roles (room_id, player_id, role_key, kind, name, brief, secret, clue)
      values (p_room_id, v_players[i], 'juror-' || i, 'juror', 'محلّف', 'عضو في هيئة المحلفين.',
              'لا تعرف عن القضية إلا ما يُعرض في الجلسة. اسأل المتهم والشهود، وانتبه للتناقض بين الأقوال والأدلة، ثم صوّت بالعدل. كل صوت يطابق الحقيقة = 100 نقطة. ولك سؤال ذهبي واحد: تستدعي به من تشاء للمنصة.',
              v_clues[v_clue_i]);
      v_clue_i := v_clue_i + 1;
    else
      if v_r->>'kind' = 'accused' then
        v_accused_seen := v_accused_seen + 1;
      end if;
      insert into public.room_court_roles (room_id, player_id, role_key, kind, name, brief, secret, later, later_stage, win, goal, exhibits, guilty)
      values (p_room_id, v_players[i], v_r->>'key', v_r->>'kind', btrim(v_r->>'name'),
              nullif(btrim(coalesce(v_r->>'brief', '')), ''), btrim(v_r->>'secret'),
              nullif(btrim(coalesce(v_r->>'later', '')), ''),
              case when nullif(btrim(coalesce(v_r->>'later', '')), '') is null then null
                   when v_quick then 1
                   else greatest(1, least(3, coalesce((v_r->>'later_stage')::int, 2))) end,
              public.court_win_of(v_r->>'kind', v_r->>'win'),
              nullif(btrim(coalesce(v_r->>'goal', '')), ''),
              case when jsonb_typeof(v_r->'exhibits') = 'array' and jsonb_array_length(v_r->'exhibits') > 0 then v_r->'exhibits' else null end,
              case when v_r->>'kind' <> 'accused' then null
                   when jsonb_typeof(v_r->'guilty') = 'boolean' then (v_r->>'guilty')::boolean
                   else (v_applied->>'guilty')::boolean end);
    end if;
  end loop;
  -- المتهم الأول يحمل حقيقة القضية دائمًا.
  update public.room_court_roles r set guilty = (v_applied->>'guilty')::boolean
   where r.room_id = p_room_id and r.kind = 'accused'
     and r.role_key = (select min(role_key) from public.room_court_roles where room_id = p_room_id and kind = 'accused')
     and not exists (select 1 from jsonb_array_elements(v_case_roles) x where x->>'key' = r.role_key and jsonb_typeof(x->'guilty') = 'boolean');

  -- غرفة صغيرة بلا محلّفين: الشهود والمحقق يأخذون السؤال الذهبي ومعلومات المحلّفين.
  if v_jurors = 0 then
    v_golden_kinds := '["witness","detective"]'::jsonb;
    for v_r in select to_jsonb(r.player_id) p from public.room_court_roles r
                where r.room_id = p_room_id and r.kind in ('witness', 'detective') order by r.role_key loop
      exit when v_clue_i > coalesce(array_length(v_clues, 1), 0);
      update public.room_court_roles set clue = v_clues[v_clue_i] where room_id = p_room_id and player_id = (v_r #>> '{}')::uuid;
      v_clue_i := v_clue_i + 1;
    end loop;
  end if;

  v_steps := jsonb_build_array(jsonb_build_object('phase', 'intro'));
  for v_stage in select distinct (e->>'stage')::int s from jsonb_array_elements(v_evidence) e order by 1 loop
    v_steps := v_steps
      || jsonb_build_array(jsonb_build_object('phase', 'evidence', 'stage', v_stage, 'seconds', case when v_auto then 30 else 0 end))
      || jsonb_build_array(jsonb_build_object('phase', 'question', 'stage', v_stage, 'seconds', v_q));
  end loop;
  v_steps := v_steps || jsonb_build_array(
    jsonb_build_object('phase', 'closing', 'side', 'prosecutor', 'seconds', v_c),
    jsonb_build_object('phase', 'closing', 'side', 'lawyer', 'seconds', v_c),
    jsonb_build_object('phase', 'vote', 'seconds', v_v),
    jsonb_build_object('phase', 'verdict'),
    jsonb_build_object('phase', 'over'));

  v_evening := case when coalesce((p_settings->>'new_evening')::boolean, false) then '{}'::jsonb
                    else coalesce(v_sd->'last_settings'->'evening', '{}'::jsonb) end;
  v_settings := jsonb_build_object('case_id', nullif(p_settings->>'case_id', ''), 'host_plays', v_host_plays, 'auto', v_auto,
    'quick', v_quick, 'escalate', v_escalate, 'judge', case when v_random_judge then 'random' else 'host' end,
    'question_seconds', v_q, 'closing_seconds', v_c, 'vote_seconds', v_v,
    'used_cases', (select coalesce(jsonb_agg(distinct x), '[]'::jsonb) from jsonb_array_elements_text(v_used || jsonb_build_array(v_case.id::text)) x),
    'used_variants', (select coalesce(jsonb_agg(distinct x), '[]'::jsonb) from jsonb_array_elements_text(v_used_v || jsonb_build_array(v_case.id::text || ':' || v_variant_key)) x),
    'evening', v_evening);

  update public.room_game_state
     set active_question_id = null,
         state_data = jsonb_build_object(
           'game', 'court', 'phase', 'intro', 'step', 0, 'steps', v_steps, 'stage', 0, 'ends_at', null,
           'case', jsonb_build_object('id', v_case.id, 'title', v_case.title, 'category', v_case.category, 'intro', v_case.intro, 'difficulty', v_case.difficulty,
                                      'versions', 1 + coalesce(jsonb_array_length(v_case.variants), 0)),
           'cast', public.court_cast(p_room_id), 'evidence', '[]'::jsonb, 'stand', null,
           'judge_id', v_judge, 'judge_name', v_judge_name, 'stand_slot', null,
           'accused', (select coalesce(jsonb_agg(jsonb_build_object('key', r.role_key, 'name', r.name, 'player_id', r.player_id) order by r.role_key), '[]'::jsonb)
                         from public.room_court_roles r where r.room_id = p_room_id and r.kind = 'accused'),
           'objection', null, 'objections', '{}'::jsonb, 'objection_points', '{}'::jsonb,
           'queue', '[]'::jsonb, 'asking', null, 'asking_since', null, 'golden', null, 'golden_used', '{}'::jsonb, 'golden_kinds', v_golden_kinds,
           'exhibits_used', '{}'::jsonb, 'presented', null,
           'suspects', (select jsonb_agg(jsonb_build_object('key', s->>'key', 'name', btrim(s->>'name'))) from jsonb_array_elements(v_case.suspects) s),
           'votes_count', 0, 'voters_count', 0, 'verdict', null, 'truth', null, 'points', null, 'cards', null,
           'goals', null, 'goals_awarded', '{}'::jsonb, 'goal_votes', '{}'::jsonb, 'pleading', null,
           'fallbacks', jsonb_array_length(v_extra), 'settings', v_settings, 'last_settings', null)
   where room_id = p_room_id;
  return jsonb_build_object('ok', true, 'case', v_case.title, 'variant', v_variant_key, 'custom', v_custom);
end;
$$;
revoke all on function public.court_start(uuid, jsonb) from public, anon;
grant execute on function public.court_start(uuid, jsonb) to authenticated;

-- الانتقال: حكم وحقيقة لكل متهم، والنقاط تُقسم على عدد المتهمين.
create or replace function public.court_advance(p_room_id uuid, p_step int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sd jsonb;
  v_court public.room_court%rowtype;
  v_step int;
  v_next jsonb;
  v_phase text;
  v_secs int;
  v_g int;
  v_i int;
  v_pp int;
  v_pl int;
  v_best text;
  v_verdict boolean;
  v_points jsonb := '[]'::jsonb;
  v_row record;
  v_pts int;
  v_why text[];
  v_win text;
  v_obj int;
  v_has_suspects boolean;
  v_evening jsonb;
  v_totals jsonb;
  v_t jsonb;
  v_n int;
  v_acc record;
  v_list jsonb := '[]'::jsonb;
  v_correct int;
  v_convicted int;
  v_acquitted int;
  v_all_correct boolean;
  v_self boolean;
begin
  select state_data into v_sd from public.room_game_state where room_id = p_room_id for update;
  if v_sd->>'game' is distinct from 'court' then
    return jsonb_build_object('ok', false, 'reason', 'NOT_STARTED');
  end if;
  v_step := coalesce((v_sd->>'step')::int, 0);
  if p_step is not null and p_step <> v_step then
    return jsonb_build_object('ok', true, 'stale', true);
  end if;
  if v_sd->>'phase' = 'over' then
    return jsonb_build_object('ok', false, 'reason', 'OVER');
  end if;
  v_next := v_sd->'steps'->(v_step + 1);
  if v_next is null then
    return jsonb_build_object('ok', false, 'reason', 'OVER');
  end if;
  v_phase := v_next->>'phase';
  v_secs := coalesce((v_next->>'seconds')::int, 0);
  select * into v_court from public.room_court where room_id = p_room_id;
  v_has_suspects := v_court.suspects is not null and jsonb_array_length(v_court.suspects) > 0;

  v_sd := v_sd || jsonb_build_object('step', v_step + 1, 'phase', v_phase, 'objection', null,
    'ends_at', case when v_secs > 0 then to_jsonb(now() + make_interval(secs => v_secs)) else 'null'::jsonb end,
    'side', v_next->'side', 'queue', '[]'::jsonb, 'asking', null, 'asking_since', null, 'golden', null, 'stand_slot', null);

  if v_phase = 'evidence' then
    v_sd := v_sd || jsonb_build_object('stage', (v_next->>'stage')::int, 'stand', null,
      'evidence', (v_sd->'evidence') || coalesce((
        select jsonb_agg(public.court_ev(e) order by o)
          from jsonb_array_elements(v_court.evidence) with ordinality t(e, o)
         where (e->>'stage')::int = (v_next->>'stage')::int), '[]'::jsonb));
  elsif v_phase = 'closing' then
    v_sd := v_sd || jsonb_build_object('stand', null);
  elsif v_phase = 'vote' then
    delete from public.room_court_votes where room_id = p_room_id;
    select count(*) into v_i from public.room_court_roles where room_id = p_room_id and kind <> 'accused';
    v_sd := v_sd || jsonb_build_object('stand', null, 'votes_count', 0, 'voters_count', v_i);
  elsif v_phase = 'verdict' then
    -- حكم لكل متهم: التعادل لصالحه.
    for v_acc in select r.role_key, r.name, p.player_name, r.player_id from public.room_court_roles r join public.room_players p on p.id = r.player_id
                  where r.room_id = p_room_id and r.kind = 'accused' order by r.role_key loop
      select count(*) filter (where vv), count(*) filter (where not vv)
        into v_g, v_i
        from (select coalesce((verdicts->>v_acc.role_key)::boolean,
                              case when v_acc.role_key = (select min(role_key) from public.room_court_roles where room_id = p_room_id and kind = 'accused') then guilty end) vv
                from public.room_court_votes where room_id = p_room_id) x
       where vv is not null;
      v_list := v_list || jsonb_build_array(jsonb_build_object('key', v_acc.role_key, 'name', v_acc.name, 'player_name', v_acc.player_name,
        'player_id', v_acc.player_id, 'guilty', v_g > v_i, 'votes_guilty', v_g, 'votes_innocent', v_i));
    end loop;
    v_g := coalesce((v_list->0->>'votes_guilty')::int, 0);
    v_i := coalesce((v_list->0->>'votes_innocent')::int, 0);
    v_verdict := coalesce((v_list->0->>'guilty')::boolean, false);
    select count(*) filter (where pleading = 'prosecutor'), count(*) filter (where pleading = 'lawyer') into v_pp, v_pl
      from public.room_court_votes where room_id = p_room_id;
    v_best := case when v_pp > v_pl then 'prosecutor' when v_pl > v_pp then 'lawyer' else null end;
    v_sd := v_sd || jsonb_build_object(
      'verdict', jsonb_build_object('guilty', v_verdict, 'votes_guilty', v_g, 'votes_innocent', v_i, 'list', v_list),
      'pleading', jsonb_build_object('prosecutor', v_pp, 'lawyer', v_pl, 'winner', v_best));
  elsif v_phase = 'over' then
    v_verdict := coalesce((v_sd->'verdict'->>'guilty')::boolean, false);
    v_best := v_sd->'pleading'->>'winner';
    -- الحكم والحقيقة لكل متهم.
    select coalesce(jsonb_agg(x || jsonb_build_object('truth', r.guilty, 'correct', (x->>'guilty')::boolean = r.guilty) order by x->>'key'), '[]'::jsonb)
      into v_list
      from jsonb_array_elements(coalesce(v_sd->'verdict'->'list', '[]'::jsonb)) x
      join public.room_court_roles r on r.room_id = p_room_id and r.role_key = x->>'key';
    v_n := greatest(1, jsonb_array_length(v_list));
    select count(*) filter (where (x->>'correct')::boolean), count(*) filter (where (x->>'guilty')::boolean), count(*) filter (where not (x->>'guilty')::boolean)
      into v_correct, v_convicted, v_acquitted from jsonb_array_elements(v_list) x;
    v_all_correct := v_correct = jsonb_array_length(v_list) and v_n > 0;
    perform set_config('alosh.trusted', 'on', true);
    for v_row in
      select r.player_id, r.kind, r.name, r.win, r.goal, r.role_key, p.player_name, v.guilty vote, v.culprit pick, coalesce(v.verdicts, '{}'::jsonb) verdicts
        from public.room_court_roles r
        join public.room_players p on p.id = r.player_id
        left join public.room_court_votes v on v.room_id = r.room_id and v.player_id = r.player_id
       where r.room_id = p_room_id
    loop
      v_pts := 0;
      v_why := '{}';
      -- صوت صحيح لكل متهم.
      v_i := 0;
      if v_row.kind <> 'accused' then
        select count(*) into v_i from jsonb_array_elements(v_list) x
         where coalesce((v_row.verdicts->>(x->>'key'))::boolean, case when x->>'key' = v_list->0->>'key' then v_row.vote end) = (x->>'truth')::boolean;
      end if;
      if v_i > 0 then
        v_pts := v_pts + 100 * v_i;
        v_why := array_append(v_why, case when v_i > 1 then 'صوتان صحيحان' else 'صوت صحيح' end);
      end if;
      if v_has_suspects and v_row.kind <> 'accused' and v_row.pick is not null and v_row.pick = v_court.culprit then
        v_pts := v_pts + 150;
        v_why := array_append(v_why, 'عرف الفاعل');
      end if;
      v_win := public.court_win_of(v_row.kind, v_row.win);
      if v_row.kind = 'accused' then
        select not (x->>'guilty')::boolean into v_self from jsonb_array_elements(v_list) x where x->>'key' = v_row.role_key;
        if coalesce(v_self, false) then
          v_pts := v_pts + 300;
          v_why := array_append(v_why, 'نجا من الإدانة');
        end if;
      elsif v_win = 'convict' and v_convicted > 0 then
        v_pts := v_pts + 200 * v_convicted / v_n;
        v_why := array_append(v_why, case when v_n > 1 and v_convicted < v_n then 'أُدين أحد المتهمين' else 'أُدين المتهم' end);
      elsif v_win = 'acquit' and v_acquitted > 0 then
        v_pts := v_pts + 200 * v_acquitted / v_n;
        v_why := array_append(v_why, case when v_n > 1 and v_acquitted < v_n then 'بُرّئ أحد المتهمين' else 'بُرّئ المتهم' end);
      elsif v_win = 'truth' and v_correct > 0 then
        v_pts := v_pts + 200 * v_correct / v_n;
        v_why := array_append(v_why, 'تحققت العدالة');
      end if;
      if v_row.kind in ('prosecutor', 'lawyer') and v_correct > 0 then
        v_pts := v_pts + 100 * v_correct / v_n;
        v_why := array_append(v_why, 'الحكم صحيح');
      end if;
      if v_best is not null and v_row.kind = v_best then
        v_pts := v_pts + 50;
        v_why := array_append(v_why, 'أفضل مرافعة');
      end if;
      v_obj := coalesce((v_sd->'objection_points'->>v_row.player_id::text)::int, 0);
      if v_obj > 0 then
        v_pts := v_pts + 50 * v_obj;
        v_why := array_append(v_why, case when v_obj > 1 then 'اعتراضان مقبولان' else 'اعتراض مقبول' end);
      end if;
      if v_pts > 0 then
        update public.room_players set score = score + v_pts where id = v_row.player_id;
      end if;
      v_points := v_points || jsonb_build_array(jsonb_build_object(
        'player_id', v_row.player_id, 'player_name', v_row.player_name, 'kind', v_row.kind, 'name', v_row.name,
        'vote', v_row.vote, 'pick', v_row.pick, 'points', v_pts, 'why', to_jsonb(v_why),
        'vote_ok', v_i > 0, 'votes_ok', v_i, 'verdicts', v_row.verdicts,
        'pick_ok', v_has_suspects and v_row.pick is not null and v_row.pick = v_court.culprit));
    end loop;
    select coalesce(jsonb_agg(x order by (x->>'points')::int desc, x->>'player_name'), '[]'::jsonb) into v_points from jsonb_array_elements(v_points) x;

    -- ترتيب السهرة: يتجمع من قضية لقضية.
    v_evening := coalesce(v_sd->'settings'->'evening', '{}'::jsonb);
    v_totals := coalesce(v_evening->'totals', '{}'::jsonb);
    for v_t in select * from jsonb_array_elements(v_points) loop
      v_totals := v_totals || jsonb_build_object(v_t->>'player_id', jsonb_build_object(
        'name', v_t->>'player_name',
        'points', coalesce((v_totals->(v_t->>'player_id')->>'points')::int, 0) + (v_t->>'points')::int,
        'matches', coalesce((v_totals->(v_t->>'player_id')->>'matches')::int, 0) + 1,
        'smart', coalesce((v_totals->(v_t->>'player_id')->>'smart')::int, 0)
                 + coalesce((v_t->>'votes_ok')::int, 0) + case when (v_t->>'pick_ok')::boolean then 1 else 0 end,
        'speaker', coalesce((v_totals->(v_t->>'player_id')->>'speaker')::int, 0)
                 + case when v_t->>'kind' in ('prosecutor', 'lawyer', 'accused') then (v_t->>'points')::int else 0 end));
    end loop;
    v_evening := jsonb_build_object('matches', coalesce((v_evening->>'matches')::int, 0) + 1, 'totals', v_totals);

    v_sd := v_sd || jsonb_build_object(
      'truth', jsonb_build_object('guilty', v_court.guilty, 'text', v_court.truth, 'correct', v_all_correct, 'list', v_list,
        'culprit', (select s->>'name' from jsonb_array_elements(v_court.suspects) s where s->>'key' = v_court.culprit),
        'culprit_key', v_court.culprit, 'variant', v_court.variant),
      'points', v_points,
      'settings', (v_sd->'settings') || jsonb_build_object('evening', v_evening),
      'cards', (select coalesce(jsonb_agg(jsonb_build_object('player_name', p.player_name, 'kind', r.kind, 'name', r.name, 'secret', r.secret, 'later', r.later,
                    'goal', r.goal, 'win', public.court_win_of(r.kind, r.win), 'clue', r.clue, 'guilty', r.guilty)
                  order by case r.kind when 'accused' then 1 when 'prosecutor' then 2 when 'lawyer' then 3 when 'detective' then 4 when 'witness' then 5 else 6 end, r.role_key), '[]'::jsonb)
                  from public.room_court_roles r join public.room_players p on p.id = r.player_id
                 where r.room_id = p_room_id and (r.kind <> 'juror' or r.clue is not null)),
      'goals', (select coalesce(jsonb_agg(jsonb_build_object('player_id', r.player_id, 'player_name', p.player_name, 'name', r.name, 'goal', r.goal) order by r.role_key), '[]'::jsonb)
                  from public.room_court_roles r join public.room_players p on p.id = r.player_id
                 where r.room_id = p_room_id and r.goal is not null),
      'evidence', coalesce((select jsonb_agg(public.court_ev(e) order by o) from jsonb_array_elements(v_court.evidence) with ordinality t(e, o)), '[]'::jsonb)
                  || coalesce((select jsonb_agg(e) from jsonb_array_elements(v_sd->'evidence') e where coalesce((e->>'presented')::boolean, false)), '[]'::jsonb));
    insert into public.court_results (room_id, case_id, players, verdict, truth, votes_guilty, votes_innocent, variant)
    values (p_room_id, v_court.case_id, (select count(*) from public.room_court_roles where room_id = p_room_id), v_verdict, v_court.guilty,
            coalesce((v_sd->'verdict'->>'votes_guilty')::int, 0), coalesce((v_sd->'verdict'->>'votes_innocent')::int, 0), v_court.variant);
  end if;

  update public.room_game_state set state_data = v_sd where room_id = p_room_id;
  return jsonb_build_object('ok', true, 'phase', v_phase);
end;
$$;
revoke all on function public.court_advance(uuid, int) from public, anon, authenticated;

-- التصويت: حكم لكل متهم (p_accused مفتاح دوره، والافتراضي المتهم الأول).
drop function if exists public.court_vote(uuid, boolean, text, text);
create or replace function public.court_vote(p_room_id uuid, p_guilty boolean default null, p_culprit text default null, p_pleading text default null, p_accused text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := public.my_player_id(p_room_id);
  v_kind text;
  v_sd jsonb;
  v_count int;
  v_has_suspects boolean;
  v_keys text[];
  v_primary text;
  v_key text;
begin
  if v_me is null or (p_guilty is null and p_culprit is null and p_pleading is null) then
    return jsonb_build_object('ok', false, 'reason', 'NOT_IN_CASE');
  end if;
  select state_data into v_sd from public.room_game_state where room_id = p_room_id for update;
  if v_sd->>'game' is distinct from 'court' or v_sd->>'phase' <> 'vote' then
    return jsonb_build_object('ok', false, 'reason', 'WRONG_PHASE');
  end if;
  select kind into v_kind from public.room_court_roles where room_id = p_room_id and player_id = v_me;
  if v_kind is null then
    return jsonb_build_object('ok', false, 'reason', 'NOT_IN_CASE');
  end if;
  if v_kind = 'accused' then
    return jsonb_build_object('ok', false, 'reason', 'ACCUSED');
  end if;
  if p_pleading is not null and (p_pleading not in ('prosecutor', 'lawyer') or v_kind in ('prosecutor', 'lawyer')) then
    return jsonb_build_object('ok', false, 'reason', 'NOT_ALLOWED');
  end if;
  v_has_suspects := jsonb_typeof(v_sd->'suspects') = 'array' and jsonb_array_length(v_sd->'suspects') > 0;
  if p_culprit is not null and not (v_has_suspects and exists (select 1 from jsonb_array_elements(v_sd->'suspects') s where s->>'key' = p_culprit)) then
    return jsonb_build_object('ok', false, 'reason', 'BAD_SUSPECT');
  end if;
  select array_agg(role_key order by role_key) into v_keys from public.room_court_roles where room_id = p_room_id and kind = 'accused';
  v_primary := v_keys[1];
  v_key := coalesce(p_accused, v_primary);
  if p_guilty is not null and not (v_key = any (v_keys)) then
    return jsonb_build_object('ok', false, 'reason', 'NOT_IN_CASE');
  end if;
  insert into public.room_court_votes (room_id, player_id, guilty, culprit, pleading, verdicts)
  values (p_room_id, v_me, case when v_key = v_primary then p_guilty end, p_culprit, p_pleading,
          case when p_guilty is null then '{}'::jsonb else jsonb_build_object(v_key, p_guilty) end)
  on conflict (room_id, player_id) do update
    set guilty = case when v_key = v_primary and excluded.guilty is not null then excluded.guilty else room_court_votes.guilty end,
        culprit = coalesce(excluded.culprit, room_court_votes.culprit),
        pleading = coalesce(excluded.pleading, room_court_votes.pleading),
        verdicts = coalesce(room_court_votes.verdicts, '{}'::jsonb) || excluded.verdicts,
        at = now();
  select count(*) into v_count
    from public.room_court_votes v join public.room_court_roles r on r.room_id = v.room_id and r.player_id = v.player_id
   where v.room_id = p_room_id
     and (select count(*) from unnest(v_keys) k where v.verdicts ? k or (k = v_primary and v.guilty is not null)) = coalesce(array_length(v_keys, 1), 1)
     and (not v_has_suspects or v.culprit is not null)
     and (r.kind in ('prosecutor', 'lawyer') or v.pleading is not null);
  update public.room_game_state set state_data = state_data || jsonb_build_object('votes_count', v_count) where room_id = p_room_id;
  if v_count >= coalesce((v_sd->>'voters_count')::int, 0) and coalesce((v_sd->>'voters_count')::int, 0) > 0 then
    perform public.court_advance(p_room_id, (v_sd->>'step')::int);
  end if;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.court_vote(uuid, boolean, text, text, text) from public, anon;
grant execute on function public.court_vote(uuid, boolean, text, text, text) to authenticated;

-- بطاقتي: ومعها أحكامي على كل متهم.
create or replace function public.court_my_card(p_room_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me uuid := public.my_player_id(p_room_id);
  v_sd jsonb;
  v_r public.room_court_roles%rowtype;
  v_v public.room_court_votes%rowtype;
  v_stage int;
begin
  if v_me is null then
    return null;
  end if;
  select state_data into v_sd from public.room_game_state where room_id = p_room_id;
  if v_sd->>'game' is distinct from 'court' then
    return jsonb_build_object('started', false);
  end if;
  if coalesce(v_sd->>'judge_id', '') = v_me::text then
    return jsonb_build_object('started', true, 'judge', true, 'player_id', v_me);
  end if;
  select * into v_r from public.room_court_roles where room_id = p_room_id and player_id = v_me;
  if not found then
    return jsonb_build_object('started', false, 'late', coalesce(v_sd->>'phase', '') <> '', 'player_id', v_me);
  end if;
  v_stage := coalesce((v_sd->>'stage')::int, 0);
  select * into v_v from public.room_court_votes where room_id = p_room_id and player_id = v_me;
  return jsonb_build_object(
    'started', true, 'player_id', v_me, 'kind', v_r.kind, 'kind_ar', public.court_kind_ar(v_r.kind), 'name', v_r.name, 'brief', v_r.brief,
    'secret', v_r.secret, 'clue', v_r.clue, 'goal', v_r.goal, 'win', public.court_win_of(v_r.kind, v_r.win),
    'later', case when v_r.later is not null and v_stage >= v_r.later_stage then v_r.later else null end,
    'later_pending', v_r.later is not null and v_stage < v_r.later_stage,
    'vote', v_v.guilty, 'pick', v_v.culprit, 'pleading', v_v.pleading, 'verdicts', coalesce(v_v.verdicts, '{}'::jsonb),
    'exhibits', v_r.exhibits,
    'exhibits_used', coalesce(v_sd->'exhibits_used'->v_me::text, '[]'::jsonb),
    'golden_left', coalesce(v_sd->'golden_kinds', '["juror"]'::jsonb) ? v_r.kind and not coalesce((v_sd->'golden_used'->>v_me::text)::boolean, false),
    'goal_votes', (select coalesce(jsonb_object_agg(g.owner::text, g.yes), '{}'::jsonb) from public.room_court_goal_votes g where g.room_id = p_room_id and g.voter = v_me),
    'objections_left', case when v_r.kind in ('prosecutor', 'lawyer') then 2 - coalesce((v_sd->'objections'->>v_me::text)::int, 0) else 0 end);
end;
$$;

-- التلقائي: ومعه تصعيد المنصة مع مؤقت الاستجواب.
create or replace function public.court_tick(p_room_id uuid, p_step int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sd jsonb;
  v_queue jsonb;
  v_done boolean := false;
  v_order jsonb;
  v_len int;
  v_secs int;
  v_start timestamptz;
  v_slot numeric;
  v_index int;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'reason', 'NO_SESSION');
  end if;
  select state_data into v_sd from public.room_game_state where room_id = p_room_id for update;
  if v_sd->>'game' is distinct from 'court' or coalesce((v_sd->>'step')::int, -1) <> p_step then
    return jsonb_build_object('ok', true, 'stale', true);
  end if;
  if jsonb_typeof(v_sd->'objection') = 'object' and v_sd->'objection'->>'status' = 'pending'
     and (v_sd->'objection'->>'at')::timestamptz <= now() - interval '10 seconds' then
    v_sd := v_sd || jsonb_build_object('objection', (v_sd->'objection') || jsonb_build_object('status', 'rejected', 'ruled_at', now(), 'auto', true));
    v_done := true;
  end if;
  if v_sd->>'phase' = 'question' and nullif(v_sd->>'asking', '') is not null and nullif(v_sd->>'asking_since', '') is not null
     and (v_sd->>'asking_since')::timestamptz <= now() - interval '44 seconds' then
    v_queue := coalesce(v_sd->'queue', '[]'::jsonb);
    v_sd := v_sd || jsonb_build_object('asking', v_queue->0->'player_id',
      'asking_since', case when v_queue->0 is null then null else to_jsonb(now()) end,
      'queue', coalesce(v_queue - 0, '[]'::jsonb), 'golden', null);
    v_done := true;
  end if;
  -- تصعيد المنصة: الشهود، ثم المحقق، ثم المتهم (أو المتهمان)، كل واحد جزء من وقت الاستجواب.
  if v_sd->>'phase' = 'question' and coalesce((v_sd->'settings'->>'escalate')::boolean, true)
     and nullif(v_sd->>'ends_at', '') is not null and jsonb_typeof(v_sd->'golden') is distinct from 'object' then
    v_secs := coalesce((v_sd->'steps'->(p_step)->>'seconds')::int, 0);
    select coalesce(jsonb_agg(x->'player_id' order by case x->>'kind' when 'witness' then 1 when 'detective' then 2 else 3 end, o), '[]'::jsonb)
      into v_order
      from jsonb_array_elements(v_sd->'cast') with ordinality t(x, o)
     where x->>'kind' in ('witness', 'detective', 'accused');
    v_len := jsonb_array_length(v_order);
    if v_secs > 0 and v_len > 0 then
      v_start := (v_sd->>'ends_at')::timestamptz - make_interval(secs => v_secs);
      v_slot := greatest(30, v_secs::numeric / v_len);
      v_index := least(v_len - 1, floor(extract(epoch from (now() + interval '1 second' - v_start)) / v_slot)::int);
      if v_index >= 0 and v_index > coalesce((v_sd->>'stand_slot')::int, -1) then
        v_sd := v_sd || jsonb_build_object('stand', v_order->v_index, 'stand_slot', v_index);
        v_done := true;
      end if;
    end if;
  end if;
  if v_done then
    update public.room_game_state set state_data = v_sd where room_id = p_room_id;
    return jsonb_build_object('ok', true, 'turn', true);
  end if;
  if v_sd->>'phase' = 'vote' and coalesce((v_sd->>'voters_count')::int, 0) > 0
     and coalesce((v_sd->>'votes_count')::int, 0) >= (v_sd->>'voters_count')::int then
    return public.court_advance(p_room_id, p_step);
  end if;
  if coalesce((v_sd->'settings'->>'auto')::boolean, false)
     and v_sd->>'phase' in ('evidence', 'question', 'closing', 'vote')
     and nullif(v_sd->>'ends_at', '') is not null
     and (v_sd->>'ends_at')::timestamptz <= now() + interval '1 second' then
    return public.court_advance(p_room_id, p_step);
  end if;
  return jsonb_build_object('ok', false, 'reason', 'NOT_YET');
end;
$$;

-- الاستبدال: يحفظ حقيقة المتهم.
create or replace function public.court_replace(p_room_id uuid, p_from uuid, p_to uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sd jsonb;
  v_entry jsonb;
  v_to_kind text;
  v_role jsonb;
  v_to_clue text;
  v_had boolean;
begin
  if not public.court_can_run(p_room_id) then
    return jsonb_build_object('ok', false, 'reason', 'NOT_HOST');
  end if;
  select state_data into v_sd from public.room_game_state where room_id = p_room_id for update;
  if v_sd->>'game' is distinct from 'court' or v_sd->>'phase' in ('verdict', 'over') then
    return jsonb_build_object('ok', false, 'reason', 'WRONG_PHASE');
  end if;
  if p_from = p_to or not exists (select 1 from public.room_players where id = p_to and room_id = p_room_id)
     or coalesce(v_sd->>'judge_id', '') = p_to::text then
    return jsonb_build_object('ok', false, 'reason', 'BAD_PLAYER');
  end if;
  select x into v_entry from jsonb_array_elements(v_sd->'cast') x where x->>'player_id' = p_from::text;
  if v_entry is null then
    return jsonb_build_object('ok', false, 'reason', 'NOT_IN_CASE');
  end if;
  select kind, clue into v_to_kind, v_to_clue from public.room_court_roles where room_id = p_room_id and player_id = p_to;
  if v_to_kind is not null and v_to_kind <> 'juror' then
    return jsonb_build_object('ok', false, 'reason', 'HAS_ROLE');
  end if;

  v_had := exists (select 1 from public.room_court_roles where room_id = p_room_id and player_id = p_from);
  delete from public.room_court_roles where room_id = p_room_id and player_id = p_to;
  if v_had then
    update public.room_court_roles set player_id = p_to where room_id = p_room_id and player_id = p_from;
  end if;
  if not exists (select 1 from public.room_court_roles where room_id = p_room_id and player_id = p_to) then
    -- صفّه انحذف مع خروجه من الغرفة: يُعاد بناء الدور.
    if v_entry->>'kind' = 'juror' then
      insert into public.room_court_roles (room_id, player_id, role_key, kind, name, brief, secret, clue)
      values (p_room_id, p_to, v_entry->>'role_key', 'juror', 'محلّف', 'عضو في هيئة المحلفين.',
              'لا تعرف عن القضية إلا ما يُعرض في الجلسة. اسأل المتهم والشهود، وانتبه للتناقض بين الأقوال والأدلة، ثم صوّت بالعدل. كل صوت يطابق الحقيقة = 100 نقطة. ولك سؤال ذهبي واحد.',
              v_to_clue);
    else
      select x into v_role from public.room_court rc, jsonb_array_elements(coalesce(rc.roles, '[]'::jsonb)) x
       where rc.room_id = p_room_id and x->>'key' = v_entry->>'role_key';
      if v_role is null then
        return jsonb_build_object('ok', false, 'reason', 'NO_ROLE');
      end if;
      insert into public.room_court_roles (room_id, player_id, role_key, kind, name, brief, secret, later, later_stage, win, goal, exhibits)
      values (p_room_id, p_to, v_role->>'key', v_role->>'kind', btrim(v_role->>'name'),
              nullif(btrim(coalesce(v_role->>'brief', '')), ''), btrim(v_role->>'secret'),
              nullif(btrim(coalesce(v_role->>'later', '')), ''),
              case when nullif(btrim(coalesce(v_role->>'later', '')), '') is null then null
                   when coalesce((v_sd->'settings'->>'quick')::boolean, false) then 1
                   else greatest(1, least(3, coalesce((v_role->>'later_stage')::int, 2))) end,
              public.court_win_of(v_role->>'kind', v_role->>'win'),
              nullif(btrim(coalesce(v_role->>'goal', '')), ''),
              case when jsonb_typeof(v_role->'exhibits') = 'array' and jsonb_array_length(v_role->'exhibits') > 0 then v_role->'exhibits' else null end);
    end if;
  end if;
  -- حقيقة المتهم تبقى مع دوره.
  update public.room_court_roles nr set guilty = coalesce(nr.guilty,
      (select case when jsonb_typeof(x->'guilty') = 'boolean' then (x->>'guilty')::boolean else rc.guilty end
         from public.room_court rc, jsonb_array_elements(coalesce(rc.roles, '[]'::jsonb)) x
        where rc.room_id = p_room_id and x->>'key' = nr.role_key))
   where nr.room_id = p_room_id and nr.player_id = p_to and nr.kind = 'accused';
  delete from public.room_court_votes where room_id = p_room_id and player_id in (p_from, p_to);
  update public.room_game_state
     set state_data = state_data || jsonb_build_object(
       'cast', public.court_cast(p_room_id),
       'accused', (select coalesce(jsonb_agg(jsonb_build_object('key', r2.role_key, 'name', r2.name, 'player_id', r2.player_id) order by r2.role_key), '[]'::jsonb)
                     from public.room_court_roles r2 where r2.room_id = p_room_id and r2.kind = 'accused'),
       'stand', case when state_data->>'stand' = p_from::text then to_jsonb(p_to) else state_data->'stand' end,
       'asking', case when state_data->>'asking' = p_from::text then to_jsonb(p_to) else state_data->'asking' end,
       'exhibits_used', coalesce(state_data->'exhibits_used', '{}'::jsonb) - p_from::text
                        || case when state_data->'exhibits_used' ? p_from::text then jsonb_build_object(p_to::text, state_data->'exhibits_used'->p_from::text) else '{}'::jsonb end,
       'votes_count', (select count(*) from public.room_court_votes where room_id = p_room_id),
       'voters_count', (select count(*) from public.room_court_roles where room_id = p_room_id and kind <> 'accused'))
   where room_id = p_room_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- عدّاد مولّد القضايا: كم طلبًا بقي للمستخدم في هذه الساعة (يُقرأ من الواجهة).
create or replace function public.court_ai_quota()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('used', count(*), 'limit', case when public.is_app_admin() then 30 else 5 end)
    from public.court_ai_log where user_id = auth.uid() and at > now() - interval '1 hour';
$$;
revoke all on function public.court_ai_quota() from public, anon;
grant execute on function public.court_ai_quota() to authenticated;

notify pgrst, 'reload schema';
