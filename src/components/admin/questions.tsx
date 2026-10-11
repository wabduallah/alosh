import { useEffect, useMemo, useState, type FormEvent } from "react";
import { GameIcon, Glyph } from "@/components/brand";
import { Button, Field, cx, inputClass } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { loadGames, type AdminGame } from "./games";
import { Loading, Notice, SetupNotice, Sheet, dbMessage, needsSetup, selectClass, textareaClass, toList } from "./common";

type Difficulty = "easy" | "medium" | "hard";
type Question = {
  id: string;
  game_slug: string;
  category_ar: string;
  question_text: string;
  media_url: string | null;
  options: string[];
  correct_answer: string;
  fake_answers: string[];
  points: number;
  difficulty: Difficulty;
};

const DIFFICULTY: Record<Difficulty, string> = { easy: "سهل", medium: "متوسط", hard: "صعب" };

/** Question bank: questions with their answers, per game. Answers come from admin_questions(), never from the public view. */
export function QuestionsTab() {
  const [games, setGames] = useState<AdminGame[]>([]);
  const [slug, setSlug] = useState<string>("");
  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [setup, setSetup] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Question | "new" | null>(null);

  useEffect(() => {
    void loadGames().then(({ data }) => {
      setGames(data);
      setSlug((current) => current || data.find((g) => g.slug === "tactical-grid")?.slug || data[0]?.slug || "");
    });
  }, []);

  async function refresh(forSlug = slug) {
    if (!supabase || !forSlug) return;
    setQuestions(null);
    const { data, error: rpcError } = await supabase.rpc("admin_questions", { p_game_slug: forSlug });
    if (rpcError) {
      setSetup(needsSetup(rpcError));
      setError(needsSetup(rpcError) ? null : dbMessage(rpcError, "تعذّر تحميل الأسئلة."));
      setQuestions([]);
      return;
    }
    setSetup(false);
    setError(null);
    setQuestions((data ?? []) as Question[]);
  }

  useEffect(() => {
    if (slug) void refresh(slug);
    // refresh reads slug; the effect re-runs when the game changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  const groups = useMemo(() => {
    const q = query.trim();
    const list = (questions ?? []).filter((item) => !q || item.question_text.includes(q) || item.correct_answer.includes(q) || item.category_ar.includes(q));
    const map = new Map<string, Question[]>();
    for (const item of list) map.set(item.category_ar, [...(map.get(item.category_ar) ?? []), item]);
    return [...map.entries()];
  }, [questions, query]);

  const categories = useMemo(() => [...new Set((questions ?? []).map((q) => q.category_ar))], [questions]);

  return (
    <div className="grid grid-cols-1 gap-4">
      <div role="group" aria-label="اللعبة" className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
        {games.map((g) => (
          <button
            key={g.id}
            type="button"
            aria-pressed={slug === g.slug}
            onClick={() => setSlug(g.slug)}
            className={cx(
              "inline-flex min-h-12 shrink-0 items-center gap-2 rounded-full border py-1 ps-1.5 pe-4 text-[15px] font-semibold transition",
              slug === g.slug ? "btn-gold border-transparent" : "border-line-strong/70 bg-deep-2/50 text-mist hover:text-ivory",
            )}
          >
            <GameIcon id={g.slug} size="sm" className="size-9! rounded-full!" />
            {g.title_ar}
          </button>
        ))}
      </div>

      {setup ? <SetupNotice /> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}

      {!setup ? (
        <div className="flex flex-wrap items-center gap-3">
          <label className="relative min-w-0 flex-1 basis-60">
            <span className="sr-only">بحث في الأسئلة</span>
            <input className={cx(inputClass, "ps-10")} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ابحث في السؤال أو الإجابة أو الفئة" />
            <Glyph name="search" className="pointer-events-none absolute start-3 top-1/2 size-5 -translate-y-1/2 text-faint" />
          </label>
          <Button tone="primary" onClick={() => setEditing("new")} disabled={!slug}>
            <Glyph name="plus" className="size-[18px]" />
            سؤال جديد
          </Button>
        </div>
      ) : null}

      {questions === null ? (
        <Loading />
      ) : !setup && questions.length === 0 ? (
        <Notice tone="info">لا توجد أسئلة لهذه اللعبة بعد.</Notice>
      ) : (
        groups.map(([category, items]) => (
          <section key={category} className="surface rounded-[24px] p-4 sm:p-5">
            <h3 className="mb-3 flex items-center gap-2 text-[19px]">
              <span className="rounded-full bg-violet/25 px-3 py-0.5 text-violet-text">{category}</span>
              <span className="text-[13px] font-normal text-mist">{items.length} سؤال</span>
            </h3>
            <ul className="grid gap-2">
              {items.map((q) => (
                <QuestionRow key={q.id} q={q} onEdit={() => setEditing(q)} onDeleted={() => refresh()} />
              ))}
            </ul>
          </section>
        ))
      )}

      {editing ? (
        <QuestionEditor
          slug={slug}
          question={editing === "new" ? null : editing}
          categories={categories}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await refresh();
          }}
        />
      ) : null}
    </div>
  );
}

function QuestionRow({ q, onEdit, onDeleted }: { q: Question; onEdit: () => void; onDeleted: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    if (!supabase) return;
    setBusy(true);
    const { error: deleteError } = await supabase.from("questions_bank").delete().eq("id", q.id);
    setBusy(false);
    if (deleteError) return setError(dbMessage(deleteError, "تعذّر الحذف."));
    onDeleted();
  }

  return (
    <li className="grid gap-2 rounded-[16px] border border-line bg-deep-2/50 p-3 sm:grid-cols-[auto_1fr_auto] sm:items-center sm:gap-3">
      <span className="w-fit rounded-[10px] border border-gold/40 bg-night/50 px-2.5 py-1 text-[15px] font-bold tabular-nums text-gold">{q.points}</span>
      <div className="min-w-0">
        <p className="text-[15px] leading-7 text-ivory">{q.question_text}</p>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-mist">
          <span className="inline-flex items-center gap-1 font-semibold text-correct">
            <Glyph name="check" className="size-4" />
            {q.correct_answer}
          </span>
          <span>{DIFFICULTY[q.difficulty] ?? q.difficulty}</span>
          {q.options.length > 0 ? <span>{q.options.length} خيارات</span> : null}
          {q.fake_answers.length > 0 ? <span>{q.fake_answers.length} إجابات مزيفة</span> : null}
        </p>
        {error ? <p className="mt-1 text-[13px] text-wrong">{error}</p> : null}
      </div>
      <div className="flex gap-2">
        {confirming ? (
          <>
            <Button tone="danger" className="min-h-10 px-4" onClick={remove} disabled={busy}>
              احذف نهائيًا
            </Button>
            <Button tone="quiet" className="min-h-10 px-4" onClick={() => setConfirming(false)} disabled={busy}>
              إلغاء
            </Button>
          </>
        ) : (
          <>
            <Button tone="quiet" className="min-h-10 px-4" onClick={onEdit}>
              <Glyph name="edit" className="size-[18px]" />
              تعديل
            </Button>
            <Button tone="quiet" className="min-h-10 px-3" onClick={() => setConfirming(true)} aria-label="حذف السؤال">
              <Glyph name="trash" className="size-[18px]" />
            </Button>
          </>
        )}
      </div>
    </li>
  );
}

function QuestionEditor({
  slug,
  question,
  categories,
  onClose,
  onSaved,
}: {
  slug: string;
  question: Question | null;
  categories: string[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [category, setCategory] = useState(question?.category_ar ?? "");
  const [text, setText] = useState(question?.question_text ?? "");
  const [correct, setCorrect] = useState(question?.correct_answer ?? "");
  const [options, setOptions] = useState((question?.options ?? []).join("\n"));
  const [fakes, setFakes] = useState((question?.fake_answers ?? []).join("\n"));
  const [points, setPoints] = useState(question?.points ?? 100);
  const [difficulty, setDifficulty] = useState<Difficulty>(question?.difficulty ?? "medium");
  const [media, setMedia] = useState(question?.media_url ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    const optionList = toList(options);
    const answer = correct.trim();
    const row = {
      game_slug: slug,
      category_ar: category.trim(),
      question_text: text.trim(),
      correct_answer: answer,
      options: optionList,
      fake_answers: toList(fakes),
      points: Math.round(points),
      difficulty,
      media_url: media.trim() || null,
    };
    if (!row.category_ar || row.category_ar.length > 60) return setError("الفئة مطلوبة، وحدها 60 حرفًا.");
    if (!row.question_text || row.question_text.length > 500) return setError("نص السؤال مطلوب، وحده 500 حرف.");
    if (!answer) return setError("الإجابة الصحيحة مطلوبة.");
    if (!(row.points > 0)) return setError("النقاط رقم أكبر من صفر.");
    if (optionList.length > 0 && !optionList.includes(answer)) return setError("الإجابة الصحيحة لازم تكون ضمن الخيارات.");
    if (row.media_url && !/^https:\/\//i.test(row.media_url)) return setError("رابط الصورة يبدأ بـ https://");

    setBusy(true);
    setError(null);
    const { error: saveError } = question
      ? await supabase.from("questions_bank").update(row).eq("id", question.id)
      : await supabase.from("questions_bank").insert(row);
    setBusy(false);
    if (saveError) return setError(saveError.code === "23505" ? "هذا السؤال موجود في هذه اللعبة." : dbMessage(saveError));
    await onSaved();
  }

  return (
    <Sheet title={question ? "تعديل السؤال" : "سؤال جديد"} onClose={onClose}>
      <form onSubmit={save} className="grid gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="الفئة">
            <input className={inputClass} list="question-categories" value={category} maxLength={60} onChange={(e) => setCategory(e.target.value)} />
          </Field>
          <datalist id="question-categories">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          <Field label="النقاط">
            <input type="number" inputMode="numeric" min={1} step={50} className={inputClass} value={points} onChange={(e) => setPoints(Number(e.target.value))} />
          </Field>
        </div>
        <Field label="نص السؤال">
          <textarea className={textareaClass} value={text} maxLength={500} onChange={(e) => setText(e.target.value)} />
        </Field>
        <Field label="الإجابة الصحيحة" hint="لا تظهر للاعبين. تظهر للمضيف عند الكشف فقط.">
          <input className={inputClass} value={correct} onChange={(e) => setCorrect(e.target.value)} />
        </Field>
        <Field label="الخيارات (اختياري)" hint="خيار في كل سطر. إذا كتبت خيارات، لازم تكون الإجابة الصحيحة بينها.">
          <textarea className={textareaClass} value={options} onChange={(e) => setOptions(e.target.value)} />
        </Field>
        <Field label="إجابات مزيفة (اختياري)" hint="لسيد الخداع: إجابة في كل سطر.">
          <textarea className={textareaClass} value={fakes} onChange={(e) => setFakes(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="الصعوبة">
            <select className={selectClass} value={difficulty} onChange={(e) => setDifficulty(e.target.value as Difficulty)}>
              {(Object.keys(DIFFICULTY) as Difficulty[]).map((d) => (
                <option key={d} value={d}>
                  {DIFFICULTY[d]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="رابط صورة (اختياري)">
            <input dir="ltr" className={inputClass} value={media} placeholder="https://" onChange={(e) => setMedia(e.target.value)} />
          </Field>
        </div>
        {error ? <Notice tone="error">{error}</Notice> : null}
        <Button type="submit" tone="primary" className="min-h-14 text-[17px]" disabled={busy}>
          {busy ? "جارٍ الحفظ…" : question ? "حفظ التعديل" : "أضف السؤال"}
        </Button>
      </form>
    </Sheet>
  );
}
