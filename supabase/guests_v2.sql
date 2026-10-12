-- =============================================================================
-- إعدادات الزوار، الإصدار 2: طيور العش. يُشغَّل بعد guests_v1.sql، وتشغيله مرة ثانية آمن.
--
-- صورة اللاعب الرمزية صارت طائرًا من طيور العش بدل الإيموجي، وكل جزء فيها اختياري:
--   c: لون البيضة 1 إلى 8 (إن غاب: حسب ترتيب الدخول)
--   e: اسم طائر من القائمة، أو none (بدون صورة رمزية: أول حرف من الاسم)،
--      وإن غاب: طائر حسب ترتيب الدخول.
-- الإيموجي القديمة تبقى مقبولة حتى لا تتعطل الصفوف الموجودة، والموقع يعرضها
-- طائرًا تلقائيًا.
-- =============================================================================

alter table public.room_players drop constraint if exists room_players_avatar_check;

alter table public.room_players add constraint room_players_avatar_check check (
  avatar is null or (
    jsonb_typeof(avatar) = 'object'
    and (avatar->'c' is null or jsonb_typeof(avatar->'c') = 'null' or (avatar->>'c') ~ '^[1-8]$')
    and (avatar->'e' is null or jsonb_typeof(avatar->'e') = 'null'
         or (avatar->>'e') = any (array[
           -- طيور العش
           'chick','falcon','hoopoe','owl','parrot','penguin','flamingo','dove',
           'peacock','duck','toucan','canary','crow','eagle','bulbul','kingfisher',
           -- بدون صورة رمزية
           'none',
           -- إيموجي الإصدار 1
           '🦊','🐼','🦁','🐯','🐸','🐵','🦄','🐙','🐢','🦉','🐧','🐨','🐰','🦋','🐳','🌵','🌙','⭐','🔥','⚽','🎮','🎩','👑','🍉'
         ]))
    and (avatar - 'c' - 'e') = '{}'::jsonb
  )
);

comment on column public.room_players.avatar is 'صورة اللاعب الرمزية: {"c": لون 1-8 اختياري, "e": طائر من طيور العش أو none، اختياري}.';

notify pgrst, 'reload schema';
