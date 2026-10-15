-- =============================================================================
-- «المحكمة»، الإصدار 6: أدوات المضيف. يُشغَّل بعد court_v5.sql، وتشغيله مرة ثانية آمن.
--
-- 1) المؤقت: إيقاف واستئناف، وإضافة 30 ثانية (court_timer). أثناء الإيقاف لا يتحرك دور السؤال ولا المنصة.
-- 2) أكثر من 12 لاعبًا: الزيادة فوق أدوار القضية تدخل محلّفين (حتى 20 في التوزيع، و24 مع من يدخل متأخرًا).
-- 3) توزيع عادل في السهرة: من أخذ دور المتهم أو المدعي أو المحامي أقل يُقدَّم لهذه الأدوار.
-- 4) إعدادات متقدمة: عدد الاعتراضات، وقت دور السؤال، وقت قراءة الأدلة، ومن له السؤال الذهبي.
-- 5) قائمة القضايا تعرض عدد المتهمين وأنواع الأدوار (لمعاينة التوزيع).
-- =============================================================================

do $$
begin
  if to_regclass('public.court_cases') is null
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'room_court_votes' and column_name = 'verdicts') then
    raise exception 'شغّل ملفات المحكمة حتى court_v5.sql أولًا، ثم court_v6.sql.';
  end if;
end $$;

-- البداية: أكثر من 12 لاعبًا، وتوزيع عادل، وإعدادات متقدمة.
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
  v_objections int := coalesce((p_settings->>'objections')::int, 2);
  v_turn int := coalesce((p_settings->>'turn_seconds')::int, 45);
  v_read int := coalesce((p_settings->>'read_seconds')::int, 30);
  v_golden text := coalesce(nullif(p_settings->>'golden', ''), 'jurors');
  v_hist jsonb;
  v_sorted uuid[];
  v_deal uuid[];
  v_main_n int;
  v_a int := 1;
  v_b int;
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
  if v_objections not in (0, 1, 2, 3) then v_objections := 2; end if;
  if v_turn not in (30, 45, 60, 90) then v_turn := 45; end if;
  if v_read not in (15, 30, 45, 60) then v_read := 30; end if;
  if v_golden not in ('jurors', 'all', 'off') then v_golden := 'jurors'; end if;

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
  if v_n > 20 then
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
  -- توزيع عادل: الأقل أخذًا لدور المتهم أو المدعي أو المحامي في هذه السهرة يأخذها أولًا.
  v_hist := case when coalesce((p_settings->>'new_evening')::boolean, false) then '{}'::jsonb
                 else coalesce(v_sd->'last_settings'->'main_roles', '{}'::jsonb) end;
  select array_agg(p order by coalesce((v_hist->>p::text)::int, 0), random()) into v_sorted from unnest(v_players) p;
  select count(*) into v_main_n from jsonb_array_elements(v_roles) x where x->>'kind' in ('accused', 'prosecutor', 'lawyer');
  v_b := v_main_n + 1;
  v_deal := '{}'::uuid[];
  for i in 1..v_n loop
    if i <= jsonb_array_length(v_roles) and (v_roles->(i - 1))->>'kind' in ('accused', 'prosecutor', 'lawyer') then
      v_deal := array_append(v_deal, v_sorted[v_a]);
      v_a := v_a + 1;
    else
      v_deal := array_append(v_deal, v_sorted[v_b]);
      v_b := v_b + 1;
    end if;
  end loop;
  v_players := v_deal;
  for i in 1..least(v_n, jsonb_array_length(v_roles)) loop
    if (v_roles->(i - 1))->>'kind' in ('accused', 'prosecutor', 'lawyer') then
      v_hist := v_hist || jsonb_build_object(v_players[i]::text, coalesce((v_hist->>v_players[i]::text)::int, 0) + 1);
    end if;
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
  v_golden_kinds := case v_golden when 'off' then '[]'::jsonb when 'all' then '["juror","witness","detective"]'::jsonb else '["juror"]'::jsonb end;
  if v_jurors = 0 and v_golden <> 'off' then
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
      || jsonb_build_array(jsonb_build_object('phase', 'evidence', 'stage', v_stage, 'seconds', case when v_auto then v_read else 0 end))
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
    'objections', v_objections, 'turn_seconds', v_turn, 'read_seconds', v_read, 'golden', v_golden, 'main_roles', v_hist,
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
           'fallbacks', jsonb_array_length(v_extra), 'settings', v_settings, 'last_settings', null, 'paused', null)
   where room_id = p_room_id;
  return jsonb_build_object('ok', true, 'case', v_case.title, 'variant', v_variant_key, 'custom', v_custom);
end;
$$;
revoke all on function public.court_start(uuid, jsonb) from public, anon;
grant execute on function public.court_start(uuid, jsonb) to authenticated;

-- دور السؤال بالمدة المختارة، ولا يتحرك أثناء الإيقاف.
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
     and coalesce(v_sd->'paused'->>'step', '') <> p_step::text
     and (v_sd->>'asking_since')::timestamptz <= now() - make_interval(secs => coalesce((v_sd->'settings'->>'turn_seconds')::int, 45) - 1) then
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
revoke all on function public.court_tick(uuid, int) from public, anon;
grant execute on function public.court_tick(uuid, int) to authenticated;

-- الاعتراض: العدد من الإعدادات.
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
  if v_used >= coalesce((v_sd->'settings'->>'objections')::int, 2) then
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
  return jsonb_build_object('ok', true, 'left', coalesce((v_sd->'settings'->>'objections')::int, 2) - 1 - v_used);
end;
$$;
revoke all on function public.court_object(uuid) from public, anon;
grant execute on function public.court_object(uuid) to authenticated;

-- البطاقة: الاعتراضات الباقية من الإعدادات.
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
    'objections_left', case when v_r.kind in ('prosecutor', 'lawyer') then coalesce((v_sd->'settings'->>'objections')::int, 2) - coalesce((v_sd->'objections'->>v_me::text)::int, 0) else 0 end);
end;
$$;
revoke all on function public.court_my_card(uuid) from public, anon;
grant execute on function public.court_my_card(uuid) to authenticated;

-- من يدخل متأخرًا: حتى 24 في الجلسة.
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
  if (select count(*) from public.room_court_roles where room_id = p_room_id) >= 24 then
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

-- قائمة القضايا: عدد المتهمين وأنواع الأدوار بالترتيب.
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
           'versions', 1 + coalesce(jsonb_array_length(c.variants), 0),
           'accused', (select count(*) from jsonb_array_elements(c.roles) r where r->>'kind' = 'accused'),
           'parts', (select coalesce(jsonb_agg(jsonb_build_object('k', r->>'kind', 'o', coalesce((r->>'optional')::boolean, false)) order by o), '[]'::jsonb)
                       from jsonb_array_elements(c.roles) with ordinality t(r, o)))
         order by c.difficulty, c.title), '[]'::jsonb)
    from public.court_cases c
   where c.is_active;
$$;
revoke all on function public.court_cases_list() from public, anon;
grant execute on function public.court_cases_list() to authenticated;

-- المؤقت: إيقاف، استئناف، +30 ثانية. للقاضي (المضيف أو القاضي بالقرعة).
create or replace function public.court_timer(p_room_id uuid, p_step int, p_action text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sd jsonb;
  v_paused boolean;
  v_left int;
  v_gap interval;
begin
  if not public.court_can_run(p_room_id) then
    return jsonb_build_object('ok', false, 'reason', 'NOT_HOST');
  end if;
  if p_action not in ('pause', 'resume', 'add') then
    return jsonb_build_object('ok', false, 'reason', 'WRONG_PHASE');
  end if;
  select state_data into v_sd from public.room_game_state where room_id = p_room_id for update;
  if v_sd->>'game' is distinct from 'court' or coalesce((v_sd->>'step')::int, -1) <> p_step
     or v_sd->>'phase' in ('intro', 'verdict', 'over') then
    return jsonb_build_object('ok', false, 'reason', 'WRONG_PHASE');
  end if;
  v_paused := coalesce(v_sd->'paused'->>'step', '') = p_step::text;

  if p_action = 'pause' then
    if v_paused then
      return jsonb_build_object('ok', true);
    end if;
    if nullif(v_sd->>'ends_at', '') is null and nullif(v_sd->>'asking', '') is null then
      return jsonb_build_object('ok', false, 'reason', 'NO_TIMER');
    end if;
    v_left := case when nullif(v_sd->>'ends_at', '') is null then null
                   else greatest(0, ceil(extract(epoch from ((v_sd->>'ends_at')::timestamptz - now())))::int) end;
    v_sd := v_sd || jsonb_build_object('ends_at', null, 'paused', jsonb_build_object('step', p_step, 'left', v_left, 'at', now()));
  elsif p_action = 'resume' then
    if not v_paused then
      return jsonb_build_object('ok', true);
    end if;
    v_gap := now() - (v_sd->'paused'->>'at')::timestamptz;
    v_sd := v_sd || jsonb_build_object(
      'ends_at', case when v_sd->'paused'->>'left' is null then null else to_jsonb(now() + make_interval(secs => (v_sd->'paused'->>'left')::int)) end,
      'asking_since', case when nullif(v_sd->>'asking_since', '') is null then null else to_jsonb((v_sd->>'asking_since')::timestamptz + v_gap) end,
      'paused', null);
  else
    if v_paused and v_sd->'paused'->>'left' is not null then
      v_sd := v_sd || jsonb_build_object('paused', (v_sd->'paused') || jsonb_build_object('left', (v_sd->'paused'->>'left')::int + 30));
    elsif nullif(v_sd->>'ends_at', '') is not null then
      v_sd := v_sd || jsonb_build_object('ends_at', (v_sd->>'ends_at')::timestamptz + interval '30 seconds');
    else
      return jsonb_build_object('ok', false, 'reason', 'NO_TIMER');
    end if;
  end if;
  update public.room_game_state set state_data = v_sd where room_id = p_room_id;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.court_timer(uuid, int, text) from public, anon;
grant execute on function public.court_timer(uuid, int, text) to authenticated;

notify pgrst, 'reload schema';
