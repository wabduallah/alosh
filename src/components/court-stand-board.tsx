import { OBJECTION_RULES, ANSWER_RULES, answerRulesFor, objectionHint } from "@/lib/court-rules";
import { cx } from "@/components/ui";

type CastRow = {
  player_id: string;
  player_name: string;
  kind: string;
  name: string;
};

/** لوحة عامة: من على المنصة ومن يستجوب — تظهر للكل */
export function CourtStandBoard({
  phase,
  standId,
  askingId,
  cast,
  compact = false,
}: {
  phase?: string | null;
  standId?: string | null;
  askingId?: string | null;
  cast?: CastRow[] | null;
  compact?: boolean;
}) {
  if (phase !== "question" && phase !== "closing") return null;
  const stand = cast?.find((c) => c.player_id === standId);
  const asking = cast?.find((c) => c.player_id === askingId);

  return (
    <div
      className={cx(
        "rounded-2xl border border-cyan-500/25 bg-gradient-to-l from-cyan-500/10 via-violet-500/5 to-transparent p-3",
        compact && "p-2",
      )}
    >
      <p className="mb-2 text-center text-xs font-bold tracking-wide text-cyan-300/90">لوحة الجلسة</p>
      <div className={cx("grid gap-2", compact ? "grid-cols-1" : "sm:grid-cols-2")}>
        <div className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-center">
          <p className="text-[11px] text-white/50">على المنصة</p>
          <p className="mt-0.5 text-sm font-extrabold text-amber-100">
            {stand ? `${stand.player_name} · ${stand.name}` : "— بانتظار الاستدعاء —"}
          </p>
        </div>
        <div className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-center">
          <p className="text-[11px] text-white/50">يستجوب / يترافع</p>
          <p className="mt-0.5 text-sm font-extrabold text-cyan-100">
            {asking ? `${asking.player_name} · ${asking.name}` : phase === "closing" ? "المرافعة جارية" : "مفتوح للأسئلة"}
          </p>
        </div>
      </div>
    </div>
  );
}

/** قواعد الاعتراض — للمدعي والمحامي */
export function CourtObjectionGuide({ kind }: { kind?: string | null }) {
  if (kind !== "prosecutor" && kind !== "lawyer") return null;
  const tip = objectionHint(kind);
  return (
    <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-50">
      <p className="font-extrabold text-amber-200">قواعد الاعتراض</p>
      <p className="mt-1 text-xs leading-relaxed text-amber-50/90">{OBJECTION_RULES.who}</p>
      <ul className="mt-1 list-inside list-disc text-xs leading-relaxed text-amber-50/80">
        {OBJECTION_RULES.when.map((w) => (
          <li key={w}>{w}</li>
        ))}
      </ul>
      {tip ? <p className="mt-2 text-xs font-bold text-amber-100">{tip}</p> : null}
    </div>
  );
}

/** قواعد الإجابات — للمتهم والشاهد */
export function CourtAnswerRules({ kind }: { kind?: string | null }) {
  const rules = answerRulesFor(kind);
  if (!rules.length) return null;
  const title = kind === "accused" ? "قواعد إجابة المتهم" : "قواعد إجابة الشاهد";
  return (
    <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-50">
      <p className="font-extrabold text-emerald-200">{title}</p>
      <ul className="mt-1 list-inside list-disc text-xs leading-relaxed text-emerald-50/85">
        {rules.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] text-white/40">{ANSWER_RULES.general}</p>
    </div>
  );
}
