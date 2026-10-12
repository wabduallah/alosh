-- =============================================================================
-- «الحلبة» الإصدار 3: كتابة الإجابات. يُشغَّل بعد alhalba_v2.sql، وتشغيله مرة ثانية آمن.
--
-- صاحب المزايدة يكتب إجاباته في جواله (أو ينطقها كالسابق). كل إجابة تظهر للحَكَم
-- والتلفزيون، والحَكَم يضغط ✓ أو ✗. الإجابة المكررة تُرفض تلقائيًا، حتى لو اختلفت
-- الهمزات أو التشكيل أو «ال». العدّ = الإجابات المقبولة + أي تعديل يدوي من الحَكَم.
-- =============================================================================

-- Text for comparing answers: no diacritics or tatweel, one alef, ه for ة, ي for ى, no «ال», no spaces.
create or replace function public.halba_norm(p text)
returns text language sql immutable as $$
  select regexp_replace(
           regexp_replace(
             translate(regexp_replace(lower(btrim(coalesce(p, ''))), '[ً-ْـ]', '', 'g'), 'أإآٱةى', 'ااااهي'),
             '(^|\s)ال', '\1', 'g'),
           '\s+', '', 'g');
$$;

-- The proof starts with an empty answer list.
create or replace function public.halba_begin_prove(p_room_id uuid, v_sd jsonb, p_challenger uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_cname text;
begin
  if p_challenger is not null then
    select player_name into v_cname from public.room_players where id = p_challenger;
  end if;
  update public.room_game_state
    set state_data = v_sd || jsonb_build_object(
      'phase', 'prove', 'challenger', p_challenger::text, 'challenger_name', v_cname, 'count', 0,
      'answers', '[]'::jsonb,
      'prove_ends_at', to_jsonb(now() + make_interval(secs => coalesce((v_sd->'topic'->>'seconds')::int, 30))))
    where room_id = p_room_id;
end;
$$;

-- The bidder sends one answer. Duplicates (after halba_norm) are refused.
create or replace function public.halba_answer(p_room_id uuid, p_text text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_state public.room_game_state%rowtype;
  v_sd jsonb;
  v_me uuid := public.my_player_id(p_room_id);
  v_text text := btrim(regexp_replace(coalesce(p_text, ''), '\s+', ' ', 'g'));
  v_answers jsonb;
begin
  select * into v_state from public.room_game_state where room_id = p_room_id for update;
  v_sd := coalesce(v_state.state_data, '{}'::jsonb);
  if v_sd->>'phase' <> 'prove' then
    return jsonb_build_object('ok', false, 'reason', 'WRONG_PHASE');
  end if;
  if v_me is null or v_sd->>'bidder' <> v_me::text then
    return jsonb_build_object('ok', false, 'reason', 'NOT_BIDDER');
  end if;
  if now() > (v_sd->>'prove_ends_at')::timestamptz + interval '1 second' then
    return jsonb_build_object('ok', false, 'reason', 'TIME_UP');
  end if;
  if char_length(v_text) = 0 or char_length(v_text) > 60 then
    return jsonb_build_object('ok', false, 'reason', 'BAD_ANSWER');
  end if;
  v_answers := coalesce(v_sd->'answers', '[]'::jsonb);
  if jsonb_array_length(v_answers) >= 40 then
    return jsonb_build_object('ok', false, 'reason', 'TOO_MANY');
  end if;
  if exists (select 1 from jsonb_array_elements(v_answers) a where a->>'norm' = public.halba_norm(v_text)) then
    return jsonb_build_object('ok', false, 'reason', 'DUPLICATE');
  end if;
  update public.room_game_state
    set state_data = v_sd || jsonb_build_object('answers', v_answers || jsonb_build_array(
      jsonb_build_object('n', jsonb_array_length(v_answers), 'text', v_text, 'norm', public.halba_norm(v_text), 'status', 'pending')))
    where room_id = p_room_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- The judge accepts (✓) or rejects (✗) answer number p_n. Reaching the bid wins at once.
create or replace function public.halba_mark(p_room_id uuid, p_n int, p_ok boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_state public.room_game_state%rowtype;
  v_sd jsonb;
  v_answers jsonb;
  v_old text;
  v_new text := case when p_ok then 'ok' else 'no' end;
  v_count int;
begin
  select * into v_state from public.room_game_state where room_id = p_room_id for update;
  v_sd := coalesce(v_state.state_data, '{}'::jsonb);
  if v_sd->>'phase' <> 'prove' then
    return jsonb_build_object('ok', false, 'reason', 'WRONG_PHASE');
  end if;
  if not public.halba_may_judge(p_room_id, v_sd) then
    return jsonb_build_object('ok', false, 'reason', 'NOT_JUDGE');
  end if;
  v_answers := coalesce(v_sd->'answers', '[]'::jsonb);
  if p_n is null or p_n < 0 or p_n >= jsonb_array_length(v_answers) then
    return jsonb_build_object('ok', false, 'reason', 'NO_ANSWER');
  end if;
  v_old := v_answers->p_n->>'status';
  if v_old = v_new then
    return jsonb_build_object('ok', true);
  end if;
  v_answers := jsonb_set(v_answers, array[p_n::text, 'status'], to_jsonb(v_new));
  v_count := greatest(0, coalesce((v_sd->>'count')::int, 0)
             + case when v_new = 'ok' then 1 else 0 end
             - case when v_old = 'ok' then 1 else 0 end);
  v_sd := v_sd || jsonb_build_object('answers', v_answers, 'count', v_count);
  if v_count >= coalesce((v_sd->>'bid')::int, 1) then
    perform public.halba_resolve(p_room_id, v_sd);
    return jsonb_build_object('ok', true, 'count', v_count, 'done', true);
  end if;
  update public.room_game_state set state_data = v_sd where room_id = p_room_id;
  return jsonb_build_object('ok', true, 'count', v_count);
end;
$$;

-- Anyone may close an expired proof, but wait longer while answers are still unjudged.
create or replace function public.halba_finish(p_room_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_state public.room_game_state%rowtype;
  v_sd jsonb;
  v_pending boolean;
  v_grace interval;
begin
  select * into v_state from public.room_game_state where room_id = p_room_id for update;
  v_sd := coalesce(v_state.state_data, '{}'::jsonb);
  if v_sd->>'phase' <> 'prove' then
    return jsonb_build_object('ok', false, 'reason', 'WRONG_PHASE');
  end if;
  if not public.halba_may_judge(p_room_id, v_sd) then
    v_pending := exists (select 1 from jsonb_array_elements(coalesce(v_sd->'answers', '[]'::jsonb)) a where a->>'status' = 'pending');
    v_grace := case when v_pending then interval '20 seconds' else interval '4 seconds' end;
    if not (public.is_room_host(p_room_id) or public.my_player_id(p_room_id) is not null)
       or now() < (v_sd->>'prove_ends_at')::timestamptz + v_grace then
      return jsonb_build_object('ok', false, 'reason', 'NOT_JUDGE');
    end if;
  end if;
  return public.halba_resolve(p_room_id, v_sd);
end;
$$;

revoke all on function public.halba_answer(uuid, text), public.halba_mark(uuid, int, boolean), public.halba_norm(text) from public, anon;
grant execute on function public.halba_answer(uuid, text), public.halba_mark(uuid, int, boolean), public.halba_finish(uuid) to authenticated;
