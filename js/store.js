// Impostazioni, storico sessioni e registro diagnostico. localStorage con accessi protetti:
// in modalità privata o con dati bloccati si continua a funzionare in memoria.
import { LANG, parseLevel } from './config.js';

const memory = new Map();
function read(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v == null ? (memory.has(key) ? memory.get(key) : fallback) : JSON.parse(v);
  } catch { return memory.has(key) ? memory.get(key) : fallback; }
}
function write(key, value) {
  memory.set(key, value);
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* solo memoria */ }
}

export const DEFAULT_MODEL = 'gemini-flash-latest';
const DEFAULTS = {
  apiKey: '',
  model: DEFAULT_MODEL,
  fastMode: true,
  tutorName: LANG.defaultTutorName,
  userName: '',
  neuralVoice: true,
  neuralVoiceName: 'Sulafat',
  systemVoice: '',
  speechRate: 0.95,
  explainInItalian: true,
  pronunciation: true,
  level: 'B1',
  autoLevel: true,
  lastGoodModel: '',
};

export const settings = {
  ...DEFAULTS,
  ...read('settings', {}),
  save() {
    const { save, spokenTutorName, ...plain } = this; // eslint-disable-line no-unused-vars
    write('settings', plain);
  },
  get spokenTutorName() {
    // "AmélIA" -> "Amélia": il TTS non lo legge come sigla.
    const n = this.tutorName.toLowerCase();
    return n.charAt(0).toUpperCase() + n.slice(1);
  },
};
settings.level = parseLevel(settings.level) || 'B1';
settings.tutorName = settings.tutorName?.trim() || LANG.defaultTutorName;

export function setModel(m) {
  const v = (m || '').trim() || DEFAULT_MODEL;
  if (v !== settings.model) {
    settings.model = v;
    settings.lastGoodModel = ''; // scelta esplicita: si dimentica il fallback memorizzato
  }
  settings.save();
}

const MAX_SESSIONS = 200;
export const sessions = {
  load() {
    const list = read('sessions', []);
    return Array.isArray(list) ? list.sort((a, b) => b.timestamp - a.timestamp) : [];
  },
  add(rec) { write('sessions', [rec, ...this.load()].slice(0, MAX_SESSIONS)); },
  clear() { write('sessions', []); },
  /** Errori ricorrenti delle ultime sessioni, deduplicati per pattern. */
  focusAreas(n = 5, limit = 5) {
    const groups = new Map();
    for (const s of this.load().slice(0, n)) {
      for (const m of s.recap?.recurring_mistakes || []) {
        const k = (m.pattern || '').trim().toLowerCase();
        if (!k) continue;
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(m);
      }
    }
    return [...groups.values()].sort((a, b) => b.length - a.length).map((g) => g[0]).slice(0, limit);
  },
};

const diagLines = [];
export const diag = {
  log(line) {
    const t = new Date().toLocaleTimeString('it-IT', { hour12: false });
    diagLines.push(`${t}  ${line}`);
    if (diagLines.length > 80) diagLines.shift();
  },
  dump: () => diagLines.join('\n') || 'Nessun tentativo registrato.',
};
