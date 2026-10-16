import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export type Category = "words" | "talk" | "strategy" | "classic";

export type GameCard = {
  id: string;
  title: string;
  icon: string;
  players: string;
  category: Category;
  blurb: string;
  /** The site has a room for this game (host, players, TV). Without one it can only show as «قريبًا». */
  live: boolean;
  /** Short rules shown in the "كيف تُلعب؟" sheet. Only live games have them. */
  howTo?: { goal: string; minutes: string; steps: string[] };
};

/**
 * The games as the site presents them: icon, colours, category, copy and rules.
 * Whether a game is offered, its order, name, blurb and player counts come from the
 * games table when it is reachable (see mergeCatalog), so the admin panel decides.
 */
export const CATALOG: GameCard[] = [
  {
    id: "alhalba",
    title: "الحلبة",
    icon: "🥊",
    players: "2-10",
    category: "talk",
    blurb: "تحدي المواجهة المباشرة والمزايدة! أجب أسرع وخاطر بنقاطك لتسيطر على الحلبة وتطيح بخصومك.",
    live: true,
    howTo: {
      goal: "زايد على عدد الإجابات التي تقدر تذكرها، وأثبتها قبل ما يخلص الوقت. لكل لاعب محاولات، ومن تخلص محاولاته يخرج من الحلبة.",
      minutes: "15 إلى 30 دقيقة",
      steps: [
        "المضيف يبدأ بالإعدادات المقترحة بضغطة، أو يفتح «إعدادات متقدمة»: طريقة اللعب (الكل ضد الكل، نزال ثنائي، فريقان)، والمحاولات والجولات، وطريقة مطابقة الإجابات، وسرعة الإجابة، وقاعدة الفوز، والجولة الجماعية، ومستوى المواضيع والتصنيفات.",
        "يظهر موضوع، مثل «دول تبدأ بحرف الميم». زايدوا من جوالاتكم: كم إجابة تقدر تكتب؟ أعلى مزايدة 15.",
        "أي لاعب يضغط «تحدي!» على صاحب أعلى مزايدة، أو ينتهي وقت المزايدة.",
        "صاحب المزايدة يكتب عدد إجاباته بالضبط، والوقت يكبر مع المزايدة (10 ثوانٍ + بضع ثوانٍ لكل إجابة). عند آخر إجابة تُطابَق كلها مرة واحدة، والإجابة القريبة من الصحيحة يحكم فيها الحَكَم.",
        "إذا نجح يكسب النقاط من المتحدّي، وإذا فشل يخسرها ويخسر محاولة. النقاط قد تنزل تحت الصفر، فالمزايدة الكبيرة لها ثمن.",
        "لكل لاعب ثلاث أوراق، كل ورقة مرة في المباراة: «مضاعفة» لنقاط الجولة، «تبديل الموضوع» أثناء المزايدة، و«سرقة» يكمل فيها المتحدّي الباقي إذا فشل صاحب المزايدة.",
        "كل من ليس في النزال يتوقع: ينجح أو يفشل؟ والتوقع الصحيح = 50 نقطة. ومن يخرج من الحلبة يصير مشجعًا يتوقع ويشارك في الجولات الجماعية.",
        "كل عدة جولات تأتي جولة جماعية: الكل يكتب لنفس الموضوع في دقيقة، وكل إجابة صحيحة ما كتبها غيرك = 100 نقطة.",
        "الفائز حسب ما يختار المضيف: صاحب أعلى نقاط، أو آخر من يبقى في الحلبة. وفي النهاية ملخص بأبرز اللحظات يمكن مشاركته.",
      ],
    },
  },
  {
    id: "tactical-grid",
    title: "تحديات العش",
    icon: "🎲",
    players: "2-12",
    category: "classic",
    blurb: "من 2 إلى 6 فرق، كل فريق يختار فئاته، ويصوّت على الإجابة من جوالاته على لوحة نقاط 200 و400 و600، مع وسائل مساعدة وفرصة سرقة.",
    live: true,
    howTo: {
      goal: "فرق تتسابق على لوحة أسئلة من فئات تختارها. الفريق الأعلى نقاطًا عند امتلاء اللوحة يفوز.",
      minutes: "30 إلى 45 دقيقة",
      steps: [
        "المضيف يقسّم اللاعبين من فريقين إلى 6 فرق (عش النسور، عش الصقور…) ويقدر يغيّر أسماءها، ويقدر يلعب معهم.",
        "كل فريق يختار فئاته (من 1 إلى 3)، فتكبر اللوحة مع كل فريق. في كل فئة 6 خانات: 200 و200 و400 و400 و600 و600.",
        "الفريق صاحب الدور يختار خانة من جواله أو من جهاز المضيف، ويظهر السؤال على الشاشة الكبيرة وفي الجوالات.",
        "لا أحد يرى الإجابة، ولا المضيف. الفريق يصوّت من جوالاته على واحد من 6 خيارات، أو صح وخطأ، والأكثر أصواتًا يُعتمد.",
        "إذا أخطأ الفريق أو انتهى الوقت، يُشطب خياره وتنتقل فرصة السرقة للفريق التالي بوقت أقصر، حتى يجرّب كل فريق. أسئلة صح وخطأ بلا سرقة.",
        "لكل فريق ثلاث وسائل مساعدة، كل واحدة مرة: «ضاعِف» للنقاط ×2، «جوابان» لمحاولة ثانية، و«وقت إضافي» 30 ثانية.",
        "ينتقل الدور بعد كل خانة، وتنتهي اللعبة عند امتلاء اللوحة.",
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
        "يحصل كل لاعب على دور سري يظهر على جواله فقط، وتحتاجون 5 لاعبين على الأقل غير الراوي. الراوي هو المضيف، أو لاعب يُختار بالقرعة فتظهر أزرار التحكم في جواله.",
        "يختار المضيف عدد المافيا والأدوار الإضافية ومؤقت النهار ومؤقت التصويت. الراوي يرى أدوار الجميع من بداية التوزيع.",
        "في الليل: المافيا تختار ضحية، والطبيب يحمي لاعبًا، والمحقق يكشف لاعبًا، والجاسوس (إن وُجد) يفتح عينه مع المافيا ليعرفهم. اغمضوا أعينكم.",
        "في النهار: يناقش الجميع ويتهم بعضهم بعضًا، ثم يصوّتون لإقصاء لاعب. عند التعادل يُعاد التصويت بين المتعادلين. يرى الجميع عدد الأصوات لكل لاعب، و«من صوّت على من» للراوي فقط. إذا انتهى مؤقت التصويت، يصوّت النظام عشوائيًا عن من لم يصوّت.",
        "أدوار إضافية اختيارية: الجاسوس حليف المافيا ولا يختار ضحية، والمهرّج يفوز إذا أقصوه، والعمدة صوته بصوتين، والحارس يموت بدلًا ممن يحرسه، والقنّاص له رصاصة واحدة في النهار، والعرّافة تعرف دور لاعب خرج مرة واحدة، والعاشقان يموتان معًا.",
        "من يخرج يتابع بصمت ويرى أدوار الجميع إذا سمح المضيف، ومن ينضم بعد البدء يدخل المباراة القادمة.",
        "يفوز المواطنون إذا أُقصيت كل المافيا، وتفوز المافيا إذا تساوى عددها (مع الجاسوس) مع الباقين. وفي النهاية ملخص لكل ليلة وأبرز اللحظات يمكن مشاركته.",
      ],
    },
  },
  {
    id: "court",
    title: "المحكمة",
    icon: "⚖️",
    players: "4-12",
    category: "talk",
    blurb: "قضية غامضة وأدلة تظهر بالتدريج. استجوبوا المتهم والشهود، وترافعوا، ثم احكموا: مذنب أم بريء؟",
    live: true,
    howTo: {
      goal: "اكشفوا حقيقة القضية بالأدلة والاستجواب، واحكموا بالعدل. وكل دور له طريقته في الفوز.",
      minutes: "20 إلى 30 دقيقة",
      steps: [
        "المضيف يختار قضية أو يتركها عشوائية، ويحدد مؤقتات الاستجواب والمرافعة والتصويت. القاضي هو النظام، والمضيف يدير الجلسة ويقدر يلعب معكم.",
        "تظهر القصة على الشاشة، ويصل كل لاعب في جواله دوره ومعلومته السرية: المتهم، المدعي العام، المحامي، الشهود، المحقق، والباقي محلّفون.",
        "تظهر الأدلة على جولات. بعد كل جولة استجواب: اسألوا المتهم والشهود، والمضيف يستدعي من يقف على المنصة. وبعض الأدوار تصلها معلومة جديدة في الجولة الثانية.",
        "للمدعي والمحامي زر «اعتراض!» مرتين في المباراة.",
        "يترافع المدعي العام، ثم يرد المحامي.",
        "يصوّت الجميع إلا المتهم: مذنب أم بريء؟ والتعادل لصالح المتهم.",
        "يُعلن الحكم ثم تُكشف الحقيقة وبطاقات الجميع. كل صوت صحيح 100 نقطة، والمتهم يكسب 300 إذا نجا، والمدعي والمحقق والشهود 200 إذا كان الحكم صحيحًا، والمحامي 200 إذا برّأ موكله و100 إذا كان الحكم صحيحًا.",
        "ليست كل قضية تنتهي بإدانة: في بعض القضايا المتهم بريء فعلًا.",
      ],
    },
  },
  {
    id: "hex-letters",
    title: "خلية الحروف",
    icon: "🔤",
    players: "2-10",
    category: "words",
    blurb: "لوحة خلايا سداسية لكل خلية حرف. فريقان يتسابقان بالجرس على الإجابة، والفائز بالخلية يقترب من وصل ضفتي اللوحة.",
    live: false,
  },
];

export const FILTERS: Array<{ key: "all" | Category; label: string }> = [
  { key: "all", label: "الكل" },
  { key: "words", label: "كلمات" },
  { key: "talk", label: "حوار وتخمين" },
  { key: "strategy", label: "استراتيجية" },
  { key: "classic", label: "كلاسيكية" },
];

/** How an evening starts, on the home page and every game page. */
export const START_STEPS = [
  {
    title: "أنشئوا غرفة",
    text: "اختاروا اللعبة من الأسفل، وتظهر لكم شاشة المضيف مع رمز الغرفة.",
  },
  {
    title: "انضموا من جوالاتكم",
    text: "امسحوا رمز QR أو اكتبوا رمز الغرفة، ولا حاجة لتسجيل.",
  },
  {
    title: "ابدأوا السهرة",
    text: "كل لاعب يلعب من جواله، والنتيجة والوقت يظهران على الشاشة الكبيرة.",
  },
];

/** A games-table row as the public site reads it. home_status and sort_order arrive with supabase/polish_v1.sql. */
export type DbGame = {
  slug: string;
  title_ar: string | null;
  description_ar: string | null;
  min_players: number | null;
  max_players: number | null;
  is_active: boolean;
  home_status?: "live" | "soon" | "hidden" | null;
  sort_order?: number | null;
  /** Filled for games added from the admin panel (supabase/admin_v4.sql). */
  icon?: string | null;
  category?: Category | null;
  how_to?: { goal?: string; minutes?: string; steps?: string[] } | null;
};

/** A game ready to show: the catalogue entry, with what the database says about it. */
export type GameEntry = GameCard & { soon: boolean; order: number };

const playersText = (min: number | null, max: number | null, fallback: string) =>
  min && max ? (min === max ? String(min) : `${min}-${max}`) : fallback;

/**
 * Joins the catalogue with the games table.
 *  - No database answer yet (first paint, or no connection): the catalogue as written.
 *  - A game is playable when it has a room on the site, is active, and its home status is «live».
 *  - Otherwise it shows as «قريبًا», unless the admin set it to «hidden».
 *  - Name, blurb and player counts come from the table when filled in (once the admin manages it).
 *  - Order: playable games first, then the admin's order, then the catalogue order.
 */
export function mergeCatalog(rows: DbGame[] | null): GameEntry[] {
  const index = new Map(CATALOG.map((g, i) => [g.id, i]));
  if (!rows) {
    return CATALOG.map((g, i) => ({ ...g, soon: !g.live, order: i })).sort((a, b) => Number(a.soon) - Number(b.soon) || a.order - b.order);
  }
  const bySlug = new Map(rows.map((r) => [r.slug, r]));
  const out: GameEntry[] = [];
  for (const card of CATALOG) {
    const row = bySlug.get(card.id);
    const status = row?.home_status ?? (row ? (row.is_active ? "live" : "soon") : "soon");
    if (status === "hidden") continue;
    const playable = card.live && !!row?.is_active && status === "live";
    // Until polish_v1.sql adds home_status, the table still holds the old names: keep the catalogue's copy.
    const managed = row && row.home_status !== undefined ? row : null;
    out.push({
      ...card,
      title: managed?.title_ar?.trim() || card.title,
      blurb: managed?.description_ar?.trim() || card.blurb,
      players: playersText(managed?.min_players ?? null, managed?.max_players ?? null, card.players),
      soon: !playable,
      order: row?.sort_order ?? 1000 + (index.get(card.id) ?? 0),
    });
  }
  // Games added from the admin panel: no room on the site yet, so they show as «قريبًا».
  for (const row of rows) {
    if (index.has(row.slug) || row.home_status === undefined || row.home_status === "hidden" || !row.title_ar?.trim()) continue;
    const steps = (row.how_to?.steps ?? []).filter((x) => typeof x === "string" && x.trim());
    out.push({
      id: row.slug,
      title: row.title_ar.trim(),
      icon: row.icon?.trim() || "🎲",
      players: playersText(row.min_players, row.max_players, "2-10"),
      category: row.category && FILTERS.some((f) => f.key === row.category) ? row.category : "talk",
      blurb: row.description_ar?.trim() || "",
      live: false,
      howTo: steps.length ? { goal: row.how_to?.goal?.trim() || "", minutes: row.how_to?.minutes?.trim() || "", steps } : undefined,
      soon: true,
      order: row.sort_order ?? 2000,
    });
  }
  return out.sort((a, b) => Number(a.soon) - Number(b.soon) || a.order - b.order);
}

/** The slugs the site can open a room for. */
export const PLAYABLE_SLUGS = new Set(CATALOG.filter((g) => g.live).map((g) => g.id));

export const findCard = (slug: string) => CATALOG.find((g) => g.id === slug) ?? null;

/** Reads the games table once per page; works before and after polish_v1.sql. */
export async function loadDbGames(): Promise<DbGame[] | null> {
  if (!supabase) return null;
  const base = "slug, title_ar, description_ar, min_players, max_players, is_active";
  const v4 = await supabase.from("games").select(`${base}, home_status, sort_order, icon, category, how_to`);
  if (!v4.error) return (v4.data ?? []) as DbGame[];
  const full = await supabase.from("games").select(`${base}, home_status, sort_order`);
  if (!full.error) return (full.data ?? []) as DbGame[];
  const plain = await supabase.from("games").select(base);
  return plain.error ? null : ((plain.data ?? []) as DbGame[]);
}

/** The games list for a page: the catalogue at once, then the database's word on it. */
export function useGames() {
  const [rows, setRows] = useState<DbGame[] | null>(null);
  useEffect(() => {
    let alive = true;
    loadDbGames()
      .then((r) => alive && setRows(r))
      .catch(() => {
        // Offline or blocked: keep the catalogue.
      });
    return () => {
      alive = false;
    };
  }, []);
  return mergeCatalog(rows);
}
