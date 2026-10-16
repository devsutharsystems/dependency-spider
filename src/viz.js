// Canvas drawing for the web-building animation. What happens (and when) is decided by choreo.js; this file draws it.
//
// Two stacked canvases, so a frame never repaints the whole web:
//   static layer (#web)  rings, threads and packages the spider has anchored. Only drawn when something is
//                        added (one thread + one dot per package) or removed (one batched redraw per cut).
//   live layer           the spider, the thread being laid, dew glints, snip flashes and falling packages. It is
//                        cleared with a dirty rectangle around those few things, not the full canvas.
// No shadowBlur, no filters: glows are pre-rendered sprites. devicePixelRatio is clamped to 2.
import { HUB, MAX_RING, WebLayout, Planner, PACE, toXY, lengthOf, pointAlong } from './choreo.js';

const GREEN = [61, 220, 151], AMBER = [255, 184, 77], RED = [255, 77, 94];
const lerp = (a, b, t) => a + (b - a) * t;
const mix = (c1, c2, t) => c1.map((v, i) => Math.round(lerp(v, c2[i], t)));

// fragility 0..1 -> green -> amber -> red
export function fragColor(f) {
  const c = f < 0.5 ? mix(GREEN, AMBER, f / 0.5) : mix(AMBER, RED, (f - 0.5) / 0.5);
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
const NB = 16; // colour buckets: the static redraw batches packages into one Path2D per bucket
const BUCKET_COLORS = Array.from({ length: NB }, (_, i) => fragColor(i / (NB - 1)));
const bucketOf = (f) => Math.max(0, Math.min(NB - 1, Math.round(f * (NB - 1))));
const radiusOf = (depth) => (depth <= 1 ? 3.2 : depth === 2 ? 2.6 : 2.1);

const EDGE = 'rgba(110,140,220,0.22)', CROSS = 'rgba(110,140,220,0.06)', THREAD = 'rgba(205,225,255,0.95)', RING = 'rgba(125,138,165,0.10)';
const TWO_PI = Math.PI * 2;

function glowSprite(color, size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, color); grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad; g.fillRect(0, 0, size, size);
  return c;
}

const angDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= TWO_PI; while (d < -Math.PI) d += TWO_PI; return d; };

export class Viz {
  constructor(canvas, { reducedMotion = false } = {}) {
    this.canvas = canvas; // static layer
    this.ctx = canvas.getContext('2d');
    this.live = document.createElement('canvas');
    this.live.setAttribute('aria-hidden', 'true');
    this.live.style.cssText = 'position:absolute;inset:0;display:block;pointer-events:none';
    canvas.after(this.live);
    this.lctx = this.live.getContext('2d');
    this.reduced = reducedMotion;
    this.glowBlue = glowSprite('rgba(120,170,255,0.55)', 64);
    this.glowRed = glowSprite('rgba(255,77,94,0.6)', 48);
    this.glowWhite = glowSprite('rgba(255,255,255,0.95)', 32);
    this.glints = Array.from({ length: 48 }, () => ({ x: 0, y: 0, t: -1 }));
    this.flashes = Array.from({ length: 8 }, () => ({ x: 0, y: 0, t: -1 }));
    this.stubs = Array.from({ length: 8 }, () => ({ ax: 0, ay: 0, bx: 0, by: 0, jx: 0, jy: 0, t: -1 }));
    this.falling = Array.from({ length: 600 }, () => ({ on: false, started: false, x: 0, y: 0, vy: 0, px: 0, py: 0, bucket: 0, r: 2, delay: 0, t: 0 }));
    this.out = { x: 0, y: 0, hx: 0, hy: 0 };
    this.recent = [];
    this.dirty = { x0: 0, y0: 0, x1: 0, y1: 0, on: false };
    this.gi = -1; this.fi = -1; this.si = -1;
    this.w = 0; this.h = 0; this.cx = 0; this.cy = 0; this.R = 0; this.geom = { cx: 0, cy: 0, R: 0 };
    this.reset();
    this.resize();
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
    this.frame = this.frame.bind(this);
    this.last = performance.now();
    this.running = true;
    requestAnimationFrame(this.frame);
    document.addEventListener('visibilitychange', () => { // no work at all in a hidden tab
      if (!document.hidden && !this.running) { this.running = true; this.last = performance.now(); requestAnimationFrame(this.frame); }
    });
  }

  reset() {
    this.sprites = new Map(); // name -> {name, depth, parent, deps, missing, bucket, angle, ring, x, y, laid, removed, ghost, cut, stillNeeded}
    this.laidList = [];
    this.layout = null; this.planner = null;
    this.hub = { x: this.cx, y: this.cy };
    this.dropTop = { x: this.cx, y: -30 };
    this.step = null; this.dropStarted = false; this.dropDone = false;
    this.deliveryDone = false; this.skipping = false; this.crossOn = false; this.pruning = false;
    this.at = HUB; // where the spider is resting
    this.spider = { x: this.cx, y: -30, heading: Math.PI / 2, phase: 0, moving: false };
    this.waiting = false;
    this.delivered = 0; this.laidCount = 0; this.recent.length = 0;
    for (const g of this.glints) g.t = -1;
    for (const f of this.flashes) f.t = -1;
    for (const s of this.stubs) s.t = -1;
    for (const f of this.falling) f.on = false;
    this.removedCount = 0; this.beforeCount = 0; this.hooks = null; this.focusName = null;
    this.staticDirty = false; this.lastStatic = 0;
    this.built = new Promise((r) => { this.resolveBuilt = r; });
    if (this.w) { this.redrawStatic(); this.clearLive(true); }
  }

  resize() {
    const r = this.canvas.parentElement.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = Math.max(200, r.width); this.h = Math.max(200, r.height);
    for (const c of [this.canvas, this.live]) {
      c.width = Math.round(this.w * dpr); c.height = Math.round(this.h * dpr);
      c.style.width = `${this.w}px`; c.style.height = `${this.h}px`;
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.lctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.cx = this.w / 2; this.cy = this.h / 2; this.R = Math.min(this.w, this.h) / 2 - 28;
    this.geom = { cx: this.cx, cy: this.cy, R: this.R };
    this.hub.x = this.cx; this.hub.y = this.cy; this.dropTop.x = this.cx; this.dropTop.y = -30; // mutated in place: steps hold these objects
    for (const s of this.sprites.values()) { const p = toXY(s.name, s.angle, s.ring, this.geom); s.x = p.x; s.y = p.y; }
    if (this.step) this.step.len = lengthOf(this.step.pts);
    if (!this.dropStarted) { this.spider.x = this.cx; this.spider.y = -30; }
    else if (!this.step) { const at = this.posOf(this.at); this.spider.x = at.x; this.spider.y = at.y; }
    this.redrawStatic();
    this.clearLive(true);
  }

  // ---- data in --------------------------------------------------------------------------------------------

  // Called when package.json is read: the spider starts its intro drop while the files are still being fetched.
  begin(rootNames) {
    this.layout = new WebLayout(rootNames);
    this.planner = new Planner((n) => this.posOf(n));
    this.dropStarted = true;
    if (this.reduced) { this.dropDone = true; this.spider.x = this.hub.x; this.spider.y = this.hub.y; this.redrawStatic(); return; }
    const pts = [this.dropTop, this.hub];
    this.step = { kind: 'drop', names: [HUB], pts, len: lengthOf(pts), dist: 0, speed: (this.hub.y + 30) / PACE.dropSeconds, pause: PACE.hubPause, state: 'travel', restLeft: 0 };
  }

  posOf(name) { return name === HUB ? this.hub : this.sprites.get(name); }

  // A package arrived from the registry crawl. The spider will get to it in its own time (or at once when skipping).
  addNode(node, frag = 0) {
    if (!this.layout) this.begin([]);
    const { angle, ring } = this.layout.place(node);
    const p = toXY(node.name, angle, ring, this.geom);
    this.sprites.set(node.name, { name: node.name, depth: node.depth, parent: node.parent, deps: node.deps || [], missing: !!node.missing, bucket: bucketOf(frag), angle, ring, x: p.x, y: p.y, laid: false, removed: false, ghost: false, cut: false, stillNeeded: null });
    this.planner.deliver(node);
    this.delivered++;
    if (this.reduced || this.skipping) this.drain();
  }

  finishDelivery() { this.deliveryDone = true; if (this.reduced || this.skipping) this.drain(); else this.checkBuilt(); }

  setFrag(name, frag) { const s = this.sprites.get(name); if (s) { const b = bucketOf(frag); if (b !== s.bucket) { s.bucket = b; this.staticDirty = true; } } }

  markGhosts(ghosts) { for (const g of ghosts) { const s = this.sprites.get(g.name); if (s) s.ghost = true; } }

  // Jump to the finished web (and, during the prune, to the end state).
  skip() { this.skipping = true; if (this.planner) this.drain(); }

  // Builds everything that is delivered, instantly (reduced motion, skip).
  drain() {
    if (!this.dropDone) { this.dropDone = true; this.step = null; this.spider.x = this.hub.x; this.spider.y = this.hub.y; }
    if (this.step && this.step.kind !== 'walk') { this.arrive(this.step); this.step = null; }
    if (!this.pruning) for (let s = this.planner.next(); s; s = this.planner.next()) { if (s.kind === 'lay') this.anchor(this.sprites.get(s.name), false); this.at = this.planner.cur; }
    const at = this.posOf(this.at);
    if (!this.step) { this.spider.x = at.x; this.spider.y = at.y; }
    this.checkBuilt();
  }

  checkBuilt() {
    if (this.deliveryDone && this.dropDone && !this.step && !this.crossOn && this.laidCount === this.delivered) {
      this.crossOn = true; this.staticDirty = true; this.waiting = false; this.resolveBuilt();
    }
  }

  // ---- static layer ---------------------------------------------------------------------------------------

  anchor(s, glint = true) {
    s.laid = true; this.laidList.push(s); this.laidCount++;
    const p = s.parent ? this.sprites.get(s.parent) : this.hub;
    const c = this.ctx;
    c.strokeStyle = EDGE; c.lineWidth = 1; c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(s.x, s.y); c.stroke();
    c.fillStyle = s.missing ? '#4a5470' : BUCKET_COLORS[s.bucket];
    c.beginPath(); c.arc(s.x, s.y, radiusOf(s.depth), 0, TWO_PI); c.fill();
    if (glint) { this.gi = (this.gi + 1) % this.glints.length; const g = this.glints[this.gi]; g.x = s.x; g.y = s.y; g.t = performance.now(); }
    this.recent.push({ name: s.name, color: BUCKET_COLORS[s.bucket] });
    if (this.recent.length > 8) this.recent.shift();
  }

  redrawStatic() {
    const c = this.ctx;
    c.clearRect(0, 0, this.w, this.h);
    c.lineWidth = 1; c.strokeStyle = RING;
    for (let d = 1; d <= MAX_RING; d++) { c.beginPath(); c.arc(this.cx, this.cy, (this.R * d) / MAX_RING, 0, TWO_PI); c.stroke(); }
    const tree = new Path2D(), cross = new Path2D(), red = new Path2D();
    const buckets = Array.from({ length: NB }, () => new Path2D());
    const live = (s) => s && s.laid && !s.removed;
    for (const s of this.laidList) {
      if (s.removed) continue;
      const p = s.parent ? this.sprites.get(s.parent) : this.hub;
      if (s.parent && !live(p)) continue;
      if (s.ghost && this.pruning) { if (!s.cut) { red.moveTo(p.x, p.y); red.lineTo(s.x, s.y); } }
      else { tree.moveTo(p.x, p.y); tree.lineTo(s.x, s.y); }
      if (this.crossOn) for (const d of s.deps) { const t = this.sprites.get(d); if (live(t) && t.parent !== s.name) { cross.moveTo(s.x, s.y); cross.lineTo(t.x, t.y); } }
      const b = buckets[s.missing ? 0 : s.bucket], r = radiusOf(s.depth);
      b.moveTo(s.x + r, s.y); b.arc(s.x, s.y, r, 0, TWO_PI);
    }
    c.strokeStyle = EDGE; c.stroke(tree);
    if (this.crossOn) { c.strokeStyle = CROSS; c.stroke(cross); }
    c.strokeStyle = 'rgba(255,77,94,0.8)'; c.lineWidth = 1.4; c.stroke(red); c.lineWidth = 1;
    for (let i = 0; i < NB; i++) { c.fillStyle = BUCKET_COLORS[i]; c.fill(buckets[i]); }
    for (const s of this.laidList) { // candidates (and the still-needed ones) are drawn on top of the batches
      if (s.removed || !(this.pruning && s.ghost)) continue;
      c.fillStyle = s.stillNeeded ? '#ffb84d' : '#ff4d5e'; c.beginPath(); c.arc(s.x, s.y, 3.6, 0, TWO_PI); c.fill();
      if (s.stillNeeded) { c.strokeStyle = 'rgba(255,184,77,0.9)'; c.lineWidth = 1.5; c.beginPath(); c.arc(s.x, s.y, 7, 0, TWO_PI); c.stroke(); c.lineWidth = 1; }
    }
    if (this.dropDone) this.drawHub();
    this.staticDirty = false; this.lastStatic = performance.now();
  }

  drawHub() {
    const c = this.ctx;
    c.fillStyle = '#f2f6ff'; c.beginPath(); c.arc(this.hub.x, this.hub.y, 4.5, 0, TWO_PI); c.fill();
    c.strokeStyle = 'rgba(160,190,255,0.5)'; c.lineWidth = 1; c.beginPath(); c.arc(this.hub.x, this.hub.y, 8, 0, TWO_PI); c.stroke();
  }

  // ---- the spider's moves ---------------------------------------------------------------------------------

  pullStep() {
    if (!this.dropDone || !this.planner) return null;
    const s = this.planner.next();
    if (!s) return null;
    const pts = s.names.map((n) => this.posOf(n));
    return { ...s, pts, len: lengthOf(pts), dist: 0, state: 'travel', restLeft: 0 };
  }

  arrive(st) { // the spider reached the end of its path
    if (st.kind === 'drop') { this.dropDone = true; this.at = HUB; this.drawHub(); }
    else if (st.kind === 'lay') { this.anchor(this.sprites.get(st.name)); this.at = st.name; }
    else this.at = st.names[st.names.length - 1];
  }

  // Walk existing threads (prune). Resolves when the spider is there.
  walk(names, speed = 1100) {
    if (this.reduced || this.skipping || names.length < 2) { this.at = names[names.length - 1]; const p = this.posOf(this.at); this.spider.x = p.x; this.spider.y = p.y; return Promise.resolve(); }
    const pts = names.map((n) => this.posOf(n));
    return new Promise((resolve) => { this.step = { kind: 'walk', names, pts, len: lengthOf(pts), dist: 0, speed, pause: 0.12, state: 'travel', restLeft: 0, resolve }; });
  }

  update(dt, now) {
    const sp = this.spider;
    let travelled = 0;
    let rem = dt;
    for (let guard = 0; rem > 0 && guard < 400; guard++) {
      if (!this.step) {
        if (this.pruning) break;
        this.step = this.pullStep();
        if (!this.step) break;
      }
      const st = this.step;
      if (st.state === 'travel') {
        const need = (st.len - st.dist) / st.speed;
        const use = Math.min(rem, need);
        st.dist += st.speed * use; travelled += st.speed * use; rem -= use;
        if (st.dist >= st.len - 1e-6) { st.dist = st.len; st.state = 'rest'; st.restLeft = st.pause; this.arrive(st); }
      } else {
        const use = Math.min(rem, st.restLeft);
        st.restLeft -= use; rem -= use;
        if (st.restLeft <= 1e-9) { this.step = null; if (st.resolve) st.resolve(); }
      }
    }
    if (this.step) {
      pointAlong(this.step.pts, this.step.dist, this.out);
      sp.x = this.out.x; sp.y = this.out.y;
      if (travelled > 0.01 && (this.out.hx || this.out.hy)) {
        const want = Math.atan2(this.out.hy, this.out.hx);
        const turn = 16 * dt; // limited turn rate (rad/s)
        const d = angDiff(sp.heading, want);
        sp.heading += Math.abs(d) <= turn ? d : Math.sign(d) * turn;
      }
    }
    sp.moving = travelled > 0.01;
    if (sp.moving) sp.phase += Math.min(travelled, 60) * 0.3;
    this.waiting = !this.step && !this.pruning && this.dropDone && !this.deliveryDone;
    if (!this.step && !this.pruning && this.dropDone) this.checkBuilt();
    for (const f of this.falling) { // packages that are falling away
      if (!f.on) continue;
      f.t += dt;
      if (f.t < f.delay) continue;
      if (!f.started) { f.started = true; this.removedCount++; this.hooks?.onCount?.(this.beforeCount - this.removedCount); }
      f.vy += 1100 * dt; f.y += f.vy * dt;
      if (f.t - f.delay > 1) f.on = false;
    }
    if (this.staticDirty && now - this.lastStatic > 250) this.redrawStatic();
  }

  // ---- live layer -----------------------------------------------------------------------------------------

  touch(x, y, pad) {
    const d = this.dirty;
    if (!d.on) { d.x0 = x - pad; d.y0 = y - pad; d.x1 = x + pad; d.y1 = y + pad; d.on = true; return; }
    if (x - pad < d.x0) d.x0 = x - pad;
    if (y - pad < d.y0) d.y0 = y - pad;
    if (x + pad > d.x1) d.x1 = x + pad;
    if (y + pad > d.y1) d.y1 = y + pad;
  }

  clearLive(all) {
    const d = this.dirty;
    if (all) this.lctx.clearRect(0, 0, this.w, this.h);
    else if (d.on) this.lctx.clearRect(d.x0, d.y0, d.x1 - d.x0, d.y1 - d.y0);
    d.on = false;
  }

  drawLive(now) {
    const c = this.lctx, sp = this.spider, st = this.step;
    this.clearLive(false);
    if (st && st.state === 'travel' && (st.kind === 'lay' || st.kind === 'drop')) { // the thread being laid: its tip IS the spider
      const a = st.pts[0];
      c.strokeStyle = THREAD; c.lineWidth = st.kind === 'drop' ? 1 : 1.4;
      c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(sp.x, sp.y); c.stroke();
      this.touch(a.x, a.y, 6); this.touch(sp.x, sp.y, 6);
    }
    for (const g of this.glints) { // dew glint where a thread was just anchored
      if (g.t < 0) continue;
      const k = (now - g.t) / 450;
      if (k >= 1) { g.t = -1; continue; }
      const r = 5 + k * 9;
      c.globalAlpha = 0.9 * (1 - k); c.drawImage(this.glowWhite, g.x - r, g.y - r, r * 2, r * 2); this.touch(g.x, g.y, 16);
    }
    c.globalAlpha = 1;
    if (this.pruning) this.drawPrune(c, now);
    this.drawSpider(c, now);
    if (this.focusName) this.drawLabel(c);
  }

  drawPrune(c, now) {
    const pulse = 0.5 + 0.5 * Math.sin(now / 260);
    for (const s of this.laidList) { // pulsing rings on candidates that are still attached
      if (!s.ghost || s.cut || s.removed) continue;
      c.drawImage(this.glowRed, s.x - 16, s.y - 16, 32, 32);
      c.strokeStyle = `rgba(255,77,94,${0.5 + 0.5 * pulse})`; c.lineWidth = 1.5;
      c.beginPath(); c.arc(s.x, s.y, 6 + pulse * 3, 0, TWO_PI); c.stroke(); this.touch(s.x, s.y, 20);
    }
    for (const f of this.flashes) {
      if (f.t < 0) continue;
      const k = (now - f.t) / 600;
      if (k >= 1) { f.t = -1; continue; }
      c.strokeStyle = `rgba(255,255,255,${1 - k})`; c.lineWidth = 2;
      c.beginPath(); c.arc(f.x, f.y, 4 + k * 22, 0, TWO_PI); c.stroke(); this.touch(f.x, f.y, 30);
    }
    for (const s of this.stubs) { // the two cut thread ends recoil away from the snip
      if (s.t < 0) continue;
      const k = (now - s.t) / 450;
      if (k >= 1) { s.t = -1; continue; }
      const e = 1 - (1 - k) * (1 - k);
      c.strokeStyle = `rgba(255,120,130,${1 - k})`; c.lineWidth = 1.4;
      c.beginPath();
      c.moveTo(s.jx, s.jy); c.lineTo(s.jx + (s.ax - s.jx) * (1 - e), s.jy + (s.ay - s.jy) * (1 - e)); // the piece still on the hub side
      c.moveTo(s.jx, s.jy); c.lineTo(s.jx + (s.bx - s.jx) * (1 - e), s.jy + (s.by - s.jy) * (1 - e)); // the piece on the branch side
      c.stroke(); this.touch(s.ax, s.ay, 8); this.touch(s.bx, s.by, 8);
    }
    for (const f of this.falling) { // packages that really shed: grey out, fall with gravity, fade
      if (!f.on || f.t < f.delay) continue;
      const k = f.t - f.delay;
      const a = Math.max(0, 1 - k), grey = Math.min(1, k / 0.25);
      c.strokeStyle = `rgba(110,140,220,${0.18 * a})`; c.lineWidth = 1;
      c.beginPath(); c.moveTo(f.px, f.py); c.lineTo(f.x, f.y); c.stroke();
      c.globalAlpha = a * (1 - grey); c.fillStyle = BUCKET_COLORS[f.bucket]; c.beginPath(); c.arc(f.x, f.y, f.r, 0, TWO_PI); c.fill();
      c.globalAlpha = a * grey; c.fillStyle = '#7d8aa5'; c.beginPath(); c.arc(f.x, f.y, f.r, 0, TWO_PI); c.fill();
      c.globalAlpha = 1; this.touch(f.x, f.y, 12); this.touch(f.px, f.py, 4);
    }
  }

  drawSpider(c, now) {
    const sp = this.spider;
    const x = sp.x, y = sp.y;
    let rot = sp.heading + Math.PI / 2, yy = y;
    if (this.waiting) { rot += Math.sin(now / 420) * 0.22; yy += Math.sin(now / 520) * 2; } // hangs and sways while npm answers
    c.drawImage(this.glowBlue, x - 22, yy - 22, 44, 44);
    c.save(); c.translate(x, yy); c.rotate(rot);
    c.strokeStyle = '#f2f6ff'; c.fillStyle = '#f2f6ff'; c.lineWidth = 1.1; c.lineCap = 'round';
    const wig = sp.moving ? Math.sin(sp.phase) : 0; // legs move only while the spider moves, in step with distance
    c.beginPath();
    for (let side = -1; side <= 1; side += 2) for (let i = 0; i < 4; i++) {
      const y0 = -3 + i * 2.4, spread = (i - 1.5) * 2.2 + (i % 2 ? wig : -wig) * 1.6;
      c.moveTo(0, y0); c.lineTo(side * 6, y0 - 4 + spread * 0.4); c.lineTo(side * 11, y0 + spread);
    }
    c.stroke();
    c.beginPath(); c.ellipse(0, 2, 3.2, 4.6, 0, 0, TWO_PI); c.fill();
    c.beginPath(); c.arc(0, -3.6, 2.2, 0, TWO_PI); c.fill();
    c.restore();
    this.touch(x, yy, 28);
  }

  drawLabel(c) {
    const s = this.sprites.get(this.focusName);
    if (!s) return;
    c.font = '600 11px ui-monospace, SFMono-Regular, Menlo, monospace';
    const text = s.stillNeeded ? `${s.name} (needed by ${s.stillNeeded})` : s.name;
    const tw = c.measureText(text).width;
    const x = Math.min(Math.max(s.x + 12, 6), this.w - tw - 6), y = Math.min(Math.max(s.y + 22, 14), this.h - 8);
    c.fillStyle = 'rgba(10,14,26,0.78)'; c.fillRect(x - 4, y - 11, tw + 8, 15);
    c.fillStyle = '#e2e8f5'; c.fillText(text, x, y);
    this.touch(x, y, tw + 14);
  }

  frame(now) {
    if (document.hidden) { this.running = false; return; }
    const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.update(dt, now);
    this.drawLive(now);
    requestAnimationFrame(this.frame);
  }

  // ---- prune ----------------------------------------------------------------------------------------------

  wait(ms) { return new Promise((r) => setTimeout(r, this.reduced || this.skipping ? 0 : ms)); }

  // report: shedReport() result. hooks: onGhost(name, state, info), onCount(n)
  async prune(report, hooks = {}) {
    this.pruning = true; this.hooks = hooks;
    this.beforeCount = report.before; this.removedCount = 0;
    hooks.onCount?.(report.before);
    this.redrawStatic(); // candidates get their red threads
    const removed = new Set();
    for (const g of report.perGhost) {
      const node = this.sprites.get(g.name);
      hooks.onGhost?.(g.name, 'cutting');
      if (node) {
        this.focusName = g.name;
        await this.walk(this.planner.treePath(this.at, node.parent || HUB), 1100); // along existing threads to the junction
        this.snip(node);
        await this.wait(380);
      }
      let list = [];
      if (!g.stillNeededBy) list = [...g.shedSet].filter((n) => report.combinedSet.has(n) && !removed.has(n));
      else if (node) { node.stillNeeded = g.stillNeededBy; this.redrawStatic(); }
      list.forEach((n) => removed.add(n));
      await this.wait(this.shed(list));
      hooks.onGhost?.(g.name, 'done', { removed: list.length });
    }
    const rest = [...report.combinedSet].filter((n) => !removed.has(n)); // these only go when several candidates go together
    if (rest.length) await this.wait(this.shed(rest));
    await this.walk(this.planner.treePath(this.at, HUB), 1100);
    this.removedCount = report.before - report.after; hooks.onCount?.(report.after);
    this.focusName = null;
    this.redrawStatic();
  }

  // The spider snips the thread at the parent: flash, and the two cut ends recoil.
  snip(node) {
    const p = node.parent ? this.sprites.get(node.parent) : this.hub;
    const len = Math.hypot(node.x - p.x, node.y - p.y) || 1;
    const k = Math.min(16, len / 2) / len;
    const jx = p.x + (node.x - p.x) * k, jy = p.y + (node.y - p.y) * k;
    const now = performance.now();
    this.fi = (this.fi + 1) % this.flashes.length;
    const f = this.flashes[this.fi]; f.x = jx; f.y = jy; f.t = now;
    this.si = (this.si + 1) % this.stubs.length;
    const s = this.stubs[this.si];
    s.jx = jx; s.jy = jy; s.ax = p.x; s.ay = p.y; s.bx = node.x; s.by = node.y; s.t = now;
    node.cut = true;
    this.redrawStatic(); // the thread is gone from the static layer; the recoiling ends live in the live layer
  }

  // Remove packages from the web and let them fall; returns how long the fall takes (ms).
  shed(names) {
    const list = names.map((n) => this.sprites.get(n)).filter((s) => s && s.laid && !s.removed).sort((a, b) => a.depth - b.depth);
    if (!list.length) return 0;
    const step = Math.min(0.035, 0.9 / list.length);
    list.forEach((s, i) => {
      s.removed = true;
      if (this.reduced || this.skipping) { this.removedCount++; return; }
      const f = this.falling[i % this.falling.length];
      const p = s.parent ? this.sprites.get(s.parent) : this.hub;
      f.on = true; f.started = false; f.x = s.x; f.y = s.y; f.vy = 0; f.px = p.x; f.py = p.y; f.bucket = s.missing ? 0 : s.bucket; f.r = radiusOf(s.depth); f.delay = i * step; f.t = 0;
    });
    if (this.reduced || this.skipping) this.hooks?.onCount?.(this.beforeCount - this.removedCount);
    this.redrawStatic();
    return (list.length * step + 1.05) * 1000;
  }

  // ---- numbers the page reads a few times a second ----------------------------------------------------------

  get stats() { return { laid: this.laidCount, delivered: this.delivered, waiting: this.waiting, recent: this.recent }; }

  // ---- share image ------------------------------------------------------------------------------------------

  // lines: {repo, headline, sub, items[]}. Returns a PNG Blob (1200x630).
  snapshot({ repo, headline, sub, items = [], note }) {
    const c = document.createElement('canvas');
    c.width = 1200; c.height = 630;
    const g = c.getContext('2d');
    g.fillStyle = '#0a0e1a'; g.fillRect(0, 0, 1200, 630);
    const sq = Math.min(this.canvas.width, this.canvas.height); // square crop around the centre of the web
    for (const layer of [this.canvas, this.live]) g.drawImage(layer, (layer.width - sq) / 2, (layer.height - sq) / 2, sq, sq, 20, 20, 590, 590);
    g.fillStyle = '#101524'; g.fillRect(640, 0, 560, 630);
    g.fillStyle = '#7d8aa5'; g.font = '600 22px ui-monospace, Menlo, monospace'; g.fillText('Dependency Spider', 680, 60);
    g.fillStyle = '#e2e8f5'; g.font = '700 28px ui-monospace, Menlo, monospace'; g.fillText(repo, 680, 110);
    g.fillStyle = '#3ddc97'; g.font = '700 76px system-ui, sans-serif'; g.fillText(headline, 680, 215);
    g.fillStyle = '#7d8aa5'; g.font = '24px system-ui, sans-serif'; g.fillText(sub, 680, 255);
    g.fillStyle = '#e2e8f5'; g.font = '20px ui-monospace, Menlo, monospace';
    let y = 320;
    for (const t of items.slice(0, 5)) {
      let line = '';
      for (const word of t.split(' ')) {
        if (g.measureText(`${line} ${word}`).width > 490 && line) { g.fillText(line, 680, y); y += 28; line = `  ${word}`; } else line = line ? `${line} ${word}` : word;
      }
      g.fillText(line, 680, y); y += 36;
    }
    if (items.length > 5) g.fillText(`+ ${items.length - 5} more`, 680, y);
    g.fillStyle = '#ffb84d'; g.font = '18px system-ui, sans-serif'; g.fillText(note, 680, 590);
    return new Promise((res) => c.toBlob(res, 'image/png'));
  }
}
