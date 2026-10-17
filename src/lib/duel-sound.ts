/*
 * Short tones from the Web Audio API for «منافسة العش», no audio files.
 * The context is created on the first tap (browsers block audio before a gesture).
 */

export type SoundKind = "tap" | "beep" | "go" | "win" | "lose" | "draw" | "foul" | "champion";

export const sound = (() => {
  let ctx: AudioContext | null = null;
  let on = true;

  function audio(): AudioContext | null {
    if (typeof window === "undefined" || !on) return null;
    try {
      if (!ctx) {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return null;
        ctx = new Ctor();
      }
      if (ctx.state === "suspended") void ctx.resume();
      return ctx;
    } catch {
      return null;
    }
  }

  /** One tone: frequency in Hz, start offset and length in seconds. */
  function tone(c: AudioContext, freq: number, at: number, len: number, type: OscillatorType = "sine", vol = 0.14) {
    const osc = c.createOscillator();
    const gain = c.createGain();
    const t0 = c.currentTime + at;
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + len);
    osc.connect(gain).connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + len + 0.02);
  }

  return {
    setOn(v: boolean) {
      on = v;
    },
    /** Call from a tap so later sounds are allowed. */
    unlock() {
      audio();
    },
    play(kind: SoundKind) {
      const c = audio();
      if (!c) return;
      try {
        switch (kind) {
          case "tap":
            tone(c, 660, 0, 0.04, "triangle", 0.08);
            break;
          case "beep":
            tone(c, 520, 0, 0.12, "square", 0.06);
            break;
          case "go":
            tone(c, 880, 0, 0.18, "square", 0.08);
            break;
          case "win":
            [523, 659, 784, 1047].forEach((f, i) => tone(c, f, i * 0.09, 0.16, "triangle"));
            break;
          case "lose":
            [392, 330, 262].forEach((f, i) => tone(c, f, i * 0.12, 0.2, "sine"));
            break;
          case "draw":
            [440, 440].forEach((f, i) => tone(c, f, i * 0.15, 0.12, "triangle"));
            break;
          case "foul":
            tone(c, 140, 0, 0.35, "sawtooth", 0.1);
            break;
          case "champion":
            [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => tone(c, f, i * 0.11, 0.22, "triangle"));
            break;
        }
      } catch {
        /* sound is a bonus: never break the game for it */
      }
    },
  };
})();
