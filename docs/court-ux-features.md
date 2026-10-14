# تحسينات المحكمة — `preview/court-ux-2`

## ما أُضيف

### 1) لوحة المنصة + القواعد
- `CourtStandBoard`: من على المنصة / من يستجوب (للجميع)
- `CourtObjectionGuide`: قواعد الاعتراض للمدعي والمحامي
- `CourtAnswerRules`: قواعد الإجابة للمتهم والشاهد
- دليل أدوار محدّث في `court-phase-guide.ts`

### 2) تصعيد تلقائي للمنصة
- في `court-wired.tsx` → `useAutoStand`
- يعمل عند `settings.auto === true` ومرحلة `question`
- يستدعي `court_stand` كل ~45 ثانية (متهمون ثم شهود)
- يتوقف أثناء اعتراض معلّق

### 3) مولّد قضايا بمراجعة المضيف
- `generateCourtCaseDraft` + `CourtCaseAiReview`
- يظهر على شاشة المضيف **قبل** بدء الجلسة
- خيار «متهم ثانٍ»
- **لا اعتماد تلقائي في اللعب** دون مراجعة

### 4) محتوى أدلة أعمق + متهم ثانٍ
- `supabase/court_cases_v4.sql`
  - قضية `shadow-transfer-dual` (متهمان)
  - قضية `museum-gap` (براءة، أدلة متدرجة)

## تشغيل SQL على Production
```bash
# من لوحة Supabase SQL Editor أو CLI
# نفّذ: supabase/court_cases_v4.sql
```

## الربط
المسارات تستورد من `@/components/court-wired`.
