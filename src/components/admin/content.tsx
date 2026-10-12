import { useEffect, useMemo, useState, type ChangeEvent, type ReactNode } from "react";
import { GameIcon, Glyph } from "@/components/brand";
import { Button, cx } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { loadGames, type AdminGame } from "./games";
import { Loading, Notice, SetupNotice, dbMessage, needsSetup, textareaClass } from "./common";
import { downloadText, joinList, normAr, parseCsv, splitList, toCsv } from "./csv";

/**
 * «الاستيراد والجودة»: export any content list to CSV, import a CSV (or cells
 * pasted from a sheet) with a preview that skips duplicates, and a quality check
 * that finds duplicates, thin categories and incomplete items.
 */

type KindKey = "questions" | "heads" | "outsider" | "halba";
type Col = { field: string; ar: string; aliases: string[]; hint?: string };
type Row = Record<string, unknown> & { id: string };
type Parsed = { row?: Record<string, unknown>; key: string; label: string; error?: string; answers?: string[] };
type Kind = {
  key: KindKey;
  label: string;
  icon: string;
  table: string;
  cols: Col[];
  thin: number;
  textOf: (r: Row) => string;
  categoryOf: (r: Row) => string | null;
  exportRow: (r: Row) => Array<string | number | null>;
  parse: (rec: Record<string, string>, slug: string) => Parsed;
  issues: (r: Row) => string[];
};

const DIFF: Record<string, string> = { سهل: "easy", متوسط: "medium", صعب: "hard", easy: "easy", medium: "medium", hard: "hard" };
const DIFF_AR: Record<string, string> = { easy: "سهل", medium: "متوسط", hard: "صعب" };
const int = (v: string | undefined, fallback: number) => {
  const n = Number((v ?? "").replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))));
  return v && Number.isFinite(n) ? Math.round(n) : fallback;
};

const KINDS: Kind[] = [
  {
    key: "questions",
    label: "بنك الأسئلة",
    icon: "question",
    table: "questions_bank",
    thin: 6,
    cols: [
      { field: "category", ar: "الفئة", aliases: ["category", "category_ar", "التصنيف"] },
      { field: "question", ar: "السؤال", aliases: ["question", "question_text", "نص السؤال"] },
      { field: "answer", ar: "الإجابة", aliases: ["answer", "correct_answer", "الإجابة الصحيحة", "الاجابة"] },
      { field: "options", ar: "الخيارات", aliases: ["options"], hint: "اختياري، مفصولة بـ |" },
      { field: "fakes", ar: "إجابات مزيفة", aliases: ["fake_answers", "fakes"], hint: "اختياري، مفصولة بـ |" },
      { field: "points", ar: "النقاط", aliases: ["points"], hint: "افتراضي 100" },
      { field: "difficulty", ar: "الصعوبة", aliases: ["difficulty"], hint: "سهل / متوسط / صعب" },
      { field: "media", ar: "رابط الصورة", aliases: ["media_url", "image"], hint: "اختياري، https://" },
    ],
    textOf: (r) => String(r.question_text ?? ""),
    categoryOf: (r) => (r.category_ar as string) ?? null,
    exportRow: (r) => [
      r.category_ar as string,
      r.question_text as string,
      r.correct_answer as string,
      joinList(r.options as string[]),
      joinList(r.fake_answers as string[]),
      r.points as number,
      DIFF_AR[r.difficulty as string] ?? (r.difficulty as string),
      (r.media_url as string) ?? "",
    ],
    parse: (rec, slug) => {
      const options = splitList(rec.options);
      const answer = (rec.answer ?? "").trim();
      const row = {
        game_slug: slug,
        category_ar: (rec.category ?? "").trim(),
        question_text: (rec.question ?? "").trim(),
        correct_answer: answer,
        options,
        fake_answers: splitList(rec.fakes),
        points: int(rec.points, 100),
        difficulty: DIFF[(rec.difficulty ?? "").trim().toLowerCase()] ?? "medium",
        media_url: (rec.media ?? "").trim() || null,
      };
      const base = { key: normAr(row.question_text), label: row.question_text };
      if (!row.category_ar || row.category_ar.length > 60) return { ...base, error: "الفئة مطلوبة (حتى 60 حرفًا)" };
      if (!row.question_text || row.question_text.length > 500) return { ...base, error: "نص السؤال مطلوب (حتى 500 حرف)" };
      if (!answer) return { ...base, error: "الإجابة مطلوبة" };
      if (!(row.points > 0)) return { ...base, error: "النقاط رقم أكبر من صفر" };
      if (options.length > 0 && !options.includes(answer)) return { ...base, error: "الإجابة ليست ضمن الخيارات" };
      if (row.media_url && !/^https:\/\//i.test(row.media_url)) return { ...base, error: "رابط الصورة يبدأ بـ https://" };
      return { ...base, row };
    },
    issues: (r) => {
      const out: string[] = [];
      const options = (r.options as string[]) ?? [];
      if (options.length > 0 && !options.includes(r.correct_answer as string)) out.push("الإجابة ليست ضمن الخيارات");
      if (!String(r.correct_answer ?? "").trim()) out.push("بدون إجابة");
      return out;
    },
  },
  {
    key: "halba",
    label: "مواضيع الحلبة",
    icon: "alhalba",
    table: "alhalba_topics",
    thin: 10,
    cols: [
      { field: "topic", ar: "الموضوع", aliases: ["topic", "topic_ar"] },
      { field: "category", ar: "الفئة", aliases: ["category", "التصنيف"] },
      { field: "min", ar: "المزايدة تبدأ من", aliases: ["min", "min_answers", "أقل مزايدة"], hint: "افتراضي 3" },
      { field: "seconds", ar: "الوقت", aliases: ["seconds", "time_limit_sec", "الثواني"], hint: "بالثواني، افتراضي 30" },
      { field: "answers", ar: "الإجابات", aliases: ["answers", "الإجابات المرجعية"], hint: "مفصولة بـ |" },
    ],
    textOf: (r) => String(r.topic_ar ?? ""),
    categoryOf: (r) => (r.category as string) ?? null,
    exportRow: (r) => [r.topic_ar as string, (r.category as string) ?? "", r.min_answers as number, r.time_limit_sec as number, joinList(r.answers as string[])],
    parse: (rec) => {
      const answers = splitList(rec.answers);
      const row = {
        topic_ar: (rec.topic ?? "").trim(),
        category: (rec.category ?? "").trim() || null,
        min_answers: int(rec.min, 3),
        time_limit_sec: int(rec.seconds, 30),
        answers,
      };
      const base = { key: normAr(row.topic_ar), label: row.topic_ar, answers };
      if (row.topic_ar.length < 3 || row.topic_ar.length > 160) return { ...base, error: "الموضوع بين 3 و160 حرفًا" };
      if (!(row.min_answers >= 1 && row.min_answers <= 30)) return { ...base, error: "أقل مزايدة بين 1 و30" };
      if (!(row.time_limit_sec >= 10 && row.time_limit_sec <= 180)) return { ...base, error: "الوقت بين 10 و180 ثانية" };
      if (answers.length > 400) return { ...base, error: "الإجابات أكثر من 400" };
      return { ...base, row };
    },
    issues: (r) => {
      const answers = (r.answers as string[]) ?? [];
      if (answers.length === 0) return ["بدون إجابات مرجعية"];
      if (answers.length < Number(r.min_answers ?? 0) * 2) return [`${answers.length} إجابات فقط، أقل من ضعف أقل مزايدة`];
      return [];
    },
  },
  {
    key: "heads",
    label: "كلمات على راسك",
    icon: "heads-up",
    table: "heads_words",
    thin: 15,
    cols: [
      { field: "word", ar: "الكلمة", aliases: ["word"] },
      { field: "category", ar: "الفئة", aliases: ["category", "category_ar", "التصنيف"] },
    ],
    textOf: (r) => String(r.word ?? ""),
    categoryOf: (r) => (r.category_ar as string) ?? null,
    exportRow: (r) => [r.word as string, (r.category_ar as string) ?? ""],
    parse: (rec) => {
      const row = { word: (rec.word ?? "").trim().replace(/\s+/g, " "), category_ar: (rec.category ?? "").trim() || null };
      const base = { key: normAr(row.word), label: row.word };
      if (!row.word || row.word.length > 60) return { ...base, error: "الكلمة مطلوبة (حتى 60 حرفًا)" };
      return { ...base, row };
    },
    issues: () => [],
  },
  {
    key: "outsider",
    label: "مواضيع برة السالفة",
    icon: "outsider",
    table: "outsider_topics",
    thin: 0,
    cols: [
      { field: "title", ar: "الموضوع", aliases: ["title", "title_ar"] },
      { field: "words", ar: "الكلمات", aliases: ["words"], hint: "مفصولة بـ |" },
    ],
    textOf: (r) => String(r.title_ar ?? ""),
    categoryOf: () => null,
    exportRow: (r) => [r.title_ar as string, joinList(r.words as string[])],
    parse: (rec) => {
      const words = splitList(rec.words);
      const row = { title_ar: (rec.title ?? "").trim(), words };
      const base = { key: normAr(row.title_ar), label: row.title_ar };
      if (!row.title_ar) return { ...base, error: "اسم الموضوع مطلوب" };
      if (words.length < 2) return { ...base, error: "كلمتان على الأقل" };
      return { ...base, row };
    },
    issues: (r) => (((r.words as string[]) ?? []).length < 6 ? ["كلمات قليلة (أقل من 6)"] : []),
  },
];

async function loadRows(kind: Kind, slug: string): Promise<{ rows: Row[]; error: { code?: string; message?: string } | null }> {
  if (!supabase) return { rows: [], error: null };
  if (kind.key === "questions") {
    const { data, error } = await supabase.rpc("admin_questions", { p_game_slug: slug });
    return { rows: (data ?? []) as Row[], error };
  }
  const select =
    kind.key === "halba"
      ? "id, topic_ar, category, min_answers, time_limit_sec, answers, created_at"
      : kind.key === "heads"
        ? "id, word, category_ar"
        : "id, title_ar, words";
  const { data, error } = await supabase.from(kind.table).select(select).order(kind.key === "outsider" ? "title_ar" : kind.key === "heads" ? "word" : "topic_ar");
  const rows = ((data ?? []) as unknown as Row[]).map((r) => (kind.key === "outsider" && !Array.isArray(r.words) ? { ...r, words: [] } : r));
  return { rows, error };
}

export function ContentTab() {
  const [kindKey, setKindKey] = useState<KindKey>("questions");
  const [games, setGames] = useState<AdminGame[]>([]);
  const [slug, setSlug] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [setup, setSetup] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const kind = KINDS.find((k) => k.key === kindKey)!;

  useEffect(() => {
    void loadGames().then(({ data }) => {
      setGames(data);
      setSlug((s) => s || data.find((g) => g.slug === "tactical-grid")?.slug || data[0]?.slug || "");
    });
  }, []);

  async function refresh() {
    if (kind.key === "questions" && !slug) return;
    setRows(null);
    const { rows: list, error: loadError } = await loadRows(kind, slug);
    if (loadError) {
      const missing = needsSetup(loadError) || loadError.code === "42703" || loadError.code === "PGRST204";
      setSetup(missing ? (kind.key === "halba" && loadError.code === "42703" ? "admin_v2.sql" : "admin_panel.sql") : null);
      setError(missing ? null : dbMessage(loadError, "تعذّر التحميل."));
      setRows([]);
      return;
    }
    setSetup(null);
    setError(null);
    setRows(list);
  }

  useEffect(() => {
    void refresh();
    // refresh reads the chosen list and game.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kindKey, slug]);

  const gameTitle = games.find((g) => g.slug === slug)?.title_ar ?? slug;
  const fileBase = kind.key === "questions" ? `questions-${slug}` : kind.key;

  return (
    <div className="grid grid-cols-1 gap-4">
      <div role="group" aria-label="المحتوى" className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
        {KINDS.map((k) => (
          <button
            key={k.key}
            type="button"
            aria-pressed={kindKey === k.key}
            onClick={() => setKindKey(k.key)}
            className={cx(
              "inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border px-4 text-[15px] font-semibold transition",
              kindKey === k.key ? "btn-gold border-transparent" : "border-line-strong/70 bg-deep-2/50 text-mist hover:text-ivory",
            )}
          >
            {k.icon === "question" ? <Glyph name="question" className="size-[18px]" /> : <img src={`/brand/games/game-${k.icon}.svg`} alt="" className="size-6" />}
            {k.label}
          </button>
        ))}
      </div>

      {kind.key === "questions" ? (
        <div role="group" aria-label="اللعبة" className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
          {games.map((g) => (
            <button
              key={g.id}
              type="button"
              aria-pressed={slug === g.slug}
              onClick={() => setSlug(g.slug)}
              className={cx(
                "inline-flex min-h-10 shrink-0 items-center gap-2 rounded-full border py-1 ps-1 pe-3 text-[14px] font-semibold transition",
                slug === g.slug ? "border-gold bg-gold/15 text-ivory" : "border-line-strong/70 bg-deep-2/50 text-mist hover:text-ivory",
              )}
            >
              <GameIcon id={g.slug} size="sm" className="size-8! rounded-full!" />
              {g.title_ar}
            </button>
          ))}
        </div>
      ) : null}

      {setup === "admin_panel.sql" ? <SetupNotice /> : null}
      {setup === "admin_v2.sql" ? (
        <Notice tone="info">
          الإجابات المرجعية تحتاج الملف <code dir="ltr" className="rounded bg-night/60 px-1.5 py-0.5 text-[13px]">supabase/admin_v2.sql</code>. شغّله مرة واحدة من SQL Editor، ثم حدّث الصفحة.
        </Notice>
      ) : null}
      {error ? <Notice tone="error">{error}</Notice> : null}

      {rows === null ? (
        <Loading />
      ) : setup ? null : (
        <>
          <ExportPanel kind={kind} rows={rows} fileBase={fileBase} scope={kind.key === "questions" ? `${kind.label} · ${gameTitle}` : kind.label} />
          <ImportPanel key={`${kind.key}-${slug}`} kind={kind} slug={slug} rows={rows} onDone={refresh} />
          <QualityPanel kind={kind} rows={rows} onChanged={refresh} />
        </>
      )}
    </div>
  );
}

function Card({ title, icon, children }: { title: string; icon: string; children: ReactNode }) {
  return (
    <section className="surface grid min-w-0 grid-cols-1 gap-3 rounded-[22px] p-4 sm:p-5">
      <h2 className="flex items-center gap-2 text-[19px] leading-7">
        <Glyph name={icon} className="size-5 text-gold" />
        {title}
      </h2>
      {children}
    </section>
  );
}

function ExportPanel({ kind, rows, fileBase, scope }: { kind: Kind; rows: Row[]; fileBase: string; scope: string }) {
  const header = kind.cols.map((c) => c.ar);
  return (
    <Card title="تصدير" icon="copy">
      <p className="text-[14px] text-mist">
        {scope}، العدد: <b className="text-ivory tabular-nums">{rows.length}</b>. الملف CSV يفتح في Excel وGoogle Sheets، والقوائم داخل الخلية مفصولة بـ «|».
      </p>
      <div className="flex flex-wrap gap-2">
        <Button tone="primary" onClick={() => downloadText(`${fileBase}.csv`, toCsv([header, ...rows.map(kind.exportRow)]))} disabled={rows.length === 0}>
          نزّل CSV
        </Button>
        <Button tone="quiet" onClick={() => downloadText(`${fileBase}-template.csv`, toCsv([header]))}>
          نزّل قالبًا فارغًا
        </Button>
      </div>
    </Card>
  );
}

type Preview = Parsed & { line: number; status: "new" | "dup-db" | "dup-file" | "error" | "update"; addAnswers?: number; existingId?: string };

function ImportPanel({ kind, slug, rows, onDone }: { kind: Kind; slug: string; rows: Row[]; onDone: () => Promise<void> }) {
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [mergeAnswers, setMergeAnswers] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const existing = useMemo(() => {
    const map = new Map<string, Row>();
    for (const r of rows) if (!map.has(normAr(kind.textOf(r)))) map.set(normAr(kind.textOf(r)), r);
    return map;
  }, [rows, kind]);

  const preview = useMemo<{ items: Preview[]; unmatched: string[] } | null>(() => {
    if (!text.trim()) return null;
    const table = parseCsv(text);
    if (table.length === 0) return null;
    const names = kind.cols.map((c) => [c.ar, c.field, ...c.aliases].map(normAr));
    const head = table[0].map(normAr);
    const hasHeader = head.some((h) => names.some((n) => n.includes(h)));
    const index = kind.cols.map((_, i) => (hasHeader ? head.findIndex((h) => names[i].includes(h)) : i));
    const unmatched = hasHeader ? table[0].filter((_, i) => !index.includes(i)) : [];
    const seen = new Set<string>();
    const items = table.slice(hasHeader ? 1 : 0).map((cells, n): Preview => {
      const rec: Record<string, string> = {};
      kind.cols.forEach((c, i) => (rec[c.field] = index[i] >= 0 ? (cells[index[i]] ?? "") : ""));
      const p = kind.parse(rec, slug);
      const line = n + (hasHeader ? 2 : 1);
      if (p.error) return { ...p, line, status: "error" };
      if (seen.has(p.key)) return { ...p, line, status: "dup-file" };
      seen.add(p.key);
      const old = existing.get(p.key);
      if (old) {
        if (kind.key === "halba" && mergeAnswers) {
          const have = new Set(((old.answers as string[]) ?? []).map(normAr));
          const add = (p.answers ?? []).filter((a) => !have.has(normAr(a))).length;
          if (add > 0) return { ...p, line, status: "update", addAnswers: add, existingId: old.id };
        }
        return { ...p, line, status: "dup-db" };
      }
      return { ...p, line, status: "new" };
    });
    return { items, unmatched };
  }, [text, kind, slug, existing, mergeAnswers]);

  const counts = useMemo(() => {
    const c = { new: 0, update: 0, "dup-db": 0, "dup-file": 0, error: 0 };
    for (const i of preview?.items ?? []) c[i.status] += 1;
    return c;
  }, [preview]);

  async function readFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setMessage(null);
    if (/\.(xlsx|xls|numbers)$/i.test(file.name)) {
      setMessage({ tone: "error", text: "احفظ الملف من Excel بصيغة «CSV UTF-8» ثم ارفعه، أو انسخ الخلايا والصقها في المربع." });
      return;
    }
    setFileName(file.name);
    setText(await file.text());
  }

  async function run() {
    if (!supabase || !preview) return;
    setBusy(true);
    setMessage(null);
    const fresh = preview.items.filter((i) => i.status === "new" && i.row).map((i) => i.row!);
    let added = 0;
    let updated = 0;
    for (let i = 0; i < fresh.length; i += 200) {
      const { error } = await supabase.from(kind.table).insert(fresh.slice(i, i + 200));
      if (error) {
        setBusy(false);
        setMessage({ tone: "error", text: `${dbMessage(error, "تعذّر الاستيراد.")} أُضيف ${added} قبل التوقف.` });
        await onDone();
        return;
      }
      added += Math.min(200, fresh.length - i);
    }
    for (const item of preview.items.filter((i) => i.status === "update" && i.existingId)) {
      const old = rows.find((r) => r.id === item.existingId);
      const merged = [...((old?.answers as string[]) ?? [])];
      const have = new Set(merged.map(normAr));
      for (const a of item.answers ?? []) {
        if (have.has(normAr(a))) continue;
        merged.push(a);
        have.add(normAr(a));
      }
      const { error } = await supabase.from(kind.table).update({ answers: merged.slice(0, 400) }).eq("id", item.existingId);
      if (!error) updated += 1;
    }
    setBusy(false);
    setText("");
    setFileName(null);
    setMessage({ tone: "ok", text: `تم: أُضيف ${added}${kind.key === "halba" ? `، وحُدّثت إجابات ${updated} موضوع` : ""}.` });
    await onDone();
  }

  const STATUS: Record<Preview["status"], { label: string; cls: string }> = {
    new: { label: "جديد", cls: "text-correct" },
    update: { label: "تحديث الإجابات", cls: "text-gold" },
    "dup-db": { label: "موجود", cls: "text-mist" },
    "dup-file": { label: "مكرر في الملف", cls: "text-mist" },
    error: { label: "خطأ", cls: "text-wrong" },
  };

  return (
    <Card title="استيراد" icon="plus">
      <p className="text-[14px] leading-6 text-mist">
        ارفع ملف CSV (من Excel: «حفظ باسم» ← CSV UTF-8) أو الصق خلايا منسوخة من جدول. السطر الأول عناوين الأعمدة:
      </p>
      <ul className="flex flex-wrap gap-1.5">
        {kind.cols.map((c) => (
          <li key={c.field} className="rounded-full border border-line bg-deep-2/60 px-3 py-1 text-[13px] text-ivory">
            {c.ar}
            {c.hint ? <span className="text-mist"> ({c.hint})</span> : null}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <label className={cx("inline-flex min-h-12 cursor-pointer items-center gap-2 rounded-full border border-line-strong/70 bg-deep-2/60 px-5 text-[15px] font-semibold text-ivory hover:border-glow")}>
          <Glyph name="plus" className="size-[18px]" />
          اختر ملفًا
          <input type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" className="sr-only" onChange={readFile} />
        </label>
        {fileName ? <span className="text-[13px] text-mist" dir="ltr">{fileName}</span> : null}
      </div>
      <textarea
        className={cx(textareaClass, "min-h-28 font-mono text-[13px]")}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setFileName(null);
        }}
        placeholder="أو الصق هنا…"
        aria-label="محتوى للاستيراد"
      />
      {kind.key === "halba" ? (
        <label className="inline-flex items-center gap-2 text-[14px] text-ivory">
          <input type="checkbox" className="size-5 accent-[var(--color-gold)]" checked={mergeAnswers} onChange={(e) => setMergeAnswers(e.target.checked)} />
          للمواضيع الموجودة: أضف الإجابات الجديدة إلى قائمتها
        </label>
      ) : null}

      {preview ? (
        <div className="grid gap-3">
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-[14px]">
            <span className="text-correct">جديد {counts.new}</span>
            {kind.key === "halba" ? <span className="text-gold">تحديث {counts.update}</span> : null}
            <span className="text-mist">موجود {counts["dup-db"]}</span>
            <span className="text-mist">مكرر في الملف {counts["dup-file"]}</span>
            <span className="text-wrong">أخطاء {counts.error}</span>
          </p>
          {preview.unmatched.length > 0 ? <Notice tone="info">أعمدة لم نتعرّف عليها وستُتجاهل: {preview.unmatched.join("، ")}</Notice> : null}
          <div className="max-h-80 overflow-auto rounded-[14px] border border-line">
            <table className="w-full text-start text-[13px]">
              <thead className="sticky top-0 bg-deep-2 text-mist">
                <tr>
                  <th className="px-3 py-2 text-start font-semibold">سطر</th>
                  <th className="px-3 py-2 text-start font-semibold">العنصر</th>
                  <th className="px-3 py-2 text-start font-semibold">الحالة</th>
                </tr>
              </thead>
              <tbody>
                {preview.items.slice(0, 300).map((i) => (
                  <tr key={i.line} className="border-t border-line/60">
                    <td className="px-3 py-1.5 tabular-nums text-mist">{i.line}</td>
                    <td className="max-w-[28ch] truncate px-3 py-1.5 text-ivory sm:max-w-none">{i.label || "—"}</td>
                    <td className={cx("px-3 py-1.5 font-semibold whitespace-nowrap", STATUS[i.status].cls)}>
                      {STATUS[i.status].label}
                      {i.error ? <span className="block font-normal">{i.error}</span> : null}
                      {i.addAnswers ? <span className="block font-normal">+{i.addAnswers} إجابة</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Button tone="primary" className="min-h-14 text-[16px]" onClick={run} disabled={busy || counts.new + counts.update === 0}>
            {busy ? "جارٍ الاستيراد…" : `استورد ${counts.new} جديد${counts.update ? ` وحدّث ${counts.update}` : ""}`}
          </Button>
        </div>
      ) : null}
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
    </Card>
  );
}

function QualityPanel({ kind, rows, onChanged }: { kind: Kind; rows: Row[]; onChanged: () => Promise<void> }) {
  const report = useMemo(() => {
    const groups = new Map<string, Row[]>();
    for (const r of rows) {
      const k = normAr(kind.textOf(r));
      groups.set(k, [...(groups.get(k) ?? []), r]);
    }
    const dups = [...groups.values()].filter((g) => g.length > 1);
    const cats = new Map<string, number>();
    for (const r of rows) {
      const c = kind.categoryOf(r);
      if (c) cats.set(c, (cats.get(c) ?? 0) + 1);
    }
    const thin = kind.thin > 0 ? [...cats.entries()].filter(([, n]) => n < kind.thin).sort((a, b) => a[1] - b[1]) : [];
    const noCategory = kind.key === "outsider" ? 0 : rows.filter((r) => !kind.categoryOf(r)).length;
    const issues = rows.map((r) => ({ r, list: kind.issues(r) })).filter((x) => x.list.length > 0);
    return { dups, thin, issues, noCategory, extra: dups.reduce((s, g) => s + g.length - 1, 0) };
  }, [rows, kind]);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function removeExtra() {
    if (!supabase) return;
    setBusy(true);
    const ids = report.dups.flatMap((g) => g.slice(1).map((r) => r.id));
    const { error } = await supabase.from(kind.table).delete().in("id", ids);
    setBusy(false);
    setConfirm(false);
    setMessage(error ? dbMessage(error, "تعذّر الحذف.") : null);
    await onChanged();
  }

  const clean = report.dups.length === 0 && report.thin.length === 0 && report.issues.length === 0 && report.noCategory === 0;
  return (
    <Card title="فحص الجودة" icon="shield">
      {rows.length === 0 ? (
        <p className="text-[14px] text-mist">لا يوجد محتوى بعد.</p>
      ) : clean ? (
        <Notice tone="ok">لا مكرر ولا نقص (العدد {rows.length}).</Notice>
      ) : null}

      {report.dups.length > 0 ? (
        <div className="grid min-w-0 gap-2">
          <h3 className="text-[16px]">مكرر ({report.dups.length})</h3>
          <p className="text-[13px] text-mist">نفس النص بعد تجاهل التشكيل والهمزات وعلامات الترقيم. الحذف يبقي نسخة واحدة من كل عنصر.</p>
          <ul className="grid gap-1.5">
            {report.dups.slice(0, 20).map((g) => (
              <li key={g[0].id} className="flex items-center gap-2 rounded-[12px] border border-line bg-deep-2/50 px-3 py-1.5 text-[14px]">
                <span className="min-w-0 flex-1 truncate text-ivory">{kind.textOf(g[0])}</span>
                <span className="text-gold">×{g.length}</span>
              </li>
            ))}
          </ul>
          {report.dups.length > 20 ? <p className="text-[13px] text-mist">و{report.dups.length - 20} غيرها.</p> : null}
          {confirm ? (
            <div className="flex flex-wrap gap-2">
              <Button tone="danger" onClick={removeExtra} disabled={busy}>
                {busy ? "جارٍ الحذف…" : `احذف ${report.extra} نسخة زائدة نهائيًا`}
              </Button>
              <Button tone="quiet" onClick={() => setConfirm(false)} disabled={busy}>
                إلغاء
              </Button>
            </div>
          ) : (
            <Button tone="quiet" className="w-fit" onClick={() => setConfirm(true)}>
              <Glyph name="trash" className="size-[18px]" />
              احذف النسخ الزائدة ({report.extra})
            </Button>
          )}
        </div>
      ) : null}

      {report.thin.length > 0 ? (
        <div className="grid gap-2">
          <h3 className="text-[16px]">فئات قليلة المحتوى (أقل من {kind.thin})</h3>
          <ul className="flex flex-wrap gap-1.5">
            {report.thin.map(([c, n]) => (
              <li key={c} className="rounded-full border border-gold/40 bg-gold/10 px-3 py-1 text-[13px] text-ivory">
                {c} <span className="tabular-nums text-gold">{n}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {report.noCategory > 0 ? <p className="text-[14px] text-mist">{report.noCategory} عنصر بدون فئة.</p> : null}

      {report.issues.length > 0 ? (
        <div className="grid gap-2">
          <h3 className="text-[16px]">تحتاج مراجعة ({report.issues.length})</h3>
          <ul className="grid gap-1.5">
            {report.issues.slice(0, 30).map(({ r, list }) => (
              <li key={r.id} className="grid gap-0.5 rounded-[12px] border border-line bg-deep-2/50 px-3 py-1.5 text-[14px] sm:flex sm:items-center sm:gap-3">
                <span className="min-w-0 flex-1 truncate text-ivory">{kind.textOf(r)}</span>
                <span className="text-[13px] text-gold">{list.join("، ")}</span>
              </li>
            ))}
          </ul>
          {report.issues.length > 30 ? <p className="text-[13px] text-mist">و{report.issues.length - 30} غيرها. صدّرها إلى CSV لتراجعها كلها.</p> : null}
        </div>
      ) : null}
      {message ? <Notice tone="error">{message}</Notice> : null}
    </Card>
  );
}
