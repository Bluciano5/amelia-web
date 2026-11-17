// Avatar SVG animato (port di Avatar.kt): stesse forme e coordinate, in unità relative al centro.
const NS = 'http://www.w3.org/2000/svg';
const C = {
  skin: '#F4C9A8', skinShade: '#D99A78', hair: '#A8774A', hairShade: '#86592F', hairLight: '#C99A66',
  brow: '#6E4A2B', backdrop: '#F3E3D3', lip: '#B5524A', mouthIn: '#7A2E2B', rose: '#CE788A',
  roseDark: '#A85668', roseLight: '#E29CAA', softShade: '#EAB698', neckShadow: '#ECBA9A',
  coral: '#E07A5F', ink: '#22252B', navy: '#1F3A5F',
};
const BACK_CURLS = [[-14, -27, 10], [-3, -31, 11], [9, -29, 10], [20, -23, 9.5], [-23, -19, 9.5], [-27, -7, 9], [27, -10, 9],
  [-28, 5, 8.5], [28, 4, 8.5], [-26, 16, 8], [26, 16, 8], [-22, 25, 7], [22, 25, 7]];
const FRONT_CURLS = [[-18, -13, 5], [-12.5, -20, 6], [-4.5, -23, 6.5], [4, -22.5, 6.5], [12, -19.5, 6], [18, -13.5, 5]];

function el(name, attrs = {}, parent) {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}
const stroke = (color, w) => ({ fill: 'none', stroke: color, 'stroke-width': w, 'stroke-linecap': 'round' });

/** Arco d'ellisse in gradi, senso orario da +x (come drawArc di Compose). */
function arc(cx, cy, r, start, sweep) {
  const a0 = (start * Math.PI) / 180; const a1 = ((start + sweep) * Math.PI) / 180;
  const [x0, y0, x1, y1] = [cx + r * Math.cos(a0), cy + r * Math.sin(a0), cx + r * Math.cos(a1), cy + r * Math.sin(a1)];
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${sweep > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

function curl(parent, [dx, dy, r], seed) {
  const g = el('g', {}, parent);
  el('circle', { cx: dx, cy: dy, r, fill: C.hair }, g);
  const s = (seed * 47) % 360;
  el('path', { d: arc(dx, dy, r * 0.62, s, 210), ...stroke(C.hairLight, 0.9) }, g);
  el('path', { d: arc(dx, dy, r * 0.3, s + 180, 160), ...stroke(C.hairShade, 0.8) }, g);
  return { g, seed };
}

let uid = 0;
const approach = (cur, target, dt, speed = 8) => cur + (target - cur) * Math.min(1, dt * speed);

export class Avatar {
  constructor() {
    const id = `av${++uid}`;
    this.svg = el('svg', { viewBox: '0 0 100 100', class: 'avatar', role: 'img', 'aria-label': 'Avatar della tutor' });
    const defs = el('defs', {}, this.svg);
    el('circle', { cx: 50, cy: 50, r: 46 }, el('clipPath', { id }, defs));

    this.ring = el('circle', { cx: 50, cy: 50, r: 49.5, ...stroke(C.coral, 2.2), opacity: 0 }, this.svg);
    const clip = el('g', { 'clip-path': `url(#${id})` }, this.svg);
    el('circle', { cx: 50, cy: 50, r: 46, fill: C.backdrop }, clip);
    // Figura rimpicciolita e alzata per inquadrare anche il busto.
    const fig = el('g', { transform: 'translate(0 -9) translate(50 50) scale(0.84)' }, clip);

    // Capelli dietro + collo (oscillano con la testa)
    this.bobA = el('g', {}, fig);
    el('ellipse', { cx: 0, cy: -3, rx: 28, ry: 33, fill: C.hairShade }, this.bobA);
    this.curls = BACK_CURLS.map((c, i) => curl(this.bobA, c, i));
    el('rect', { x: -7, y: 12, width: 14, height: 20, fill: C.skinShade }, this.bobA);

    // Spalle, scollatura e canotta (ferme)
    el('path', { d: 'M-62 80 C-56 48 -48 30 -34 26 C-20 22.5 20 22.5 34 26 C48 30 56 48 62 80 Z', fill: C.skin }, fig);
    el('ellipse', { cx: 0, cy: 28.8, rx: 4.5, ry: 1.5, fill: C.neckShadow }, fig);
    el('polygon', { points: '-2.6,47.5 -1.2,44 0,41.5 1.2,44 2.6,47.5 0,53', fill: C.softShade }, fig);
    el('path', { d: 'M0.5 40.5 C-0.6 44.5 0.6 48 0 52.5', ...stroke(C.skinShade, 0.9) }, fig);
    for (const s of [-1, 1]) el('line', { x1: s * 17.5, y1: 43, x2: s * 19, y2: 23.5, ...stroke(C.rose, 1.6) }, fig);
    el('path', { d: 'M-62 80 C-60 62 -50 50 -23.5 46.5 C-16 41.5 -8 44 0 52.5 C8 44 16 41.5 23.5 46.5 C50 50 60 62 62 80 Z', fill: C.rose }, fig);
    for (const s of [-1, 1]) {
      el('path', { d: `M${s * 23.5} 46.5 C${s * 16} 41.5 ${s * 8} 44 0 52.5`, ...stroke(C.roseDark, 1.1) }, fig);
      el('path', { d: `M${s * 21} 50.5 C${s * 15} 47.5 ${s * 9} 49 ${s * 4} 53`, ...stroke(C.roseLight, 1) }, fig);
    }
    el('polygon', { points: '-1.4,53 0,60 1.4,53', fill: C.roseDark }, fig);

    // Viso (oscilla)
    this.bobB = el('g', {}, fig);
    el('ellipse', { cx: 0, cy: -1.5, rx: 20, ry: 23.5, fill: C.skin }, this.bobB);
    for (const s of [-1, 1]) el('circle', { cx: s * 20.5, cy: 7, r: 1.6, fill: C.coral }, this.bobB);
    this.curls.push(...FRONT_CURLS.map((c, i) => curl(this.bobB, c, i + 3)));
    this.cheeks = [-1, 1].map((s) => el('circle', { cx: s * 12, cy: 7, r: 3.6, fill: C.coral }, this.bobB));
    this.eyes = [-1, 1].map((s) => ({
      s,
      eye: el('ellipse', { cx: s * 8, cy: 0.5, rx: 2.3, ry: 2.6, fill: C.ink }, this.bobB),
      glint: el('circle', { cx: s * 8 + 0.9, cy: -1.2, r: 0.8, fill: '#fff' }, this.bobB),
      brow: el('line', { ...stroke(C.brow, 1.5) }, this.bobB),
    }));
    el('path', { d: 'M0.3 3 C-0.8 6 -1.6 7.5 1.2 8', ...stroke(C.skinShade, 0.9) }, this.bobB);
    this.smilePath = el('path', { ...stroke(C.lip, 1.4) }, this.bobB);
    this.mouthOpen = el('ellipse', { fill: C.mouthIn, stroke: C.lip, 'stroke-width': 0.9, opacity: 0 }, this.bobB);

    this.dots = [0, 1, 2].map((i) => el('circle', { cx: 80 + i * 6.5, cy: 14, r: 2.4, fill: C.navy, opacity: 0 }, this.svg));

    this.status = 'idle'; this.mood = 'neutral';
    this.v = { smile: 0.6, brow: 0, look: 0, ring: 0, talk: 0, blink: 1 };
    this.nextBlink = performance.now() + 2500; this.blinkStart = 0;
    this.last = performance.now(); this.t0 = this.last;
    this.frame = this.frame.bind(this);
    requestAnimationFrame(this.frame);
  }

  set(status, mood) { this.status = status; if (mood) this.mood = mood; }

  frame(now) {
    if (!this.svg.isConnected && now - this.t0 > 1000) return; // smontato: ferma il loop
    requestAnimationFrame(this.frame);
    if (document.hidden) return;
    const dt = Math.min(0.1, (now - this.last) / 1000); this.last = now;
    const t = (now - this.t0) / 1000; const v = this.v; const st = this.status;

    v.smile = approach(v.smile, { happy: 1, thoughtful: 0.2, neutral: 0.6 }[this.mood] ?? 0.6, dt, 4);
    v.brow = approach(v.brow, st === 'listening' ? 1 : this.mood === 'thoughtful' ? -0.5 : 0, dt);
    v.look = approach(v.look, st === 'thinking' ? 1 : 0, dt);
    v.ring = approach(v.ring, st === 'listening' ? 1 : 0, dt, 10);
    v.talk = approach(v.talk, st === 'speaking' ? 1 : 0, dt, 14);

    // Battito di ciglia
    if (now > this.nextBlink && !this.blinkStart) this.blinkStart = now;
    if (this.blinkStart) {
      const p = (now - this.blinkStart) / 180;
      v.blink = p < 0.4 ? 1 - (p / 0.4) * 0.92 : p < 1 ? 0.08 + ((p - 0.4) / 0.6) * 0.92 : 1;
      if (p >= 1) { this.blinkStart = 0; this.nextBlink = now + 2200 + Math.random() * 3000; }
    }

    const bob = Math.sin(t * 1.6) * 0.7 + (st === 'speaking' ? Math.sin(t * 3.1) * 0.6 : 0);
    const tr = `translate(0 ${bob.toFixed(2)})`;
    this.bobA.setAttribute('transform', tr); this.bobB.setAttribute('transform', tr);
    for (const c of this.curls) c.g.setAttribute('transform', `translate(${(Math.sin(t * 1.3 + c.seed) * 0.35).toFixed(2)} 0)`);

    this.ring.setAttribute('opacity', (0.35 * v.ring).toFixed(2));
    this.ring.setAttribute('r', (49.5 * (1 + 0.03 * Math.sin(t * 6))).toFixed(2));
    for (const c of this.cheeks) c.setAttribute('fill-opacity', (0.22 + 0.1 * v.smile).toFixed(2));

    const eyeY = 0.5 - v.look * 1.4;
    for (const { s, eye, glint, brow } of this.eyes) {
      eye.setAttribute('cy', eyeY.toFixed(2)); eye.setAttribute('ry', (2.6 * v.blink).toFixed(2));
      glint.setAttribute('cy', (-1.2 - v.look * 1.4).toFixed(2)); glint.setAttribute('opacity', v.blink > 0.5 ? 1 : 0);
      const baseY = 0.5 - 6.5 - Math.max(v.brow, 0) * 1.8; const lift = Math.max(-v.brow, 0) * 1.6;
      brow.setAttribute('x1', s * 11.5); brow.setAttribute('y1', (baseY + 0.6).toFixed(2));
      brow.setAttribute('x2', s * 4.5); brow.setAttribute('y2', (baseY - 0.4 - lift).toFixed(2));
    }

    const my = 13.5;
    const syll = Math.abs(Math.sin(t * 13)) * (0.55 + 0.45 * Math.abs(Math.sin(t * 4.7)));
    const open = v.talk * syll;
    if (open > 0.06) {
      const h = 1.2 + open * 5.5; const w = 7.5 - open * 1.5;
      this.mouthOpen.setAttribute('cx', 0); this.mouthOpen.setAttribute('cy', my + 0.5);
      this.mouthOpen.setAttribute('rx', (w / 2).toFixed(2)); this.mouthOpen.setAttribute('ry', (h / 2).toFixed(2));
      this.mouthOpen.setAttribute('opacity', 1); this.smilePath.setAttribute('opacity', 0);
    } else {
      const k = (my + v.smile * 4.5).toFixed(2);
      this.smilePath.setAttribute('d', `M-5.5 ${my} C-2.5 ${k} 2.5 ${k} 5.5 ${my}`);
      this.smilePath.setAttribute('opacity', 1); this.mouthOpen.setAttribute('opacity', 0);
    }

    this.dots.forEach((d, i) => d.setAttribute('opacity',
      st === 'thinking' ? (0.25 + 0.75 * ((Math.sin(t * 5 - i * 0.9) + 1) / 2)).toFixed(2) : 0));
  }
}
