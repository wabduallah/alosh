-- =============================================================================
-- إعدادات الزوار، الإصدار 1. تشغيله مرة ثانية آمن.
--
-- صورة اللاعب الرمزية: لون البيضة (1 إلى 8 من ألوان الهوية) وإيموجي اختياري
-- من قائمة ثابتة. يختارها الزائر من صفحة الإعدادات، وتُحفظ مع اللاعب عند
-- دخوله أي غرفة، فتظهر للجميع في قائمة الغرفة وعلى التلفزيون.
-- =============================================================================

alter table public.room_players add column if not exists avatar jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'room_players_avatar_check') then
    alter table public.room_players add constraint room_players_avatar_check check (
      avatar is null or (
        jsonb_typeof(avatar) = 'object'
        and (avatar->>'c') ~ '^[1-8]$'
        and (avatar->'e' is null or jsonb_typeof(avatar->'e') = 'null'
             or (avatar->>'e') = any (array['🦊','🐼','🦁','🐯','🐸','🐵','🦄','🐙','🐢','🦉','🐧','🐨','🐰','🦋','🐳','🌵','🌙','⭐','🔥','⚽','🎮','🎩','👑','🍉']))
        and (avatar - 'c' - 'e') = '{}'::jsonb
      )
    );
  end if;
end $$;

comment on column public.room_players.avatar is 'صورة اللاعب الرمزية: {"c": لون 1-8, "e": إيموجي اختياري}.';

grant select (avatar) on public.room_players to anon, authenticated;
grant insert (avatar) on public.room_players to authenticated;

notify pgrst, 'reload schema';
