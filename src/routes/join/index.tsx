import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Shell } from "@/components/shell";
import { Button, Field, inputClass } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { joinRoom } from "@/lib/lamma/rpc";

export const Route = createFileRoute("/join/")({
  head: () => ({ meta: [{ title: "انضم — العش" }] }),
  component: JoinPage,
});

export function JoinForm({ initial = "" }: { initial?: string }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [code, setCode] = useState(initial);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    const res = await joinRoom({ data: { code, name } });
    setBusy(false);
    if (!res.ok) {
      setError(t(`err.${res.error}`));
      return;
    }
    sessionStorage.setItem(`lamma:player:${res.code}`, res.playerToken);
    sessionStorage.setItem(`lamma:playerId:${res.code}`, res.playerId);
    void navigate({ to: "/room/$code", params: { code: res.code } });
  }

  return (
    <form
      className="mx-auto max-w-md space-y-4 rounded-3xl border border-[rgb(255_255_255/0.08)] bg-[rgb(255_255_255/0.03)] p-5 text-ivory"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <p className="text-sm text-[#67e8f9]">اختيار اللاعب</p>
      <h1 className="font-display text-4xl">ادخل اسمك</h1>
      <Field label={t("join.code")}>
        <input className="min-h-12 w-full rounded-2xl border border-[rgb(255_255_255/0.08)] bg-[#090d16] px-4 tracking-widest text-ivory" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
      </Field>
      <Field label={t("join.name")}>
        <input className="min-h-12 w-full rounded-2xl border border-[rgb(255_255_255/0.08)] bg-[#090d16] px-4 text-ivory" value={name} onChange={(e) => setName(e.target.value)} placeholder="اسمك في الغرفة" />
      </Field>
      {error ? <p className="text-sm text-[#67e8f9]">{error}</p> : null}
      <button type="submit" disabled={busy || name.trim().length < 2} className="min-h-12 w-full rounded-full bg-[#06b6d4] font-extrabold text-black disabled:bg-[rgb(255_255_255/0.10)] disabled:text-[#94a3b8]">{busy ? "..." : "دخول"}</button>
    </form>
  );
}

function JoinPage() {
  return (
    <Shell>
      <JoinForm />
    </Shell>
  );
}
