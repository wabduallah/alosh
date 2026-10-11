import { buttonBase, buttonTone, cx, joinLink } from "@/components/ui";
import { Glyph } from "@/components/brand";

/** WhatsApp share link with a prefilled message. Opens the app or WhatsApp Web. */
function whatsappUrl(text: string) {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

/** Sharing is a quiet action: never the correct-answer green. */
const LINK_CLASS = cx(buttonBase, buttonTone("quiet"));

/** Sends the room code and join link to a WhatsApp chat. */
export function ShareRoom({ code }: { code: string }) {
  const text = `هيا العبوا معي على العش! رمز الغرفة: ${code}\n${joinLink(code)}`;
  return (
    <div className="mb-4 flex justify-center">
      <a href={whatsappUrl(text)} target="_blank" rel="noopener noreferrer" className={LINK_CLASS}>
        <Glyph name="whatsapp" />
        أرسل الرابط عبر واتساب
      </a>
    </div>
  );
}

/** Shares the home page with friends. */
export function ShareSite({ className }: { className?: string }) {
  const home = typeof window === "undefined" ? "https://al3sh.app" : window.location.origin;
  const text = `جرّبوا العش، ألعاب جماعية نلعبها من جوالاتنا، بدون تسجيل:\n${home}`;
  return (
    <a href={whatsappUrl(text)} target="_blank" rel="noopener noreferrer" className={cx(LINK_CLASS, className)}>
      <Glyph name="whatsapp" />
      شاركوا العش عبر واتساب
    </a>
  );
}
