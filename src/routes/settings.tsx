import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/components/shell";
import { Glyph } from "@/components/brand";
import { cx } from "@/components/ui";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/settings")({
  head: () => ({ meta: [{ title: "الإعدادات — العش" }] }),
  component: SettingsPage,
});

const choice = (on: boolean) =>
  cx(
    "inline-flex min-h-11 items-center rounded-full px-5 text-[15px] font-bold transition",
    on ? "btn-gold" : "text-mist hover:text-ivory",
  );

function SettingsPage() {
  const { lang, setLang } = useI18n();
  return (
    <Shell>
      <h1 className="flex items-center gap-3 text-[30px] leading-10 lg:text-[40px] lg:leading-[52px]">
        <Glyph name="gear" className="size-8 text-gold" />
        الإعدادات
      </h1>
      <div className="mt-6 grid max-w-[680px] gap-4">
        <section className="surface rounded-[24px] p-5 sm:p-6">
          <h2 className="text-[20px]">اللغة</h2>
          <div className="mt-3 inline-flex gap-1 rounded-full border border-line-strong/70 bg-deep-2/60 p-1">
            <button type="button" className={choice(lang === "ar")} onClick={() => setLang("ar")}>العربية</button>
            <button type="button" className={choice(lang === "en")} onClick={() => setLang("en")}>English</button>
          </div>
        </section>
        <section className="surface rounded-[24px] p-5 sm:p-6">
          <h2 className="text-[20px]">اللغة</h2>
        </section>
      </div>
    </Shell>
  );
}
