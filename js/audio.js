// Audio: AudioContext condiviso (sbloccato da un gesto, requisito di iOS), registrazione push-to-talk
// in WAV 16 kHz mono (formato accettato da Gemini), riproduzione PCM del TTS e voce di sistema di riserva.
import { LANG } from './config.js';

let ctx = null;
export function audioContext() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  return ctx;
}

/** Da chiamare dentro un gesto dell'utente: sblocca Web Audio e speechSynthesis su iOS. */
export function unlockAudio() {
  const c = audioContext();
  if (c.state !== 'running') c.resume().catch(() => {});
  // Buffer muto: su iOS completa lo sblocco dell'output.
  const b = c.createBuffer(1, 1, 22050);
  const s = c.createBufferSource(); s.buffer = b; s.connect(c.destination); s.start(0);
  if ('speechSynthesis' in window && !unlockAudio.speechDone) {
    const u = new SpeechSynthesisUtterance(' '); u.volume = 0;
    try { speechSynthesis.speak(u); } catch { /* */ }
    unlockAudio.speechDone = true;
  }
}

// ---------------- registrazione ----------------
const TARGET_RATE = 16000;

export class Recorder {
  constructor() { this.active = false; }

  async start() {
    const c = audioContext();
    if (c.state !== 'running') await c.resume().catch(() => {});
    this.chunks = []; this.active = true; this.cancelled = false;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    if (!this.active) { this.release(); return; } // rilasciato prima che il microfono fosse pronto
    this.source = c.createMediaStreamSource(this.stream);
    // ScriptProcessor: deprecato ma supportato ovunque (Safari incluso) senza file worklet separato.
    this.proc = c.createScriptProcessor(4096, 1, 1);
    this.proc.onaudioprocess = (e) => { if (this.active) this.chunks.push(new Float32Array(e.inputBuffer.getChannelData(0))); };
    this.mute = c.createGain(); this.mute.gain.value = 0;
    this.source.connect(this.proc); this.proc.connect(this.mute); this.mute.connect(c.destination);
    this.startedAt = performance.now();
  }

  /** Ferma e ritorna { base64, seconds } del WAV, oppure null se troppo corto o annullato. */
  stop() {
    this.active = false;
    const rate = audioContext().sampleRate;
    const chunks = this.chunks || [];
    this.release();
    if (this.cancelled) return null;
    const len = chunks.reduce((n, c) => n + c.length, 0);
    const seconds = len / rate;
    if (seconds < 0.4) return null;
    const pcm = new Float32Array(len);
    let off = 0; for (const c of chunks) { pcm.set(c, off); off += c.length; }
    return { base64: wavBase64(downsample(pcm, rate, TARGET_RATE), TARGET_RATE), seconds };
  }

  cancel() { this.cancelled = true; this.active = false; this.release(); }

  release() {
    try { this.source?.disconnect(); this.proc?.disconnect(); this.mute?.disconnect(); } catch { /* */ }
    // Su iOS il microfono aperto abbassa il volume della riproduzione: si chiude dopo ogni frase.
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = this.source = this.proc = this.mute = null;
  }
}

function downsample(input, from, to) {
  if (from === to) return input;
  const ratio = from / to; const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio); const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0; for (let j = start; j < end; j++) sum += input[j];
    out[i] = sum / Math.max(1, end - start); // media = filtro passa-basso semplice
  }
  return out;
}

function wavBase64(samples, rate) {
  const buf = new ArrayBuffer(44 + samples.length * 2); const v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  const bytes = new Uint8Array(buf); let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// ---------------- riproduzione ----------------
export class PcmPlayer {
  constructor({ onStart, onEnd }) { this.onStart = onStart; this.onEnd = onEnd; this.src = null; }

  play(pcm, rate) {
    this.stop();
    const c = audioContext();
    const buf = c.createBuffer(1, pcm.length, rate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 0x8000;
    const src = c.createBufferSource(); src.buffer = buf; src.connect(c.destination);
    src.onended = () => { if (this.src === src) { this.src = null; this.onEnd(); } };
    this.src = src;
    if (c.state !== 'running') c.resume().catch(() => {});
    src.start();
    this.onStart();
  }

  stop() {
    const s = this.src; this.src = null;
    if (s) { try { s.stop(); } catch { /* già fermo */ } }
  }
}

// ---------------- voce di sistema (riserva) ----------------
const FEMALE_NAMES = ['audrey', 'amélie', 'amelie', 'marie', 'aurélie', 'aurelie', 'virginie', 'joëlle', 'joelle', 'julie', 'celine', 'céline', 'hortense', 'denise', 'female', 'femme'];

export function systemVoices() {
  if (!('speechSynthesis' in window)) return [];
  const rank = (v) => {
    const n = v.name.toLowerCase();
    const f = FEMALE_NAMES.findIndex((x) => n.includes(x));
    return (f >= 0 ? f : 50) + (v.lang.replace('_', '-') === LANG.bcp47 ? 0 : 20) + (/premium|enhanced|natural/i.test(v.name) ? -5 : 0);
  };
  return speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith(LANG.code)).sort((a, b) => rank(a) - rank(b));
}

export function speakSystem(text, { rate, voiceName, onStart, onEnd }) {
  if (!('speechSynthesis' in window)) { onEnd(); return; }
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const voices = systemVoices();
  u.voice = voices.find((v) => v.name === voiceName) || voices[0] || null;
  u.lang = u.voice?.lang || LANG.bcp47;
  u.rate = rate; u.pitch = 0.92;
  u.onstart = onStart; u.onend = onEnd; u.onerror = onEnd;
  speechSynthesis.speak(u);
}

export function stopSystem() { if ('speechSynthesis' in window) speechSynthesis.cancel(); }
