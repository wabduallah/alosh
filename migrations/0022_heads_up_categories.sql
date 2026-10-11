-- هل تعرف: more words, and the host chooses categories before the first turn.
-- Run after 0021. Safe to run again.

-- 1) Words: one row per word, so the seed below can be re-run safely.
create unique index if not exists heads_words_word_key on public.heads_words (word);

insert into public.heads_words (word, category_ar) values
  -- حيوانات
  ('قطة', 'حيوانات'), ('حصان', 'حيوانات'), ('ببغاء', 'حيوانات'), ('زرافة', 'حيوانات'),
  ('دلفين', 'حيوانات'), ('بطريق', 'حيوانات'), ('ثعلب', 'حيوانات'), ('أرنب', 'حيوانات'),
  ('نحلة', 'حيوانات'), ('تمساح', 'حيوانات'), ('قرد', 'حيوانات'), ('جمل', 'حيوانات'),
  -- أماكن
  ('مستشفى', 'أماكن'), ('سوق', 'أماكن'), ('شاطئ', 'أماكن'), ('مسجد', 'أماكن'),
  ('ملعب', 'أماكن'), ('حديقة', 'أماكن'), ('سينما', 'أماكن'), ('جبل', 'أماكن'),
  ('صحراء', 'أماكن'), ('مدرسة', 'أماكن'), ('فندق', 'أماكن'), ('مزرعة', 'أماكن'),
  -- مهن
  ('مهندس', 'مهن'), ('طباخ', 'مهن'), ('شرطي', 'مهن'), ('معلم', 'مهن'),
  ('حلاق', 'مهن'), ('نجار', 'مهن'), ('صحفي', 'مهن'), ('رسام', 'مهن'),
  ('سائق', 'مهن'), ('مزارع', 'مهن'), ('بائع', 'مهن'), ('ممرضة', 'مهن'),
  -- أشياء في البيت
  ('ثلاجة', 'أشياء في البيت'), ('مروحة', 'أشياء في البيت'), ('سرير', 'أشياء في البيت'),
  ('مكنسة', 'أشياء في البيت'), ('غسالة', 'أشياء في البيت'), ('شمعة', 'أشياء في البيت'),
  ('مفتاح', 'أشياء في البيت'), ('مرآة', 'أشياء في البيت'), ('ستارة', 'أشياء في البيت'),
  ('مصباح', 'أشياء في البيت'), ('إبريق', 'أشياء في البيت'), ('خزانة', 'أشياء في البيت'),
  -- طعام
  ('بيتزا', 'طعام'), ('كنافة', 'طعام'), ('عصير', 'طعام'), ('شوكولاتة', 'طعام'),
  ('فلافل', 'طعام'), ('بطيخ', 'طعام'), ('لبن', 'طعام'), ('مكرونة', 'طعام'),
  ('تمر', 'طعام'), ('فشار', 'طعام'), ('شاورما', 'طعام'), ('كبسة', 'طعام'),
  -- رياضات
  ('سباحة', 'رياضات'), ('ملاكمة', 'رياضات'), ('تنس', 'رياضات'), ('كرة السلة', 'رياضات'),
  ('ركض', 'رياضات'), ('تزلج', 'رياضات'), ('رماية', 'رياضات'), ('جودو', 'رياضات'),
  ('بولينج', 'رياضات'), ('غطس', 'رياضات'), ('قفز بالمظلة', 'رياضات'), ('تسلق', 'رياضات')
on conflict (word) do nothing;

-- 2) Category names for the host's picker. Returns names only, never words.
create or replace function public.heads_categories()
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  select distinct w.category_ar from public.heads_words w
  where w.category_ar is not null
  order by 1;
$$;

revoke execute on function public.heads_categories() from public, anon;
grant execute on function public.heads_categories() to authenticated, service_role;

-- 3) Start turn: the first turn builds the queue from the chosen categories
-- (all words when none are given). The new parameter has a default, so old calls still work.
drop function if exists public.heads_start_turn(uuid);

create or replace function public.heads_start_turn(p_room_id uuid, p_categories text[] default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state public.room_game_state%rowtype;
  v_queue jsonb;
  v_guessed jsonb;
  v_guesser uuid;
begin
  if not (public.is_room_host(p_room_id) or public.is_app_admin()) then
    raise exception 'HOST_ONLY';
  end if;
  if not exists (select 1 from public.game_rooms r where r.id = p_room_id and r.status = 'playing') then
    return jsonb_build_object('ok', false, 'reason', 'ROOM_NOT_PLAYING');
  end if;
  select * into v_state from public.room_game_state where room_id = p_room_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'NO_STATE');
  end if;
  if coalesce(v_state.state_data->>'phase', '') not in ('', 'idle', 'between', 'heads_idle') then
    return jsonb_build_object('ok', false, 'reason', 'WRONG_PHASE');
  end if;

  if v_state.state_data->'teams' is null then
    update public.room_players p set team_color = t.team
      from (
        select x.id, case when x.rn % 2 = 1 then 'red' else 'blue' end as team
        from (select rp.id, row_number() over (order by random()) as rn
              from public.room_players rp where rp.room_id = p_room_id and not rp.is_host) x
      ) t
      where p.id = t.id;
    v_state.state_data := v_state.state_data || jsonb_build_object(
      'teams', jsonb_build_array('red', 'blue'),
      'team_scores', jsonb_build_object('red', 0, 'blue', 0));
  end if;

  v_queue := v_state.state_data->'queue';
  if v_queue is null or jsonb_typeof(v_queue) <> 'array' then
    select coalesce(jsonb_agg(w.id::text order by random()), '[]'::jsonb) into v_queue
      from public.heads_words w
      where p_categories is null or w.category_ar = any(p_categories);
    if jsonb_array_length(v_queue) = 0 then
      return jsonb_build_object('ok', false, 'reason', 'NO_WORDS');
    end if;
  end if;

  v_guessed := coalesce(v_state.state_data->'guessed', '[]'::jsonb);
  if not exists (
    select 1 from public.room_players p
    where p.room_id = p_room_id and not p.is_host and not (v_guessed @> to_jsonb(p.id::text))
  ) then
    v_guessed := '[]'::jsonb;
  end if;
  select p.id into v_guesser from public.room_players p
    where p.room_id = p_room_id and not p.is_host and not (v_guessed @> to_jsonb(p.id::text))
    order by random() limit 1;
  if v_guesser is null then
    return jsonb_build_object('ok', false, 'reason', 'NOT_ENOUGH_PLAYERS');
  end if;

  if jsonb_array_length(v_queue) = 0 then
    update public.room_game_state
      set active_question_id = null,
          state_data = state_data || jsonb_build_object('queue', v_queue, 'phase', 'over')
      where room_id = p_room_id;
    return jsonb_build_object('ok', false, 'reason', 'GAME_OVER');
  end if;

  update public.room_game_state
    set active_question_id = (v_queue->>0)::uuid,
        state_data = (v_state.state_data) || jsonb_build_object(
          'phase', 'turn',
          'queue', v_queue - 0,
          'guessed', v_guessed || jsonb_build_array(v_guesser::text),
          'guesser_id', v_guesser::text,
          'turn_ends_at', to_jsonb(now() + interval '60 seconds'),
          'buzzer_open', false,
          'buzzer', null)
    where room_id = p_room_id;

  return jsonb_build_object('ok', true, 'guesser', v_guesser);
end;
$$;

revoke execute on function public.heads_start_turn(uuid, text[]) from public, anon;
grant execute on function public.heads_start_turn(uuid, text[]) to authenticated, service_role;
