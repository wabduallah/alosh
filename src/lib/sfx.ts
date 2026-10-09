const tones: Record<string, number[]> = {
  click: [520],
  countdown: [440],
  correct: [523, 659, 784],
  wrong: [220, 180],
  winner: [523, 659, 784, 1046],
  round: [392, 523],
  lobby: [330, 392],
  victory: [523, 659, 784, 880, 1046],
};

let ctx: AudioContext | null = null;
let lastLobby = 0;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) ctx = new AudioContext();
  return ctx;
}

export function unlockAudio() {
  const ac = audio();
  if (ac?.state === "suspended") void ac.resume();
}

export function playCue(name: string, url?: string) {
  if (typeof window !== "undefined" && localStorage.getItem("alosh-muted") === "1") return;
  if (url) {
    const node = new Audio(url);
    void node.play().catch(() => synth(name));
    return;
  }
  synth(name);
}

function synth(name: string) {
  const ac = audio();
  const steps = tones[name];
  if (!ac || !steps) return;
  const now = ac.currentTime;
  steps.forEach((freq, index) => {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = name === "wrong" ? "triangle" : "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.05, now + 0.02 + index * 0.08);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18 + index * 0.08);
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.start(now + index * 0.08);
    osc.stop(now + 0.22 + index * 0.08);
  });
}

export function lobbyPulse(on: boolean, url?: string) {
  if (!on) return;
  if (Date.now() - lastLobby < 7000) return;
  lastLobby = Date.now();
  playCue("lobby", url);
}
