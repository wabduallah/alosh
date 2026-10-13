import { useEffect, useState, type FormEvent } from "react";
import { Glyph } from "@/components/brand";
import { Button, cx, inputClass } from "@/components/ui";
import { supabase } from "@/lib/supabase";

/**
 * «أبلغ عن مشكلة أو اقتراح» at the end of a game. The message reaches the admin panel's
 * «الرسائل» tab with the room code and page (supabase/admin_v4.sql → submit_feedback).
 */

type Kind = "problem" | "idea" | "other";
const KINDS: Array<{ value: Kind; label: string }> = [
  { value: "problem", label: "مشكلة" },
  { value: "idea", label: "اقتراح" },
  { value: "other", label: "أخرى" },
];
const ERRORS: Record<string, string> = {
  NO_SESSION: "افتح الصفحة من جوالك في الغرفة ثم أرسل.",
  BAD_MESSAGE: "اكتب رسالتك بين 3 و1000 حرف.",
  TOO_MANY: "وصلتنا رسائل كثيرة منك في هذه الساعة. جرّب بعد قليل.",
};

/** The room code from /room/CODE, /host/CODE or /tv/CODE. */
function roomFromPath() {
  if (typeof window === "undefined") return null;
  const m = window.location.pathname.match(/^\/(?:room|host|tv)\/([^/]+)/);
  return m ? decodeURIComponent(m[1]).toUpperCase() : null;
}

export function FeedbackButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  if (!supabase) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cx("inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-[14px] font-semibold text-mist underline-offset-4 hover:text-ivory hover:underline", className)}
      >
        <Glyph name={sent ? "check" : "alert"} className="size-[18px]" />
        {sent ? "وصلتنا رسالتك، شكرًا" : "أبلغ عن مشكلة أو اقتراح"}
      </button>
      {open ? (
        <FeedbackSheet
          onClose={() => setOpen(false)}
          onSent={() => {
            setSent(true);
            setOpen(false);
          }}
        />
      ) : null}
    </>
  );
}

function FeedbackSheet({ onClose, onSent }: { onClose: () => void; onSent: () => void }) {
  const [kind, setKind] = useState<Kind>("problem");
  const [message, setMessage] = useState("");
  const [contact, setContact] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    const text = message.trim();
    if (text.length < 3) return setError(ERRORS.BAD_MESSAGE);
    setBusy(true);
    setError(null);
    const { data, error: e } = await supabase.rpc("submit_feedback", {
      p_kind: kind,
      p_message: text.slice(0, 1000),
      p_room_code: roomFromPath(),
      p_contact: contact.trim().slice(0, 100) || null,
      p_page: typeof window === "undefined" ? null : window.location.pathname.slice(0, 200),
    });
    setBusy(false);
    if (e) return setError("تعذّر الإرسال الآن. جرّب لاحقًا.");
    const r = data as { ok: boolean; reason?: string } | null;
    if (!r?.ok) return setError(ERRORS[r?.reason ?? ""] ?? "تعذّر الإرسال الآن. جرّب لاحقًا.");
    onSent();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-night/75 sm:items-center sm:p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="أبلغ عن مشكلة أو اقتراح"
        onClick={(event) => event.stopPropagation()}
        className="surface sheet-up max-h-[90vh] w-full overflow-y-auto rounded-t-[28px] px-5 pt-3 pb-[max(20px,env(safe-area-inset-bottom))] text-start shadow-lift sm:max-w-lg sm:rounded-[28px] sm:p-6"
      >
        <div aria-hidden="true" className="mx-auto mb-3 h-[5px] w-10 rounded-full bg-line-strong sm:hidden" />
        <div className="mb-3 flex items-center gap-3">
          <h2 className="text-[21px] leading-8">أبلغ عن مشكلة أو اقتراح</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق"
            className="ms-auto grid size-11 shrink-0 place-items-center rounded-full border border-line-strong/70 bg-deep-2/60 text-ivory hover:border-glow"
          >
            <Glyph name="x" />
          </button>
        </div>
        <form onSubmit={send} className="grid gap-3">
          <div role="radiogroup" aria-label="نوع الرسالة" className="flex gap-1.5">
            {KINDS.map((k) => (
              <button
                key={k.value}
                type="button"
                role="radio"
                aria-checked={kind === k.value}
                onClick={() => setKind(k.value)}
                className={cx(
                  "min-h-11 flex-1 rounded-full border px-3 text-[15px] font-semibold transition",
                  kind === k.value ? "btn-gold border-transparent" : "border-line-strong/70 bg-deep-2/60 text-mist hover:text-ivory",
                )}
              >
                {k.label}
              </button>
            ))}
          </div>
          <label className="grid gap-1.5">
            <span className="text-[14px] font-semibold text-ivory">{kind === "problem" ? "ماذا حدث؟" : kind === "idea" ? "ما اقتراحك؟" : "رسالتك"}</span>
            <textarea
              className={cx(inputClass, "min-h-28 py-3 leading-7")}
              value={message}
              maxLength={1000}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={kind === "problem" ? "مثل: الوقت انتهى قبل ما أكتب الإجابة الأخيرة." : ""}
              autoFocus
            />
          </label>
          <label className="grid gap-1.5">
            <span className="text-[14px] font-semibold text-ivory">
              للتواصل معك <span className="font-normal text-mist">(اختياري)</span>
            </span>
            <input className={inputClass} value={contact} maxLength={100} onChange={(e) => setContact(e.target.value)} placeholder="بريد أو حساب" />
          </label>
          <p className="text-[13px] text-mist">نرسل معها رمز الغرفة واسم الصفحة فقط، لنعرف أين حدثت المشكلة.</p>
          {error ? (
            <p role="alert" className="text-[14px] text-wrong">
              {error}
            </p>
          ) : null}
          <Button type="submit" tone="primary" className="min-h-12 text-[16px]" disabled={busy}>
            {busy ? "جارٍ الإرسال…" : "أرسل"}
          </Button>
        </form>
      </div>
    </div>
  );
}
