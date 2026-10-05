import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Shell } from "@/components/shell";
import { Button, Field, inputClass } from "@/components/ui";
import { RedirectToSignIn } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { useI18n } from "@/lib/i18n";
import { getProfile, updateProfile } from "@/lib/lamma/rpc";

export const Route = createFileRoute("/profile")({
  head: () => ({ meta: [{ title: "الحساب — العش" }] }),
  component: ProfilePage,
});

function ProfilePage() {
  const { user, isPending } = useCurrentUserState();
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [history, setHistory] = useState<{ gameId: string; score: number; placement: number | null }[]>([]);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [premium, setPremium] = useState(false);

  useEffect(() => {
    if (!user) return;
    void getProfile().then((res) => {
      if (!res.ok) return;
      setName(res.profile.name);
      setHistory(res.history);
      setFavorites(res.favorites);
      setPremium(res.profile.premium);
    });
  }, [user]);

  if (isPending) return <Shell><div className="h-40 animate-pulse rounded-3xl bg-ivory" /></Shell>;
  if (!user) return <RedirectToSignIn />;

  return (
    <Shell>
      <h1 className="font-display text-4xl">{t("profile.title")}</h1>
      <p className="mt-2 text-sm text-muted">{premium ? t("profile.premium") : t("profile.free")}</p>
      <form
        className="mt-6 max-w-md space-y-3 rounded-3xl bg-ivory p-5"
        onSubmit={(e) => {
          e.preventDefault();
          void updateProfile({ data: { name } });
        }}
      >
        <Field label={t("auth.name")}>
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Button type="submit">{t("profile.save")}</Button>
      </form>
      <h2 className="mt-10 text-2xl">{t("profile.favorites")}</h2>
      <ul className="mt-3 space-y-2">
        {favorites.length ? favorites.map((id) => (
          <li key={id}><Link to="/games/$slug" params={{ slug: id }} className="text-bronze">{id}</Link></li>
        )) : <li className="text-muted">{t("profile.empty")}</li>}
      </ul>
      <h2 className="mt-10 text-2xl">{t("profile.history")}</h2>
      <ul className="mt-3 space-y-2">
        {history.length ? history.map((row, i) => (
          <li key={`${row.gameId}-${i}`} className="flex justify-between rounded-2xl bg-ivory px-4 py-3">
            <span>{row.gameId}</span>
            <span className="tabular-nums">{row.score}</span>
          </li>
        )) : <li className="text-muted">{t("profile.empty")}</li>}
      </ul>
    </Shell>
  );
}
