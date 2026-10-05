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
    void navigate({ to: "/pad/$code", params: { code: res.code } });
  }

  return (
    <form
      className="mx-auto max-w-md space-y-4 rounded-3xl bg-ivory p-5"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <h1 className="font-display text-4xl">{t("join.title")}</h1>
      <Field label={t("join.code")}>
        <input className={`${inputClass} tracking-widest`} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
      </Field>
      <Field label={t("join.name")}>
        <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      {error ? <p className="text-sm">{error}</p> : null}
      <Button type="submit" disabled={busy}>{t("join.submit")}</Button>
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
