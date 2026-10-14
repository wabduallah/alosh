import { useState } from "react";
import { generateCourtCaseDraft, type GeneratedCase } from "@/lib/court-case-ai";
import { Button, cx } from "@/components/ui";

/** شاشة مراجعة المضيف لمسودة قضية مولَّدة — لا اعتماد تلقائي */
export function CourtCaseAiReview({
  onAccepted,
}: {
  onAccepted?: (draft: GeneratedCase) => void;
}) {
  const [draft, setDraft] = useState<GeneratedCase | null>(null);
  const [busy, setBusy] = useState(false);
  const [dual, setDual] = useState(false);
  const [acceptedNote, setAcceptedNote] = useState<string | null>(null);

  function regenerate() {
    setBusy(true);
    setAcceptedNote(null);
    // توليد فوري محلي (قوالب عميقة) — يمكن لاحقًا ربط مزوّد AI خارجي
    window.setTimeout(() => {
      setDraft(generateCourtCaseDraft({ dualAccused: dual, difficulty: 3 }));
      setBusy(false);
    }, 200);
  }

  function accept() {
    if (!draft) return;
    onAccepted?.(draft);
    setAcceptedNote(
      "اعتمد المضيف المسودة للمراجعة النهائية. لحفظها كقضية دائمة أضفها من لوحة الإدارة، أو استخدم قضايا قاعدة البيانات الحالية عند البدء.",
    );
  }

  return (
    <div className="rounded-2xl border border-violet-500/30 bg-violet-500/10 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-extrabold text-violet-200">مولّد القضايا (مراجعة المضيف)</p>
          <p className="text-xs text-white/50">لا تُعتمد القضية في اللعب دون موافقتك.</p>
        </div>
        <label className="flex items-center gap-2 text-xs text-white/70">
          <input type="checkbox" checked={dual} onChange={(e) => setDual(e.target.checked)} />
          متهم ثانٍ
        </label>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" tone="primary" disabled={busy} onClick={regenerate}>
          {busy ? "جارٍ التوليد…" : draft ? "إعادة التوليد" : "توليد مسودة"}
        </Button>
        {draft ? (
          <Button type="button" tone="quiet" onClick={accept}>
            اعتماد المسودة للمراجعة
          </Button>
        ) : null}
      </div>

      {acceptedNote ? <p className="mt-3 text-xs font-bold text-emerald-300">{acceptedNote}</p> : null}

      {draft ? (
        <div className="mt-4 space-y-3 text-sm">
          <div className="rounded-xl border border-white/10 bg-black/30 p-3">
            <p className="text-lg font-extrabold text-ivory">{draft.title}</p>
            <p className="text-xs text-cyan-300/80">
              {draft.category} · صعوبة {draft.difficulty}
              {draft.dualAccused ? " · متهمان" : ""}
            </p>
            <p className="mt-2 leading-relaxed text-white/80">{draft.intro}</p>
          </div>

          <div>
            <p className="mb-1 text-xs font-bold text-white/50">الأدلة ({draft.evidence.length})</p>
            <ul className="space-y-2">
              {draft.evidence.map((e, i) => (
                <li key={`${e.title}-${i}`} className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
                  <span className="text-xs text-amber-200/90">
                    جولة {e.stage}
                    {e.time ? ` · ${e.time}` : ""}
                  </span>
                  <p className="font-bold text-ivory">
                    {e.icon} {e.title}
                  </p>
                  <p className="text-xs leading-relaxed text-white/70">{e.text}</p>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="mb-1 text-xs font-bold text-white/50">الأدوار ({draft.roles.length})</p>
            <ul className="grid gap-2 sm:grid-cols-2">
              {draft.roles.map((r) => (
                <li key={r.key} className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
                  <p className="text-xs font-bold text-cyan-200">
                    {r.name} <span className="text-white/40">({r.kind})</span>
                  </p>
                  <p className="mt-1 text-[11px] leading-relaxed text-white/60">{r.secret}</p>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-xl border border-dashed border-white/15 p-3">
            <p className="text-xs font-bold text-white/50">الحقيقة (للمضيف فقط أثناء المراجعة)</p>
            <p className="mt-1 text-xs leading-relaxed text-white/75">{draft.truth}</p>
            <p className="mt-1 text-[11px] text-amber-200/80">{draft.guilty ? "الاتجاه: إدانة" : "الاتجاه: براءة"}</p>
          </div>

          <ul className="text-[11px] text-white/40">
            {draft.notes.map((n) => (
              <li key={n}>• {n}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="mt-3 text-xs text-white/45">اضغط «توليد مسودة» لمعاينة قضية بأدلة متدرجة ومتناقضة.</p>
      )}
    </div>
  );
}

export function CourtCaseAiReviewCollapsed({ className }: { className?: string }) {
  return (
    <div className={cx(className)}>
      <CourtCaseAiReview />
    </div>
  );
}
