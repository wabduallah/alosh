import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Shell } from "@/components/shell";
import { soloAnswer, soloQuestion } from "@/lib/lamma/rpc";

export const Route = createFileRoute("/solo/$id")({
  head: () => ({ meta: [{ title: "لعب فردي — العش" }] }),
  component: SoloPlay,
});

function SoloPlay() {
  const { id } = Route.useParams();
  const [prompt, setPrompt] = useState("");
  const [choices, setChoices] = useState<{ id: string; ar: string }[]>([]);
  const [qid, setQid] = useState(0);
  const [score, setScore] = useState(0);
  const [note, setNote] = useState("");
  const [level, setLevel] = useState<"medium" | "hard" | "mixed">("mixed");
  const [busy, setBusy] = useState(false);

  async function next() {
    setBusy(true);
    setNote("");
    const res = await soloQuestion({ data: { gameId: id } });
    setBusy(false);
    if (!res.ok) {
      setNote("لا توجد أسئلة منشورة لهذه اللعبة بعد.");
      return;
    }
    setQid(res.id);
    setPrompt(res.promptAr);
    setChoices(res.choices);
  }

  async function pick(choiceId: string) {
    if (!qid || busy) return;
    setBusy(true);
    const res = await soloAnswer({ data: { questionId: qid, choiceId } });
    setBusy(false);
    if (!res.ok) return;
    setScore((n) => n + res.points);
    setNote(res.correct ? "إجابة صحيحة" : "إجابة غير صحيحة");
    setQid(0);
  }

  return (
    <Shell>
      <p className="text-sm text-[#94a3b8]">لعب فردي مباشر · النقاط {score}</p>
      <h1 className="mt-2 text-3xl font-extrabold">{prompt || "ابدأ الجولة"}</h1>
      <div className="mt-6 grid gap-2">
        {choices.map((choice) => (
          <button key={choice.id} type="button" disabled={busy} onClick={() => void pick(choice.id)} className="min-h-12 rounded-2xl border border-[rgb(255_255_255/0.08)] bg-[rgb(255_255_255/0.03)] px-4 text-start">{choice.ar}</button>
        ))}
      </div>
      {note ? <p className="mt-4 text-[#67e8f9]">{note}</p> : null}
      <div className="mt-4 grid grid-cols-3 gap-2">
        {(["medium", "hard", "mixed"] as const).map((id) => (
          <button key={id} type="button" onClick={() => setLevel(id)} className={`min-h-11 rounded-full border ${level === id ? "border-neon bg-neon text-night" : "border-[rgb(255_255_255/0.08)]"}`}>{id === "medium" ? "متوسط" : id === "hard" ? "صعب" : "مزيج"}</button>
        ))}
      </div>
      <div className="mt-6 flex gap-2">
        <button type="button" onClick={() => void next()} className="min-h-12 rounded-full bg-neon px-5 font-extrabold text-night">{prompt ? "سؤال آخر" : "ابدأ"}</button>
        <Link to="/games/single-player" className="inline-flex min-h-12 items-center rounded-full border border-[rgb(255_255_255/0.08)] px-5">رجوع</Link>
      </div>
    </Shell>
  );
}
