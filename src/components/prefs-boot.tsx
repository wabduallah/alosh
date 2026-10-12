import { useEffect } from "react";
import { applyMotion } from "@/lib/prefs";

/** Applies the visitor's saved preferences once the page is running (motion for now). */
export function PrefsBoot() {
  useEffect(() => {
    applyMotion();
  }, []);
  return null;
}
