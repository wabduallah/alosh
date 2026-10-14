/** مولّد مسودات قضايا للمحكمة — مراجعة المضيف مطلوبة قبل الاعتماد. */

export type GeneratedEvidence = {
  stage: number;
  title: string;
  text: string;
  icon: string;
  time?: string | null;
};

export type GeneratedRole = {
  key: string;
  kind: "accused" | "prosecutor" | "lawyer" | "detective" | "witness" | "juror";
  name: string;
  brief?: string;
  secret: string;
  later?: string;
  later_stage?: number;
  optional?: boolean;
  fallback?: string;
};

export type GeneratedCase = {
  slug: string;
  title: string;
  category: string;
  intro: string;
  difficulty: number;
  guilty: boolean;
  truth: string;
  evidence: GeneratedEvidence[];
  roles: GeneratedRole[];
  dualAccused: boolean;
  notes: string[];
};

const CATEGORIES = ["جريمة مالية", "اختفاء", "حادث عمل", "سرقة أثر", "قضية عائلية"];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function slugify(title: string) {
  return `ai-${Date.now().toString(36)}-${title.replace(/\s+/g, "-").slice(0, 24)}`;
}

export function generateCourtCaseDraft(opts?: { dualAccused?: boolean; difficulty?: number }): GeneratedCase {
  const dual = opts?.dualAccused ?? Math.random() < 0.45;
  const difficulty = opts?.difficulty ?? (dual ? 3 : pick([2, 3]));
  const category = pick(CATEGORIES);
  const guilty = Math.random() < 0.55;

  const titles: Record<string, string[]> = {
    "جريمة مالية": ["حساب الظل", "تحويل منتصف الليل", "عقد بلا توقيع"],
    اختفاء: ["آخر مكالمة", "باب المستودع", "قائمة المناوبة"],
    "حادث عمل": ["صمام معطل", "تقرير السلامة", "وردية الليل"],
    "سرقة أثر": ["خزانة العرض", "مفتاح النسخ", "زائر المعرض"],
    "قضية عائلية": ["وصية مشطوبة", "مفتاح الخزنة", "رسالة بلا طابع"],
  };

  const title = pick(titles[category] ?? ["قضية غامضة"]);
  const intro =
    category === "جريمة مالية"
      ? `في شركة متوسطة، اختفى مبلغ كبير من حساب تشغيلي. التحقيق يشير إلى من يملك صلاحية التحويل، لكن الجدول الزمني يتضارب مع شهادات المناوبة.`
      : category === "اختفاء"
        ? `اختفى موظف بعد نهاية ورديته. كاميرا واحدة فقط تعمل، وسجل الدخول يظهر حركتين في الوقت نفسه تقريبًا.`
        : category === "حادث عمل"
          ? `وقع حادث في الوردية الليلية. تقرير أولي يلوم الإهمال، لكن صيانة الصمام مؤجلة منذ أسابيع.`
          : category === "سرقة أثر"
            ? `اختفى قطعة أثرية من خزانة العرض بعد حفل افتتاح. المفاتيح محدودة، والزوار أكثر من المسجّلين.`
            : `نزاع على وصية وممتلكات. وثيقة جديدة ظهرت متأخرة، وتوقيتها يثير الشك.`;

  const evidence: GeneratedEvidence[] = [
    {
      stage: 1,
      icon: "📋",
      title: "السجل الرسمي",
      time: "21:10",
      text: "سجل النظام يُظهر عملية حساسة في 21:10 من جهاز داخل المبنى، لكن بصمة الدخول لنفس الحساب سُجّلت عند البوابة في 21:18.",
    },
    {
      stage: 1,
      icon: "🎥",
      title: "لقطة كاميرا",
      time: "21:12",
      text: "كاميرا الممر تُظهر شخصًا بغطاء رأس يمر بسرعة؛ الوجه غير واضح، والحقيبة تشبه حقيبة أحد الموظفين.",
    },
    {
      stage: 2,
      icon: "📱",
      title: "رسالة مؤجلة",
      time: "22:40",
      text: "رسالة وصلت متأخرة من رقم غير مسجّل: «أخّر التقرير إلى الصباح». لا يُعرف إن كانت تهديدًا أو تنسيقًا.",
    },
    {
      stage: 2,
      icon: "🧾",
      title: "تناقض المستند",
      time: null,
      text: "نسخة مطبوعة من التقرير تحمل توقيعًا، بينما النسخة الرقمية في الخادم بلا توقيع وبتعديل بعد منتصف الليل.",
    },
    {
      stage: 3,
      icon: "🔑",
      title: "المفتاح المكرر",
      time: "20:55",
      text: "سُجّل استعارة مفتاح غرفة حساسة قبل الحادث بربع ساعة، ثم إرجاعه بعد ساعة دون توقيع واضح للمستلم.",
    },
    {
      stage: 3,
      icon: "🧪",
      title: "أثر ثانوي",
      time: null,
      text: "وُجد أثر على مقبض الخزانة يطابق قفازًا طبيًا من صندوق مفتوح في غرفة الاستراحة — الصندوق متاح للجميع.",
    },
  ];

  if (difficulty >= 3) {
    evidence.push({
      stage: 2,
      icon: "⏱️",
      title: "فجوة زمنية",
      time: "21:15",
      text: "بين 21:14 و21:17 لا توجد أي حركة مسجّلة في السجل المركزي، رغم أن الشاهد يدّعي سماع خطوات في الممر في 21:16.",
    });
  }

  const roles: GeneratedRole[] = [
    {
      key: "accused-1",
      kind: "accused",
      name: dual ? "المتهم الأول" : "المتهم",
      brief: "الطرف الأساسي في الاتهام",
      secret: guilty
        ? "أنت تورطت جزئيًا: حاولت إخفاء خطأ أو تأخير بلاغ. لا تعترف مباشرة؛ ادفع الشك نحو ثغرات الإجراءات."
        : "أنت بريء من التهمة الأصلية، لكنك أخفيت تفصيلة محرجة (تأخير/خلاف) قد تُفهم ضدك.",
    },
    {
      key: "prosecutor",
      kind: "prosecutor",
      name: "المدعي العام",
      secret: "اربط العملية عند 21:10 بالمتهم عبر الصلاحيات. اضغط على تناقض أوقات الدخول.",
    },
    {
      key: "lawyer",
      kind: "lawyer",
      name: "المحامي",
      secret: "ابنِ الدفاع على الفجوة بين 21:10 و21:18 وعلى ضعف وضوح الكاميرا. الشك المعقول هدفك.",
    },
    {
      key: "detective",
      kind: "detective",
      name: "المحقق",
      secret: "رتّب الخط الزمني. اسأل عن المفتاح المكرر ومن فتح صندوق القفازات.",
      optional: true,
      fallback: "المحقق يلاحظ أن سجل المفاتيح ناقص التوقيع في نفس الليلة.",
    },
    {
      key: "witness-a",
      kind: "witness",
      name: "شاهد الممر",
      secret: "سمعت خطواتًا حوالي 21:16 لكنك لم ترَ الوجه. لست متأكدًا من هوية صاحب الحقيبة.",
      later: "تتذكر أن الإضاءة كانت خافتة بسبب عطل جزئي.",
      later_stage: 2,
    },
    {
      key: "witness-b",
      kind: "witness",
      name: "شاهد المناوبة",
      secret: "رأيت أحدًا عند البوابة قرب 21:18. قد يكون المتهم أو شخصًا يشبهه.",
      optional: true,
      fallback: "موظف المناوبة يؤكد ازدحامًا عند البوابة وصعوبة التعرف.",
    },
  ];

  if (dual) {
    roles.splice(1, 0, {
      key: "accused-2",
      kind: "accused",
      name: "المتهم الثاني",
      brief: "طرف ثانٍ في دائرة الشك",
      secret: guilty
        ? "أنت شريك صامت أو من نفّذ جزءًا من الخطة. ادفع الشك نحو المتهم الأول إن ضُغط عليك."
        : "أنت بريء، لكنك كنت في المكان الخطأ وحاولت حماية نفسك بقصة ناقصة.",
    });
  }

  const truth = guilty
    ? dual
      ? "الحقيقة: المتهمان تنسيقا على تأخير البلاغ وإخفاء أثر العملية؛ أحدهما نفّذ والآخر غطّى."
      : "الحقيقة: المتهم مذنب. استغل الصلاحية والفجوة الزمنية."
    : dual
      ? "الحقيقة: المتهمان بريئان من التهمة الأصلية. ثغرة النظام سمحت لطرف ثالث."
      : "الحقيقة: المتهم بريء. التناقضات ناتجة عن عطل سجل وخوف الشهود.";

  return {
    slug: slugify(title),
    title,
    category,
    intro,
    difficulty,
    guilty,
    truth,
    evidence,
    roles,
    dualAccused: dual,
    notes: [
      "مسودة مولَّدة للمراجعة — لا تُستخدم في الجلسة إلا بعد اعتماد المضيف.",
      dual ? "تتضمن متهمين اثنين." : "متهم واحد.",
      "الأدلة موزعة على 3 جولات مع أوقات متناقضة عمدًا.",
    ],
  };
}
