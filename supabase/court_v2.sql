-- =============================================================================
-- «المحكمة»، الإصدار 2. يُشغَّل بعد court_v1.sql، وتشغيله مرة ثانية آمن.
--
-- 1) وقت لكل دليل (evidence[].time مثل "9:20") يُرسم منه خط زمني على الشاشة.
-- 2) الدور الاختياري الذي لا يُوزَّع (لقلة اللاعبين) تتحول «إفادته» (roles[].fallback) إلى دليل
--    في جولته (roles[].fallback_stage، والافتراضي 2)، فلا تضيع معلومات القضية في الغرف الصغيرة.
-- 3) انتقال تلقائي (خيار): حين ينتهي مؤقت المرحلة تنتقل الجلسة وحدها (court_tick، يستدعيه أي جهاز
--    في الغرفة ولا ينجح إلا إذا انتهى الوقت فعلًا). ومع التلقائي تأخذ مرحلة الأدلة 30 ثانية للقراءة.
--    والتصويت يُغلق وحده إذا صوّت الجميع، تلقائيًا كان أو لا.
-- 4) نتائج كل مباراة في court_results، ومنها إحصائية كل قضية للوحة الإدارة.
-- 5) استبدال لاعب غادر: المضيف ينقل دوره لمن دخل الغرفة أو لمحلّف.
-- =============================================================================

create table if not exists public.court_results (
  id             bigint generated always as identity primary key,
  room_id        uuid references public.game_rooms (id) on delete set null,
  case_id        uuid references public.court_cases (id) on delete cascade,
  players        int not null,
  verdict        boolean not null,
  truth          boolean not null,
  votes_guilty   int not null,
  votes_innocent int not null,
  at             timestamptz not null default now()
);
create index if not exists court_results_case_idx on public.court_results (case_id);
alter table public.court_results enable row level security;
revoke all on public.court_results from anon, authenticated;
grant select on public.court_results to authenticated;
drop policy if exists "court_results: admin" on public.court_results;
create policy "court_results: admin" on public.court_results for select to authenticated using ((select public.is_app_admin()));

-- الدليل كما يُعرض: بوقته إن وُجد.
create or replace function public.court_ev(e jsonb)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object('stage', (e->>'stage')::int, 'title', e->>'title', 'text', e->>'text',
    'icon', coalesce(nullif(e->>'icon', ''), '📄'), 'time', nullif(btrim(coalesce(e->>'time', '')), ''));
$$;

-- يبدأ المحاكمة. p_settings: {case_id, host_plays, question_seconds, closing_seconds, vote_seconds, auto}
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
  v_players uuid[];
  v_n int;
  v_used jsonb;
  v_q int := coalesce((p_settings->>'question_seconds')::int, 180);
  v_c int := coalesce((p_settings->>'closing_seconds')::int, 60);
  v_v int := coalesce((p_settings->>'vote_seconds')::int, 60);
  v_roles jsonb := '[]'::jsonb;
  v_extra jsonb := '[]'::jsonb;
  v_evidence jsonb;
  v_r jsonb;
  v_optional_slots int;
  v_steps jsonb := '[]'::jsonb;
  v_cast jsonb := '[]'::jsonb;
  v_stage int;
  v_settings jsonb;
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
  if v_q not in (0, 120, 180, 300) then v_q := 180; end if;
  if v_c not in (0, 45, 60, 90) then v_c := 60; end if;
  if v_v not in (0, 30, 60, 90) then v_v := 60; end if;

  select array_agg(p.id order by random()) into v_players
    from public.room_players p
   where p.room_id = p_room_id and (v_host_plays or not p.is_host);
  v_n := coalesce(array_length(v_players, 1), 0);
  if v_n < 4 then
    return jsonb_build_object('ok', false, 'reason', 'NOT_ENOUGH_PLAYERS');
  end if;
  if v_n > 12 then
    return jsonb_build_object('ok', false, 'reason', 'TOO_MANY_PLAYERS');
  end if;

  v_used := coalesce(v_sd->'last_settings'->'used_cases', '[]'::jsonb);
  if nullif(p_settings->>'case_id', '') is not null then
    select * into v_case from public.court_cases where id = (p_settings->>'case_id')::uuid and is_active;
    if not found then
      return jsonb_build_object('ok', false, 'reason', 'NO_CASE');
    end if;
  else
    select * into v_case from public.court_cases c
     where c.is_active and public.court_case_min(c.roles) <= v_n
     order by (v_used ? c.id::text), random()
     limit 1;
    if not found then
      return jsonb_build_object('ok', false, 'reason', 'NO_CASE');
    end if;
  end if;
  if public.court_case_min(v_case.roles) > v_n then
    return jsonb_build_object('ok', false, 'reason', 'CASE_NEEDS_MORE', 'min', public.court_case_min(v_case.roles));
  end if;

  -- الأدوار: الأساسية كلها، ثم الاختيارية بالترتيب. الاختياري الذي لا يجد لاعبًا تصير إفادته دليلًا.
  v_optional_slots := v_n - (select count(*) from jsonb_array_elements(v_case.roles) x where not coalesce((x->>'optional')::boolean, false));
  for v_r in select x from jsonb_array_elements(v_case.roles) with ordinality t(x, o) order by o loop
    if coalesce((v_r->>'optional')::boolean, false) then
      if v_optional_slots <= 0 then
        if nullif(btrim(coalesce(v_r->>'fallback', '')), '') is not null then
          v_extra := v_extra || jsonb_build_array(jsonb_build_object(
            'stage', greatest(1, least(3, coalesce((v_r->>'fallback_stage')::int, 2))),
            'icon', '🗂️', 'title', 'إفادة ' || btrim(v_r->>'name'), 'text', btrim(v_r->>'fallback'),
            'time', nullif(btrim(coalesce(v_r->>'fallback_time', '')), '')));
        end if;
        continue;
      end if;
      v_optional_slots := v_optional_slots - 1;
    end if;
    v_roles := v_roles || jsonb_build_array(v_r);
  end loop;
  v_evidence := v_case.evidence || v_extra;

  delete from public.room_court where room_id = p_room_id;
  delete from public.room_court_roles where room_id = p_room_id;
  delete from public.room_court_votes where room_id = p_room_id;
  insert into public.room_court (room_id, case_id, guilty, truth, evidence)
  values (p_room_id, v_case.id, v_case.guilty, v_case.truth, v_evidence);

  for i in 1..v_n loop
    v_r := v_roles->(i - 1);
    if v_r is null then
      insert into public.room_court_roles (room_id, player_id, role_key, kind, name, brief, secret)
      values (p_room_id, v_players[i], 'juror-' || i, 'juror', 'محلّف', 'عضو في هيئة المحلفين.',
              'لا تعرف عن القضية إلا ما يُعرض في الجلسة. اسأل المتهم والشهود، وانتبه للتناقض بين الأقوال والأدلة، ثم صوّت بالعدل. كل صوت يطابق الحقيقة = 100 نقطة.');
    else
      insert into public.room_court_roles (room_id, player_id, role_key, kind, name, brief, secret, later, later_stage)
      values (p_room_id, v_players[i], v_r->>'key', v_r->>'kind', btrim(v_r->>'name'),
              nullif(btrim(coalesce(v_r->>'brief', '')), ''), btrim(v_r->>'secret'),
              nullif(btrim(coalesce(v_r->>'later', '')), ''),
              case when nullif(btrim(coalesce(v_r->>'later', '')), '') is null then null
                   else greatest(1, least(3, coalesce((v_r->>'later_stage')::int, 2))) end);
    end if;
  end loop;
  v_cast := public.court_cast(p_room_id);

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

  v_settings := jsonb_build_object('case_id', nullif(p_settings->>'case_id', ''), 'host_plays', v_host_plays, 'auto', v_auto,
    'question_seconds', v_q, 'closing_seconds', v_c, 'vote_seconds', v_v,
    'used_cases', (select coalesce(jsonb_agg(distinct x), '[]'::jsonb) from jsonb_array_elements_text(v_used || jsonb_build_array(v_case.id::text)) x));

  update public.room_game_state
     set active_question_id = null,
         state_data = jsonb_build_object(
           'game', 'court', 'phase', 'intro', 'step', 0, 'steps', v_steps, 'stage', 0, 'ends_at', null,
           'case', jsonb_build_object('id', v_case.id, 'title', v_case.title, 'category', v_case.category, 'intro', v_case.intro, 'difficulty', v_case.difficulty),
           'cast', v_cast, 'evidence', '[]'::jsonb, 'stand', null, 'objection', null, 'objections', '{}'::jsonb,
           'votes_count', 0, 'voters_count', 0, 'verdict', null, 'truth', null, 'points', null, 'cards', null,
           'fallbacks', jsonb_array_length(v_extra), 'settings', v_settings, 'last_settings', null)
   where room_id = p_room_id;
  return jsonb_build_object('ok', true, 'case', v_case.title);
end;
$$;
revoke all on function public.court_start(uuid, jsonb) from public, anon;
grant execute on function public.court_start(uuid, jsonb) to authenticated;

-- الطاقم المعلن (بلا أسرار)، بترتيب الأدوار.
create or replace function public.court_cast(p_room_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('player_id', r.player_id, 'player_name', p.player_name, 'kind', r.kind, 'name', r.name, 'brief', r.brief, 'role_key', r.role_key)
           order by case r.kind when 'accused' then 1 when 'prosecutor' then 2 when 'lawyer' then 3 when 'detective' then 4 when 'witness' then 5 else 6 end, r.role_key), '[]'::jsonb)
    from public.room_court_roles r join public.room_players p on p.id = r.player_id
   where r.room_id = p_room_id;
$$;
revoke all on function public.court_cast(uuid) from public, anon, authenticated;

-- الانتقال للمرحلة التالية، بلا تحقق من الصلاحية (تستدعيه الدوال الثلاث أدناه فقط).
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
  v_verdict boolean;
  v_points jsonb := '[]'::jsonb;
  v_row record;
  v_pts int;
  v_why text[];
  v_vote boolean;
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

  v_sd := v_sd || jsonb_build_object('step', v_step + 1, 'phase', v_phase, 'objection', null,
    'ends_at', case when v_secs > 0 then to_jsonb(now() + make_interval(secs => v_secs)) else 'null'::jsonb end,
    'side', v_next->'side');

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
    v_sd := v_sd || jsonb_build_object('verdict', jsonb_build_object('guilty', v_verdict, 'votes_guilty', v_g, 'votes_innocent', v_i));
  elsif v_phase = 'over' then
    v_verdict := coalesce((v_sd->'verdict'->>'guilty')::boolean, false);
    perform set_config('alosh.trusted', 'on', true);
    for v_row in
      select r.player_id, r.kind, r.name, p.player_name, v.guilty vote
        from public.room_court_roles r
        join public.room_players p on p.id = r.player_id
        left join public.room_court_votes v on v.room_id = r.room_id and v.player_id = r.player_id
       where r.room_id = p_room_id
    loop
      v_pts := 0;
      v_why := '{}';
      v_vote := v_row.vote;
      if v_row.kind <> 'accused' and v_vote is not null and v_vote = v_court.guilty then
        v_pts := v_pts + 100;
        v_why := array_append(v_why, 'صوت صحيح');
      end if;
      if v_row.kind = 'accused' and not v_verdict then
        v_pts := v_pts + 300;
        v_why := array_append(v_why, 'نجا من الإدانة');
      elsif v_row.kind in ('prosecutor', 'detective', 'witness') and v_verdict = v_court.guilty then
        v_pts := v_pts + 200;
        v_why := array_append(v_why, 'تحققت العدالة');
      elsif v_row.kind = 'lawyer' then
        if not v_verdict then
          v_pts := v_pts + 200;
          v_why := array_append(v_why, 'برّأ موكله');
        end if;
        if v_verdict = v_court.guilty then
          v_pts := v_pts + 100;
          v_why := array_append(v_why, 'الحكم صحيح');
        end if;
      end if;
      if v_pts > 0 then
        update public.room_players set score = score + v_pts where id = v_row.player_id;
      end if;
      v_points := v_points || jsonb_build_array(jsonb_build_object(
        'player_id', v_row.player_id, 'player_name', v_row.player_name, 'kind', v_row.kind, 'name', v_row.name,
        'vote', v_vote, 'points', v_pts, 'why', to_jsonb(v_why)));
    end loop;
    select coalesce(jsonb_agg(x order by (x->>'points')::int desc, x->>'player_name'), '[]'::jsonb) into v_points from jsonb_array_elements(v_points) x;
    v_sd := v_sd || jsonb_build_object(
      'truth', jsonb_build_object('guilty', v_court.guilty, 'text', v_court.truth, 'correct', v_verdict = v_court.guilty),
      'points', v_points,
      'cards', (select coalesce(jsonb_agg(jsonb_build_object('player_name', p.player_name, 'kind', r.kind, 'name', r.name, 'secret', r.secret, 'later', r.later)
                  order by case r.kind when 'accused' then 1 when 'prosecutor' then 2 when 'lawyer' then 3 when 'detective' then 4 when 'witness' then 5 else 6 end, r.role_key), '[]'::jsonb)
                  from public.room_court_roles r join public.room_players p on p.id = r.player_id
                 where r.room_id = p_room_id and r.kind <> 'juror'),
      'evidence', coalesce((select jsonb_agg(public.court_ev(e) order by o) from jsonb_array_elements(v_court.evidence) with ordinality t(e, o)), v_sd->'evidence'));
    insert into public.court_results (room_id, case_id, players, verdict, truth, votes_guilty, votes_innocent)
    values (p_room_id, v_court.case_id, (select count(*) from public.room_court_roles where room_id = p_room_id), v_verdict, v_court.guilty,
            coalesce((v_sd->'verdict'->>'votes_guilty')::int, 0), coalesce((v_sd->'verdict'->>'votes_innocent')::int, 0));
  end if;

  update public.room_game_state set state_data = v_sd where room_id = p_room_id;
  return jsonb_build_object('ok', true, 'phase', v_phase);
end;
$$;
revoke all on function public.court_advance(uuid, int) from public, anon, authenticated;

-- المضيف: المرحلة التالية.
create or replace function public.court_next(p_room_id uuid, p_step int default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.is_room_host(p_room_id) or public.is_app_admin()) then
    return jsonb_build_object('ok', false, 'reason', 'NOT_HOST');
  end if;
  return public.court_advance(p_room_id, p_step);
end;
$$;
revoke all on function public.court_next(uuid, int) from public, anon;
grant execute on function public.court_next(uuid, int) to authenticated;

-- أي جهاز في الغرفة (الشاشة أو اللاعبون) يطلب الانتقال حين ينتهي الوقت. لا ينجح إلا إذا كان
-- الانتقال التلقائي مفعّلًا وانتهى مؤقت المرحلة فعلًا، أو صوّت الجميع.
create or replace function public.court_tick(p_room_id uuid, p_step int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sd jsonb;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'reason', 'NO_SESSION');
  end if;
  select state_data into v_sd from public.room_game_state where room_id = p_room_id;
  if v_sd->>'game' is distinct from 'court' or coalesce((v_sd->>'step')::int, -1) <> p_step then
    return jsonb_build_object('ok', true, 'stale', true);
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
revoke all on function public.court_tick(uuid, int) from public, anon;
grant execute on function public.court_tick(uuid, int) to authenticated;

-- التصويت: إذا صوّت الجميع يُعلن الحكم مباشرة.
create or replace function public.court_vote(p_room_id uuid, p_guilty boolean)
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
begin
  if v_me is null or p_guilty is null then
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
  insert into public.room_court_votes (room_id, player_id, guilty) values (p_room_id, v_me, p_guilty)
  on conflict (room_id, player_id) do update set guilty = excluded.guilty, at = now();
  select count(*) into v_count from public.room_court_votes where room_id = p_room_id;
  update public.room_game_state set state_data = state_data || jsonb_build_object('votes_count', v_count) where room_id = p_room_id;
  if v_count >= coalesce((v_sd->>'voters_count')::int, 0) and coalesce((v_sd->>'voters_count')::int, 0) > 0 then
    perform public.court_advance(p_room_id, (v_sd->>'step')::int);
  end if;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.court_vote(uuid, boolean) from public, anon;
grant execute on function public.court_vote(uuid, boolean) to authenticated;

-- استبدال لاعب غادر: دوره ينتقل لـ p_to (دخل الغرفة بعد التوزيع، أو محلّف يترك مقعده).
-- p_from رقم اللاعب كما في قائمة الطاقم، حتى لو خرج من الغرفة وانحذف صفّه.
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
  v_case uuid;
  v_r public.room_court_roles%rowtype;
begin
  if not (public.is_room_host(p_room_id) or public.is_app_admin()) then
    return jsonb_build_object('ok', false, 'reason', 'NOT_HOST');
  end if;
  select state_data into v_sd from public.room_game_state where room_id = p_room_id for update;
  if v_sd->>'game' is distinct from 'court' or v_sd->>'phase' in ('verdict', 'over') then
    return jsonb_build_object('ok', false, 'reason', 'WRONG_PHASE');
  end if;
  if p_from = p_to or not exists (select 1 from public.room_players where id = p_to and room_id = p_room_id) then
    return jsonb_build_object('ok', false, 'reason', 'BAD_PLAYER');
  end if;
  select x into v_entry from jsonb_array_elements(v_sd->'cast') x where x->>'player_id' = p_from::text;
  if v_entry is null then
    return jsonb_build_object('ok', false, 'reason', 'NOT_IN_CASE');
  end if;
  select kind into v_to_kind from public.room_court_roles where room_id = p_room_id and player_id = p_to;
  if v_to_kind is not null and v_to_kind <> 'juror' then
    return jsonb_build_object('ok', false, 'reason', 'HAS_ROLE');
  end if;

  select * into v_r from public.room_court_roles where room_id = p_room_id and player_id = p_from;
  if found then
    delete from public.room_court_roles where room_id = p_room_id and player_id = p_to;
    update public.room_court_roles set player_id = p_to where room_id = p_room_id and player_id = p_from;
  else
    -- صفّه انحذف مع خروجه من الغرفة: يُعاد بناء الدور من القضية.
    delete from public.room_court_roles where room_id = p_room_id and player_id = p_to;
    if v_entry->>'kind' = 'juror' then
      insert into public.room_court_roles (room_id, player_id, role_key, kind, name, brief, secret)
      values (p_room_id, p_to, v_entry->>'role_key', 'juror', 'محلّف', 'عضو في هيئة المحلفين.',
              'لا تعرف عن القضية إلا ما يُعرض في الجلسة. اسأل المتهم والشهود، وانتبه للتناقض بين الأقوال والأدلة، ثم صوّت بالعدل. كل صوت يطابق الحقيقة = 100 نقطة.');
    else
      select case_id into v_case from public.room_court where room_id = p_room_id;
      select x into v_role from public.court_cases c, jsonb_array_elements(c.roles) x where c.id = v_case and x->>'key' = v_entry->>'role_key';
      if v_role is null then
        return jsonb_build_object('ok', false, 'reason', 'NO_ROLE');
      end if;
      insert into public.room_court_roles (room_id, player_id, role_key, kind, name, brief, secret, later, later_stage)
      values (p_room_id, p_to, v_role->>'key', v_role->>'kind', btrim(v_role->>'name'),
              nullif(btrim(coalesce(v_role->>'brief', '')), ''), btrim(v_role->>'secret'),
              nullif(btrim(coalesce(v_role->>'later', '')), ''),
              case when nullif(btrim(coalesce(v_role->>'later', '')), '') is null then null
                   else greatest(1, least(3, coalesce((v_role->>'later_stage')::int, 2))) end);
    end if;
  end if;
  delete from public.room_court_votes where room_id = p_room_id and player_id in (p_from, p_to);
  update public.room_game_state
     set state_data = state_data || jsonb_build_object(
       'cast', public.court_cast(p_room_id),
       'stand', case when state_data->>'stand' = p_from::text then to_jsonb(p_to) else state_data->'stand' end,
       'votes_count', (select count(*) from public.room_court_votes where room_id = p_room_id),
       'voters_count', (select count(*) from public.room_court_roles where room_id = p_room_id and kind <> 'accused'))
   where room_id = p_room_id;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.court_replace(uuid, uuid, uuid) from public, anon;
grant execute on function public.court_replace(uuid, uuid, uuid) to authenticated;

-- إحصائية القضايا للوحة الإدارة.
create or replace function public.court_case_stats()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when not public.is_app_admin() then '[]'::jsonb else coalesce((
    select jsonb_agg(jsonb_build_object('case_id', case_id, 'plays', plays, 'correct', correct, 'convicted', convicted, 'last', last))
      from (select case_id, count(*) plays, count(*) filter (where verdict = truth) correct, count(*) filter (where verdict) convicted, max(at) last
              from public.court_results where case_id is not null group by case_id) s), '[]'::jsonb) end;
$$;
revoke all on function public.court_case_stats() from public, anon;
grant execute on function public.court_case_stats() to authenticated;

revoke all on function public.court_ev(jsonb) from public, anon;

notify pgrst, 'reload schema';
