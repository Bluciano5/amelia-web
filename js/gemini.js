// Client REST Gemini (port di GeminiClient.kt): output JSON strutturato, fallback tra modelli,
// pausa per i modelli sovraccarichi, variante "thinking" adattiva per modello, TTS neurale.
import { settings, diag } from './store.js';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const READ_TIMEOUT_MS = 15_000;
const AUDIO_TIMEOUT_MS = 25_000;   // upload audio su rete mobile
const TTS_TIMEOUT_MS = 30_000;
const MAX_MODELS_PER_REQUEST = 8;
const COOLDOWN_MS = 90_000;
const STICKY_MS = 10 * 60_000;
const NON_CHAT = ['computer-use', 'tts', 'image', 'live', 'embedding', 'audio', 'robotics', 'aqa', 'veo', 'imagen'];
const UNSTABLE = ['preview', 'exp', '-8b'];
const THINKING = ['BUDGET_ZERO', 'LEVEL_LOW', 'NONE'];

export class GeminiError extends Error {
  constructor(message, { code = -1, quotaZero = false, switchModel = false } = {}) {
    super(message);
    this.code = code; this.quotaZero = quotaZero; this.switchModel = switchModel;
  }
}

const cooldown = new Map();
const workingThinking = new Map();
let sticky = null; let stickyUntil = 0; let restored = false;
let cachedFallbacks = null;
let ttsModel = 'gemini-3.1-flash-tts-preview';

export function resetRouting() { sticky = null; stickyUntil = 0; cooldown.clear(); restored = true; }
const isCooling = (m) => (cooldown.get(m) || 0) > Date.now();

function friendlyError(code, body, model) {
  let apiMsg = '';
  try { apiMsg = JSON.parse(body)?.error?.message || ''; } catch { /* corpo non JSON */ }
  const quotaZero = code === 429 && body.includes('limit: 0');
  let msg;
  switch (code) {
    case 400: msg = /api key/i.test(apiMsg) ? 'API key non valida.' : 'Richiesta non valida.'; break;
    case 401: case 403: msg = 'API key non valida o senza permessi.'; break;
    case 404: msg = `Modello "${model}" non trovato: scegline un altro nelle Impostazioni.`; break;
    case 429: msg = quotaZero
      ? `Il modello "${model}" non è incluso nel piano gratuito. Impostazioni → Modello → scegli un modello Flash.`
      : `Limite di richieste raggiunto per "${model}": aspetta un minuto o scegli un altro modello.`; break;
    case 500: case 503: msg = 'Gemini è sovraccarico in questo momento: riprova tra qualche secondo.'; break;
    default: msg = `Errore Gemini (${code}).`;
  }
  if (code !== 429 && code < 500 && apiMsg) msg += `\n${apiMsg.slice(0, 200)}`;
  return new GeminiError(msg, { code, quotaZero, switchModel: code === 404 || code === 429 || code >= 500 });
}

/** POST con timeout e annullamento (signal esterno: tasto Annulla o scadenza globale). */
async function post(model, body, { signal, timeoutMs = READ_TIMEOUT_MS } = {}) {
  const variant = JSON.stringify(body.generationConfig?.thinkingConfig || 'no-thinking-cfg');
  const started = performance.now();
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort(signal.reason);
  signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => ctrl.abort(new DOMException('timeout', 'TimeoutError')), timeoutMs);
  let res; let text;
  try {
    res = await fetch(`${BASE}/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': settings.apiKey },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    text = await res.text();
  } catch (e) {
    const ms = Math.round(performance.now() - started);
    if (signal?.aborted) { diag.log(`${model} [${variant}] -> annullata dopo ${ms} ms`); throw e; }
    if (ctrl.signal.aborted) {
      diag.log(`${model} [${variant}] -> timeout dopo ${ms} ms`);
      throw new GeminiError('Timeout: Gemini non ha risposto in tempo.', { switchModel: true });
    }
    diag.log(`${model} [${variant}] -> errore di rete dopo ${ms} ms`);
    throw new GeminiError(`Errore di rete: ${e.message || 'connessione assente'}`);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
  const ms = Math.round(performance.now() - started);
  let apiMsg = '';
  if (!res.ok) { try { apiMsg = JSON.parse(text)?.error?.message || ''; } catch { /* */ } }
  diag.log(`${model} [${variant}] -> HTTP ${res.status} in ${ms} ms${apiMsg ? ` · ${apiMsg.slice(0, 160)}` : ''}`);
  if (!res.ok) throw friendlyError(res.status, text, model);
  return text;
}

function parseJsonResponse(raw) {
  const root = JSON.parse(raw);
  const cand = root.candidates?.[0];
  if (!cand) {
    const block = root.promptFeedback?.blockReason;
    throw new GeminiError(`Risposta vuota${block ? ` (bloccata: ${block})` : ''}`);
  }
  const text = (cand.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join('')
    .trim().replace(/^```(json)?/, '').replace(/```$/, '').trim();
  if (!text) throw new GeminiError(`Risposta vuota (finishReason: ${cand.finishReason})`);
  try { return JSON.parse(text); } catch { throw new GeminiError('JSON non valido dal modello'); }
}

function buildBody({ system, contents, schema, temperature }, thinking) {
  const generationConfig = { temperature, responseMimeType: 'application/json', responseSchema: schema };
  if (thinking === 'BUDGET_ZERO') generationConfig.thinkingConfig = { thinkingBudget: 0 };
  if (thinking === 'LEVEL_LOW') generationConfig.thinkingConfig = { thinkingLevel: 'low' };
  return { systemInstruction: { parts: [{ text: system }] }, contents, generationConfig };
}

/** Prova le varianti "thinking" (ogni famiglia di modelli ne accetta una diversa) e ricorda quella valida. */
async function generateWith(model, req, signal, timeoutMs) {
  const preferred = model.includes('lite') && !model.startsWith('gemini-2')
    ? ['LEVEL_LOW', 'BUDGET_ZERO', 'NONE'] : THINKING;
  const variants = !settings.fastMode ? ['NONE'] : workingThinking.has(model) ? [workingThinking.get(model)] : preferred;
  let last;
  for (const v of variants) {
    try {
      const raw = await post(model, buildBody(req, v), { signal, timeoutMs });
      if (settings.fastMode) workingThinking.set(model, v);
      return parseJsonResponse(raw);
    } catch (e) {
      if (!(e instanceof GeminiError) || e.code !== 400 || v === 'NONE') throw e;
      last = e;
    }
  }
  throw last || new GeminiError('Richiesta non valida.');
}

export async function listModels() {
  const res = await fetch(`${BASE}/models?pageSize=200`, { headers: { 'x-goog-api-key': settings.apiKey } });
  const text = await res.text();
  if (!res.ok) throw friendlyError(res.status, text, '');
  return (JSON.parse(text).models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => m.name.replace(/^models\//, ''));
}

export async function listChatModels() {
  return (await listModels())
    .filter((m) => m.startsWith('gemini') && !NON_CHAT.some((x) => m.includes(x)))
    .sort((a, b) => (a.includes('flash') ? 0 : 1) - (b.includes('flash') ? 0 : 1) || b.localeCompare(a));
}

async function fallbackModels() {
  if (!cachedFallbacks) {
    try {
      const l = (await listChatModels()).filter((m) => m.includes('flash') && !UNSTABLE.some((u) => m.includes(u)));
      if (l.length) cachedFallbacks = l;
    } catch { /* lista non disponibile */ }
  }
  return [...new Set(['gemini-flash-latest', 'gemini-flash-lite-latest', ...(cachedFallbacks || [])])]
    .filter((m) => m !== settings.model);
}

/**
 * Generazione JSON con fallback: modello scelto (o l'ultimo che ha funzionato), poi modelli di riserva.
 * I modelli falliti per sovraccarico/quota/timeout restano in pausa e vanno in fondo alla coda.
 */
export async function generateJson(req, { signal, audio = false } = {}) {
  if (!settings.apiKey) throw new GeminiError('API key mancante: impostala nelle Impostazioni.');
  const model = settings.model;
  if (!restored && settings.lastGoodModel && settings.lastGoodModel !== model) {
    restored = true; sticky = settings.lastGoodModel; stickyUntil = Date.now() + STICKY_MS;
  }
  const st = sticky && Date.now() < stickyUntil && sticky !== model ? sticky : null;
  const base = [st, model].filter(Boolean);
  let loaded = base.some(isCooling);
  const all = [...new Set([...base, ...(loaded ? await fallbackModels() : [])])];
  const candidates = [...all.filter((m) => !isCooling(m)), ...all.filter(isCooling).sort((a, b) => cooldown.get(a) - cooldown.get(b))];
  const timeoutMs = audio ? AUDIO_TIMEOUT_MS : READ_TIMEOUT_MS;

  let last;
  for (let i = 0; i < candidates.length && i < MAX_MODELS_PER_REQUEST; i++) {
    const m = candidates[i];
    try {
      const out = await generateWith(m, req, signal, timeoutMs);
      diag.log(`OK con ${m}`);
      cooldown.delete(m);
      if (m !== model) { sticky = m; stickyUntil = Date.now() + STICKY_MS; } else sticky = null;
      if (settings.lastGoodModel !== m) { settings.lastGoodModel = m; settings.save(); }
      return out;
    } catch (e) {
      if (signal?.aborted) throw e;
      last = e;
      if (!(e instanceof GeminiError) || !e.switchModel) throw e;
      cooldown.set(m, Date.now() + (e.quotaZero ? 6 * 3600_000 : COOLDOWN_MS));
      if (!loaded) {
        loaded = true;
        for (const f of await fallbackModels()) if (!candidates.includes(f) && !isCooling(f)) candidates.push(f);
      }
    }
  }
  throw last || new GeminiError('Nessun modello disponibile.');
}

/** Sintesi vocale neurale: ritorna PCM 16 bit mono (Int16Array) e sample rate. */
export async function synthesizeSpeech(prompt, voice, { signal } = {}) {
  if (!settings.apiKey) throw new GeminiError('API key mancante.');
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
    },
  };
  let raw;
  try {
    raw = await post(ttsModel, body, { signal, timeoutMs: TTS_TIMEOUT_MS });
  } catch (e) {
    if (!(e instanceof GeminiError)) throw e;
    if (e.code === 500) raw = await post(ttsModel, body, { signal, timeoutMs: TTS_TIMEOUT_MS });
    else if (e.code === 404) {
      const alt = (await listModels().catch(() => [])).filter((m) => m.includes('tts') && m !== ttsModel).sort().reverse()[0];
      if (!alt) throw e;
      ttsModel = alt;
      raw = await post(ttsModel, body, { signal, timeoutMs: TTS_TIMEOUT_MS });
    } else throw e;
  }
  const parts = JSON.parse(raw).candidates?.[0]?.content?.parts || [];
  const audio = parts.find((p) => p.inlineData)?.inlineData;
  if (!audio) throw new GeminiError('Nessun audio nella risposta TTS.');
  const bin = atob(audio.data);
  const bytes = new Uint8Array(bin.length - (bin.length % 2));
  for (let i = 0; i < bytes.length; i++) bytes[i] = bin.charCodeAt(i);
  const rate = Number(/rate=(\d+)/.exec(audio.mimeType || '')?.[1]) || 24000;
  return { pcm: new Int16Array(bytes.buffer), rate };
}
