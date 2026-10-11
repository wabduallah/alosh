import { useEffect, useState } from "react";
import { GameIcon, Glyph } from "@/components/brand";
import { Button, Field, cx, inputClass } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { Loading, Notice, Toggle, dbMessage, textareaClass } from "./common";

export type AdminGame = {
  id: string;
  slug: string;
  title_ar: string;
  description_ar: string;
  min_players: number;
  max_players: number;
  is_active: boolean;
};

/** Reads every game, active or not (admins see all rows). */
export async function loadGames() {
  if (!supabase) return { data: [] as AdminGame[], error: null };
  const { data, error } = await supabase
    .from("games")
    .select("id, slug, title_ar, description_ar, min_players, max_players, is_active")
    .order("title_ar");
  return { data: (data ?? []) as AdminGame[], error };
}

/** Games: turn a game on or off, and edit its name, description and player counts. */
export function GamesTab() {
  const [games, setGames] = useState<AdminGame[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const { data, error: loadError } = await loadGames();
    if (loadError) setError(dbMessage(loadError, "تعذّر تحميل الألعاب."));
    setGames(data);
  }

  useEffect(() => {
    void refresh();
  }, []);

  if (games === null) return <Loading />;
  return (
    <div className="grid grid-cols-1 gap-4">
      {error ? <Notice tone="error">{error}</Notice> : null}
      <p className="text-[14px] leading-6 text-mist">
        اللعبة الموقوفة تختفي من صفحة إنشاء الغرفة، ولا تفتح غرفها الجارية بشكل صحيح. أوقفها حين لا توجد غرف تُلعب بها.
      </p>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {games.map((g) => (
          <GameEditor key={`${g.id}-${g.title_ar}-${g.is_active}-${g.min_players}-${g.max_players}`} game={g} onSaved={refresh} />
        ))}
      </div>
    </div>
  );
}

function GameEditor({ game, onSaved }: { game: AdminGame; onSaved: () => Promise<void> }) {
  const [draft, setDraft] = useState(game);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const changed =
    draft.title_ar !== game.title_ar ||
    draft.description_ar !== game.description_ar ||
    draft.min_players !== game.min_players ||
    draft.max_players !== game.max_players ||
    draft.is_active !== game.is_active;

  async function save() {
    if (!supabase) return;
    const title = draft.title_ar.trim();
    if (title.length < 2 || title.length > 80) return setNote({ tone: "error", text: "الاسم بين حرفين و80 حرفًا." });
    if (!(draft.min_players >= 1)) return setNote({ tone: "error", text: "أقل عدد لاعبين 1." });
    if (!(draft.max_players >= draft.min_players && draft.max_players <= 100))
      return setNote({ tone: "error", text: "أكبر عدد لاعبين بين أقل عدد و100." });
    setBusy(true);
    setNote(null);
    const { error } = await supabase
      .from("games")
      .update({
        title_ar: title,
        description_ar: draft.description_ar.trim(),
        min_players: draft.min_players,
        max_players: draft.max_players,
        is_active: draft.is_active,
      })
      .eq("id", game.id);
    setBusy(false);
    if (error) return setNote({ tone: "error", text: dbMessage(error) });
    await onSaved();
  }

  return (
    <section className={cx("surface grid gap-4 rounded-[24px] p-5", !draft.is_active && "opacity-80")}>
      <div className="flex items-center gap-3">
        <GameIcon id={game.slug} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[20px] leading-8">{game.title_ar}</h3>
          <p className="text-[12px] text-faint">
            <bdi>{game.slug}</bdi>
          </p>
        </div>
        <span
          className={cx(
            "rounded-full px-3 py-1 text-[13px] font-semibold",
            game.is_active ? "bg-correct-fill/20 text-correct" : "bg-deep-2 text-mist",
          )}
        >
          {game.is_active ? "مفعّلة" : "موقوفة"}
        </span>
      </div>

      <Toggle checked={draft.is_active} onChange={(v) => setDraft({ ...draft, is_active: v })} label="متاحة في إنشاء الغرفة" />

      <Field label="الاسم">
        <input className={inputClass} value={draft.title_ar} maxLength={80} onChange={(e) => setDraft({ ...draft, title_ar: e.target.value })} />
      </Field>
      <Field label="الوصف">
        <textarea className={textareaClass} value={draft.description_ar} onChange={(e) => setDraft({ ...draft, description_ar: e.target.value })} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="أقل عدد لاعبين">
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={100}
            className={inputClass}
            value={draft.min_players}
            onChange={(e) => setDraft({ ...draft, min_players: Number(e.target.value) })}
          />
        </Field>
        <Field label="أكبر عدد لاعبين">
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={100}
            className={inputClass}
            value={draft.max_players}
            onChange={(e) => setDraft({ ...draft, max_players: Number(e.target.value) })}
          />
        </Field>
      </div>

      {note ? <Notice tone={note.tone}>{note.text}</Notice> : null}

      <div className="flex flex-wrap gap-2">
        <Button tone="primary" onClick={save} disabled={!changed || busy}>
          <Glyph name="check" className="size-[18px]" />
          {busy ? "جارٍ الحفظ…" : "حفظ التغييرات"}
        </Button>
        {changed ? (
          <Button tone="quiet" onClick={() => setDraft(game)} disabled={busy}>
            تراجع
          </Button>
        ) : null}
      </div>
    </section>
  );
}
