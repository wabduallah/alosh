-- =============================================================================
-- «المحكمة»، الإصدار 3. يُشغَّل بعد court_v2.sql، وتشغيله مرة ثانية آمن.
--
-- 1) دور في الأسئلة: «أبي أسأل» يضع اللاعب في قائمة انتظار، والمضيف يعطي الدور.
--    ولكل محلّف «سؤال ذهبي» مرة واحدة: يستدعي من يريد للمنصة ويجب أن يجيب.
-- 2) أدوار لها مصلحة: لكل دور طريقة فوز (roles[].win: truth | convict | acquit) وهدف سري
--    (roles[].goal). المضيف يمنح 100 نقطة لكل هدف تحقق بعد كشف الحقيقة.
-- 3) «من الفاعل الحقيقي؟»: قائمة مشتبهين (suspects) والفاعل (culprit) في القضية. سؤال ثانٍ
--    في التصويت، ومن يعرفه يكسب 150.
-- 4) المدعي يكسب 200 إذا أُدين المتهم، والمحامي 200 إذا بُرّئ، ولكل منهما 100 إذا كان الحكم صحيحًا.
-- 5) بطاقة لكل محلّف: معلومة أو شك يُسحب عشوائيًا من juror_clues في القضية.
-- 6) الاعتراض: المضيف يقبله أو يرفضه. المقبول يُلغي السؤال ويعطي صاحبه 50 نقطة.
-- =============================================================================

-- الأعمدة ------------------------------------------------------------------------

alter table public.court_cases add column if not exists suspects jsonb;
alter table public.court_cases add column if not exists culprit text;
alter table public.court_cases add column if not exists juror_clues jsonb not null default '[]'::jsonb;
comment on column public.court_cases.suspects is '[{key, name}] قائمة «من الفاعل الحقيقي؟» (اختيارية).';
comment on column public.court_cases.culprit is 'مفتاح الفاعل الحقيقي من suspects.';
comment on column public.court_cases.juror_clues is '["معلومة أو شك", …] تُوزَّع على المحلّفين عشوائيًا.';

alter table public.room_court add column if not exists suspects jsonb;
alter table public.room_court add column if not exists culprit text;
alter table public.room_court_roles add column if not exists clue text;
alter table public.room_court_roles add column if not exists win text;
alter table public.room_court_roles add column if not exists goal text;
alter table public.room_court_votes add column if not exists culprit text;

-- التحقق من القضية: ما سبق، ومعه طريقة الفوز والمشتبهون والمعلومات.
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
    if nullif(r->>'win', '') is not null and (r->>'win') not in ('truth', 'convict', 'acquit') then
      raise exception 'BAD_CASE: طريقة فوز غير معروفة لدور «%».', r->>'name';
    end if;
    v_keys := array_append(v_keys, r->>'key');
    v_count := jsonb_set(v_count, array[v_kind], to_jsonb(coalesce((v_count->>v_kind)::int, 0) + 1));
    if v_kind in ('accused', 'prosecutor', 'lawyer') and coalesce((r->>'optional')::boolean, false) then
      raise exception 'BAD_CASE: المتهم والمدعي والمحامي أدوار أساسية.';
    end if;
  end loop;
  if coalesce((v_count->>'accused')::int, 0) <> 1 or coalesce((v_count->>'prosecutor')::int, 0) <> 1 or coalesce((v_count->>'lawyer')::int, 0) <> 1 then
    raise exception 'BAD_CASE: القضية تحتاج متهمًا واحدًا ومدعيًا واحدًا ومحاميًا واحدًا.';
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

-- طريقة فوز الدور: المكتوبة في القضية، أو الافتراضية لنوعه.
create or replace function public.court_win_of(p_kind text, p_win text)
returns text
language sql
immutable
as $$
  select case
    when p_kind = 'accused' then 'acquit'
    when p_kind = 'juror' then null
    when nullif(p_win, '') is not null then p_win
    when p_kind = 'prosecutor' then 'convict'
    when p_kind = 'lawyer' then 'acquit'
    else 'truth' end;
$$;

-- البداية ---------------------------------------------------------------------

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
  v_clues text[];
  v_clue_i int := 1;
  v_r jsonb;
  v_optional_slots int;
  v_steps jsonb := '[]'::jsonb;
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
  select array_agg(btrim(c) order by random()) into v_clues
    from jsonb_array_elements_text(coalesce(v_case.juror_clues, '[]'::jsonb)) c where btrim(c) <> '';

  delete from public.room_court where room_id = p_room_id;
  delete from public.room_court_roles where room_id = p_room_id;
  delete from public.room_court_votes where room_id = p_room_id;
  insert into public.room_court (room_id, case_id, guilty, truth, evidence, suspects, culprit)
  values (p_room_id, v_case.id, v_case.guilty, v_case.truth, v_evidence, v_case.suspects, v_case.culprit);

  for i in 1..v_n loop
    v_r := v_roles->(i - 1);
    if v_r is null then
      insert into public.room_court_roles (room_id, player_id, role_key, kind, name, brief, secret, clue)
      values (p_room_id, v_players[i], 'juror-' || i, 'juror', 'محلّف', 'عضو في هيئة المحلفين.',
              'لا تعرف عن القضية إلا ما يُعرض في الجلسة. اسأل المتهم والشهود، وانتبه للتناقض بين الأقوال والأدلة، ثم صوّت بالعدل. كل صوت يطابق الحقيقة = 100 نقطة. ولك سؤال ذهبي واحد: تستدعي به من تشاء للمنصة.',
              v_clues[v_clue_i]);
      v_clue_i := v_clue_i + 1;
    else
      insert into public.room_court_roles (room_id, player_id, role_key, kind, name, brief, secret, later, later_stage, win, goal)
      values (p_room_id, v_players[i], v_r->>'key', v_r->>'kind', btrim(v_r->>'name'),
              nullif(btrim(coalesce(v_r->>'brief', '')), ''), btrim(v_r->>'secret'),
              nullif(btrim(coalesce(v_r->>'later', '')), ''),
              case when nullif(btrim(coalesce(v_r->>'later', '')), '') is null then null
                   else greatest(1, least(3, coalesce((v_r->>'later_stage')::int, 2))) end,
              public.court_win_of(v_r->>'kind', v_r->>'win'),
              nullif(btrim(coalesce(v_r->>'goal', '')), ''));
    end if;
  end loop;

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
           'cast', public.court_cast(p_room_id), 'evidence', '[]'::jsonb, 'stand', null,
           'objection', null, 'objections', '{}'::jsonb, 'objection_points', '{}'::jsonb,
           'queue', '[]'::jsonb, 'asking', null, 'golden', null, 'golden_used', '{}'::jsonb,
           'suspects', (select jsonb_agg(jsonb_build_object('key', s->>'key', 'name', btrim(s->>'name'))) from jsonb_array_elements(v_case.suspects) s),
           'votes_count', 0, 'voters_count', 0, 'verdict', null, 'truth', null, 'points', null, 'cards', null,
           'goals', null, 'goals_awarded', '{}'::jsonb,
           'fallbacks', jsonb_array_length(v_extra), 'settings', v_settings, 'last_settings', null)
   where room_id = p_room_id;
  return jsonb_build_object('ok', true, 'case', v_case.title);
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
  v_verdict boolean;
  v_points jsonb := '[]'::jsonb;
  v_row record;
  v_pts int;
  v_why text[];
  v_win text;
  v_obj int;
  v_has_suspects boolean;
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
    'side', v_next->'side', 'queue', '[]'::jsonb, 'asking', null, 'golden', null);

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
        'vote', v_row.vote, 'pick', v_row.pick, 'points', v_pts, 'why', to_jsonb(v_why)));
    end loop;
    select coalesce(jsonb_agg(x order by (x->>'points')::int desc, x->>'player_name'), '[]'::jsonb) into v_points from jsonb_array_elements(v_points) x;
    v_sd := v_sd || jsonb_build_object(
      'truth', jsonb_build_object('guilty', v_court.guilty, 'text', v_court.truth, 'correct', v_verdict = v_court.guilty,
        'culprit', (select s->>'name' from jsonb_array_elements(v_court.suspects) s where s->>'key' = v_court.culprit),
        'culprit_key', v_court.culprit),
      'points', v_points,
      'cards', (select coalesce(jsonb_agg(jsonb_build_object('player_name', p.player_name, 'kind', r.kind, 'name', r.name, 'secret', r.secret, 'later', r.later,
                    'goal', r.goal, 'win', public.court_win_of(r.kind, r.win), 'clue', r.clue)
                  order by case r.kind when 'accused' then 1 when 'prosecutor' then 2 when 'lawyer' then 3 when 'detective' then 4 when 'witness' then 5 else 6 end, r.role_key), '[]'::jsonb)
                  from public.room_court_roles r join public.room_players p on p.id = r.player_id
                 where r.room_id = p_room_id and (r.kind <> 'juror' or r.clue is not null)),
      'goals', (select coalesce(jsonb_agg(jsonb_build_object('player_id', r.player_id, 'player_name', p.player_name, 'name', r.name, 'goal', r.goal) order by r.role_key), '[]'::jsonb)
                  from public.room_court_roles r join public.room_players p on p.id = r.player_id
                 where r.room_id = p_room_id and r.goal is not null),
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

-- التصويت: الحكم، و«من الفاعل؟» إن كان في القضية مشتبهون. يكتمل صوت اللاعب بالسؤالين،
-- والتصويت يُغلق وحده حين يكتمل صوت الجميع.
alter table public.room_court_votes alter column guilty drop not null;
drop function if exists public.court_vote(uuid, boolean);
create or replace function public.court_vote(p_room_id uuid, p_guilty boolean default null, p_culprit text default null)
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
  if v_me is null or (p_guilty is null and p_culprit is null) then
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
  v_has_suspects := jsonb_typeof(v_sd->'suspects') = 'array' and jsonb_array_length(v_sd->'suspects') > 0;
  if p_culprit is not null and not (v_has_suspects and exists (select 1 from jsonb_array_elements(v_sd->'suspects') s where s->>'key' = p_culprit)) then
    return jsonb_build_object('ok', false, 'reason', 'BAD_SUSPECT');
  end if;
  insert into public.room_court_votes (room_id, player_id, guilty, culprit) values (p_room_id, v_me, p_guilty, p_culprit)
  on conflict (room_id, player_id) do update
    set guilty = coalesce(excluded.guilty, room_court_votes.guilty),
        culprit = coalesce(excluded.culprit, room_court_votes.culprit),
        at = now();
  select count(*) into v_count from public.room_court_votes v
   where v.room_id = p_room_id and v.guilty is not null and (not v_has_suspects or v.culprit is not null);
  update public.room_game_state set state_data = state_data || jsonb_build_object('votes_count', v_count) where room_id = p_room_id;
  if v_count >= coalesce((v_sd->>'voters_count')::int, 0) and coalesce((v_sd->>'voters_count')::int, 0) > 0 then
    perform public.court_advance(p_room_id, (v_sd->>'step')::int);
  end if;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.court_vote(uuid, boolean, text) from public, anon;
grant execute on function public.court_vote(uuid, boolean, text) to authenticated;

-- «أبي أسأل»: يدخل اللاعب قائمة الانتظار أو يخرج منها.
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
  if p_on and coalesce(v_sd->>'asking', '') <> v_me::text then
    v_queue := v_queue || jsonb_build_array(jsonb_build_object('player_id', v_me, 'name', v_name, 'at', now()));
  end if;
  update public.room_game_state set state_data = state_data || jsonb_build_object('queue', v_queue) where room_id = p_room_id;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.court_raise(uuid, boolean) from public, anon;
grant execute on function public.court_raise(uuid, boolean) to authenticated;

-- المضيف يعطي دور السؤال لمن في القائمة (أو يرفعه منها بـ p_drop)، أو يُنهي الدور بـ null.
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
  if not (public.is_room_host(p_room_id) or public.is_app_admin()) then
    return jsonb_build_object('ok', false, 'reason', 'NOT_HOST');
  end if;
  select state_data into v_sd from public.room_game_state where room_id = p_room_id for update;
  if v_sd->>'phase' <> 'question' then
    return jsonb_build_object('ok', false, 'reason', 'WRONG_PHASE');
  end if;
  select coalesce(jsonb_agg(q), '[]'::jsonb) into v_queue from jsonb_array_elements(coalesce(v_sd->'queue', '[]'::jsonb)) q
   where p_player_id is null or q->>'player_id' <> p_player_id::text;
  update public.room_game_state
     set state_data = state_data || jsonb_build_object('queue', v_queue,
           'asking', case when p_drop then state_data->'asking' else to_jsonb(p_player_id) end,
           'golden', case when p_drop then state_data->'golden' else null end)
   where room_id = p_room_id;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.court_call(uuid, uuid, boolean) from public, anon;
grant execute on function public.court_call(uuid, uuid, boolean) to authenticated;

-- السؤال الذهبي: للمحلّف مرة في المباراة. يستدعي شخصًا للمنصة ويأخذ دور السؤال فورًا.
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
  if v_kind is distinct from 'juror' then
    return jsonb_build_object('ok', false, 'reason', 'JURORS_ONLY');
  end if;
  select state_data into v_sd from public.room_game_state where room_id = p_room_id for update;
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
       'stand', to_jsonb(p_target), 'asking', to_jsonb(v_me),
       'queue', (select coalesce(jsonb_agg(q), '[]'::jsonb) from jsonb_array_elements(coalesce(state_data->'queue', '[]'::jsonb)) q where q->>'player_id' <> v_me::text))
   where room_id = p_room_id;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.court_golden(uuid, uuid) from public, anon;
grant execute on function public.court_golden(uuid, uuid) to authenticated;

-- الاعتراض: ينتظر حكم المضيف.
create or replace function public.court_object(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := public.my_player_id(p_room_id);
  v_kind text;
  v_name text;
  v_sd jsonb;
  v_used int;
begin
  select r.kind, p.player_name into v_kind, v_name
    from public.room_court_roles r join public.room_players p on p.id = r.player_id
   where r.room_id = p_room_id and r.player_id = v_me;
  if v_kind is null or v_kind not in ('prosecutor', 'lawyer') then
    return jsonb_build_object('ok', false, 'reason', 'NOT_ALLOWED');
  end if;
  select state_data into v_sd from public.room_game_state where room_id = p_room_id for update;
  if v_sd->>'phase' not in ('question', 'closing') then
    return jsonb_build_object('ok', false, 'reason', 'WRONG_PHASE');
  end if;
  v_used := coalesce((v_sd->'objections'->>v_me::text)::int, 0);
  if v_used >= 2 then
    return jsonb_build_object('ok', false, 'reason', 'NO_OBJECTIONS');
  end if;
  if jsonb_typeof(v_sd->'objection') = 'object' and v_sd->'objection'->>'status' = 'pending' then
    return jsonb_build_object('ok', false, 'reason', 'BUSY');
  end if;
  update public.room_game_state
     set state_data = state_data || jsonb_build_object(
       'objection', jsonb_build_object('by', v_me, 'kind', v_kind, 'name', v_name, 'at', now(), 'n', v_used + 1, 'status', 'pending'),
       'objections', coalesce(state_data->'objections', '{}'::jsonb) || jsonb_build_object(v_me::text, v_used + 1))
   where room_id = p_room_id;
  return jsonb_build_object('ok', true, 'left', 1 - v_used);
end;
$$;
revoke all on function public.court_object(uuid) from public, anon;
grant execute on function public.court_object(uuid) to authenticated;

-- المضيف يحكم: «مقبول» يُلغي السؤال ويعطي صاحبه 50 نقطة في النهاية، و«مرفوض» يكمل الكلام.
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
  if not (public.is_room_host(p_room_id) or public.is_app_admin()) then
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
revoke all on function public.court_rule(uuid, boolean) from public, anon;
grant execute on function public.court_rule(uuid, boolean) to authenticated;

-- بعد كشف الحقيقة: المضيف يمنح (أو يسحب) 100 نقطة لمن حقق هدفه السري.
create or replace function public.court_goal(p_room_id uuid, p_player_id uuid, p_on boolean)
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
  if not (public.is_room_host(p_room_id) or public.is_app_admin()) then
    return jsonb_build_object('ok', false, 'reason', 'NOT_HOST');
  end if;
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
           from jsonb_array_elements(state_data->'points') x) y))
   where room_id = p_room_id;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.court_goal(uuid, uuid, boolean) from public, anon;
grant execute on function public.court_goal(uuid, uuid, boolean) to authenticated;

-- بطاقتي: مع طريقة الفوز والهدف السري ومعلومة المحلّف، وحالة الأسئلة.
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
  select * into v_r from public.room_court_roles where room_id = p_room_id and player_id = v_me;
  if not found then
    return jsonb_build_object('started', false, 'late', coalesce(v_sd->>'phase', '') <> '');
  end if;
  v_stage := coalesce((v_sd->>'stage')::int, 0);
  select * into v_v from public.room_court_votes where room_id = p_room_id and player_id = v_me;
  return jsonb_build_object(
    'started', true, 'player_id', v_me, 'kind', v_r.kind, 'kind_ar', public.court_kind_ar(v_r.kind), 'name', v_r.name, 'brief', v_r.brief,
    'secret', v_r.secret, 'clue', v_r.clue, 'goal', v_r.goal, 'win', public.court_win_of(v_r.kind, v_r.win),
    'later', case when v_r.later is not null and v_stage >= v_r.later_stage then v_r.later else null end,
    'later_pending', v_r.later is not null and v_stage < v_r.later_stage,
    'vote', case when v_v.player_id is null then null else v_v.guilty end,
    'pick', v_v.culprit,
    'golden_left', v_r.kind = 'juror' and not coalesce((v_sd->'golden_used'->>v_me::text)::boolean, false),
    'objections_left', case when v_r.kind in ('prosecutor', 'lawyer') then 2 - coalesce((v_sd->'objections'->>v_me::text)::int, 0) else 0 end);
end;
$$;
revoke all on function public.court_my_card(uuid) from public, anon;
grant execute on function public.court_my_card(uuid) to authenticated;

revoke all on function public.court_win_of(text, text) from public, anon;

notify pgrst, 'reload schema';
