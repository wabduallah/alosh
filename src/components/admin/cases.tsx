import { useEffect, useState, type ReactNode } from "react";
import { Glyph } from "@/components/brand";
import { Button, Field, cx, inputClass } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { KINDS, WIN_LABELS, type CourtKind } from "@/components/court";
import { Loading, Notice, Sheet, Toggle, dbMessage, selectClass, textareaClass } from "./common";

/**
 * «القضايا»: the cases of «المحكمة». Each case is a story, the truth (guilty or not, and why),
 * role cards with their secrets, and evidence for each round. Added or changed here, a case is
 * playable at once, with no code change. Needs supabase/court_v1.sql.
 */

type RoleKind = Exclude<CourtKind, "juror">;
type Role = {
  key: string;
  kind: RoleKind;
  name: string;
  brief?: string;
  secret: string;
  later?: string;
  later_stage?: number;
  optional?: boolean;
  /** For an optional role: what it knows, shown as evidence when nobody plays it. */
  fallback?: string;
  fallback_stage?: number;
  /** How a witness or detective wins (court_v3.sql); the accused, prosecutor and lawyer are fixed. */
  win?: "truth" | "convict" | "acquit";
  /** A secret goal; the host gives 100 points when it is achieved. */
  goal?: string;
};
type Suspect = { key: string; name: string };
type Evidence = { stage: number; icon?: string; title: string; text: string; time?: string };
type Stat = { case_id: string; plays: number; correct: number; convicted: number; last: string };
export type CourtCase = {
  id?: string;
  slug?: string | null;
  title: string;
  category: string | null;
  difficulty: number;
  summary: string;
  intro: string;
  guilty: boolean;
  truth: string;
  roles: Role[];
  evidence: Evidence[];
  is_active: boolean;
  suspects?: Suspect[] | null;
  culprit?: string | null;
  juror_clues?: string[];
};

const ROLE_KINDS: RoleKind[] = ["accused", "prosecutor", "lawyer", "detective", "witness"];
const LEVELS = [
  { value: 1, label: "سهلة" },
  { value: 2, label: "متوسطة" },
  { value: 3, label: "صعبة" },
];
const FIELDS = "id, slug, title, category, difficulty, summary, intro, guilty, truth, roles, evidence, is_active, suspects, culprit, juror_clues";
const FIELDS_V2 = "id, slug, title, category, difficulty, summary, intro, guilty, truth, roles, evidence, is_active";

const blank = (): CourtCase => ({
  title: "",
  category: "",
  difficulty: 2,
  summary: "",
  intro: "",
  guilty: true,
  truth: "",
  is_active: true,
  roles: [
    { key: "accused", kind: "accused", name: "", brief: "", secret: "" },
    { key: "prosecutor", kind: "prosecutor", name: "المدعي العام", brief: "يمثل الادعاء.", secret: "" },
    { key: "lawyer", kind: "lawyer", name: "المحامي", brief: "يدافع عن المتهم.", secret: "" },
    { key: "w1", kind: "witness", name: "", brief: "", secret: "" },
    { key: "detective", kind: "detective", name: "", brief: "", secret: "", optional: true },
  ],
  evidence: [
    { stage: 1, icon: "📄", title: "", text: "" },
    { stage: 2, icon: "📄", title: "", text: "" },
  ],
});

/** The same checks as the database, with a clear message before saving. */
function problems(c: CourtCase): string[] {
  const out: string[] = [];
  if (c.title.trim().length < 2) out.push("اكتب عنوان القضية.");
  if (c.intro.trim().length < 20) out.push("القصة قصيرة جدًا (20 حرفًا على الأقل).");
  if (c.truth.trim().length < 10) out.push("اكتب الحقيقة التي تُكشف في النهاية.");
  for (const k of ["accused", "prosecutor", "lawyer"] as const) {
    const n = c.roles.filter((r) => r.kind === k).length;
    if (n !== 1) out.push(`تحتاج القضية ${KINDS[k].label} واحدًا (الموجود ${n}).`);
  }
  if (c.roles.some((r) => (r.kind === "accused" || r.kind === "prosecutor" || r.kind === "lawyer") && r.optional)) out.push("المتهم والمدعي والمحامي أدوار أساسية.");
  if (c.roles.filter((r) => !r.optional).length < 4) out.push("تحتاج 4 أدوار أساسية على الأقل (أضف شاهدًا أو محققًا أساسيًا).");
  if (c.roles.length > 12) out.push("الأدوار 12 كحد أقصى.");
  c.roles.forEach((r, i) => {
    if (r.name.trim().length < 2) out.push(`الدور ${i + 1}: اكتب الاسم.`);
    if (r.secret.trim().length < 5) out.push(`الدور ${i + 1} (${r.name || KINDS[r.kind].label}): اكتب المعلومة السرية.`);
  });
  const sus = (c.suspects ?? []).filter((x) => x.name.trim());
  if (sus.length === 1) out.push("أضف مشتبهًا ثانيًا، أو احذف القائمة.");
  if (sus.length > 6) out.push("المشتبهون 6 كحد أقصى.");
  if (sus.length >= 2 && !sus.some((x) => x.key === c.culprit)) out.push("اختر الفاعل الحقيقي من قائمة المشتبهين.");
  if ((c.juror_clues ?? []).filter((x) => x.trim()).length > 12) out.push("معلومات المحلّفين 12 كحد أقصى.");
  if (c.evidence.length < 2) out.push("أضف دليلين على الأقل.");
  if (c.evidence.length > 15) out.push("الأدلة 15 كحد أقصى.");
  if (!c.evidence.some((e) => e.stage === 1)) out.push("أضف دليلًا في الجولة الأولى.");
  c.evidence.forEach((e, i) => {
    if (e.title.trim().length < 2 || e.text.trim().length < 5) out.push(`الدليل ${i + 1}: اكتب العنوان والنص.`);
  });
  return out;
}

/** Cleans a case for saving or export. */
function clean(c: CourtCase): CourtCase {
  const keys = new Set<string>();
  return {
    ...c,
    title: c.title.trim(),
    category: c.category?.trim() || null,
    summary: c.summary.trim(),
    intro: c.intro.trim(),
    truth: c.truth.trim(),
    roles: c.roles.map((r, i) => {
      let key = (r.key || r.kind).trim() || `r${i + 1}`;
      while (keys.has(key)) key = `${key}-${i + 1}`;
      keys.add(key);
      const later = r.later?.trim() || undefined;
      const fallback = r.optional ? r.fallback?.trim() || undefined : undefined;
      return {
        key,
        kind: r.kind,
        name: r.name.trim(),
        brief: r.brief?.trim() || undefined,
        secret: r.secret.trim(),
        ...(later ? { later, later_stage: r.later_stage ?? 2 } : {}),
        ...(r.optional ? { optional: true } : {}),
        ...(fallback ? { fallback, fallback_stage: r.fallback_stage ?? 2 } : {}),
        ...((r.kind === "witness" || r.kind === "detective") && r.win && r.win !== "truth" ? { win: r.win } : {}),
        ...(r.goal?.trim() ? { goal: r.goal.trim() } : {}),
      };
    }),
    ...(() => {
      const sus = (c.suspects ?? []).map((x, i) => ({ key: x.key || `s${i + 1}`, name: x.name.trim() })).filter((x) => x.name);
      return sus.length >= 2 ? { suspects: sus, culprit: sus.some((x) => x.key === c.culprit) ? c.culprit : null } : { suspects: null, culprit: null };
    })(),
    juror_clues: (c.juror_clues ?? []).map((x) => x.trim()).filter(Boolean),
    evidence: c.evidence.map((e) => ({ stage: e.stage, icon: e.icon?.trim() || "📄", title: e.title.trim(), text: e.text.trim(), ...(e.time?.trim() ? { time: e.time.trim() } : {}) })),
  };
}

function serverError(e: { message?: string; code?: string }) {
  const m = e.message ?? "";
  const i = m.indexOf("BAD_CASE:");
  return i >= 0 ? m.slice(i + 9).trim() : dbMessage(e);
}

export function CasesTab() {
  const [cases, setCases] = useState<CourtCase[] | null>(null);
  const [setup, setSetup] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [editing, setEditing] = useState<CourtCase | null>(null);
  const [importing, setImporting] = useState(false);
  const [filter, setFilter] = useState<"all" | "guilty" | "innocent" | "off">("all");
  const [stats, setStats] = useState<Record<string, Stat>>({});
  const [preview, setPreview] = useState<CourtCase | null>(null);

  async function refresh() {
    if (!supabase) return;
    let res = await supabase.from("court_cases").select(FIELDS).order("created_at");
    // Before court_v3.sql the case has no suspects or juror clues.
    if (res.error && /column|schema cache/i.test(res.error.message)) res = await supabase.from("court_cases").select(FIELDS_V2).order("created_at");
    const { data, error: e } = res;
    if (e) {
      const missing = e.code === "42P01" || e.code === "PGRST205" || /does not exist|schema cache/i.test(e.message);
      setSetup(missing);
      if (!missing) setError(dbMessage(e, "تعذّر تحميل القضايا."));
      setCases([]);
      return;
    }
    setCases((data ?? []) as CourtCase[]);
    const { data: st } = await supabase.rpc("court_case_stats");
    if (Array.isArray(st)) setStats(Object.fromEntries((st as Stat[]).map((x) => [x.case_id, x])));
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function toggle(c: CourtCase) {
    if (!supabase || !c.id) return;
    const { error: e } = await supabase.from("court_cases").update({ is_active: !c.is_active }).eq("id", c.id);
    if (e) return setError(serverError(e));
    await refresh();
  }

  async function remove(c: CourtCase) {
    if (!supabase || !c.id) return;
    if (!window.confirm(`حذف قضية «${c.title}» نهائيًا؟`)) return;
    const { error: e } = await supabase.from("court_cases").delete().eq("id", c.id);
    if (e) return setError(serverError(e));
    await refresh();
  }

  async function exportAll(list: CourtCase[]) {
    const json = JSON.stringify(list.map((c) => {
      const { id: _id, ...rest } = clean(c);
      void _id;
      return rest;
    }), null, 2);
    try {
      await navigator.clipboard.writeText(json);
      setNote(`نُسخت ${list.length === 1 ? "القضية" : `${list.length} قضايا`} بصيغة JSON.`);
    } catch {
      setError("تعذّر النسخ.");
    }
  }

  if (setup) {
    return (
      <Notice tone="info">
        القضايا تحتاج الملفين <code dir="ltr" className="rounded bg-night/60 px-1.5 py-0.5 text-[13px]">supabase/court_v1.sql</code> ثم{" "}
        <code dir="ltr" className="rounded bg-night/60 px-1.5 py-0.5 text-[13px]">supabase/court_cases_v1.sql</code>.
      </Notice>
    );
  }
  if (cases === null) return <Loading />;

  const shown = cases.filter((c) => (filter === "all" ? true : filter === "off" ? !c.is_active : filter === "guilty" ? c.guilty : !c.guilty));
  const guilty = cases.filter((c) => c.guilty).length;

  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 text-[20px] leading-8">⚖️ قضايا المحكمة</h2>
          <p className="text-[13px] leading-6 text-mist">
            {cases.length} قضية: المتهم مذنب في {guilty}، وبريء في {cases.length - guilty}. القضية الجديدة تُلعب فورًا بلا برمجة. الأفضل أن يتوازن المذنب والبريء حتى لا يتوقع اللاعبون الحكم.
          </p>
        </div>
        <Button tone="quiet" onClick={() => setImporting(true)}>
          <Glyph name="copy" className="size-[18px]" />
          استيراد JSON
        </Button>
        <Button tone="quiet" onClick={() => exportAll(cases)} disabled={!cases.length}>
          تصدير الكل
        </Button>
        <Button tone="primary" onClick={() => setEditing(blank())}>
          <Glyph name="plus" className="size-[18px]" />
          قضية جديدة
        </Button>
      </div>
      <div role="group" aria-label="تصفية القضايا" className="flex flex-wrap gap-2">
        {(
          [
            ["all", "الكل"],
            ["guilty", "المتهم مذنب"],
            ["innocent", "المتهم بريء"],
            ["off", "موقوفة"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            aria-pressed={filter === k}
            onClick={() => setFilter(k)}
            className={cx("min-h-10 rounded-full border px-4 text-[14px] font-semibold", filter === k ? "btn-gold border-transparent" : "border-line-strong/70 bg-deep-2/50 text-mist hover:text-ivory")}
          >
            {label}
          </button>
        ))}
      </div>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {note ? <Notice tone="ok">{note}</Notice> : null}
      {shown.length === 0 ? <Notice tone="info">لا توجد قضايا هنا.</Notice> : null}
      <ul className="grid gap-3 lg:grid-cols-2">
        {shown.map((c) => {
          const required = c.roles.filter((r) => !r.optional).length;
          return (
            <li key={c.id} className={cx("surface grid gap-2 rounded-[20px] p-4", !c.is_active && "opacity-60")}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 text-[17px] font-bold text-ivory">{c.title}</span>
                <span className={cx("rounded-full px-2.5 py-0.5 text-[12px] font-semibold", c.guilty ? "bg-wrong-fill/20 text-wrong" : "bg-correct-fill/20 text-correct")}>
                  {c.guilty ? "مذنب" : "بريء"}
                </span>
                <span className="rounded-full bg-deep-2 px-2.5 py-0.5 text-[12px] text-mist">{LEVELS.find((l) => l.value === c.difficulty)?.label}</span>
              </div>
              <p className="text-[13px] leading-6 text-mist">{c.summary || c.intro.slice(0, 120)}</p>
              <CaseStat stat={c.id ? stats[c.id] : undefined} guilty={c.guilty} />
              <p className="text-[12px] text-faint">
                {c.category ? `${c.category} · ` : ""}
                {c.roles.length} أدوار ({Math.max(4, required)} لاعبين على الأقل) · {c.evidence.length} أدلة في {new Set(c.evidence.map((e) => e.stage)).size} جولات
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Toggle checked={c.is_active} onChange={() => void toggle(c)} label={c.is_active ? "متاحة" : "موقوفة"} />
                <span className="flex-1" />
                <Button tone="quiet" className="min-h-10 px-3" onClick={() => setPreview(c)}>
                  ▶️ جرّب
                </Button>
                <Button tone="quiet" className="min-h-10 px-3" onClick={() => setEditing(c)}>
                  <Glyph name="edit" className="size-[18px]" />
                  تعديل
                </Button>
                <Button tone="quiet" className="min-h-10 px-3" onClick={() => setEditing({ ...c, id: undefined, slug: null, title: `${c.title} (نسخة)` })} aria-label="نسخة">
                  <Glyph name="copy" className="size-[18px]" />
                </Button>
                <Button tone="quiet" className="min-h-10 px-3" onClick={() => exportAll([c])}>
                  JSON
                </Button>
                <Button tone="quiet" className="min-h-10 px-3" onClick={() => remove(c)} aria-label="حذف">
                  <Glyph name="trash" className="size-[18px]" />
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
      {editing ? (
        <CaseEditor
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            setNote("حُفظت القضية.");
            await refresh();
          }}
        />
      ) : null}
      {preview ? <PreviewSheet c={preview} onClose={() => setPreview(null)} /> : null}
      {importing ? (
        <ImportSheet
          onClose={() => setImporting(false)}
          onDone={async (n) => {
            setImporting(false);
            setNote(`استُوردت ${n} ${n === 1 ? "قضية" : "قضايا"}.`);
            await refresh();
          }}
        />
      ) : null}
    </div>
  );
}

function Box({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <fieldset className="grid gap-3 rounded-[18px] border border-line bg-deep-2/40 p-4">
      <legend className="flex items-center gap-2 px-1 text-[15px] font-bold text-gold">{title}</legend>
      {action ? <div className="-mt-1">{action}</div> : null}
      {children}
    </fieldset>
  );
}

function CaseEditor({ initial, onClose, onSaved }: { initial: CourtCase; onClose: () => void; onSaved: () => Promise<void> }) {
  const [c, setC] = useState<CourtCase>(() => ({ ...initial, category: initial.category ?? "", roles: initial.roles.map((r) => ({ ...r })), evidence: initial.evidence.map((e) => ({ ...e })) }));
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [trying, setTrying] = useState(false);
  const set = <K extends keyof CourtCase>(k: K, v: CourtCase[K]) => setC((cur) => ({ ...cur, [k]: v }));
  const setRole = (i: number, patch: Partial<Role>) => setC((cur) => ({ ...cur, roles: cur.roles.map((r, j) => (j === i ? { ...r, ...patch } : r)) }));
  const setEv = (i: number, patch: Partial<Evidence>) => setC((cur) => ({ ...cur, evidence: cur.evidence.map((e, j) => (j === i ? { ...e, ...patch } : e)) }));
  const move = (i: number, d: number) =>
    setC((cur) => {
      const roles = [...cur.roles];
      const j = i + d;
      if (j < 0 || j >= roles.length) return cur;
      [roles[i], roles[j]] = [roles[j], roles[i]];
      return { ...cur, roles };
    });

  async function save() {
    if (!supabase) return;
    const p = problems(c);
    setErrors(p);
    if (p.length) return;
    const row = clean(c);
    setBusy(true);
    const payload = {
      title: row.title,
      category: row.category,
      difficulty: row.difficulty,
      summary: row.summary,
      intro: row.intro,
      guilty: row.guilty,
      truth: row.truth,
      roles: row.roles,
      evidence: row.evidence,
      is_active: row.is_active,
      suspects: row.suspects,
      culprit: row.culprit,
      juror_clues: row.juror_clues,
    };
    const { error: e } = c.id ? await supabase.from("court_cases").update(payload).eq("id", c.id) : await supabase.from("court_cases").insert(payload);
    setBusy(false);
    if (e) return setErrors([serverError(e)]);
    await onSaved();
  }

  return (
    <Sheet title={c.id ? "تعديل القضية" : "قضية جديدة"} onClose={onClose}>
      <div className="grid gap-4">
        <Box title="القضية">
          <Field label="العنوان">
            <input className={inputClass} value={c.title} maxLength={80} onChange={(e) => set("title", e.target.value)} placeholder="مثل: اختفاء مبلغ من خزنة الشركة" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="النوع">
              <input className={inputClass} value={c.category ?? ""} maxLength={40} onChange={(e) => set("category", e.target.value)} placeholder="سرقة، حادث…" />
            </Field>
            <Field label="الصعوبة">
              <select className={selectClass} value={c.difficulty} onChange={(e) => set("difficulty", Number(e.target.value))}>
                {LEVELS.map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="سطر للمضيف" hint="يظهر عند اختيار القضية. لا تكشف فيه الحقيقة.">
            <input className={inputClass} value={c.summary} maxLength={300} onChange={(e) => set("summary", e.target.value)} />
          </Field>
          <Field label="القصة" hint="تظهر للجميع على الشاشة في البداية: ماذا حدث، ومن المتهم، ولماذا.">
            <textarea className={textareaClass} value={c.intro} maxLength={2000} rows={5} onChange={(e) => set("intro", e.target.value)} />
          </Field>
          <Toggle checked={c.is_active} onChange={(v) => set("is_active", v)} label="متاحة للعب" />
        </Box>

        <Box title="الحقيقة (تُكشف بعد الحكم)">
          <div role="radiogroup" aria-label="الحقيقة" className="grid grid-cols-2 gap-2">
            {[
              { v: true, label: "المتهم مذنب", cls: "border-wrong bg-wrong-fill/20 text-wrong" },
              { v: false, label: "المتهم بريء", cls: "border-correct bg-correct-fill/20 text-correct" },
            ].map((o) => (
              <button
                key={String(o.v)}
                type="button"
                role="radio"
                aria-checked={c.guilty === o.v}
                onClick={() => set("guilty", o.v)}
                className={cx("min-h-12 rounded-[14px] border-2 text-[16px] font-bold", c.guilty === o.v ? o.cls : "border-line-strong/70 text-mist")}
              >
                {o.label}
              </button>
            ))}
          </div>
          <Field label="ماذا حدث فعلًا؟" hint="اشرح الحقيقة وكيف تربط الأدلة بها. هذا ما يقرؤه الجميع بعد الحكم.">
            <textarea className={textareaClass} value={c.truth} maxLength={2000} rows={4} onChange={(e) => set("truth", e.target.value)} />
          </Field>
        </Box>

        <Box
          title="من الفاعل الحقيقي؟ (اختياري)"
          action={<p className="text-[13px] leading-6 text-mist">سؤال ثانٍ في التصويت، ومن يعرف الفاعل يكسب 150. ضع المتهم بين المشتبهين، واختر الفاعل بالدائرة. في القضايا البريئة يصير هذا أمتع سؤال.</p>}
        >
          {(c.suspects ?? []).map((x, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="radio"
                name="culprit"
                className="size-5 accent-[var(--color-gold)]"
                checked={c.culprit === x.key}
                onChange={() => set("culprit", x.key)}
                aria-label={`${x.name || "المشتبه"} هو الفاعل`}
              />
              <input
                className={inputClass}
                value={x.name}
                maxLength={60}
                onChange={(e) => set("suspects", (c.suspects ?? []).map((y, j) => (j === i ? { ...y, name: e.target.value } : y)))}
                placeholder="اسم المشتبه، مثل: المدير"
                aria-label="اسم المشتبه"
              />
              <button type="button" className="grid size-9 shrink-0 place-items-center rounded-full text-mist hover:text-wrong" onClick={() => set("suspects", (c.suspects ?? []).filter((_, j) => j !== i))} aria-label="حذف المشتبه">
                <Glyph name="trash" className="size-4" />
              </button>
            </div>
          ))}
          {(c.suspects ?? []).length < 6 ? (
            <Button tone="quiet" onClick={() => set("suspects", [...(c.suspects ?? []), { key: `s${Date.now().toString(36)}`, name: "" }])}>
              <Glyph name="plus" className="size-[18px]" />
              أضف مشتبهًا
            </Button>
          ) : null}
        </Box>

        <Box title="معلومات المحلّفين (اختياري)" action={<p className="text-[13px] leading-6 text-mist">كل محلّف يسحب معلومة واحدة عشوائيًا في جواله: حقيقة صغيرة أو شك قد يضلل. سطر لكل معلومة.</p>}>
          <textarea
            className={textareaClass}
            rows={4}
            value={(c.juror_clues ?? []).join("\n")}
            onChange={(e) => set("juror_clues", e.target.value.split("\n"))}
            placeholder={"مثل: المدير اشترى سيارة جديدة الشهر الماضي.\nشوهد ضوء في مكتب المدير ليلة الحادثة."}
          />
        </Box>

        <Box
          title={`الأدوار (${c.roles.length})`}
          action={
            <p className="text-[13px] leading-6 text-mist">
              الترتيب مهم: الأدوار الأساسية لكل جلسة، والاختيارية تُضاف بالترتيب إذا زاد اللاعبون، ومن يبقى يصير محلّفًا. أقل عدد لاعبين = عدد الأدوار الأساسية (4 على الأقل).
            </p>
          }
        >
          {c.roles.map((r, i) => (
            <div key={i} className="grid gap-2 rounded-[16px] border border-line-strong/50 bg-night/40 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[20px]" aria-hidden="true">
                  {KINDS[r.kind].icon}
                </span>
                <select className={cx(selectClass, "min-h-10 !w-36 py-1")} value={r.kind} onChange={(e) => setRole(i, { kind: e.target.value as RoleKind })} aria-label="نوع الدور">
                  {ROLE_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {KINDS[k].label}
                    </option>
                  ))}
                </select>
                <label className="inline-flex items-center gap-1.5 text-[13px] text-mist">
                  <input type="checkbox" className="size-4 accent-[var(--color-gold)]" checked={!!r.optional} disabled={r.kind === "accused" || r.kind === "prosecutor" || r.kind === "lawyer"} onChange={(e) => setRole(i, { optional: e.target.checked })} />
                  اختياري
                </label>
                <span className="flex-1" />
                <button type="button" className="grid size-9 place-items-center rounded-full text-mist hover:text-ivory disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)} aria-label="لأعلى">
                  ▲
                </button>
                <button type="button" className="grid size-9 place-items-center rounded-full text-mist hover:text-ivory disabled:opacity-30" disabled={i === c.roles.length - 1} onClick={() => move(i, 1)} aria-label="لأسفل">
                  ▼
                </button>
                <button type="button" className="grid size-9 place-items-center rounded-full text-mist hover:text-wrong" onClick={() => set("roles", c.roles.filter((_, j) => j !== i))} aria-label="حذف الدور">
                  <Glyph name="trash" className="size-4" />
                </button>
              </div>
              <input className={inputClass} value={r.name} maxLength={60} onChange={(e) => setRole(i, { name: e.target.value })} placeholder="الاسم في القصة، مثل: نورة، موظفة الاستقبال" aria-label="الاسم" />
              <input className={inputClass} value={r.brief ?? ""} maxLength={160} onChange={(e) => setRole(i, { brief: e.target.value })} placeholder="وصف معلن يراه الجميع (اختياري)" aria-label="الوصف المعلن" />
              <textarea className={cx(textareaClass, "min-h-20")} value={r.secret} maxLength={800} onChange={(e) => setRole(i, { secret: e.target.value })} placeholder="🔒 المعلومة السرية: ما يعرفه، وما يخفيه، وكيف يتصرف." aria-label="المعلومة السرية" />
              <input className={inputClass} value={r.goal ?? ""} maxLength={200} onChange={(e) => setRole(i, { goal: e.target.value })} placeholder="🎯 هدف سري (اختياري)، مثل: لا تكشف علاقتك بالمدير" aria-label="هدف سري" />
              {r.kind === "witness" || r.kind === "detective" ? (
                <label className="flex items-center gap-2 text-[14px] text-ivory">
                  🏆 يفوز بـ
                  <select className={cx(selectClass, "min-h-10 !w-44 py-1")} value={r.win ?? "truth"} onChange={(e) => setRole(i, { win: e.target.value as Role["win"] })}>
                    <option value="truth">الحكم الصحيح (صادق)</option>
                    <option value="convict">إدانة المتهم (شريك أو كاذب)</option>
                    <option value="acquit">تبرئة المتهم (يحميه)</option>
                  </select>
                </label>
              ) : (
                <p className="text-[12px] text-faint">🏆 {r.kind === "accused" ? "يفوز إذا بُرّئ." : r.kind === "prosecutor" ? "يفوز إذا أُدين المتهم، وله مكافأة إذا كان الحكم صحيحًا." : "يفوز إذا بُرّئ موكله، وله مكافأة إذا كان الحكم صحيحًا."}</p>
              )}
              {r.optional ? (
                <div className="grid grid-cols-[1fr_auto] gap-2">
                  <textarea
                    className={cx(textareaClass, "min-h-16")}
                    value={r.fallback ?? ""}
                    maxLength={600}
                    onChange={(e) => setRole(i, { fallback: e.target.value })}
                    placeholder="🗂️ إفادته إذا لم يلعبه أحد: تظهر دليلًا للجميع (مستحسن حتى لا تضيع معلوماته المهمة)"
                    aria-label="إفادة بديلة"
                  />
                  <select className={cx(selectClass, "!w-28")} value={r.fallback_stage ?? 2} onChange={(e) => setRole(i, { fallback_stage: Number(e.target.value) })} aria-label="جولة الإفادة">
                    {[1, 2, 3].map((n) => (
                      <option key={n} value={n}>
                        الجولة {n}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <textarea className={cx(textareaClass, "min-h-16")} value={r.later ?? ""} maxLength={600} onChange={(e) => setRole(i, { later: e.target.value })} placeholder="✉️ معلومة تصله لاحقًا (اختياري)" aria-label="معلومة لاحقة" />
                <select className={cx(selectClass, "!w-28")} value={r.later_stage ?? 2} onChange={(e) => setRole(i, { later_stage: Number(e.target.value) })} aria-label="تصله في الجولة">
                  {[1, 2, 3].map((n) => (
                    <option key={n} value={n}>
                      الجولة {n}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ))}
          {c.roles.length < 12 ? (
            <Button tone="quiet" onClick={() => set("roles", [...c.roles, { key: `r${Date.now().toString(36)}`, kind: "witness", name: "", brief: "", secret: "", optional: true }])}>
              <Glyph name="plus" className="size-[18px]" />
              أضف دورًا
            </Button>
          ) : null}
        </Box>

        <Box
          title={`الأدلة (${c.evidence.length})`}
          action={
            <p className="text-[13px] leading-6 text-mist">
              أدلة كل جولة تظهر معًا، وبعدها استجواب. ضع الدليل الذي يقلب القضية في الجولة الثانية، وأضف دليلًا يضلل. اكتب الوقت (مثل 9:20) ليظهر الدليل على الخط الزمني.
            </p>
          }
        >
          {c.evidence.map((e, i) => (
            <div key={i} className="grid gap-2 rounded-[16px] border border-line-strong/50 bg-night/40 p-3">
              <div className="flex items-center gap-2">
                <input className={cx(inputClass, "!w-16 text-center text-[20px]")} value={e.icon ?? ""} maxLength={8} onChange={(ev) => setEv(i, { icon: ev.target.value })} aria-label="أيقونة" />
                <input dir="ltr" className={cx(inputClass, "!w-24 text-center")} value={e.time ?? ""} maxLength={8} onChange={(ev) => setEv(i, { time: ev.target.value })} placeholder="9:20" aria-label="الوقت (للخط الزمني)" />
                <select className={cx(selectClass, "!w-32")} value={e.stage} onChange={(ev) => setEv(i, { stage: Number(ev.target.value) })} aria-label="الجولة">
                  {[1, 2, 3].map((n) => (
                    <option key={n} value={n}>
                      الجولة {n}
                    </option>
                  ))}
                </select>
                <span className="flex-1" />
                <button type="button" className="grid size-9 place-items-center rounded-full text-mist hover:text-wrong" onClick={() => set("evidence", c.evidence.filter((_, j) => j !== i))} aria-label="حذف الدليل">
                  <Glyph name="trash" className="size-4" />
                </button>
              </div>
              <input className={inputClass} value={e.title} maxLength={60} onChange={(ev) => setEv(i, { title: ev.target.value })} placeholder="العنوان، مثل: سجل الخزنة" aria-label="العنوان" />
              <textarea className={cx(textareaClass, "min-h-16")} value={e.text} maxLength={400} onChange={(ev) => setEv(i, { text: ev.target.value })} placeholder="ما يقوله الدليل، مثل: فُتحت الخزنة الساعة 9:20 مساءً." aria-label="النص" />
            </div>
          ))}
          {c.evidence.length < 15 ? (
            <Button tone="quiet" onClick={() => set("evidence", [...c.evidence, { stage: Math.max(1, ...c.evidence.map((e) => e.stage)), icon: "📄", title: "", text: "" }])}>
              <Glyph name="plus" className="size-[18px]" />
              أضف دليلًا
            </Button>
          ) : null}
        </Box>

        {errors.length ? (
          <Notice tone="error">
            <span className="grid gap-0.5">
              {errors.slice(0, 6).map((x) => (
                <span key={x}>{x}</span>
              ))}
            </span>
          </Notice>
        ) : null}
        <div className="grid grid-cols-[auto_1fr] gap-2">
          <Button tone="quiet" className="min-h-14" onClick={() => setTrying(true)}>
            ▶️ جرّب
          </Button>
          <Button tone="primary" className="min-h-14 text-[17px]" disabled={busy} onClick={save}>
            {busy ? "جارٍ الحفظ…" : c.id ? "احفظ التعديل" : "أضف القضية"}
          </Button>
        </div>
      </div>
      {trying ? <PreviewSheet c={clean(c)} onClose={() => setTrying(false)} /> : null}
    </Sheet>
  );
}

function ImportSheet({ onClose, onDone }: { onClose: () => void; onDone: (n: number) => Promise<void> }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  async function run() {
    if (!supabase) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return setErrors(["النص ليس JSON صحيحًا."]);
    }
    const list = (Array.isArray(parsed) ? parsed : [parsed]) as CourtCase[];
    const rows: CourtCase[] = [];
    const errs: string[] = [];
    list.forEach((raw, i) => {
      const c: CourtCase = {
        title: String(raw?.title ?? ""),
        category: raw?.category ? String(raw.category) : null,
        difficulty: [1, 2, 3].includes(Number(raw?.difficulty)) ? Number(raw.difficulty) : 2,
        summary: String(raw?.summary ?? ""),
        intro: String(raw?.intro ?? ""),
        guilty: raw?.guilty === true,
        truth: String(raw?.truth ?? ""),
        roles: Array.isArray(raw?.roles) ? raw.roles : [],
        evidence: Array.isArray(raw?.evidence) ? raw.evidence.map((e) => ({ ...e, stage: Number(e?.stage) || 1 })) : [],
        is_active: raw?.is_active !== false,
        suspects: Array.isArray(raw?.suspects) ? raw.suspects.map((x, j) => ({ key: String(x?.key ?? `s${j + 1}`), name: String(x?.name ?? "") })) : null,
        culprit: raw?.culprit ? String(raw.culprit) : null,
        juror_clues: Array.isArray(raw?.juror_clues) ? raw.juror_clues.map(String) : [],
      };
      const p = problems(c);
      if (p.length) errs.push(`القضية ${i + 1} (${c.title || "بلا عنوان"}): ${p[0]}`);
      else rows.push(clean(c));
    });
    if (errs.length) return setErrors(errs);
    setBusy(true);
    const { error: e } = await supabase.from("court_cases").insert(rows.map(({ id: _i, slug: _s, ...r }) => (void _i, void _s, r)));
    setBusy(false);
    if (e) return setErrors([serverError(e)]);
    await onDone(rows.length);
  }

  return (
    <Sheet title="استيراد قضايا" onClose={onClose}>
      <div className="grid gap-3">
        <p className="text-[14px] leading-6 text-mist">
          الصق قضية أو قائمة قضايا بصيغة JSON، بنفس شكل «تصدير». الحقول: title، category، difficulty (1-3)، summary، intro، guilty، truth، roles، evidence. كل دور: kind (accused، prosecutor، lawyer، detective، witness)، name، brief، secret، later، later_stage، optional. كل دليل: stage، icon، title، text.
        </p>
        <textarea dir="ltr" className={cx(textareaClass, "min-h-64 font-mono text-[13px]")} value={text} onChange={(e) => setText(e.target.value)} placeholder='[{"title": "...", "guilty": false, ...}]' />
        {errors.length ? (
          <Notice tone="error">
            <span className="grid gap-0.5">
              {errors.slice(0, 6).map((x) => (
                <span key={x}>{x}</span>
              ))}
            </span>
          </Notice>
        ) : null}
        <Button tone="primary" className="min-h-12" disabled={busy || !text.trim()} onClick={run}>
          {busy ? "جارٍ الاستيراد…" : "استورد"}
        </Button>
      </div>
    </Sheet>
  );
}

function CaseStat({ stat, guilty }: { stat?: Stat; guilty: boolean }) {
  if (!stat || !stat.plays) return <p className="text-[12px] text-faint">لم تُلعب بعد.</p>;
  const pct = Math.round((stat.correct / stat.plays) * 100);
  const tone = stat.plays < 3 ? "text-mist" : pct >= 85 ? "text-gold" : pct <= 25 ? "text-wrong" : "text-correct";
  const hint = stat.plays < 3 ? "" : pct >= 85 ? " · قد تكون سهلة" : pct <= 25 ? " · قد تكون صعبة أو مضللة" : "";
  return (
    <p className={cx("text-[13px] font-semibold", tone)}>
      📊 لُعبت {stat.plays} {stat.plays > 2 && stat.plays < 11 ? "مرات" : "مرة"} · الحكم صحيح {pct}% · حكموا بالإدانة {stat.convicted} من {stat.plays}
      {hint}
      <span className="sr-only">{guilty ? "المتهم مذنب" : "المتهم بريء"}</span>
    </p>
  );
}

/** How a case plays with N players, as the server deals it: roles, jurors, evidence by round, the truth. */
function PreviewSheet({ c, onClose }: { c: CourtCase; onClose: () => void }) {
  const required = c.roles.filter((r) => !r.optional).length;
  const min = Math.max(4, required);
  const [n, setN] = useState(Math.min(12, Math.max(min, 6)));
  let slots = n - required;
  const dealt: Role[] = [];
  const fallbacks: Evidence[] = [];
  for (const r of c.roles) {
    if (r.optional) {
      if (slots <= 0) {
        if (r.fallback?.trim()) fallbacks.push({ stage: r.fallback_stage ?? 2, icon: "🗂️", title: `إفادة ${r.name}`, text: r.fallback.trim() });
        continue;
      }
      slots--;
    }
    dealt.push(r);
  }
  const jurors = Math.max(0, n - dealt.length);
  const lost = c.roles.filter((r) => r.optional && !dealt.includes(r) && !r.fallback?.trim());
  const evidence = [...c.evidence, ...fallbacks];
  const stages = [...new Set(evidence.map((e) => e.stage))].sort();
  return (
    <Sheet title={`جرّب: ${c.title || "قضية بلا عنوان"}`} onClose={onClose}>
      <div className="grid gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[14px] font-semibold text-ivory">عدد اللاعبين:</span>
          {Array.from({ length: 12 - 4 + 1 }, (_, i) => i + 4).map((k) => (
            <button
              key={k}
              type="button"
              disabled={k < min}
              aria-pressed={n === k}
              onClick={() => setN(k)}
              className={cx("grid size-10 place-items-center rounded-full border text-[15px] font-bold disabled:opacity-30", n === k ? "btn-gold border-transparent" : "border-line-strong/70 text-mist")}
            >
              {k}
            </button>
          ))}
        </div>
        <Notice tone={lost.length ? "error" : "info"}>
          {dealt.length} أدوار و{jurors} {jurors === 1 ? "محلّف" : "محلّفين"}.
          {lost.length ? ` لن يُلعب ${lost.map((r) => r.name).join("، ")} بلا إفادة بديلة، فتضيع معلوماته.` : fallbacks.length ? ` ${fallbacks.length} إفادة تظهر دليلًا بدل الأدوار غير الموزعة.` : ""}
        </Notice>
        <Box title="القصة (على الشاشة)">
          <p className="text-[15px] leading-7 text-ivory">{c.intro}</p>
        </Box>
        <Box title="البطاقات (في الجوالات)">
          {dealt.map((r, i) => (
            <div key={i} className="grid gap-1 rounded-[14px] border border-line-strong/50 bg-night/40 p-3">
              <p className="text-[15px] font-bold text-ivory">
                {KINDS[r.kind].icon} {r.name} <span className="text-[12px] font-normal text-mist">· {KINDS[r.kind].label}</span>
              </p>
              {r.brief ? <p className="text-[13px] text-mist">{r.brief}</p> : null}
              <p className="text-[14px] leading-6 text-ivory">🔒 {r.secret}</p>
              {r.later ? <p className="text-[14px] leading-6 text-gold">✉️ في الجولة {r.later_stage ?? 2}: {r.later}</p> : null}
              {r.goal ? <p className="text-[14px] leading-6 text-violet-text">🎯 {r.goal}</p> : null}
              {(r.kind === "witness" || r.kind === "detective") && r.win && r.win !== "truth" ? <p className="text-[13px] font-semibold text-wrong">🏆 يفوز بـ{WIN_LABELS[r.win]}</p> : null}
            </div>
          ))}
          {jurors ? (
            <p className="text-[13px] text-mist">
              🗳️ و{jurors} {jurors === 1 ? "محلّف" : "محلّفين"}، لكل منهم سؤال ذهبي
              {(c.juror_clues ?? []).length ? `، ويسحب ${Math.min(jurors, (c.juror_clues ?? []).length)} منهم معلومة من ${(c.juror_clues ?? []).length}` : ""}.
            </p>
          ) : null}
          {(c.juror_clues ?? []).length ? (
            <ul className="grid gap-1 text-[13px] text-mist">
              {(c.juror_clues ?? []).map((x, i) => (
                <li key={i}>🔎 {x}</li>
              ))}
            </ul>
          ) : null}
        </Box>
        {stages.map((st) => (
          <Box key={st} title={`أدلة الجولة ${st}، ثم استجواب`}>
            {evidence
              .filter((e) => e.stage === st)
              .map((e, i) => (
                <p key={i} className="text-[14px] leading-6 text-ivory">
                  {e.icon || "📄"} <b>{e.title}</b>
                  {e.time ? <span dir="ltr" className="mx-1 text-gold">({e.time})</span> : null}: {e.text}
                </p>
              ))}
          </Box>
        ))}
        <Box title="ثم المرافعتان والتصويت، وبعد الحكم تُكشف الحقيقة">
          <p className={cx("text-[15px] font-bold", c.guilty ? "text-wrong" : "text-correct")}>المتهم {c.guilty ? "مذنب" : "بريء"}</p>
          {(c.suspects ?? []).length >= 2 ? (
            <p className="text-[14px] text-mist">
              من الفاعل؟ {(c.suspects ?? []).map((x) => (x.key === c.culprit ? `✅ ${x.name}` : x.name)).join(" · ")}
            </p>
          ) : null}
          <p className="text-[15px] leading-7 text-ivory">{c.truth}</p>
        </Box>
      </div>
    </Sheet>
  );
}
