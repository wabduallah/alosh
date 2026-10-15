import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { AnnouncementView } from "@/components/announcement";
import { Glyph } from "@/components/brand";
import { Button, Field, cx, inputClass } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { announcementLive, loadSiteSettings, type Announcement, type GameDefaults } from "@/lib/site-settings";
import { Loading, Notice, Toggle, dbMessage, textareaClass, toList } from "./common";

/** «الموقع»: the home-page announcement, game defaults, and blocked words in player names. Needs supabase/admin_v3.sql. */
export function SiteTab() {
  const [ready, setReady] = useState<"loading" | "ok" | "setup">("loading");
  const [announcement, setAnnouncement] = useState<Announcement>({});
  const [defaults, setDefaults] = useState<GameDefaults>({});

  async function refresh() {
    if (!supabase) return;
    const { data, error } = await supabase.from("site_settings").select("key, value");
    if (error) {
      setReady("setup");
      return;
    }
    const map = Object.fromEntries(((data ?? []) as Array<{ key: string; value: unknown }>).map((r) => [r.key, r.value]));
    setAnnouncement((map.announcement as Announcement) ?? {});
    setDefaults((map.game_defaults as GameDefaults) ?? {});
    setReady("ok");
  }

  useEffect(() => {
    void refresh();
  }, []);

  if (ready === "loading") return <Loading />;
  if (ready === "setup") {
    return (
      <Notice tone="info">
        هذا القسم يحتاج الملف <code dir="ltr" className="rounded bg-night/60 px-1.5 py-0.5 text-[13px]">supabase/admin_v3.sql</code>. شغّله مرة واحدة من SQL Editor في Supabase، ثم حدّث الصفحة.
      </Notice>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-4">
      <AnnouncementEditor initial={announcement} />
      <DefaultsEditor initial={defaults} />
      <BlockedNames />
    </div>
  );
}

function Card({ title, icon, note, children }: { title: string; icon: string; note?: string; children: ReactNode }) {
  return (
    <section className="surface grid min-w-0 grid-cols-1 gap-4 rounded-[22px] p-4 sm:p-5">
      <div>
        <h2 className="flex items-center gap-2 text-[20px] leading-8">
          <Glyph name={icon} className="size-5 text-gold" />
          {title}
        </h2>
        {note ? <p className="text-[13px] leading-6 text-mist">{note}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Chips<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: Array<{ value: T; label: string }>; onChange: (v: T) => void }) {
  return (
    <div className="grid gap-1.5">
      <span className="text-[14px] font-semibold text-ivory">{label}</span>
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            onClick={() => onChange(o.value)}
            className={cx("min-h-10 rounded-full border px-4 text-[14px] font-semibold transition", value === o.value ? "btn-gold border-transparent" : "border-line-strong/70 bg-deep-2/60 text-mist hover:text-ivory")}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

async function saveSetting(key: "announcement" | "game_defaults", value: unknown) {
  if (!supabase) return "الاتصال بقاعدة البيانات غير مضبوط بعد.";
  const { error } = await supabase.from("site_settings").upsert({ key, value, updated_at: new Date().toISOString() });
  if (error) return dbMessage(error);
  await loadSiteSettings(true);
  return null;
}

/* ---------------- الإعلان ---------------- */

/** ISO time → value for <input type="datetime-local"> in the viewer's time zone. */
function toLocalInput(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function AnnouncementEditor({ initial }: { initial: Announcement }) {
  const [a, setA] = useState<Announcement>({ tone: "gold", where: "home", ...initial });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const set = (patch: Partial<Announcement>) => setA((cur) => ({ ...cur, ...patch }));
  const now = Date.now();
  const state = !a.active
    ? "موقوف"
    : !a.text?.trim()
      ? "بدون نص"
      : a.starts_at && Date.parse(a.starts_at) > now
        ? "مجدول، لم يبدأ بعد"
        : a.ends_at && Date.parse(a.ends_at) < now
          ? "انتهت مدته"
          : "يظهر الآن";

  async function save(event: FormEvent) {
    event.preventDefault();
    const text = (a.text ?? "").trim();
    const link = (a.link ?? "").trim();
    if (a.active && !text) return setMessage({ tone: "error", text: "اكتب نص الإعلان." });
    if (text.length > 160) return setMessage({ tone: "error", text: "النص حده 160 حرفًا." });
    if (link && !link.startsWith("/") && !/^https:\/\//i.test(link)) return setMessage({ tone: "error", text: "الرابط يبدأ بـ / لصفحة في الموقع، أو بـ https://" });
    if (a.starts_at && a.ends_at && Date.parse(a.ends_at) <= Date.parse(a.starts_at)) return setMessage({ tone: "error", text: "النهاية بعد البداية." });
    setBusy(true);
    const value = { ...a, text, link: link || null, link_label: (a.link_label ?? "").trim() || null, version: Date.now() };
    const error = await saveSetting("announcement", value);
    setBusy(false);
    setMessage(error ? { tone: "error", text: error } : { tone: "ok", text: "حُفظ الإعلان. يظهر للزوار عند فتح الصفحة." });
    if (!error) setA(value);
  }

  return (
    <Card title="إعلان الموقع" icon="bell" note="شريط يظهر أعلى الصفحة. الزائر يقدر يخفيه، ويرجع له إذا غيّرت الإعلان.">
      <form onSubmit={save} className="grid gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <Toggle checked={!!a.active} onChange={(v) => set({ active: v })} label="الإعلان مفعّل" />
          <span className={cx("rounded-full px-3 py-0.5 text-[13px] font-semibold", announcementLive(a) ? "bg-correct-fill/20 text-correct" : "bg-deep-2 text-mist")}>{state}</span>
        </div>
        <Field label={`النص (${(a.text ?? "").length}/160)`}>
          <textarea className={cx(textareaClass, "min-h-20")} maxLength={160} value={a.text ?? ""} onChange={(e) => set({ text: e.target.value })} placeholder="مثال: لعبة جديدة: الحلبة 🥊 جرّبوها الليلة!" />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="رابط (اختياري)" hint="/play لصفحة في الموقع، أو https:// لموقع آخر.">
            <input dir="ltr" className={inputClass} value={a.link ?? ""} onChange={(e) => set({ link: e.target.value })} placeholder="/play" />
          </Field>
          <Field label="نص الرابط">
            <input className={inputClass} value={a.link_label ?? ""} maxLength={30} onChange={(e) => set({ link_label: e.target.value })} placeholder="العب الآن" />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Chips
            label="اللون"
            value={a.tone ?? "gold"}
            onChange={(v) => set({ tone: v })}
            options={[
              { value: "gold", label: "ذهبي" },
              { value: "violet", label: "بنفسجي" },
              { value: "green", label: "أخضر" },
            ]}
          />
          <Chips
            label="أين يظهر"
            value={a.where ?? "home"}
            onChange={(v) => set({ where: v })}
            options={[
              { value: "home", label: "الرئيسية فقط" },
              { value: "all", label: "كل الصفحات" },
            ]}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="يبدأ (اختياري)">
            <input type="datetime-local" className={inputClass} value={toLocalInput(a.starts_at)} onChange={(e) => set({ starts_at: e.target.value ? new Date(e.target.value).toISOString() : null })} />
          </Field>
          <Field label="ينتهي (اختياري)">
            <input type="datetime-local" className={inputClass} value={toLocalInput(a.ends_at)} onChange={(e) => set({ ends_at: e.target.value ? new Date(e.target.value).toISOString() : null })} />
          </Field>
        </div>
        {a.text?.trim() ? (
          <div className="grid gap-1.5">
            <span className="text-[13px] text-mist">معاينة</span>
            <AnnouncementView a={a} onClose={() => undefined} />
          </div>
        ) : null}
        {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
        <Button type="submit" tone="primary" className="min-h-12 w-fit px-8" disabled={busy}>
          {busy ? "جارٍ الحفظ…" : "احفظ الإعلان"}
        </Button>
      </form>
    </Card>
  );
}

/* ---------------- الإعدادات الافتراضية ---------------- */

type MafiaRole = "jester" | "mayor" | "bodyguard" | "sniper" | "seer" | "spy" | "lovers";
const MAFIA_ROLES: Array<{ key: MafiaRole; label: string }> = [
  { key: "spy", label: "الجاسوس" },
  { key: "jester", label: "المهرّج" },
  { key: "mayor", label: "العمدة" },
  { key: "bodyguard", label: "الحارس" },
  { key: "sniper", label: "القنّاص" },
  { key: "seer", label: "العرّافة" },
  { key: "lovers", label: "العاشقان" },
];

function GameBox({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <div className="grid gap-4 rounded-[18px] border border-line bg-deep-2/40 p-4">
      <h3 className="flex items-center gap-2 text-[17px]">
        <img src={`/brand/games/game-${id}.svg`} alt="" className="size-7" />
        {title}
      </h3>
      {children}
    </div>
  );
}

function DefaultsEditor({ initial }: { initial: GameDefaults }) {
  const h0 = initial.alhalba ?? {};
  const [mode, setMode] = useState<"ffa" | "duel" | "teams">(h0.mode ?? "ffa");
  const [rounds, setRounds] = useState(h0.rounds ?? 7);
  const [lives, setLives] = useState(h0.lives ?? 2);
  const [hostPlays, setHostPlays] = useState(h0.host_plays ?? true);
  const [bidSeconds, setBidSeconds] = useState([10, 20, 30, 45].includes(h0.bid_seconds ?? 0) ? (h0.bid_seconds as number) : 20);
  const [judge, setJudge] = useState<"auto" | "manual" | "both">(h0.judge ?? "both");
  const [pace, setPace] = useState(h0.pace ?? 6);
  const [winRule, setWinRule] = useState<"score" | "last">(h0.win_rule ?? "score");
  const [autoNext, setAutoNext] = useState(h0.auto_next ?? true);
  const [groupEvery, setGroupEvery] = useState(h0.group_every ?? 3);
  const [levels, setLevels] = useState<number[]>(h0.levels ?? []);
  const [turnSeconds, setTurnSeconds] = useState(initial["heads-up"]?.turn_seconds ?? 60);
  const m0 = initial["social-mafia"] ?? {};
  const [randomNarrator, setRandomNarrator] = useState(m0.random_narrator ?? false);
  const [mafiaCount, setMafiaCount] = useState(m0.mafia_count ?? 0);
  const [daySeconds, setDaySeconds] = useState(m0.day_seconds ?? 120);
  const [voteSeconds, setVoteSeconds] = useState(m0.vote_seconds ?? 60);
  const [reveal, setReveal] = useState(m0.reveal ?? false);
  const [deadSee, setDeadSee] = useState(m0.dead_see_roles ?? true);
  const [roles, setRoles] = useState<Partial<Record<MafiaRole, boolean>>>(m0.roles ?? {});
  const [gridSeconds, setGridSeconds] = useState(initial["tactical-grid"]?.seconds ?? 60);
  const c0 = initial.court ?? {};
  const [courtHost, setCourtHost] = useState(c0.host_plays ?? true);
  const [courtAuto, setCourtAuto] = useState(c0.auto ?? false);
  const [courtQuick, setCourtQuick] = useState(c0.quick ?? false);
  const [courtJudge, setCourtJudge] = useState<"host" | "random">(c0.judge ?? "host");
  const [courtQ, setCourtQ] = useState(c0.question_seconds ?? 180);
  const [courtC, setCourtC] = useState(c0.closing_seconds ?? 60);
  const [courtV, setCourtV] = useState(c0.vote_seconds ?? 60);
  const [courtEscalate, setCourtEscalate] = useState(c0.escalate ?? true);
  const [courtObj, setCourtObj] = useState(c0.objections ?? 2);
  const [courtTurn, setCourtTurn] = useState(c0.turn_seconds ?? 45);
  const [courtRead, setCourtRead] = useState(c0.read_seconds ?? 30);
  const [courtGolden, setCourtGolden] = useState<"jurors" | "all" | "off">(c0.golden ?? "jurors");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  async function save() {
    if (!(turnSeconds >= 20 && turnSeconds <= 180)) return setMessage({ tone: "error", text: "وقت الدور بين 20 و180 ثانية." });
    setBusy(true);
    const error = await saveSetting("game_defaults", {
      ...initial,
      alhalba: {
        mode,
        rounds,
        lives,
        host_plays: hostPlays,
        bid_seconds: bidSeconds,
        judge,
        pace,
        win_rule: winRule,
        auto_next: autoNext,
        group_every: groupEvery,
        levels,
      },
      "heads-up": { turn_seconds: Math.round(turnSeconds) },
      "social-mafia": {
        random_narrator: randomNarrator,
        mafia_count: mafiaCount,
        day_seconds: daySeconds,
        vote_seconds: voteSeconds,
        reveal,
        dead_see_roles: deadSee,
        roles: Object.fromEntries(MAFIA_ROLES.map((r) => [r.key, !!roles[r.key]])),
      },
      "tactical-grid": { seconds: gridSeconds },
      court: { host_plays: courtHost, auto: courtAuto, quick: courtQuick, judge: courtJudge, question_seconds: courtQ, closing_seconds: courtC, vote_seconds: courtV, escalate: courtEscalate, objections: courtObj, turn_seconds: courtTurn, read_seconds: courtRead, golden: courtGolden },
    } satisfies GameDefaults);
    setBusy(false);
    setMessage(error ? { tone: "error", text: error } : { tone: "ok", text: "حُفظت الإعدادات. تُطبَّق على الغرف الجديدة." });
  }

  return (
    <Card title="إعدادات الألعاب الافتراضية" icon="gear" note="الإعدادات التي تظهر مختارة للمضيف عند بداية اللعبة. المضيف يقدر يغيّر اختياراته في كل غرفة، والمباراة الثانية في نفس الغرفة تبدأ من اختياراته السابقة.">
      <GameBox id="alhalba" title="الحلبة">
        <Chips label="طريقة اللعب" value={mode} onChange={setMode} options={[{ value: "ffa", label: "الكل ضد الكل" }, { value: "duel", label: "نزال ثنائي" }, { value: "teams", label: "فريقان" }]} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Chips label="عدد الجولات" value={rounds} onChange={setRounds} options={[3, 5, 7, 10].map((n) => ({ value: n, label: String(n) }))} />
          <Chips label="المحاولات" value={lives} onChange={setLives} options={[1, 2, 3].map((n) => ({ value: n, label: String(n) }))} />
          <Chips label="وقت المزايدة" value={bidSeconds} onChange={setBidSeconds} options={[10, 20, 30, 45].map((n) => ({ value: n, label: `${n} ث` }))} />
          <Chips label="وقت الإجابة" value={pace} onChange={setPace} options={[{ value: 4, label: "سريع" }, { value: 6, label: "عادي" }, { value: 8, label: "مريح" }]} />
          <Chips label="مطابقة الإجابات" value={judge} onChange={setJudge} options={[{ value: "both", label: "الاثنان" }, { value: "auto", label: "تلقائي" }, { value: "manual", label: "يدوي" }]} />
          <Chips label="الفائز" value={winRule} onChange={setWinRule} options={[{ value: "score", label: "أعلى نقاط" }, { value: "last", label: "آخر من بقي" }]} />
          <Chips label="جولة جماعية" value={groupEvery} onChange={setGroupEvery} options={[{ value: 0, label: "بدون" }, { value: 3, label: "كل 3" }, { value: 4, label: "كل 4" }, { value: 5, label: "كل 5" }]} />
          <div className="grid gap-1.5">
            <span className="text-[14px] font-semibold text-ivory">مستوى المواضيع</span>
            <div className="flex flex-wrap gap-1.5">
              {[
                { n: 0, label: "الكل" },
                { n: 1, label: "سهل" },
                { n: 2, label: "متوسط" },
                { n: 3, label: "صعب" },
              ].map((l) => {
                const on = l.n === 0 ? levels.length === 0 : levels.includes(l.n);
                return (
                  <button
                    key={l.n}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setLevels((v) => (l.n === 0 ? [] : v.includes(l.n) ? v.filter((x) => x !== l.n) : [...v, l.n].sort()))}
                    className={cx("min-h-10 rounded-full border px-4 text-[14px] font-semibold transition", on ? "btn-gold border-transparent" : "border-line-strong/70 bg-deep-2/60 text-mist hover:text-ivory")}
                  >
                    {l.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        <p className="-mt-2 text-[13px] text-mist">وقت الإجابة يكبر مع المزايدة: 10 ثوانٍ + {pace} ثوانٍ لكل إجابة.</p>
        <Toggle checked={hostPlays} onChange={setHostPlays} label="المضيف يشارك في اللعب" />
        <Toggle checked={autoNext} onChange={setAutoNext} label="الجولة التالية تبدأ تلقائيًا" />
      </GameBox>

      <GameBox id="social-mafia" title="المافيا">
        <div className="grid gap-4 sm:grid-cols-2">
          <Chips label="من الراوي؟" value={randomNarrator ? 1 : 0} onChange={(v) => setRandomNarrator(v === 1)} options={[{ value: 0, label: "المضيف" }, { value: 1, label: "لاعب بالقرعة" }]} />
          <Chips label="عدد المافيا" value={mafiaCount} onChange={setMafiaCount} options={[{ value: 0, label: "تلقائي" }, ...[1, 2, 3, 4].map((n) => ({ value: n, label: String(n) }))]} />
          <Chips label="مؤقت النهار" value={daySeconds} onChange={setDaySeconds} options={[{ value: 0, label: "بدون" }, { value: 60, label: "دقيقة" }, { value: 120, label: "دقيقتان" }, { value: 180, label: "3 د" }, { value: 300, label: "5 د" }]} />
          <Chips label="مؤقت التصويت" value={voteSeconds} onChange={setVoteSeconds} options={[{ value: 0, label: "بدون" }, { value: 30, label: "30 ث" }, { value: 45, label: "45 ث" }, { value: 60, label: "دقيقة" }, { value: 90, label: "90 ث" }, { value: 120, label: "دقيقتان" }]} />
        </div>
        <p className="-mt-2 text-[13px] text-mist">إذا كان عدد المافيا المختار أكبر مما تسمح به الغرفة، يصير تلقائيًا.</p>
        <div className="grid gap-1.5">
          <span className="text-[14px] font-semibold text-ivory">الأدوار الإضافية المختارة</span>
          <div className="flex flex-wrap gap-1.5">
            {MAFIA_ROLES.map((r) => (
              <button
                key={r.key}
                type="button"
                aria-pressed={!!roles[r.key]}
                onClick={() => setRoles((cur) => ({ ...cur, [r.key]: !cur[r.key] }))}
                className={cx("min-h-10 rounded-full border px-4 text-[14px] font-semibold transition", roles[r.key] ? "btn-gold border-transparent" : "border-line-strong/70 bg-deep-2/60 text-mist hover:text-ivory")}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
        <Toggle checked={reveal} onChange={setReveal} label="كشف دور من يخرج" />
        <Toggle checked={deadSee} onChange={setDeadSee} label="من يخرج يرى أدوار الجميع" />
      </GameBox>

      <GameBox id="tactical-grid" title="تحديات العش">
        <Chips label="وقت السؤال" value={gridSeconds} onChange={setGridSeconds} options={[30, 45, 60, 90].map((n) => ({ value: n, label: `${n} ث` }))} />
      </GameBox>

      <GameBox id="court" title="المحكمة">
        <div className="grid gap-4 sm:grid-cols-2">
          <Chips label="الاستجواب (لكل جولة)" value={courtQ} onChange={setCourtQ} options={[{ value: 0, label: "بدون" }, { value: 120, label: "2 د" }, { value: 180, label: "3 د" }, { value: 300, label: "5 د" }]} />
          <Chips label="المرافعة (لكل طرف)" value={courtC} onChange={setCourtC} options={[{ value: 0, label: "بدون" }, { value: 45, label: "45 ث" }, { value: 60, label: "دقيقة" }, { value: 90, label: "90 ث" }]} />
          <Chips label="التصويت" value={courtV} onChange={setCourtV} options={[{ value: 0, label: "بدون" }, { value: 30, label: "30 ث" }, { value: 60, label: "دقيقة" }, { value: 90, label: "90 ث" }]} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Chips label="نوع الجلسة" value={courtQuick ? "quick" : "full"} onChange={(v) => setCourtQuick(v === "quick")} options={[{ value: "full", label: "كاملة" }, { value: "quick", label: "سريعة" }]} />
          <Chips label="القاضي" value={courtJudge} onChange={setCourtJudge} options={[{ value: "host", label: "المضيف" }, { value: "random", label: "لاعب بالقرعة" }]} />
        </div>
        <Toggle checked={courtHost} onChange={setCourtHost} label="المضيف يلعب دورًا" />
        <Toggle checked={courtAuto} onChange={setCourtAuto} label="الانتقال تلقائي حين ينتهي الوقت" />
        <Toggle checked={courtEscalate} onChange={setCourtEscalate} label="تصعيد المنصة تلقائيًا مع مؤقت الاستجواب" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Chips label="الاعتراضات لكل طرف" value={courtObj} onChange={setCourtObj} options={[0, 1, 2, 3].map((n) => ({ value: n, label: n ? String(n) : "بدون" }))} />
          <Chips label="دور السؤال" value={courtTurn} onChange={setCourtTurn} options={[30, 45, 60, 90].map((n) => ({ value: n, label: `${n} ث` }))} />
          <Chips label="قراءة الأدلة (تلقائي)" value={courtRead} onChange={setCourtRead} options={[15, 30, 45, 60].map((n) => ({ value: n, label: `${n} ث` }))} />
          <Chips label="السؤال الذهبي" value={courtGolden} onChange={setCourtGolden} options={[{ value: "jurors", label: "للمحلّفين" }, { value: "all", label: "والشهود والمحقق" }, { value: "off", label: "بدون" }]} />
        </div>
      </GameBox>

      <GameBox id="heads-up" title="هل تعرف">
        <Field label="وقت الدور (ثانية)" hint="الحالي 60.">
          <input type="number" inputMode="numeric" min={20} max={180} step={5} className={cx(inputClass, "max-w-40")} value={turnSeconds} onChange={(e) => setTurnSeconds(Number(e.target.value))} />
        </Field>
      </GameBox>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <Button tone="primary" className="min-h-12 w-fit px-8" onClick={save} disabled={busy}>
        {busy ? "جارٍ الحفظ…" : "احفظ الإعدادات"}
      </Button>
    </Card>
  );
}

/* ---------------- الأسماء الممنوعة ---------------- */

type Blocked = { id: string; word: string; whole_word: boolean };
type Hit = { player_id: string; room_id: string; room_code: string; player_name: string; is_host: boolean; word: string };

function BlockedNames() {
  const [list, setList] = useState<Blocked[] | null>(null);
  const [text, setText] = useState("");
  const [whole, setWhole] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [probe, setProbe] = useState("");
  const [probeResult, setProbeResult] = useState<string | null>(null);
  const [hits, setHits] = useState<Hit[] | null>(null);

  async function refresh() {
    if (!supabase) return;
    const { data, error } = await supabase.from("blocked_names").select("id, word, whole_word").order("word");
    if (error) setMessage({ tone: "error", text: dbMessage(error, "تعذّر تحميل القائمة.") });
    setList((data ?? []) as Blocked[]);
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function add(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    const words = [...new Set(toList(text))].filter((w) => w.length <= 40);
    if (words.length === 0) return setMessage({ tone: "error", text: "اكتب كلمة واحدة على الأقل." });
    setBusy(true);
    let added = 0;
    let skipped = 0;
    for (const word of words) {
      const { error } = await supabase.from("blocked_names").insert({ word, whole_word: whole });
      if (error) skipped += 1;
      else added += 1;
    }
    setBusy(false);
    setText("");
    setMessage({ tone: "ok", text: `أُضيف ${added}${skipped ? `، وتُخطّي ${skipped} (موجودة أو غير صالحة)` : ""}.` });
    await refresh();
  }

  async function remove(b: Blocked) {
    if (!supabase) return;
    const { error } = await supabase.from("blocked_names").delete().eq("id", b.id);
    if (error) return setMessage({ tone: "error", text: dbMessage(error, "تعذّر الحذف.") });
    setList((cur) => (cur ?? []).filter((x) => x.id !== b.id));
  }

  async function test(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !probe.trim()) return;
    const { data, error } = await supabase.rpc("admin_name_check", { p_name: probe });
    setProbeResult(error ? "تعذّر الفحص." : data ? `ممنوع: فيه «${data as string}»` : "مسموح");
  }

  async function scan() {
    if (!supabase) return;
    const { data, error } = await supabase.rpc("admin_name_hits");
    if (error) return setMessage({ tone: "error", text: dbMessage(error, "تعذّر الفحص.") });
    setHits((data ?? []) as Hit[]);
  }

  async function kick(h: Hit) {
    if (!supabase) return;
    const { error } = await supabase.from("room_players").delete().eq("id", h.player_id);
    if (error) return setMessage({ tone: "error", text: dbMessage(error, "تعذّر الإخراج.") });
    setHits((cur) => (cur ?? []).filter((x) => x.player_id !== h.player_id));
  }

  return (
    <Card
      title="الأسماء الممنوعة"
      icon="shield"
      note="لا يقدر أحد يدخل غرفة أو ينشئها باسم فيه كلمة من القائمة. المقارنة تتجاهل التشكيل والهمزات والتطويل وعلامات الترقيم."
    >
      <form onSubmit={add} className="grid gap-3">
        <Field label="أضف كلمات" hint="كلمة في كل سطر.">
          <textarea className={cx(textareaClass, "min-h-20")} value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
        <Toggle checked={!whole} onChange={(v) => setWhole(!v)} label="امنعها حتى لو جاءت جزءًا من كلمة" />
        <p className="-mt-2 text-[12px] text-mist">
          {whole ? "الكلمة كاملة فقط: تمنع «غبي» ولا تمنع «الغبيني»." : "أي مكان في الاسم، حتى مع مسافات بين الحروف. انتبه: قد تمنع أسماء بريئة."}
        </p>
        <Button type="submit" tone="primary" className="w-fit" disabled={busy}>
          {busy ? "جارٍ الإضافة…" : "أضف"}
        </Button>
      </form>

      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}

      {list === null ? (
        <Loading />
      ) : list.length === 0 ? (
        <p className="text-[14px] text-mist">القائمة فارغة.</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {list.map((b) => (
            <li key={b.id} className="inline-flex min-h-10 items-center gap-1 rounded-full border border-line bg-deep-2/60 ps-3.5 pe-1 text-[15px] text-ivory">
              {b.word}
              {!b.whole_word ? <span className="text-[11px] text-gold">جزء</span> : null}
              <button type="button" onClick={() => remove(b)} aria-label={`حذف ${b.word}`} className="grid size-8 place-items-center rounded-full text-mist hover:bg-wrong-fill/20 hover:text-wrong">
                <Glyph name="x" className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={test} className="grid gap-2 rounded-[18px] border border-line bg-deep-2/40 p-3">
        <span className="text-[14px] font-semibold text-ivory">جرّب اسمًا</span>
        <div className="flex gap-2">
          <input className={cx(inputClass, "min-h-11")} value={probe} onChange={(e) => {
              setProbe(e.target.value);
              setProbeResult(null);
            }} placeholder="اكتب اسمًا" aria-label="اسم للتجربة" />
          <Button type="submit" tone="quiet" className="min-h-11 shrink-0">
            افحص
          </Button>
        </div>
        {probeResult ? <p className={cx("text-[14px] font-semibold", probeResult === "مسموح" ? "text-correct" : "text-wrong")}>{probeResult}</p> : null}
      </form>

      <div className="grid gap-2">
        <Button tone="quiet" className="w-fit" onClick={scan}>
          <Glyph name="search" className="size-[18px]" />
          افحص أسماء الغرف المفتوحة
        </Button>
        {hits ? (
          hits.length === 0 ? (
            <p className="text-[14px] text-correct">لا توجد أسماء ممنوعة في الغرف المفتوحة.</p>
          ) : (
            <ul className="grid gap-1.5">
              {hits.map((h) => (
                <li key={h.player_id} className="flex flex-wrap items-center gap-2 rounded-[14px] border border-wrong/40 bg-wrong-fill/10 px-3 py-2 text-[14px]">
                  <span className="room-code text-gold">{h.room_code}</span>
                  <span className="min-w-0 flex-1 truncate text-ivory">
                    {h.player_name}
                    {h.is_host ? <span className="text-[12px] text-mist"> (المضيف)</span> : null}
                  </span>
                  <span className="text-[12px] text-mist">«{h.word}»</span>
                  {!h.is_host ? (
                    <Button tone="danger" className="min-h-9 px-3 text-[13px]" onClick={() => kick(h)}>
                      أخرجه
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )
        ) : null}
      </div>
    </Card>
  );
}
