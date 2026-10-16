/** دليل المرحلة × الدور للعبة المحكمة + أسئلة مقترحة. */

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

const GUIDE: Record<CourtRoleKey, Partial<Record<CourtPhaseKey, string>>> = {
  accused: {
    intro: "استمع للقصة. حضّر دفاعك دون كشف ما لا يلزم.",
    evidence: "راقب الأدلة. سجّل ما يضعف التهمة أو يدعم براءتك.",
    question: "أجب بوضوح. لا تتطوع بمعلومات تضرّك بلا داعٍ. التزم بقواعد الإجابة.",
    closing: "استمع للمرافعات. جهّز جملة أخيرة قصيرة إن سُمح لك.",
    vote: "المتهم لا يصوّت. انتظر الحكم.",
    verdict: "انتظر إعلان الحكم.",
    over: "ستُكشف الحقيقة وبطاقة دورك.",
  },
  prosecutor: {
    intro: "افهم القصة. حدّد نقطة اتهام واضحة مرتبطة بدليل.",
    evidence: "اربط كل دليل بالاتهام. حضّر أسئلة قصيرة للمتهم والشهود.",
    question: "اسأل مباشرة. استخدم الاعتراض عند التضليل أو الخروج عن الموضوع (العدد في زر الاعتراض).",
    closing: "لخّص الأدلة في أقل من دقيقة. اطلب الإدانة بثقة.",
    vote: "صوّت مذنب إن اقتنعت بالأدلة.",
    verdict: "انتظر نتيجة التصويت.",
    over: "راجع إن أصاب الحكم الحقيقة.",
  },
  lawyer: {
    intro: "ابحث عن ثغرات القصة والشك المعقول منذ البداية.",
    evidence: "ارصد تناقض الأوقات والروايات. كل ثغرة سلاح في المرافعة.",
    question: "اضغط على التناقضات. اعتراض عند الافتراض غير المثبت أو الضغط غير العادل (العدد في زر الاعتراض).",
    closing: "ركّز على الشك المعقول. اطلب البراءة بجمل قصيرة قوية.",
    vote: "صوّت بريء إن بقي شك معقول أو كان ذلك هدف دورك.",
    verdict: "انتظر الحكم.",
    over: "ستُكشف الحقيقة ونجاح دفاعك.",
  },
  detective: {
    intro: "استمع كمن يبني خطًا زمنيًا لا قصة عاطفية.",
    evidence: "رتّب الأدلة زمنيًا. أين الفجوة؟ أي دليل يعتمد على شهادة فقط؟",
    question: "اسأل لتأكيد أو نفي التسلسل. لا تقاطع بلا هدف؛ سؤال واحد واضح أفضل من خمسة مشتتة.",
    closing: "لخّص ما ثبت وما بقي غامضًا بصوت هادئ.",
    vote: "صوّت حسب ما تدعمه الأدلة لا الانطباع الأول.",
    verdict: "انتظر الحكم.",
    over: "قارن استنتاجك بالحقيقة.",
  },
  witness: {
    intro: "راجع معلومتك السرية فقط. لا تشاركها قبل السؤال.",
    evidence: "استمع. لا تكشف سرك أثناء عرض الأدلة.",
    question: "أجب عمّا رأيت أو سمعت فقط. «لا أعلم» أفضل من الاختلاق.",
    closing: "استمع. تدخلك محدود الآن.",
    vote: "صوّت بصدق حسب ما سمعت في الجلسة.",
    verdict: "انتظر الحكم.",
    over: "ستُكشف البطاقات والحقيقة.",
  },
  juror: {
    intro: "استمع بدون انحياز مسبق.",
    evidence: "دوّن ذهنيًا ما يقوي الإدانة أو البراءة.",
    question: "لك سؤال ذهبي واحد — استخدمه بحكمة على من يملك معلومة حاسمة.",
    closing: "وزّن حجج الطرفين بهدوء.",
    vote: "صوّت مذنب أو بريء. صوتك الصحيح = 100 نقطة.",
    verdict: "انتظر إعلان الحكم.",
    over: "راجع قرارك مقابل الحقيقة.",
  },
};

export function phaseGuide(role: CourtRoleKey | string | undefined, phase: CourtPhaseKey | string | undefined): string {
  if (!role || !phase) return "تابع الشاشة وتعليمات المضيف.";
  const byRole = GUIDE[role as CourtRoleKey];
  if (!byRole) return "تابع المرحلة الحالية على الشاشة.";
  return byRole[phase as CourtPhaseKey] ?? "تابع المرحلة الحالية على الشاشة.";
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
