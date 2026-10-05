import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Shell } from "@/components/shell";
import { Button, Field, inputClass } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { redeemPromo, startCheckout } from "@/lib/lamma/rpc";

export const Route = createFileRoute("/premium")({
  head: () => ({
    meta: [
      { title: "بريميوم — العش" },
      { name: "description", content: "باقات العش: مجاني، شهري 29 ر.س، سنوي 99 ر.س، ومدى الحياة 199 ر.س." },
    ],
  }),
  component: PremiumPage,
});

function PremiumPage() {
  const { t, lang, bundle } = useI18n();
  const [promo, setPromo] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function redeem() {
    setBusy(true);
    const res = await redeemPromo({ data: { promo } });
    setBusy(false);
    setNote(res.ok ? t("profile.premium") : t(`err.${res.error}`));
  }

  async function buy(planId: string, provider: string) {
    setBusy(true);
    const res = await startCheckout({
      data: { planId, provider, promo, origin: window.location.origin },
    });
    setBusy(false);
    if (!res.ok) {
      setNote(t(`err.${res.error}`));
      return;
    }
    if (res.status === "redirect" && res.url) {
      window.location.href = res.url;
      return;
    }
    if (res.status === "paid") {
      setNote(t("profile.premium"));
      return;
    }
    setNote(t("admin.guide"));
  }

  return (
    <Shell>
      <h1 className="font-display text-4xl">{t("premiumTitle")}</h1>
      <p className="mt-2 max-w-xl text-muted">{t("premiumSub")}</p>
      <div className="mt-8 grid gap-4 md:grid-cols-2">
        {bundle.plans.map((plan) => (
          <article key={plan.id} className="rounded-3xl border border-ink/10 bg-ivory p-5">
            <h2 className="text-2xl">{lang === "en" ? plan.nameEn : plan.nameAr}</h2>
            <p className="mt-2 font-display text-4xl text-forest">{plan.priceSar} <span className="text-base text-muted">SAR</span></p>
            <ul className="mt-4 space-y-2 text-sm text-muted">
              {(lang === "en" ? plan.featuresEn : plan.featuresAr).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            {plan.interval !== "free" ? (
              <div className="mt-4 flex flex-wrap gap-2">
                <Button type="button" disabled={busy} onClick={() => void buy(plan.id, "stripe")}>Stripe</Button>
                <Button type="button" tone="ghost" disabled={busy} onClick={() => void buy(plan.id, "moyasar")}>Moyasar</Button>
                <Button type="button" tone="ghost" disabled={busy} onClick={() => void buy(plan.id, "tap")}>Tap</Button>
              </div>
            ) : null}
          </article>
        ))}
      </div>
      <form
        className="mt-8 max-w-md space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void redeem();
        }}
      >
        <Field label={t("create.promo")}>
          <input className={inputClass} value={promo} onChange={(e) => setPromo(e.target.value)} />
        </Field>
        <Button type="submit" tone="bronze" disabled={busy}>{t("join.submit")}</Button>
        {note ? <p className="text-sm">{note}</p> : null}
      </form>
    </Shell>
  );
}
