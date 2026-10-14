# ربط تحسينات المحكمة — فرع `preview/court-ux-2`

## الملفات الجديدة
- `src/lib/court-phase-guide.ts` — تعليمات الدور × المرحلة + اقتراحات أسئلة
- `src/components/court-phase-bar.tsx` — شريط المراحل + تلميح + اقتراحات
- `src/components/court-wired.tsx` — لوحات مضيف/لاعب/TV مغلفة بالتحسينات

## تفعيل في المسارات (سطر واحد لكل ملف)

```diff
- import { CourtHostPanel } from "@/components/court";
+ import { CourtHostPanel } from "@/components/court-wired";
```

نفس التغيير لـ:
- `src/routes/host/$code.tsx` → CourtHostPanel
- `src/routes/room/$code.tsx` → CourtPlayerPanel
- `src/routes/tv/$code.tsx` → CourtTv

## ملاحظة
الفرع `preview/court-ux` تالف جزئيًا (حُذف ملف المضيف بالخطأ). استخدم **`preview/court-ux-2`** فقط.
