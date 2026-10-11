import { useState, type FormEvent } from "react";
import { Button, inputClass } from "@/components/ui";
import { supabase } from "@/lib/supabase";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * "Tell me when it launches". Stores one email per game. The text under the form
 * is the promise: one message at launch, nothing else.
 */
export function NotifyForm({ gameId, gameTitle }: { gameId: string; gameTitle: string }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = email.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(value) || value.length > 254) {
      setState("error");
      return;
    }
    if (!supabase) {
      setState("error");
      return;
    }
    setState("sending");
    const { error } = await supabase.from("launch_alerts").insert({ game_id: gameId, email: value });
    // A duplicate (code 23505) gets the same message as a new signup, so nobody can
    // use this form to check whether an address is already listed.
    if (error && error.code !== "23505") {
      setState("error");
      return;
    }
    setState("done");
  }

  if (state === "done") {
    return <p className="text-sm font-bold text-neon">سنرسل لك تنبيهًا عند إطلاق {gameTitle}.</p>;
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-2 text-right">
      <label htmlFor={`notify-${gameId}`} className="block text-sm font-bold text-ivory">
        أعلمني عند الإطلاق
      </label>
      <div className="flex gap-2">
        <input
          id={`notify-${gameId}`}
          type="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (state === "error") setState("idle");
          }}
          placeholder="name@example.com"
          autoComplete="email"
          inputMode="email"
          className={inputClass}
          aria-invalid={state === "error" ? true : undefined}
          aria-describedby={`notify-help-${gameId}`}
        />
        <Button type="submit" tone="glass" disabled={state === "sending"} className="shrink-0 px-4">
          {state === "sending" ? "…" : "أعلمني"}
        </Button>
      </div>
      <p id={`notify-help-${gameId}`} className="text-xs leading-6 text-muted">
        تنبيه واحد عند الإطلاق فقط، ولا نشارك بريدك مع أحد.
      </p>
      {state === "error" ? (
        <p role="alert" className="text-sm text-crimson">
          تعذّر الحفظ. تأكد من البريد وحاول مرة أخرى.
        </p>
      ) : null}
    </form>
  );
}
