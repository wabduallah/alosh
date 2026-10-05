import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useState } from "react";
import { Shell } from "@/components/shell";
import { Button, Field, inputClass } from "@/components/ui";
import { authClient, GROK_PROVIDERS, signIn } from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "دخول — العش" }] }),
  component: LoginPage,
});

function LoginPage() {
  const { t } = useI18n();
  const { user, isPending } = useCurrentUserState();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showForgot, setShowForgot] = useState(false);

  if (isPending) {
    return (
      <Shell>
        <div className="mx-auto h-40 max-w-md animate-pulse rounded-3xl bg-ivory" />
      </Shell>
    );
  }
  if (user) return <Navigate to="/" />;

  async function submit() {
    setError(null);
    const client = authClient as typeof authClient & {
      signIn: { email: (input: { email: string; password: string; callbackURL: string }) => Promise<{ error?: { message?: string } | null }> };
      signUp: { email: (input: { email: string; password: string; name: string; callbackURL: string }) => Promise<{ error?: { message?: string } | null }> };
    };
    const res = mode === "up"
      ? await client.signUp.email({ email, password, name: name || email.split("@")[0] || "Player", callbackURL: "/" })
      : await client.signIn.email({ email, password, callbackURL: "/" });
    if (res.error) setError(t("auth.fail"));
    else window.location.assign("/");
  }

  return (
    <Shell>
      <div className="mx-auto max-w-md space-y-4">
        <h1 className="font-display text-4xl">{t("auth.title")}</h1>
        {GROK_PROVIDERS.map((provider) => (
          <Button key={provider.providerId} type="button" tone="ghost" className="w-full" onClick={() => void signIn(provider.providerId, { callbackURL: "/" })}>
            {provider.providerId === "grok-google" ? t("auth.google") : t("auth.x")}
          </Button>
        ))}
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {mode === "up" ? (
            <Field label={t("auth.name")}>
              <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
          ) : null}
          <Field label={t("auth.email")}>
            <input className={inputClass} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          <Field label={t("auth.password")}>
            <input className={inputClass} type="password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          {error ? <p className="text-sm">{error}</p> : null}
          <Button type="submit" className="w-full">{mode === "up" ? t("auth.signup") : t("auth.signin")}</Button>
        </form>
        <button type="button" className="text-sm text-bronze" onClick={() => setMode(mode === "up" ? "in" : "up")}>
          {mode === "up" ? t("auth.switchSign") : t("auth.switchUp")}
        </button>
        <button type="button" className="block text-sm text-muted" onClick={() => setShowForgot((v) => !v)}>{t("auth.forgot")}</button>
        {showForgot ? null : null}
      </div>
    </Shell>
  );
}
