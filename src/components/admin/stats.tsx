import { useEffect, useState, type ReactNode } from "react";
import { GameIcon, Glyph } from "@/components/brand";
import { Button, cx } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { Loading, Notice, dbMessage, needsSetup } from "./common";

type Stats = {
  days: number;
  totals: { rooms: number; played: number; finished: number; people: number; avg_people: number };
  now: { lobby: number; playing: number; people: number };
  by_day: Array<{ day: string; rooms: number; people: number }>;
  by_game: Array<{ slug: string; title: string; active: boolean; rooms: number; people: number }>;
  by_hour: Array<{ hour: number; rooms: number }>;
  content: { questions: Record<string, number>; heads_words: number; outsider_topics: number; halba_topics: number; halba_with_answers: number };
};

const RANGES = [7, 30, 90];
const num = new Intl.NumberFormat("ar-u-nu-latn");
const dayLabel = new Intl.DateTimeFormat("ar-u-nu-latn", { day: "numeric", month: "short", timeZone: "UTC" });

/** Usage numbers, computed by admin_stats() from the rooms in the database. */
export function StatsTab() {
  const [days, setDays] = useState(30);
  const [stats, setStats] = useState<Stats | null>(null);
  const [setup, setSetup] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function refresh(range = days) {
    if (!supabase) return;
    setLoading(true);
    const { data, error: rpcError } = await supabase.rpc("admin_stats", { p_days: range });
    setLoading(false);
    if (rpcError) {
      setSetup(needsSetup(rpcError));
      setError(needsSetup(rpcError) ? null : dbMessage(rpcError, "تعذّر تحميل الإحصاءات."));
      setStats(null);
      return;
    }
    setSetup(false);
    setError(null);
    setStats(data as Stats);
  }

  useEffect(() => {
    void refresh(days);
    // refresh reads the range passed in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);

  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="المدة" className="flex gap-1 rounded-full border border-line-strong/70 bg-deep-2/60 p-1">
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={days === r}
              onClick={() => setDays(r)}
              className={cx("min-h-10 rounded-full px-4 text-[14px] font-semibold transition", days === r ? "btn-gold" : "text-mist hover:text-ivory")}
            >
              آخر {r} يومًا
            </button>
          ))}
        </div>
        <Button tone="quiet" className="ms-auto" onClick={() => refresh()} disabled={loading}>
          <Glyph name="refresh" className={cx("size-[18px]", loading && "animate-spin motion-reduce:animate-none")} />
          تحديث
        </Button>
      </div>

      {setup ? (
        <Notice tone="info">
          الإحصاءات تحتاج الملف <code dir="ltr" className="rounded bg-night/60 px-1.5 py-0.5 text-[13px]">supabase/admin_v2.sql</code>. شغّله مرة واحدة من SQL Editor في Supabase، ثم حدّث الصفحة.
        </Notice>
      ) : null}
      {error ? <Notice tone="error">{error}</Notice> : null}

      {!stats && !setup && !error ? <Loading /> : null}
      {stats ? <StatsBody stats={stats} /> : null}
    </div>
  );
}

function StatsBody({ stats }: { stats: Stats }) {
  const t = stats.totals;
  const finishedShare = t.rooms > 0 ? Math.round((t.finished / t.rooms) * 100) : 0;
  return (
    <>
      <section aria-label="الآن" className="surface flex flex-wrap items-center gap-x-6 gap-y-2 rounded-[22px] px-4 py-3">
        <span className="inline-flex items-center gap-2 text-[15px] font-bold text-ivory">
          <span aria-hidden="true" className="size-2.5 rounded-full bg-correct shadow-[0_0_10px_#3ddc97]" />
          الآن
        </span>
        <span className="text-[14px] text-mist">
          جارية <b className="tabular-nums text-ivory">{num.format(stats.now.playing)}</b>
        </span>
        <span className="text-[14px] text-mist">
          بانتظار البدء <b className="tabular-nums text-ivory">{num.format(stats.now.lobby)}</b>
        </span>
        <span className="text-[14px] text-mist">
          في الغرف <b className="tabular-nums text-ivory">{num.format(stats.now.people)}</b> شخص
        </span>
      </section>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="غرف أُنشئت" value={num.format(t.rooms)} />
        <Tile label="بدأ فيها اللعب" value={num.format(t.played)} sub={t.rooms ? `${Math.round((t.played / t.rooms) * 100)}% من الغرف` : undefined} />
        <Tile label="انتهت" value={num.format(t.finished)} sub={t.rooms ? `${finishedShare}% من الغرف` : undefined} />
        <Tile label="متوسط الأشخاص في الغرفة" value={num.format(t.avg_people)} sub={`${num.format(t.people)} انضمام بالمجموع`} />
      </div>

      <Panel title="الغرف يومًا بيوم" note="بتوقيت الرياض">
        <Bars
          items={stats.by_day.map((d) => ({ key: d.day, value: d.rooms, label: dayLabel.format(new Date(`${d.day}T00:00:00Z`)), tip: `${d.rooms} غرفة · ${d.people} شخص` }))}
          every={stats.by_day.length > 31 ? 14 : stats.by_day.length > 10 ? 5 : 1}
        />
      </Panel>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="حسب اللعبة">
          <GameBars games={stats.by_game} />
        </Panel>
        <Panel title="أوقات الذروة" note="عدد الغرف حسب ساعة الإنشاء">
          <Bars
            items={stats.by_hour.map((h) => ({ key: String(h.hour), value: h.rooms, label: String(h.hour), tip: `الساعة ${h.hour}:00 · ${h.rooms} غرفة` }))}
            every={3}
          />
        </Panel>
      </div>

      <Panel title="المحتوى">
        <Content stats={stats} />
      </Panel>
    </>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="surface rounded-[20px] p-4">
      <p className="text-[13px] text-mist">{label}</p>
      <p className="mt-1 font-display text-[32px] leading-10 font-extrabold tabular-nums text-ivory">{value}</p>
      {sub ? <p className="text-[12px] text-mist">{sub}</p> : null}
    </div>
  );
}

function Panel({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="surface min-w-0 rounded-[22px] p-4 sm:p-5">
      <h2 className="text-[18px] leading-7">{title}</h2>
      {note ? <p className="text-[12px] text-mist">{note}</p> : null}
      <div className="mt-3">{children}</div>
    </section>
  );
}

/**
 * Vertical bars, one series. Hovering or focusing a bar shows its exact value;
 * the tallest bar is labelled; the axis shows every Nth label.
 */
function Bars({ items, every }: { items: Array<{ key: string; value: number; label: string; tip: string }>; every: number }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  const total = items.reduce((s, i) => s + i.value, 0);
  const peak = items.findIndex((i) => i.value === max && i.value > 0);
  if (total === 0) return <p className="py-6 text-center text-[14px] text-mist">لا توجد غرف في هذه المدة.</p>;
  return (
    <div dir="ltr">
      <div className="relative mt-5 flex h-40 items-end gap-[2px] border-b border-line-strong/60">
        {items.map((i, n) => (
          <div key={i.key} tabIndex={0} aria-label={`${i.label}: ${i.tip}`} className="group relative flex h-full min-w-0 flex-1 items-end outline-none">
            <div
              className={cx("w-full rounded-t-[4px] transition", i.value > 0 ? "bg-gold/80 group-hover:bg-gold group-focus-visible:bg-gold" : "bg-transparent")}
              style={{ height: `${(i.value / max) * 100}%`, minHeight: i.value > 0 ? 3 : 0 }}
            />
            {n === peak ? (
              <span className="pointer-events-none absolute inset-x-[-8px] text-center text-[11px] font-bold text-ivory tabular-nums" style={{ bottom: `calc(${(i.value / max) * 100}% + 2px)` }}>
                {i.value}
              </span>
            ) : null}
            <span
              dir="rtl"
              className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 hidden -translate-x-1/2 rounded-[10px] border border-line-strong bg-night px-2.5 py-1.5 text-[12px] whitespace-nowrap text-ivory shadow-lift group-hover:block group-focus-visible:block"
            >
              <b>{i.label}</b> · {i.tip}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-[2px]">
        {items.map((i, n) => (
          <span key={i.key} className="min-w-0 flex-1 overflow-visible text-center text-[10px] whitespace-nowrap text-mist">
            {n % every === 0 ? i.label : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

function GameBars({ games }: { games: Stats["by_game"] }) {
  const max = Math.max(1, ...games.map((g) => g.rooms));
  return (
    <ul className="grid gap-2.5">
      {games.map((g) => (
        <li key={g.slug} className="grid grid-cols-[auto_1fr] items-center gap-3">
          <GameIcon id={g.slug} size="sm" className="size-9!" />
          <div className="min-w-0">
            <p className="flex items-baseline gap-2 text-[14px]">
              <span className="truncate font-semibold text-ivory">{g.title}</span>
              {!g.active ? <span className="text-[11px] text-faint">(موقوفة)</span> : null}
              <span className="ms-auto shrink-0 tabular-nums text-mist">
                <b className="text-ivory">{num.format(g.rooms)}</b> غرفة · {num.format(g.people)} شخص
              </span>
            </p>
            <div className="mt-1 h-2 rounded-full bg-deep-2/80">
              <div className="h-full rounded-full bg-gold/80" style={{ width: `${(g.rooms / max) * 100}%` }} />
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function Content({ stats }: { stats: Stats }) {
  const c = stats.content;
  const titles = Object.fromEntries(stats.by_game.map((g) => [g.slug, g.title]));
  const rows: Array<{ label: string; value: number; warn?: string }> = [
    ...Object.entries(c.questions).map(([slug, n]) => ({ label: `أسئلة ${titles[slug] ?? slug}`, value: n, warn: n < 30 ? "قليلة" : undefined })),
    { label: "كلمات «على راسك»", value: c.heads_words, warn: c.heads_words < 100 ? "قليلة" : undefined },
    { label: "مواضيع «برة السالفة»", value: c.outsider_topics, warn: c.outsider_topics < 15 ? "قليلة" : undefined },
    { label: "مواضيع «الحلبة»", value: c.halba_topics, warn: c.halba_topics < 60 ? "قليلة" : undefined },
    {
      label: "مواضيع الحلبة بإجابات مرجعية",
      value: c.halba_with_answers,
      warn: c.halba_with_answers < c.halba_topics ? `${c.halba_topics - c.halba_with_answers} بدون إجابات` : undefined,
    },
  ];
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {rows.map((r) => (
        <li key={r.label} className="flex items-center gap-3 rounded-[14px] border border-line bg-deep-2/50 px-3 py-2">
          <span className="min-w-0 flex-1 truncate text-[14px] text-ivory">{r.label}</span>
          {r.warn ? (
            <span className="inline-flex items-center gap-1 text-[12px] text-gold">
              <Glyph name="alert" className="size-4" />
              {r.warn}
            </span>
          ) : null}
          <b className="tabular-nums text-ivory">{num.format(r.value)}</b>
        </li>
      ))}
    </ul>
  );
}
