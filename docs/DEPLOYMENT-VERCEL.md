# نشر العش على Vercel (المنصة الفعلية)

> يحلّ هذا الملف محل ما في `DEPLOYMENT.md` من شرح Cloudflare Pages. الملف القديم لم يُعدَّل ولم يُحذف.

## الوضع الحالي (تم التحقق منه من Vercel)
- المشروع: `alosh` ضمن فريق `alosh` (إطار العمل: tanstack-start، Node 22.x).
- الإنتاج يُبنى من الفرع `main`؛ آخر نشر إنتاجي ناجح (READY) على الـ commit `2a6c187` (PR #119).
- فروع المعاينة (مثل `preview/*`) تُنشر تلقائيًا كمعاينات.
- النطاقات المسجلة في Vercel: `al3sh.app` و`www.al3sh.app` و`alosh.vercel.app`. **لم يظهر `al3sh.com` بين نطاقات المشروع**؛ تحقق من أين يُوجَّه.

## إعدادات البناء
- `vercel.json` يحدد فقط: `installCommand = npm install --omit=dev --no-audit --no-fund`.
- أمر البناء: `npm run build` (Nitro بإعداد `vercel` افتراضيًا؛ يتحول إلى Cloudflare فقط عند وجود `CF_PAGES`).
- `npm run build` **لا يشغّل migrations**. أمر `npm run db:migrate` يدوي فقط.

## متغيرات البيئة (أسماء فقط — لا تضع القيم في Git)
| المتغير | ملاحظة |
|---|---|
| `DATABASE_URL` | سري، للسيرفر فقط (Session pooler، منفذ 5432) |
| `VITE_SUPABASE_URL` | عام، يلزم وقت البناء |
| `VITE_SUPABASE_ANON_KEY` | عام، يلزم وقت البناء |
| `ADMIN_BOOTSTRAP_CODE`, `ADMIN_SESSION_SECRET` | مذكوران في `.env.example`؛ تأكد هل يستعملهما الكود فعليًا قبل ضبطهما |
| `XAI_API_KEY` | اختياري، سري، للسيرفر فقط |
| `VITE_CF_BEACON_TOKEN` | اختياري |

## قواعد العمل
1. لا تعدّل `main` مباشرة؛ كل تغيير في فرع ثم PR.
2. قبل الدمج: افتح رابط المعاينة التي ينشئها Vercel للفرع واختبرها على الجوال والكمبيوتر والتلفزيون.
3. للتراجع: Vercel → Deployments → اختر نشرًا سابقًا ناجحًا → Promote/Rollback.
