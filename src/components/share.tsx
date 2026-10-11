import { joinLink } from "@/components/ui";

/** WhatsApp share link with a prefilled message. Opens the app or WhatsApp Web. */
function whatsappUrl(text: string) {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

const LINK_CLASS =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-emerald/40 bg-emerald/10 px-5 text-sm font-bold text-ivory transition hover:border-emerald";

/** Sends the room code and join link to a WhatsApp chat. */
export function ShareRoom({ code }: { code: string }) {
  const text = `هيا العبوا معي على العش! رمز الغرفة: ${code}\n${joinLink(code)}`;
  return (
    <div className="mb-4 flex justify-center">
      <a href={whatsappUrl(text)} target="_blank" rel="noopener noreferrer" className={LINK_CLASS}>
        أرسل الرابط عبر واتساب
      </a>
    </div>
  );
}

/** Shares the home page with friends. */
export function ShareSite() {
  const home = typeof window === "undefined" ? "https://al3sh.app" : window.location.origin;
  const text = `جرّبوا العش، ألعاب جماعية نلعبها من جوالاتنا، بدون تسجيل:\n${home}`;
  return (
    <a href={whatsappUrl(text)} target="_blank" rel="noopener noreferrer" className={LINK_CLASS}>
      شاركوا العش عبر واتساب
    </a>
  );
}
