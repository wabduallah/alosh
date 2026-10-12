-- =============================================================================
-- لوحة الإدارة، الإصدار 3: إدارة الموقع. يُشغَّل بعد admin_v2.sql، وتشغيله مرة
-- ثانية آمن.
--
--   1) site_settings: إعلان الصفحة الرئيسية، وإعدادات الألعاب الافتراضية.
--      يقرأها الجميع (لا أسرار فيها)، ويعدّلها المدير فقط.
--   2) أوقات قابلة للتعديل: دور «هل تعرف» (كان 60 ثانية ثابتة)، ووقت المزايدة
--      في «الحلبة» (كان 20 ثانية ثابتة). القيم الحالية هي الافتراضية.
--   3) الأسماء الممنوعة: كلمات لا تُقبل في أسماء اللاعبين عند الانضمام أو إنشاء
--      غرفة. القائمة للمدير فقط، والتحقق في قاعدة البيانات نفسها.
-- =============================================================================

-- 1) الإعدادات -------------------------------------------------------------------

create table if not exists public.site_settings (
  key text primary key check (key in ('announcement', 'game_defaults')),
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
comment on table public.site_settings is 'إعدادات الموقع العامة: الإعلان وإعدادات الألعاب الافتراضية.';

alter table public.site_settings enable row level security;
grant select on public.site_settings to anon, authenticated;
grant insert, update, delete on public.site_settings to authenticated;
grant all on public.site_settings to service_role;

drop policy if exists "site settings: public read" on public.site_settings;
create policy "site settings: public read" on public.site_settings for select to anon, authenticated using (true);
drop policy if exists "site settings: admin write" on public.site_settings;
create policy "site settings: admin write" on public.site_settings for all to authenticated
  using (public.is_app_admin()) with check (public.is_app_admin());

insert into public.site_settings (key, value) values ('announcement', '{"active": false}'), ('game_defaults', '{}')
on conflict (key) do nothing;

-- A whole-number game default, kept inside safe bounds.
create or replace function public.game_default(p_slug text, p_key text, p_fallback int, p_min int, p_max int)
returns int language sql stable security definer set search_path = public as $$
  select greatest(p_min, least(p_max, coalesce(
    (select case when jsonb_typeof(s.value->p_slug->p_key) = 'number' then (s.value->p_slug->>p_key)::numeric::int end
       from public.site_settings s where s.key = 'game_defaults'),
    p_fallback)));
$$;
revoke all on function public.game_default(text, text, int, int, int) from public, anon, authenticated;

-- 2) الأوقات ---------------------------------------------------------------------

-- «الحلبة»: same as v4, with the bidding time from the settings (20 seconds by default).
create or replace function public.halba_bid_fields(p_topic public.alhalba_topics)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'phase', 'bid',
    'topic', jsonb_build_object('id', p_topic.id, 'text', p_topic.topic_ar, 'min', p_topic.min_answers,
                                'seconds', p_topic.time_limit_sec, 'category', p_topic.category),
    'bid', p_topic.min_answers - 1, 'bidder', null, 'bidder_name', null, 'bidder_side', null,
    'challenger', null, 'challenger_name', null, 'challenger_side', null, 'performer_side', null,
    'count', 0, 'answers', '[]'::jsonb, 'double', false, 'double_by', null,
    'steal_need', null, 'offer_ends_at', null, 'steal_result', null, 'result', null,
    'predictions', '{}'::jsonb,
    'bid_ends_at', to_jsonb(now() + make_interval(secs => public.game_default('alhalba', 'bid_seconds', 20, 10, 60))),
    'prove_ends_at', null);
$$;
revoke all on function public.halba_bid_fields(public.alhalba_topics) from public, anon, authenticated;

-- «هل تعرف»: same as the live version, with the turn length from the settings (60 seconds by default).
create or replace function public.heads_start_turn(p_room_id uuid, p_categories text[] default null::text[])
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
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
          'turn_ends_at', to_jsonb(now() + make_interval(secs => public.game_default('heads-up', 'turn_seconds', 60, 20, 180))),
          'buzzer_open', false,
          'buzzer', null)
    where room_id = p_room_id;

  return jsonb_build_object('ok', true, 'guesser', v_guesser);
end;
$function$;

-- 3) الأسماء الممنوعة ------------------------------------------------------------

-- Comparison form of a name: no diacritics or tatweel, one form of alef/yaa/taa
-- marbuta/hamza seats, lower case, letters and digits only, single spaces.
create or replace function public.name_norm(p text)
returns text language sql immutable as $$
  select btrim(regexp_replace(regexp_replace(lower(translate(
    regexp_replace(coalesce(p, ''), '[ًٌٍَُِّْٰـ]', '', 'g'),
    'أإآٱىةؤئ', 'اااايهوي')), '[^0-9a-zء-ي٠-٩]+', ' ', 'g'), '\s+', ' ', 'g'));
$$;

create table if not exists public.blocked_names (
  id uuid primary key default gen_random_uuid(),
  word text not null check (char_length(btrim(word)) between 1 and 40),
  norm text not null,
  whole_word boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists blocked_names_norm_key on public.blocked_names (norm);
comment on table public.blocked_names is 'كلمات ممنوعة في أسماء اللاعبين. للمدير فقط.';

alter table public.blocked_names enable row level security;
revoke all on public.blocked_names from anon;
grant select, insert, update, delete on public.blocked_names to authenticated;
grant all on public.blocked_names to service_role;
drop policy if exists "blocked names: admin manage" on public.blocked_names;
create policy "blocked names: admin manage" on public.blocked_names for all to authenticated
  using (public.is_app_admin()) with check (public.is_app_admin());

create or replace function public.blocked_names_set_norm()
returns trigger language plpgsql as $$
begin
  new.word := btrim(regexp_replace(new.word, '\s+', ' ', 'g'));
  new.norm := public.name_norm(new.word);
  if new.norm = '' then
    raise exception 'EMPTY_WORD' using errcode = '23514';
  end if;
  return new;
end;
$$;
drop trigger if exists blocked_names_norm on public.blocked_names;
create trigger blocked_names_norm before insert or update on public.blocked_names
  for each row execute function public.blocked_names_set_norm();

-- The blocked word a name contains, if any. Whole words match on word boundaries;
-- the others anywhere, spaces ignored.
create or replace function public.blocked_word_in(p_name text)
returns text language sql stable security definer set search_path = public as $$
  select b.word from public.blocked_names b
   where (b.whole_word and (' ' || public.name_norm(p_name) || ' ') like ('% ' || b.norm || ' %'))
      or (not b.whole_word and replace(public.name_norm(p_name), ' ', '') like ('%' || replace(b.norm, ' ', '') || '%'))
   limit 1;
$$;
revoke all on function public.blocked_word_in(text) from public, anon, authenticated;

create or replace function public.room_players_check_name()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.blocked_word_in(new.player_name) is not null then
    raise exception 'NAME_NOT_ALLOWED' using errcode = '23514';
  end if;
  return new;
end;
$$;
drop trigger if exists room_players_check_name on public.room_players;
create trigger room_players_check_name before insert or update of player_name on public.room_players
  for each row execute function public.room_players_check_name();

-- Admin: test a name, and find names already in open rooms that the list now blocks.
create or replace function public.admin_name_check(p_name text)
returns text language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_app_admin() then
    raise exception 'NOT_ADMIN' using errcode = '42501';
  end if;
  return public.blocked_word_in(p_name);
end;
$$;

create or replace function public.admin_name_hits()
returns table(player_id uuid, room_id uuid, room_code text, player_name text, is_host boolean, word text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_app_admin() then
    raise exception 'NOT_ADMIN' using errcode = '42501';
  end if;
  return query
    select p.id, r.id, r.room_code, p.player_name, p.is_host, public.blocked_word_in(p.player_name)
      from public.room_players p join public.game_rooms r on r.id = p.room_id
     where r.status <> 'finished' and public.blocked_word_in(p.player_name) is not null
     order by r.created_at desc;
end;
$$;
revoke all on function public.admin_name_check(text), public.admin_name_hits() from public, anon;
grant execute on function public.admin_name_check(text), public.admin_name_hits() to authenticated;

notify pgrst, 'reload schema';
