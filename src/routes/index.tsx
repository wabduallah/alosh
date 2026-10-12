import { useState, type FormEvent } from "react";
import { RejoinCard } from "@/components/rejoin";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Shell } from "@/components/shell";
import { ShareSite } from "@/components/share";
import { Button, buttonBase, buttonTone, cx } from "@/components/ui";
import { CodeCells, Glyph, GlyphBadge, HeroArt, Mark, Wordmark } from "@/components/brand";
import { GamesGrid } from "@/components/games-grid";
import { START_STEPS } from "@/lib/catalog";


/** Room codes use this alphabet only (no I, O, 0, 1), matching the join page. */
const CODE_PATTERN = /^[A-HJ-NP-Z2-9]{5}$/;

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "العش — ألعاب جماعية للعائلة والأصدقاء" },
      { name: "description", content: "ألعاب جماعية تُلعب على شاشة واحدة وجوال لكل لاعب، مجانًا وبدون تسجيل." },
    ],
  }),
  component: Home,
});


/** The four promises of the original hero chips, shown as the feature bar. */
const FEATURES = [
  { icon: "shield", label: "بدون تسجيل" },
  { icon: "phone", label: "بدون تحميل" },
  { icon: "users", label: "حتى 14 لاعبًا" },
  { icon: "heart", label: "مجانًا" },
];

function Home() {
  return (
    <Shell>
      <RejoinCard />
      <Hero />
      <HowItWorks />
      <div className="mt-8 lg:mt-14">
        <GamesGrid />
      </div>
      <CallToAction />
    </Shell>
  );
}

/** Join by code: a compact row inside the hero on computers, a card under it on phones. */
function JoinByCode({ compact = false }: { compact?: boolean }) {
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = code.trim().toUpperCase();
    if (!CODE_PATTERN.test(normalized)) {
      setError("الرمز يتكون من 5 حروف أو أرقام، مثل ABC23.");
      return;
    }
    setError(null);
    navigate({ to: "/join/$code", params: { code: normalized } });
  }

  const inputId = compact ? "join-code-row" : "join-code";
  return (
    <form
      onSubmit={submit}
      noValidate
      className={cx(
        "surface",
        compact ? "grid w-fit grid-cols-[auto_auto_auto] items-center gap-x-3 gap-y-1 rounded-[22px] py-2.5 ps-5 pe-2.5" : "grid justify-items-center gap-3 rounded-[22px] p-4 text-center",
      )}
    >
      <label htmlFor={inputId} className="text-[15px] font-semibold text-ivory">
        عندكم رمز غرفة؟
      </label>
      <CodeCells
        id={inputId}
        compact
        value={code}
        onChange={(next) => {
          setCode(next);
          if (error) setError(null);
        }}
        invalid={!!error}
        describedBy={error ? `${inputId}-error` : `${inputId}-hint`}
        placeholder="ABC23"
      />
      <Button type="submit" tone="violet" className={compact ? "min-h-11" : "w-full"}>
        انضم
      </Button>
      {error ? (
        <p id={`${inputId}-error`} role="alert" className={cx("flex items-center gap-1.5 text-[13px] font-semibold text-wrong", compact && "col-span-3")}>
          <Glyph name="alert" className="size-4" />
          {error}
        </p>
      ) : (
        <p id={`${inputId}-hint`} className={cx("text-[13px] text-mist", compact && "col-span-3")}>
          الرمز يظهر على شاشة المضيف، أو امسحوا رمز QR.
        </p>
      )}
    </form>
  );
}

function Hero() {
  return (
    <section aria-labelledby="hero-title">
      <div className="forest-bg relative overflow-hidden rounded-[28px] border border-glow/30 shadow-glow-line">
        <div className="grid items-center gap-1 px-4 pt-3 pb-5 sm:gap-2 sm:px-8 sm:pt-4 sm:pb-7 lg:grid-cols-[1fr_1.05fr] lg:gap-6 lg:px-14 lg:py-10">
          <div className="order-2 grid justify-items-center gap-3 text-center sm:gap-4 lg:order-1 lg:justify-items-start lg:text-start">
            <h1 id="hero-title" className="sr-only">
              العش
            </h1>
            <Wordmark height={72} className="sm:h-[104px]! lg:h-[150px]!" />
            <p className="font-display text-[21px] font-extrabold leading-[32px] text-balance text-ivory sm:text-[26px] sm:leading-[40px] lg:text-[38px] lg:leading-[56px]">
              حيث تلتقي التحديات بالمتعة الجماعية
            </p>
            <p className="max-w-md text-[15px] leading-[26px] text-mist sm:rounded-2xl sm:bg-night/40 sm:px-4 sm:py-3 sm:text-[16px] sm:leading-[29px] lg:bg-transparent lg:p-0 lg:text-[18px] lg:leading-8">
              تلفزيون واحد في الوسط، وجوالاتكم حواليه. بدون تسجيل وبدون تحميل، افتحوا الغرفة وابدأوا السهرة.
            </p>
            <div className="grid w-full grid-cols-2 gap-2 sm:mt-1 sm:flex sm:w-auto sm:flex-wrap sm:justify-center sm:gap-3 lg:justify-start">
              <Link to="/play" search={{ game: "" }} className={cx(buttonBase, buttonTone("primary"), "min-h-12 px-3 text-[16px] sm:min-h-14 sm:px-8 sm:text-[17px]")}>
                <Glyph name="users" />
                إنشاء غرفة
              </Link>
              <a href="#games" className={cx(buttonBase, buttonTone("outline"), "min-h-12 px-3 text-[16px] sm:min-h-14 sm:px-8 sm:text-[17px]")}>
                <Glyph name="gamepad" />
                استعرض الألعاب
              </a>
            </div>
            <div className="hidden lg:block">
              <JoinByCode compact />
            </div>
          </div>
          <div className="order-1 mx-auto w-full max-w-[150px] sm:max-w-[420px] lg:order-2 lg:max-w-[600px]">
            <HeroArt className="bob" />
          </div>
        </div>
      </div>

      <div className="mt-3 lg:hidden">
        <JoinByCode />
      </div>

      <ul className="mt-3 grid grid-cols-2 gap-2 sm:gap-3 lg:surface lg:mt-6 lg:grid-cols-4 lg:gap-0 lg:rounded-[22px] lg:py-5">
        {FEATURES.map((f, i) => (
          <li
            key={f.label}
            className={cx(
              "surface flex items-center gap-2.5 rounded-[16px] px-3 py-2.5 lg:grid lg:justify-items-center lg:rounded-none lg:border-0 lg:bg-none lg:py-0 lg:text-center lg:shadow-none",
              i > 0 && "lg:border-s lg:border-line",
            )}
          >
            <GlyphBadge name={f.icon} className="size-9 shrink-0 lg:size-14" />
            <span className="font-display text-[15px] font-bold leading-6 text-ivory lg:text-[19px]">{f.label}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function SectionTitle({ id, icon, children }: { id: string; icon: string; children: string }) {
  return (
    <h2 id={id} className="flex items-center gap-2 text-[22px] leading-8 lg:text-[28px] lg:leading-10">
      <Glyph name={icon} className="size-7 text-gold" />
      {children}
    </h2>
  );
}

function HowItWorks() {
  return (
    <section aria-labelledby="how-title" className="mt-8 lg:mt-14">
      <div className="mb-5">
        <SectionTitle id="how-title" icon="question">
          كيف تبدأ؟
        </SectionTitle>
      </div>
      <ol className="grid gap-6 lg:grid-cols-3 lg:gap-8">
        {START_STEPS.map((step, index) => (
          <li key={step.title} className="step-line relative grid grid-cols-[48px_1fr] gap-3 lg:grid-cols-1">
            <span className="btn-gold relative z-[1] grid size-12 place-items-center rounded-full text-lg font-extrabold">{index + 1}</span>
            <div>
              <h3 className="mt-1 mb-1 text-[20px] leading-8">{step.title}</h3>
              <p className="text-[15px] leading-[27px] text-mist">{step.text}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function CallToAction() {
  return (
    <section className="surface mt-10 grid justify-items-center gap-3 rounded-[28px] px-4 py-8 text-center lg:mt-14">
      <Mark height={96} className="bob" />
      <h2 className="text-[24px] lg:text-[30px]">جاهزون للسهرة؟</h2>
      <p className="text-[17px] leading-[31px] text-mist">أنشئوا الغرفة الآن، وشاركوا الرمز مع أصدقائكم.</p>
      <div className="mt-2 flex flex-wrap justify-center gap-3">
        <Link to="/play" search={{ game: "" }} className={cx(buttonBase, buttonTone("primary"), "min-h-14 px-8 text-[17px]")}>
          <Glyph name="users" />
          إنشاء غرفة
        </Link>
        <ShareSite className="min-h-14 px-7 text-[17px]" />
      </div>
    </section>
  );
}
