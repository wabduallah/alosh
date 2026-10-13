import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Glyph } from "@/components/brand";
import { Button, Field, cx, inputClass } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { findCard } from "@/lib/catalog";
import { Notice, Sheet, dbMessage, selectClass, textareaClass, toList } from "./common";

/**
 * Adding a game: the admin fills in everything the site shows for it (name, icon, category,
 * players, rules for its page) and the development brief. The game appears as «قريبًا» until
 * its room is built; the brief is copied and sent for development. Needs supabase/admin_v4.sql.
 */

export type Brief = {
  idea?: string;
  screens?: string;
  settings?: string;
  content?: string;
  scoring?: string;
  similar?: string;
};
type Idea = {
  slug: string;
  status: "idea" | "building" | "ready";
  brief: Brief;
  updated_at: string;
  game?: { title_ar: string; description_ar: string; min_players: number; max_players: number; icon: string | null; category: string | null; how_to: { goal?: string; minutes?: string; steps?: string[] } | null; home_status: string };
};

const CATEGORIES = [
  { value: "talk", label: "كلام ونقاش" },
  { value: "words", label: "كلمات" },
  { value: "strategy", label: "تفكير وخطط" },
  { value: "classic", label: "مسابقات" },
];
const STATUS: Record<Idea["status"], { label: string; cls: string }> = {
  idea: { label: "فكرة", cls: "bg-deep-2 text-mist" },
  building: { label: "قيد التطوير", cls: "bg-gold/15 text-gold" },
  ready: { label: "جاهزة", cls: "bg-correct-fill/20 text-correct" },
};
const ERRORS: Record<string, string> = {
  BAD_SLUG: "المعرّف بالإنجليزية الصغيرة والأرقام، وقد يفصلها «-»، مثل ramadan-quiz.",
  BAD_TITLE: "الاسم بين حرفين و80 حرفًا.",
  BAD_PLAYERS: "عدد اللاعبين غير صحيح.",
  SLUG_TAKEN: "هذا المعرّف مستخدم للعبة أخرى.",
};

/** The text sent for development: everything about the game in one message. */
export function briefText(slug: string, g: NonNullable<Idea["game"]>, b: Brief) {
  const steps = g.how_to?.steps ?? [];
  return [
    `🎮 طلب تطوير لعبة جديدة في العش: ${g.title_ar} (${slug})`,
    "",
    `الأيقونة: ${g.icon ?? "-"} · التصنيف: ${CATEGORIES.find((c) => c.value === g.category)?.label ?? "-"} · اللاعبون: ${g.min_players}-${g.max_players}${g.how_to?.minutes ? ` · المدة: ${g.how_to.minutes}` : ""}`,
    `الوصف: ${g.description_ar || "-"}`,
    g.how_to?.goal ? `الهدف: ${g.how_to.goal}` : "",
    steps.length ? `خطوات اللعب:\n${steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}` : "",
    b.idea ? `\nالفكرة بالتفصيل:\n${b.idea}` : "",
    b.screens ? `\nالشاشات (التلفزيون، المضيف، جوال اللاعب):\n${b.screens}` : "",
    b.settings ? `\nإعدادات المضيف:\n${b.settings}` : "",
    b.content ? `\nالمحتوى (أسئلة، كلمات، مواضيع):\n${b.content}` : "",
    b.scoring ? `\nالنقاط والفوز:\n${b.scoring}` : "",
    b.similar ? `\nألعاب مشابهة للاستلهام:\n${b.similar}` : "",
  ]
    .filter((l) => l !== "")
    .join("\n");
}

/** The ideas list and the «لعبة جديدة» button, at the top of the games tab. */
export function NewGames({ onChanged }: { onChanged: () => Promise<void> }) {
  const [ideas, setIdeas] = useState<Idea[] | null>(null);
  const [setup, setSetup] = useState(false);
  const [editing, setEditing] = useState<Idea | "new" | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    if (!supabase) return;
    const { data, error: e } = await supabase.from("game_ideas").select("slug, status, brief, updated_at").order("updated_at", { ascending: false });
    if (e) {
      setSetup(true);
      setIdeas([]);
      return;
    }
    const slugs = ((data ?? []) as Idea[]).map((i) => i.slug);
    const { data: games } = slugs.length
      ? await supabase.from("games").select("slug, title_ar, description_ar, min_players, max_players, icon, category, how_to, home_status").in("slug", slugs)
      : { data: [] };
    const bySlug = new Map(((games ?? []) as Array<NonNullable<Idea["game"]> & { slug: string }>).map((g) => [g.slug, g]));
    setIdeas(((data ?? []) as Idea[]).map((i) => ({ ...i, game: bySlug.get(i.slug) })));
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function setStatus(i: Idea, status: Idea["status"]) {
    if (!supabase) return;
    const { error: e } = await supabase.from("game_ideas").update({ status, updated_at: new Date().toISOString() }).eq("slug", i.slug);
    if (e) return setError(dbMessage(e));
    await refresh();
  }

  async function remove(i: Idea) {
    if (!supabase) return;
    // Only games that exist just as an idea (no room built in the site) can be removed here.
    const { error: e } = await supabase.from("games").delete().eq("slug", i.slug);
    if (e) return setError(dbMessage(e, "تعذّر الحذف."));
    await refresh();
    await onChanged();
  }

  async function copy(i: Idea) {
    if (!i.game) return;
    try {
      await navigator.clipboard.writeText(briefText(i.slug, i.game, i.brief ?? {}));
      setCopied(i.slug);
      window.setTimeout(() => setCopied(null), 2500);
    } catch {
      setError("تعذّر النسخ. افتح الطلب وانسخه يدويًا.");
    }
  }

  if (setup) {
    return (
      <Notice tone="info">
        إضافة الألعاب الجديدة تحتاج الملف <code dir="ltr" className="rounded bg-night/60 px-1.5 py-0.5 text-[13px]">supabase/admin_v4.sql</code>.
      </Notice>
    );
  }

  return (
    <section className="surface grid gap-3 rounded-[24px] p-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 text-[20px] leading-8">
            <Glyph name="plus" className="size-5 text-gold" />
            ألعاب جديدة
          </h2>
          <p className="text-[13px] leading-6 text-mist">
            اكتب كل ما تحتاجه اللعبة: اسمها وأيقونتها وقواعدها لصفحتها في الموقع، وفكرتها للتطوير. تظهر في الموقع «قريبًا» مباشرة، وتنسخ طلب التطوير وترسله.
          </p>
        </div>
        <Button tone="primary" onClick={() => setEditing("new")}>
          <Glyph name="plus" className="size-[18px]" />
          لعبة جديدة
        </Button>
      </div>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {ideas && ideas.length > 0 ? (
        <ul className="grid gap-2">
          {ideas.map((i) => (
            <li key={i.slug} className="flex flex-wrap items-center gap-2 rounded-[16px] border border-line bg-deep-2/50 px-3 py-2">
              <span className="text-[24px]" aria-hidden="true">
                {i.game?.icon ?? "🎲"}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-semibold text-ivory">{i.game?.title_ar ?? i.slug}</span>
                <span className="text-[12px] text-faint">
                  <bdi>{i.slug}</bdi> · {i.game?.home_status === "hidden" ? "مخفية" : "قريبًا في الموقع"}
                </span>
              </span>
              <select
                className={cx(selectClass, "min-h-10 !w-36 py-1")}
                value={i.status}
                onChange={(e) => void setStatus(i, e.target.value as Idea["status"])}
                aria-label={`حالة ${i.game?.title_ar ?? i.slug}`}
              >
                {Object.entries(STATUS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.label}
                  </option>
                ))}
              </select>
              <Button tone="quiet" className="min-h-10 px-3" onClick={() => copy(i)}>
                <Glyph name={copied === i.slug ? "check" : "copy"} className="size-[18px]" />
                {copied === i.slug ? "نُسخ" : "انسخ طلب التطوير"}
              </Button>
              <Button tone="quiet" className="min-h-10 px-3" onClick={() => setEditing(i)} aria-label="تعديل">
                <Glyph name="edit" className="size-[18px]" />
              </Button>
              {!findCard(i.slug) ? (
                <Button tone="quiet" className="min-h-10 px-3" onClick={() => remove(i)} aria-label="حذف">
                  <Glyph name="trash" className="size-[18px]" />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : ideas ? (
        <p className="text-[14px] text-mist">لا توجد ألعاب جديدة بعد.</p>
      ) : null}
      {editing ? (
        <GameForm
          idea={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await refresh();
            await onChanged();
          }}
        />
      ) : null}
    </section>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="grid gap-3 rounded-[18px] border border-line bg-deep-2/40 p-4">
      <legend className="px-1 text-[15px] font-bold text-gold">{title}</legend>
      {children}
    </fieldset>
  );
}

function GameForm({ idea, onClose, onSaved }: { idea: Idea | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const g = idea?.game;
  const b = idea?.brief ?? {};
  const [slug, setSlug] = useState(idea?.slug ?? "");
  const [title, setTitle] = useState(g?.title_ar ?? "");
  const [icon, setIcon] = useState(g?.icon ?? "🎲");
  const [category, setCategory] = useState(g?.category ?? "talk");
  const [description, setDescription] = useState(g?.description_ar ?? "");
  const [min, setMin] = useState(g?.min_players ?? 3);
  const [max, setMax] = useState(g?.max_players ?? 10);
  const [minutes, setMinutes] = useState(g?.how_to?.minutes ?? "15 إلى 25 دقيقة");
  const [goal, setGoal] = useState(g?.how_to?.goal ?? "");
  const [steps, setSteps] = useState((g?.how_to?.steps ?? []).join("\n"));
  const [hidden, setHidden] = useState(g?.home_status === "hidden");
  const [brief, setBrief] = useState<Brief>(b);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setB = (k: keyof Brief, v: string) => setBrief((cur) => ({ ...cur, [k]: v }));

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    const how_to = { goal: goal.trim(), minutes: minutes.trim(), steps: toList(steps) };
    const cleanBrief = Object.fromEntries(Object.entries(brief).map(([k, v]) => [k, String(v ?? "").trim()]).filter(([, v]) => v));
    setBusy(true);
    setError(null);
    if (!idea) {
      const { data, error: e } = await supabase.rpc("admin_add_game", {
        p_game: { slug: slug.trim().toLowerCase(), title: title.trim(), description: description.trim(), min_players: min, max_players: max, icon: icon.trim(), category, how_to, home_status: hidden ? "hidden" : "soon" },
        p_brief: cleanBrief,
      });
      setBusy(false);
      if (e) return setError(dbMessage(e));
      const r = data as { ok: boolean; reason?: string };
      if (!r.ok) return setError(ERRORS[r.reason ?? ""] ?? "تعذّر الحفظ.");
    } else {
      const [a, c] = await Promise.all([
        supabase
          .from("games")
          .update({ title_ar: title.trim(), description_ar: description.trim(), min_players: min, max_players: max, icon: icon.trim() || null, category, how_to, home_status: hidden ? "hidden" : g?.home_status === "hidden" ? "soon" : g?.home_status })
          .eq("slug", idea.slug),
        supabase.from("game_ideas").update({ brief: cleanBrief, updated_at: new Date().toISOString() }).eq("slug", idea.slug),
      ]);
      setBusy(false);
      const e = a.error ?? c.error;
      if (e) return setError(dbMessage(e));
    }
    await onSaved();
  }

  return (
    <Sheet title={idea ? "تعديل اللعبة" : "لعبة جديدة"} onClose={onClose}>
      <form onSubmit={save} className="grid gap-4">
        <Section title="في الموقع">
          <div className="grid grid-cols-[1fr_auto] gap-3">
            <Field label="اسم اللعبة">
              <input className={inputClass} value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} placeholder="مثل: مسابقة رمضان" />
            </Field>
            <Field label="الأيقونة">
              <input className={cx(inputClass, "w-20 text-center text-[22px]")} value={icon} maxLength={8} onChange={(e) => setIcon(e.target.value)} aria-label="الأيقونة (إيموجي)" />
            </Field>
          </div>
          <Field label="المعرّف (بالإنجليزية)" hint="يظهر في رابط اللعبة: al3sh.app/games/المعرّف. لا يتغير بعد الحفظ.">
            <input dir="ltr" className={cx(inputClass, "text-start")} value={slug} disabled={!!idea} maxLength={40} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} placeholder="ramadan-quiz" />
          </Field>
          <Field label="الوصف المختصر" hint="سطر أو سطران في بطاقة اللعبة.">
            <textarea className={cx(textareaClass, "min-h-20")} value={description} maxLength={300} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="التصنيف">
              <select className={selectClass} value={category} onChange={(e) => setCategory(e.target.value)}>
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="أقل لاعبين">
              <input type="number" inputMode="numeric" min={1} max={100} className={inputClass} value={min} onChange={(e) => setMin(Number(e.target.value))} />
            </Field>
            <Field label="أكثر لاعبين">
              <input type="number" inputMode="numeric" min={1} max={100} className={inputClass} value={max} onChange={(e) => setMax(Number(e.target.value))} />
            </Field>
          </div>
          <label className="inline-flex items-center gap-2 text-[14px] text-ivory">
            <input type="checkbox" className="size-5 accent-[var(--color-gold)]" checked={hidden} onChange={(e) => setHidden(e.target.checked)} />
            مخفية عن الزوار (بدل «قريبًا»)
          </label>
        </Section>

        <Section title="صفحة اللعبة: كيف تُلعب؟">
          <Field label="الهدف">
            <input className={inputClass} value={goal} maxLength={200} onChange={(e) => setGoal(e.target.value)} placeholder="مثل: أجب أسرع واجمع أكثر النقاط." />
          </Field>
          <Field label="المدة">
            <input className={inputClass} value={minutes} maxLength={40} onChange={(e) => setMinutes(e.target.value)} />
          </Field>
          <Field label="خطوات اللعب" hint="خطوة في كل سطر.">
            <textarea className={textareaClass} value={steps} onChange={(e) => setSteps(e.target.value)} rows={5} />
          </Field>
        </Section>

        <Section title="طلب التطوير (لا يظهر للزوار)">
          <Field label="الفكرة بالتفصيل" hint="كيف تبدأ الجولة؟ ماذا يفعل كل لاعب؟ ومتى تنتهي؟">
            <textarea className={textareaClass} value={brief.idea ?? ""} onChange={(e) => setB("idea", e.target.value)} rows={5} />
          </Field>
          <Field label="الشاشات" hint="ماذا يظهر على التلفزيون، وعند المضيف، وفي جوال اللاعب؟ وهل فيها أسرار لا يراها الباقون؟">
            <textarea className={textareaClass} value={brief.screens ?? ""} onChange={(e) => setB("screens", e.target.value)} />
          </Field>
          <Field label="إعدادات المضيف" hint="مثل: عدد الجولات، المؤقت، فرق أو أفراد، التصنيفات.">
            <textarea className={textareaClass} value={brief.settings ?? ""} onChange={(e) => setB("settings", e.target.value)} />
          </Field>
          <Field label="المحتوى" hint="هل تحتاج أسئلة أو كلمات أو مواضيع؟ كم تقريبًا، ومن أين؟">
            <textarea className={textareaClass} value={brief.content ?? ""} onChange={(e) => setB("content", e.target.value)} />
          </Field>
          <Field label="النقاط والفوز">
            <textarea className={textareaClass} value={brief.scoring ?? ""} onChange={(e) => setB("scoring", e.target.value)} />
          </Field>
          <Field label="ألعاب مشابهة (اختياري)">
            <input className={inputClass} value={brief.similar ?? ""} onChange={(e) => setB("similar", e.target.value)} />
          </Field>
        </Section>

        {error ? <Notice tone="error">{error}</Notice> : null}
        <Button type="submit" tone="primary" className="min-h-14 text-[17px]" disabled={busy}>
          {busy ? "جارٍ الحفظ…" : idea ? "حفظ التعديل" : "أضف اللعبة"}
        </Button>
      </form>
    </Sheet>
  );
}
