import { useEffect, useState, type ReactNode } from "react";
import { GameIcon, Glyph } from "@/components/brand";
import { Button, cx } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { Loading, Notice, dbMessage } from "./common";

type Grid = { category: string; easy: number; medium: number; hard: number };
type Diff = { game: string; easy: number; medium: number; hard: number; total: number };
type Topic = { id: string; topic: string; answers?: number; min?: number };
type Dup = { text: string; count: number; ids: string[]; game?: string };
type Health = {
  grid: Grid[];
  difficulty: Diff[];
  halba: { total: number; no_answers: Topic[]; no_level: Topic[]; short: Topic[]; levels: { easy: number; medium: number; hard: number; open: number } };
  duplicates: { questions: Dup[]; halba: Dup[]; heads: Dup[]; outsider: Dup[] };
};

const GAME_NAMES: Record<string, string> = {
  "tactical-grid": "تحديات العش",
  "bluff-master": "سيد الخداع",
  "hex-letters": "خلية الحروف",
};
const num = new Intl.NumberFormat("ar-u-nu-latn");

/** «صحة المحتوى»: what each game is missing, from admin_content_health() (supabase/admin_v4.sql). */
export function HealthTab() {
  const [health, setHealth] = useState<Health | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "setup" | "error">("loading");
  const [message, setMessage] = useState<string | null>(null);

  async function refresh() {
    if (!supabase) return;
    const { data, error } = await supabase.rpc("admin_content_health");
    if (error) {
      const missing = error.code === "PGRST202" || /function/i.test(error.message);
      setState(missing ? "setup" : "error");
      setMessage(missing ? null : dbMessage(error, "تعذّر تحميل صحة المحتوى."));
      return;
    }
    setHealth(data as Health);
    setState("ok");
  }

  useEffect(() => {
    void refresh();
  }, []);

  if (state === "loading") return <Loading />;
  if (state === "setup") {
    return (
      <Notice tone="info">
        هذا القسم يحتاج الملف <code dir="ltr" className="rounded bg-night/60 px-1.5 py-0.5 text-[13px]">supabase/admin_v4.sql</code>. شغّله مرة واحدة من SQL Editor في Supabase، ثم حدّث الصفحة.
      </Notice>
    );
  }
  if (state === "error" || !health) return <Notice tone="error">{message ?? "تعذّر التحميل."}</Notice>;

  const dupCount = health.duplicates.questions.length + health.duplicates.halba.length + health.duplicates.heads.length + health.duplicates.outsider.length;
  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-[14px] text-mist">ما ينقص كل لعبة، وما يحتاج تصحيحًا. الأحمر يمنع اللعب، والذهبي يقلّل التنوع.</p>
        <Button tone="quiet" onClick={() => refresh()}>
          <Glyph name="refresh" className="size-[18px]" />
          تحديث
        </Button>
      </div>
      <GridMatrix rows={health.grid} />
      <Difficulty rows={health.difficulty} />
      <HalbaHealth h={health.halba} />
      <Panel title={`المكررات (${num.format(dupCount)})`} note="بعد توحيد الكتابة: الهمزات والتشكيل و«ال» والمسافات وعلامات الترقيم. «احذف المكرر» يُبقي واحدًا ويحذف الباقي.">
        {dupCount === 0 ? (
          <p className="text-[14px] text-correct">لا توجد مكررات.</p>
        ) : (
          <div className="grid gap-4">
            <DupList title="بنك الأسئلة" table="questions_bank" rows={health.duplicates.questions} onDone={refresh} />
            <DupList title="مواضيع الحلبة" table="alhalba_topics" rows={health.duplicates.halba} onDone={refresh} />
            <DupList title="كلمات «هل تعرف»" table="heads_words" rows={health.duplicates.heads} onDone={refresh} />
            <DupList title="مواضيع «برة السالفة»" table="outsider_topics" rows={health.duplicates.outsider} onDone={refresh} />
          </div>
        )}
      </Panel>
    </div>
  );
}

function Panel({ title, note, icon, children }: { title: string; note?: string; icon?: string; children: ReactNode }) {
  return (
    <section className="surface min-w-0 rounded-[22px] p-4 sm:p-5">
      <h2 className="flex items-center gap-2 text-[18px] leading-7">
        {icon ? <GameIcon id={icon} size="sm" className="size-8!" /> : null}
        {title}
      </h2>
      {note ? <p className="text-[12px] leading-5 text-mist">{note}</p> : null}
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** Grid: each category needs 2 questions per level to be offered; 6 or more keeps boards varied. */
function GridMatrix({ rows }: { rows: Grid[] }) {
  const playable = rows.filter((r) => r.easy >= 2 && r.medium >= 2 && r.hard >= 2).length;
  const cell = (n: number) => (
    <td className="p-1 text-center">
      <span
        className={cx(
          "inline-flex min-w-12 justify-center rounded-[10px] px-2 py-1 font-bold tabular-nums",
          n < 2 ? "bg-wrong-fill/25 text-wrong" : n < 6 ? "bg-gold/15 text-gold" : "bg-correct-fill/20 text-correct",
        )}
      >
        {num.format(n)}
      </span>
    </td>
  );
  return (
    <Panel
      icon="tactical-grid"
      title="تحديات العش: الفئات × المستويات"
      note={`${num.format(playable)} من ${num.format(rows.length)} فئة تظهر للمضيف. الفئة تحتاج سؤالين على الأقل من كل مستوى (200 و400 و600). الأحمر: أقل من 2 فلا تظهر الفئة. الذهبي: أقل من 6 فتتكرر الأسئلة.`}
    >
      {rows.length === 0 ? (
        <p className="text-[14px] text-mist">لا توجد أسئلة لتحديات العش بعد.</p>
      ) : (
        <div className="-mx-1 overflow-x-auto px-1">
          <table className="w-full min-w-[420px] text-[14px]">
            <thead>
              <tr className="text-[12px] text-mist">
                <th className="py-2 text-start font-semibold">الفئة</th>
                <th className="py-2 font-semibold">سهل (200)</th>
                <th className="py-2 font-semibold">متوسط (400)</th>
                <th className="py-2 font-semibold">صعب (600)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.category} className="border-t border-line">
                  <td className="py-1.5 text-ivory">{r.category}</td>
                  {cell(r.easy)}
                  {cell(r.medium)}
                  {cell(r.hard)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

/** Difficulty mix per game, with a warning when a level is almost unused. */
function Difficulty({ rows }: { rows: Diff[] }) {
  return (
    <Panel title="توزيع الصعوبة في بنك الأسئلة" note="إذا كانت كل الأسئلة بمستوى واحد، فاختيار الصعوبة لا يغيّر شيئًا في اللعب.">
      <ul className="grid gap-3">
        {rows.map((r) => {
          const parts = [
            { key: "easy", label: "سهل", n: r.easy, cls: "bg-correct/70" },
            { key: "medium", label: "متوسط", n: r.medium, cls: "bg-gold/80" },
            { key: "hard", label: "صعب", n: r.hard, cls: "bg-wrong/70" },
          ];
          const thin = parts.filter((p) => r.total > 0 && p.n / r.total < 0.1);
          return (
            <li key={r.game} className="grid gap-1.5">
              <p className="flex flex-wrap items-baseline gap-2 text-[14px]">
                <span className="font-semibold text-ivory">{GAME_NAMES[r.game] ?? r.game}</span>
                <span className="text-mist">{num.format(r.total)} سؤال</span>
                {thin.length > 0 ? (
                  <span className="inline-flex items-center gap-1 text-[12px] text-gold">
                    <Glyph name="alert" className="size-4" />
                    قليل جدًا: {thin.map((p) => p.label).join("، ")}
                  </span>
                ) : null}
              </p>
              <div className="flex h-3 overflow-hidden rounded-full bg-deep-2/80">
                {parts.map((p) => (r.total > 0 && p.n > 0 ? <span key={p.key} className={p.cls} style={{ width: `${(p.n / r.total) * 100}%` }} /> : null))}
              </div>
              <p className="text-[12px] text-mist">
                {parts.map((p) => `${p.label} ${num.format(p.n)}`).join(" · ")}
              </p>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function HalbaHealth({ h }: { h: Health["halba"] }) {
  return (
    <Panel
      icon="alhalba"
      title="مواضيع الحلبة"
      note={`${num.format(h.total)} موضوع: سهل ${num.format(h.levels.easy)} · متوسط ${num.format(h.levels.medium)} · صعب ${num.format(h.levels.hard)} · مفتوح ${num.format(h.levels.open)}. عدّل المواضيع من تبويب «الكلمات والمواضيع».`}
    >
      <div className="grid gap-3">
        <TopicList title="بدون قائمة إجابات" hint="المطابقة التلقائية لا تعمل فيها، وكل الإجابات تذهب للحَكَم." rows={h.no_answers} tone="wrong" />
        <TopicList title="بدون مستوى" hint="تُعامل «متوسط» في اختيار المستوى." rows={h.no_level} tone="gold" />
        <TopicList title="قائمة قصيرة" hint="أقل من ضعف المزايدة الأولى: الإجابات الصحيحة الناقصة تذهب للحَكَم." rows={h.short} tone="gold" detail={(t) => `${t.answers} إجابة · تبدأ من ${t.min}`} />
      </div>
    </Panel>
  );
}

function TopicList({ title, hint, rows, tone, detail }: { title: string; hint: string; rows: Topic[]; tone: "wrong" | "gold"; detail?: (t: Topic) => string }) {
  if (rows.length === 0) {
    return (
      <p className="flex items-center gap-2 text-[14px] text-correct">
        <Glyph name="check" className="size-4" />
        {title}: لا يوجد
      </p>
    );
  }
  return (
    <details className="rounded-[14px] border border-line bg-deep-2/40 px-3 py-2">
      <summary className={cx("cursor-pointer text-[14px] font-semibold", tone === "wrong" ? "text-wrong" : "text-gold")}>
        {title} ({num.format(rows.length)})
        <span className="ms-2 text-[12px] font-normal text-mist">{hint}</span>
      </summary>
      <ul className="mt-2 flex flex-wrap gap-1.5">
        {rows.map((t) => (
          <li key={t.id} className="rounded-full border border-line bg-deep/60 px-3 py-1 text-[13px] text-ivory">
            {t.topic}
            {detail ? <span className="ms-1.5 text-mist">({detail(t)})</span> : null}
          </li>
        ))}
      </ul>
    </details>
  );
}

function DupList({ title, table, rows, onDone }: { title: string; table: string; rows: Dup[]; onDone: () => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (rows.length === 0) return null;
  async function keepOne(d: Dup) {
    if (!supabase) return;
    setBusy(d.ids.join());
    const { error: e } = await supabase.from(table).delete().in("id", d.ids.slice(1));
    setBusy(null);
    if (e) return setError(dbMessage(e, "تعذّر الحذف."));
    await onDone();
  }
  return (
    <div className="grid gap-2">
      <h3 className="text-[15px] text-ivory">
        {title} ({num.format(rows.length)})
      </h3>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <ul className="grid gap-1.5">
        {rows.map((d) => (
          <li key={d.ids.join()} className="flex flex-wrap items-center gap-2 rounded-[14px] border border-gold/30 bg-gold/5 px-3 py-2 text-[14px]">
            <span className="min-w-0 flex-1 text-ivory">
              {d.text}
              {d.game ? <span className="ms-2 text-[12px] text-mist">{GAME_NAMES[d.game] ?? d.game}</span> : null}
            </span>
            <span className="text-[12px] text-gold">{num.format(d.count)} مرات</span>
            <Button tone="quiet" className="min-h-9 px-3 text-[13px]" onClick={() => keepOne(d)} disabled={busy === d.ids.join()}>
              احذف المكرر
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
