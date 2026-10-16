import { useEffect, useRef, useState } from "react";
import { Button, Field, cx, inputClass } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import {
  DEFAULT_SECTIONS,
  THEME_PRESETS,
  applyTheme,
  homeSections,
  themePalette,
  type HomeSectionKey,
  type HomeSettings,
  type InfoSettings,
  type PageKey,
  type PagesSettings,
  type TestGuests,
  type ThemeSettings,
} from "@/lib/site-settings";
import { DEFAULT_PAGES, PAGE_META } from "@/lib/pages";
import { Card, Loading, Notice, Toggle, dbMessage, saveSetting, textareaClass } from "./common";
import { loadGames, type AdminGame } from "./games";

/**
 * «المظهر»: the home page texts and section order, the site colors, contact links, the info pages,
 * and the order of the games. Everything here is stored in site_settings (supabase/site_v1.sql).
 */
export function AppearanceTab() {
  const [state, setState] = useState<"loading" | "ok" | "setup">("loading");
  const [map, setMap] = useState<Record<string, unknown>>({});

  useEffect(() => {
    void (async () => {
      if (!supabase) return setState("setup");
      const { data, error } = await supabase.from("site_settings").select("key, value");
      if (error) return setState("setup");
      setMap(Object.fromEntries(((data ?? []) as Array<{ key: string; value: unknown }>).map((r) => [r.key, r.value])));
      setState("ok");
    })();
  }, []);

  if (state === "loading") return <Loading />;
  if (state === "setup") return <Notice tone="info">هذا القسم يحتاج الملف supabase/site_v1.sql. شغّله ثم حدّث الصفحة.</Notice>;
  return (
    <div className="grid grid-cols-1 gap-4">
      <GamesOrder />
      <HomeEditor initial={(map.home as HomeSettings) ?? {}} />
      <ThemeEditor initial={(map.theme as ThemeSettings) ?? {}} />
      <InfoEditor initial={(map.info as InfoSettings) ?? {}} />
      <PagesEditor initial={(map.pages as PagesSettings) ?? {}} />
    </div>
  );
}

function SaveRow({ busy, note, onSave, label = "حفظ" }: { busy: boolean; note: { ok: boolean; text: string } | null; onSave: () => void; label?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button tone="primary" className="min-h-12 px-6" disabled={busy} onClick={onSave}>
        {busy ? "جارٍ الحفظ…" : label}
      </Button>
      {note ? (
        <p role="status" className={cx("text-[14px] font-semibold", note.ok ? "text-correct" : "text-wrong")}>
          {note.text}
        </p>
      ) : null}
    </div>
  );
}

function useSaver(key: Parameters<typeof saveSetting>[0]) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  async function save(value: unknown, okText = "حُفظ. يظهر للزوار عند فتح الصفحة من جديد.") {
    setBusy(true);
    setNote(null);
    const error = await saveSetting(key, value);
    setBusy(false);
    setNote(error ? { ok: false, text: error } : { ok: true, text: okText });
    return !error;
  }
  return { busy, note, save };
}

/* ---------------- ترتيب الألعاب ---------------- */

function GamesOrder() {
  const [games, setGames] = useState<AdminGame[] | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    void loadGames().then(({ data }) => setGames(data));
  }, []);

  if (!games) return <Loading />;
  const managed = games.some((g) => g.sort_order !== undefined);

  function move(i: number, d: -1 | 1) {
    if (!games) return;
    const j = i + d;
    if (j < 0 || j >= games.length) return;
    const next = [...games];
    [next[i], next[j]] = [next[j], next[i]];
    setGames(next);
    setDirty(true);
    setNote(null);
  }

  async function save() {
    if (!supabase || !games) return;
    setBusy(true);
    setNote(null);
    const results = await Promise.all(games.map((g, i) => supabase!.from("games").update({ sort_order: (i + 1) * 10 }).eq("id", g.id)));
    setBusy(false);
    const failed = results.find((r) => r.error);
    if (failed?.error) return setNote({ ok: false, text: dbMessage(failed.error) });
    setGames(games.map((g, i) => ({ ...g, sort_order: (i + 1) * 10 })));
    setDirty(false);
    setNote({ ok: true, text: "حُفظ الترتيب. الرئيسية وصفحة الألعاب تتبعانه." });
  }

  const status = (g: AdminGame) => (!g.is_active ? "موقوفة" : g.home_status === "soon" ? "قريبًا" : g.home_status === "hidden" ? "مخفية" : "متاحة");
  return (
    <Card title="ترتيب الألعاب" icon="gamepad" note="الأعلى يظهر أولًا في الرئيسية وصفحة الألعاب. الحالة (متاحة، قريبًا، مخفية) من تبويب «الألعاب».">
      {!managed ? <Notice tone="info">الترتيب يحتاج الملف supabase/polish_v1.sql.</Notice> : null}
      <ol className="grid gap-2">
        {games.map((g, i) => (
          <li key={g.id} className="flex items-center gap-2 rounded-[16px] border border-line bg-night/30 px-3 py-2">
            <span className="w-7 text-center font-bold text-gold">{i + 1}</span>
            <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-ivory">{g.title_ar}</span>
            <span className="text-[12px] text-muted">{status(g)}</span>
            <Button tone="quiet" className="min-h-10 min-w-10 px-2" disabled={i === 0 || !managed} onClick={() => move(i, -1)} aria-label={`ارفع ${g.title_ar}`}>
              ▲
            </Button>
            <Button tone="quiet" className="min-h-10 min-w-10 px-2" disabled={i === games.length - 1 || !managed} onClick={() => move(i, 1)} aria-label={`أنزل ${g.title_ar}`}>
              ▼
            </Button>
          </li>
        ))}
      </ol>
      <SaveRow busy={busy} note={note} onSave={() => (dirty ? void save() : setNote({ ok: true, text: "لا تغيير." }))} label="حفظ الترتيب" />
    </Card>
  );
}

/* ---------------- الرئيسية ---------------- */

const SECTION_LABEL: Record<HomeSectionKey, string> = { hero: "الواجهة (الشعار والأزرار والمزايا)", how: "كيف تبدأ؟", games: "الألعاب", cta: "جاهزون للسهرة؟" };
const FEATURE_DEFAULTS = ["بدون تسجيل", "بدون تحميل", "حتى 14 لاعبًا", "مجانًا"];

function HomeEditor({ initial }: { initial: HomeSettings }) {
  const [h, setH] = useState<HomeSettings>({ ...initial, sections: homeSections(initial) });
  const { busy, note, save } = useSaver("home");
  const sections = h.sections ?? DEFAULT_SECTIONS;
  const set = (patch: Partial<HomeSettings>) => setH({ ...h, ...patch });

  function moveSection(i: number, d: -1 | 1) {
    const j = i + d;
    if (j < 0 || j >= sections.length) return;
    const next = [...sections];
    [next[i], next[j]] = [next[j], next[i]];
    set({ sections: next });
  }

  const text = (v: string | undefined) => (v ?? "").slice(0, 300);
  return (
    <Card title="الصفحة الرئيسية" icon="home" note="اترك أي حقل فارغًا ليبقى النص الأصلي.">
      <Field label="العبارة الرئيسية">
        <input className={inputClass} maxLength={80} value={h.tagline ?? ""} placeholder="حيث تلتقي التحديات بالمتعة الجماعية" onChange={(e) => set({ tagline: e.target.value })} />
      </Field>
      <Field label="الوصف تحتها">
        <textarea className={textareaClass} maxLength={300} value={h.subtitle ?? ""} placeholder="تلفزيون أو لابتوب في الوسط وجوالاتكم حواليه…" onChange={(e) => set({ subtitle: text(e.target.value) })} />
      </Field>
      <div className="grid gap-2 sm:grid-cols-2">
        {FEATURE_DEFAULTS.map((d, i) => (
          <Field key={i} label={`ميزة ${i + 1}`}>
            <input
              className={inputClass}
              maxLength={30}
              value={h.features?.[i] ?? ""}
              placeholder={d}
              onChange={(e) => {
                const f = [...(h.features ?? ["", "", "", ""])];
                f[i] = e.target.value;
                set({ features: f });
              }}
            />
          </Field>
        ))}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="عنوان الدعوة أسفل الصفحة">
          <input className={inputClass} maxLength={60} value={h.cta_title ?? ""} placeholder="جاهزون للسهرة؟" onChange={(e) => set({ cta_title: e.target.value })} />
        </Field>
        <Field label="نص الدعوة">
          <input className={inputClass} maxLength={140} value={h.cta_text ?? ""} placeholder="أنشئوا الغرفة الآن، وشاركوا الرمز مع أصدقائكم." onChange={(e) => set({ cta_text: e.target.value })} />
        </Field>
      </div>
      <Field label="عبارة أسفل كل الصفحات">
        <input className={inputClass} maxLength={80} value={h.footer_text ?? ""} placeholder="حيث تلتقي التحديات بالمتعة الجماعية" onChange={(e) => set({ footer_text: e.target.value })} />
      </Field>

      <div className="grid gap-2">
        <span className="text-[14px] font-semibold text-ivory">ترتيب أقسام الرئيسية</span>
        <ol className="grid gap-2">
          {sections.map((s, i) => (
            <li key={s.key} className="flex flex-wrap items-center gap-2 rounded-[16px] border border-line bg-night/30 px-3 py-2">
              <span className="w-6 text-center font-bold text-gold">{i + 1}</span>
              <span className={cx("min-w-0 flex-1 text-[15px]", s.visible ? "text-ivory" : "text-muted line-through")}>{SECTION_LABEL[s.key]}</span>
              <Toggle
                checked={s.visible}
                label="ظاهر"
                onChange={(v) => set({ sections: sections.map((x) => (x.key === s.key ? { ...x, visible: v } : x)) })}
              />
              <Button tone="quiet" className="min-h-10 min-w-10 px-2" disabled={i === 0} onClick={() => moveSection(i, -1)} aria-label={`ارفع ${SECTION_LABEL[s.key]}`}>
                ▲
              </Button>
              <Button tone="quiet" className="min-h-10 min-w-10 px-2" disabled={i === sections.length - 1} onClick={() => moveSection(i, 1)} aria-label={`أنزل ${SECTION_LABEL[s.key]}`}>
                ▼
              </Button>
            </li>
          ))}
        </ol>
        {!sections.some((s) => s.visible && s.key === "games") ? <Notice tone="error">قسم الألعاب مخفي: الزوار لن يروا الألعاب في الرئيسية.</Notice> : null}
      </div>

      <div className="flex flex-wrap gap-2">
        <SaveRow
          busy={busy}
          note={note}
          onSave={() => {
            const clean = (v?: string) => v?.trim() || undefined;
            void save({
              tagline: clean(h.tagline),
              subtitle: clean(h.subtitle),
              features: (h.features ?? []).map((f) => f.trim()),
              cta_title: clean(h.cta_title),
              cta_text: clean(h.cta_text),
              footer_text: clean(h.footer_text),
              sections,
            });
          }}
        />
        <Button tone="quiet" className="min-h-12" onClick={() => setH({ sections: DEFAULT_SECTIONS })}>
          الرجوع للأصل
        </Button>
      </div>
    </Card>
  );
}

/* ---------------- الألوان ---------------- */

function ThemeEditor({ initial }: { initial: ThemeSettings }) {
  const [t, setT] = useState<ThemeSettings>({ preset: initial.preset ?? "gold", accent: initial.accent ?? "#ffa53a", accent2: initial.accent2 ?? "#663ade" });
  const { busy, note, save } = useSaver("theme");

  // Live preview on this page; leaving the tab without saving restores the saved colors.
  const saved = useRef<ThemeSettings>(initial);
  useEffect(() => {
    applyTheme(t);
  }, [t]);
  useEffect(() => () => applyTheme(saved.current), []);

  const p = themePalette(t) ?? THEME_PRESETS[0];
  return (
    <Card title="الألوان" icon="fire" note="تتغير ألوان الأزرار والعناوين والإبرازات في كل الموقع. المعاينة مباشرة هنا قبل الحفظ.">
      <div role="radiogroup" aria-label="مجموعة الألوان" className="flex flex-wrap gap-2">
        {[...THEME_PRESETS, { key: "custom", label: "مخصص", gold: t.accent ?? "#ffa53a", violet: t.accent2 ?? "#663ade" }].map((x) => (
          <button
            key={x.key}
            type="button"
            role="radio"
            aria-checked={t.preset === x.key}
            onClick={() => setT({ ...t, preset: x.key })}
            className={cx("flex min-h-11 items-center gap-2 rounded-full border px-3.5 text-[14px] font-semibold", t.preset === x.key ? "border-gold bg-gold/15 text-ivory" : "border-line-strong/70 text-mist")}
          >
            <span aria-hidden="true" className="flex">
              <span className="size-4 rounded-full" style={{ background: x.gold }} />
              <span className="-ms-1.5 size-4 rounded-full" style={{ background: x.violet }} />
            </span>
            {x.label}
          </button>
        ))}
      </div>
      {t.preset === "custom" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <ColorField label="اللون الرئيسي (الأزرار)" value={t.accent ?? "#ffa53a"} onChange={(v) => setT({ ...t, accent: v })} />
          <ColorField label="اللون المساعد" value={t.accent2 ?? "#663ade"} onChange={(v) => setT({ ...t, accent2: v })} />
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-3 rounded-[18px] border border-line bg-night/40 p-3">
        <span className="btn-gold inline-flex min-h-11 items-center rounded-full px-5 font-bold">زر رئيسي</span>
        <span className="inline-flex min-h-11 items-center rounded-full px-5 font-bold text-ivory" style={{ background: p.violet }}>
          زر مساعد
        </span>
        <span className="font-bold text-gold">نص مُبرز</span>
        <span className="font-bold text-violet-text">نص ثانوي</span>
      </div>
      <SaveRow
        busy={busy}
        note={note}
        onSave={() => {
          const value = t.preset === "custom" ? t : { preset: t.preset };
          void save(value, "حُفظت الألوان لكل الزوار.").then((ok) => {
            if (!ok) return;
            saved.current = value;
            try {
              window.localStorage.setItem("al3sh.theme", JSON.stringify(value));
            } catch {
              // ignore
            }
          });
        }}
      />
    </Card>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <Field label={label}>
      <div className="flex items-center gap-2">
        <input type="color" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="h-12 w-14 shrink-0 cursor-pointer rounded-xl border border-line bg-transparent" />
        <input
          className={cx(inputClass, "font-mono")}
          dir="ltr"
          value={text}
          maxLength={7}
          onChange={(e) => {
            setText(e.target.value);
            if (/^#[0-9a-f]{6}$/i.test(e.target.value)) onChange(e.target.value.toLowerCase());
          }}
        />
      </div>
    </Field>
  );
}

/* ---------------- معلومات التواصل ---------------- */

const INFO_FIELDS: Array<{ key: keyof InfoSettings; label: string; placeholder: string }> = [
  { key: "email", label: "البريد", placeholder: "hello@example.com" },
  { key: "whatsapp", label: "واتساب (رقم دولي)", placeholder: "9665xxxxxxxx" },
  { key: "x", label: "إكس", placeholder: "@al3sh" },
  { key: "instagram", label: "إنستغرام", placeholder: "@al3sh" },
  { key: "tiktok", label: "تيك توك", placeholder: "@al3sh" },
  { key: "snapchat", label: "سناب شات", placeholder: "al3sh" },
];

function InfoEditor({ initial }: { initial: InfoSettings }) {
  const [info, setInfo] = useState<InfoSettings>(initial);
  const { busy, note, save } = useSaver("info");
  return (
    <Card title="معلومات التواصل" icon="phone" note="تظهر في أسفل كل صفحة وفي صفحات الخصوصية والأسئلة والحقوق. اترك الحقل فارغًا ليختفي.">
      <div className="grid gap-2 sm:grid-cols-2">
        {INFO_FIELDS.map((f) => (
          <Field key={f.key} label={f.label}>
            <input className={inputClass} dir="ltr" maxLength={80} value={info[f.key] ?? ""} placeholder={f.placeholder} onChange={(e) => setInfo({ ...info, [f.key]: e.target.value })} />
          </Field>
        ))}
      </div>
      <SaveRow busy={busy} note={note} onSave={() => void save(Object.fromEntries((Object.entries(info) as Array<[string, string | undefined]>).map(([k, v]) => [k, (v ?? "").trim()]).filter(([, v]) => v)))} />
    </Card>
  );
}

/* ---------------- الصفحات ---------------- */

function PagesEditor({ initial }: { initial: PagesSettings }) {
  const [page, setPage] = useState<PageKey>("privacy");
  const [pages, setPages] = useState<PagesSettings>(initial);
  const { busy, note, save } = useSaver("pages");
  const body = pages[page]?.body ?? "";

  return (
    <Card title="صفحات المعلومات" icon="info" note="«## » عنوان، «- » نقطة، «؟ » سؤال في الأسئلة الشائعة. النص يُعرض كما هو بلا HTML. فارغ = النص الأصلي.">
      <div role="tablist" className="flex flex-wrap gap-1.5">
        {(Object.keys(PAGE_META) as PageKey[]).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={page === k}
            onClick={() => setPage(k)}
            className={cx("min-h-10 rounded-full border px-4 text-[14px] font-semibold", page === k ? "btn-gold border-transparent" : "border-line-strong/70 text-mist")}
          >
            {PAGE_META[k].title}
            {pages[k]?.body?.trim() ? " ✎" : ""}
          </button>
        ))}
      </div>
      <textarea
        className={cx(textareaClass, "min-h-80 text-[14px]")}
        value={body}
        maxLength={20000}
        placeholder={DEFAULT_PAGES[page].slice(0, 400) + "…"}
        onChange={(e) => setPages({ ...pages, [page]: { ...pages[page], body: e.target.value } })}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button tone="quiet" className="min-h-11" onClick={() => setPages({ ...pages, [page]: { ...pages[page], body: DEFAULT_PAGES[page] } })}>
          انسخ النص الأصلي للتعديل
        </Button>
        <Button tone="quiet" className="min-h-11" onClick={() => setPages({ ...pages, [page]: { body: "" } })}>
          الرجوع للنص الأصلي
        </Button>
        <a href={PAGE_META[page].path} target="_blank" rel="noopener" className="inline-flex min-h-11 items-center px-2 text-[14px] text-gold underline-offset-4 hover:underline">
          افتح الصفحة
        </a>
      </div>
      <SaveRow
        busy={busy}
        note={note}
        onSave={() => {
          const now = new Date().toISOString();
          const out: PagesSettings = {};
          for (const k of Object.keys(PAGE_META) as PageKey[]) {
            const b = pages[k]?.body?.trim();
            const changed = b !== (initial[k]?.body?.trim() || undefined);
            if (b) out[k] = { body: b, updated: changed ? now : (initial[k]?.updated ?? now) };
          }
          void save(out);
        }}
      />
      <p className="text-[13px] leading-6 text-muted">النص الأصلي يصف ما يفعله الموقع فعلًا اليوم. يُنصح بمراجعته من مختص قانوني قبل الاعتماد عليه.</p>
    </Card>
  );
}

/* ---------------- الضيوف التجريبيون (في تبويب «الموقع») ---------------- */

export function TestGuestsEditor({ initial }: { initial: TestGuests }) {
  const [games, setGames] = useState<AdminGame[] | null>(null);
  const [on, setOn] = useState<Record<string, boolean>>(initial.games ?? {});
  const { busy, note, save } = useSaver("test_guests");

  useEffect(() => {
    void loadGames().then(({ data }) => setGames(data));
  }, []);

  return (
    <Card
      title="الضيوف التجريبيون"
      icon="users"
      note="للمدير فقط: في الألعاب المفعّلة هنا يظهر لك شريط في الغرفة تضيف به ضيوفًا وهميين وتلعب بدور أي واحد منهم من جهازك، لتجرب اللعبة كاملة وحدك. أي لعبة تُضاف مستقبلًا تظهر هنا تلقائيًا."
    >
      {!games ? (
        <Loading />
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {games.map((g) => (
            <li key={g.id} className="flex items-center justify-between gap-2 rounded-[16px] border border-line bg-night/30 px-3 py-2">
              <span className="min-w-0 truncate text-[15px] text-ivory">{g.title_ar}</span>
              <Toggle checked={!!on[g.slug]} label="مفعّل" onChange={(v) => setOn({ ...on, [g.slug]: v })} />
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        <Button tone="quiet" className="min-h-11" onClick={() => games && setOn(Object.fromEntries(games.map((g) => [g.slug, true])))}>
          فعّل للكل
        </Button>
        <Button tone="quiet" className="min-h-11" onClick={() => setOn({})}>
          أوقف للكل
        </Button>
      </div>
      <SaveRow busy={busy} note={note} onSave={() => void save({ games: Object.fromEntries(Object.entries(on).filter(([, v]) => v)) }, "حُفظ. افتح غرفة في لعبة مفعّلة وستجد شريط الضيوف.")} />
      <p className="text-[13px] leading-6 text-muted">الضيوف لا يحتاجون جوالات: أنت تبدّل بينهم من شريط الغرفة. يُحذفون بزر «احذف الضيوف» أو بطرد أي واحد منهم.</p>
    </Card>
  );
}
