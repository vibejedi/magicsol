let ctx: AudioContext | null = null;
let muted = false;

export function setMuted(next: boolean) {
  muted = next;
}

export function unlockAudio() {
  const Ctx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return;
  if (!ctx) ctx = new Ctx();
  if (ctx.state === "suspended") void ctx.resume();
}

export function blip(kind: "play" | "hit" | "end" | "win" | "lose") {
  if (!ctx || ctx.state !== "running" || muted) return;
  const now = ctx.currentTime;
  const tone = {
    play: { freq: 520, dur: 0.07, type: "triangle" as const, gain: 0.035 },
    hit: { freq: 150, dur: 0.09, type: "square" as const, gain: 0.02 },
    end: { freq: 280, dur: 0.05, type: "sine" as const, gain: 0.03 },
    win: { freq: 660, dur: 0.2, type: "triangle" as const, gain: 0.04 },
    lose: { freq: 98, dur: 0.24, type: "sine" as const, gain: 0.045 },
  }[kind];
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = tone.type;
  osc.frequency.setValueAtTime(tone.freq, now);
  if (kind === "win") osc.frequency.exponentialRampToValueAtTime(880, now + tone.dur);
  gain.gain.setValueAtTime(tone.gain, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + tone.dur);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + tone.dur + 0.02);
  osc.onended = () => {
    osc.disconnect();
    gain.disconnect();
  };
}

export function watchAudio(): () => void {
  const onVis = () => {
    if (document.visibilityState === "visible") unlockAudio();
  };
  document.addEventListener("visibilitychange", onVis);
  return () => document.removeEventListener("visibilitychange", onVis);
}
