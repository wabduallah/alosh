import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Shell } from "@/components/shell";
import { Button, Field, inputClass } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { adminMutate, adminQuery } from "@/lib/lamma/admin.rpc";

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "الإدارة — العش" }] }),
  component: AdminPage,
});

const TABS = ["dashboard", "addons", "users", "rooms", "plans", "subscriptions", "payments", "promos", "translations", "settings", "reports"] as const;

function AdminPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<(typeof TABS)[number]>("dashboard");
  const [data, setData] = useState<unknown>(null);
  const [note, setNote] = useState<string | null>(null);
  const [allowed, setAllowed] = useState<boolean | null>(null);

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
        <p className="mt-2 text-ivory/70">هذه الصفحة للمشرفين فقط. سجّل الدخول بحساب مشرف للمتابعة.</p>
        <div className="mt-4">
          <Link to="/login" className="inline-flex min-h-11 items-center rounded-full bg-neon px-5 font-extrabold text-night">
            تسجيل الدخول
          </Link>
        </div>
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
        {tab === "settings" ? <Settings data={data} onSave={(key, value) => void mutate("saveSetting", { key, value })} /> : null}
        {tab === "promos" ? <Promos data={data} onSave={(payload) => void mutate("savePromo", payload)} /> : null}
        {tab === "plans" ? <Plans data={data} onSave={(payload) => void mutate("savePlan", payload)} /> : null}
        {tab === "payments" ? <Payments data={data} onPaid={(id) => void mutate("markPayment", { id })} /> : null}
        {tab === "users" ? <Users data={data} onRole={(userId, role) => void mutate("setRole", { userId, role })} /> : null}
        {tab === "rooms" ? <Rooms data={data} onClose={(id) => void mutate("closeRoom", { id })} onReset={(id) => void mutate("resetRoom", { id })} /> : null}
        {tab === "translations" ? <Strings data={data} onSave={(payload) => void mutate("setString", payload)} /> : null}
        {tab === "addons" ? <Addons data={data} onToggle={(id) => void mutate("toggleAddon", { id })} /> : null}
        {tab === "subscriptions" ? <Raw data={data} /> : null}
      </div>
    </Shell>
  );
}

function Dash({ data }: { data: unknown }) {
  const row = (data ?? {}) as Record<string, number>;
  const cards = ["users", "roomsToday", "playersToday", "activeRooms", "revenue", "subs"] as const;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {cards.map((key) => (
          <div key={key} className="rounded-3xl border border-white/10 bg-white/[0.03] p-4">
            <p className="text-sm text-muted">{key}</p>
            <p className="font-display text-3xl tabular-nums">{String(row[key] ?? 0)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function Settings({ data, onSave }: { data: unknown; onSave: (key: string, value: unknown) => void }) {
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
      <ul className="space-y-2">{rows.map((row) => <li key={row.code} className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">{row.code} · {row.kind} · {row.amount} · uses {row.uses}</li>)}</ul>
    </div>
  );
}

function Plans({ data, onSave }: { data: unknown; onSave: (payload: Record<string, unknown>) => void }) {
  const rows = Array.isArray(data) ? data as { id: string; name_ar: string; name_en: string; price_sar: number }[] : [];
  const [prices, setPrices] = useState<Record<string, number>>({});
  return (
    <ul className="space-y-2">
      {rows.map((plan) => (
        <li key={plan.id} className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
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
        <li key={row.id} className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
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
        <li key={row.id} className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
          <span>{row.name} · {row.email} · {row.role ?? "player"}</span>
          <Button type="button" tone="ghost" onClick={() => onRole(row.id, row.role === "admin" ? "player" : "admin")}>toggle admin</Button>
        </li>
      ))}
    </ul>
  );
}

function Rooms({ data, onClose, onReset }: { data: unknown; onClose: (id: string) => void; onReset: (id: string) => void }) {
  const rows = Array.isArray(data) ? data as { id: string; game_id: string; status: string; seated?: number; online?: number }[] : [];
  const onlineNow = rows.reduce((sum, row) => sum + (row.online ?? 0), 0);
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">لاعبون متصلون الآن (آخر دقيقتين) في الغرف المعروضة: <span className="font-bold text-neon tabular-nums">{onlineNow}</span></p>
      <ul className="space-y-2">
        {rows.map((row) => (
          <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[rgb(255_255_255/0.08)] bg-[rgb(255_255_255/0.03)] px-4 py-3">
            <span>{row.id} · {row.game_id} · {row.status} · متصل {row.online ?? 0} / {row.seated ?? 0}</span>
            <span className="flex gap-2">
              <button type="button" className="rounded-full border border-[#06b6d4] px-3 py-1 text-sm text-[#67e8f9]" onClick={() => onReset(row.id)}>تصفير</button>
              <button type="button" className="rounded-full bg-[#06b6d4] px-3 py-1 text-sm font-extrabold text-black" onClick={() => onClose(row.id)}>إنهاء</button>
            </span>
          </li>
        ))}
      </ul>
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
      <ul className="space-y-2">{rows.map((row) => <li key={`${row.locale}-${row.key}`} className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">{row.locale}:{row.key} = {row.value}</li>)}</ul>
    </div>
  );
}

function Raw({ data }: { data: unknown }) {
  const rows = Array.isArray(data) ? data as { id?: string; plan_id?: string; status?: string; user_id?: string }[] : [];
  return <ul className="space-y-2">{rows.map((row) => <li key={row.id} className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">{row.user_id} · {row.plan_id} · {row.status}</li>)}</ul>;
}

function Addons({ data, onToggle }: { data: unknown; onToggle: (id: string) => void }) {
  const rows = Array.isArray(data) ? data as { id: string; name_ar: string; description_ar: string; enabled: boolean }[] : [];
  return (
    <ul className="space-y-2">
      {rows.map((row) => (
        <li key={row.id} className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
          <span><b>{row.name_ar}</b><span className="mt-1 block text-sm text-muted">{row.description_ar}</span></span>
          <Button type="button" tone={row.enabled ? "violet" : "ghost"} onClick={() => onToggle(row.id)}>{row.enabled ? "مفعل" : "متوقف"}</Button>
        </li>
      ))}
    </ul>
  );
}
