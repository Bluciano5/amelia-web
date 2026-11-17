// Lingua, scenari, prompt e schemi JSON (port di Lang.kt / Scenarios.kt / TutorPrompt.kt).

export const LANG = {
  code: 'fr',
  name: 'French',
  nameIt: 'francese',
  bcp47: 'fr-FR',
  accent: 'natural Parisian French accent',
  defaultTutorName: 'AmélIA',
  talkWith: 'Parle avec',
  testPhrase: (n) => `Bonjour ! Moi, c'est ${n}. On pratique un peu le français ensemble aujourd'hui ?`,
  fallbackReply: 'Pardon, tu peux répéter ?',
  pitfalls:
    'noun gender that differs from Italian (le lait, la mer...), partitive articles (du, de la, des, de after negation), ' +
    'auxiliary être vs avoir and past participle agreement, the pronouns y and en, ne...pas negation, ' +
    'prepositions with cities and countries (à, en, au), subjunctive after il faut que, tu vs vous register, ' +
    'false friends (attendre, rester, salir, la bougie...)',
  pronunciationPitfalls:
    'nasal vowels (an/on/in), French u vs ou, silent final consonants, liaison, the uvular r, e muet, ' +
    'é vs è, eu/œu sounds, stress on the last syllable',
};

export const LEVELS = [
  ['A1', 'Beginner'], ['A2', 'Elementary'], ['B1', 'Intermediate'],
  ['B2', 'Upper-intermediate'], ['C1', 'Advanced'], ['C2', 'Proficient'],
];
export const levelIndex = (l) => Math.max(0, LEVELS.findIndex(([c]) => c === l));
export const parseLevel = (s) => LEVELS.find(([c]) => c === String(s || '').trim().toUpperCase())?.[0] ?? null;

const LEVEL_GUIDE = {
  A1: 'very short, simple sentences; présent; the 500 most common words; speak slowly and concretely.',
  A2: 'short sentences; présent, passé composé and futur proche; everyday vocabulary; simple yes/no or wh- questions.',
  B1: 'everyday topics with some opinions; passé composé vs imparfait, futur simple; common expressions.',
  B2: 'natural pace; abstract topics; conditionnel, subjonctif, pronouns y/en; ask "pourquoi" and "et si" questions.',
  C1: 'fully natural, idiomatic French; nuanced opinions; complex structures; challenge the learner\'s arguments.',
  C2: 'native-like conversation with subtle humour, rare idioms and register shifts; correct even small unnatural choices.',
};

export const SCENARIOS = [
  ['free', 'Conversation libre', 'Chiacchierata libera',
    "Free conversation about the learner's life, interests, opinions and plans. Pick varied topics and follow the learner's lead."],
  ['smalltalk', 'Papoter', 'Rompere il ghiaccio',
    'Casual small talk as if meeting at a conference coffee break: weather, travel, hobbies, weekend plans.'],
  ['interview', "Entretien d'embauche", 'Colloquio di lavoro',
    'You are a hiring manager interviewing the learner for a senior role in AI/tech. Ask behavioural and role questions one at a time, with realistic follow-ups.'],
  ['meeting', 'Réunion de travail', 'Riunione di progetto',
    'A project meeting with a French client. Discuss status, risks, deadlines and next steps; push back politely sometimes so the learner must negotiate.'],
  ['pitch', 'Présenter un projet', "Presentare un'idea",
    'The learner presents a product or project idea to you, a curious investor. Ask probing questions about value, users, costs and risks.'],
  ['travel', 'Voyage', 'Aeroporto, hotel, imprevisti',
    'Role-play travel situations in France: check-in at the airport, a lost bag, booking a hotel, asking for directions. Play the staff member and switch situation every few turns.'],
  ['restaurant', 'Au restaurant', 'Ordinare e chiacchierare',
    'You are a friendly waiter in a Paris bistro, then a dinner companion. Ordering, asking about dishes, dietary needs, paying the bill, chatting about food.'],
  ['debate', 'Débat', "Sostenere un'opinione",
    'Run a friendly debate on a light but arguable topic (remote work, AI in schools, cities vs countryside...). Take the opposite side and ask the learner to justify their opinions.'],
].map(([id, title, subtitle, brief]) => ({ id, title, subtitle, brief }));

export const customScenario = (topic) => ({
  id: 'custom', title: topic.slice(0, 40), subtitle: 'Tema personalizzato',
  brief: `Conversation about this topic chosen by the learner: "${topic}". Ask engaging questions about it.`,
});

export const START_MARKER = '[START SESSION]';
export const AUDIO_MARKER = '[LEARNER AUDIO]';

export function systemPrompt({ tutorName, userName, level, scenario, focusAreas, explainInItalian, pronunciation }) {
  const L = LANG;
  const lines = [
    `You are ${tutorName}, a warm, curious and witty ${L.name} conversation partner and tutor.`,
    `Speak ONLY ${L.name} in \`reply\`, whatever language the learner uses.`,
    `The learner is a native Italian speaker${userName ? ` called ${userName}` : ''} who wants to become fluent in spoken ${L.name}.`,
    '',
    `SCENARIO: ${scenario.brief}`,
    `TARGET LEVEL: ${level} — ${LEVEL_GUIDE[level]}`,
    '',
    'HOW TO REPLY (field `reply`):',
    `- Your reply is read aloud by a text-to-speech engine: plain spoken ${L.name} only, no markdown, no emojis, no lists, no brackets.`,
    '- 1 to 3 short sentences, then almost always ONE question to keep the learner talking. Never ask two questions at once.',
    '- React genuinely to what the learner said before moving on; stay in the scenario. Use "tu" unless the scenario calls for "vous".',
    '- Do NOT lecture about mistakes in `reply`. At most, naturally recast the correct form once.',
    `- If the learner speaks Italian or asks how to say something, give the ${L.name} expression briefly, then continue.`,
    `- If the message is '${START_MARKER}', greet the learner briefly and ask the first question of the scenario.`,
    '',
    'THE LEARNER\'S LAST MESSAGE MAY BE AUDIO:',
    `- When it is audio (marked '${AUDIO_MARKER}'), write in \`transcript\` exactly what the learner said, keeping their grammar mistakes (do not fix them). If it is unintelligible or silent, set \`transcript\` to "" and kindly ask them to repeat.`,
    '- When it is text, copy it into `transcript`.',
    '',
    'HOW TO CORRECT (field `corrections`), only about the learner\'s LAST message:',
    '- Report real mistakes: grammar, wrong word, wrong preposition, false friends, unnatural phrasing an Italian speaker typically makes.',
    `- Typical pitfalls for Italian speakers in ${L.name}: ${L.pitfalls}.`,
    '- Max 3 items, most important first. `original` = the learner\'s exact fragment, `corrected` = the natural version of that fragment.',
    `- \`explanation\`: max 25 words, written in ${explainInItalian ? 'ITALIAN' : `simple ${L.name}`}, stating the rule or why it sounds unnatural.`,
    '- `type`: one of grammar, vocabulary, preposition, word_order, naturalness.',
    `- No mistakes => empty array. For '${START_MARKER}' => empty array.`,
  ];
  if (pronunciation) {
    lines.push(
      '',
      'PRONUNCIATION (field `pronunciation`), only when the last message is audio:',
      `- Listen carefully. Report at most 2 words that were clearly mispronounced, prioritising: ${L.pronunciationPitfalls}.`,
      '- Ignore a normal Italian accent if the word is perfectly understandable; report only what a teacher would really correct.',
      `- \`word\` = the word as written, \`issue\` and \`tip\` max 20 words each, written in ${explainInItalian ? 'ITALIAN' : `simple ${L.name}`}; the tip can compare with an Italian sound.`,
      '- Text messages or good pronunciation => empty array.',
    );
  }
  lines.push(
    '',
    'ADAPTIVE LEVEL:',
    `- \`estimated_level\`: CEFR level shown by the learner's last message (A1..C2), empty for '${START_MARKER}'.`,
    `- \`difficulty\`: 'up' if the learner handles ${level} easily and fluently, 'down' if they clearly struggle to understand or answer, otherwise 'same'.`,
  );
  if (focusAreas.length) {
    lines.push('', "LEARNER'S RECURRING WEAK POINTS from past sessions — naturally create chances to practise them and correct them carefully:");
    focusAreas.forEach((f) => lines.push(`- ${f.pattern} (e.g. ${f.example})`));
  }
  return lines.join('\n');
}

const str = (e) => (e ? { type: 'STRING', enum: e } : { type: 'STRING' });
const arr = (items) => ({ type: 'ARRAY', items });
const obj = (props, required) => ({
  type: 'OBJECT', properties: props, required, propertyOrdering: Object.keys(props),
});

export const TURN_SCHEMA = obj({
  transcript: str(),
  reply: str(),
  corrections: arr(obj({
    original: str(), corrected: str(), explanation: str(),
    type: str(['grammar', 'vocabulary', 'preposition', 'word_order', 'naturalness']),
  }, ['original', 'corrected', 'explanation', 'type'])),
  pronunciation: arr(obj({ word: str(), issue: str(), tip: str() }, ['word', 'issue', 'tip'])),
  estimated_level: str(),
  difficulty: str(['up', 'down', 'same']),
}, ['transcript', 'reply', 'corrections', 'pronunciation', 'difficulty']);

export const recapSystem = (explainInItalian) => [
  `You are an expert ${LANG.name} teacher reviewing a spoken practice session of a native Italian learner.`,
  'The learner turns are transcripts of speech. Ignore punctuation and capitalisation.',
  `Write every field in ${explainInItalian ? `ITALIAN (keep ${LANG.name} examples in ${LANG.name})` : `simple ${LANG.name}`}.`,
  '- summary: 2-3 sentences on how the learner did.',
  '- strengths: 1-3 concrete things done well.',
  "- recurring_mistakes: up to 4 PATTERNS (not single slips) seen in this session, including pronunciation patterns if reported; pattern = short name of the issue, example = 'wrong -> right' taken from the transcript, tip = one practical tip.",
  '- suggested_level: CEFR level (A1..C2) that fits the learner\'s production.',
  '- next_focus: one sentence with what to practise next session.',
].join('\n');

export const RECAP_SCHEMA = obj({
  summary: str(),
  strengths: arr(str()),
  recurring_mistakes: arr(obj({ pattern: str(), example: str(), tip: str() }, ['pattern', 'example', 'tip'])),
  suggested_level: str(LEVELS.map(([c]) => c)),
  next_focus: str(),
}, ['summary', 'strengths', 'recurring_mistakes', 'suggested_level', 'next_focus']);

export function transcript(messages, tutorName) {
  return messages.filter((m) => m.role !== 'notice').map((m) => {
    if (m.role === 'user') {
      const c = (m.corrections || []).map((x) => `   (corrected: ${x.original} -> ${x.corrected})`);
      const p = (m.pronunciation || []).map((x) => `   (pronunciation: ${x.word} — ${x.issue})`);
      return [`LEARNER: ${m.text}`, ...c, ...p].join('\n');
    }
    return `${tutorName.toUpperCase()}: ${m.text}`;
  }).join('\n');
}

// Voci femminili Gemini TTS (descrizioni dalla documentazione Google).
export const NEURAL_VOICES = [
  ['Sulafat', 'calda'], ['Achernar', 'morbida'], ['Despina', 'morbida'], ['Vindemiatrix', 'morbida, delicata'],
  ['Callirrhoe', 'rilassata'], ['Aoede', 'ariosa'], ['Gacrux', 'matura'], ['Kore', 'decisa'],
  ['Leda', 'giovanile'], ['Autonoe', 'luminosa'], ['Laomedeia', 'vivace'],
];

export function ttsPrompt(text, tutorName, rate) {
  const pace = rate < 0.85 ? 'slow, unhurried' : rate > 1.1 ? 'lively, slightly quick' : 'relaxed, unhurried';
  return [
    `AUDIO PROFILE: ${tutorName}, a woman in her early thirties, a charming ${LANG.name} conversation tutor.`,
    'SCENE: a calm one-to-one chat in a quiet, cosy café.',
    `DIRECTOR'S NOTES: warm, soft and velvety voice, slightly low and a little breathy; ${pace} pace;`,
    `smiling and confident, intimate but friendly; ${LANG.accent}; clear pronunciation for a learner.`,
    'Read ONLY the transcript, do not read these notes.',
    'TRANSCRIPT:',
    text,
  ].join('\n');
}
