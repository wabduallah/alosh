import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Glyph } from "@/components/brand";
import { Button, Field, inputClass } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { Loading, Notice, SetupNotice, Sheet, dbMessage, needsSetup, textareaClass, toList } from "./common";

type HeadsWord = { id: string; word: string; category_ar: string | null };
type Topic = { id: string; title_ar: string; words: string[] };
type HalbaTopic = { id: string; topic_ar: string; min_answers: number; time_limit_sec: number; category: string | null };

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

  const groups = useMemo(() => {
    const map = new Map<string, HeadsWord[]>();
    for (const w of words ?? []) {
      const key = w.category_ar ?? "بدون فئة";
      map.set(key, [...(map.get(key) ?? []), w]);
    }
    return [...map.entries()];
  }, [words]);

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
                <li key={w.id} className="inline-flex min-h-10 items-center gap-1 rounded-full border border-line bg-deep-2/60 ps-3.5 pe-1 text-[15px] text-ivory">
                  {w.word}
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

  async function refresh() {
    if (!supabase) return;
    const { data, error: loadError } = await supabase
      .from("alhalba_topics")
      .select("id, topic_ar, min_answers, time_limit_sec, category")
      .order("category")
      .order("topic_ar");
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
      {topics === null ? (
        <Loading />
      ) : topics.length > 0 ? (
        <ul className="surface grid gap-2 rounded-[22px] p-3 sm:p-4">
          {topics.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[14px] border border-line bg-deep-2/50 px-3 py-2">
              <span className="min-w-0 flex-1 text-[15px] text-ivory">{t.topic_ar}</span>
              {t.category ? <span className="rounded-full bg-violet/25 px-2.5 py-0.5 text-[12px] text-violet-text">{t.category}</span> : null}
              <span className="text-[13px] text-mist">
                يبدأ من {t.min_answers} · {t.time_limit_sec} ث
              </span>
              <span className="flex gap-1">
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
      ) : null}
      {editing ? (
        <HalbaTopicEditor
          topic={editing === "new" ? null : editing}
          categories={[...new Set((topics ?? []).map((t) => t.category).filter((c): c is string => !!c))]}
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
  topic,
  categories,
  onClose,
  onSaved,
}: {
  topic: HalbaTopic | null;
  categories: string[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [text, setText] = useState(topic?.topic_ar ?? "");
  const [min, setMin] = useState(topic?.min_answers ?? 3);
  const [seconds, setSeconds] = useState(topic?.time_limit_sec ?? 30);
  const [category, setCategory] = useState(topic?.category ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    const row = { topic_ar: text.trim(), min_answers: Math.round(min), time_limit_sec: Math.round(seconds), category: category.trim() || null };
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
        {error ? <Notice tone="error">{error}</Notice> : null}
        <Button type="submit" tone="primary" className="min-h-14 text-[17px]" disabled={busy}>
          {busy ? "جارٍ الحفظ…" : topic ? "حفظ التعديل" : "أضف الموضوع"}
        </Button>
      </form>
    </Sheet>
  );
}
