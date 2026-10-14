# معاينة تحسينات واجهة المحكمة

**الفرع:** `preview/court-ux`

## ما أُضيف في هذا الفرع

1. `src/lib/court-phase-guide.ts`
   - تعليمات لكل دور في كل مرحلة
   - اقتراحات أسئلة حسب الدور
   - ترتيب وتسميات المراحل

2. `src/components/court-phase-bar.tsx`
   - `CourtPhaseBar` شريط تقدم المراحل + المؤقت + من على المنصة
   - `CourtPhaseHint` بطاقة «دورك الآن»
   - `CourtQuestionSuggestions` اقتراحات أسئلة

## ما هو موجود أصلًا في `court.tsx` (الإنتاج)

- مراحل: intro / evidence / question / closing / vote / verdict / over
- انتقال تلقائي عبر `useAutoTick` + `court_tick` عند تفعيل `settings.auto`
- اعتراضات بحالات pending/accepted/rejected
- منصة `stand` وطابور أسئلة
- سؤال ذهبي للمحلفين
- أهداف الأدوار ونقاط النهاية
- أصوات واهتزاز

## الربط التالي (لا يُكسر الإنتاج حتى يُدمج بحذر)

في شاشات المضيف/اللاعب داخل `src/components/court.tsx`:

```tsx
import { CourtPhaseBar, CourtPhaseHint, CourtQuestionSuggestions } from "@/components/court-phase-bar";
import { phaseGuide, suggestQuestions } from "@/lib/court-phase-guide";

// شريط أعلى الشاشة
<CourtPhaseBar phase={state.phase} leftSeconds={left} standName={standPlayerName} />

// على جوال اللاعب
<CourtPhaseHint text={phaseGuide(card.kind, state.phase)} />

// أثناء الاستجواب
<CourtQuestionSuggestions items={suggestQuestions(card.kind, state.stage)} />
```

## Vercel

افتح Preview Deployment لفرع `preview/court-ux` من لوحة Vercel.
الملفات الجديدة آمنة للبناء حتى قبل ربطها في `court.tsx`.
