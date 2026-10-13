import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Glyph } from "@/components/brand";
import { Button, buttonBase, buttonTone, cx } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { Loading, Notice, dbMessage } from "./common";

export type Feedback = {
  id: string;
  created_at: string;
  game_slug: string | null;
  room_code: string | null;
  kind: "problem" | "idea" | "other";
  message: string;
  contact: string | null;
  page: string | null;
  status: "new" | "read" | "done";
};

const KINDS: Record<Feedback["kind"], { label: string; icon: string; cls: string }> = {
  problem: { label: "مشكلة", icon: "alert", cls: "bg-wrong-fill/20 text-wrong" },
  idea: { label: "اقتراح", icon: "fire", cls: "bg-gold/15 text-gold" },
  other: { label: "أخرى", icon: "info", cls: "bg-deep-2 text-mist" },
};
const STATUS: Array<{ key: "open" | Feedback["status"] | "all"; label: string }> = [
  { key: "open", label: "تحتاج متابعة" },
  { key: "new", label: "جديدة" },
  { key: "done", label: "تمت" },
  { key: "all", label: "الكل" },
];
const when = new Intl.DateTimeFormat("ar-u-nu-latn", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Riyadh" });

/** How many messages are new: for the tab's badge. */
export async function countNewFeedback() {
  if (!supabase) return 0;
  const { count, error } = await supabase.from("feedback").select("id", { count: "exact", head: true }).eq("status", "new");
  return error ? 0 : (count ?? 0);
}

/** «الرسائل»: problems and ideas players sent from the end of a game (supabase/admin_v4.sql). */
export function MessagesTab({ onCount }: { onCount?: (n: number) => void }) {
  const [rows, setRows] = useState<Feedback[] | null>(null);
  const [setup, setSetup] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<(typeof STATUS)[number]["key"]>("open");
  const [titles, setTitles] = useState<Record<string, string>>({});

  async function refresh() {
    if (!supabase) return;
    const [{ data, error: e }, { data: games }] = await Promise.all([
      supabase.from("feedback").select("*").order("created_at", { ascending: false }).limit(300),
      supabase.from("games").select("slug, title_ar"),
    ]);
    if (e) {
      const missing = e.code === "42P01" || e.code === "PGRST205" || /does not exist|schema cache/i.test(e.message);
      setSetup(missing);
      if (!missing) setError(dbMessage(e, "تعذّر تحميل الرسائل."));
      setRows([]);
      return;
    }
    setTitles(Object.fromEntries(((games ?? []) as Array<{ slug: string; title_ar: string }>).map((g) => [g.slug, g.title_ar])));
    const list = (data ?? []) as Feedback[];
    setRows(list);
    onCount?.(list.filter((r) => r.status === "new").length);
  }

  useEffect(() => {
    void refresh();
    // onCount is a setter from the parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function setStatus(row: Feedback, status: Feedback["status"]) {
    if (!supabase) return;
    const { error: e } = await supabase.from("feedback").update({ status }).eq("id", row.id);
    if (e) return setError(dbMessage(e));
    await refresh();
  }

  async function remove(row: Feedback) {
    if (!supabase) return;
    const { error: e } = await supabase.from("feedback").delete().eq("id", row.id);
    if (e) return setError(dbMessage(e, "تعذّر الحذف."));
    await refresh();
  }

  const shown = useMemo(
    () => (rows ?? []).filter((r) => (filter === "all" ? true : filter === "open" ? r.status !== "done" : r.status === filter)),
    [rows, filter],
  );

  if (setup) {
    return (
      <Notice tone="info">
        الرسائل تحتاج الملف <code dir="ltr" className="rounded bg-night/60 px-1.5 py-0.5 text-[13px]">supabase/admin_v4.sql</code>. بعد تشغيله يظهر للاعبين زر «أبلغ عن مشكلة أو اقتراح» في نهاية كل لعبة.
      </Notice>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="تصفية الرسائل" className="no-scrollbar flex min-w-0 flex-1 gap-2 overflow-x-auto pb-1">
          {STATUS.map((s) => {
            const n = (rows ?? []).filter((r) => (s.key === "all" ? true : s.key === "open" ? r.status !== "done" : r.status === s.key)).length;
            return (
              <button
                key={s.key}
                type="button"
                aria-pressed={filter === s.key}
                onClick={() => setFilter(s.key)}
                className={cx(
                  "inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border px-4 text-[15px] font-semibold transition",
                  filter === s.key ? "btn-gold border-transparent" : "border-line-strong/70 bg-deep-2/50 text-mist hover:text-ivory",
                )}
              >
                {s.label}
                <span className="rounded-full bg-black/20 px-2 text-[13px] tabular-nums">{n}</span>
              </button>
            );
          })}
        </div>
        <Button tone="quiet" onClick={() => refresh()}>
          <Glyph name="refresh" className="size-[18px]" />
          تحديث
        </Button>
      </div>
      <p className="text-[13px] text-mist">يرسلها اللاعبون من زر «أبلغ عن مشكلة أو اقتراح» في نهاية اللعبة. كل لاعب حده 5 رسائل في الساعة.</p>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {rows === null ? (
        <Loading />
      ) : shown.length === 0 ? (
        <Notice tone="info">لا توجد رسائل هنا.</Notice>
      ) : (
        <ul className="grid gap-3">
          {shown.map((r) => {
            const k = KINDS[r.kind] ?? KINDS.other;
            return (
              <li key={r.id} className={cx("surface grid gap-2 rounded-[20px] p-4", r.status === "new" && "border border-gold/40")}>
                <p className="flex flex-wrap items-center gap-2 text-[13px]">
                  <span className={cx("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 font-semibold", k.cls)}>
                    <Glyph name={k.icon} className="size-4" />
                    {k.label}
                  </span>
                  {r.status === "new" ? <span className="rounded-full bg-blue/25 px-2.5 py-0.5 font-semibold text-blue-text">جديدة</span> : null}
                  {r.status === "done" ? <span className="rounded-full bg-correct-fill/20 px-2.5 py-0.5 font-semibold text-correct">تمت</span> : null}
                  {r.game_slug ? <span className="text-ivory">{titles[r.game_slug] ?? r.game_slug}</span> : null}
                  <span className="ms-auto text-mist">{when.format(new Date(r.created_at))}</span>
                </p>
                <p className="text-[16px] leading-7 whitespace-pre-wrap text-ivory">{r.message}</p>
                <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-mist">
                  {r.room_code ? (
                    <span>
                      الغرفة <span className="room-code text-gold">{r.room_code}</span>
                    </span>
                  ) : null}
                  {r.contact ? (
                    <span>
                      للتواصل: <bdi className="text-ivory">{r.contact}</bdi>
                    </span>
                  ) : null}
                  {r.page ? (
                    <span>
                      من <bdi dir="ltr">{r.page}</bdi>
                    </span>
                  ) : null}
                </p>
                <div className="flex flex-wrap gap-2">
                  {r.status !== "done" ? (
                    <Button tone="quiet" className="min-h-10 px-4" onClick={() => setStatus(r, "done")}>
                      <Glyph name="check" className="size-[18px]" />
                      تمت المتابعة
                    </Button>
                  ) : (
                    <Button tone="quiet" className="min-h-10 px-4" onClick={() => setStatus(r, "read")}>
                      أعدها للمتابعة
                    </Button>
                  )}
                  {r.status === "new" ? (
                    <Button tone="quiet" className="min-h-10 px-4" onClick={() => setStatus(r, "read")}>
                      قرأتها
                    </Button>
                  ) : null}
                  {r.room_code ? (
                    <Link to="/tv/$code" params={{ code: r.room_code }} target="_blank" className={cx(buttonBase, buttonTone("quiet"), "min-h-10 px-4")}>
                      <Glyph name="tv" className="size-[18px]" />
                      شاشة الغرفة
                    </Link>
                  ) : null}
                  <Button tone="quiet" className="min-h-10 px-3" onClick={() => remove(r)} aria-label="حذف الرسالة">
                    <Glyph name="trash" className="size-[18px]" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
