import { useState, type FormEvent } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/components/shell";
import { Button, inputClass } from "@/components/ui";
import { supabase } from "@/lib/supabase";

export const Route = createFileRoute("/feedback")({
  head: () => ({ meta: [{ title: "أرسل ملاحظة — العش" }] }),
  component: FeedbackPage,
});

const MAX_MESSAGE = 1000;
const MAX_CONTACT = 200;

function FeedbackPage() {
  const [message, setMessage] = useState("");
  const [contact, setContact] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = message.trim();
    if (text.length < 3) {
      setError("اكتب ملاحظة من ثلاثة أحرف على الأقل.");
      return;
    }
    if (!supabase) {
      setError("الخدمة غير متاحة الآن. حاول لاحقًا.");
      return;
    }

    setStatus("sending");
    setError(null);
    const { error: insertError } = await supabase.from("feedback").insert({
      message: text,
      contact: contact.trim() || null,
    });
    if (insertError) {
      setStatus("error");
      setError("تعذّر إرسال الملاحظة. حاول مرة أخرى.");
      return;
    }
    setStatus("sent");
    setMessage("");
    setContact("");
  }

  if (status === "sent") {
    return (
      <Shell>
        <div className="mx-auto max-w-xl text-center">
          <h1 className="text-3xl font-extrabold text-ivory">شكرًا لك</h1>
          <p className="mt-3 text-muted">وصلتنا ملاحظتك، وسنقرؤها قريبًا.</p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="mx-auto max-w-xl">
        <h1 className="text-3xl font-extrabold text-ivory">أرسل ملاحظة</h1>
        <p className="mt-2 text-muted">فكرة للعبة، خلل واجهته، أو اقتراح لتحسين الموقع. كل ملاحظة تهمنا.</p>

        <form onSubmit={submit} noValidate className="mt-6 space-y-4 text-right">
          <div>
            <label htmlFor="feedback-message" className="block text-sm font-bold text-ivory">
              ملاحظتك
            </label>
            <textarea
              id="feedback-message"
              value={message}
              onChange={(e) => setMessage(e.target.value.slice(0, MAX_MESSAGE))}
              rows={6}
              className={inputClass}
              placeholder="ماذا تريد أن نعرف؟"
            />
            <p className="mt-1 text-xs text-muted">{message.length} / {MAX_MESSAGE}</p>
          </div>

          <div>
            <label htmlFor="feedback-contact" className="block text-sm font-bold text-ivory">
              بريد للتواصل (اختياري)
            </label>
            <input
              id="feedback-contact"
              type="text"
              value={contact}
              onChange={(e) => setContact(e.target.value.slice(0, MAX_CONTACT))}
              className={inputClass}
              autoComplete="email"
              inputMode="email"
              placeholder="name@example.com"
            />
            <p className="mt-1 text-xs text-muted">نستخدمه فقط للرد على ملاحظتك.</p>
          </div>

          {error ? (
            <p role="alert" className="text-sm text-crimson">
              {error}
            </p>
          ) : null}

          <Button type="submit" tone="primary" disabled={status === "sending"}>
            {status === "sending" ? "جارٍ الإرسال…" : "إرسال"}
          </Button>
        </form>
      </div>
    </Shell>
  );
}
