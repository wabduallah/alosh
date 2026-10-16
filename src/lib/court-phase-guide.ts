/** دليل المرحلة × الدور للعبة المحكمة + أسئلة مقترحة. النصوص الكاملة في court-guide.ts. */
import { ROLE_GUIDES, type GuidePhase } from "@/lib/court-guide";

export type CourtPhaseKey =
  | "intro"
  | "evidence"
  | "question"
  | "closing"
  | "vote"
  | "verdict"
  | "over";

export type CourtRoleKey =
  | "accused"
  | "prosecutor"
  | "lawyer"
  | "detective"
  | "witness"
  | "juror";

const PHASE_ORDER: CourtPhaseKey[] = [
  "intro",
  "evidence",
  "question",
  "closing",
  "vote",
  "verdict",
  "over",
];

export const PHASE_LABELS: Record<CourtPhaseKey, string> = {
  intro: "القضية",
  evidence: "الأدلة",
  question: "الاستجواب",
  closing: "المرافعة",
  vote: "التصويت",
  verdict: "الحكم",
  over: "الحقيقة",
};

/** One line for the current phase: the first step of the role's guide (court-guide.ts). */
export function phaseGuide(role: CourtRoleKey | string | undefined, phase: CourtPhaseKey | string | undefined): string {
  if (!role || !phase) return "تابع الشاشة وتعليمات القاضي.";
  const doc = ROLE_GUIDES[role as CourtRoleKey];
  if (!doc) return "تابع المرحلة الحالية على الشاشة.";
  if (phase === "intro") return doc.first[0];
  return doc.phases[phase as GuidePhase]?.[0] ?? "تابع المرحلة الحالية على الشاشة.";
}

export function phaseIndex(phase: CourtPhaseKey | string | undefined): number {
  if (!phase) return 0;
  const i = PHASE_ORDER.indexOf(phase as CourtPhaseKey);
  return i < 0 ? 0 : i;
}

export function allPhases(): CourtPhaseKey[] {
  return [...PHASE_ORDER];
}

export function suggestQuestions(role: CourtRoleKey | string | undefined, stage?: number): string[] {
  const n = stage ?? 1;
  if (role === "prosecutor") {
    return [
      "أين كنت بالضبط في وقت الواقعة؟",
      "من يمكنه تأكيد روايتك؟",
      n > 1 ? `كيف تفسّر التناقض مع دليل الجولة ${n}؟` : "ما علاقتك بالمتضرر؟",
    ];
  }
  if (role === "lawyer") {
    return [
      "هل رأيت المتهم فعلاً أم استنتجت ذلك؟",
      "ألم يكن هناك شخص آخر في المكان؟",
      "هل يمكن أن يكون الدليل ناقصًا أو مضللاً؟",
    ];
  }
  if (role === "detective") {
    return [
      "ما التسلسل الزمني الذي يتوافق مع كل الأدلة؟",
      "أي دليل يعتمد على شهادة غير مؤكدة؟",
      "أين الفجوة الأوضح في القصة؟",
    ];
  }
  if (role === "juror") {
    return [
      "هل يمكنك تكرار ما قلته عن الوقت؟",
      "هل أنت متأكد أم تظن فقط؟",
      "هل سمعت ذلك بنفسك أم نقلاً عن غيرك؟",
    ];
  }
  return ["ماذا رأيت أو سمعت بنفسك؟", "متى حدث ذلك بالضبط؟", "هل هناك تفاصيل لم تُذكر بعد؟"];
}
