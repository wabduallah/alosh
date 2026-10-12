import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { Shell } from "@/components/shell";
import { BirdArt, Egg, Glyph, birdName } from "@/components/brand";
import { Toggle } from "@/components/admin/common";
import { Button, cx } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import {
  BIRD_IDS,
  NO_AVATAR,
  cleanAvatar,
  getAvatar,
  reduceMotionOn,
  setAvatar,
  setReduceMotion,
  setSoundOn,
  setVibrationOn,
  soundOn,
  vibrate,
  vibrationOn,
  type Avatar,
} from "@/lib/prefs";
import { playCue, unlockAudio } from "@/lib/sfx";

export const Route = createFileRoute("/settings")({
  head: () => ({ meta: [{ title: "الإعدادات — العش" }] }),
  component: SettingsPage,
});

const tile = (on: boolean) =>
  cx(
    "grid aspect-square place-items-center rounded-[18px] border transition",
    on ? "border-gold bg-gold/15 shadow-[0_0_0_2px_var(--color-gold)]" : "border-line-strong/70 bg-deep-2/50 hover:border-glow",
  );

const choice = (on: boolean) =>
  cx(
    "inline-flex min-h-11 items-center rounded-full px-5 text-[15px] font-bold transition",
    on ? "btn-gold" : "text-mist hover:text-ivory",
  );

function Section({ title, icon, note, children }: { title: string; icon: string; note?: string; children: ReactNode }) {
  return (
    <section className="surface grid gap-4 rounded-[24px] p-5 sm:p-6">
      <div>
        <h2 className="flex items-center gap-2 text-[20px]">
          <Glyph name={icon} className="size-5 text-gold" />
          {title}
        </h2>
        {note ? <p className="mt-1 text-[13px] leading-6 text-mist">{note}</p> : null}
      </div>
      {children}
    </section>
  );
}

function SettingsPage() {
  const { lang, setLang } = useI18n();
  // Preferences live on this device; read them after the page loads.
  const [ready, setReady] = useState(false);
  const [sound, setSound] = useState(true);
  const [vibration, setVibration] = useState(true);
  const [motion, setMotion] = useState(false);
  const [systemMotion, setSystemMotion] = useState(false);
  const [avatar, setAvatarState] = useState<Avatar | null>(null);
  const [saved, setSaved] = useState(false);
  const [canVibrate, setCanVibrate] = useState(true);

  useEffect(() => {
    setSound(soundOn());
    setVibration(vibrationOn());
    setMotion(reduceMotionOn());
    setAvatarState(getAvatar());
    setCanVibrate("vibrate" in navigator);
    try {
      setSystemMotion(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    } catch {
      // Older browsers: no system setting to show.
    }
    setReady(true);
  }, []);

  const colour = avatar?.c ?? null;
  const bird = avatar?.e ?? null;
  const birdLabel = bird === NO_AVATAR ? "بدون صورة رمزية" : bird ? birdName(bird) : "طائر تلقائي";
  const colourLabel = bird === NO_AVATAR
    ? colour ? "أول حرف من اسمك، على لونك" : "أول حرف من اسمك، ولون حسب ترتيب دخولك"
    : bird ? (colour ? "على لونك" : "لون حسب ترتيب دخولك") : colour ? "حسب ترتيب دخولك، على لونك" : "الطائر واللون حسب ترتيب دخولك";

  /** Changes the bird or the colour; null puts that part back on automatic. */
  function update(part: Avatar) {
    const next = cleanAvatar({ c: colour, e: bird, ...part });
    setAvatarState(next);
    setAvatar(next);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1500);
  }

  return (
    <Shell>
      <h1 className="flex items-center gap-3 text-[30px] leading-10 lg:text-[40px] lg:leading-[52px]">
        <Glyph name="gear" className="size-8 text-gold" />
        الإعدادات
      </h1>
      <p className="mt-1 text-[14px] text-mist">تُحفظ على هذا الجهاز فقط.</p>
      <div className="mt-6 grid max-w-[680px] gap-4">
        <Section title="اللغة" icon="info">
          <div className="inline-flex w-fit gap-1 rounded-full border border-line-strong/70 bg-deep-2/60 p-1">
            <button type="button" className={choice(lang === "ar")} onClick={() => setLang("ar")}>
              العربية
            </button>
            <button type="button" className={choice(lang === "en")} onClick={() => setLang("en")}>
              English
            </button>
          </div>
        </Section>

        <Section title="صورتك في الغرف" icon="user" note="طائرك ولون بيضتك، يظهران لكل من في الغرفة وعلى التلفزيون في الغرف التي تدخلها من الآن.">
          <div className="flex items-center gap-4">
            <Egg name="أنت" index={1} avatar={avatar} size="xl" />
            <div className="min-w-0 text-[14px] leading-6 text-mist">
              <span className="block font-semibold text-ivory">{birdLabel}</span>
              {colourLabel}
              {saved ? <span className="block font-semibold text-correct">حُفظت ✓</span> : null}
            </div>
          </div>
          <div role="radiogroup" aria-labelledby="bird-label" className="grid gap-2">
            <span id="bird-label" className="text-[14px] font-semibold text-ivory">الطائر</span>
            <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-9 sm:gap-2">
              <button
                type="button"
                role="radio"
                aria-checked={!bird}
                onClick={() => update({ e: null })}
                className={cx(tile(!bird), "text-[13px] font-bold", !bird ? "text-gold" : "text-mist")}
              >
                تلقائي
              </button>
              {BIRD_IDS.map((id) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={bird === id}
                  aria-label={birdName(id)}
                  title={birdName(id)}
                  onClick={() => update({ e: id })}
                  className={cx(tile(bird === id), "overflow-hidden p-1")}
                >
                  <BirdArt id={id} className="size-full" />
                </button>
              ))}
            </div>
            <button
              type="button"
              role="radio"
              aria-checked={bird === NO_AVATAR}
              onClick={() => update({ e: NO_AVATAR })}
              className={cx(
                "flex min-h-11 w-fit items-center gap-2 rounded-full border px-4 text-[14px] font-semibold",
                bird === NO_AVATAR ? "border-gold text-gold" : "border-line-strong/70 text-mist hover:text-ivory",
              )}
            >
              <span aria-hidden="true" className={cx("grid size-5 place-items-center rounded-full border text-[11px]", bird === NO_AVATAR ? "border-gold bg-gold text-night" : "border-line-strong")}>
                {bird === NO_AVATAR ? "✓" : ""}
              </span>
              بدون صورة رمزية (أول حرف من اسمي)
            </button>
          </div>
          <div className="grid gap-2">
            <span className="text-[14px] font-semibold text-ivory">لون البيضة</span>
            <div role="radiogroup" aria-label="لون البيضة" className="flex flex-wrap gap-2">
              <button
                type="button"
                role="radio"
                aria-checked={!colour}
                onClick={() => update({ c: null })}
                className={cx("min-h-11 rounded-full border px-4 text-[14px] font-semibold", !colour ? "border-gold text-gold" : "border-line-strong/70 text-mist hover:text-ivory")}
              >
                تلقائي
              </button>
              {Array.from({ length: 8 }, (_, i) => i + 1).map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={colour === c}
                  aria-label={`اللون ${c}`}
                  onClick={() => update({ c })}
                  className={cx("size-11 rounded-full border-2 transition", colour === c ? "border-ivory shadow-[0_0_0_3px_var(--color-gold)]" : "border-transparent")}
                  style={{ backgroundColor: `var(--color-egg-${c})` }}
                />
              ))}
            </div>
          </div>
        </Section>

        <Section title="الصوت والاهتزاز" icon="volume">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Toggle
              checked={ready ? sound : true}
              onChange={(v) => {
                setSound(v);
                setSoundOn(v);
              }}
              label="أصوات اللعب"
            />
            <Button
              tone="quiet"
              className="min-h-10 px-4"
              disabled={!sound}
              onClick={() => {
                unlockAudio();
                playCue("correct");
              }}
            >
              <Glyph name="volume" className="size-[18px]" />
              جرّب الصوت
            </Button>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Toggle
              checked={ready ? vibration : true}
              onChange={(v) => {
                setVibration(v);
                setVibrationOn(v);
              }}
              label="الاهتزاز عند دورك"
            />
            <Button tone="quiet" className="min-h-10 px-4" disabled={!vibration || !canVibrate} onClick={() => vibrate([200, 80, 200])}>
              جرّب الاهتزاز
            </Button>
          </div>
          {!canVibrate ? <p className="text-[13px] text-mist">هذا الجهاز أو المتصفح لا يدعم الاهتزاز (مثل آيفون).</p> : null}
        </Section>

        <Section title="الحركة" icon="refresh" note="يوقف الحركات والنبض والانتقالات في كل الصفحات.">
          <Toggle
            checked={motion}
            onChange={(v) => {
              setMotion(v);
              setReduceMotion(v);
            }}
            label="تقليل الحركة"
          />
          {systemMotion ? <p className="text-[13px] text-mist">جهازك يطلب تقليل الحركة أصلًا، والموقع يتبعه.</p> : null}
        </Section>
      </div>
    </Shell>
  );
}
