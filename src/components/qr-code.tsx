import { useEffect, useState } from "react";

export function QrCode({ text, className = "size-44" }: { text: string; className?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let on = true;
    void import("qrcode").then((mod) =>
      mod.toDataURL(text, {
        margin: 1,
        width: 480,
        color: { dark: "#E5C158", light: "#121110" },
      }),
    ).then((url) => {
      if (on) setSrc(url);
    }).catch(() => undefined);
    return () => {
      on = false;
    };
  }, [text]);
  if (!src) return <div className={`${className} animate-pulse rounded-lg bg-ink/10`} />;
  return <img src={src} alt="" className={`${className} rounded-lg bg-[#121110]`} />;
}
