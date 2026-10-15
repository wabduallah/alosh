import { supabase } from "@/lib/supabase";
import { generateCourtCaseDraft } from "@/lib/court-case-ai";
import type { CourtCase } from "@/components/admin/cases";

/**
 * «المحكمة»: قضية جديدة بالذكاء الاصطناعي (supabase/functions/court-generate)، وإن لم تكن
 * الدالة مفعّلة فمن مولّد القوالب المحلي. القضية مسودة دائمًا: تُراجع وتُعدّل قبل اللعب.
 */

export type GenerateOptions = {
  category?: string;
  difficulty: number;
  dual: boolean;
  guilty: "any" | "guilty" | "innocent";
  players: number;
  idea?: string;
};

export type Generated = { draft: CourtCase; source: "ai" | "template"; note?: string };

const KINDS = ["accused", "prosecutor", "lawyer", "detective", "witness"];

/** Turns whatever came back into a clean case shape (the editor shows what is missing). */
export function normalizeCase(raw: Record<string, unknown>): CourtCase {
  const str = (v: unknown, n = 2000) => (typeof v === "string" ? v.slice(0, n) : "");
  const roles = (Array.isArray(raw.roles) ? raw.roles : [])
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object" && KINDS.includes(String((r as Record<string, unknown>).kind)))
    .slice(0, 12)
    .map((r, i) => {
      const exhibits = Array.isArray(r.exhibits)
        ? (r.exhibits as Array<Record<string, unknown>>).slice(0, 3).map((x) => ({ title: str(x.title, 60), text: str(x.text, 400), icon: str(x.icon, 8) || "📎", ...(x.time ? { time: str(x.time, 8) } : {}) }))
        : undefined;
      return {
        key: str(r.key, 30) || `r${i + 1}`,
        kind: String(r.kind) as CourtCase["roles"][number]["kind"],
        name: str(r.name, 60),
        brief: str(r.brief, 160) || undefined,
        secret: str(r.secret, 800),
        later: str(r.later, 600) || undefined,
        later_stage: Number(r.later_stage) || undefined,
        optional: r.optional === true && !["accused", "prosecutor", "lawyer"].includes(String(r.kind)),
        fallback: str(r.fallback, 600) || undefined,
        fallback_stage: Number(r.fallback_stage) || undefined,
        win: ["truth", "convict", "acquit"].includes(String(r.win)) ? (String(r.win) as "truth" | "convict" | "acquit") : undefined,
        goal: str(r.goal, 200) || undefined,
        guilty: typeof r.guilty === "boolean" ? r.guilty : undefined,
        exhibits: exhibits?.length ? exhibits : undefined,
      };
    });
  const evidence = (Array.isArray(raw.evidence) ? raw.evidence : [])
    .filter((e): e is Record<string, unknown> => !!e && typeof e === "object")
    .slice(0, 15)
    .map((e) => ({ stage: Math.min(2, Math.max(1, Number(e.stage) || 1)), icon: str(e.icon, 8) || "📄", title: str(e.title, 60), text: str(e.text, 400), ...(e.time ? { time: str(e.time, 8) } : {}) }));
  const suspects = Array.isArray(raw.suspects)
    ? (raw.suspects as Array<Record<string, unknown>>).slice(0, 6).map((s, i) => ({ key: str(s.key, 20) || `s${i + 1}`, name: str(s.name, 60) }))
    : null;
  return {
    title: str(raw.title, 80),
    category: str(raw.category, 40) || null,
    difficulty: [1, 2, 3].includes(Number(raw.difficulty)) ? Number(raw.difficulty) : 2,
    summary: str(raw.summary, 300),
    intro: str(raw.intro),
    guilty: raw.guilty !== false,
    truth: str(raw.truth),
    roles,
    evidence,
    is_active: true,
    suspects: suspects && suspects.length >= 2 ? suspects : null,
    culprit: suspects?.some((s) => s.key === raw.culprit) ? String(raw.culprit) : null,
    juror_clues: Array.isArray(raw.juror_clues) ? (raw.juror_clues as unknown[]).map((x) => str(x, 300)).filter(Boolean).slice(0, 12) : [],
  };
}

function templateCase(o: GenerateOptions): CourtCase {
  const t = generateCourtCaseDraft({ dualAccused: o.dual, difficulty: o.difficulty });
  const guilty = o.guilty === "any" ? t.guilty : o.guilty === "guilty";
  return normalizeCase({
    ...t,
    guilty,
    summary: t.intro.slice(0, 120),
    evidence: t.evidence.map((e) => ({ ...e, stage: Math.min(2, e.stage) })),
    roles: t.roles.map((r) => (r.kind === "accused" ? { ...r, guilty: r.key === "accused-1" ? guilty : t.guilty } : r)),
  });
}

const ERRORS: Record<string, string> = {
  TOO_MANY: "وصلت حد التوليد لهذه الساعة. جرّب لاحقًا.",
  NO_SESSION: "افتح الصفحة من جديد ثم جرّب.",
  AI_FAILED: "تعذّر الوصول للمولّد الآن.",
  BAD_JSON: "رد المولّد غير مكتمل. جرّب مرة ثانية.",
};

export async function generateCase(o: GenerateOptions): Promise<Generated> {
  if (supabase) {
    try {
      const { data, error } = await supabase.functions.invoke("court-generate", { body: o });
      if (!error && data?.case) return { draft: normalizeCase(data.case as Record<string, unknown>), source: "ai" };
      // The function answered with a reason: show it, unless it is simply not set up yet.
      let reason: string | undefined = data?.error;
      if (!reason && error && "context" in error) {
        try {
          reason = (await (error as { context: Response }).context.json())?.error;
        } catch {
          // Not JSON: treat as not set up.
        }
      }
      if (reason && reason !== "NOT_CONFIGURED" && ERRORS[reason]) {
        return { draft: templateCase(o), source: "template", note: `${ERRORS[reason]} هذه قضية من القوالب بدلًا منها.` };
      }
    } catch {
      // Not deployed: fall through to the templates.
    }
  }
  return { draft: templateCase(o), source: "template", note: "المولّد الذكي غير مفعّل بعد، فهذه قضية من القوالب الجاهزة. راجعها وعدّلها قبل اللعب." };
}
