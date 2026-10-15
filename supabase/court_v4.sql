-- =============================================================================
-- «المحكمة»، الإصدار 4. يُشغَّل بعد court_v3.sql، وتشغيله مرة ثانية آمن.
--
--  1) نسخ للحقيقة: القضية تحمل نسخًا بديلة (variants) تغيّر الحكم والفاعل والحقيقة وبطاقات
--     الأدوار وبعض الأدلة، والنظام يختار نسخة لم تُلعب في الغرفة.
--  2) أدلة يقدمها اللاعبون: roles[].exhibits دليل أو أكثر يكشفه صاحبه على الشاشة متى شاء.
--  3) جلسة سريعة: جولة أدلة واحدة، استجواب دقيقتين، مرافعة 30 ثانية، تصويت 30 ثانية.
--  4) قاضٍ من اللاعبين: لاعب بالقرعة يدير الجلسة من جواله، والمضيف يبقى احتياطيًا.
--  5) آلية: دور السؤال 45 ثانية ثم للتالي، والاعتراض يُرفض وحده بعد 10 ثوانٍ بلا حكم،
--     و«أبي أسأل» يعطي الدور مباشرة إذا لم يكن أحد يسأل، والأهداف السرية بتصويت اللاعبين.
--  6) من يدخل بعد التوزيع ينضم محلّفًا. والغرف الصغيرة بلا محلّفين: الشهود والمحقق يأخذون
--     السؤال الذهبي ومعلومات المحلّفين.
--  7) ترتيب السهرة: النقاط تتجمع من قضية لقضية حتى «سهرة جديدة».
--  8) «أقنعتك مرافعة مين؟» في التصويت، وأفضل مرافعة +50.
--  9) إصلاحات: الاستبدال يحفظ الهدف وطريقة الفوز والأدلة، وبيانات المحكمة تُمسح مع «جولة جديدة».
-- =============================================================================

-- الأعمدة والجداول -------------------------------------------------------------

alter table public.court_cases add column if not exists variants jsonb;
comment on column public.court_cases.variants is '[{key, label, guilty, culprit, truth, roles: {مفتاح: {secret, later, goal, win, fallback, exhibits…}}, evidence: {عنوان: {text, time, remove}}, extra_evidence: [...], juror_clues}] نسخ بديلة للحقيقة.';

alter table public.room_court add column if not exists variant text;
alter table public.room_court add column if not exists roles jsonb;
alter table public.room_court add column if not exists clues jsonb;
alter table public.room_court_roles add column if not exists exhibits jsonb;
alter table public.room_court_votes add column if not exists pleading text;
alter table public.court_results add column if not exists variant text;

create table if not exists public.room_court_goal_votes (
  room_id uuid not null references public.game_rooms (id) on delete cascade,
  owner   uuid not null,
  voter   uuid not null,
  yes     boolean not null,
  primary key (room_id, owner, voter)
);
alter table public.room_court_goal_votes enable row level security;
revoke all on public.room_court_goal_votes from anon, authenticated;

-- بيانات المحكمة تُمسح حين يبدأ المضيف «جولة جديدة» (لعبة أخرى أو نفسها من البداية).
create or replace function public.court_cleanup_session()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.session is distinct from old.session then
    delete from public.room_court where room_id = new.id;
    delete from public.room_court_roles where room_id = new.id;
    delete from public.room_court_votes where room_id = new.id;
    delete from public.room_court_goal_votes where room_id = new.id;
  end if;
  return new;
end;
$$;
drop trigger if exists court_cleanup_session on public.game_rooms;
create trigger court_cleanup_session after update of session on public.game_rooms
  for each row execute function public.court_cleanup_session();
revoke all on function public.court_cleanup_session() from public, anon, authenticated;

-- التحقق: ما سبق، ومعه النسخ والأدلة التي يقدمها اللاعبون.
create or replace function public.court_cases_validate_v4()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v jsonb;
  r jsonb;
  v_keys text[] := '{}';
  v_role_keys text[];
begin
  select array_agg(x->>'key') into v_role_keys from jsonb_array_elements(new.roles) x;
  for r in select * from jsonb_array_elements(new.roles) loop
    if r ? 'exhibits' and r->'exhibits' <> 'null'::jsonb then
      if jsonb_typeof(r->'exhibits') <> 'array' or jsonb_array_length(r->'exhibits') > 3 then
        raise exception 'BAD_CASE: أدلة الدور «%» ثلاثة كحد أقصى.', r->>'name';
      end if;
      if exists (select 1 from jsonb_array_elements(r->'exhibits') e where char_length(btrim(coalesce(e->>'title', ''))) < 2 or char_length(btrim(coalesce(e->>'text', ''))) < 5) then
        raise exception 'BAD_CASE: كل دليل يقدمه «%» يحتاج عنوانًا ونصًا.', r->>'name';
      end if;
    end if;
  end loop;
  if new.variants is null or new.variants = '[]'::jsonb then
    new.variants := null;
    return new;
  end if;
  if jsonb_typeof(new.variants) <> 'array' or jsonb_array_length(new.variants) > 4 then
    raise exception 'BAD_CASE: النسخ البديلة 4 كحد أقصى.';
  end if;
  for v in select * from jsonb_array_elements(new.variants) loop
    if coalesce(v->>'key', '') = '' or v->>'key' = 'base' or (v->>'key') = any (v_keys) then
      raise exception 'BAD_CASE: مفاتيح النسخ يجب أن تكون مختلفة.';
    end if;
    v_keys := array_append(v_keys, v->>'key');
    if char_length(btrim(coalesce(v->>'truth', ''))) < 10 then
      raise exception 'BAD_CASE: النسخة «%» تحتاج حقيقتها.', coalesce(v->>'label', v->>'key');
    end if;
    if jsonb_typeof(v->'guilty') is distinct from 'boolean' then
      raise exception 'BAD_CASE: حدد في النسخة «%» هل المتهم مذنب.', coalesce(v->>'label', v->>'key');
    end if;
    if new.suspects is not null and nullif(v->>'culprit', '') is not null
       and not exists (select 1 from jsonb_array_elements(new.suspects) s where s->>'key' = v->>'culprit') then
      raise exception 'BAD_CASE: فاعل النسخة «%» ليس في قائمة المشتبهين.', coalesce(v->>'label', v->>'key');
    end if;
    if jsonb_typeof(coalesce(v->'roles', '{}'::jsonb)) <> 'object'
       or exists (select 1 from jsonb_object_keys(coalesce(v->'roles', '{}'::jsonb)) k where not (k = any (v_role_keys))) then
      raise exception 'BAD_CASE: النسخة «%» تغيّر دورًا غير موجود.', coalesce(v->>'label', v->>'key');
    end if;
  end loop;
  return new;
end;
$$;
drop trigger if exists court_cases_validate_v4 on public.court_cases;
create trigger court_cases_validate_v4 before insert or update on public.court_cases
  for each row execute function public.court_cases_validate_v4();
revoke all on function public.court_cases_validate_v4() from public, anon, authenticated;

-- القضية بعد تطبيق نسخة: {guilty, culprit, truth, roles, evidence, juror_clues}.
create or replace function public.court_apply_variant(p_case public.court_cases, p_variant jsonb)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'guilty', coalesce((p_variant->>'guilty')::boolean, p_case.guilty),
    'culprit', coalesce(nullif(p_variant->>'culprit', ''), p_case.culprit),
    'truth', coalesce(nullif(btrim(p_variant->>'truth'), ''), p_case.truth),
    'roles', (select jsonb_agg(
                case when p_variant->'roles' ? (r->>'key')
                     then jsonb_strip_nulls(r || (p_variant->'roles'->(r->>'key')))
                     else r end order by o)
                from jsonb_array_elements(p_case.roles) with ordinality t(r, o)),
    'evidence', coalesce((select jsonb_agg(
                case when p_variant->'evidence' ? (e->>'title')
                     then (e || (p_variant->'evidence'->(e->>'title'))) - 'remove'
                     else e end order by o)
                from jsonb_array_elements(p_case.evidence) with ordinality t(e, o)
               where not coalesce((p_variant->'evidence'->(e->>'title')->>'remove')::boolean, false)), '[]'::jsonb)
             || coalesce(p_variant->'extra_evidence', '[]'::jsonb),
    'juror_clues', coalesce(p_variant->'juror_clues', p_case.juror_clues, '[]'::jsonb));
$$;
revoke all on function public.court_apply_variant(public.court_cases, jsonb) from public, anon, authenticated;

-- من يدير الجلسة: المضيف، أو القاضي الذي اختارته القرعة.
create or replace function public.court_can_run(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_room_host(p_room_id) or public.is_app_admin()
      or exists (select 1 from public.room_game_state s
                  where s.room_id = p_room_id and nullif(s.state_data->>'judge_id', '') is not null
                    and (s.state_data->>'judge_id')::uuid = public.my_player_id(p_room_id));
$$;
revoke all on function public.court_can_run(uuid) from public, anon;
grant execute on function public.court_can_run(uuid) to authenticated;

-- أقل عدد لاعبين لقضية: أدوارها الأساسية (4 على الأقل)، وواحد زيادة إذا كان القاضي لاعبًا.
create or replace function public.court_cases_list()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id, 'title', c.title, 'category', c.category, 'difficulty', c.difficulty,
           'summary', c.summary, 'min', public.court_case_min(c.roles), 'roles', jsonb_array_length(c.roles),
           'versions', 1 + coalesce(jsonb_array_length(c.variants), 0))
         order by c.difficulty, c.title), '[]'::jsonb)
    from public.court_cases c
   where c.is_active;
$$;

-- البداية ---------------------------------------------------------------------
-- p_settings: {case_id, host_plays, auto, quick, judge: host|random, question_seconds, closing_seconds, vote_seconds, new_evening}

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

  -- القضية: المختارة، أو قضية تناسب العدد وفيها نسخة لم تُلعب في الغرفة.
  v_used := coalesce(v_sd->'last_settings'->'used_cases', '[]'::jsonb);
  v_used_v := coalesce(v_sd->'last_settings'->'used_variants', '[]'::jsonb);
  if nullif(p_settings->>'case_id', '') is not null then
    select * into v_case from public.court_cases where id = (p_settings->>'case_id')::uuid and is_active;
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
      insert into public.room_court_roles (room_id, player_id, role_key, kind, name, brief, secret, later, later_stage, win, goal, exhibits)
      values (p_room_id, v_players[i], v_r->>'key', v_r->>'kind', btrim(v_r->>'name'),
              nullif(btrim(coalesce(v_r->>'brief', '')), ''), btrim(v_r->>'secret'),
              nullif(btrim(coalesce(v_r->>'later', '')), ''),
              case when nullif(btrim(coalesce(v_r->>'later', '')), '') is null then null
                   when v_quick then 1
                   else greatest(1, least(3, coalesce((v_r->>'later_stage')::int, 2))) end,
              public.court_win_of(v_r->>'kind', v_r->>'win'),
              nullif(btrim(coalesce(v_r->>'goal', '')), ''),
              case when jsonb_typeof(v_r->'exhibits') = 'array' and jsonb_array_length(v_r->'exhibits') > 0 then v_r->'exhibits' else null end);
    end if;
  end loop;

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
    'quick', v_quick, 'judge', case when v_random_judge then 'random' else 'host' end,
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
           'judge_id', v_judge, 'judge_name', v_judge_name,
           'objection', null, 'objections', '{}'::jsonb, 'objection_points', '{}'::jsonb,
           'queue', '[]'::jsonb, 'asking', null, 'asking_since', null, 'golden', null, 'golden_used', '{}'::jsonb, 'golden_kinds', v_golden_kinds,
           'exhibits_used', '{}'::jsonb, 'presented', null,
           'suspects', (select jsonb_agg(jsonb_build_object('key', s->>'key', 'name', btrim(s->>'name'))) from jsonb_array_elements(v_case.suspects) s),
           'votes_count', 0, 'voters_count', 0, 'verdict', null, 'truth', null, 'points', null, 'cards', null,
           'goals', null, 'goals_awarded', '{}'::jsonb, 'goal_votes', '{}'::jsonb, 'pleading', null,
           'fallbacks', jsonb_array_length(v_extra), 'settings', v_settings, 'last_settings', null)
   where room_id = p_room_id;
  return jsonb_build_object('ok', true, 'case', v_case.title, 'variant', v_variant_key);
end;
$$;
revoke all on function public.court_start(uuid, jsonb) from public, anon;
grant execute on function public.court_start(uuid, jsonb) to authenticated;

-- الانتقال للمرحلة التالية (بلا تحقق من الصلاحية).
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
    'side', v_next->'side', 'queue', '[]'::jsonb, 'asking', null, 'asking_since', null, 'golden', null);

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
    select count(*) filter (where guilty), count(*) filter (where not guilty) into v_g, v_i
      from public.room_court_votes where room_id = p_room_id;
    v_verdict := v_g > v_i;  -- التعادل لصالح المتهم
    select count(*) filter (where pleading = 'prosecutor'), count(*) filter (where pleading = 'lawyer') into v_pp, v_pl
      from public.room_court_votes where room_id = p_room_id;
    v_best := case when v_pp > v_pl then 'prosecutor' when v_pl > v_pp then 'lawyer' else null end;
    v_sd := v_sd || jsonb_build_object(
      'verdict', jsonb_build_object('guilty', v_verdict, 'votes_guilty', v_g, 'votes_innocent', v_i),
      'pleading', jsonb_build_object('prosecutor', v_pp, 'lawyer', v_pl, 'winner', v_best));
  elsif v_phase = 'over' then
    v_verdict := coalesce((v_sd->'verdict'->>'guilty')::boolean, false);
    v_best := v_sd->'pleading'->>'winner';
    perform set_config('alosh.trusted', 'on', true);
    for v_row in
      select r.player_id, r.kind, r.name, r.win, r.goal, p.player_name, v.guilty vote, v.culprit pick
        from public.room_court_roles r
        join public.room_players p on p.id = r.player_id
        left join public.room_court_votes v on v.room_id = r.room_id and v.player_id = r.player_id
       where r.room_id = p_room_id
    loop
      v_pts := 0;
      v_why := '{}';
      if v_row.kind <> 'accused' and v_row.vote is not null and v_row.vote = v_court.guilty then
        v_pts := v_pts + 100;
        v_why := array_append(v_why, 'صوت صحيح');
      end if;
      if v_has_suspects and v_row.kind <> 'accused' and v_row.pick is not null and v_row.pick = v_court.culprit then
        v_pts := v_pts + 150;
        v_why := array_append(v_why, 'عرف الفاعل');
      end if;
      v_win := public.court_win_of(v_row.kind, v_row.win);
      if v_row.kind = 'accused' then
        if not v_verdict then
          v_pts := v_pts + 300;
          v_why := array_append(v_why, 'نجا من الإدانة');
        end if;
      elsif v_win = 'convict' and v_verdict then
        v_pts := v_pts + 200;
        v_why := array_append(v_why, 'أُدين المتهم');
      elsif v_win = 'acquit' and not v_verdict then
        v_pts := v_pts + 200;
        v_why := array_append(v_why, 'بُرّئ المتهم');
      elsif v_win = 'truth' and v_verdict = v_court.guilty then
        v_pts := v_pts + 200;
        v_why := array_append(v_why, 'تحققت العدالة');
      end if;
      if v_row.kind in ('prosecutor', 'lawyer') and v_verdict = v_court.guilty then
        v_pts := v_pts + 100;
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
        'vote_ok', v_row.kind <> 'accused' and v_row.vote is not null and v_row.vote = v_court.guilty,
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
                 + case when (v_t->>'vote_ok')::boolean then 1 else 0 end + case when (v_t->>'pick_ok')::boolean then 1 else 0 end,
        'speaker', coalesce((v_totals->(v_t->>'player_id')->>'speaker')::int, 0)
                 + case when v_t->>'kind' in ('prosecutor', 'lawyer', 'accused') then (v_t->>'points')::int else 0 end));
    end loop;
    v_evening := jsonb_build_object('matches', coalesce((v_evening->>'matches')::int, 0) + 1, 'totals', v_totals);

    v_sd := v_sd || jsonb_build_object(
      'truth', jsonb_build_object('guilty', v_court.guilty, 'text', v_court.truth, 'correct', v_verdict = v_court.guilty,
        'culprit', (select s->>'name' from jsonb_array_elements(v_court.suspects) s where s->>'key' = v_court.culprit),
        'culprit_key', v_court.culprit, 'variant', v_court.variant),
      'points', v_points,
      'settings', (v_sd->'settings') || jsonb_build_object('evening', v_evening),
      'cards', (select coalesce(jsonb_agg(jsonb_build_object('player_name', p.player_name, 'kind', r.kind, 'name', r.name, 'secret', r.secret, 'later', r.later,
                    'goal', r.goal, 'win', public.court_win_of(r.kind, r.win), 'clue', r.clue)
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

-- أدوات من يدير الجلسة (المضيف أو القاضي) ----------------------------------------

create or replace function public.court_next(p_room_id uuid, p_step int default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.court_can_run(p_room_id) then
    return jsonb_build_object('ok', false, 'reason', 'NOT_HOST');
  end if;
  return public.court_advance(p_room_id, p_step);
end;
$$;

create or replace function public.court_stand(p_room_id uuid, p_player_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sd jsonb;
begin
  if not public.court_can_run(p_room_id) then
    return jsonb_build_object('ok', false, 'reason', 'NOT_HOST');
  end if;
  select state_data into v_sd from public.room_game_state where room_id = p_room_id for update;
  if v_sd->>'game' is distinct from 'court' or v_sd->>'phase' <> 'question' then
    return jsonb_build_object('ok', false, 'reason', 'WRONG_PHASE');
  end if;
  if p_player_id is not null and not exists (select 1 from public.room_court_roles where room_id = p_room_id and player_id = p_player_id) then
    return jsonb_build_object('ok', false, 'reason', 'NOT_IN_CASE');
  end if;
  update public.room_game_state set state_data = state_data || jsonb_build_object('stand', p_player_id) where room_id = p_room_id;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.court_call(p_room_id uuid, p_player_id uuid, p_drop boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sd jsonb;
  v_queue jsonb;
begin
  if not public.court_can_run(p_room_id) then
    return jsonb_build_object('ok', false, 'reason', 'NOT_HOST');
  end if;
  select state_data into v_sd from public.room_game_state where room_id = p_room_id for update;
  if v_sd->>'phase' <> 'question' then
    return jsonb_build_object('ok', false, 'reason', 'WRONG_PHASE');
  end if;
  select coalesce(jsonb_agg(q), '[]'::jsonb) into v_queue from jsonb_array_elements(coalesce(v_sd->'queue', '[]'::jsonb)) q
   where p_player_id is null or q->>'player_id' <> p_player_id::text;
  if p_drop then
    update public.room_game_state set state_data = state_data || jsonb_build_object('queue', v_queue) where room_id = p_room_id;
  elsif p_player_id is null then
    -- «انتهى سؤاله»: الدور للتالي في القائمة مباشرة.
    update public.room_game_state
       set state_data = state_data || jsonb_build_object(
         'asking', v_queue->0->'player_id', 'asking_since', case when v_queue->0 is null then null else to_jsonb(now()) end,
         'queue', coalesce(v_queue - 0, '[]'::jsonb), 'golden', null)
     where room_id = p_room_id;
  else
    update public.room_game_state
       set state_data = state_data || jsonb_build_object('queue', v_queue, 'asking', to_jsonb(p_player_id), 'asking_since', now(), 'golden', null)
     where room_id = p_room_id;
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.court_rule(p_room_id uuid, p_accept boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sd jsonb;
  v_by text;
begin
  if not public.court_can_run(p_room_id) then
    return jsonb_build_object('ok', false, 'reason', 'NOT_HOST');
  end if;
  select state_data into v_sd from public.room_game_state where room_id = p_room_id for update;
  if jsonb_typeof(v_sd->'objection') <> 'object' or v_sd->'objection'->>'status' <> 'pending' then
    return jsonb_build_object('ok', false, 'reason', 'NO_OBJECTION');
  end if;
  v_by := v_sd->'objection'->>'by';
  update public.room_game_state
     set state_data = state_data || jsonb_build_object(
       'objection', (state_data->'objection') || jsonb_build_object('status', case when p_accept then 'accepted' else 'rejected' end, 'ruled_at', now()),
       'objection_points', case when p_accept and v_by is not null
         then coalesce(state_data->'objection_points', '{}'::jsonb) || jsonb_build_object(v_by, coalesce((state_data->'objection_points'->>v_by)::int, 0) + 1)
         else coalesce(state_data->'objection_points', '{}'::jsonb) end)
   where room_id = p_room_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- منح الهدف يدويًا (المضيف أو القاضي)، احتياطًا لتصويت اللاعبين.
create or replace function public.court_goal(p_room_id uuid, p_player_id uuid, p_on boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.court_can_run(p_room_id) then
    return jsonb_build_object('ok', false, 'reason', 'NOT_HOST');
  end if;
  return public.court_goal_set(p_room_id, p_player_id, p_on);
end;
$$;

create or replace function public.court_goal_set(p_room_id uuid, p_player_id uuid, p_on boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sd jsonb;
  v_was boolean;
  v_delta int;
begin
  select state_data into v_sd from public.room_game_state where room_id = p_room_id for update;
  if v_sd->>'phase' <> 'over' then
    return jsonb_build_object('ok', false, 'reason', 'WRONG_PHASE');
  end if;
  if not exists (select 1 from public.room_court_roles where room_id = p_room_id and player_id = p_player_id and goal is not null) then
    return jsonb_build_object('ok', false, 'reason', 'NOT_IN_CASE');
  end if;
  v_was := coalesce((v_sd->'goals_awarded'->>p_player_id::text)::boolean, false);
  if v_was = p_on then
    return jsonb_build_object('ok', true);
  end if;
  v_delta := case when p_on then 100 else -100 end;
  perform set_config('alosh.trusted', 'on', true);
  update public.room_players set score = score + v_delta where id = p_player_id;
  update public.room_game_state
     set state_data = state_data || jsonb_build_object(
       'goals_awarded', coalesce(state_data->'goals_awarded', '{}'::jsonb) || jsonb_build_object(p_player_id::text, p_on),
       'points', (select coalesce(jsonb_agg(x order by (x->>'points')::int desc, x->>'player_name'), '[]'::jsonb) from (
           select case when x->>'player_id' = p_player_id::text
             then x || jsonb_build_object('points', (x->>'points')::int + v_delta,
                    'why', case when p_on then coalesce(x->'why', '[]'::jsonb) || '["حقق هدفه السري"]'::jsonb
                                else (select coalesce(jsonb_agg(w), '[]'::jsonb) from jsonb_array_elements(x->'why') w where w <> '"حقق هدفه السري"'::jsonb) end)
             else x end x
           from jsonb_array_elements(state_data->'points') x) y),
       'settings', jsonb_set(state_data->'settings', array['evening', 'totals', p_player_id::text, 'points'],
           to_jsonb(coalesce((state_data->'settings'->'evening'->'totals'->p_player_id::text->>'points')::int, 0) + v_delta), false))
   where room_id = p_room_id;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.court_goal_set(uuid, uuid, boolean) from public, anon, authenticated;

-- اللاعبون يحكمون على الأهداف السرية: الأغلبية «نعم» تمنح 100.
create or replace function public.court_goal_vote(p_room_id uuid, p_owner uuid, p_yes boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := public.my_player_id(p_room_id);
  v_sd jsonb;
  v_yes int;
  v_no int;
  v_eligible int;
begin
  if v_me is null or v_me = p_owner or not exists (select 1 from public.room_court_roles where room_id = p_room_id and player_id = v_me) then
    return jsonb_build_object('ok', false, 'reason', 'NOT_IN_CASE');
  end if;
  select state_data into v_sd from public.room_game_state where room_id = p_room_id for update;
  if v_sd->>'phase' <> 'over' then
    return jsonb_build_object('ok', false, 'reason', 'WRONG_PHASE');
  end if;
  if not exists (select 1 from public.room_court_roles where room_id = p_room_id and player_id = p_owner and goal is not null) then
    return jsonb_build_object('ok', false, 'reason', 'NOT_IN_CASE');
  end if;
  insert into public.room_court_goal_votes (room_id, owner, voter, yes) values (p_room_id, p_owner, v_me, p_yes)
  on conflict (room_id, owner, voter) do update set yes = excluded.yes;
  select count(*) filter (where yes), count(*) filter (where not yes) into v_yes, v_no
    from public.room_court_goal_votes where room_id = p_room_id and owner = p_owner;
  select count(*) - 1 into v_eligible from public.room_court_roles where room_id = p_room_id;
  update public.room_game_state
     set state_data = state_data || jsonb_build_object('goal_votes',
       coalesce(state_data->'goal_votes', '{}'::jsonb) || jsonb_build_object(p_owner::text, jsonb_build_object('yes', v_yes, 'no', v_no, 'of', v_eligible)))
   where room_id = p_room_id;
  if v_yes * 2 > v_eligible then
    perform public.court_goal_set(p_room_id, p_owner, true);
  elsif v_no * 2 >= v_eligible then
    perform public.court_goal_set(p_room_id, p_owner, false);
  end if;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.court_goal_vote(uuid, uuid, boolean) from public, anon;
grant execute on function public.court_goal_vote(uuid, uuid, boolean) to authenticated;

-- اللاعبون ---------------------------------------------------------------------

-- «أبي أسأل»: إذا لم يكن أحد يسأل يأخذ الدور فورًا، وإلا يدخل القائمة.
create or replace function public.court_raise(p_room_id uuid, p_on boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := public.my_player_id(p_room_id);
  v_name text;
  v_sd jsonb;
  v_queue jsonb;
begin
  select p.player_name into v_name from public.room_court_roles r join public.room_players p on p.id = r.player_id
   where r.room_id = p_room_id and r.player_id = v_me;
  if v_name is null then
    return jsonb_build_object('ok', false, 'reason', 'NOT_IN_CASE');
  end if;
  select state_data into v_sd from public.room_game_state where room_id = p_room_id for update;
  if v_sd->>'phase' <> 'question' then
    return jsonb_build_object('ok', false, 'reason', 'WRONG_PHASE');
  end if;
  select coalesce(jsonb_agg(q), '[]'::jsonb) into v_queue from jsonb_array_elements(coalesce(v_sd->'queue', '[]'::jsonb)) q where q->>'player_id' <> v_me::text;
  if p_on and nullif(v_sd->>'asking', '') is null then
    update public.room_game_state set state_data = state_data || jsonb_build_object('queue', v_queue, 'asking', v_me, 'asking_since', now()) where room_id = p_room_id;
    return jsonb_build_object('ok', true, 'asking', true);
  end if;
  if p_on and coalesce(v_sd->>'asking', '') <> v_me::text then
    v_queue := v_queue || jsonb_build_array(jsonb_build_object('player_id', v_me, 'name', v_name, 'at', now()));
  end if;
  update public.room_game_state set state_data = state_data || jsonb_build_object('queue', v_queue) where room_id = p_room_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- السؤال الذهبي: للمحلّفين، أو للشهود والمحقق في الغرف الصغيرة.
create or replace function public.court_golden(p_room_id uuid, p_target uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := public.my_player_id(p_room_id);
  v_kind text;
  v_name text;
  v_target jsonb;
  v_sd jsonb;
begin
  select r.kind, p.player_name into v_kind, v_name from public.room_court_roles r join public.room_players p on p.id = r.player_id
   where r.room_id = p_room_id and r.player_id = v_me;
  select state_data into v_sd from public.room_game_state where room_id = p_room_id for update;
  if v_kind is null or not (coalesce(v_sd->'golden_kinds', '["juror"]'::jsonb) ? v_kind) then
    return jsonb_build_object('ok', false, 'reason', 'JURORS_ONLY');
  end if;
  if v_sd->>'phase' <> 'question' then
    return jsonb_build_object('ok', false, 'reason', 'WRONG_PHASE');
  end if;
  if coalesce((v_sd->'golden_used'->>v_me::text)::boolean, false) then
    return jsonb_build_object('ok', false, 'reason', 'GOLDEN_USED');
  end if;
  select x into v_target from jsonb_array_elements(v_sd->'cast') x where x->>'player_id' = p_target::text and x->>'kind' <> 'juror';
  if v_target is null or p_target = v_me then
    return jsonb_build_object('ok', false, 'reason', 'NOT_IN_CASE');
  end if;
  update public.room_game_state
     set state_data = state_data || jsonb_build_object(
       'golden', jsonb_build_object('by', v_me, 'by_name', v_name, 'target', p_target, 'target_name', v_target->>'name', 'at', now()),
       'golden_used', coalesce(state_data->'golden_used', '{}'::jsonb) || jsonb_build_object(v_me::text, true),
       'stand', to_jsonb(p_target), 'asking', to_jsonb(v_me), 'asking_since', now(),
       'queue', (select coalesce(jsonb_agg(q), '[]'::jsonb) from jsonb_array_elements(coalesce(state_data->'queue', '[]'::jsonb)) q where q->>'player_id' <> v_me::text))
   where room_id = p_room_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- دليل يقدمه اللاعب من ملفه: يظهر للجميع أثناء الاستجواب أو المرافعة.
create or replace function public.court_present(p_room_id uuid, p_index int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := public.my_player_id(p_room_id);
  v_r public.room_court_roles%rowtype;
  v_name text;
  v_sd jsonb;
  v_ex jsonb;
  v_used jsonb;
begin
  select * into v_r from public.room_court_roles where room_id = p_room_id and player_id = v_me;
  if not found or v_r.exhibits is null then
    return jsonb_build_object('ok', false, 'reason', 'NOT_ALLOWED');
  end if;
  v_ex := v_r.exhibits->p_index;
  if v_ex is null then
    return jsonb_build_object('ok', false, 'reason', 'NOT_ALLOWED');
  end if;
  select state_data into v_sd from public.room_game_state where room_id = p_room_id for update;
  if v_sd->>'phase' not in ('question', 'closing') then
    return jsonb_build_object('ok', false, 'reason', 'WRONG_PHASE');
  end if;
  v_used := coalesce(v_sd->'exhibits_used'->v_me::text, '[]'::jsonb);
  if v_used @> to_jsonb(p_index) then
    return jsonb_build_object('ok', false, 'reason', 'ALREADY_PRESENTED');
  end if;
  select player_name into v_name from public.room_players where id = v_me;
  update public.room_game_state
     set state_data = state_data || jsonb_build_object(
       'evidence', coalesce(state_data->'evidence', '[]'::jsonb) || jsonb_build_array(
          public.court_ev(v_ex || jsonb_build_object('stage', coalesce((state_data->>'stage')::int, 1)))
          || jsonb_build_object('presented', true, 'by_kind', v_r.kind, 'by_name', v_r.name, 'by_player', v_name)),
       'exhibits_used', coalesce(state_data->'exhibits_used', '{}'::jsonb) || jsonb_build_object(v_me::text, v_used || to_jsonb(p_index)),
       'presented', jsonb_build_object('title', v_ex->>'title', 'icon', coalesce(nullif(v_ex->>'icon', ''), '📄'), 'by_kind', v_r.kind, 'by_name', v_r.name, 'at', now()))
   where room_id = p_room_id;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.court_present(uuid, int) from public, anon;
grant execute on function public.court_present(uuid, int) to authenticated;

-- من دخل الغرفة بعد التوزيع ينضم محلّفًا، حتى نهاية التصويت.
create or replace function public.court_join_jury(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := public.my_player_id(p_room_id);
  v_sd jsonb;
  v_clue text;
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'reason', 'NO_SESSION');
  end if;
  select state_data into v_sd from public.room_game_state where room_id = p_room_id for update;
  if v_sd->>'game' is distinct from 'court' or v_sd->>'phase' not in ('intro', 'evidence', 'question', 'closing', 'vote') then
    return jsonb_build_object('ok', false, 'reason', 'WRONG_PHASE');
  end if;
  if exists (select 1 from public.room_court_roles where room_id = p_room_id and player_id = v_me)
     or coalesce(v_sd->>'judge_id', '') = v_me::text then
    return jsonb_build_object('ok', true);
  end if;
  if (select count(*) from public.room_court_roles where room_id = p_room_id) >= 14 then
    return jsonb_build_object('ok', false, 'reason', 'TOO_MANY_PLAYERS');
  end if;
  select c into v_clue from public.room_court rc, jsonb_array_elements_text(coalesce(rc.clues, '[]'::jsonb)) c
   where rc.room_id = p_room_id and not exists (select 1 from public.room_court_roles r where r.room_id = p_room_id and r.clue = c)
   limit 1;
  insert into public.room_court_roles (room_id, player_id, role_key, kind, name, brief, secret, clue)
  values (p_room_id, v_me, 'juror-late-' || left(v_me::text, 8), 'juror', 'محلّف', 'انضم إلى هيئة المحلفين أثناء الجلسة.',
          'دخلت والجلسة قائمة: اقرأ القضية والأدلة على الشاشة، واسأل، ثم صوّت. كل صوت يطابق الحقيقة = 100 نقطة. ولك سؤال ذهبي واحد.', v_clue);
  update public.room_game_state
     set state_data = state_data || jsonb_build_object('cast', public.court_cast(p_room_id),
       'voters_count', case when state_data->>'phase' = 'vote' then to_jsonb((state_data->>'voters_count')::int + 1) else state_data->'voters_count' end)
   where room_id = p_room_id;
  return jsonb_build_object('ok', true, 'joined', true);
end;
$$;
revoke all on function public.court_join_jury(uuid) from public, anon;
grant execute on function public.court_join_jury(uuid) to authenticated;

-- التصويت: مرافعة مين أقنعتك (لغير المدعي والمحامي)، والحكم، ومن الفاعل.
drop function if exists public.court_vote(uuid, boolean, text);
create or replace function public.court_vote(p_room_id uuid, p_guilty boolean default null, p_culprit text default null, p_pleading text default null)
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
  insert into public.room_court_votes (room_id, player_id, guilty, culprit, pleading) values (p_room_id, v_me, p_guilty, p_culprit, p_pleading)
  on conflict (room_id, player_id) do update
    set guilty = coalesce(excluded.guilty, room_court_votes.guilty),
        culprit = coalesce(excluded.culprit, room_court_votes.culprit),
        pleading = coalesce(excluded.pleading, room_court_votes.pleading),
        at = now();
  select count(*) into v_count
    from public.room_court_votes v join public.room_court_roles r on r.room_id = v.room_id and r.player_id = v.player_id
   where v.room_id = p_room_id and v.guilty is not null
     and (not v_has_suspects or v.culprit is not null)
     and (r.kind in ('prosecutor', 'lawyer') or v.pleading is not null);
  update public.room_game_state set state_data = state_data || jsonb_build_object('votes_count', v_count) where room_id = p_room_id;
  if v_count >= coalesce((v_sd->>'voters_count')::int, 0) and coalesce((v_sd->>'voters_count')::int, 0) > 0 then
    perform public.court_advance(p_room_id, (v_sd->>'step')::int);
  end if;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.court_vote(uuid, boolean, text, text) from public, anon;
grant execute on function public.court_vote(uuid, boolean, text, text) to authenticated;

-- التلقائي: أي جهاز في الغرفة يطلبه، والخادم يتحقق.
--  - دور السؤال: بعد 45 ثانية ينتقل للتالي في القائمة.
--  - الاعتراض: بلا حكم بعد 10 ثوانٍ يُرفض.
--  - التصويت المكتمل، ومؤقتات المراحل إذا كان الانتقال تلقائيًا.
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

-- استبدال لاعب غادر: الدور يُبنى من أدوار القضية بعد تطبيق النسخة، بهدفه وطريقة فوزه وأدلته.
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
  delete from public.room_court_votes where room_id = p_room_id and player_id in (p_from, p_to);
  update public.room_game_state
     set state_data = state_data || jsonb_build_object(
       'cast', public.court_cast(p_room_id),
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

-- بطاقتي: مع القاضي والأدلة التي أقدمها وتصويتي على الأهداف.
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
    'vote', v_v.guilty, 'pick', v_v.culprit, 'pleading', v_v.pleading,
    'exhibits', v_r.exhibits,
    'exhibits_used', coalesce(v_sd->'exhibits_used'->v_me::text, '[]'::jsonb),
    'golden_left', coalesce(v_sd->'golden_kinds', '["juror"]'::jsonb) ? v_r.kind and not coalesce((v_sd->'golden_used'->>v_me::text)::boolean, false),
    'goal_votes', (select coalesce(jsonb_object_agg(g.owner::text, g.yes), '{}'::jsonb) from public.room_court_goal_votes g where g.room_id = p_room_id and g.voter = v_me),
    'objections_left', case when v_r.kind in ('prosecutor', 'lawyer') then 2 - coalesce((v_sd->'objections'->>v_me::text)::int, 0) else 0 end);
end;
$$;

-- مباراة جديدة في نفس الغرفة. p_new_evening يبدأ سهرة جديدة (يمسح ترتيب السهرة).
drop function if exists public.court_reset(uuid);
create or replace function public.court_reset(p_room_id uuid, p_new_evening boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sd jsonb;
  v_settings jsonb;
begin
  if not public.court_can_run(p_room_id) then
    return jsonb_build_object('ok', false, 'reason', 'NOT_HOST');
  end if;
  select state_data into v_sd from public.room_game_state where room_id = p_room_id for update;
  if v_sd->>'game' is distinct from 'court' then
    return jsonb_build_object('ok', false, 'reason', 'NOT_STARTED');
  end if;
  delete from public.room_court where room_id = p_room_id;
  delete from public.room_court_roles where room_id = p_room_id;
  delete from public.room_court_votes where room_id = p_room_id;
  delete from public.room_court_goal_votes where room_id = p_room_id;
  v_settings := (v_sd->'settings') - 'case_id';
  if p_new_evening then
    v_settings := v_settings - 'evening';
    perform set_config('alosh.trusted', 'on', true);
    update public.room_players set score = 0 where room_id = p_room_id;
  end if;
  update public.room_game_state set state_data = jsonb_build_object('last_settings', v_settings) where room_id = p_room_id;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.court_reset(uuid, boolean) from public, anon;
grant execute on function public.court_reset(uuid, boolean) to authenticated;

-- إحصائية القضايا: ومعها النسخ.
create or replace function public.court_case_stats()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when not public.is_app_admin() then '[]'::jsonb else coalesce((
    select jsonb_agg(jsonb_build_object('case_id', case_id, 'plays', plays, 'correct', correct, 'convicted', convicted, 'last', last, 'variants', variants))
      from (select case_id, count(*) plays, count(*) filter (where verdict = truth) correct, count(*) filter (where verdict) convicted, max(at) last,
                   to_jsonb(array_agg(distinct coalesce(variant, 'base'))) variants
              from public.court_results where case_id is not null group by case_id) s), '[]'::jsonb) end;
$$;

notify pgrst, 'reload schema';
