import { createFileRoute, Link } from "@tanstack/react-router";
import { Shell } from "@/components/shell";
import { EmptyState } from "@/components/empty-state";
import { GameIcon, Glyph, gameStyle, gameVars } from "@/components/brand";
import { buttonBase, buttonTone, cx } from "@/components/ui";
import { findCard, useGames } from "@/lib/catalog";
import { gameJsonLd, gameSeo } from "@/lib/seo";

/**
 * One page per game, for search engines and for sharing: what the game is, who it suits,
 * its rules, and a button to open a room. The copy comes from the catalogue, so the page
 * renders on the server; whether it can be played right now comes from the games table.
 */
export const Route = createFileRoute("/games/$slug")({
  head: ({ params }) => {
    const card = findCard(params.slug);
    if (!card) return { meta: [{ title: "لعبة غير موجودة — العش" }] };
    const url = `https://www.al3sh.app/games/${card.id}`;
    return {
      meta: [
        { title: `${card.title}: لعبة جماعية من الجوال — العش` },
        { name: "description", content: `${card.blurb} ${card.players} لاعب، مجانًا وبدون تسجيل.` },
      ],
      links: [{ rel: "canonical", href: url }],
      scripts: gameJsonLd(card, url).map((data) => ({ type: "application/ld+json", children: JSON.stringify(data) })),
    };
  },
  component: GamePage,
});

function GamePage() {
  const { slug } = Route.useParams();
  const games = useGames();
  const card = findCard(slug);
  const game = games.find((g) => g.id === slug);

  if (!card || !game) {
    return (
      <Shell>
        <EmptyState
          title="لم نجد هذه اللعبة"
          text="ربما تغيّر اسمها أو لم تعد متاحة."
          action={
            <Link to="/games" className={cx(buttonBase, buttonTone("quiet"), "min-h-12 px-6")}>
              <Glyph name="gamepad" className="size-[18px]" />
              كل الألعاب
            </Link>
          }
        />
      </Shell>
    );
  }

  const dark = gameStyle(game.id).ink === "dark";
  const ink = dark ? "text-on-gold" : "text-ivory";
  const soft = dark ? "text-on-gold/85" : "text-ivory/85";
  const rules = card.howTo;
  const seo = gameSeo(card);
  const others = games.filter((g) => g.id !== game.id && !g.soon);

  return (
    <Shell>
      <article className="mx-auto grid max-w-3xl gap-5">
        <header style={gameVars(game.id)} className="gcard relative grid gap-4 overflow-hidden rounded-[28px] p-5 sm:p-8">
          <span aria-hidden="true" className="pointer-events-none absolute -top-16 -end-16 size-56 rounded-full bg-white/10 blur-3xl" />
          <div className="flex items-center gap-4">
            <span className="gcard-icon grid size-20 shrink-0 place-items-center rounded-full sm:size-24">
              <img src={`/brand/games/game-${game.id}.svg`} alt="" className="size-16 sm:size-20" />
            </span>
            <div className="grid min-w-0 gap-2">
              <h1 className={cx("text-[30px] leading-10 sm:text-[38px] sm:leading-[50px]", ink)}>{game.title}</h1>
              <div className="flex flex-wrap gap-2">
                <span className={cx("inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[14px] font-semibold", dark ? "bg-white/30" : "bg-black/25", ink)}>
                  <Glyph name="users" className="size-4" />
                  {game.players} لاعب
                </span>
                {rules ? (
                  <span className={cx("inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[14px] font-semibold", dark ? "bg-white/30" : "bg-black/25", ink)}>
                    <Glyph name="clock" className="size-4" />
                    {rules.minutes}
                  </span>
                ) : null}
              </div>
            </div>
          </div>
          <p className={cx("text-[17px] leading-[30px]", soft)}>{game.blurb}</p>
          {game.soon ? (
            <span className={cx("inline-flex min-h-12 w-fit items-center rounded-full border border-dashed border-white/50 px-6 text-[16px] font-semibold", soft)}>قريبًا</span>
          ) : (
            <Link to="/play" search={{ game: game.id }} className={cx(buttonBase, "min-h-14 w-full bg-ivory px-8 text-[17px] font-bold text-ink shadow-[0_8px_20px_-8px_#0008] hover:brightness-95 sm:w-fit")}>
              <Glyph name="users" />
              ابدأ غرفة {game.title}
            </Link>
          )}
        </header>

        {rules ? (
          <section aria-labelledby="rules-title" className="surface grid gap-4 rounded-[24px] p-5 sm:p-7">
            <h2 id="rules-title" className="flex items-center gap-2 text-[22px] leading-8">
              <Glyph name="question" className="size-6 text-gold" />
              طريقة اللعب
            </h2>
            <p className="text-[16px] leading-[29px] text-ivory">{rules.goal}</p>
            <ol className="grid gap-3">
              {rules.steps.map((step, index) => (
                <li key={step} className="flex gap-3 text-[15px] leading-[27px] text-mist">
                  <span className="btn-gold grid size-7 shrink-0 place-items-center rounded-full text-[13px] font-bold">{index + 1}</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        <section aria-labelledby="start-title" className="surface grid gap-3 rounded-[24px] p-5 sm:p-7">
          <h2 id="start-title" className="flex items-center gap-2 text-[22px] leading-8">
            <Glyph name="tv" className="size-6 text-gold" />
            ماذا تحتاجون؟
          </h2>
          <ul className="grid gap-2 text-[15px] leading-[27px] text-mist">
            <li>• شاشة كبيرة إن وُجدت: تلفزيون أو لابتوب أو تابلت. وبدونها يعرض المضيف الشاشة من جواله بزر «اعرض هنا».</li>
            <li>• جوال لكل لاعب، ينضم بمسح رمز QR أو بكتابة رمز الغرفة.</li>
            <li>• لا تسجيل ولا تحميل ولا دفع.</li>
          </ul>
        </section>

        {seo.examples ? (
          <section aria-labelledby="examples-title" className="surface grid gap-3 rounded-[24px] p-5 sm:p-7">
            <h2 id="examples-title" className="flex items-center gap-2 text-[22px] leading-8">
              <Glyph name="fire" className="size-6 text-gold" />
              {seo.examples.title}
            </h2>
            <ul className="flex flex-wrap gap-2">
              {seo.examples.items.map((item) => (
                <li key={item} className="rounded-[14px] border border-line-strong/60 bg-deep-2/60 px-3 py-2 text-[15px] text-ivory">
                  {item}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section aria-labelledby="faq-title" className="surface grid gap-2 rounded-[24px] p-5 sm:p-7">
          <h2 id="faq-title" className="mb-1 flex items-center gap-2 text-[22px] leading-8">
            <Glyph name="info" className="size-6 text-gold" />
            أسئلة شائعة
          </h2>
          {seo.faq.map((f) => (
            <details key={f.q} className="group rounded-[16px] border border-line bg-deep-2/40 px-4 py-3">
              <summary className="flex cursor-pointer list-none items-center gap-2 text-[16px] font-semibold text-ivory">
                {f.q}
                <Glyph name="forward" className="ms-auto size-4 shrink-0 text-mist transition group-open:-rotate-90" />
              </summary>
              <p className="mt-2 text-[15px] leading-[27px] text-mist">{f.a}</p>
            </details>
          ))}
        </section>

        {others.length ? (
          <section aria-labelledby="more-title" className="grid gap-3">
            <h2 id="more-title" className="text-[20px] leading-8">ألعاب أخرى</h2>
            <ul className="flex flex-wrap gap-2">
              {others.map((g) => (
                <li key={g.id}>
                  <Link
                    to="/games/$slug"
                    params={{ slug: g.id }}
                    className="inline-flex min-h-12 items-center gap-2.5 rounded-full border border-line-strong/70 bg-deep-2/50 py-1.5 ps-1.5 pe-4 text-[15px] font-semibold text-ivory transition hover:border-glow"
                  >
                    <GameIcon id={g.id} size="sm" className="size-9! rounded-full!" />
                    {g.title}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </article>
    </Shell>
  );
}
