// Little sound effects for the chest and Siam Si ceremonies, synthesized with Web Audio (no files to download).
// Off when the Sound switch in Settings is off. The audio context starts on the first tap that plays something.
const KEY = "gm-sound";
export const soundOn = () => { try { return localStorage.getItem(KEY) !== "off"; } catch { return true; } };
export const setSound = (on: boolean) => { try { localStorage.setItem(KEY, on ? "on" : "off"); } catch { /* this visit only */ } };

let ctx: AudioContext | null = null;
function audio(): AudioContext | null {
  if (!soundOn()) return null;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch { return null; }   // no Web Audio: stay silent
}
let noiseBuf: AudioBuffer | null = null;
const noise = (a: AudioContext) => {
  if (!noiseBuf) {
    noiseBuf = a.createBuffer(1, a.sampleRate, a.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
};

/** A short burst of filtered noise: a knock, a clack, a thud. */
function hit(a: AudioContext, at: number, freq: number, q: number, len: number, vol: number) {
  const src = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
  src.buffer = noise(a); f.type = "bandpass"; f.frequency.value = freq; f.Q.value = q;
  g.gain.setValueAtTime(vol, at); g.gain.exponentialRampToValueAtTime(0.001, at + len);
  src.connect(f).connect(g).connect(a.destination);
  src.start(at, Math.random() * 0.5, len + 0.02);
}
/** A pitched note with a quick attack and a ringing tail. */
function tone(a: AudioContext, at: number, freq: number, len: number, vol: number, type: OscillatorType = "triangle") {
  const o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(vol, at + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, at + len);
  o.connect(g).connect(a.destination);
  o.start(at); o.stop(at + len + 0.05);
}

/** Bamboo sticks rattling in the cup (Siam Si), or a heavy chest jostling: plays until the returned stop() is called. */
export function rattle(kind: "sticks" | "chest"): () => void {
  const a = audio();
  if (!a) return () => undefined;
  let t = a.currentTime, live = true;
  const step = () => {
    if (!live) return;
    while (t < a.currentTime + 0.3) {   // schedule a little ahead
      if (kind === "sticks") {
        for (let i = 0; i < 3; i++) hit(a, t + Math.random() * 0.04, 1800 + Math.random() * 1600, 6, 0.05, 0.35);
        t += 0.065 + Math.random() * 0.03;
      } else {
        hit(a, t, 180, 1.5, 0.12, 0.9); hit(a, t + 0.02, 700 + Math.random() * 300, 4, 0.08, 0.35);
        t += 0.125;
      }
    }
    timer = window.setTimeout(step, 100);
  };
  let timer = 0;
  step();
  return () => { live = false; clearTimeout(timer); };
}

/** One stick falls out and clacks on the floor, with a little bounce. */
export function stickDrop() {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + 0.25;
  [[0, 0.7], [0.14, 0.35], [0.24, 0.15]].forEach(([d, v]) => { hit(a, t + d, 2400, 8, 0.06, v); tone(a, t + d, 1150, 0.08, v * 0.25, "sine"); });
}

// pentatonic, a nod to Thai scales; higher rarities climb further
const SCALE = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.51];
/** The fortune card turns over: a whoosh, then a chime that grows with the rarity. */
export function reveal(rarity: "common" | "rare" | "epic" | "legendary") {
  const a = audio();
  if (!a) return;
  const t = a.currentTime;
  const sweep = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
  sweep.buffer = noise(a); f.type = "bandpass"; f.Q.value = 1.2;
  f.frequency.setValueAtTime(400, t); f.frequency.exponentialRampToValueAtTime(3000, t + 0.25);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.08); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
  sweep.connect(f).connect(g).connect(a.destination); sweep.start(t, 0, 0.35);
  const n = { common: 2, rare: 3, epic: 5, legendary: 8 }[rarity];
  for (let i = 0; i < n; i++) tone(a, t + 0.2 + i * 0.09, SCALE[i], 0.9, 0.18);
  if (rarity === "epic" || rarity === "legendary") for (let i = 0; i < 6; i++) tone(a, t + 0.7 + Math.random() * 0.6, 2000 + Math.random() * 2500, 0.3, 0.05, "sine");
  if (rarity === "legendary") { tone(a, t + 0.2, 98, 2.5, 0.35, "sine"); tone(a, t + 0.2, 147, 2.2, 0.12, "sine"); }   // a temple gong underneath
}

/** The chest bursts open: a lid thud, coins spilling out, a little fanfare. */
export function chestOpen() {
  const a = audio();
  if (!a) return;
  const t = a.currentTime;
  hit(a, t, 140, 1.2, 0.25, 1); tone(a, t, 70, 0.3, 0.4, "sine");
  for (let i = 0; i < 12; i++) {
    const at = t + 0.12 + i * 0.045 + Math.random() * 0.03, fq = 2600 + Math.random() * 1800;
    tone(a, at, fq, 0.18, 0.08, "sine"); tone(a, at, fq * 1.5, 0.12, 0.04, "sine");
  }
  [0, 2, 4, 5].forEach((s, i) => tone(a, t + 0.35 + i * 0.1, SCALE[s], i === 3 ? 1.1 : 0.4, 0.2));
}
