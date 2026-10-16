-- =============================================================================
-- «تحديات العش»، الإصدار 3. يُشغَّل بعد site_v1.sql، وتشغيله مرة ثانية آمن.
--
-- 1) من 2 إلى 6 فرق بأسماء افتراضية (عش النسور، عش الصقور…) يقدر المضيف يغيّرها.
--    فئات كل فريق حسب عدد الفرق: فريقان 3 لكل فريق، 3 أو 4 فرق فئتان، 5 أو 6 فرق فئة واحدة (8 فئات حدًّا أعلى).
-- 2) لا أحد يرى الإجابة قبل الحسم، ولا المضيف. الفريق صاحب الدور يصوّت من جوالاته:
--      - سؤال عادي: 6 خيارات، الصحيح في مكان عشوائي.
--      - سؤال صح أو خطأ: خياران.
--    يُعتمد الخيار الأكثر أصواتًا (وعند التعادل: الذي صُوّت له أولًا). يُحسم حين يصوّت كل
--    أعضاء الفريق، أو عند انتهاء الوقت.
-- 3) السرقة: لكل فريق سرقة واحدة في اللعبة كلها. إذا أخطأ الفريق ينتقل السؤال للفريق التالي الذي
--    ما زالت سرقته معه، ويُشطب الخيار الخطأ. التصويت يستهلك السرقة، و«تخطَّ» أو انتهاء الوقت بلا
--    تصويت يُبقيها. أسئلة صح أو خطأ بلا سرقة (الخطأ يكشف الجواب).
-- 4) المضيف يقدر يلعب مع الفرق ويصوّت مثل أي لاعب.
--
-- الخيارات الخاطئة: من fake_answers ثم options للسؤال إن وُجدت، وإلا من إجابات أسئلة
-- مشابهة في الفئة نفسها (عاصمة مع عواصم، رقم مع أرقام، إكمال مع إكمالات).
-- =============================================================================

do $$
begin
  if to_regprocedure('public.grid_categories()') is null or to_regprocedure('public.test_guest_act(uuid,uuid)') is null then
    raise exception 'شغّل الملفات حتى site_v1.sql أولًا، ثم grid_v2.sql.';
  end if;
end $$;

-- الطريقة القديمة (المضيف يرى الإجابة ويحكم) تنتهي هنا.
drop function if exists public.grid_judge(uuid, boolean);
drop function if exists public.grid_start(uuid, text[], int, jsonb);

-- صح أو خطأ؟ الشكل الموحد للإجابة، أو null إن لم تكن منهما.
create or replace function public.grid_tf(p text)
returns text
language sql
immutable
set search_path = public
as $$
  select case when public.name_norm(p) in ('صح', 'صحيح', 'نعم') then 'صح'
              when public.name_norm(p) in ('خطا', 'غلط', 'خاطي', 'لا') then 'خطأ' end;
$$;

-- نص الخيار: الإجابة بلا ما بين القوسين («1932 (1351هـ)» ← «1932»)، حتى لا يميّز الشرحُ الإجابةَ الصحيحة.
-- الإجابة كاملة تظهر عند الكشف.
create or replace function public.grid_label(p text)
returns text
language sql
immutable
set search_path = public
as $$
  select coalesce(nullif(btrim(regexp_replace(regexp_replace(coalesce(p, ''), '\s*\([^)]*\)', '', 'g'), '\s+', ' ', 'g')), ''), btrim(coalesce(p, '')));
$$;

-- رقم في أول الإجابة (بالأرقام العربية أو الهندية)، وما بعده: «90 دقيقة» ← 90 و« دقيقة».
create or replace function public.grid_num(p text)
returns numeric
language sql
immutable
set search_path = public
as $$
  select (substring(translate(public.grid_label(p), '٠١٢٣٤٥٦٧٨٩', '0123456789') from '^([0-9]{1,9})(?:[^0-9.]|$)'))::numeric;
$$;
create or replace function public.grid_num_rest(p text)
returns text
language sql
immutable
set search_path = public
as $$
  select coalesce(substring(translate(public.grid_label(p), '٠١٢٣٤٥٦٧٨٩', '0123456789') from '^[0-9]{1,9}(.*)$'), '');
$$;

-- نوع السؤال من أول كلماته: «ما عاصمة»، «ما صوت»، «لغز»، «أكمل»، «من»… لاختيار خيارات من النوع نفسه.
create or replace function public.grid_stem(p text)
returns text
language sql
immutable
set search_path = public
as $$
  select case when split_part(public.name_norm(p), ' ', 1) in ('لغز', 'اكمل', 'من') then split_part(public.name_norm(p), ' ', 1)
              else split_part(public.name_norm(p), ' ', 1) || ' ' || split_part(public.name_norm(p), ' ', 2) end;
$$;

-- خيارات السؤال: {"kind": "tf"|"mc", "options": [...]}. الصحيح في مكان عشوائي.
-- الأولوية: fake_answers، ثم options، ثم إجابات أسئلة من النوع نفسه في الفئة (عاصمة مع عواصم)، ثم أرقام
-- قريبة بنفس الوحدة، ثم النوع نفسه في بقية الفئات، ثم بقية الفئة، ثم بقية اللعبة.
create or replace function public.grid_choices(p_qid uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  q record;
  v_label text;
  v_num numeric;
  v_rest text;
  v_stem text;
  v_out text[] := '{}';
  v_seen text[];
  v_c text;
  v_n text;
  d numeric;
begin
  select * into q from public.questions_bank where id = p_qid;
  if not found then
    return null;
  end if;
  if public.grid_tf(q.correct_answer) is not null then
    return jsonb_build_object('kind', 'tf', 'options', jsonb_build_array('صح', 'خطأ'));
  end if;

  v_label := public.grid_label(q.correct_answer);
  v_num := public.grid_num(q.correct_answer);
  v_rest := public.grid_num_rest(q.correct_answer);
  v_stem := public.grid_stem(q.question_text);
  v_seen := array[public.name_norm(v_label)];
  -- أرقام قريبة: سنوات بفروق صغيرة، وغيرها بنسبة.
  d := case when v_num between 1000 and 2100 then 1 when v_num is not null then greatest(1, round(v_num * 0.15)) end;

  for v_c in
    with cand as (
      select public.grid_label(x) as a, 1 as pr, random() as r
        from jsonb_array_elements_text(case when jsonb_typeof(q.fake_answers) = 'array' then q.fake_answers else '[]'::jsonb end) x
      union all
      select public.grid_label(x), 2, random()
        from jsonb_array_elements_text(case when jsonb_typeof(q.options) = 'array' then q.options else '[]'::jsonb end) x
      union all
      select public.grid_label(b.correct_answer),
             case when v_stem = public.grid_stem(b.question_text)
                  then case when b.difficulty = q.difficulty then 3 else 4 end
                  else case when b.difficulty = q.difficulty then 7 else 8 end end,
             random()
        from public.questions_bank b
       where b.game_slug = q.game_slug and b.category_ar = q.category_ar and b.id <> q.id
         and public.grid_tf(b.correct_answer) is null
         and (case when v_num is null then public.grid_num(b.correct_answer) is null
                   else public.grid_num(b.correct_answer) is not null and public.name_norm(public.grid_num_rest(b.correct_answer)) = public.name_norm(v_rest) end)
      union all
      select (v_num + k * d)::bigint::text || v_rest, 5, random()
        from unnest(case when v_num between 1000 and 2100 then array[-1, 1, -2, 2, -3, 3, -5, 5, -10, 10] else array[-1, 1, -2, 2, -3, 3, 4] end) k
       where v_num is not null and v_num + k * d > 0
      union all
      select public.grid_label(b.correct_answer), case when v_stem = public.grid_stem(b.question_text) then 6 else 9 end, random()
        from public.questions_bank b
       where b.game_slug = q.game_slug and b.id <> q.id
         and public.grid_tf(b.correct_answer) is null
         and (case when v_num is null then public.grid_num(b.correct_answer) is null
                   else public.grid_num(b.correct_answer) is not null and public.name_norm(public.grid_num_rest(b.correct_answer)) = public.name_norm(v_rest) end)
    )
    select a from cand where btrim(coalesce(a, '')) <> '' order by pr, r
  loop
    v_n := public.name_norm(v_c);
    if v_n = '' or v_n = any(v_seen) then
      continue;
    end if;
    v_seen := v_seen || v_n;
    v_out := v_out || btrim(v_c);
    exit when array_length(v_out, 1) >= 5;
  end loop;

  return jsonb_build_object('kind', 'mc', 'options',
    (select jsonb_agg(x order by random()) from unnest(v_out || v_label) x));
end;
$$;
revoke all on function public.grid_choices(uuid) from public, anon, authenticated;

-- هل هذا الخيار هو الصحيح؟
create or replace function public.grid_is_correct(p_qid uuid, p_option text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case when public.grid_tf(q.correct_answer) is not null then public.grid_tf(q.correct_answer) = public.grid_tf(p_option)
              else public.name_norm(public.grid_label(q.correct_answer)) = public.name_norm(public.grid_label(p_option)) end
    from public.questions_bank q where q.id = p_qid;
$$;
revoke all on function public.grid_is_correct(uuid, text) from public, anon, authenticated;

-- الفريق التالي في الترتيب بعد p_key.
create or replace function public.grid_after(p_sd jsonb, p_key text)
returns text
language sql
immutable
set search_path = public
as $$
  with o as (select x, n from jsonb_array_elements_text(p_sd->'order') with ordinality t(x, n)),
       me as (select n from o where x = p_key)
  select coalesce((select x from o where n > (select n from me) order by n limit 1), (select x from o order by n limit 1));
$$;

-- الفائز: صاحب أعلى نقاط، أو tie.
create or replace function public.grid_winner(p_sd jsonb)
returns text
language sql
immutable
set search_path = public
as $$
  with s as (select key, coalesce(value::text::int, 0) v from jsonb_each(p_sd->'scores')),
       top as (select key from s where v = (select max(v) from s))
  select case when (select count(*) from top) = 1 then (select key from top) else 'tie' end;
$$;

-- يبدأ اللعبة.
-- p_setup: {"teams": [{"name": "...", "members": ["<player id>", ...]}, ...] (2 إلى 6),
--           "cats": [["فئة", ...], ...] (لكل فريق العدد نفسه، 1 إلى 3), "seconds": 60, "host_plays": false}
create or replace function public.grid_start(p_room_id uuid, p_setup jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_defaults text[] := array['عش النسور', 'عش الصقور', 'عش الشاهين', 'عش العقاب', 'عش الحبارى', 'عش الهدهد'];
  v_sd jsonb;
  v_used jsonb;
  v_host_plays boolean := coalesce((p_setup->>'host_plays')::boolean, false);
  v_seconds int := greatest(15, least(coalesce((p_setup->>'seconds')::int, 60), 180));
  v_nteams int := coalesce(jsonb_array_length(case when jsonb_typeof(p_setup->'teams') = 'array' then p_setup->'teams' end), 0);
  v_per int;
  v_teams jsonb := '[]'::jsonb;
  v_members jsonb := '{}'::jsonb;
  v_order jsonb := '[]'::jsonb;
  v_scores jsonb := '{}'::jsonb;
  v_aids jsonb := '{}'::jsonb;
  v_steals jsonb := '{}'::jsonb;
  v_cats text[] := '{}';
  v_cat_team jsonb := '[]'::jsonb;
  v_cells jsonb := '[]'::jsonb;
  v_col jsonb;
  v_ids jsonb := '[]'::jsonb;
  v_t jsonb;
  v_key text;
  v_name text;
  v_pid text;
  v_cat text;
  v_lvl text;
  v_q record;
  i int;
  j int;
begin
  if not public.is_room_host(p_room_id) then
    return jsonb_build_object('ok', false, 'reason', 'NOT_HOST');
  end if;
  if not exists (select 1 from public.game_rooms where id = p_room_id and status = 'playing') then
    return jsonb_build_object('ok', false, 'reason', 'NOT_PLAYING');
  end if;
  if v_nteams < 2 or v_nteams > 6 then
    return jsonb_build_object('ok', false, 'reason', 'TEAMS_COUNT');
  end if;
  -- فئات كل فريق تقل كلما زادت الفرق، والحد 8 فئات.
  v_per := case v_nteams when 2 then 3 when 3 then 2 when 4 then 2 else 1 end;
  if jsonb_typeof(p_setup->'cats') is distinct from 'array' or jsonb_array_length(p_setup->'cats') <> v_nteams then
    return jsonb_build_object('ok', false, 'reason', 'PICK_CATEGORIES');
  end if;

  -- الفرق والأعضاء.
  for i in 0 .. v_nteams - 1 loop
    v_t := p_setup->'teams'->i;
    v_key := 't' || (i + 1);
    v_name := left(btrim(regexp_replace(coalesce(v_t->>'name', ''), '\s+', ' ', 'g')), 24);
    if v_name = '' or public.blocked_word_in(v_name) is not null then
      v_name := v_defaults[i + 1];
    end if;
    v_teams := v_teams || jsonb_build_array(jsonb_build_object('key', v_key, 'name', v_name, 'c', i));
    v_order := v_order || to_jsonb(v_key);
    v_scores := v_scores || jsonb_build_object(v_key, 0);
    v_aids := v_aids || jsonb_build_object(v_key, jsonb_build_array('double', 'two', 'time'));
    v_steals := v_steals || jsonb_build_object(v_key, true);
    for v_pid in select jsonb_array_elements_text(case when jsonb_typeof(v_t->'members') = 'array' then v_t->'members' else '[]'::jsonb end) loop
      if v_members ? v_pid then
        return jsonb_build_object('ok', false, 'reason', 'TWO_TEAMS');
      end if;
      if exists (select 1 from public.room_players p where p.room_id = p_room_id and p.id::text = v_pid and (not p.is_host or v_host_plays)) then
        v_members := v_members || jsonb_build_object(v_pid, v_key);
      end if;
    end loop;
    if not exists (select 1 from jsonb_each_text(v_members) m where m.value = v_key) then
      return jsonb_build_object('ok', false, 'reason', 'TEAMS', 'team', v_name);
    end if;
  end loop;

  -- الفئات: كل فريق v_per فئات مختلفة، ولا تتكرر فئة بين فريقين.
  for i in 0 .. v_nteams - 1 loop
    if jsonb_array_length(p_setup->'cats'->i) <> v_per then
      return jsonb_build_object('ok', false, 'reason', 'PICK_CATEGORIES');
    end if;
    for j in 0 .. v_per - 1 loop
      v_cat := btrim(coalesce(p_setup->'cats'->i->>j, ''));
      if v_cat = '' or v_cat = any(v_cats) then
        return jsonb_build_object('ok', false, 'reason', 'PICK_CATEGORIES');
      end if;
      v_cats := v_cats || v_cat;
      v_cat_team := v_cat_team || to_jsonb('t' || (i + 1));
    end loop;
  end loop;

  select state_data into v_sd from public.room_game_state where room_id = p_room_id for update;
  v_used := coalesce(v_sd->'last_settings'->'used_ids', v_sd->'settings'->'used_ids', '[]'::jsonb);

  -- اللوحة: لكل فئة سؤالان من كل مستوى، بلا تكرار لما لُعب في الغرفة إن أمكن.
  foreach v_cat in array v_cats loop
    v_col := '[]'::jsonb;
    foreach v_lvl in array array['easy', 'medium', 'hard'] loop
      for v_q in
        select id from public.questions_bank
         where game_slug = 'tactical-grid' and category_ar = v_cat and difficulty = v_lvl
         order by (v_used ? id::text), random()
         limit 2
      loop
        v_col := v_col || jsonb_build_array(jsonb_build_object('id', v_q.id,
                   'p', case v_lvl when 'easy' then 200 when 'medium' then 400 else 600 end, 'done', false, 'by', null));
        v_ids := v_ids || to_jsonb(v_q.id::text);
      end loop;
    end loop;
    if jsonb_array_length(v_col) < 6 then
      return jsonb_build_object('ok', false, 'reason', 'NOT_ENOUGH', 'category', v_cat);
    end if;
    v_cells := v_cells || jsonb_build_array(v_col);
  end loop;

  v_used := (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
              select x from jsonb_array_elements(v_used || v_ids) with ordinality t(x, n) order by n desc limit 600) s);

  update public.room_game_state
     set active_question_id = null,
         state_data = jsonb_build_object(
           'game', 'grid', 'v', 3, 'phase', 'board',
           'settings', jsonb_build_object('seconds', v_seconds, 'per_team', v_per, 'host_plays', v_host_plays, 'used_ids', v_used,
                                          'team_names', (select jsonb_agg(t->'name') from jsonb_array_elements(v_teams) t),
                                          'categories', to_jsonb(v_cats)),
           'teams', v_teams, 'order', v_order, 'members', v_members,
           'cats', to_jsonb(v_cats), 'cat_team', v_cat_team, 'cells', v_cells,
           'scores', v_scores, 'aids', v_aids, 'steals', v_steals,
           'turn', 't1', 'cur', null, 'reveal', null, 'winner', null)
   where room_id = p_room_id;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.grid_start(uuid, jsonb) from public, anon;
grant execute on function public.grid_start(uuid, jsonb) to authenticated;

-- يفتح خانة للفريق صاحب الدور: المضيف، أو أي عضو في هذا الفريق من جواله.
create or replace function public.grid_open(p_room_id uuid, p_cat int, p_cell int, p_aids text[] default '{}')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sd jsonb;
  v_cell jsonb;
  v_team text;
  v_left jsonb;
  v_aid text;
  v_q record;
  v_secs int;
  v_choices jsonb;
  v_me uuid := public.my_player_id(p_room_id);
begin
  select state_data into v_sd from public.room_game_state where room_id = p_room_id for update;
  if v_sd->>'game' is distinct from 'grid' or v_sd->>'phase' <> 'board' or v_sd->'teams' is null then
    return jsonb_build_object('ok', false, 'reason', 'WRONG_PHASE');
  end if;
  v_team := v_sd->>'turn';
  if not (public.is_room_host(p_room_id) or (v_me is not null and v_sd->'members'->>v_me::text = v_team)) then
    return jsonb_build_object('ok', false, 'reason', 'NOT_YOUR_TURN');
  end if;
  v_cell := v_sd->'cells'->p_cat->p_cell;
  if v_cell is null or (v_cell->>'done')::boolean then
    return jsonb_build_object('ok', false, 'reason', 'CELL_DONE');
  end if;
  v_left := coalesce(v_sd->'aids'->v_team, '[]'::jsonb);
  foreach v_aid in array coalesce(p_aids, '{}') loop
    if not v_left ? v_aid then
      return jsonb_build_object('ok', false, 'reason', 'AID_USED');
    end if;
    v_left := v_left - v_aid;
  end loop;

  select id, question_text, media_url, category_ar into v_q from public.questions_bank where id = (v_cell->>'id')::uuid;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'QUESTION_GONE');
  end if;
  v_choices := public.grid_choices(v_q.id);
  if jsonb_array_length(v_choices->'options') < 2 then
    return jsonb_build_object('ok', false, 'reason', 'QUESTION_GONE');
  end if;
  v_secs := coalesce((v_sd->'settings'->>'seconds')::int, 60) + case when 'time' = any(p_aids) then 30 else 0 end;

  v_sd := jsonb_set(v_sd, array['aids', v_team], v_left);
  v_sd := v_sd || jsonb_build_object(
    'phase', 'question',
    'reveal', null,
    'cur', jsonb_build_object(
      'c', p_cat, 'i', p_cell, 'id', v_q.id, 'p', (v_cell->>'p')::int, 'team', v_team, 'answering', v_team,
      'tried', jsonb_build_array(v_team), 'cat', v_q.category_ar, 'q', v_q.question_text, 'media', v_q.media_url,
      'kind', v_choices->>'kind', 'options', v_choices->'options', 'out', '[]'::jsonb, 'votes', '{}'::jsonb, 'picks', '[]'::jsonb,
      'aids', to_jsonb(coalesce(p_aids, '{}')),
      'tries', case when 'two' = any(p_aids) then 2 else 1 end,
      'ends_at', now() + make_interval(secs => v_secs),
      'steal', false));
  update public.room_game_state set active_question_id = v_q.id, state_data = v_sd where room_id = p_room_id;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.grid_open(uuid, int, int, text[]) from public, anon;
grant execute on function public.grid_open(uuid, int, int, text[]) to authenticated;

-- الحسم: يُعتمد خيار الفريق المجيب، ثم صح (نقاط) أو خطأ (محاولة ثانية، أو سرقة، أو لا أحد).
-- داخلي: تستدعيه grid_vote و grid_timeout بعد قفل الصف.
create or replace function public.grid_settle(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sd jsonb;
  v_cur jsonb;
  v_team text;
  v_pick int;
  v_ok boolean := false;
  v_next text;
  v_left int;
  v_secs int;
  v_gain int := 0;
  v_by text := null;
  v_answer text;
  v_idx int;
begin
  select state_data into v_sd from public.room_game_state where room_id = p_room_id for update;
  if v_sd->>'game' is distinct from 'grid' or v_sd->>'phase' not in ('question', 'steal') then
    return jsonb_build_object('ok', false, 'reason', 'WRONG_PHASE');
  end if;
  v_cur := v_sd->'cur';
  v_team := v_cur->>'answering';

  -- الأكثر أصواتًا من الفريق المجيب، وعند التعادل الأسبق.
  select (v->>'o')::int into v_pick
    from jsonb_each(coalesce(v_cur->'votes', '{}'::jsonb)) e(pid, v)
   where v_sd->'members'->>e.pid = v_team
   group by (v->>'o')::int
   order by count(*) desc, min((v->>'at')::timestamptz)
   limit 1;
  if v_pick is not null then
    v_ok := public.grid_is_correct((v_cur->>'id')::uuid, v_cur->'options'->>v_pick);
  end if;
  v_cur := v_cur || jsonb_build_object('picks', coalesce(v_cur->'picks', '[]'::jsonb)
             || jsonb_build_array(jsonb_build_object('team', v_team, 'o', v_pick, 'ok', v_ok)));
  v_secs := greatest(10, least(30, coalesce((v_sd->'settings'->>'seconds')::int, 60) / 3));
  -- السرقة تُستهلك حين يصوّت الفريق السارق، أصاب أو أخطأ.
  if v_sd->>'phase' = 'steal' and v_pick is not null then
    v_sd := jsonb_set(v_sd, array['steals', v_team], 'false'::jsonb);
  end if;

  if v_ok then
    v_by := v_team;
    v_gain := (v_cur->>'p')::int * case when v_team = v_cur->>'team' and v_cur->'aids' ? 'double' then 2 else 1 end;
  else
    if v_pick is not null then
      v_cur := v_cur || jsonb_build_object('out', coalesce(v_cur->'out', '[]'::jsonb) || to_jsonb(v_pick));
    end if;
    v_left := jsonb_array_length(v_cur->'options') - jsonb_array_length(v_cur->'out');
    -- «جوابان»: محاولة ثانية للفريق نفسه.
    if v_sd->>'phase' = 'question' and coalesce((v_cur->>'tries')::int, 1) > 1 and v_left > 1 then
      v_cur := v_cur || jsonb_build_object('tries', (v_cur->>'tries')::int - 1, 'votes', '{}'::jsonb,
                 'ends_at', greatest((v_cur->>'ends_at')::timestamptz, now() + make_interval(secs => v_secs)));
      update public.room_game_state set state_data = v_sd || jsonb_build_object('cur', v_cur) where room_id = p_room_id;
      return jsonb_build_object('ok', true, 'retry', true);
    end if;
    -- السرقة: الفريق التالي الذي لم يجرّب وما زالت سرقته معه، ما دام في الخيارات أكثر من واحد.
    if v_cur->>'kind' = 'mc' and v_left > 1 then
      v_next := v_team;
      for i in 1 .. jsonb_array_length(v_sd->'order') loop
        v_next := public.grid_after(v_sd, v_next);
        exit when not (v_cur->'tried' ? v_next) and coalesce((v_sd->'steals'->>v_next)::boolean, false);
      end loop;
      if v_next is not null and not (v_cur->'tried' ? v_next) and coalesce((v_sd->'steals'->>v_next)::boolean, false) then
        v_cur := v_cur || jsonb_build_object('answering', v_next, 'tried', (v_cur->'tried') || to_jsonb(v_next),
                   'votes', '{}'::jsonb, 'steal', true, 'ends_at', now() + make_interval(secs => v_secs));
        update public.room_game_state set state_data = v_sd || jsonb_build_object('phase', 'steal', 'cur', v_cur) where room_id = p_room_id;
        return jsonb_build_object('ok', true, 'steal', v_next);
      end if;
    end if;
  end if;

  select correct_answer into v_answer from public.questions_bank where id = (v_cur->>'id')::uuid;
  select (n - 1)::int into v_idx from jsonb_array_elements_text(v_cur->'options') with ordinality t(x, n)
   where public.grid_is_correct((v_cur->>'id')::uuid, x) limit 1;
  if v_by is not null then
    v_sd := jsonb_set(v_sd, array['scores', v_by], to_jsonb(coalesce((v_sd->'scores'->>v_by)::int, 0) + v_gain));
  end if;
  v_sd := jsonb_set(v_sd, array['cells', v_cur->>'c', v_cur->>'i'],
                    (v_sd->'cells'->((v_cur->>'c')::int)->((v_cur->>'i')::int)) || jsonb_build_object('done', true, 'by', v_by));
  v_sd := v_sd || jsonb_build_object('phase', 'reveal', 'cur', v_cur,
    'reveal', jsonb_build_object('answer', coalesce(v_answer, v_cur->'options'->>v_idx), 'correct', v_idx, 'by', v_by, 'gain', v_gain,
                                 'stolen', v_by is not null and v_by <> v_cur->>'team'));
  update public.room_game_state set state_data = v_sd where room_id = p_room_id;
  return jsonb_build_object('ok', true, 'done', true);
end;
$$;
revoke all on function public.grid_settle(uuid) from public, anon, authenticated;

-- صوت لاعب من الفريق المجيب. يُحسم السؤال حين يصوّت كل أعضاء الفريق.
create or replace function public.grid_vote(p_room_id uuid, p_option int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sd jsonb;
  v_cur jsonb;
  v_me uuid := public.my_player_id(p_room_id);
  v_team text;
  v_need int;
  v_have int;
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'reason', 'NOT_IN_ROOM');
  end if;
  select state_data into v_sd from public.room_game_state where room_id = p_room_id for update;
  if v_sd->>'game' is distinct from 'grid' or v_sd->>'phase' not in ('question', 'steal') then
    return jsonb_build_object('ok', false, 'reason', 'WRONG_PHASE');
  end if;
  v_cur := v_sd->'cur';
  v_team := v_cur->>'answering';
  if v_sd->'members'->>v_me::text is distinct from v_team then
    return jsonb_build_object('ok', false, 'reason', 'NOT_YOUR_TURN');
  end if;
  if now() > (v_cur->>'ends_at')::timestamptz + interval '2 seconds' then
    return jsonb_build_object('ok', false, 'reason', 'TIME_UP');
  end if;
  if p_option is null or p_option < 0 or p_option >= jsonb_array_length(v_cur->'options') or (v_cur->'out') @> to_jsonb(p_option) then
    return jsonb_build_object('ok', false, 'reason', 'BAD_OPTION');
  end if;

  v_cur := jsonb_set(v_cur, array['votes', v_me::text], jsonb_build_object('o', p_option, 'at', clock_timestamp()));
  update public.room_game_state set state_data = jsonb_set(v_sd, '{cur}', v_cur) where room_id = p_room_id;

  -- كل أعضاء الفريق (الموجودين في الغرفة) صوّتوا؟
  select count(*) into v_need from jsonb_each_text(v_sd->'members') m
    join public.room_players p on p.id::text = m.key and p.room_id = p_room_id
   where m.value = v_team;
  select count(*) into v_have from jsonb_object_keys(v_cur->'votes') k where v_sd->'members'->>k = v_team;
  if v_have >= v_need then
    return public.grid_settle(p_room_id);
  end if;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.grid_vote(uuid, int) from public, anon;
grant execute on function public.grid_vote(uuid, int) to authenticated;

-- «تخطَّ»: الفريق السارق يترك السؤال ويحتفظ بسرقته لسؤال آخر.
create or replace function public.grid_pass(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sd jsonb;
  v_me uuid := public.my_player_id(p_room_id);
begin
  select state_data into v_sd from public.room_game_state where room_id = p_room_id for update;
  if v_sd->>'game' is distinct from 'grid' or v_sd->>'phase' <> 'steal' then
    return jsonb_build_object('ok', false, 'reason', 'WRONG_PHASE');
  end if;
  if not (public.is_room_host(p_room_id) or (v_me is not null and v_sd->'members'->>v_me::text = v_sd->'cur'->>'answering')) then
    return jsonb_build_object('ok', false, 'reason', 'NOT_YOUR_TURN');
  end if;
  update public.room_game_state set state_data = jsonb_set(v_sd, '{cur,votes}', '{}'::jsonb) where room_id = p_room_id;
  return public.grid_settle(p_room_id);
end;
$$;
revoke all on function public.grid_pass(uuid) from public, anon;
grant execute on function public.grid_pass(uuid) to authenticated;

-- انتهى الوقت: أي جهاز في الغرفة يطلب الحسم، والخادم يتأكد من الوقت.
create or replace function public.grid_timeout(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sd jsonb;
begin
  select state_data into v_sd from public.room_game_state where room_id = p_room_id;
  if v_sd->>'game' is distinct from 'grid' or v_sd->>'phase' not in ('question', 'steal') then
    return jsonb_build_object('ok', false, 'reason', 'WRONG_PHASE');
  end if;
  if now() < (v_sd->'cur'->>'ends_at')::timestamptz - interval '1 second' then
    return jsonb_build_object('ok', false, 'reason', 'NOT_YET');
  end if;
  return public.grid_settle(p_room_id);
end;
$$;
revoke all on function public.grid_timeout(uuid) from public, anon;
grant execute on function public.grid_timeout(uuid) to authenticated;

-- بعد عرض الإجابة: الدور للفريق التالي، أو نهاية اللعبة إذا امتلأت اللوحة.
create or replace function public.grid_next(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sd jsonb;
  v_left int;
begin
  if not public.is_room_host(p_room_id) then
    return jsonb_build_object('ok', false, 'reason', 'NOT_HOST');
  end if;
  select state_data into v_sd from public.room_game_state where room_id = p_room_id for update;
  if v_sd->>'game' is distinct from 'grid' or v_sd->>'phase' <> 'reveal' then
    return jsonb_build_object('ok', false, 'reason', 'WRONG_PHASE');
  end if;
  select count(*) into v_left
    from jsonb_array_elements(v_sd->'cells') col, jsonb_array_elements(col) cell
   where not (cell->>'done')::boolean;
  if v_left = 0 then
    v_sd := v_sd || jsonb_build_object('phase', 'over', 'cur', null, 'winner', public.grid_winner(v_sd));
  else
    v_sd := v_sd || jsonb_build_object('phase', 'board', 'cur', null, 'reveal', null,
      'turn', public.grid_after(v_sd, v_sd->'cur'->>'team'));
  end if;
  update public.room_game_state set active_question_id = null, state_data = v_sd where room_id = p_room_id;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.grid_next(uuid) from public, anon;
grant execute on function public.grid_next(uuid) to authenticated;

-- إنهاء مبكر: يُعلن الفائز بالنقاط الحالية.
create or replace function public.grid_finish(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sd jsonb;
begin
  if not public.is_room_host(p_room_id) then
    return jsonb_build_object('ok', false, 'reason', 'NOT_HOST');
  end if;
  select state_data into v_sd from public.room_game_state where room_id = p_room_id for update;
  if v_sd->>'game' is distinct from 'grid' or v_sd->'teams' is null then
    return jsonb_build_object('ok', false, 'reason', 'WRONG_PHASE');
  end if;
  v_sd := v_sd || jsonb_build_object('phase', 'over', 'cur', null, 'winner', public.grid_winner(v_sd));
  update public.room_game_state set active_question_id = null, state_data = v_sd where room_id = p_room_id;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.grid_finish(uuid) from public, anon;
grant execute on function public.grid_finish(uuid) to authenticated;

-- تغيير اسم فريق أثناء اللعب.
create or replace function public.grid_rename(p_room_id uuid, p_team text, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sd jsonb;
  v_name text := left(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), 24);
  v_i int;
begin
  if not public.is_room_host(p_room_id) then
    return jsonb_build_object('ok', false, 'reason', 'NOT_HOST');
  end if;
  if v_name = '' then
    return jsonb_build_object('ok', false, 'reason', 'EMPTY_NAME');
  end if;
  if public.blocked_word_in(v_name) is not null then
    return jsonb_build_object('ok', false, 'reason', 'NAME_NOT_ALLOWED');
  end if;
  select state_data into v_sd from public.room_game_state where room_id = p_room_id for update;
  select (n - 1)::int into v_i from jsonb_array_elements(coalesce(v_sd->'teams', '[]'::jsonb)) with ordinality t(x, n) where x->>'key' = p_team;
  if v_sd->>'game' is distinct from 'grid' or v_i is null then
    return jsonb_build_object('ok', false, 'reason', 'WRONG_PHASE');
  end if;
  v_sd := jsonb_set(v_sd, array['teams', v_i::text, 'name'], to_jsonb(v_name));
  v_sd := jsonb_set(v_sd, '{settings,team_names}', (select jsonb_agg(t->'name') from jsonb_array_elements(v_sd->'teams') t));
  update public.room_game_state set state_data = v_sd where room_id = p_room_id;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.grid_rename(uuid, text, text) from public, anon;
grant execute on function public.grid_rename(uuid, text, text) to authenticated;

-- نقل لاعب إلى فريق (أو إخراجه بـ null)، مثل من دخل بعد بداية اللعبة.
create or replace function public.grid_assign(p_room_id uuid, p_player_id uuid, p_team text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sd jsonb;
begin
  if not public.is_room_host(p_room_id) then
    return jsonb_build_object('ok', false, 'reason', 'NOT_HOST');
  end if;
  select state_data into v_sd from public.room_game_state where room_id = p_room_id for update;
  if v_sd->>'game' is distinct from 'grid' or v_sd->'teams' is null then
    return jsonb_build_object('ok', false, 'reason', 'WRONG_PHASE');
  end if;
  if not exists (select 1 from public.room_players p where p.id = p_player_id and p.room_id = p_room_id
                    and (not p.is_host or coalesce((v_sd->'settings'->>'host_plays')::boolean, false))) then
    return jsonb_build_object('ok', false, 'reason', 'NOT_IN_ROOM');
  end if;
  if p_team is null then
    v_sd := jsonb_set(v_sd, '{members}', (v_sd->'members') - p_player_id::text);
  elsif v_sd->'order' ? p_team then
    v_sd := jsonb_set(v_sd, array['members', p_player_id::text], to_jsonb(p_team));
  else
    return jsonb_build_object('ok', false, 'reason', 'WRONG_PHASE');
  end if;
  update public.room_game_state set state_data = v_sd where room_id = p_room_id;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.grid_assign(uuid, uuid, text) from public, anon;
grant execute on function public.grid_assign(uuid, uuid, text) to authenticated;

-- الإجابة الصحيحة لا تصل للمضيف في «تحديات العش» (تظهر للجميع بعد الحسم فقط).
create or replace function public.room_correct_answer(p_room_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_answer text;
begin
  if not (public.is_room_host(p_room_id) or public.is_app_admin()) then
    raise exception 'HOST_ONLY';
  end if;
  if exists (select 1 from public.room_game_state s where s.room_id = p_room_id and s.state_data->>'game' = 'grid') then
    return null;
  end if;
  select q.correct_answer into v_answer
  from public.room_game_state s
  join public.questions_bank q on q.id = s.active_question_id
  where s.room_id = p_room_id;
  return v_answer;
end;
$$;

update public.games
   set description_ar = 'من 2 إلى 6 فرق، كل فريق يختار فئاته، والكل يتنافس على لوحة نقاط 200 و400 و600. الفريق يصوّت على الإجابة من جوالاته، ومع وسائل مساعدة وفرصة سرقة.'
 where slug = 'tactical-grid';

create table if not exists public.app_migrations (name text primary key, applied_at timestamptz not null default now());
alter table public.app_migrations enable row level security;
revoke all on public.app_migrations from anon, authenticated;
insert into public.app_migrations (name) values ('grid_v2.sql') on conflict do nothing;

notify pgrst, 'reload schema';
