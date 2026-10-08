import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Shell } from "@/components/shell";
import { Button, Field, inputClass } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { adminMutate, adminQuery, unlockAdmin } from "@/lib/lamma/admin.rpc";

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "الإدارة — العش" }] }),
  component: AdminPage,
});

const TABS = ["dashboard", "games", "questions", "import", "ai", "categories", "sections", "addons", "users", "rooms", "plans", "subscriptions", "payments", "promos", "translations", "settings", "lexicon", "reports"] as const;

function AdminPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<(typeof TABS)[number]>("dashboard");
  const [data, setData] = useState<unknown>(null);
  const [note, setNote] = useState<string | null>(null);
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [studio, setStudio] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);

  async function load(section = tab) {
    const res = await adminQuery({ data: { section } });
    if (!res.ok) {
      setAllowed(false);
      return;
    }
    setAllowed(true);
    setData(res.data);
  }

  useEffect(() => {
    void load(tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  async function mutate(op: string, payload: Record<string, unknown>) {
    const res = await adminMutate({ data: { op, payload } });
    setNote(res.ok ? "OK" : t(`err.${"error" in res ? res.error : "BAD_INPUT"}`));
    if (res.ok) await load(tab);
  }

  if (allowed !== true) {
    return (
      <Shell>
        <p className="text-sm text-neon">المشرف العام</p>
        <h1 className="text-4xl font-extrabold">لوحة التحكم</h1>
        <p className="mt-2 text-ivory/70">الدخول برمز الإدارة فقط.</p>
        <form
          className="mt-4 max-w-md space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void unlockAdmin({ data: { code: studio } }).then(async (res) => {
              if (!res.ok) {
                setCodeError("الرمز غير صحيح");
                return;
              }
              setCodeError(null);
              await load("dashboard");
            });
          }}
        >
          <Field label="رمز الإدارة">
            <input className={inputClass} value={studio} onChange={(e) => setStudio(e.target.value)} autoComplete="off" />
          </Field>
          <Button type="submit">دخول</Button>
          {codeError ? <p className="text-sm text-gold">{codeError}</p> : null}
        </form>
      </Shell>
    );
  }

  return (
    <Shell>
      <p className="text-sm text-neon">المشرف العام</p>
      <h1 className="text-4xl font-extrabold">لوحة التحكم</h1>
      <p className="mt-3 max-w-3xl text-sm text-ivory/65">نظرة عامة على النظام والاستيراد والإضافات.</p>
      <div className="mt-4 flex gap-2 overflow-x-auto pb-2">
        {TABS.map((item) => (
          <button key={item} type="button" onClick={() => setTab(item)} className={`min-h-11 shrink-0 rounded-full px-3 text-sm font-extrabold ${tab === item ? "bg-neon text-night" : "border border-white/15 text-ivory/80"}`}>
            {t(`admin.tabs.${item}`)}
          </button>
        ))}
      </div>
      {note ? <p className="mt-3 text-sm">{note}</p> : null}
      <div className="mt-6">
        {tab === "dashboard" || tab === "reports" ? <Dash data={data} /> : null}
        {tab === "games" ? <Games data={data} onSave={(payload) => void mutate("saveGame", payload)} onToggle={(id) => void mutate("toggleGame", { id })} /> : null}
        {tab === "questions" ? <Questions data={data} onStatus={(id, status) => void mutate("setQuestionStatus", { id, status })} onImport={(gameId, rows) => void mutate("importQuestions", { gameId, rows })} onAi={(payload) => void mutate("generateQuestions", payload)} onDraft={(payload) => void mutate("draftGame", payload)} /> : null}
        {tab === "settings" ? <Settings data={data} onSave={(key, value) => void mutate("saveSetting", { key, value })} onPurge={() => void mutate("purgeSeed", {})} /> : null}
        {tab === "promos" ? <Promos data={data} onSave={(payload) => void mutate("savePromo", payload)} /> : null}
        {tab === "plans" ? <Plans data={data} onSave={(payload) => void mutate("savePlan", payload)} /> : null}
        {tab === "payments" ? <Payments data={data} onPaid={(id) => void mutate("markPayment", { id })} /> : null}
        {tab === "users" ? <Users data={data} onRole={(userId, role) => void mutate("setRole", { userId, role })} /> : null}
        {tab === "rooms" ? <Rooms data={data} onClose={(id) => void mutate("closeRoom", { id })} /> : null}
        {tab === "lexicon" ? <Lexicon data={data} onAdd={(payload) => void mutate("addLexicon", payload)} /> : null}
        {tab === "translations" ? <Strings data={data} onSave={(payload) => void mutate("setString", payload)} /> : null}
        {tab === "categories" ? <Cats data={data} onSave={(payload) => void mutate("saveCategory", payload)} /> : null}
        {tab === "import" ? <CsvImport onPreview={(payload) => void mutate("previewCsv", payload)} onCommit={(payload) => void mutate("commitCsv", payload)} /> : null}
        {tab === "ai" ? <AiDesk data={data} onGenerate={(payload) => void mutate("generateQuestions", payload)} onReview={(payload) => void mutate("reviewDraft", payload)} /> : null}
        {tab === "sections" ? <Sections data={data} onSave={(payload) => void mutate("saveSection", payload)} /> : null}
        {tab === "addons" ? <Addons data={data} onToggle={(id) => void mutate("toggleAddon", { id })} /> : null}
        {tab === "subscriptions" ? <Raw data={data} /> : null}
      </div>
    </Shell>
  );
}

function Dash({ data }: { data: unknown }) {
  const row = (data ?? {}) as Record<string, number | { id: string; name: string; plays: number }[]>;
  const cards = ["users", "roomsToday", "playersToday", "games", "activeRooms", "revenue", "subs"] as const;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {cards.map((key) => (
          <div key={key} className="rounded-3xl bg-ivory p-4">
            <p className="text-sm text-muted">{key}</p>
            <p className="font-display text-3xl tabular-nums">{String(row[key] ?? 0)}</p>
          </div>
        ))}
      </div>
      <ul className="space-y-2">
        {Array.isArray(row.top) ? row.top.map((item) => (
          <li key={item.id} className="flex justify-between rounded-2xl bg-ivory px-4 py-3">
            <span>{item.name}</span>
            <span className="tabular-nums">{item.plays}</span>
          </li>
        )) : null}
      </ul>
    </div>
  );
}

function Games({ data, onSave, onToggle }: { data: unknown; onSave: (payload: Record<string, unknown>) => void; onToggle: (id: string) => void }) {
  const rows = Array.isArray(data) ? data as Record<string, unknown>[] : [];
  const [form, setForm] = useState({
    id: "",
    nameAr: "",
    nameEn: "",
    descAr: "",
    descEn: "",
    category: "trivia",
    playMode: "competitive",
    tier: "free",
    engine: "quiz",
    minPlayers: 2,
    maxPlayers: 14,
    durationMin: 5,
    durationMax: 15,
    seconds: 30,
    rounds: 6,
    icon: "Gamepad2",
    sort: 50,
    status: "published",
    rulesAr: "",
    rulesEn: "",
    howAr: "",
    howEn: "",
  });
  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }
  function load(row: Record<string, unknown>) {
    setForm({
      id: String(row.id ?? ""),
      nameAr: String(row.name_ar ?? ""),
      nameEn: String(row.name_en ?? ""),
      descAr: String(row.description_ar ?? ""),
      descEn: String(row.description_en ?? ""),
      category: String(row.category ?? "trivia"),
      playMode: String(row.play_mode ?? "competitive"),
      tier: String(row.tier ?? "free"),
      engine: String(row.engine ?? "quiz"),
      minPlayers: Number(row.min_players ?? 2),
      maxPlayers: Number(row.max_players ?? 14),
      durationMin: Number(row.duration_min ?? 5),
      durationMax: Number(row.duration_max ?? 15),
      seconds: Number(row.default_seconds ?? 30),
      rounds: Number(row.default_rounds ?? 6),
      icon: String(row.icon ?? "Gamepad2"),
      sort: Number(row.sort_order ?? 50),
      status: String(row.status ?? "published"),
      rulesAr: String(row.rules_ar ?? ""),
      rulesEn: String(row.rules_en ?? ""),
      howAr: String(row.how_ar ?? ""),
      howEn: String(row.how_en ?? ""),
    });
  }
  return (
    <div className="space-y-4">
      <form className="grid gap-2 rounded-3xl bg-ivory p-4 md:grid-cols-2" onSubmit={(e) => { e.preventDefault(); onSave(form); }}>
        <input className={inputClass} placeholder="id" value={form.id} onChange={(e) => set("id", e.target.value)} />
        <input className={inputClass} placeholder="icon" value={form.icon} onChange={(e) => set("icon", e.target.value)} />
        <input className={inputClass} placeholder="الاسم" value={form.nameAr} onChange={(e) => set("nameAr", e.target.value)} />
        <input className={inputClass} placeholder="English name" value={form.nameEn} onChange={(e) => set("nameEn", e.target.value)} />
        <input className={inputClass} placeholder="الوصف" value={form.descAr} onChange={(e) => set("descAr", e.target.value)} />
        <input className={inputClass} placeholder="Description" value={form.descEn} onChange={(e) => set("descEn", e.target.value)} />
        <input className={inputClass} placeholder="category" value={form.category} onChange={(e) => set("category", e.target.value)} />
        <select className={inputClass} value={form.playMode} onChange={(e) => set("playMode", e.target.value)}>
          <option value="competitive">competitive</option>
          <option value="coop">coop</option>
          <option value="teams">teams</option>
          <option value="social">social</option>
        </select>
        <select className={inputClass} value={form.tier} onChange={(e) => set("tier", e.target.value)}>
          <option value="free">free</option>
          <option value="premium">premium</option>
        </select>
        <input className={inputClass} placeholder="engine" value={form.engine} onChange={(e) => set("engine", e.target.value)} />
        <input className={inputClass} type="number" value={form.minPlayers} onChange={(e) => set("minPlayers", Number(e.target.value))} />
        <input className={inputClass} type="number" value={form.maxPlayers} onChange={(e) => set("maxPlayers", Number(e.target.value))} />
        <input className={inputClass} type="number" value={form.durationMin} onChange={(e) => set("durationMin", Number(e.target.value))} />
        <input className={inputClass} type="number" value={form.durationMax} onChange={(e) => set("durationMax", Number(e.target.value))} />
        <textarea className={`${inputClass} min-h-24 md:col-span-2`} placeholder="القوانين" value={form.rulesAr} onChange={(e) => set("rulesAr", e.target.value)} />
        <textarea className={`${inputClass} min-h-24 md:col-span-2`} placeholder="طريقة اللعب" value={form.howAr} onChange={(e) => set("howAr", e.target.value)} />
        <Button type="submit">نشر اللعبة</Button>
      </form>
      <ul className="space-y-2">
        {rows.map((game) => (
          <li key={String(game.id)} className="flex items-center justify-between gap-3 rounded-2xl bg-ivory px-4 py-3">
            <button type="button" className="text-start" onClick={() => load(game)}>
              {String(game.name_ar)} · {String(game.min_players)}–{String(game.max_players)} · {String(game.tier)}
            </button>
            <Button type="button" tone="ghost" onClick={() => onToggle(String(game.id))}>{game.visible ? "hide" : "show"}</Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Questions({
  data,
  onStatus,
  onImport,
  onAi,
  onDraft,
}: {
  data: unknown;
  onStatus: (id: number, status: string) => void;
  onImport: (gameId: string, rows: unknown[]) => void;
  onAi: (payload: Record<string, unknown>) => void;
  onDraft: (payload: Record<string, unknown>) => void;
}) {
  const rows = Array.isArray(data) ? data as { id: number; game_id: string; prompt_ar: string; status: string }[] : [];
  const [gameId, setGameId] = useState("general");
  const [raw, setRaw] = useState("[]");
  const [topic, setTopic] = useState("السعودية");
  return (
    <div className="space-y-4">
      <div className="grid gap-3 rounded-3xl bg-ivory p-4 md:grid-cols-2">
        <input className={inputClass} value={gameId} onChange={(e) => setGameId(e.target.value)} />
        <input className={inputClass} value={topic} onChange={(e) => setTopic(e.target.value)} />
        <Button type="button" onClick={() => onAi({ gameId, topic, count: 4, language: "ar", difficulty: "easy" })}>Generate Questions with AI</Button>
        <Button type="button" tone="bronze" onClick={() => onDraft({ prompt: topic, count: 6, language: "ar" })}>Create Game with AI</Button>
        <textarea className={`${inputClass} min-h-28 md:col-span-2`} value={raw} onChange={(e) => setRaw(e.target.value)} />
        <Button type="button" tone="ghost" onClick={() => {
          try {
            const parsed = JSON.parse(raw) as unknown;
            onImport(gameId, Array.isArray(parsed) ? parsed : []);
          } catch {
            onImport(gameId, []);
          }
        }}>Bulk import JSON</Button>
      </div>
      <ul className="space-y-2">
        {rows.map((q) => (
          <li key={q.id} className="rounded-2xl bg-ivory px-4 py-3">
            <p className="text-sm text-muted">{q.game_id} · {q.status}</p>
            <p>{q.prompt_ar}</p>
            {q.status !== "published" ? <Button type="button" className="mt-2" onClick={() => onStatus(q.id, "published")}>approve</Button> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Settings({ data, onSave, onPurge }: { data: unknown; onSave: (key: string, value: unknown) => void; onPurge: () => void }) {
  const rows = Array.isArray(data) ? data as { key: string; value: unknown }[] : [];
  const brand = rows.find((row) => row.key === "brand")?.value as { ar?: string; en?: string } | undefined;
  const [ar, setAr] = useState(brand?.ar ?? "العش");
  const [en, setEn] = useState(brand?.en ?? "The Nest");
  const ads = rows.find((row) => row.key === "ads")?.value as { enabled?: boolean } | undefined;
  return (
    <div className="max-w-lg space-y-3">
      <Field label="brand ar"><input className={inputClass} value={ar} onChange={(e) => setAr(e.target.value)} /></Field>
      <Field label="brand en"><input className={inputClass} value={en} onChange={(e) => setEn(e.target.value)} /></Field>
      <Button type="button" onClick={() => onSave("brand", { ar, en })}>save brand</Button>
      <Button type="button" tone="ghost" onClick={() => onSave("ads", { enabled: !ads?.enabled })}>ads: {ads?.enabled ? "on" : "off"}</Button>
      <Button type="button" tone="bronze" onClick={onPurge}>purge seed</Button>
    </div>
  );
}

function Promos({ data, onSave }: { data: unknown; onSave: (payload: Record<string, unknown>) => void }) {
  const rows = Array.isArray(data) ? data as { code: string; kind: string; amount: number; uses: number }[] : [];
  const [code, setCode] = useState("LAMMAFREE");
  const [kind, setKind] = useState("days");
  const [amount, setAmount] = useState(7);
  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-4">
        <input className={inputClass} value={code} onChange={(e) => setCode(e.target.value)} />
        <select className={inputClass} value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="percent">percent</option>
          <option value="days">days</option>
          <option value="lifetime">lifetime</option>
        </select>
        <input className={inputClass} type="number" value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
        <Button type="button" onClick={() => onSave({ code, kind, amount })}>save</Button>
      </div>
      <ul className="space-y-2">{rows.map((row) => <li key={row.code} className="rounded-2xl bg-ivory px-4 py-3">{row.code} · {row.kind} · {row.amount} · uses {row.uses}</li>)}</ul>
    </div>
  );
}

function Plans({ data, onSave }: { data: unknown; onSave: (payload: Record<string, unknown>) => void }) {
  const rows = Array.isArray(data) ? data as { id: string; name_ar: string; name_en: string; price_sar: number }[] : [];
  const [prices, setPrices] = useState<Record<string, number>>({});
  return (
    <ul className="space-y-2">
      {rows.map((plan) => (
        <li key={plan.id} className="flex flex-wrap items-center gap-2 rounded-2xl bg-ivory px-4 py-3">
          <span className="min-w-32">{plan.name_ar}</span>
          <input className={`${inputClass} max-w-28`} type="number" defaultValue={plan.price_sar} onChange={(e) => setPrices({ ...prices, [plan.id]: Number(e.target.value) })} />
          <Button type="button" onClick={() => onSave({ id: plan.id, nameAr: plan.name_ar, nameEn: plan.name_en, price: prices[plan.id] ?? plan.price_sar })}>save</Button>
        </li>
      ))}
    </ul>
  );
}

function Payments({ data, onPaid }: { data: unknown; onPaid: (id: string) => void }) {
  const rows = Array.isArray(data) ? data as { id: string; status: string; amount_sar: number; provider: string }[] : [];
  return (
    <ul className="space-y-2">
      {rows.map((row) => (
        <li key={row.id} className="flex items-center justify-between rounded-2xl bg-ivory px-4 py-3">
          <span>{row.provider} · {row.amount_sar} · {row.status}</span>
          {row.status !== "paid" ? <Button type="button" onClick={() => onPaid(row.id)}>mark paid</Button> : null}
        </li>
      ))}
    </ul>
  );
}

function Users({ data, onRole }: { data: unknown; onRole: (id: string, role: string) => void }) {
  const rows = Array.isArray(data) ? data as { id: string; name: string; email: string; role: string | null }[] : [];
  return (
    <ul className="space-y-2">
      {rows.map((row) => (
        <li key={row.id} className="flex items-center justify-between rounded-2xl bg-ivory px-4 py-3">
          <span>{row.name} · {row.email} · {row.role ?? "player"}</span>
          <Button type="button" tone="ghost" onClick={() => onRole(row.id, row.role === "admin" ? "player" : "admin")}>toggle admin</Button>
        </li>
      ))}
    </ul>
  );
}

function Rooms({ data, onClose }: { data: unknown; onClose: (id: string) => void }) {
  const rows = Array.isArray(data) ? data as { id: string; game_id: string; status: string }[] : [];
  return (
    <ul className="space-y-2">
      {rows.map((row) => (
        <li key={row.id} className="flex items-center justify-between rounded-2xl bg-ivory px-4 py-3">
          <span>{row.id} · {row.game_id} · {row.status}</span>
          <Button type="button" tone="ghost" onClick={() => onClose(row.id)}>close</Button>
        </li>
      ))}
    </ul>
  );
}

function Lexicon({ data, onAdd }: { data: unknown; onAdd: (payload: Record<string, unknown>) => void }) {
  const rows = Array.isArray(data) ? data as { id: number; letter: string; category: string; word: string }[] : [];
  const [letter, setLetter] = useState("س");
  const [category, setCategory] = useState("country");
  const [word, setWord] = useState("");
  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-4">
        <input className={inputClass} value={letter} onChange={(e) => setLetter(e.target.value)} />
        <input className={inputClass} value={category} onChange={(e) => setCategory(e.target.value)} />
        <input className={inputClass} value={word} onChange={(e) => setWord(e.target.value)} />
        <Button type="button" onClick={() => onAdd({ locale: "ar", letter, category, word })}>add</Button>
      </div>
      <ul className="space-y-2">{rows.map((row) => <li key={row.id} className="rounded-2xl bg-ivory px-4 py-3">{row.letter} · {row.category} · {row.word}</li>)}</ul>
    </div>
  );
}

function Strings({ data, onSave }: { data: unknown; onSave: (payload: Record<string, unknown>) => void }) {
  const rows = Array.isArray(data) ? data as { locale: string; key: string; value: string }[] : [];
  const [key, setKey] = useState("hero.title");
  const [value, setValue] = useState("");
  const [locale, setLocale] = useState("ar");
  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-4">
        <input className={inputClass} value={locale} onChange={(e) => setLocale(e.target.value)} />
        <input className={inputClass} value={key} onChange={(e) => setKey(e.target.value)} />
        <input className={inputClass} value={value} onChange={(e) => setValue(e.target.value)} />
        <Button type="button" onClick={() => onSave({ locale, key, value })}>save</Button>
      </div>
      <ul className="space-y-2">{rows.map((row) => <li key={`${row.locale}-${row.key}`} className="rounded-2xl bg-ivory px-4 py-3">{row.locale}:{row.key} = {row.value}</li>)}</ul>
    </div>
  );
}

function Cats({ data, onSave }: { data: unknown; onSave: (payload: Record<string, unknown>) => void }) {
  const rows = Array.isArray(data) ? data as { id: string; name_ar: string; name_en: string }[] : [];
  const [id, setId] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [nameEn, setNameEn] = useState("");
  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-4">
        <input className={inputClass} placeholder="id" value={id} onChange={(e) => setId(e.target.value)} />
        <input className={inputClass} value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
        <input className={inputClass} value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
        <Button type="button" onClick={() => onSave({ id, nameAr, nameEn })}>save</Button>
      </div>
      <ul className="space-y-2">{rows.map((row) => <li key={row.id} className="rounded-2xl bg-ivory px-4 py-3">{row.id} · {row.name_ar}</li>)}</ul>
    </div>
  );
}

function Raw({ data }: { data: unknown }) {
  const rows = Array.isArray(data) ? data as { id?: string; plan_id?: string; status?: string; user_id?: string }[] : [];
  return <ul className="space-y-2">{rows.map((row) => <li key={row.id} className="rounded-2xl bg-ivory px-4 py-3">{row.user_id} · {row.plan_id} · {row.status}</li>)}</ul>;
}

function parseCsv(raw: string): Record<string, string>[] {
  const lines = raw.split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return [];
  const headers = lines[0].split(",").map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = line.split(",");
    return Object.fromEntries(headers.map((header, i) => [header, (cells[i] ?? "").trim()]));
  });
}

function CsvImport({ onPreview, onCommit }: { onPreview: (payload: Record<string, unknown>) => void; onCommit: (payload: Record<string, unknown>) => void }) {
  const [gameId, setGameId] = useState("general");
  const [raw, setRaw] = useState("");
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const headers = rows[0] ? Object.keys(rows[0]) : [];
  const [mapping, setMapping] = useState<Record<string, string>>({});
  return (
    <div className="space-y-3">
      <p className="text-sm text-ivory/70">ارفع CSV، طابق الأعمدة، ثم استورد كمسودة. لن تُنشر الأسئلة قبل الاعتماد من تبويب الأسئلة.</p>
      <div className="flex flex-wrap gap-2 text-sm">
        <a className="underline" href="/templates/mcq.csv">قالب اختيار من متعدد</a>
        <a className="underline" href="/templates/truefalse.csv">قالب صح وخطأ</a>
        <a className="underline" href="/templates/nest.csv">قالب العش</a>
        <a className="underline" href="/templates/generic.csv">قالب عام</a>
      </div>
      <input className={inputClass} value={gameId} onChange={(e) => setGameId(e.target.value)} placeholder="game id" />
      <input type="file" accept=".csv,text/csv" onChange={async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const text = await file.text();
        setRaw(text);
        setRows(parseCsv(text));
      }} />
      <textarea className={`${inputClass} min-h-28`} value={raw} onChange={(e) => { setRaw(e.target.value); setRows(parseCsv(e.target.value)); }} />
      {headers.length ? (
        <div className="grid gap-2 md:grid-cols-2">
          {["promptAr", "promptEn", "answer", "choice1", "choice2", "choice3", "choice4", "difficulty", "points", "category"].map((field) => (
            <label key={field} className="text-sm">
              {field}
              <select className={inputClass} value={mapping[field] ?? ""} onChange={(e) => setMapping({ ...mapping, [field]: e.target.value })}>
                <option value="">—</option>
                {headers.map((header) => <option key={header} value={header}>{header}</option>)}
              </select>
            </label>
          ))}
        </div>
      ) : null}
      <div className="flex gap-2">
        <Button type="button" tone="ghost" onClick={() => onPreview({ gameId, rows, mapping, filename: "upload.csv" })}>معاينة</Button>
        <Button type="button" onClick={() => onCommit({ gameId, rows, mapping, filename: "upload.csv" })}>استيراد كمسودة</Button>
      </div>
      {rows[0] ? <p className="text-sm text-ivory/60">صف نموذجي: {JSON.stringify(rows[0])}</p> : null}
    </div>
  );
}

function AiDesk({ data, onGenerate, onReview }: { data: unknown; onGenerate: (payload: Record<string, unknown>) => void; onReview: (payload: Record<string, unknown>) => void }) {
  const rows = Array.isArray(data) ? data as { id: number; kind: string; status: string; note: string }[] : [];
  const [topic, setTopic] = useState("التاريخ");
  const [count, setCount] = useState(4);
  const [difficulty, setDifficulty] = useState("hard");
  return (
    <div className="space-y-4">
      <p className="text-sm text-ivory/70">التوليد يضع الأسئلة بحالة pending ولا ينشرها. راجعها ثم اعتمدها من تبويب الأسئلة. المراجعة بالذكاء تحتاج XAI_API_KEY.</p>
      <div className="grid gap-2 md:grid-cols-4">
        <input className={inputClass} value={topic} onChange={(e) => setTopic(e.target.value)} />
        <input className={inputClass} type="number" min={1} max={8} value={count} onChange={(e) => setCount(Number(e.target.value))} />
        <select className={inputClass} value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
          <option value="easy">سهل</option>
          <option value="medium">متوسط</option>
          <option value="hard">صعب</option>
        </select>
        <Button type="button" onClick={() => onGenerate({ gameId: "general", topic, count, difficulty, language: "ar" })}>توليد للمراجعة</Button>
      </div>
      <ul className="space-y-2">
        {rows.map((row) => (
          <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-ivory px-4 py-3">
            <span>{row.kind} · {row.status} · {row.note}</span>
            <Button type="button" tone="ghost" onClick={() => onReview({ id: row.id, status: "approved", note: "اعتُمد" })}>اعتماد السجل</Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Sections({ data, onSave }: { data: unknown; onSave: (payload: Record<string, unknown>) => void }) {
  const rows = Array.isArray(data) ? data as { id: string; name_ar: string; href: string; visible: boolean }[] : [];
  const [id, setId] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [href, setHref] = useState("/");
  return (
    <div className="space-y-3">
      <div className="grid gap-2 md:grid-cols-4">
        <input className={inputClass} placeholder="id" value={id} onChange={(e) => setId(e.target.value)} />
        <input className={inputClass} placeholder="الاسم" value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
        <input className={inputClass} placeholder="/path" value={href} onChange={(e) => setHref(e.target.value)} />
        <Button type="button" onClick={() => onSave({ id, nameAr, nameEn: nameAr, href })}>حفظ القسم</Button>
      </div>
      <ul className="space-y-2">{rows.map((row) => <li key={row.id} className="rounded-2xl bg-ivory px-4 py-3">{row.name_ar} · {row.href} · {row.visible ? "ظاهر" : "مخفي"}</li>)}</ul>
    </div>
  );
}

function Addons({ data, onToggle }: { data: unknown; onToggle: (id: string) => void }) {
  const rows = Array.isArray(data) ? data as { id: string; name_ar: string; description_ar: string; enabled: boolean }[] : [];
  return (
    <ul className="space-y-2">
      {rows.map((row) => (
        <li key={row.id} className="flex items-center justify-between gap-3 rounded-2xl bg-ivory px-4 py-3">
          <span><b>{row.name_ar}</b><span className="mt-1 block text-sm text-muted">{row.description_ar}</span></span>
          <Button type="button" tone={row.enabled ? "bronze" : "ghost"} onClick={() => onToggle(row.id)}>{row.enabled ? "مفعل" : "متوقف"}</Button>
        </li>
      ))}
    </ul>
  );
}
