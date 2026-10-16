import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

/**
 * Site settings the admin edits (supabase/admin_v3.sql). Public: anyone can read them.
 * Read once per page load and shared between components.
 */

export type Announcement = {
  active?: boolean;
  text?: string;
  link?: string;
  link_label?: string;
  tone?: "gold" | "violet" | "green";
  where?: "home" | "all";
  starts_at?: string | null;
  ends_at?: string | null;
  version?: number;
};

export type GameDefaults = {
  alhalba?: {
    mode?: "ffa" | "duel" | "teams";
    rounds?: number;
    lives?: number;
    host_plays?: boolean;
    bid_seconds?: number;
    judge?: "auto" | "manual" | "both";
    pace?: number;
    win_rule?: "score" | "last";
    auto_next?: boolean;
    group_every?: number;
    levels?: number[];
  };
  "heads-up"?: { turn_seconds?: number };
  /** Used when the narrator has no settings saved from an earlier match in the room. */
  "social-mafia"?: {
    random_narrator?: boolean;
    mafia_count?: number;
    reveal?: boolean;
    day_seconds?: number;
    vote_seconds?: number;
    night_seconds?: number;
    roles?: Partial<Record<"jester" | "mayor" | "bodyguard" | "sniper" | "seer" | "spy" | "lovers" | "disguised", boolean>>;
    dead_see_roles?: boolean;
  };
  "tactical-grid"?: { seconds?: number };
  court?: { host_plays?: boolean; auto?: boolean; quick?: boolean; judge?: "host" | "random"; question_seconds?: number; closing_seconds?: number; vote_seconds?: number; escalate?: boolean; objections?: number; turn_seconds?: number; read_seconds?: number; golden?: "jurors" | "all" | "off" };
};

/** Admin-chosen games where the admin can add test guests to a room (supabase/site_v1.sql). */
export type TestGuests = { games?: Record<string, boolean> };

export type HomeSectionKey = "hero" | "how" | "games" | "cta";
/** The home page: texts and the order of its sections. Empty values fall back to the built-in text. */
export type HomeSettings = {
  tagline?: string;
  subtitle?: string;
  features?: string[];
  cta_title?: string;
  cta_text?: string;
  footer_text?: string;
  sections?: Array<{ key: HomeSectionKey; visible: boolean }>;
};

/** Colors: a preset, or two custom colors (main action and supporting accent). */
export type ThemeSettings = { preset?: string; accent?: string; accent2?: string };

/** Contact and info shown in the footer and the info pages. */
export type InfoSettings = { email?: string; whatsapp?: string; x?: string; instagram?: string; tiktok?: string; snapchat?: string };

export type PageKey = "privacy" | "faq" | "copyright";
/** Admin overrides for the info pages: the whole text, «## » starts a heading. */
export type PagesSettings = Partial<Record<PageKey, { body?: string; updated?: string }>>;

type Settings = {
  announcement?: Announcement;
  game_defaults?: GameDefaults;
  test_guests?: TestGuests;
  home?: HomeSettings;
  theme?: ThemeSettings;
  info?: InfoSettings;
  pages?: PagesSettings;
};

export const DEFAULT_SECTIONS: Array<{ key: HomeSectionKey; visible: boolean }> = [
  { key: "hero", visible: true },
  { key: "how", visible: true },
  { key: "games", visible: true },
  { key: "cta", visible: true },
];

/** The home sections in the admin's order; any section the admin never saw keeps its place. */
export function homeSections(home: HomeSettings | undefined) {
  const saved = (home?.sections ?? []).filter((x) => DEFAULT_SECTIONS.some((d) => d.key === x.key));
  const missing = DEFAULT_SECTIONS.filter((d) => !saved.some((x) => x.key === d.key));
  return [...saved, ...missing];
}

export type ThemePreset = { key: string; label: string; gold: string; light: string; deep: string; violet: string; violetText: string };
export const THEME_PRESETS: ThemePreset[] = [
  { key: "gold", label: "ذهبي (الأصلي)", gold: "#ffa53a", light: "#ffc04d", deep: "#f7832a", violet: "#663ade", violetText: "#a58bff" },
  { key: "rose", label: "وردي", gold: "#ff6b9a", light: "#ff9dbb", deep: "#e8457a", violet: "#3070e9", violetText: "#7fa8ff" },
  { key: "sky", label: "سماوي", gold: "#38bdf8", light: "#7dd3fc", deep: "#0ea5e9", violet: "#8b5cf6", violetText: "#c4b5fd" },
  { key: "lime", label: "ليموني", gold: "#facc15", light: "#fde047", deep: "#eab308", violet: "#7c3aed", violetText: "#a78bfa" },
  { key: "mint", label: "نعناعي", gold: "#2dd4bf", light: "#5eead4", deep: "#14b8a6", violet: "#6366f1", violetText: "#a5b4fc" },
];

/** #rrggbb mixed toward white (amount > 0) or black (amount < 0). */
function mix(hex: string, amount: number) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const target = amount > 0 ? 255 : 0;
  const a = Math.abs(amount);
  const ch = (v: number) => Math.round(v + (target - v) * a);
  const r = ch((n >> 16) & 255), g = ch((n >> 8) & 255), b = ch(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

/** The palette a theme setting stands for, or null for the built-in colors. */
export function themePalette(t: ThemeSettings | undefined): ThemePreset | null {
  if (!t) return null;
  if (t.preset === "custom" && t.accent && /^#[0-9a-f]{6}$/i.test(t.accent)) {
    const v = t.accent2 && /^#[0-9a-f]{6}$/i.test(t.accent2) ? t.accent2 : "#663ade";
    return { key: "custom", label: "مخصص", gold: t.accent, light: mix(t.accent, 0.25), deep: mix(t.accent, -0.12), violet: v, violetText: mix(v, 0.4) };
  }
  const p = THEME_PRESETS.find((x) => x.key === t.preset);
  return p && p.key !== "gold" ? p : null;
}

/** Applies the admin's colors to the page (the CSS tokens of styles.css). */
export function applyTheme(t: ThemeSettings | undefined) {
  if (typeof document === "undefined") return;
  const root = document.documentElement.style;
  const p = themePalette(t);
  const vars: Array<[string, string | null]> = [
    ["--color-gold", p?.gold ?? null],
    ["--color-gold-light", p?.light ?? null],
    ["--color-gold-deep", p?.deep ?? null],
    ["--color-violet", p?.violet ?? null],
    ["--color-violet-fill", p ? mix(p.violet, -0.06) : null],
    ["--color-violet-text", p?.violetText ?? null],
    ["--shadow-glow-gold", p ? `0 10px 28px -8px ${p.deep}aa` : null],
  ];
  for (const [k, v] of vars) {
    if (v) root.setProperty(k, v);
    else root.removeProperty(k);
  }
}

/** The contact links the admin filled in, as safe hrefs (anything that does not look right is dropped). */
export function infoLinks(info: InfoSettings | undefined) {
  if (!info) return [];
  const handle = (v: string | undefined) => (v ?? "").trim().replace(/^@/, "").replace(/[^A-Za-z0-9._-]/g, "");
  const out: Array<{ key: string; label: string; href: string }> = [];
  const email = (info.email ?? "").trim();
  if (/^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i.test(email)) out.push({ key: "email", label: "البريد", href: `mailto:${email}` });
  const wa = (info.whatsapp ?? "").replace(/\D/g, "");
  if (wa.length >= 8) out.push({ key: "whatsapp", label: "واتساب", href: `https://wa.me/${wa}` });
  const x = handle(info.x);
  if (x) out.push({ key: "x", label: "إكس", href: `https://x.com/${x}` });
  const ig = handle(info.instagram);
  if (ig) out.push({ key: "instagram", label: "إنستغرام", href: `https://instagram.com/${ig}` });
  const tt = handle(info.tiktok);
  if (tt) out.push({ key: "tiktok", label: "تيك توك", href: `https://www.tiktok.com/@${tt}` });
  const sc = handle(info.snapchat);
  if (sc) out.push({ key: "snapchat", label: "سناب شات", href: `https://www.snapchat.com/add/${sc}` });
  return out;
}

let cache: Promise<Settings> | null = null;

export function loadSiteSettings(fresh = false): Promise<Settings> {
  if (!supabase) return Promise.resolve({});
  if (!cache || fresh) {
    const client = supabase;
    cache = Promise.resolve(client.from("site_settings").select("key, value")).then(({ data, error }) => {
      // Before admin_v3.sql the table does not exist: no settings, nothing breaks.
      if (error || !Array.isArray(data)) return {};
      return Object.fromEntries((data as Array<{ key: string; value: unknown }>).map((r) => [r.key, r.value])) as Settings;
    });
  }
  return cache;
}

export function useSiteSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  useEffect(() => {
    let alive = true;
    void loadSiteSettings().then((s) => alive && setSettings(s));
    return () => {
      alive = false;
    };
  }, []);
  return settings;
}

/** True when the announcement should show now. */
export function announcementLive(a: Announcement | undefined, now = Date.now()) {
  if (!a?.active || !a.text?.trim()) return false;
  if (a.starts_at && Date.parse(a.starts_at) > now) return false;
  if (a.ends_at && Date.parse(a.ends_at) < now) return false;
  return true;
}
