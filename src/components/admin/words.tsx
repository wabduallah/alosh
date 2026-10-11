import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Glyph } from "@/components/brand";
import { Button, Field, inputClass } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { Loading, Notice, SetupNotice, Sheet, dbMessage, needsSetup, textareaClass, toList } from "./common";

type HeadsWord = { id: string; word: string; category_ar: string | null };
type Topic = { id: string; title_ar: string; words: string[] };

/** Words for «على راسك» and topics for «برة السالفة». Both need supabase/admin_panel.sql. */
export function WordsTab() {
  return (
    <div className="grid grid-cols-1 gap-8">
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
