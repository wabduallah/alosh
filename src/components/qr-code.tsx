import { useEffect, useState } from "react";

/**
 * Join QR code.
 * Default high-contrast scheme: near-black modules on a clean white, rounded card.
 * The white card is part of the component so every call site gets the same treatment.
 */
export function QrCode({ text, className = "size-44" }: { text: string; className?: string }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let on = true;
    void import("qrcode")
      .then((mod) =>
        mod.toDataURL(text, {
          margin: 1,
          width: 480,
          errorCorrectionLevel: "M",
          color: { dark: "#111111", light: "#ffffff" },
        }),
      )
      .then((url) => {
        if (on) setSrc(url);
      })
      .catch(() => undefined);
    return () => {
      on = false;
    };
  }, [text]);

  if (!src) {
    return <div className={`${className} animate-pulse rounded-[20px] bg-glass-strong`} aria-hidden="true" />;
  }
  // The QR always stays dark on white, inside a card, so any camera reads it.
  return (
    <div className="inline-block rounded-[20px] bg-white p-3 shadow-[0_0_32px_#22d3ee33]">
      <img src={src} alt="رمز QR للانضمام إلى الغرفة" className={`${className} block`} />
    </div>
  );
}
