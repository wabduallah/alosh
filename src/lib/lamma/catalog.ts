export type PlayMode = "competitive" | "coop" | "teams" | "social";

export const CATALOG = [
  { id: "mobile", ar: "ألعاب الجوال", en: "Phones", icon: "Smartphone", sort: 1 },
  { id: "competitive", ar: "تنافسية", en: "Competitive", icon: "Swords", sort: 2 },
  { id: "coop", ar: "تعاونية", en: "Co-op", icon: "Handshake", sort: 3 },
  { id: "teams", ar: "فرق", en: "Teams", icon: "Users", sort: 4 },
  { id: "trivia", ar: "أسئلة وذكاء", en: "Trivia", icon: "Brain", sort: 5 },
  { id: "words", ar: "كلمات", en: "Words", icon: "Type", sort: 6 },
  { id: "act", ar: "تمثيل وتخمين", en: "Act & guess", icon: "Drama", sort: 7 },
  { id: "social", ar: "اجتماعية", en: "Social", icon: "Laugh", sort: 8 },
  { id: "quick", ar: "سريعة", en: "Quick", icon: "Timer", sort: 9 },
  { id: "family", ar: "عائلية", en: "Family", icon: "House", sort: 10 },
] as const;

export type CatalogId = (typeof CATALOG)[number]["id"];

type Profile = {
  category: CatalogId;
  mode: PlayMode;
  dmin: number;
  dmax: number;
  rulesAr: string;
  rulesEn: string;
  howAr: string;
  howEn: string;
};

const how = `يدخل كل لاعب من جواله، والتلفزيون يعرض الجولة.
المضيف ينشئ الغرفة ويعرض الرمز أو الباركود.
يبدأ المضيف الجولة من الشاشة الكبيرة.
كل لاعب يجاوب من جواله.
إذا جاوب الجميع تُغلق الجولة وتُحسب النقاط.
أعلى مجموع في نهاية اللعبة يفوز.`;

const howEn = `Each player joins from a phone. The TV shows the round.
The host opens the room and shares the code or QR.
The host starts the round on the big screen.
Everyone answers on their phone.
When everyone has answered, the round closes and scores.
The highest total at the end wins.`;

const quizRules = `الإجابة الصحيحة تأخذ نقاط الجولة.
الإجابة الخاطئة أو الفارغة لا تأخذ نقاطًا.
لا يُحتسب إلا جواب واحد لكل لاعب في الجولة.
التعادل في المجموع يبقى تعادلًا على المنصة.`;

const quizRulesEn = `A correct answer scores the round.
A wrong or empty answer scores nothing.
One answer per player each round.
A tied total stays a tie on the podium.`;

function p(
  category: CatalogId,
  mode: PlayMode,
  dmin: number,
  dmax: number,
  rulesAr = quizRules,
  rulesEn = quizRulesEn,
): Profile {
  return { category, mode, dmin, dmax, rulesAr, rulesEn, howAr: how, howEn };
}

export const PROFILES: Record<string, Profile> = {
  "letter-names": p(
    "words",
    "competitive",
    5,
    15,
    `تبدأ الإجابة بالحرف الظاهر.
الإجابة الفريدة تأخذ نقاطًا أكثر من المكررة.
الإجابة خارج الحرف أو الفارغة لا تأخذ نقاطًا.
أعلى مجموع في نهاية الجولات يفوز.`,
    `Each answer must start with the shown letter.
A unique answer scores more than a repeated one.
An off-letter or empty answer scores nothing.
The highest total after the rounds wins.`,
  ),
  general: p("trivia", "competitive", 8, 15),
  "true-false": p("quick", "competitive", 5, 10),
  fastest: p("quick", "competitive", 5, 12, `الإجابة الصحيحة السريعة تأخذ نقاطًا أكثر.
الإجابة الخاطئة لا تأخذ نقاطًا.
إذا تساوى الوقت تُحسب النقاط كما هي.`, `A faster correct answer scores more.\nA wrong answer scores nothing.`),
  "who-knows": p("social", "social", 8, 15, `واحد يجاوب عن نفسه، والبقية يحاولون مطابقته.
المطابقة تأخذ نقاطًا.
لا توجد إجابة صحيحة خارج ما قاله الشخص.`, `One player answers about themselves. The others try to match.\nA match scores. There is no outside right answer.`),
  "most-likely": p("social", "social", 8, 15, `التصويت للاعبين في الغرفة فقط.
لا تصوت لنفسك.
الأكثر أصواتًا يأخذ نقاط الجولة.`, `Vote only for people in the room.\nYou cannot vote for yourself.\nThe most votes score the round.`),
  "guess-character": p("act", "competitive", 8, 15),
  "guess-picture": p("act", "competitive", 8, 15),
  proverb: p("words", "competitive", 8, 18, `الإجابة القريبة من المثل تُحتسب.
الإملاء البعيد لا يأخذ نقاطًا.`, `A close proverb counts.\nA far spelling does not score.`),
  "complete-word": p("words", "competitive", 8, 15),
  "would-you": p("social", "social", 6, 12, `لا توجد إجابة خاطئة.
الشاشة تعرض انقسام الغرفة فقط.`, `There is no wrong answer.\nThe screen only shows the split.`),
  family: p("family", "social", 10, 20),
  "family-feud": p("family", "competitive", 10, 20, `الإجابة الأشهر تأخذ نقاطًا أكثر.
الإجابة المكررة تأخذ نصف النقاط.
الإجابة خارج القائمة لا تأخذ نقاطًا.`, `The more common answer scores more.\nA repeated answer scores half.\nAn answer off the list scores nothing.`),
  saudi: p("trivia", "competitive", 8, 15),
  football: p("trivia", "competitive", 8, 15),
  screen: p("trivia", "competitive", 8, 15),
  videogames: p("trivia", "competitive", 8, 15),
  kids: p("family", "social", 6, 12),
  "truth-dare": p("social", "social", 8, 15, `يختار اللاعب صراحة أو تحديًا.
المضيف يستطيع إضافة نقاط إذا نُفّذ التحدي.`, `A player picks truth or dare.\nThe host can add points if the dare is done.`),
  friends: p("social", "social", 8, 15),
  animals: p("family", "competitive", 6, 12),
  colors: p("family", "social", 5, 10),
  "math-dash": p("quick", "competitive", 5, 10),
  capitals: p("trivia", "competitive", 8, 15),
  council: p("social", "social", 8, 15, `التصويت لشخص في الغرفة.
الأكثر أصواتًا يفوز بالجولة.`, `Vote for someone in the room.\nThe most votes win the round.`),
  kitchen: p("trivia", "competitive", 8, 15),
  science: p("trivia", "competitive", 8, 15),
  geo: p("trivia", "competitive", 8, 15),
  music: p("trivia", "competitive", 8, 15),
  cars: p("trivia", "competitive", 8, 15),
  riddles: p("words", "competitive", 8, 15),
  "this-or-that": p("social", "social", 5, 10, `خياران، ولا إجابة خاطئة.`, `Two choices, and neither is wrong.`),
};

export function profileFor(id: string): Profile {
  return PROFILES[id] ?? p("trivia", "competitive", 8, 15);
}
