-- =============================================================================
-- «تحديات العش»، الإصدار 2: فريقان وفئات ولوحة نقاط ووسائل مساعدة. تشغيله مرة ثانية آمن.
--
-- طريقة اللعب:
--   - المضيف يختار حتى 6 فئات ومدة السؤال، ويُقسَم اللاعبون إلى فريقين.
--   - لكل فئة 6 خانات: 200 و200 و400 و400 و600 و600 (سهل/متوسط/صعب من بنك الأسئلة).
--   - الفريق صاحب الدور يختار خانة، ويقدر يستخدم وسيلة مساعدة قبل فتحها:
--       ضاعِف (النقاط ×2)، جوابان (محاولتان)، وقت إضافي (+30 ثانية). كل وسيلة مرة واحدة.
--   - المضيف يرى الإجابة ويحكم. إن أخطأ الفريق، يحاول الفريق الآخر «السرقة» بوقت أقصر.
--   - بعد كل خانة ينتقل الدور، وتنتهي اللعبة بامتلاء اللوحة. الأعلى نقاطًا يفوز.
--
-- الحالة في room_game_state.state_data، والأسئلة تبقى في questions_bank (الإجابة لا تُرسل
-- للاعبين إلا بعد الحكم). لا تُستدعى إلا من المضيف.
-- =============================================================================

-- الفئات المتاحة: فئة فيها سؤالان على الأقل من كل مستوى.
create or replace function public.grid_categories()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('name', category_ar, 'easy', e, 'medium', m, 'hard', h, 'total', e + m + h) order by category_ar), '[]'::jsonb)
    from (
      select category_ar,
             count(*) filter (where difficulty = 'easy') e,
             count(*) filter (where difficulty = 'medium') m,
             count(*) filter (where difficulty = 'hard') h
        from public.questions_bank
       where game_slug = 'tactical-grid'
       group by category_ar
    ) c
   where e >= 2 and m >= 2 and h >= 2;
$$;
revoke all on function public.grid_categories() from public, anon;
grant execute on function public.grid_categories() to authenticated;

-- يبدأ اللعبة: الفئات، المدة، والفرق ({"<player id>": "red" | "blue"}؛ فارغ = تقسيم تلقائي).
create or replace function public.grid_start(p_room_id uuid, p_categories text[], p_seconds int default 60, p_teams jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sd jsonb;
  v_used jsonb;
  v_cats text[];
  v_cells jsonb := '[]'::jsonb;
  v_col jsonb;
  v_ids jsonb := '[]'::jsonb;
  v_lvl text;
  v_pts int;
  v_q record;
  v_cat text;
  v_seconds int := greatest(15, least(coalesce(p_seconds, 60), 180));
  v_red int;
  v_blue int;
  v_settings jsonb;
begin
  if not public.is_room_host(p_room_id) then
    return jsonb_build_object('ok', false, 'reason', 'NOT_HOST');
  end if;
  if not exists (select 1 from public.game_rooms where id = p_room_id and status = 'playing') then
    return jsonb_build_object('ok', false, 'reason', 'NOT_PLAYING');
  end if;

  select array_agg(distinct btrim(c)) into v_cats from unnest(coalesce(p_categories, '{}')) c where btrim(c) <> '';
  if coalesce(array_length(v_cats, 1), 0) < 2 or array_length(v_cats, 1) > 6 then
    return jsonb_build_object('ok', false, 'reason', 'PICK_CATEGORIES');
  end if;
  -- ترتيب الفئات كما اختارها المضيف.
  select array_agg(c order by o) into v_cats
    from (select distinct on (btrim(c)) btrim(c) c, o from unnest(p_categories) with ordinality u(c, o) where btrim(c) <> '' order by btrim(c), o) x;

  select state_data into v_sd from public.room_game_state where room_id = p_room_id for update;
  v_used := coalesce(v_sd->'last_settings'->'used_ids', v_sd->'settings'->'used_ids', '[]'::jsonb);

  -- الفرق.
  perform set_config('alosh.trusted', 'on', true);
  if p_teams is not null and jsonb_typeof(p_teams) = 'object' then
    update public.room_players p
       set team_color = case when p_teams->>p.id::text in ('red', 'blue') then p_teams->>p.id::text else null end
     where p.room_id = p_room_id and not p.is_host;
  else
    with ordered as (
      select id, row_number() over (order by joined_at, id) rn from public.room_players where room_id = p_room_id and not is_host
    )
    update public.room_players p set team_color = case when o.rn % 2 = 1 then 'red' else 'blue' end
      from ordered o where p.id = o.id;
  end if;
  perform set_config('alosh.trusted', '', true);
  select count(*) filter (where team_color = 'red'), count(*) filter (where team_color = 'blue')
    into v_red, v_blue from public.room_players where room_id = p_room_id and not is_host;
  if v_red = 0 or v_blue = 0 then
    return jsonb_build_object('ok', false, 'reason', 'TEAMS');
  end if;

  -- اللوحة: لكل فئة سؤالان من كل مستوى، بلا تكرار لما لُعب في هذه الغرفة إن أمكن.
  foreach v_cat in array v_cats loop
    v_col := '[]'::jsonb;
    foreach v_lvl in array array['easy', 'medium', 'hard'] loop
      v_pts := case v_lvl when 'easy' then 200 when 'medium' then 400 else 600 end;
      for v_q in
        select id from public.questions_bank
         where game_slug = 'tactical-grid' and category_ar = v_cat and difficulty = v_lvl
         order by (v_used ? id::text), random()
         limit 2
      loop
        v_col := v_col || jsonb_build_array(jsonb_build_object('id', v_q.id, 'p', v_pts, 'done', false, 'by', null));
        v_ids := v_ids || to_jsonb(v_q.id::text);
      end loop;
    end loop;
    if jsonb_array_length(v_col) < 6 then
      return jsonb_build_object('ok', false, 'reason', 'NOT_ENOUGH', 'category', v_cat);
    end if;
    v_cells := v_cells || jsonb_build_array(v_col);
  end loop;

  -- نتذكر آخر 600 سؤال لُعب في الغرفة.
  v_used := (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
              select x from jsonb_array_elements(v_used || v_ids) with ordinality t(x, n) order by n desc limit 600) s);
  v_settings := jsonb_build_object('categories', to_jsonb(v_cats), 'seconds', v_seconds, 'used_ids', v_used);

  update public.room_game_state
     set active_question_id = null,
         state_data = jsonb_build_object(
           'game', 'grid', 'phase', 'board', 'settings', v_settings,
           'cats', to_jsonb(v_cats), 'cells', v_cells,
           'scores', jsonb_build_object('red', 0, 'blue', 0),
           'aids', jsonb_build_object('red', jsonb_build_array('double', 'two', 'time'), 'blue', jsonb_build_array('double', 'two', 'time')),
           'turn', 'red', 'cur', null, 'reveal', null, 'winner', null)
   where room_id = p_room_id;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.grid_start(uuid, text[], int, jsonb) from public, anon;
grant execute on function public.grid_start(uuid, text[], int, jsonb) to authenticated;

-- يفتح خانة للفريق صاحب الدور، مع وسائل المساعدة التي اختارها.
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
begin
  if not public.is_room_host(p_room_id) then
    return jsonb_build_object('ok', false, 'reason', 'NOT_HOST');
  end if;
  select state_data into v_sd from public.room_game_state where room_id = p_room_id for update;
  if v_sd->>'game' is distinct from 'grid' or v_sd->>'phase' <> 'board' then
    return jsonb_build_object('ok', false, 'reason', 'WRONG_PHASE');
  end if;
  v_cell := v_sd->'cells'->p_cat->p_cell;
  if v_cell is null or (v_cell->>'done')::boolean then
    return jsonb_build_object('ok', false, 'reason', 'CELL_DONE');
  end if;
  v_team := v_sd->>'turn';
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
  v_secs := coalesce((v_sd->'settings'->>'seconds')::int, 60) + case when 'time' = any(p_aids) then 30 else 0 end;

  v_sd := jsonb_set(v_sd, array['aids', v_team], v_left);
  v_sd := v_sd || jsonb_build_object(
    'phase', 'question',
    'reveal', null,
    'cur', jsonb_build_object(
      'c', p_cat, 'i', p_cell, 'id', v_q.id, 'p', (v_cell->>'p')::int, 'team', v_team,
      'cat', v_q.category_ar, 'q', v_q.question_text, 'media', v_q.media_url,
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

-- حكم المضيف: صح أو خطأ (والخطأ يشمل انتهاء الوقت).
create or replace function public.grid_judge(p_room_id uuid, p_correct boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sd jsonb;
  v_cur jsonb;
  v_team text;
  v_other text;
  v_gain int := 0;
  v_by text := null;
  v_answer text;
  v_steal_secs int;
begin
  if not public.is_room_host(p_room_id) then
    return jsonb_build_object('ok', false, 'reason', 'NOT_HOST');
  end if;
  select state_data into v_sd from public.room_game_state where room_id = p_room_id for update;
  if v_sd->>'game' is distinct from 'grid' or v_sd->>'phase' not in ('question', 'steal') then
    return jsonb_build_object('ok', false, 'reason', 'WRONG_PHASE');
  end if;
  v_cur := v_sd->'cur';
  v_team := v_cur->>'team';
  v_other := case v_team when 'red' then 'blue' else 'red' end;

  if v_sd->>'phase' = 'question' then
    if p_correct then
      v_by := v_team;
      v_gain := (v_cur->>'p')::int * case when v_cur->'aids' ? 'double' then 2 else 1 end;
    elsif coalesce((v_cur->>'tries')::int, 1) > 1 then
      -- «جوابان»: محاولة ثانية بالوقت نفسه.
      v_sd := jsonb_set(v_sd, '{cur,tries}', to_jsonb((v_cur->>'tries')::int - 1));
      update public.room_game_state set state_data = v_sd where room_id = p_room_id;
      return jsonb_build_object('ok', true, 'retry', true);
    else
      -- فرصة السرقة للفريق الآخر.
      v_steal_secs := greatest(10, least(30, coalesce((v_sd->'settings'->>'seconds')::int, 60) / 3));
      v_sd := v_sd || jsonb_build_object('phase', 'steal');
      v_sd := jsonb_set(v_sd, '{cur}', v_cur || jsonb_build_object('steal', true, 'ends_at', now() + make_interval(secs => v_steal_secs)));
      update public.room_game_state set state_data = v_sd where room_id = p_room_id;
      return jsonb_build_object('ok', true, 'steal', true);
    end if;
  else
    if p_correct then
      v_by := v_other;
      v_gain := (v_cur->>'p')::int;
    end if;
  end if;

  select correct_answer into v_answer from public.questions_bank where id = (v_cur->>'id')::uuid;
  if v_by is not null then
    v_sd := jsonb_set(v_sd, array['scores', v_by], to_jsonb(coalesce((v_sd->'scores'->>v_by)::int, 0) + v_gain));
  end if;
  v_sd := jsonb_set(v_sd, array['cells', v_cur->>'c', v_cur->>'i'],
                    (v_sd->'cells'->((v_cur->>'c')::int)->((v_cur->>'i')::int)) || jsonb_build_object('done', true, 'by', v_by));
  v_sd := v_sd || jsonb_build_object('phase', 'reveal',
    'reveal', jsonb_build_object('answer', v_answer, 'by', v_by, 'gain', v_gain, 'stolen', v_by is not null and v_by <> v_team));
  update public.room_game_state set state_data = v_sd where room_id = p_room_id;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.grid_judge(uuid, boolean) from public, anon;
grant execute on function public.grid_judge(uuid, boolean) to authenticated;

-- بعد عرض الإجابة: الدور للفريق الآخر، أو نهاية اللعبة إذا امتلأت اللوحة.
create or replace function public.grid_next(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sd jsonb;
  v_left int;
  v_red int;
  v_blue int;
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
  v_red := coalesce((v_sd->'scores'->>'red')::int, 0);
  v_blue := coalesce((v_sd->'scores'->>'blue')::int, 0);
  if v_left = 0 then
    v_sd := v_sd || jsonb_build_object('phase', 'over', 'cur', null,
      'winner', case when v_red > v_blue then 'red' when v_blue > v_red then 'blue' else 'tie' end);
  else
    v_sd := v_sd || jsonb_build_object('phase', 'board', 'cur', null, 'reveal', null,
      'turn', case (v_sd->'cur'->>'team') when 'red' then 'blue' else 'red' end);
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
  v_red int;
  v_blue int;
begin
  if not public.is_room_host(p_room_id) then
    return jsonb_build_object('ok', false, 'reason', 'NOT_HOST');
  end if;
  select state_data into v_sd from public.room_game_state where room_id = p_room_id for update;
  if v_sd->>'game' is distinct from 'grid' then
    return jsonb_build_object('ok', false, 'reason', 'WRONG_PHASE');
  end if;
  v_red := coalesce((v_sd->'scores'->>'red')::int, 0);
  v_blue := coalesce((v_sd->'scores'->>'blue')::int, 0);
  v_sd := v_sd || jsonb_build_object('phase', 'over', 'cur', null,
    'winner', case when v_red > v_blue then 'red' when v_blue > v_red then 'blue' else 'tie' end);
  update public.room_game_state set active_question_id = null, state_data = v_sd where room_id = p_room_id;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.grid_finish(uuid) from public, anon;
grant execute on function public.grid_finish(uuid) to authenticated;

-- وصف اللعبة الجديد.
update public.games
   set description_ar = 'فريقان يختاران الفئات ويتنافسان على لوحة نقاط 200 و400 و600، مع وسائل مساعدة وفرصة سرقة. المضيف يحكم والشاشة الكبيرة تعرض.'
 where slug = 'tactical-grid';

notify pgrst, 'reload schema';
