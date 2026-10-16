# ملفات Supabase

كل ملفات SQL الخاصة بالموقع مرتّبة في `manifest.txt`، وكل ملف يُسجَّل عند تشغيله في جدول `app_migrations`.

## إضافة ملف جديد

1. اكتب الملف في `supabase/`، وأضف اسمه في **آخر** `manifest.txt`.
2. اختم الملف بتسجيل نفسه:
   ```sql
   create table if not exists public.app_migrations (name text primary key, applied_at timestamptz not null default now());
   alter table public.app_migrations enable row level security;
   revoke all on public.app_migrations from anon, authenticated;
   insert into public.app_migrations (name) values ('اسم_الملف.sql') on conflict do nothing;
   ```
3. أضف اسمه إلى `REQUIRED_SQL` في `src/lib/schema.ts`. لوحة الإدارة تُنبّه المدير ما دام لم يُشغَّل.
4. شغّل `npm run db:replay`: يبني قاعدة فارغة من الصفر بكل الملفات، ثم يشغّل اختبارات `tests/sql/*.test.sql`.

## التشغيل على مشروع الموقع

تأكد أن المشروع هو **wabduallah's Project** (`vlvcztiuwjvdomghedcz`)، لا copper-coin.

- **بأمر واحد (من جهاز فيه المشروع):**
  ```sh
  SUPABASE_DB_URL='postgresql://…' npm run db:supabase -- --dry-run   # ماذا سيُشغَّل
  SUPABASE_DB_URL='postgresql://…' npm run db:supabase                # تشغيل الناقص بالترتيب
  ```
  الرابط من Supabase ← Project Settings ← Database ← Connection string. الأمر لا يستعمل `DATABASE_URL` أبدًا.
  كل ملف في معاملة: إذا فشل لا يتغيّر شيء منه.
- **من SQL Editor:** `npm run db:bundle -- court_v7.sql` يكتب `supabase/bundle.sql` (ذلك الملف وكل ما بعده)، فتلصقه مرة واحدة.

## ملاحظات

- `drop_games_tables.sql` و `clear_games_settings.sql` حذف نهائي، وليست في `manifest.txt`. لا تشغّلها إلا عن قصد.
- `schema.sql` مخطط Better Auth القديم، وليس جزءًا من قاعدة الموقع.
- جداول الألعاب الأولى (برا السالفة، سيد الخداع، هل تعرف، المافيا) في `migrations/0019`–`0023` في جذر المشروع، وهي مُدرجة في `manifest.txt`.
- أمر `npm run db:migrate` القديم يخص مجلد `migrations/` و `DATABASE_URL` (قالب المشروع)، وليس قاعدة Supabase هذه.
