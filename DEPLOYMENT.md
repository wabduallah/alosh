# نشر العش على رابط مجاني

النتيجة رابط مثل `https://alosh.pages.dev`. لا تحتاج شراء دومين الآن.

## 1. حساب GitHub

1. ادخل إلى [github.com](https://github.com) وأنشئ حسابًا.
2. اضغط **New repository**.
3. سمّه مثلًا `alosh`. اختر Private أو Public. لا تضف README من GitHub.

## 2. ارفع ملفات المشروع

ارفع مجلد المشروع كاملًا ما عدا `node_modules` و`dist` و`.env`. ملف `.gitignore` يستبعدها.

من جهازك، داخل مجلد المشروع:

```bash
git init
git add .
git commit -m "نشر العش"
git branch -M main
git remote add origin https://github.com/wabduallah/alosh.git
git push -u origin main
```

## 3. إنشاء Supabase

1. ادخل إلى [supabase.com](https://supabase.com) وأنشئ مشروعًا مجانيًا.
2. احفظ كلمة مرور قاعدة البيانات.

## 4. تشغيل الجداول

1. من المشروع افتح **SQL Editor**.
2. انسخ كل محتوى الملف `supabase/schema.sql`.
3. الصقه واضغط **Run** مرة واحدة. إذا جرّبت ملفًا قديمًا وظهر خطأ عند `user`، احذف ما نُفّذ إن وُجد ثم شغّل ملف `supabase/schema.sql` الجديد كاملًا بدل الملف القديم.
4. إذا ظهرت رسالة نجاح، الجداول جاهزة.

## 5. نسخ المفاتيح

من **Project Settings → API**:

- Project URL → هذا هو `VITE_SUPABASE_URL`
- مفتاح `anon` `public` → هذا هو `VITE_SUPABASE_ANON_KEY`

من زر **Connect** اختر **Session pooler** والمنفذ **5432**، ثم انسخ رابط URI. هذا هو `DATABASE_URL`. لا تستخدم المنفذ 6543.

لا تنسخ مفتاح `service_role`. لا تضعه في الموقع.

## 6. إنشاء Cloudflare Pages

1. ادخل إلى [dash.cloudflare.com](https://dash.cloudflare.com) وأنشئ حسابًا مجانيًا.
2. Workers & Pages → **Create** → **Pages** → **Connect to Git**.
3. اختر مستودع `alosh`.

## 7. إعدادات البناء

| الحقل | القيمة |
|---|---|
| Framework preset | None |
| Build command | `npm run build` |
| Build output directory | `dist` |

## 8. Environment variables

قبل أول نشر، أضف في **Settings → Environment variables** للإنتاج والمعاينة:

- `DATABASE_URL`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

احفظ ثم ابدأ النشر. المتغيرات التي تبدأ بـ `VITE_` لازم تكون موجودة أثناء البناء.

## 9. الرابط

بعد انتهاء النشر يعطيك Cloudflare رابطًا مثل:

`https://alosh.pages.dev`

افتحه من الجوال والتلفزيون. أنشئ غرفة، وسيظهر باركود فيه هذا الرابط نفسه وليس localhost.

## 10. لوحة الإدارة

1. من Supabase افتح **SQL Editor**، والصق محتوى `supabase/admin_panel.sql` واضغط **Run** مرة واحدة. ثم شغّل `supabase/admin_v2.sql` بنفس الطريقة (الإحصاءات والإجابات المرجعية للحلبة؛ يحتاج ملفات الحلبة قبله).
2. من **Authentication → Users** اضغط **Add user**، واكتب بريد المدير وكلمة مرور، وفعّل **Auto Confirm User**.
3. في **SQL Editor** شغّل هذا السطر ببريد المدير:

   ```sql
   update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}' where email = 'admin@example.com';
   ```

4. افتح `/admin` وسجّل الدخول بالبريد وكلمة المرور. من التبويبات: الإحصاءات، والغرف (مباشرة)، والألعاب، وبنك الأسئلة، والكلمات والمواضيع، والاستيراد والجودة (CSV دخولًا وخروجًا، وفحص المكرر والناقص).

شاشة التلفزيون لأي غرفة على `/tv/رمز-الغرفة`، وتفتح من صالة الانتظار وشاشة المضيف بزر «افتح شاشة التلفزيون».

## ماذا يبقى يدويًا

- إنشاء حسابات GitHub وSupabase وCloudflare.
- لصق `schema.sql` مرة واحدة.
- وضع المتغيرات الثلاثة في Cloudflare.
- دومينك الخاص لاحقًا من إعدادات Cloudflare → Custom domains، بدون تغيير الكود.
- الدفع الحقيقي (Stripe) غير مفعّل. الألعاب المجانية تعمل. ألعاب Premium تبقى مغلقة حتى تضيف مفاتيح الدفع لاحقًا.
