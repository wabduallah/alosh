# تحسينات المحكمة — فرع بلا تعارض مع main

## الملفات الجديدة
- `src/lib/court-rules.ts`
- `src/lib/court-phase-guide.ts`
- `src/lib/court-case-ai.ts`
- `src/components/court-phase-bar.tsx`
- `src/components/court-stand-board.tsx`
- `src/components/court-case-review.tsx`
- `src/components/court-wired.tsx`
- `supabase/court_cases_v4.sql`

## تفعيل الاستيرادات
في المسارات الثلاثة استبدل مصدر الاستيراد:

```ts
import { CourtHostPanel } from "@/components/court-wired";
import { CourtPlayerPanel } from "@/components/court-wired";
import { CourtTv } from "@/components/court-wired";
```

## SQL
نفّذ `supabase/court_cases_v4.sql` على Supabase.
