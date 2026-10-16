import { Link } from "@tanstack/react-router";
import { Shell } from "@/components/shell";
import { Glyph } from "@/components/brand";
import { infoLinks, useSiteSettings, type PageKey } from "@/lib/site-settings";
import { DEFAULT_PAGES, PAGE_META, parsePage, type PageBlock } from "@/lib/pages";

/** /privacy, /faq, /copyright: the admin's text when set, otherwise the built-in one. Text only, never HTML. */
export function InfoPage({ page }: { page: PageKey }) {
  const settings = useSiteSettings();
  const meta = PAGE_META[page];
  const custom = settings?.pages?.[page];
  const body = custom?.body?.trim() ? custom.body : DEFAULT_PAGES[page];
  const blocks = parsePage(body);
  const contact = infoLinks(settings?.info);
  const updated = custom?.updated && !Number.isNaN(Date.parse(custom.updated)) ? new Date(custom.updated) : null;

  return (
    <Shell>
      <article className="mx-auto grid max-w-3xl gap-5">
        <header className="surface grid gap-2 rounded-[24px] p-5 sm:p-7">
          <h1 className="flex items-center gap-2.5 text-[28px] leading-10 lg:text-[34px] lg:leading-[48px]">
            <Glyph name={meta.icon} className="size-7 text-gold" />
            {meta.title}
          </h1>
          <p className="text-[16px] leading-7 text-mist">{meta.intro}</p>
          {updated ? (
            <p className="text-[13px] text-muted">
              آخر تحديث: {updated.toLocaleDateString("ar", { year: "numeric", month: "long", day: "numeric" })}
            </p>
          ) : null}
        </header>

        <div className="surface grid gap-4 rounded-[24px] p-5 sm:p-7">
          {blocks.map((b, i) => (
            <Block key={i} b={b} />
          ))}
        </div>

        <section className="surface grid gap-3 rounded-[24px] p-5 sm:p-7">
          <h2 className="text-[20px] leading-8">تواصل معنا</h2>
          {contact.length ? (
            <ul className="flex flex-wrap gap-2">
              {contact.map((c) => (
                <li key={c.key}>
                  <a
                    href={c.href}
                    {...(c.href.startsWith("mailto:") ? {} : { target: "_blank", rel: "noopener noreferrer" })}
                    className="inline-flex min-h-11 items-center rounded-full border border-line-strong/70 px-4 text-[15px] text-ivory transition hover:border-gold/60 hover:text-gold"
                  >
                    {c.label}
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="text-[15px] leading-7 text-mist">
            أو أرسل رسالتك من «أبلغ عن مشكلة أو اقتراح» في آخر أي لعبة، وتصل مباشرة لفريق الموقع.
          </p>
          <nav aria-label="صفحات المعلومات" className="flex flex-wrap gap-x-5 gap-y-1 border-t border-line pt-3">
            {(Object.keys(PAGE_META) as PageKey[])
              .filter((k) => k !== page)
              .map((k) => (
                <Link key={k} to={PAGE_META[k].path} className="inline-flex min-h-11 items-center text-[15px] text-gold underline-offset-4 hover:underline">
                  {PAGE_META[k].title}
                </Link>
              ))}
          </nav>
        </section>
      </article>
    </Shell>
  );
}

function Block({ b }: { b: PageBlock }) {
  if (b.kind === "h") return <h2 className="mt-2 text-[21px] leading-8 text-ivory first:mt-0">{b.text}</h2>;
  if (b.kind === "p") return <p className="text-[16px] leading-[30px] text-mist">{b.text}</p>;
  if (b.kind === "ul")
    return (
      <ul className="grid gap-2 ps-1">
        {b.items.map((t, i) => (
          <li key={i} className="flex gap-2.5 text-[16px] leading-[30px] text-mist">
            <span aria-hidden="true" className="mt-[13px] size-1.5 shrink-0 rounded-full bg-gold" />
            <span>{t}</span>
          </li>
        ))}
      </ul>
    );
  return (
    <details className="group rounded-[18px] border border-line bg-night/30 open:border-gold/40">
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-[17px] font-bold text-ivory [&::-webkit-details-marker]:hidden">
        {b.q}
        <Glyph name="chevron" className="size-5 shrink-0 -rotate-90 text-gold transition group-open:rotate-90" />
      </summary>
      <div className="grid gap-3 px-4 pb-4">
        {b.a.map((x, i) => (
          <Block key={i} b={x} />
        ))}
      </div>
    </details>
  );
}
