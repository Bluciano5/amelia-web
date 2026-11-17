// AmélIA web: stato, flusso di conversazione e interfaccia (port di TutorViewModel.kt e delle schermate Compose).
import {
  LANG, LEVELS, levelIndex, parseLevel, SCENARIOS, customScenario, START_MARKER, AUDIO_MARKER,
  systemPrompt, TURN_SCHEMA, recapSystem, RECAP_SCHEMA, transcript, NEURAL_VOICES, ttsPrompt,
} from './js/config.js';
import { settings, setModel, sessions, diag, DEFAULT_MODEL } from './js/store.js';
import { generateJson, synthesizeSpeech, listChatModels, GeminiError, resetRouting } from './js/gemini.js';
import { Recorder, PcmPlayer, unlockAudio, speakSystem, stopSystem, systemVoices } from './js/audio.js';
import { Avatar } from './js/avatar.js';

const TURN_DEADLINE_MS = 45_000;
const AUDIO_TURN_DEADLINE_MS = 60_000;
const RECAP_DEADLINE_MS = 60_000;

const app = document.getElementById('app');
const dialogRoot = document.getElementById('dialog-root');
let nextId = 1;

const state = {
  screen: 'home', scenario: null, messages: [], status: 'idle', mood: 'neutral',
  error: null, canRetry: false, recap: null, recapLoading: false,
  level: settings.level, focusAreas: sessions.focusAreas(), models: [],
};

// ---------------------------------------------------------------- utilità
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (sel, root = app) => root.querySelector(sel);
const ICON = {
  back: '<svg viewBox="0 0 24 24"><path d="M20 11H7.8l5.6-5.6L12 4l-8 8 8 8 1.4-1.4L7.8 13H20z" fill="currentColor"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z" fill="currentColor"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><path d="M19.4 13a7.5 7.5 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.4 7.4 0 0 0-1.7-1L15 3.3h-4l-.4 2.6a7.4 7.4 0 0 0-1.7 1l-2.5-1-2 3.5L6.6 11a7.5 7.5 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1c.5.4 1.1.7 1.7 1l.4 2.6h4l.4-2.6c.6-.3 1.2-.6 1.7-1l2.5 1 2-3.5zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z" fill="currentColor" transform="translate(-1 0)"/></svg>',
  history: '<svg viewBox="0 0 24 24"><path d="M13 3a9 9 0 0 0-9 9H1l3.9 3.9L9 12H6a7 7 0 1 1 2 4.9l-1.4 1.4A9 9 0 1 0 13 3zm-1 5v5l4.3 2.5.7-1.2-3.5-2.1V8z" fill="currentColor"/></svg>',
  mic: '<svg viewBox="0 0 24 24"><path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5.3-3a5.3 5.3 0 0 1-10.6 0H5a7 7 0 0 0 6 6.9V21h2v-3.1a7 7 0 0 0 6-6.9z" fill="currentColor"/></svg>',
  send: '<svg viewBox="0 0 24 24"><path d="M2 21 23 12 2 3v7l15 2-15 2z" fill="currentColor"/></svg>',
  speaker: '<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z" fill="currentColor"/></svg>',
  retry: '<svg viewBox="0 0 24 24"><path d="M17.6 6.4A8 8 0 1 0 19.7 14h-2.1a6 6 0 1 1-1.4-6.2L13 11h7V4z" fill="currentColor"/></svg>',
};

function dialog({ title, text, actions }) {
  dialogRoot.innerHTML = `<div class="overlay"><div class="dialog" role="dialog" aria-modal="true">
    <h3>${esc(title)}</h3><p>${esc(text)}</p><div class="actions">
    ${actions.map((a, i) => `<button class="text-btn" data-i="${i}">${esc(a.label)}</button>`).join('')}
  </div></div></div>`;
  dialogRoot.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    dialogRoot.innerHTML = ''; actions[Number(b.dataset.i)].onClick?.();
  }));
}

const levelSelect = (level, compact = false) => `<select class="level-select" data-action="level" aria-label="Livello">
  ${LEVELS.map(([c, l]) => `<option value="${c}" ${c === level ? 'selected' : ''}>${compact ? c : `${c} · ${l}`}</option>`).join('')}</select>`;

function setLevel(l) {
  const v = parseLevel(l); if (!v) return;
  settings.level = v; settings.save(); state.level = v; levelTrend = 0;
}

// ---------------------------------------------------------------- navigazione
let avatar = null;
function go(screen) {
  if (screen === 'home' || screen === 'history') { state.focusAreas = sessions.focusAreas(); state.level = settings.level; }
  state.screen = screen; state.error = null;
  dialogRoot.innerHTML = '';
  render();
}

function render() {
  avatar = null;
  ({ home: renderHome, chat: renderChat, recap: renderRecap, settings: renderSettings, history: renderHistory })[state.screen]();
}

function mountAvatar(slot, status, mood) {
  const a = new Avatar(); a.set(status, mood); slot.replaceWith(a.svg); return a;
}

// ---------------------------------------------------------------- home
function renderHome() {
  const hasKey = !!settings.apiKey;
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  app.innerHTML = `<div class="screen">
    <div class="topbar">
      <div class="titles" style="padding-left:8px">
        <div style="font:600 28px/1.15 var(--serif)">${esc(LANG.defaultTutorName)}</div>
        <div class="s">la tua tutor di ${LANG.nameIt}</div>
      </div>
      <button class="icon-btn" data-action="history" aria-label="Storico">${ICON.history}</button>
      <button class="icon-btn" data-action="settings" aria-label="Impostazioni">${ICON.gear}</button>
    </div>
    <div class="scroll">
      <div class="card hero">
        <span class="avatar-slot"></span>
        <div>
          <h2>${esc(LANG.talkWith)} ${esc(settings.tutorName)}</h2>
          <div class="s">${settings.autoLevel ? 'Livello attuale (si adatta da solo)' : 'Livello attuale (fisso)'}</div>
          ${levelSelect(state.level)}
        </div>
      </div>
      ${isIos && !standalone ? `<div class="install-tip">Per usarla come un'app: tocca <b>Condividi</b> in Safari → <b>Aggiungi alla schermata Home</b>.</div>` : ''}
      ${!hasKey ? `<div class="banner"><div class="grow">Imposta la tua Gemini API key per iniziare.</div>
        <button class="text-btn" data-action="settings">Imposta</button></div>` : ''}
      ${state.focusAreas.length ? `<div class="section-title">Su cosa stai lavorando</div><div class="card">
        ${state.focusAreas.map((f) => `<div class="focus-item"><div class="t">${esc(f.pattern)}</div><div class="s">${esc(f.example)}</div></div>`).join('')}
      </div>` : ''}
      <div class="section-title">Scegli una situazione</div>
      <div class="scenarios">
        ${SCENARIOS.map((s) => `<button class="scenario" data-scenario="${s.id}" ${hasKey ? '' : 'disabled'}>
          <div class="t">${esc(s.title)}</div><div class="s">${esc(s.subtitle)}</div></button>`).join('')}
      </div>
      <div class="section-title">Oppure un tema tuo</div>
      <form class="row" data-form="custom">
        <input type="text" class="grow" name="topic" placeholder="es. il mio viaggio in Giappone" autocomplete="off">
        <button class="btn" ${hasKey ? '' : 'disabled'}>Inizia</button>
      </form>
    </div></div>`;
  avatar = mountAvatar($('.avatar-slot'), 'idle', 'happy');
  app.querySelectorAll('[data-scenario]').forEach((b) => b.addEventListener('click', () => {
    unlockAudio(); startSession(SCENARIOS.find((s) => s.id === b.dataset.scenario));
  }));
  $('[data-form=custom]').addEventListener('submit', (e) => {
    e.preventDefault();
    const topic = e.target.topic.value.trim();
    if (topic && settings.apiKey) { unlockAudio(); startSession(customScenario(topic)); }
  });
  $('[data-action=level]').addEventListener('change', (e) => setLevel(e.target.value));
  app.querySelectorAll('[data-action=settings]').forEach((b) => b.addEventListener('click', () => go('settings')));
  $('[data-action=history]').addEventListener('click', () => go('history'));
}

// ---------------------------------------------------------------- sessione
let requestCtrl = null;
let levelTrend = 0;

function startSession(scenario) {
  stopAudio();
  levelTrend = 0;
  Object.assign(state, {
    screen: 'chat', scenario, messages: [], recap: null, mood: 'neutral', error: null, canRetry: false,
    level: settings.level, focusAreas: sessions.focusAreas(), status: 'idle',
  });
  render();
  requestTurn();
}

function setStatus(status) { state.status = status; updateChat(); }

function buildContents() {
  const dialogMsgs = state.messages.filter((m) => m.role !== 'notice');
  let win = dialogMsgs.slice(-30);
  if (win.length < dialogMsgs.length) while (win.length && win[0].role === 'user') win = win.slice(1);
  const contents = [{ role: 'user', parts: [{ text: START_MARKER }] }];
  for (const m of win) {
    if (m.role === 'user' && m.audio) {
      contents.push({ role: 'user', parts: [{ text: AUDIO_MARKER }, { inlineData: { mimeType: 'audio/wav', data: m.audio } }] });
    } else {
      contents.push({ role: m.role === 'tutor' ? 'model' : 'user', parts: [{ text: m.text }] });
    }
  }
  return contents;
}

/** Esegue fn con un AbortController che scatta su "Annulla" o alla scadenza globale. */
async function withDeadline(ms, fn) {
  requestCtrl?.abort();
  const ctrl = new AbortController(); requestCtrl = ctrl;
  const timer = setTimeout(() => { ctrl.deadline = true; ctrl.abort(); }, ms);
  try {
    return await fn(ctrl.signal);
  } catch (e) {
    if (ctrl.deadline) {
      diag.log(`Timeout globale dopo ${ms / 1000}s`);
      throw new GeminiError(`Gemini non ha risposto entro ${ms / 1000} secondi. Riprova o scegli un altro modello nelle Impostazioni.`);
    }
    if (ctrl.signal.aborted) { const c = new Error('cancelled'); c.cancelled = true; throw c; }
    throw e;
  } finally {
    clearTimeout(timer);
    if (requestCtrl === ctrl) requestCtrl = null;
  }
}

async function requestTurn() {
  const scenario = state.scenario; if (!scenario) return;
  const hasAudio = state.messages.some((m) => m.role === 'user' && m.audio);
  state.error = null; state.canRetry = false; setStatus('thinking');
  try {
    const json = await withDeadline(hasAudio ? AUDIO_TURN_DEADLINE_MS : TURN_DEADLINE_MS, (signal) => generateJson({
      system: systemPrompt({
        tutorName: settings.spokenTutorName, userName: settings.userName, level: state.level, scenario,
        focusAreas: state.focusAreas, explainInItalian: settings.explainInItalian, pronunciation: settings.pronunciation,
      }),
      contents: buildContents(), schema: TURN_SCHEMA, temperature: 0.8,
    }, { signal, audio: hasAudio }));
    if (state.screen !== 'chat' || state.scenario !== scenario) return;
    applyTurn(json);
  } catch (e) {
    if (e.cancelled) return;
    state.status = 'idle'; state.error = e.message || 'Errore sconosciuto'; state.canRetry = true;
    updateChat();
  }
}

function applyTurn(json) {
  const corrections = (json.corrections || []).filter((c) => c.original?.trim() && c.original.trim().toLowerCase() !== (c.corrected || '').trim().toLowerCase());
  const pronunciation = settings.pronunciation ? (json.pronunciation || []).filter((p) => p.word?.trim()) : [];
  const reply = (json.reply || '').trim() || LANG.fallbackReply;
  const lastUser = [...state.messages].reverse().find((m) => m.role === 'user' && m.corrections == null);

  if (lastUser) {
    if (lastUser.audio) {
      const tr = (json.transcript || '').trim();
      lastUser.text = tr || '(audio non comprensibile)';
      lastUser.unclear = !tr;
      delete lastUser.audio; // non si rimanda l'audio nei turni successivi
    }
    lastUser.pending = false;
    lastUser.corrections = corrections; lastUser.pronunciation = pronunciation;
  }

  // Livello adattivo: cambio solo dopo 2 segnali consecutivi nella stessa direzione.
  if (settings.autoLevel && lastUser && !lastUser.unclear) {
    const d = json.difficulty;
    levelTrend = d === 'up' ? (levelTrend > 0 ? levelTrend + 1 : 1) : d === 'down' ? (levelTrend < 0 ? levelTrend - 1 : -1) : 0;
    const i = levelIndex(state.level);
    let ni = i;
    if (levelTrend >= 2 && i < LEVELS.length - 1) ni = i + 1;
    if (levelTrend <= -2 && i > 0) ni = i - 1;
    if (ni !== i) {
      const from = state.level; const to = LEVELS[ni][0];
      levelTrend = 0; settings.level = to; settings.save(); state.level = to;
      state.messages.push({ id: nextId++, role: 'notice', text: `Livello ${ni > i ? 'su' : 'giù'}: ${from} → ${to}` });
    }
  }

  state.messages.push({ id: nextId++, role: 'tutor', text: reply });
  state.mood = !lastUser || (!corrections.length && !pronunciation.length) ? 'happy' : 'thoughtful';
  state.status = 'idle';
  updateChat();
  say(reply);
}

function sendText(text) {
  const t = text.trim();
  if (!t || state.status === 'thinking') return;
  stopVoice();
  state.messages.push({ id: nextId++, role: 'user', text: t, corrections: null });
  requestTurn();
}

function cancelThinking() {
  if (state.status !== 'thinking') return;
  requestCtrl?.abort();
  diag.log("Richiesta annullata dall'utente");
  state.status = 'idle'; state.error = 'Richiesta annullata.'; state.canRetry = true;
  updateChat();
}

function retry() { state.error = null; state.canRetry = false; requestTurn(); }

// ---------------------------------------------------------------- microfono
const recorder = new Recorder();
let recording = false;

async function micDown() {
  if (state.status === 'thinking' || recording) return;
  unlockAudio();
  stopVoice();
  recording = true; state.error = null; setStatus('listening');
  try {
    await recorder.start();
  } catch (e) {
    recording = false; recorder.cancel();
    state.status = 'idle';
    state.error = e?.name === 'NotAllowedError'
      ? 'Permesso microfono negato: consentilo in Impostazioni iPhone → Safari → Microfono.'
      : `Microfono non disponibile (${e?.message || e}).`;
    updateChat();
  }
}

function micUp() {
  if (!recording) return;
  recording = false;
  const res = recorder.stop();
  state.status = 'idle';
  if (!res) { state.error = 'Non ho sentito nulla: tieni premuto il microfono mentre parli.'; updateChat(); return; }
  state.messages.push({ id: nextId++, role: 'user', text: `Messaggio vocale · ${res.seconds.toFixed(1)}s`, pending: true, audio: res.base64, corrections: null });
  requestTurn();
}

// ---------------------------------------------------------------- voce di AmélIA
const player = new PcmPlayer({
  onStart: () => setStatus('speaking'),
  onEnd: () => { if (state.status === 'speaking') setStatus('idle'); },
});
let voiceCtrl = null;
let neuralBlockedUntil = 0;
const audioCache = new Map();

function say(text) {
  stopVoice();
  const useNeural = settings.neuralVoice && settings.apiKey && Date.now() > neuralBlockedUntil;
  const system = () => speakSystem(text, {
    rate: settings.speechRate, voiceName: settings.systemVoice,
    onStart: () => setStatus('speaking'),
    onEnd: () => { if (state.status === 'speaking' || state.status === 'preparing') setStatus('idle'); },
  });
  if (!useNeural) { system(); return; }
  const key = `${settings.neuralVoiceName}|${settings.speechRate}|${text}`;
  const ctrl = new AbortController(); voiceCtrl = ctrl;
  if (state.status === 'idle') setStatus('preparing');
  (async () => {
    try {
      let audio = audioCache.get(key);
      if (!audio) {
        audio = await synthesizeSpeech(ttsPrompt(text, settings.spokenTutorName, settings.speechRate), settings.neuralVoiceName, { signal: ctrl.signal });
        audioCache.set(key, audio);
        if (audioCache.size > 12) audioCache.delete(audioCache.keys().next().value);
      }
      if (ctrl.signal.aborted) return;
      player.play(audio.pcm, audio.rate);
    } catch (e) {
      if (ctrl.signal.aborted) return;
      diag.log(`Voce neurale non disponibile (${String(e.message || e).split('\n')[0]}): uso la voce di sistema`);
      if (e instanceof GeminiError && [403, 404, 429].includes(e.code)) neuralBlockedUntil = Date.now() + 10 * 60_000;
      if (state.status === 'preparing') state.status = 'idle';
      system();
    } finally {
      if (voiceCtrl === ctrl) voiceCtrl = null;
    }
  })();
}

function stopVoice() {
  voiceCtrl?.abort(); voiceCtrl = null;
  player.stop(); stopSystem();
  if (state.status === 'speaking' || state.status === 'preparing') { state.status = 'idle'; if (state.screen === 'chat') updateChat(); }
}

function stopAudio() {
  if (recording) { recording = false; recorder.cancel(); }
  stopVoice();
  if (state.status === 'listening') state.status = 'idle';
}

// ---------------------------------------------------------------- chat
function renderChat() {
  const sc = state.scenario;
  app.innerHTML = `<div class="screen">
    <div class="topbar">
      <button class="icon-btn" data-action="close" aria-label="Chiudi">${ICON.close}</button>
      <div class="titles"><div class="t">${esc(sc.title)}</div><div class="s">${esc(sc.subtitle)}</div></div>
      ${levelSelect(state.level, true)}
      <button class="text-btn" data-action="end">Fine</button>
    </div>
    <div class="stage">
      <span class="avatar-slot"></span>
      <div class="status" data-ref="status"></div>
      <button class="text-btn" data-action="cancel" hidden>Annulla</button>
    </div>
    <div class="divider"></div>
    <div class="messages" data-ref="messages"></div>
    <div data-ref="error"></div>
    <div class="live" data-ref="live" hidden><span class="dot"></span><span>Sto registrando… rilascia per inviare</span></div>
    <div class="inputbar">
      <form class="field" data-form="text">
        <input type="text" name="msg" placeholder="…oppure scrivi" autocomplete="off" enterkeyhint="send">
        <button class="icon-btn send" aria-label="Invia" hidden>${ICON.send}</button>
      </form>
      <button class="mic" data-ref="mic" aria-label="Tieni premuto per parlare">${ICON.mic}</button>
    </div>
  </div>`;
  avatar = mountAvatar($('.avatar-slot'), state.status, state.mood);

  $('[data-action=close]').addEventListener('click', confirmEnd);
  $('[data-action=end]').addEventListener('click', endSession);
  $('[data-action=cancel]').addEventListener('click', cancelThinking);
  $('[data-action=level]').addEventListener('change', (e) => setLevel(e.target.value));
  const form = $('[data-form=text]'); const input = form.msg; const sendBtn = $('.send', form);
  input.addEventListener('input', () => { sendBtn.hidden = !input.value.trim(); });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (state.status === 'thinking') return;
    unlockAudio(); sendText(input.value); input.value = ''; sendBtn.hidden = true;
  });

  const mic = $('[data-ref=mic]');
  mic.addEventListener('pointerdown', (e) => { e.preventDefault(); mic.setPointerCapture?.(e.pointerId); micDown(); });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) mic.addEventListener(ev, () => micUp());
  mic.addEventListener('contextmenu', (e) => e.preventDefault());

  $('[data-ref=messages]').addEventListener('click', (e) => {
    const b = e.target.closest('[data-replay]'); if (!b) return;
    const m = state.messages.find((x) => x.id === Number(b.dataset.replay));
    if (m) { unlockAudio(); say(m.text); }
  });
  updateChat();
}

let renderedMsgKey = '';
function updateChat() {
  if (state.screen !== 'chat') return;
  const st = state.status; const name = settings.tutorName;
  avatar?.set(st, state.mood);
  $('[data-ref=status]').textContent = {
    listening: 'Ti ascolto…', thinking: `${name} sta pensando…`, preparing: `${name} sta per parlare…`,
    speaking: `${name} sta parlando · premi il microfono per interromperla`, idle: 'Tieni premuto il microfono per rispondere',
  }[st];
  $('[data-action=cancel]').hidden = st !== 'thinking';
  $('[data-ref=live]').hidden = st !== 'listening';
  const mic = $('[data-ref=mic]');
  mic.classList.toggle('listening', st === 'listening'); mic.classList.toggle('busy', st === 'thinking');
  $('[data-ref=error]').innerHTML = state.error ? `<div class="error-bar"><div class="grow">${esc(state.error)}</div>
    ${state.canRetry ? `<button class="icon-btn" data-action="retry" aria-label="Riprova">${ICON.retry}</button>` : ''}
    <button class="icon-btn" data-action="dismiss" aria-label="Chiudi errore">${ICON.close}</button></div>` : '';
  $('[data-action=retry]')?.addEventListener('click', retry);
  $('[data-action=dismiss]')?.addEventListener('click', () => { state.error = null; updateChat(); });

  const key = JSON.stringify([state.messages.map((m) => [m.id, m.text, m.pending, m.corrections?.length, m.pronunciation?.length]), st === 'thinking']);
  if (key === renderedMsgKey) return;
  renderedMsgKey = key;
  const box = $('[data-ref=messages]');
  box.innerHTML = state.messages.map(renderMessage).join('') + (st === 'thinking' ? '<div class="typing">…</div>' : '');
  box.scrollTop = box.scrollHeight;
}

function renderMessage(m) {
  if (m.role === 'notice') return `<div class="notice">${esc(m.text)}</div>`;
  if (m.role === 'tutor') {
    return `<div class="msg tutor"><div class="row"><div class="bubble selectable">${esc(m.text)}</div>
      <button class="replay" data-replay="${m.id}" aria-label="Riascolta">${ICON.speaker}</button></div></div>`;
  }
  const c = m.corrections; const p = m.pronunciation || [];
  let extra = '';
  if (c && !c.length && !p.length && !m.unclear) extra = '<div class="ok">✓ Perfetto</div>';
  if (c && c.length) {
    extra += `<div class="corrections">${c.map((x) => `<div><div class="o">${esc(x.original)}</div>
      <div class="c">→ ${esc(x.corrected)}</div><div class="e">${esc(x.explanation)}</div></div>`).join('')}</div>`;
  }
  if (p.length) {
    extra += `<div class="corrections pron"><div class="k">Pronuncia</div>${p.map((x) => `<div><div class="w">${esc(x.word)}</div>
      <div class="e">${esc(x.issue)}</div><div class="e"><b>Prova:</b> ${esc(x.tip)}</div></div>`).join('')}</div>`;
  }
  return `<div class="msg user"><div class="bubble selectable ${m.pending ? 'pending' : ''}">${esc(m.text)}</div>${extra}</div>`;
}

function confirmEnd() {
  dialog({
    title: 'Terminare la conversazione?',
    text: 'Puoi generare il riepilogo con gli errori ricorrenti oppure uscire senza salvare.',
    actions: [
      { label: 'Annulla' },
      { label: 'Esci senza salvare', onClick: () => { requestCtrl?.abort(); stopAudio(); state.status = 'idle'; go('home'); } },
      { label: 'Riepilogo', onClick: endSession },
    ],
  });
}

// ---------------------------------------------------------------- recap
async function endSession() {
  stopAudio(); requestCtrl?.abort();
  const msgs = state.messages.filter((m) => !(m.role === 'user' && m.pending));
  const userTurns = msgs.filter((m) => m.role === 'user').length;
  if (!userTurns) { state.status = 'idle'; go('home'); return; }
  Object.assign(state, { screen: 'recap', recapLoading: true, recap: null, error: null, status: 'idle' });
  render();
  try {
    const recap = await withDeadline(RECAP_DEADLINE_MS, (signal) => generateJson({
      system: recapSystem(settings.explainInItalian),
      contents: [{ role: 'user', parts: [{ text: transcript(msgs, settings.tutorName) }] }],
      schema: RECAP_SCHEMA, temperature: 0.3,
    }, { signal }));
    const suggested = parseLevel(recap.suggested_level);
    if (settings.autoLevel && suggested && suggested !== settings.level) { settings.level = suggested; settings.save(); }
    sessions.add({
      timestamp: Date.now(), scenario: state.scenario?.title || '', level: state.level, turns: userTurns,
      corrections: msgs.reduce((n, m) => n + (m.corrections?.length || 0) + (m.pronunciation?.length || 0), 0), recap,
    });
    Object.assign(state, { recap, recapLoading: false, level: settings.level });
  } catch (e) {
    if (e.cancelled) return;
    Object.assign(state, { recapLoading: false, error: `Riepilogo non generato: ${e.message}` });
  }
  if (state.screen === 'recap') render();
}

function recapHtml(r) {
  const lvl = parseLevel(r.suggested_level);
  return `<div class="recap-summary">${esc(r.summary)}</div>
    ${lvl ? `<p style="font-weight:600;color:var(--navy)">Livello stimato: ${lvl} · ${LEVELS[levelIndex(lvl)][1]}</p>` : ''}
    ${(r.strengths || []).length ? `<div class="section-title">Cosa è andato bene</div><div class="tint sage">
      ${r.strengths.map((s) => `<div>• ${esc(s)}</div>`).join('')}</div>` : ''}
    ${(r.recurring_mistakes || []).length ? `<div class="section-title">Errori ricorrenti</div>
      ${r.recurring_mistakes.map((m) => `<div class="tint coral"><div class="t">${esc(m.pattern)}</div>
      <div class="ex">${esc(m.example)}</div><div class="tip">${esc(m.tip)}</div></div>`).join('')}` : ''}
    ${r.next_focus ? `<div class="section-title">Prossima volta</div><div>${esc(r.next_focus)}</div>` : ''}`;
}

function renderRecap() {
  app.innerHTML = `<div class="screen">
    <div class="topbar"><button class="icon-btn" data-action="home" aria-label="Indietro">${ICON.back}</button><h1>Riepilogo</h1></div>
    ${state.recapLoading ? `<div class="center"><span class="avatar-slot"></span><div>Sto preparando il riepilogo…</div></div>`
      : state.recap ? `<div class="scroll">${recapHtml(state.recap)}
        <div style="height:20px"></div><button class="btn block" data-action="home">Torna alla home</button></div>`
      : `<div class="scroll"><p>${esc(state.error || 'Nessun riepilogo disponibile.')}</p>
        <div class="row"><button class="btn" data-action="retry-recap">Riprova</button>
        <button class="btn outline" data-action="home">Home</button></div></div>`}
  </div>`;
  const slot = $('.avatar-slot');
  if (slot) { avatar = mountAvatar(slot, 'thinking', 'neutral'); avatar.svg.style.width = '140px'; avatar.svg.style.height = '140px'; }
  app.querySelectorAll('[data-action=home]').forEach((b) => b.addEventListener('click', () => go('home')));
  $('[data-action=retry-recap]')?.addEventListener('click', endSession);
}

// ---------------------------------------------------------------- storico
function renderHistory() {
  const list = sessions.load();
  const fmt = new Intl.DateTimeFormat('it-IT', { dateStyle: 'medium', timeStyle: 'short' });
  app.innerHTML = `<div class="screen">
    <div class="topbar"><button class="icon-btn" data-action="home" aria-label="Indietro">${ICON.back}</button><h1>Storico</h1>
      ${list.length ? '<button class="text-btn" data-action="clear">Cancella</button>' : ''}</div>
    <div class="scroll">${list.length ? list.map((r, i) => `<button class="history-item" data-i="${i}">
      <div style="font-weight:600">${esc(r.scenario)}</div>
      <div class="s">${fmt.format(new Date(r.timestamp))} · ${esc(r.level)} · ${r.turns} risposte · ${r.corrections} correzioni</div>
      <div class="detail" hidden style="margin-top:10px">${recapHtml(r.recap || {})}</div></button>`).join('')
      : '<p style="color:var(--muted)">Nessuna sessione completata.</p>'}</div></div>`;
  $('[data-action=home]').addEventListener('click', () => go('home'));
  app.querySelectorAll('.history-item').forEach((b) => b.addEventListener('click', () => { const d = $('.detail', b); d.hidden = !d.hidden; }));
  $('[data-action=clear]')?.addEventListener('click', () => dialog({
    title: 'Cancellare lo storico?', text: 'Perderai anche gli errori ricorrenti usati per personalizzare le sessioni.',
    actions: [{ label: 'Annulla' }, { label: 'Cancella', onClick: () => { sessions.clear(); go('history'); } }],
  }));
}

// ---------------------------------------------------------------- impostazioni
function renderSettings() {
  const s = settings;
  const sw = (key, title, sub) => `<label class="switch-row"><div class="grow"><div class="t">${title}</div><div class="s">${sub}</div></div>
    <span class="switch"><input type="checkbox" data-key="${key}" ${s[key] ? 'checked' : ''}><span class="track"></span></span></label>`;
  app.innerHTML = `<div class="screen">
    <div class="topbar"><button class="icon-btn" data-action="home" aria-label="Indietro">${ICON.back}</button><h1>Impostazioni</h1></div>
    <div class="scroll">
      <div class="section-title">Gemini</div>
      <label class="field"><span>API key</span><input type="password" data-key="apiKey" value="${esc(s.apiKey)}" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
      <div class="hint">Creala gratis su aistudio.google.com → Get API key. Resta salvata solo su questo dispositivo.</div>
      <label class="field"><span>Modello</span><div class="row">
        <input type="text" class="grow" data-key="model" value="${esc(s.model)}" autocapitalize="off" spellcheck="false">
        <button class="btn outline" data-action="models" type="button">Scegli</button></div></label>
      <select data-action="pick-model" ${state.models.length ? '' : 'hidden'}>
        <option value="">— modelli disponibili —</option>${state.models.map((m) => `<option>${esc(m)}</option>`).join('')}</select>
      <div class="hint" data-ref="model-msg"></div>
      ${sw('fastMode', 'Risposte veloci', 'Riduce il "ragionamento" del modello per accorciare l\'attesa')}

      <div class="section-title">Tutor</div>
      <label class="field"><span>Nome della tutor</span><input type="text" data-key="tutorName" value="${esc(s.tutorName)}"></label>
      <label class="field"><span>Il tuo nome (facoltativo)</span><input type="text" data-key="userName" value="${esc(s.userName)}"></label>
      ${sw('explainInItalian', 'Spiegazioni in italiano', 'Le correzioni spiegano la regola in italiano')}
      ${sw('pronunciation', 'Feedback sulla pronuncia', 'Gemini ascolta la tua voce e segnala le parole pronunciate male')}

      <div class="section-title">Voce</div>
      ${sw('neuralVoice', 'Voce neurale Gemini', 'Molto più naturale; se non risponde si usa la voce di sistema')}
      <div class="row"><select class="grow" data-key="neuralVoiceName">
        ${NEURAL_VOICES.map(([n, d]) => `<option value="${n}" ${n === s.neuralVoiceName ? 'selected' : ''}>${n} · ${d}</option>`).join('')}
      </select><button class="text-btn" data-action="test-voice" type="button">Prova</button></div>
      <label class="field"><span>Voce di riserva (sistema)</span><div class="row"><select class="grow" data-key="systemVoice" data-ref="sysvoices"></select>
        <button class="text-btn" data-action="test-system" type="button">Prova</button></div></label>
      <div class="hint">Per voci di sistema migliori: Impostazioni iPhone → Accessibilità → Contenuto letto ad alta voce → Voci → Francese.</div>
      <label class="field"><span data-ref="rate-label">Velocità voce: ${s.speechRate.toFixed(2)}×</span>
        <input type="range" min="0.6" max="1.3" step="0.05" data-key="speechRate" value="${s.speechRate}"></label>

      <div class="section-title">Livello</div>
      ${levelSelect(state.level)}
      ${sw('autoLevel', 'Livello adattivo', 'Sale o scende in base a come rispondi')}

      <div class="section-title">Diagnostica</div>
      <div class="diag selectable" data-ref="diag">${esc(diag.dump())}</div>
      <div class="row"><button class="text-btn" data-action="diag-refresh" type="button">Aggiorna</button>
        <button class="text-btn" data-action="diag-copy" type="button">Copia</button></div>
      <div style="height:24px"></div>
    </div></div>`;

  const fillVoices = () => {
    const sel = $('[data-ref=sysvoices]'); if (!sel) return;
    const vs = systemVoices();
    sel.innerHTML = `<option value="">Automatica (femminile se disponibile)</option>` +
      vs.map((v) => `<option value="${esc(v.name)}" ${v.name === s.systemVoice ? 'selected' : ''}>${esc(v.name)} (${esc(v.lang)})</option>`).join('');
  };
  fillVoices();
  if ('speechSynthesis' in window) speechSynthesis.onvoiceschanged = fillVoices;

  app.querySelectorAll('[data-key]').forEach((input) => {
    const key = input.dataset.key;
    const evt = input.type === 'checkbox' || input.tagName === 'SELECT' ? 'change' : 'input';
    input.addEventListener(evt, () => {
      if (input.type === 'checkbox') s[key] = input.checked;
      else if (key === 'speechRate') { s[key] = Number(input.value); $('[data-ref=rate-label]').textContent = `Velocità voce: ${s[key].toFixed(2)}×`; }
      else if (key === 'model') return; // salvato al blur
      else s[key] = key === 'apiKey' ? input.value.trim() : input.value;
      if (key === 'tutorName' && !s.tutorName.trim()) return;
      s.save();
    });
  });
  const modelInput = $('[data-key=model]');
  modelInput.addEventListener('change', () => { setModel(modelInput.value); resetRouting(); modelInput.value = s.model; });
  $('[data-action=pick-model]').addEventListener('change', (e) => {
    if (!e.target.value) return;
    setModel(e.target.value); resetRouting(); modelInput.value = s.model;
  });
  $('[data-action=models]').addEventListener('click', async () => {
    const msg = $('[data-ref=model-msg]'); msg.textContent = 'Carico i modelli…';
    try { state.models = await listChatModels(); renderSettings(); $('[data-ref=model-msg]').textContent = `${state.models.length} modelli disponibili.`; }
    catch (e) { msg.textContent = e.message; }
  });
  $('[data-action=test-voice]').addEventListener('click', () => {
    unlockAudio(); neuralBlockedUntil = 0; say(LANG.testPhrase(s.spokenTutorName));
  });
  $('[data-action=test-system]').addEventListener('click', () => {
    unlockAudio(); stopVoice();
    speakSystem(LANG.testPhrase(s.spokenTutorName), { rate: s.speechRate, voiceName: s.systemVoice, onStart() {}, onEnd() {} });
  });
  $('[data-action=level]').addEventListener('change', (e) => setLevel(e.target.value));
  $('[data-action=diag-refresh]').addEventListener('click', () => { $('[data-ref=diag]').textContent = diag.dump(); });
  $('[data-action=diag-copy]').addEventListener('click', async (e) => {
    try { await navigator.clipboard.writeText(diag.dump()); e.target.textContent = 'Copiato ✓'; }
    catch { e.target.textContent = 'Seleziona e copia a mano'; }
  });
  $('[data-action=home]').addEventListener('click', () => {
    if (!s.tutorName.trim()) { s.tutorName = LANG.defaultTutorName; }
    if (!s.model.trim()) setModel(DEFAULT_MODEL);
    s.save(); stopVoice(); go('home');
  });
}

// ---------------------------------------------------------------- avvio
document.addEventListener('visibilitychange', () => { if (document.hidden) stopAudio(); });
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
render();
