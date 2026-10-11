/**
 * Game catalogue shared by the home page and the game pages.
 * Add a game here, and set live to true once its room is ready.
 */

export type Category = "words" | "talk" | "strategy" | "classic";

export type GameCard = {
  id: string;
  title: string;
  icon: string;
  players: string;
  category: Category;
  blurb: string;
  /** Optional screenshot of the game, shown on the game page. */
  image?: string;
  /** Only published games link to a room. The rest show as "قريبًا". */
  live: boolean;
  /** Short rules shown in the "كيف تُلعب؟" sheet. Only live games have them. */
  howTo?: { goal: string; minutes: string; steps: string[] };
};

/** Game catalogue for the home grid. Add a game here and set live to true once its room is ready. */
export const GAMES: GameCard[] = [
  {
    id: "tactical-grid",
    title: "تحديات العش",
    icon: "🎲",
    players: "2-12",
    category: "classic",
    blurb: "لوحة أسئلة على الشاشة الكبيرة. اختاروا التصنيفات وتنافسوا على النقاط.",
    live: true,
    howTo: {
      goal: "اجمعوا أكبر عدد من النقاط بالإجابة على أسئلة التصنيفات.",
      minutes: "20 إلى 40 دقيقة",
      steps: [
        "اختاروا التصنيفات التي تريدون اللعب بها.",
        "يختار المضيف سؤالًا من اللوحة، ويظهر على الشاشة الكبيرة.",
        "أول من يضغط الجرس يجيب، والمضيف يحكم على الإجابة.",
        "تنتهي اللعبة عند انتهاء الأسئلة، ويفوز صاحب أعلى نقاط.",
      ],
    },
  },
  {
    id: "bluff-master",
    title: "سيد الخداع",
    icon: "🎭",
    players: "3-8",
    category: "strategy",
    blurb: "اكتبوا إجابات مزيفة مقنعة، وصوّتوا على الإجابة الحقيقية. من يخدع أكثر يكسب.",
    live: true,
    howTo: {
      goal: "اكتبوا إجابات مزيفة مقنعة، وصوّتوا على الإجابة الحقيقية.",
      minutes: "15 إلى 25 دقيقة",
      steps: [
        "يظهر سؤال على الشاشة، وكل لاعب يكتب إجابة مزيفة من جواله.",
        "تظهر الإجابات كلها مختلطة مع الإجابة الحقيقية، فصوّتوا على ما تظنونه صحيحًا.",
        "تكسبون نقاطًا عندما تختارون الإجابة الصحيحة، وتكسبون أيضًا عندما يصوّت غيركم لإجابتكم المزيفة.",
        "يتكرر الدور بأسئلة جديدة، ويفوز من يجمع أكثر النقاط.",
      ],
    },
  },
  {
    id: "heads-up",
    title: "هل تعرف",
    icon: "🧠",
    players: "2-10",
    category: "words",
    blurb: "اختاروا فريقين. مخمِّن يتوسط الفريق، وزملاؤه يصفون الكلمة دون أن يقولوها.",
    live: true,
    howTo: {
      goal: "مخمِّن يتوسط فريقه، وزملاؤه يصفون الكلمة دون أن يقولوها.",
      minutes: "15 إلى 30 دقيقة",
      steps: [
        "تُقسَم الغرفة إلى فريقين، ويختار المضيف التصنيفات قبل البداية.",
        "يمسك المخمِّن الجوال على جبهته، أو يمسكه زميله، فلا يرى الكلمة.",
        "يصف زملاؤه الكلمة الظاهرة على جوالاتهم دون أن يقولوها.",
        "عند الإجابة الصحيحة يكسب فريق المخمِّن نقطة، ويمكن تخطي الكلمة. لكل دور 60 ثانية.",
        "يفوز الفريق الأعلى نقاطًا قبل انتهاء الكلمات.",
      ],
    },
  },
  {
    id: "word-guess",
    title: "خمّن الكلمة",
    icon: "🔠",
    players: "1-10",
    category: "words",
    blurb: "كلمة خماسية في ست محاولات، والجميع يتابع النتيجة على الشاشة.",
    live: false,
  },
  {
    id: "outsider",
    title: "برة السالفة",
    icon: "👀",
    players: "3-8",
    category: "talk",
    blurb: "لاعب واحد لا يعرف الموضوع. هل تكشفه قبل أن يكشف نفسه؟",
    live: true,
    howTo: {
      goal: "لاعب واحد لا يعرف الموضوع. هل تكشفونه قبل أن يكشف نفسه؟",
      minutes: "10 إلى 20 دقيقة",
      steps: [
        "يحصل كل لاعب على الموضوع والكلمة، إلا لاعبًا واحدًا هو برة السالفة.",
        "يصف الجميع الكلمة بتلميحات، وبرة السالفة يحاول أن يتظاهر بأنه يعرفها.",
        "صوّتوا على من تظنونه برة السالفة.",
        "إن انكشف، يحاول أن يخمّن الكلمة ليفوز. وإن لم ينكشف، يكسب نقاطه.",
      ],
    },
  },
  {
    id: "secret-code",
    title: "الأسماء السرية",
    icon: "🕵️",
    players: "4-10",
    category: "strategy",
    blurb: "فريقان يتنافسان بتلميحات كلمة واحدة لكشف الكلمات.",
    live: false,
  },
  {
    id: "one-word",
    title: "كلمة واحدة",
    icon: "🤝",
    players: "3-8",
    category: "words",
    blurb: "تلميح واحد فقط لكل كلمة، وإذا تكررت التلميحات تُلغى.",
    live: false,
  },
  {
    id: "social-mafia",
    title: "المافيا",
    icon: "🔪",
    players: "5-14",
    category: "strategy",
    blurb: "المواطنون ضد المافيا. من يكذب ومن يصدق؟",
    live: true,
    howTo: {
      goal: "المواطنون ضد المافيا. من يكذب ومن يصدق؟",
      minutes: "20 إلى 35 دقيقة",
      steps: [
        "يحصل كل لاعب على دور سري يظهر على جواله فقط، وتحتاجون 5 لاعبين على الأقل.",
        "في الليل: المافيا تختار ضحية، والطبيب يحمي لاعبًا، والمحقق يكشف لاعبًا. اغمضوا أعينكم.",
        "في النهار: يناقش الجميع ويتهم بعضهم بعضًا، ثم يصوّتون لإقصاء لاعب.",
        "يفوز المواطنون إذا أُقصيت كل المافيا، وتفوز المافيا إذا تساوى عددها مع الباقين.",
      ],
    },
  },
];

/** Reads a range such as "3-8" as min 3 and max 8. */
export function playerRange(players: string) {
  const [min, max] = players.split("-").map(Number);
  return { min, max: max ?? min };
}

export function fitsPlayers(game: GameCard, key: "any" | 2 | 4 | 6 | 8) {
  if (key === "any") return true;
  const { min, max } = playerRange(game.players);
  if (key === 8) return max >= 8;
  return min <= key && key <= max;
}

export const CATEGORY_LABELS: Record<Category, string> = {
  words: "كلمات",
  talk: "حوار وتخمين",
  strategy: "استراتيجية",
  classic: "كلاسيكية",
};

/** Public address of the site, used where an absolute URL is required. */
export const SITE_URL = "https://al3sh.app";

export function getGame(slug: string): GameCard | undefined {
  return GAMES.find((game) => game.id === slug);
}
