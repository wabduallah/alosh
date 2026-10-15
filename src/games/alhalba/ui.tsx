import { AlhalbaGameState } from "./model";

export interface AlhalbaBoardProps {
  game: AlhalbaGameState;
  onStartRound?: () => void;
}

export function AlhalbaBoard({ game, onStartRound }: AlhalbaBoardProps) {
  const round = game.currentRound;

  return (
    <section aria-label="Alhalba board" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <header className="mb-4 flex items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">Game</p>
          <h2 className="text-xl font-semibold text-slate-900">Alhalba</h2>
        </div>
        <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
          {game.phase}
        </span>
      </header>

      <div className="space-y-3">
        <div>
          <p className="text-sm text-slate-500">Round</p>
          <p className="text-2xl font-bold text-slate-900">
            {round.round}/{round.maxRounds}
          </p>
        </div>

        <div>
          <p className="text-sm text-slate-500">Topic</p>
          <p className="text-base font-medium text-slate-800">
            {round.topic?.text ?? "Waiting for next topic"}
          </p>
        </div>

        <div>
          <p className="text-sm text-slate-500">Answers</p>
          <p className="text-base font-medium text-slate-800">{round.answerCount}</p>
        </div>

        {onStartRound ? (
          <button
            type="button"
            onClick={onStartRound}
            className="mt-4 inline-flex items-center justify-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            Start round
          </button>
        ) : null}
      </div>
    </section>
  );
}
