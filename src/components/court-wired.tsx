import { useMemo } from "react";
import {
  CourtHostPanel as CourtHostPanelBase,
  CourtPlayerPanel as CourtPlayerPanelBase,
  CourtTv as CourtTvBase,
  useCourtLive,
} from "@/components/court";
import {
  CourtPhaseBar,
  CourtPhaseHint,
  CourtQuestionSuggestions,
} from "@/components/court-phase-bar";
import { phaseGuide, suggestQuestions } from "@/lib/court-phase-guide";
import { useSecondsLeft } from "@/components/halba";

function useCourtChrome(roomId: string) {
  const { state, players } = useCourtLive(roomId);
  const left = useSecondsLeft(state.ends_at ?? null);
  const standName = useMemo(() => {
    if (!state.stand) return null;
    const fromCast = state.cast?.find((c) => c.player_id === state.stand);
    if (fromCast?.player_name) return fromCast.player_name;
    return players.find((p) => p.id === state.stand)?.player_name ?? null;
  }, [state.stand, state.cast, players]);
  const myKind = useMemo(() => {
    // host/tv screens don't need a personal role
    return null as string | null;
  }, []);
  return { state, players, left, standName, myKind };
}

/** شاشة المضيف مع شريط المراحل */
export function CourtHostPanel({ roomId }: { roomId: string }) {
  const { state, left, standName } = useCourtChrome(roomId);
  return (
    <div className="space-y-3">
      {state.game === "court" || state.phase ? (
        <CourtPhaseBar phase={state.phase} leftSeconds={left} standName={standName} />
      ) : null}
      <CourtHostPanelBase roomId={roomId} />
    </div>
  );
}

/** جوال اللاعب مع تعليمات المرحلة واقتراحات الأسئلة */
export function CourtPlayerPanel({ roomId, meId }: { roomId: string; meId: string | null }) {
  const { state, left, standName } = useCourtChrome(roomId);
  const myRole = useMemo(() => {
    if (!meId) return undefined;
    return state.cast?.find((c) => c.player_id === meId)?.kind;
  }, [state.cast, meId]);
  const hint = phaseGuide(myRole, state.phase);
  const suggestions =
    state.phase === "question" && myRole && myRole !== "accused" && myRole !== "witness"
      ? suggestQuestions(myRole, state.stage)
      : [];

  return (
    <div className="space-y-3">
      {state.game === "court" || state.phase ? (
        <CourtPhaseBar phase={state.phase} leftSeconds={left} standName={standName} compact />
      ) : null}
      {myRole && state.phase ? <CourtPhaseHint text={hint} /> : null}
      {suggestions.length ? <CourtQuestionSuggestions items={suggestions} /> : null}
      <CourtPlayerPanelBase roomId={roomId} meId={meId} />
    </div>
  );
}

/** شاشة التلفزيون مع شريط المراحل */
export function CourtTv({ roomId }: { roomId: string }) {
  const { state, left, standName } = useCourtChrome(roomId);
  return (
    <div className="flex flex-1 flex-col gap-[1.5vh]">
      {state.game === "court" || state.phase ? (
        <CourtPhaseBar phase={state.phase} leftSeconds={left} standName={standName} />
      ) : null}
      <CourtTvBase roomId={roomId} />
    </div>
  );
}
