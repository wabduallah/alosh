# قاعدة بيانات العش: أين المرجع؟

> توثيق فقط. لا يغيّر أي ملف SQL ولا إعداد قاعدة البيانات.

## المسار الذي يستخدمه الكود الحالي
العميل (المتصفح) يتحدث مع Supabase مباشرة بمفتاح `anon` عبر جداول ودوال RPC:
`game_rooms`, `room_players`, `room_game_state`, `games`, `questions_bank`, `alhalba_topics`, `court_cases`, `heads_words`, `outsider_topics`, `feedback`, `site_settings`, ...
هذه الجداول معرّفة في **`supabase/*.sql`** (الأساس: `schema_al3sh_core.sql`) وتُشغَّل يدويًا من SQL Editor. الأمان يعتمد على RLS ودوال `security definer` في تلك الملفات.

## مجلد `migrations/` (قديم/مختلف)
- يُدار بـ `scripts/migrate.mjs` ويسجّل المطبّق في جدول `_migrations`.
- ملفاته أقدم وتخاطب نموذجًا مختلفًا (مثل جدول `rooms`). `0024_drop_legacy_tables.sql` يحذف جداول قديمة.
- يوجد ملفان بالرقم `0003`.
- **لا يعمل تلقائيًا مع `npm run build`.**
- لا تشغّل `npm run db:migrate` على قاعدة الإنتاج دون مراجعة وموافقة صريحة.

## قبل أي تغيير في قاعدة البيانات
1. اقرأ الجداول الحالية في Supabase وقارنها بملفات `supabase/*.sql`.
2. شغّل Security Advisors (قراءة فقط) وراجع سياسات RLS.
3. اجعل التغيير ملف SQL جديدًا ومرقّمًا في PR مستقلة، ولا تنفّذه إلا بعد الموافقة.

## أسئلة مفتوحة تحتاج جواب المالك
- أي مشروع Supabase هو الإنتاج، وهل نُفّذت عليه ملفات `migrations/`؟
- هل `ADMIN_BOOTSTRAP_CODE` و`ADMIN_SESSION_SECRET` مستعملان فعليًا؟
