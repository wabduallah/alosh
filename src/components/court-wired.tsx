import { useEffect, useMemo, useRef } from "react";
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
import {
  CourtStandBoard,
  CourtObjectionGuide,
  CourtAnswerRules,
} from "@/components/court-stand-board";
import { CourtCaseAiReview } from "@/components/court-case-review";
import { phaseGuide, suggestQuestions } from "@/lib/court-phase-guide";
import { useSecondsLeft } from "@/components/halba";
import { supabase } from "@/lib/supabase";

function useCourtChrome(roomId: string) {
  const { state, players } = useCourtLive(roomId);
  const left = useSecondsLeft(state.ends_at ?? null);
  const standName = useMemo(() => {
    if (!state.stand) return null;
    const fromCast = state.cast?.find((c) => c.player_id === state.stand);
    if (fromCast?.player_name) return fromCast.player_name;
    return players.find((p) => p.id === state.stand)?.player_name ?? null;
  }, [state.stand, state.cast, players]);
  return { state, players, left, standName };
}

function useAutoStand(roomId: string, enabled: boolean) {
  const { state } = useCourtLive(roomId);
  const idx = useRef(0);
  const lastStep = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled || !supabase) return;
    if (state.phase !== "question") return;
    if (state.objection?.status === "pending") return;

    const step = state.step ?? -1;
    if (lastStep.current !== step) {
      lastStep.current = step;
      idx.current = 0;
    }

    const cast = state.cast ?? [];
    const pool = cast.filter((c) => c.kind === "accused" || c.kind === "witness");
    if (!pool.length) return;

    const tick = () => {
      const target = pool[idx.current % pool.length];
      idx.current += 1;
      if (!target) return;
      void supabase.rpc("court_stand", { p_room_id: roomId, p_player_id: target.player_id });
    };

    const first = window.setTimeout(tick, 8_000);
    const id = window.setInterval(tick, 45_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [roomId, enabled, state.phase, state.step, state.objection?.status, state.cast]);
}

export function CourtHostPanel({ roomId }: { roomId: string }) {
  const { state, left, standName } = useCourtChrome(roomId);
  const auto = !!state.settings?.auto;
  useAutoStand(roomId, auto);
  const started = state.game === "court" && !!state.phase;

  return (
    <div className="space-y-3">
      {!started ? <CourtCaseAiReview /> : null}
      {started ? (
        <>
          <CourtPhaseBar phase={state.phase} leftSeconds={left} standName={standName} />
          <CourtStandBoard phase={state.phase} standId={state.stand} askingId={state.asking} cast={state.cast} />
          {auto ? (
            <p className="text-center text-[11px] text-cyan-300/70">
              التصعيد التلقائي للمنصة مفعّل مع الانتقال التلقائي (حوالي كل 45 ثانية).
            </p>
          ) : null}
        </>
      ) : null}
      <CourtHostPanelBase roomId={roomId} />
    </div>
  );
}

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
        <>
          <CourtPhaseBar phase={state.phase} leftSeconds={left} standName={standName} compact />
          <CourtStandBoard phase={state.phase} standId={state.stand} askingId={state.asking} cast={state.cast} compact />
        </>
      ) : null}
      {myRole && state.phase ? <CourtPhaseHint text={hint} /> : null}
      <CourtObjectionGuide kind={myRole} />
      <CourtAnswerRules kind={myRole} />
      {suggestions.length ? <CourtQuestionSuggestions items={suggestions} /> : null}
      <CourtPlayerPanelBase roomId={roomId} meId={meId} />
    </div>
  );
}

export function CourtTv({ roomId }: { roomId: string }) {
  const { state, left, standName } = useCourtChrome(roomId);
  return (
    <div className="flex flex-1 flex-col gap-[1.5vh]">
      {state.game === "court" || state.phase ? (
        <>
          <CourtPhaseBar phase={state.phase} leftSeconds={left} standName={standName} />
          <CourtStandBoard phase={state.phase} standId={state.stand} askingId={state.asking} cast={state.cast} />
        </>
      ) : null}
      <CourtTvBase roomId={roomId} />
    </div>
  );
}
