import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Glyph } from "@/components/brand";
import { Button, Field, cx, inputClass } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { BulkBar, Check, Loading, Notice, SetupNotice, Sheet, dbMessage, needsSetup, selectClass, textareaClass, toList, useSelection } from "./common";

type HeadsWord = { id: string; word: string; category_ar: string | null };
type Topic = { id: string; title_ar: string; words: string[] };
type HalbaTopic = { id: string; topic_ar: string; min_answers: number; time_limit_sec: number; category: string | null; answers?: string[] };

/** Words for «على راسك» and topics for «برة السالفة». Both need supabase/admin_panel.sql. */
export function WordsTab() {
  return (
    <div className="grid grid-cols-1 gap-8">
      <HalbaTopics />
      <HeadsWords />
      <OutsiderTopics />
    </div>
  );
}

function HeadsWords() {
  const [words, setWords] = useState<HeadsWord[] | null>(null);
  const [setup, setSetup] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");
  const sel = useSelection();

  async function refresh() {
    if (!supabase) return;
    const { data, error: loadError } = await supabase.from("heads_words").select("id, word, category_ar").order("category_ar").order("word");
    if (loadError) {
      setSetup(needsSetup(loadError));
      if (!needsSetup(loadError)) setError(dbMessage(loadError, "تعذّر تحميل الكلمات."));
      setWords([]);
      return;
    }
    setSetup(false);
    setWords((data ?? []) as HeadsWord[]);
  }

  useEffect(() => {
    void refresh();
  }, []);

  const shown = useMemo(() => {
    const q = query.trim();
    return (words ?? []).filter((w) => !q || w.word.includes(q) || (w.category_ar ?? "").includes(q));
  }, [words, query]);

  async function bulk(change: { category_ar: string } | "delete") {
    if (!supabase) return;
    const ids = [...sel.ids];
    const { error: bulkError } =
      change === "delete" ? await supabase.from("heads_words").delete().in("id", ids) : await supabase.from("heads_words").update(change).in("id", ids);
    if (bulkError) return setError(dbMessage(bulkError));
    sel.clear();
    await refresh();
  }

  const groups = useMemo(() => {
    const map = new Map<string, HeadsWord[]>();
    for (const w of shown) {
      const key = w.category_ar ?? "بدون فئة";
      map.set(key, [...(map.get(key) ?? []), w]);
    }
    return [...map.entries()];
  }, [shown]);

  async function remove(w: HeadsWord) {
    if (!supabase) return;
    setError(null);
    const { error: deleteError } = await supabase.from("heads_words").delete().eq("id", w.id);
    if (deleteError) return setError(dbMessage(deleteError, "تعذّر حذف الكلمة."));
    setWords((current) => (current ?? []).filter((x) => x.id !== w.id));
  }

  return (
    <section aria-labelledby="heads-title" className="grid grid-cols-1 gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="heads-title" className="flex items-center gap-2 text-[22px]">
          <img src="/brand/games/game-heads-up.svg" alt="" className="size-8" />
          كلمات «على راسك»
          {words && !setup ? <span className="text-[14px] font-normal text-mist">{words.length} كلمة</span> : null}
        </h2>
        {!setup ? (
          <Button tone="primary" onClick={() => setAdding(true)}>
            <Glyph name="plus" className="size-[18px]" />
            أضف كلمات
          </Button>
        ) : null}
      </div>
      {setup ? <SetupNotice /> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {words && words.length > 0 ? <SearchBox value={query} onChange={setQuery} label="ابحث في الكلمات" /> : null}
      {words === null ? (
        <Loading />
      ) : (
        groups.map(([category, items]) => (
          <div key={category} className="surface rounded-[22px] p-4">
            <h3 className="mb-3 flex items-center gap-2 text-[17px]">
              <span className="rounded-full bg-violet/25 px-3 py-0.5 text-violet-text">{category}</span>
              <span className="text-[13px] font-normal text-mist">{items.length}</span>
            </h3>
            <ul className="flex flex-wrap gap-2">
              {items.map((w) => (
                <li
                  key={w.id}
                  className={cx(
                    "inline-flex min-h-10 items-center gap-1 rounded-full border ps-1 pe-1 text-[15px] text-ivory",
                    sel.has(w.id) ? "border-gold bg-gold/15" : "border-line bg-deep-2/60",
                  )}
                >
                  <button type="button" role="checkbox" aria-checked={sel.has(w.id)} onClick={() => sel.toggle(w.id)} className="min-h-9 rounded-full ps-2.5 pe-1">
                    {w.word}
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(w)}
                    aria-label={`حذف ${w.word}`}
                    className="grid size-8 place-items-center rounded-full text-mist transition hover:bg-wrong-fill/20 hover:text-wrong"
                  >
                    <Glyph name="x" className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
      <BulkBar
        count={sel.ids.size}
        visible={shown.length}
        onSelectAll={() => sel.setAll(shown.map((w) => w.id))}
        onClear={sel.clear}
        categories={groups.map(([c]) => c).filter((c) => c !== "بدون فئة")}
        onMove={(category) => bulk({ category_ar: category })}
        onDelete={() => bulk("delete")}
      />
      {adding ? (
        <AddWords
          categories={groups.map(([c]) => c).filter((c) => c !== "بدون فئة")}
          onClose={() => setAdding(false)}
          onSaved={async () => {
            setAdding(false);
            await refresh();
          }}
        />
      ) : null}
    </section>
  );
}

function AddWords({ categories, onClose, onSaved }: { categories: string[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const [category, setCategory] = useState(categories[0] ?? "");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    const list = [...new Set(toList(text))];
    if (list.length === 0) return setError("اكتب كلمة واحدة على الأقل.");
    setBusy(true);
    setError(null);
    const { error: saveError } = await supabase.from("heads_words").insert(list.map((word) => ({ word, category_ar: category.trim() || null })));
    setBusy(false);
    if (saveError) return setError(dbMessage(saveError));
    await onSaved();
  }

  return (
    <Sheet title="أضف كلمات «على راسك»" onClose={onClose}>
      <form onSubmit={save} className="grid grid-cols-1 gap-4">
        <Field label="الفئة" hint="اختر فئة موجودة أو اكتب فئة جديدة.">
          <input className={inputClass} list="heads-categories" value={category} onChange={(e) => setCategory(e.target.value)} />
        </Field>
        <datalist id="heads-categories">
          {categories.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <Field label="الكلمات" hint="كلمة في كل سطر.">
          <textarea className={textareaClass} value={text} onChange={(e) => setText(e.target.value)} rows={6} />
        </Field>
        {error ? <Notice tone="error">{error}</Notice> : null}
        <Button type="submit" tone="primary" className="min-h-14 text-[17px]" disabled={busy}>
          {busy ? "جارٍ الحفظ…" : "أضف الكلمات"}
        </Button>
      </form>
    </Sheet>
  );
}

function OutsiderTopics() {
  const [topics, setTopics] = useState<Topic[] | null>(null);
  const [setup, setSetup] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Topic | "new" | null>(null);

  async function refresh() {
    if (!supabase) return;
    const { data, error: loadError } = await supabase.from("outsider_topics").select("id, title_ar, words").order("title_ar");
    if (loadError) {
      setSetup(needsSetup(loadError));
      if (!needsSetup(loadError)) setError(dbMessage(loadError, "تعذّر تحميل المواضيع."));
      setTopics([]);
      return;
    }
    setSetup(false);
    setTopics(((data ?? []) as Topic[]).map((t) => ({ ...t, words: Array.isArray(t.words) ? t.words : [] })));
  }

  useEffect(() => {
    void refresh();
  }, []);

  return (
    <section aria-labelledby="topics-title" className="grid grid-cols-1 gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="topics-title" className="flex items-center gap-2 text-[22px]">
          <img src="/brand/games/game-outsider.svg" alt="" className="size-8" />
          مواضيع «برة السالفة»
          {topics && !setup ? <span className="text-[14px] font-normal text-mist">{topics.length} موضوع</span> : null}
        </h2>
        {!setup ? (
          <Button tone="primary" onClick={() => setEditing("new")}>
            <Glyph name="plus" className="size-[18px]" />
            موضوع جديد
          </Button>
        ) : null}
      </div>
      {setup ? <SetupNotice /> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {topics === null ? (
        <Loading />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {topics.map((t) => (
            <TopicCard key={t.id} topic={t} onEdit={() => setEditing(t)} onDeleted={refresh} />
          ))}
        </div>
      )}
      {editing ? (
        <TopicEditor
          topic={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await refresh();
          }}
        />
      ) : null}
    </section>
  );
}

function TopicCard({ topic, onEdit, onDeleted }: { topic: Topic; onEdit: () => void; onDeleted: () => Promise<void> }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    if (!supabase) return;
    const { error: deleteError } = await supabase.from("outsider_topics").delete().eq("id", topic.id);
    if (deleteError) return setError(dbMessage(deleteError, "تعذّر حذف الموضوع."));
    await onDeleted();
  }

  return (
    <div className="surface grid gap-3 rounded-[22px] p-4">
      <div className="flex items-center gap-2">
        <h3 className="text-[19px]">{topic.title_ar}</h3>
        <span className="text-[13px] text-mist">{topic.words.length} كلمة</span>
        <div className="ms-auto flex gap-2">
          {confirming ? (
            <>
              <Button tone="danger" className="min-h-10 px-4" onClick={remove}>
                احذف نهائيًا
              </Button>
              <Button tone="quiet" className="min-h-10 px-4" onClick={() => setConfirming(false)}>
                إلغاء
              </Button>
            </>
          ) : (
            <>
              <Button tone="quiet" className="min-h-10 px-4" onClick={onEdit}>
                <Glyph name="edit" className="size-[18px]" />
                تعديل
              </Button>
              <Button tone="quiet" className="min-h-10 px-3" onClick={() => setConfirming(true)} aria-label={`حذف ${topic.title_ar}`}>
                <Glyph name="trash" className="size-[18px]" />
              </Button>
            </>
          )}
        </div>
      </div>
      <ul className="flex flex-wrap gap-1.5">
        {topic.words.map((w) => (
          <li key={w} className="rounded-full border border-line bg-deep-2/60 px-3 py-1 text-[14px] text-ivory">
            {w}
          </li>
        ))}
      </ul>
      {error ? <p className="text-[13px] text-wrong">{error}</p> : null}
    </div>
  );
}

function TopicEditor({ topic, onClose, onSaved }: { topic: Topic | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const [title, setTitle] = useState(topic?.title_ar ?? "");
  const [text, setText] = useState((topic?.words ?? []).join("\n"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    const words = [...new Set(toList(text))];
    if (!title.trim()) return setError("اسم الموضوع مطلوب.");
    if (words.length < 2) return setError("اكتب كلمتين على الأقل.");
    setBusy(true);
    setError(null);
    const row = { title_ar: title.trim(), words };
    const { error: saveError } = topic
      ? await supabase.from("outsider_topics").update(row).eq("id", topic.id)
      : await supabase.from("outsider_topics").insert(row);
    setBusy(false);
    if (saveError) return setError(dbMessage(saveError));
    await onSaved();
  }

  return (
    <Sheet title={topic ? "تعديل الموضوع" : "موضوع جديد"} onClose={onClose}>
      <form onSubmit={save} className="grid grid-cols-1 gap-4">
        <Field label="الموضوع" hint="مثل: حيوانات، أماكن، أكلات.">
          <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="الكلمات" hint="كلمة في كل سطر. تُختار منها كلمة الجولة عشوائيًا.">
          <textarea className={textareaClass} value={text} onChange={(e) => setText(e.target.value)} rows={7} />
        </Field>
        {error ? <Notice tone="error">{error}</Notice> : null}
        <Button type="submit" tone="primary" className="min-h-14 text-[17px]" disabled={busy}>
          {busy ? "جارٍ الحفظ…" : topic ? "حفظ التعديل" : "أضف الموضوع"}
        </Button>
      </form>
    </Sheet>
  );
}

/* ---------------- الحلبة ---------------- */

function HalbaTopics() {
  const [topics, setTopics] = useState<HalbaTopic[] | null>(null);
  const [setup, setSetup] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<HalbaTopic | "new" | null>(null);
  const [hasAnswers, setHasAnswers] = useState(true);
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState("");
  const [onlyMissing, setOnlyMissing] = useState(false);
  const sel = useSelection();

  async function refresh() {
    if (!supabase) return;
    const base = "id, topic_ar, min_answers, time_limit_sec, category";
    const first = await supabase.from("alhalba_topics").select(`${base}, answers`).order("category").order("topic_ar");
    // Before supabase/admin_v2.sql there is no answers column: load the rest.
    const noColumn = first.error?.code === "42703";
    setHasAnswers(!noColumn);
    const res = noColumn ? await supabase.from("alhalba_topics").select(base).order("category").order("topic_ar") : first;
    const data = res.data as unknown as HalbaTopic[] | null;
    const loadError = res.error;
    if (loadError) {
      const missing = needsSetup(loadError) || loadError.code === "42P01" || loadError.code === "PGRST205";
      setSetup(missing);
      if (!missing) setError(dbMessage(loadError, "تعذّر تحميل المواضيع."));
      setTopics([]);
      return;
    }
    setSetup(false);
    setTopics((data ?? []) as HalbaTopic[]);
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function remove(t: HalbaTopic) {
    if (!supabase) return;
    setError(null);
    const { error: deleteError } = await supabase.from("alhalba_topics").delete().eq("id", t.id);
    if (deleteError) return setError(dbMessage(deleteError, "تعذّر حذف الموضوع."));
    setTopics((current) => (current ?? []).filter((x) => x.id !== t.id));
  }

  const categories = useMemo(() => [...new Set((topics ?? []).map((t) => t.category).filter((c): c is string => !!c))], [topics]);
  const shown = useMemo(() => {
    const q = query.trim();
    return (topics ?? []).filter(
      (t) =>
        (!q || t.topic_ar.includes(q) || (t.answers ?? []).some((a) => a.includes(q))) &&
        (!cat || (t.category ?? "") === cat) &&
        (!onlyMissing || (t.answers ?? []).length === 0),
    );
  }, [topics, query, cat, onlyMissing]);

  async function bulk(change: { category: string } | "delete") {
    if (!supabase) return;
    const ids = [...sel.ids];
    const { error: bulkError } =
      change === "delete" ? await supabase.from("alhalba_topics").delete().in("id", ids) : await supabase.from("alhalba_topics").update(change).in("id", ids);
    if (bulkError) return setError(dbMessage(bulkError));
    sel.clear();
    await refresh();
  }

  return (
    <section aria-labelledby="halba-title" className="grid grid-cols-1 gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="halba-title" className="flex items-center gap-2 text-[22px]">
          <img src="/brand/games/game-alhalba.svg" alt="" className="size-8" />
          مواضيع «الحلبة»
          {topics && !setup ? <span className="text-[14px] font-normal text-mist">{topics.length} موضوع</span> : null}
        </h2>
        {!setup ? (
          <Button tone="primary" onClick={() => setEditing("new")}>
            <Glyph name="plus" className="size-[18px]" />
            موضوع جديد
          </Button>
        ) : null}
      </div>
      {setup ? (
        <Notice tone="info">
          هذا القسم يحتاج جدول الحلبة. شغّل الملف <code dir="ltr" className="rounded bg-night/60 px-1.5 py-0.5 text-[13px]">supabase/schema_alhalba.sql</code> مرة واحدة من SQL Editor في
          Supabase، ثم حدّث الصفحة.
        </Notice>
      ) : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {!hasAnswers && !setup ? (
        <Notice tone="info">
          لإضافة إجابات مرجعية تُقبل تلقائيًا في اللعب، شغّل الملف <code dir="ltr" className="rounded bg-night/60 px-1.5 py-0.5 text-[13px]">supabase/admin_v2.sql</code> مرة واحدة.
        </Notice>
      ) : null}
      {topics && topics.length > 0 ? (
        <div className="grid gap-2 sm:flex sm:flex-wrap sm:items-center">
          <SearchBox value={query} onChange={setQuery} label="ابحث في المواضيع والإجابات" />
          <select className={cx(selectClass, "min-h-11 py-1 sm:w-44")} value={cat} onChange={(e) => setCat(e.target.value)} aria-label="الفئة">
            <option value="">كل الفئات</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          {hasAnswers ? (
            <label className="inline-flex min-h-11 items-center gap-2 text-[14px] text-ivory">
              <input type="checkbox" className="size-5 accent-[var(--color-gold)]" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} />
              بدون إجابات فقط
            </label>
          ) : null}
        </div>
      ) : null}
      {topics === null ? (
        <Loading />
      ) : shown.length > 0 ? (
        <ul className="surface grid gap-2 rounded-[22px] p-3 sm:p-4">
          {shown.map((t) => (
            <li
              key={t.id}
              className={cx("flex items-center gap-3 rounded-[14px] border px-3 py-2", sel.has(t.id) ? "border-gold/60 bg-gold/5" : "border-line bg-deep-2/50")}
            >
              <Check checked={sel.has(t.id)} onChange={() => sel.toggle(t.id)} label={`تحديد: ${t.topic_ar}`} />
              <div className="min-w-0 flex-1">
                <p className="text-[15px] leading-6 text-ivory">{t.topic_ar}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-mist">
                  {t.category ? <span className="rounded-full bg-violet/25 px-2.5 py-0.5 text-[12px] text-violet-text">{t.category}</span> : null}
                  <span>
                    يبدأ من {t.min_answers} · {t.time_limit_sec} ث
                  </span>
                  {hasAnswers ? (
                    <span className={(t.answers ?? []).length === 0 ? "text-gold" : ""}>{(t.answers ?? []).length ? `${(t.answers ?? []).length} إجابة مرجعية` : "بدون إجابات"}</span>
                  ) : null}
                </p>
              </div>
              <span className="flex shrink-0 gap-1">
                <Button tone="quiet" className="min-h-10 px-3" onClick={() => setEditing(t)} aria-label={`تعديل ${t.topic_ar}`}>
                  <Glyph name="edit" className="size-[18px]" />
                </Button>
                <Button tone="quiet" className="min-h-10 px-3" onClick={() => remove(t)} aria-label={`حذف ${t.topic_ar}`}>
                  <Glyph name="trash" className="size-[18px]" />
                </Button>
              </span>
            </li>
          ))}
        </ul>
      ) : topics.length > 0 ? (
        <p className="text-[14px] text-mist">لا مواضيع تطابق البحث.</p>
      ) : null}
      <BulkBar
        count={sel.ids.size}
        visible={shown.length}
        onSelectAll={() => sel.setAll(shown.map((t) => t.id))}
        onClear={sel.clear}
        categories={categories}
        onMove={(category) => bulk({ category })}
        onDelete={() => bulk("delete")}
      />
      {editing ? (
        <HalbaTopicEditor
          hasAnswers={hasAnswers}
          topic={editing === "new" ? null : editing}
          categories={categories}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await refresh();
          }}
        />
      ) : null}
    </section>
  );
}

function HalbaTopicEditor({
  hasAnswers,
  topic,
  categories,
  onClose,
  onSaved,
}: {
  hasAnswers: boolean;
  topic: HalbaTopic | null;
  categories: string[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [text, setText] = useState(topic?.topic_ar ?? "");
  const [min, setMin] = useState(topic?.min_answers ?? 3);
  const [seconds, setSeconds] = useState(topic?.time_limit_sec ?? 30);
  const [category, setCategory] = useState(topic?.category ?? "");
  const [answers, setAnswers] = useState((topic?.answers ?? []).join("\n"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    const list = [...new Set(toList(answers))];
    const row = {
      topic_ar: text.trim(),
      min_answers: Math.round(min),
      time_limit_sec: Math.round(seconds),
      category: category.trim() || null,
      ...(hasAnswers ? { answers: list } : {}),
    };
    if (list.length > 400) return setError("الإجابات حدها 400.");
    if (row.topic_ar.length < 3) return setError("اكتب الموضوع.");
    if (!(row.min_answers >= 1 && row.min_answers <= 30)) return setError("أقل مزايدة بين 1 و30.");
    if (!(row.time_limit_sec >= 10 && row.time_limit_sec <= 180)) return setError("الوقت بين 10 و180 ثانية.");
    setBusy(true);
    setError(null);
    const { error: saveError } = topic
      ? await supabase.from("alhalba_topics").update(row).eq("id", topic.id)
      : await supabase.from("alhalba_topics").insert(row);
    setBusy(false);
    if (saveError) return setError(dbMessage(saveError));
    await onSaved();
  }

  return (
    <Sheet title={topic ? "تعديل موضوع الحلبة" : "موضوع جديد للحلبة"} onClose={onClose}>
      <form onSubmit={save} className="grid gap-4">
        <Field label="الموضوع" hint="مثل: دول تبدأ بحرف الميم. اللاعبون يزايدون على عدد إجاباته.">
          <input className={inputClass} value={text} maxLength={160} onChange={(e) => setText(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="المزايدة تبدأ من">
            <input type="number" inputMode="numeric" min={1} max={30} className={inputClass} value={min} onChange={(e) => setMin(Number(e.target.value))} />
          </Field>
          <Field label="وقت الإثبات (ثانية)">
            <input type="number" inputMode="numeric" min={10} max={180} step={5} className={inputClass} value={seconds} onChange={(e) => setSeconds(Number(e.target.value))} />
          </Field>
        </div>
        <Field label="الفئة (اختياري)">
          <input className={inputClass} list="halba-categories" value={category} onChange={(e) => setCategory(e.target.value)} />
        </Field>
        <datalist id="halba-categories">
          {categories.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        {hasAnswers ? (
          <Field label={`الإجابات المرجعية (${toList(answers).length})`} hint="إجابة في كل سطر. ما يكتبه اللاعب ويطابق إحداها يُقبل تلقائيًا (بدون تشكيل أو «ال»)، والباقي يحكم عليه الحَكَم. لا تظهر للاعبين.">
            <textarea className={textareaClass} value={answers} onChange={(e) => setAnswers(e.target.value)} rows={8} />
          </Field>
        ) : null}
        {error ? <Notice tone="error">{error}</Notice> : null}
        <Button type="submit" tone="primary" className="min-h-14 text-[17px]" disabled={busy}>
          {busy ? "جارٍ الحفظ…" : topic ? "حفظ التعديل" : "أضف الموضوع"}
        </Button>
      </form>
    </Sheet>
  );
}

function SearchBox({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <label className="relative min-w-0 flex-1 basis-60">
      <span className="sr-only">{label}</span>
      <input className={cx(inputClass, "min-h-11 ps-10")} value={value} onChange={(e) => onChange(e.target.value)} placeholder={label} />
      <Glyph name="search" className="pointer-events-none absolute start-3 top-1/2 size-5 -translate-y-1/2 text-faint" />
    </label>
  );
}
