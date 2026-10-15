import { useEffect, useState } from "react";
import { Button, Field, cx, inputClass } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { generateCase, type GenerateOptions, type Generated } from "@/lib/court-ai";
import { Notice, Sheet, Toggle, selectClass, textareaClass } from "@/components/admin/common";

/**
 * «✨ ولّد قضية»: what kind of case, then a draft from the AI generator (or the templates when it
 * is not set up). The draft always opens in the case editor for review before anything is played.
 */

const CATEGORIES = ["", "سرقة", "احتيال", "جريمة مالية", "عائلي", "عمل", "رياضة", "تقنية", "حيّ وجيران"];
const LEVELS: Array<[number, string]> = [
  [1, "سهلة"],
  [2, "متوسطة"],
  [3, "صعبة"],
];

export function GenerateSheet({
  onClose,
  onDraft,
  players: initialPlayers = 7,
}: {
  onClose: () => void;
  onDraft: (g: Generated) => void;
  players?: number;
}) {
  const [o, setO] = useState<GenerateOptions>({ category: "", difficulty: 2, dual: false, guilty: "any", players: Math.min(14, Math.max(4, initialPlayers)), idea: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quota, setQuota] = useState<{ used: number; limit: number } | null>(null);

  useEffect(() => {
    let alive = true;
    supabase
      ?.rpc("court_ai_quota")
      .then(({ data, error }) => {
        if (alive && !error && data) setQuota(data as { used: number; limit: number });
      });
    return () => {
      alive = false;
    };
  }, []);

  const set = <K extends keyof GenerateOptions>(k: K, v: GenerateOptions[K]) => setO((p) => ({ ...p, [k]: v }));
  const left = quota ? Math.max(0, quota.limit - quota.used) : null;

  async function go() {
    setBusy(true);
    setError(null);
    try {
      const g = await generateCase({ ...o, category: o.category || undefined, idea: o.idea?.trim() || undefined });
      if (!g.draft.title || g.draft.roles.length < 3) {
        setError("خرجت القضية ناقصة. جرّب مرة ثانية أو غيّر الفكرة.");
        return;
      }
      onDraft(g);
    } catch {
      setError("تعذّر التوليد الآن. جرّب مرة ثانية.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title="✨ ولّد قضية" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-[14px] leading-6 text-mist">
          اختر نوع القضية، ويكتب المولّد القصة والأدوار والأدلة والحقيقة. تفتح لك مسودة تراجعها وتعدّلها قبل اللعب.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="التصنيف">
            <select className={selectClass} value={o.category} onChange={(e) => set("category", e.target.value)}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c || "أي تصنيف"}
                </option>
              ))}
            </select>
          </Field>
          <Field label="الصعوبة">
            <div className="flex gap-2">
              {LEVELS.map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => set("difficulty", v)}
                  className={cx(
                    "min-h-11 flex-1 rounded-[12px] border text-[14px] font-semibold",
                    o.difficulty === v ? "border-gold bg-gold/15 text-gold" : "border-line-strong text-mist",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </Field>
          <Field label="الحقيقة" hint="لا تظهر لأحد غيرك في المسودة.">
            <select className={selectClass} value={o.guilty} onChange={(e) => set("guilty", e.target.value as GenerateOptions["guilty"])}>
              <option value="any">يختارها المولّد</option>
              <option value="guilty">المتهم مذنب</option>
              <option value="innocent">المتهم بريء</option>
            </select>
          </Field>
          <Field label="عدد اللاعبين تقريبًا">
            <input
              type="number"
              inputMode="numeric"
              min={4}
              max={14}
              className={inputClass}
              value={o.players}
              onChange={(e) => set("players", Math.min(14, Math.max(4, Number(e.target.value) || 4)))}
            />
          </Field>
        </div>
        <Toggle checked={o.dual} onChange={(v) => set("dual", v)} label="متهمان في القضية (لكل واحد حكم مستقل)" />
        <Field label="فكرة أو أجواء (اختياري)" hint="مثلًا: استراحة شباب، مسابقة طبخ، تحويل بنكي غريب.">
          <textarea className={textareaClass} rows={2} maxLength={300} value={o.idea} onChange={(e) => set("idea", e.target.value)} />
        </Field>
        {left !== null ? (
          <p className="text-[13px] text-mist">
            متبقٍ لك {left} من {quota!.limit} توليدات في هذه الساعة.
          </p>
        ) : null}
        {error ? <Notice tone="error">{error}</Notice> : null}
        <div className="flex flex-wrap gap-2">
          <Button onClick={go} disabled={busy || left === 0}>
            {busy ? "يكتب القضية…" : "✨ ولّد المسودة"}
          </Button>
          <Button tone="quiet" onClick={onClose}>
            إلغاء
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
