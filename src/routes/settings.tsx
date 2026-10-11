import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Shell } from "@/components/shell";
import { Glyph } from "@/components/brand";
import { cx } from "@/components/ui";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/settings")({
  head: () => ({ meta: [{ title: "الإعدادات — العش" }] }),
  component: SettingsPage,
});

/** Same key as src/lib/sfx.ts: "1" mutes every sound on this device. */
const MUTE_KEY = "alosh-muted";

function SettingsPage() {
  const { lang, setLang } = useI18n();
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    try {
      setMuted(localStorage.getItem(MUTE_KEY) === "1");
    } catch {
      // Storage blocked: keep sounds on.
    }
  }, []);

  function setSound(nextMuted: boolean) {
    setMuted(nextMuted);
    try {
      if (nextMuted) localStorage.setItem(MUTE_KEY, "1");
      else localStorage.removeItem(MUTE_KEY);
    } catch {
      // Storage blocked: the choice lasts for this visit only.
    }
  }

  return (
    <Shell>
      <h1 className="text-[30px] leading-10 lg:text-[40px] lg:leading-[52px]">الإعدادات</h1>
      <div className="mt-5 grid max-w-[680px] gap-4">
        <section className="grid gap-3 rounded-[28px] border border-line bg-deep p-6">
          <h2 className="text-[19px]">اللغة</h2>
          <Segmented
            label="اللغة"
            value={lang}
            onChange={(v) => setLang(v === "en" ? "en" : "ar")}
            options={[
              { value: "ar", label: "العربية" },
              { value: "en", label: "English" },
            ]}
          />
        </section>
        <section className="grid gap-3 rounded-[28px] border border-line bg-deep p-6">
          <h2 className="text-[19px]">الأصوات</h2>
          <p className="text-[13px] leading-[22px] text-mist">أصوات الجرس والإجابات والفوز على هذا الجهاز.</p>
          <Segmented
            label="الأصوات"
            value={muted ? "off" : "on"}
            onChange={(v) => setSound(v === "off")}
            options={[
              { value: "on", label: "تشغيل", icon: "volume" },
              { value: "off", label: "كتم", icon: "mute" },
            ]}
          />
        </section>
      </div>
    </Shell>
  );
}

function Segmented({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string; icon?: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex w-fit gap-1 rounded-full border border-line-strong bg-glass p-1">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={cx(
              "inline-flex min-h-10 items-center gap-1.5 rounded-full px-[18px] text-[15px] font-semibold transition",
              on ? "bg-neon text-on-neon" : "text-mist hover:text-ivory",
            )}
          >
            {o.icon ? <Glyph name={o.icon} className="size-[18px]" /> : null}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
