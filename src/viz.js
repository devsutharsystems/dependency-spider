// Canvas drawing for the web-building animation. What happens (and when) is decided by choreo.js; this file draws it.
//
// Layers, bottom to top (a frame never repaints the whole web):
//   CSS background + vignette   the theme's gradient and glow, painted by the browser once (see style.css)
//   dust layer                  a tiny canvas drawn once and drifted by a CSS animation (no JavaScript per frame)
//   static layer (#web)         rings, silk and packages the spider has anchored; drawn into only when something is
//                               added (one thread + one dot) or removed (one batched redraw per cut)
//   live layer                  the spider, the thread being laid, glints, sparks, falling packages; cleared with a
//                               dirty rectangle around those few things
// Depth cues are 2.5D and cheap: pre-rendered sphere sprites (per colour and depth level), deeper rings smaller,
// dimmer and fogged toward the background, thread brightness falling off with depth, a subtle CSS perspective tilt.
// No shadowBlur, no filters, no gradients created inside the frame loop. devicePixelRatio is clamped to 2.
import { HUB, MAX_RING, WebLayout, Planner, PACE, toXY, lengthOf, pointAlong } from './choreo.js';
import { theme, fragColor, RING_FROM } from './theme.js';
import { mix, rgba } from './color.js';
import { isOff } from './flags.js';

export { fragColor };

const NB = 16; // colour buckets; sprite index NB = "not on npm" (hollow), NB + 1 = grey sphere (falling packages)
const LEVELS = 4; // depth levels by ring: 1, 2, 3-4, 5-6
const levelOf = (ring) => (ring <= 1 ? 0 : ring === 2 ? 1 : ring <= 4 ? 2 : 3);
const BASE_R = [3.7, 3.2, 2.7, 2.2];
const FOG = [0, 0.1, 0.22, 0.34]; // how far a colour is mixed toward the background at each level
const DIM = [1, 0.95, 0.86, 0.74];
const bucketOf = (f) => Math.max(0, Math.min(NB - 1, Math.round(f * (NB - 1))));
const TWO_PI = Math.PI * 2;
const MAX_SPARKS = 60;
const MAX_PIXELS = 2.5e6;
const MAX_ONE_BY_ONE = 8; // prune: candidates animated one at a time before the rest are cut together

function glowSprite(color, size, alpha = 0.55) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, rgba(color, alpha)); grad.addColorStop(1, rgba(color, 0));
  g.fillStyle = grad; g.fillRect(0, 0, size, size);
  return c;
}

const angDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= TWO_PI; while (d < -Math.PI) d += TWO_PI; return d; };

export class Viz {
  constructor(canvas, { reducedMotion = false, tier = 2 } = {}) {
    this.canvas = canvas; // static layer
    this.ctx = canvas.getContext('2d');
    this.wrap = canvas.parentElement;
    this.hint = document.getElementById('hint');
    // tilt container: dust, static and live layers live inside it so one CSS transform tilts them together
    this.tilt = document.createElement('div');
    this.tilt.className = 'tilt';
    this.live = document.createElement('canvas');
    this.live.setAttribute('aria-hidden', 'true');
    this.live.style.cssText = 'position:absolute;inset:0;display:block;pointer-events:none';
    this.wrap.insertBefore(this.tilt, canvas);
    this.tilt.append(canvas, this.live);
    this.lctx = this.live.getContext('2d');
    this.reduced = reducedMotion;
    this.autoStep = true; // false when the user forced a tier (Full / Lite / ?tier=)
    this.tier = tier; // 2 full, 1 no tilt/dust/glow pass/additive, 0 also DPR 1, no fog, no glints, no particles
    this.onTier = null;
    this.tiltOn = !reducedMotion && !isOff('tilt') && !window.matchMedia('(hover: none), (pointer: coarse)').matches;
    this.fxUntil = 0; this.perfBuf = new Float32Array(60); this.perfTmp = new Float32Array(60); this.perfN = 0; this.perfSkip = 0; this.overSince = 0;
    this.tx = 0; this.ty = 0; this.cx2 = 0; this.cy2 = 0; this.tiltApplied = '';
    if (this.tiltOn) {
      this.wrap.addEventListener('pointermove', (e) => {
        if (window.innerWidth <= 820 || this.tier < 2) return;
        this.wake();
        const r = this.wrap.getBoundingClientRect();
        this.ty = ((e.clientX - r.left) / r.width - 0.5) * 2 * 4; // rotateY, max 4 degrees
        this.tx = -((e.clientY - r.top) / r.height - 0.5) * 2 * 4; // rotateX
      });
      this.wrap.addEventListener('pointerleave', () => { this.tx = 0; this.ty = 0; });
    }
    this.glints = Array.from({ length: 48 }, () => ({ x: 0, y: 0, t: -1 }));
    this.flashes = Array.from({ length: 8 }, () => ({ x: 0, y: 0, t: -1 }));
    this.stubs = Array.from({ length: 8 }, () => ({ ax: 0, ay: 0, bx: 0, by: 0, jx: 0, jy: 0, t: -1 }));
    this.falling = Array.from({ length: 600 }, () => ({ on: false, started: false, x: 0, y: 0, vy: 0, px: 0, py: 0, bucket: 0, lv: 0, delay: 0, t: 0 }));
    this.spark = { x: new Float32Array(MAX_SPARKS), y: new Float32Array(MAX_SPARKS), vx: new Float32Array(MAX_SPARKS), vy: new Float32Array(MAX_SPARKS), life: new Float32Array(MAX_SPARKS), max: new Float32Array(MAX_SPARKS), n: 0 };
    this.out = { x: 0, y: 0, hx: 0, hy: 0 };
    this.recent = [];
    this.dirty = { x0: 0, y0: 0, x1: 0, y1: 0, on: false };
    this.gi = -1; this.fi = -1; this.si = -1;
    this.w = 0; this.h = 0; this.cx = 0; this.cy = 0; this.R = 0; this.geom = { cx: 0, cy: 0, R: 0 }; this.dpr = 1;
    this.spr = []; this.styles = null;
    this.frame = this.frame.bind(this);
    this.running = true; // the loop starts below; wake() calls made while constructing are no-ops
    this.buildStyles();
    this.reset();
    this.resize();
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => this.resize()).observe(this.wrap);
    this.last = performance.now();
    requestAnimationFrame(this.frame);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.wake(); }); // no work at all in a hidden tab
  }

  get fog() { return this.tier >= 1 && !isOff('fog'); }
  get glowPass() { return this.tier >= 1 && !isOff('glow'); } // costs ~0 ms/frame: it is drawn into the static layer only when something is anchored
  get glintsOn() { return this.tier >= 1 && !isOff('glints'); }
  get additive() { return this.tier >= 1 && theme.additive && !isOff('additive'); } // measured 0.1 ms/frame

  // ---- theme-dependent assets (rebuilt only when the theme or the pixel ratio changes) ---------------------------

  buildStyles() {
    const t = theme;
    const glowA = t.dark ? [0.09, 0.07, 0.05, 0.035] : [0.06, 0.045, 0.03, 0.02];
    const coreA = t.dark ? [0.55, 0.42, 0.32, 0.22] : [0.6, 0.48, 0.36, 0.25]; // thread brightness falls off with depth
    this.styles = {
      glow: glowA.map((a) => rgba(t.thread, a)), core: coreA.map((a) => rgba(t.thread, a)),
      cross: rgba(t.thread, t.dark ? 0.06 : 0.1), dew: rgba('#ffffff', t.dark ? 0.55 : 0.95),
      ghost: rgba(t.ring, 0.85), threadLive: mix(t.thread, t.dark ? '#ffffff' : '#000000', 0.45),
      ringLine: t.ringLine, comp: this.additive ? 'lighter' : 'source-over',
    };
    this.glowBlue = glowSprite(t.spiderGlow, 64, t.dark ? 0.6 : 0.3);
    this.glowRing = glowSprite(t.ring, 48, 0.6);
    this.glowWhite = glowSprite('#ffffff', 32, 0.95);
    this.glowSpark = glowSprite(t.ring === t.thread ? '#ffffff' : mix(t.ring, '#ffffff', 0.35), 24, 0.95);
  }

  buildSprites() {
    const t = theme, dpr = this.dpr;
    this.spr = [];
    for (let L = 0; L < LEVELS; L++) {
      const row = [], r = BASE_R[L];
      for (let b = 0; b < NB + 2; b++) {
        const f = b / (NB - 1);
        const base = b < NB ? fragColor(f) : b === NB ? t.cmiss : mix(t.muted, t.bg1, 0.35);
        const col = mix(base, t.bg1, this.fog ? FOG[L] : 0); // fog toward the background (tier 0: none)
        const ring = b < NB && f >= RING_FROM;
        const half = r + 3 + (ring ? 2.6 : 0);
        const size = half * 2;
        const c = document.createElement('canvas');
        c.width = c.height = Math.ceil(size * dpr);
        const g = c.getContext('2d');
        g.scale(c.width / size, c.height / size);
        g.globalAlpha = this.fog ? DIM[L] : 1;
        if (b === NB) { // not on npm: hollow
          g.fillStyle = rgba(col, 0.16); g.beginPath(); g.arc(half, half, r, 0, TWO_PI); g.fill();
          g.strokeStyle = col; g.lineWidth = 1.3; g.beginPath(); g.arc(half, half, r - 0.4, 0, TWO_PI); g.stroke();
        } else {
          const grad = g.createRadialGradient(half - r * 0.35, half - r * 0.4, r * 0.08, half, half, r * 1.05);
          grad.addColorStop(0, mix(col, '#ffffff', 0.6)); grad.addColorStop(0.5, col); grad.addColorStop(1, mix(col, '#000000', t.dark ? 0.5 : 0.4));
          g.fillStyle = grad; g.beginPath(); g.arc(half, half, r, 0, TWO_PI); g.fill();
          g.strokeStyle = rgba(mix(col, '#ffffff', 0.65), 0.5); g.lineWidth = 0.7; // soft rim light, lower right
          g.beginPath(); g.arc(half, half, r - 0.35, 0.1 * Math.PI, 0.7 * Math.PI); g.stroke();
          g.fillStyle = rgba('#ffffff', t.dark ? 0.85 : 0.95); // dewdrop specular highlight
          g.beginPath(); g.ellipse(half - r * 0.38, half - r * 0.42, r * 0.3, r * 0.2, -0.6, 0, TWO_PI); g.fill();
          if (ring) { g.strokeStyle = rgba(col, 0.9); g.lineWidth = 1; g.beginPath(); g.arc(half, half, r + 2.4, 0, TWO_PI); g.stroke(); }
        }
        row.push({ c, half, size });
      }
      this.spr.push(row);
    }
    // the spider: halo + body, pre-rendered (legs are drawn per frame because they move)
    const S = 72, sc = document.createElement('canvas');
    sc.width = sc.height = Math.ceil(S * dpr);
    const g = sc.getContext('2d');
    g.scale(sc.width / S, sc.height / S);
    const m = S / 2;
    const halo = g.createRadialGradient(m, m, 2, m, m, m);
    halo.addColorStop(0, rgba(t.spiderGlow, t.dark ? 0.55 : 0.25)); halo.addColorStop(1, rgba(t.spiderGlow, 0));
    if (!isOff('halo')) { g.fillStyle = halo; g.fillRect(0, 0, S, S); }
    const ab = g.createRadialGradient(m - 1.5, m + 1.5, 0.5, m, m + 3, 8);
    ab.addColorStop(0, mix(t.spider, '#ffffff', t.dark ? 0 : 0.35)); ab.addColorStop(1, mix(t.spider, t.dark ? '#7a8bb5' : '#000000', 0.45));
    g.fillStyle = ab; g.beginPath(); g.ellipse(m, m + 3.2, 4.6, 6.6, 0, 0, TWO_PI); g.fill();
    g.fillStyle = rgba(t.accent, 0.8); g.beginPath(); g.ellipse(m, m + 3.8, 1.1, 2.4, 0, 0, TWO_PI); g.fill(); // abdomen mark
    g.fillStyle = t.spider; g.beginPath(); g.arc(m, m - 4.4, 2.9, 0, TWO_PI); g.fill();
    g.fillStyle = t.dark ? '#0b1226' : '#f7f2ea'; g.beginPath(); g.arc(m - 1.1, m - 5.2, 0.55, 0, TWO_PI); g.arc(m + 1.1, m - 5.2, 0.55, 0, TWO_PI); g.fill();
    this.spiderSprite = sc;
    this.spiderSize = S;
  }

  // Called when the theme changes: rebuild sprites, dust and the static layer. The page applies the CSS variables.
  themeChanged() {
    this.buildStyles(); this.buildSprites(); this.applyBackdrop(); this.redrawStatic(); this.clearLive(true); this.wake();
  }

  // ONE static CSS background on the parent: vignette + dust + centre glow + gradient. No dust canvas, no overlay element,
  // no animation: the browser paints it once and never again (tier 2 only for the dust image).
  applyBackdrop() {
    const t = theme, w = Math.max(10, Math.round(this.w)), h = Math.max(10, Math.round(this.h));
    const layers = [];
    if (!isOff('vignette')) layers.push(`radial-gradient(120% 100% at 50% 50%, transparent 55%, ${rgba(t.bg0, t.dark ? 0.75 : 0.35)} 100%)`);
    if (!isOff('dust')) { // a static background image: free at every tier
      const d = document.createElement('canvas'); d.width = w; d.height = h;
      const c = d.getContext('2d');
      let seed = 12345;
      const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
      for (let i = 0; i < 110; i++) { const x = rnd() * w, y = rnd() * h, r = 0.4 + rnd() * rnd() * 1.4; c.fillStyle = rgba(t.dust, 0.06 + rnd() * 0.3); c.beginPath(); c.arc(x, y, r, 0, TWO_PI); c.fill(); }
      layers.push(`url(${d.toDataURL('image/png')}) 0 0 / 100% 100% no-repeat`);
    }
    layers.push(`radial-gradient(70% 70% at ${t.dark ? '50% 48%' : '18% 6%'}, ${t.glow} 0%, transparent 72%)`, `linear-gradient(180deg, ${t.bg0}, ${t.bg1})`);
    this.wrap.style.background = layers.join(', ');
  }

  reset() {
    this.sprites = new Map(); // name -> {name, depth, parent, deps, missing, bucket, angle, ring, lv, x, y, laid, removed, ghost, cut, stillNeeded}
    this.laidList = [];
    this.layout = null; this.planner = null;
    this.hub = { x: this.cx, y: this.cy };
    this.dropTop = { x: this.cx, y: -30 };
    this.step = null; this.dropStarted = false; this.dropDone = false;
    this.deliveryDone = false; this.skipping = false; this.crossOn = false; this.pruning = false; this.pruneBusy = false;
    this.idle = true; // before the first scan the spider hangs from the top and sways
    this.at = HUB; // where the spider is resting
    this.spider = { x: this.cx, y: this.idleY(), heading: Math.PI / 2, phase: 0, moving: false };
    this.waiting = false;
    this.delivered = 0; this.laidCount = 0; this.recent.length = 0;
    for (const g of this.glints) g.t = -1;
    for (const f of this.flashes) f.t = -1;
    for (const s of this.stubs) s.t = -1;
    for (const f of this.falling) f.on = false;
    this.spark.n = 0; this.spark.life.fill(0);
    this.removedCount = 0; this.beforeCount = 0; this.hooks = null; this.focusName = null;
    this.staticDirty = false; this.lastStatic = 0;
    this.built = new Promise((r) => { this.resolveBuilt = r; });
    this.setHint(true);
    if (this.w) { this.redrawStatic(); this.clearLive(true); }
    this.wake();
  }

  idleY() { return Math.max(120, Math.min(260, (this.h || 400) * 0.3)); }

  setHint(on) { if (this.hint) this.hint.classList.toggle('hidden', !on); }

  resize() {
    const r = this.wrap.getBoundingClientRect();
    // cap the backing store of each canvas (about 2.5 megapixels) by lowering the pixel ratio on large canvases; tier 0 uses 1
    const dpr = this.tier === 0 ? 1 : Math.max(1, Math.min(2, window.devicePixelRatio || 1, Math.sqrt(MAX_PIXELS / (Math.max(200, r.width) * Math.max(200, r.height)))));
    const dprChanged = Math.abs(dpr - this.dpr) > 0.01;
    this.dpr = dpr;
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
    if (!this.dropStarted) { this.spider.x = this.cx; this.spider.y = this.idleY(); }
    else if (!this.step) { const at = this.posOf(this.at); this.spider.x = at.x; this.spider.y = at.y; }
    if (dprChanged || !this.spr.length) this.buildSprites();
    this.applyBackdrop();
    this.redrawStatic();
    this.clearLive(true);
    this.wake();
  }

  // ---- data in --------------------------------------------------------------------------------------------

  // Called when package.json is read: the spider continues its drop from where it hangs and anchors the hub.
  begin(rootNames) {
    this.layout = new WebLayout(rootNames);
    this.planner = new Planner((n) => this.posOf(n));
    this.dropStarted = true; this.idle = false; this.setHint(false); this.wake();
    if (this.reduced) { this.dropDone = true; this.spider.x = this.hub.x; this.spider.y = this.hub.y; this.redrawStatic(); return; }
    const pts = [this.dropTop, this.hub];
    this.step = { kind: 'drop', names: [HUB], pts, len: lengthOf(pts), dist: Math.max(0, Math.min(this.spider.y - this.dropTop.y, this.hub.y - this.dropTop.y)), speed: (this.hub.y + 30) / PACE.dropSeconds, pause: PACE.hubPause, state: 'travel', restLeft: 0 };
  }

  posOf(name) { return name === HUB ? this.hub : this.sprites.get(name); }

  // A package arrived from the registry crawl. The spider will get to it in its own time (or at once when skipping).
  addNode(node, frag = 0) {
    if (!this.layout) this.begin([]);
    const { angle, ring } = this.layout.place(node);
    const p = toXY(node.name, angle, ring, this.geom);
    this.sprites.set(node.name, { name: node.name, depth: node.depth, parent: node.parent, deps: node.deps || [], missing: !!node.missing, bucket: bucketOf(frag), angle, ring, lv: levelOf(ring), x: p.x, y: p.y, laid: false, removed: false, ghost: false, cut: false, stillNeeded: null });
    this.planner.deliver(node);
    this.delivered++;
    this.wake();
    if (this.reduced || this.skipping) this.drain();
  }

  finishDelivery() { this.deliveryDone = true; this.wake(); if (this.reduced || this.skipping) this.drain(); else this.checkBuilt(); }

  setFrag(name, frag) { const s = this.sprites.get(name); if (s) { const b = bucketOf(frag); if (b !== s.bucket) { s.bucket = b; this.staticDirty = true; this.wake(); } } }

  markGhosts(ghosts) { for (const g of ghosts) { const s = this.sprites.get(g.name); if (s) s.ghost = true; } }

  // Jump to the finished web (and, during the prune, to the end state).
  skip() { this.skipping = true; this.wake(); if (this.planner) this.drain(); }

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

  spriteOf(s) { return this.spr[s.lv][s.missing ? NB : s.bucket]; }

  drawNodeSprite(c, s) { const sp = this.spriteOf(s); c.drawImage(sp.c, s.x - sp.half, s.y - sp.half, sp.size, sp.size); }

  anchor(s, glint = true) {
    s.laid = true; this.laidList.push(s); this.laidCount++;
    const p = s.parent ? this.sprites.get(s.parent) : this.hub;
    const c = this.ctx, st = this.styles;
    c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(s.x, s.y);
    if (this.glowPass) { c.strokeStyle = st.glow[s.lv]; c.lineWidth = 3.4; c.stroke(); } // wide faint pass (tier 2 only)
    c.strokeStyle = st.core[s.lv]; c.lineWidth = 1; c.stroke(); // thin bright core
    this.drawNodeSprite(c, s);
    if (glint && this.glintsOn) { this.gi = (this.gi + 1) % this.glints.length; const g = this.glints[this.gi]; g.x = s.x; g.y = s.y; g.t = performance.now(); this.fxUntil = g.t + 500; }
    this.recent.push({ name: s.name, color: s.missing ? theme.cmiss : fragColor(s.bucket / (NB - 1)) });
    if (this.recent.length > 8) this.recent.shift();
  }

  redrawStatic() {
    const c = this.ctx, st = this.styles;
    c.clearRect(0, 0, this.w, this.h);
    c.lineWidth = 1; c.strokeStyle = st.ringLine;
    for (let d = 1; d <= MAX_RING; d++) { c.beginPath(); c.arc(this.cx, this.cy, (this.R * d) / MAX_RING, 0, TWO_PI); c.stroke(); }
    const tree = Array.from({ length: LEVELS }, () => new Path2D()), cross = new Path2D(), red = new Path2D(), dew = new Path2D();
    const live = (s) => s && s.laid && !s.removed;
    for (const s of this.laidList) {
      if (s.removed) continue;
      const p = s.parent ? this.sprites.get(s.parent) : this.hub;
      if (s.parent && !live(p)) continue;
      if (s.ghost && this.pruning) { if (!s.cut) { red.moveTo(p.x, p.y); red.lineTo(s.x, s.y); } }
      else {
        tree[s.lv].moveTo(p.x, p.y); tree[s.lv].lineTo(s.x, s.y);
        if (Math.hypot(s.x - p.x, s.y - p.y) > 40) { const mx = (p.x + s.x) / 2, my = (p.y + s.y) / 2; dew.moveTo(mx + 0.9, my); dew.arc(mx, my, 0.9, 0, TWO_PI); } // a dew bead on longer threads
      }
      if (this.crossOn) for (const d of s.deps) { const t = this.sprites.get(d); if (live(t) && t.parent !== s.name) { cross.moveTo(s.x, s.y); cross.lineTo(t.x, t.y); } }
    }
    if (this.glowPass) { c.lineWidth = 3.4; for (let L = 0; L < LEVELS; L++) { c.strokeStyle = st.glow[L]; c.stroke(tree[L]); } } // wide faint pass (tier 2 only)
    c.lineWidth = 1; for (let L = 0; L < LEVELS; L++) { c.strokeStyle = st.core[L]; c.stroke(tree[L]); } // thin bright core
    if (this.crossOn) { c.strokeStyle = st.cross; c.stroke(cross); }
    c.strokeStyle = st.ghost; c.lineWidth = 1.4; c.stroke(red); c.lineWidth = 1;
    c.fillStyle = st.dew; c.fill(dew);
    for (const s of this.laidList) if (!s.removed) this.drawNodeSprite(c, s);
    for (const s of this.laidList) { // candidates (and the still-needed ones) are drawn on top of the sprites
      if (s.removed || !(this.pruning && s.ghost)) continue;
      c.fillStyle = s.stillNeeded ? theme.c1 : theme.ring; c.beginPath(); c.arc(s.x, s.y, 3.8, 0, TWO_PI); c.fill();
      if (s.stillNeeded) { c.strokeStyle = theme.c1; c.lineWidth = 1.5; c.beginPath(); c.arc(s.x, s.y, 7, 0, TWO_PI); c.stroke(); c.lineWidth = 1; }
    }
    if (this.dropDone) this.drawHub();
    this.staticDirty = false; this.lastStatic = performance.now();
  }

  drawHub() {
    const c = this.ctx;
    if (!isOff('halo')) c.drawImage(this.glowBlue, this.hub.x - 18, this.hub.y - 18, 36, 36);
    c.fillStyle = theme.spider; c.beginPath(); c.arc(this.hub.x, this.hub.y, 4.8, 0, TWO_PI); c.fill();
    c.strokeStyle = rgba(theme.thread, 0.6); c.lineWidth = 1; c.beginPath(); c.arc(this.hub.x, this.hub.y, 8.5, 0, TWO_PI); c.stroke();
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
    this.wake();
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
    const k = this.spark; // snip sparks
    for (let i = 0; i < MAX_SPARKS; i++) {
      if (k.life[i] <= 0) continue;
      k.life[i] -= dt; k.x[i] += k.vx[i] * dt; k.y[i] += k.vy[i] * dt; k.vx[i] *= 1 - 2.2 * dt; k.vy[i] = k.vy[i] * (1 - 2.2 * dt) + 120 * dt;
    }
    if (this.staticDirty && now - this.lastStatic > 250) this.redrawStatic();
    if (this.tiltOn && this.tier >= 2) { // eased pointer tilt (tier 2 only), written to CSS only when it actually changes
      const k2 = Math.min(1, dt * 6);
      this.cx2 += (this.tx - this.cx2) * k2; this.cy2 += (this.ty - this.cy2) * k2;
      const flat = Math.abs(this.cx2) < 0.01 && Math.abs(this.cy2) < 0.01;
      const tr = flat ? '' : `perspective(1100px) rotateX(${this.cx2.toFixed(2)}deg) rotateY(${this.cy2.toFixed(2)}deg)`;
      if (tr !== this.tiltApplied) { this.tilt.style.transform = tr; this.tiltApplied = tr; }
    }
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
    const c = this.lctx, sp = this.spider, st = this.step, sty = this.styles;
    this.clearLive(false);
    if (this.idle) { if (!isOff('idle')) this.drawIdle(c, now); return; }
    if (st && st.state === 'travel' && (st.kind === 'lay' || st.kind === 'drop')) { // the thread being laid: its tip IS the spider
      const a = st.pts[0];
      c.strokeStyle = sty.threadLive; c.lineWidth = st.kind === 'drop' ? 1 : 1.5;
      c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(sp.x, sp.y); c.stroke();
      this.touch(a.x, a.y, 6); this.touch(sp.x, sp.y, 6);
      if (st.kind === 'lay' && !this.reduced && this.glintsOn) { // a short bright glint travels along the thread behind the spider
        const ph = (now % 240) / 240, gx = sp.x + (a.x - sp.x) * ph, gy = sp.y + (a.y - sp.y) * ph;
        c.globalCompositeOperation = sty.comp; c.globalAlpha = 0.9 * (1 - ph * 0.6);
        c.drawImage(this.glowWhite, gx - 6, gy - 6, 12, 12); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
      }
    }
    c.globalCompositeOperation = sty.comp;
    for (const g of this.glints) { // dew glint where a thread was just anchored
      if (g.t < 0) continue;
      const k = (now - g.t) / 450;
      if (k >= 1) { g.t = -1; continue; }
      const r = 5 + k * 9;
      c.globalAlpha = 0.9 * (1 - k); c.drawImage(this.glowWhite, g.x - r, g.y - r, r * 2, r * 2); this.touch(g.x, g.y, 16);
    }
    c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
    if (this.pruning) this.drawPrune(c, now);
    this.drawSpider(c, now);
    if (this.focusName) this.drawLabel(c);
  }

  // Before the first scan: the spider hangs from the top on a thread and sways; the rings shimmer so they are never dead.
  drawIdle(c, now) {
    const sp = this.spider;
    if (!this.reduced && this.tier >= 1) {
      const sway = Math.sin(now / 1300) * 0.1, len = this.idleY() + 4;
      sp.x = this.cx + Math.sin(sway) * len; sp.y = -4 + Math.cos(sway) * len; sp.heading = Math.PI / 2 + sway;
      c.strokeStyle = rgba(theme.thread, 0.7); c.lineWidth = 1;
      c.beginPath(); c.moveTo(this.cx, -4); c.lineTo(sp.x, sp.y); c.stroke();
      c.strokeStyle = rgba(theme.thread, theme.dark ? 0.28 : 0.4); c.lineWidth = 1.4; c.lineCap = 'round';
      if (this.tier >= 2) for (let d = 1; d <= MAX_RING; d++) { // a slow bright arc travels around each ring at its own speed
        const a0 = now / (2400 + d * 700) * (d % 2 ? 1 : -1) + d;
        c.beginPath(); c.arc(this.cx, this.cy, (this.R * d) / MAX_RING, a0, a0 + 0.55); c.stroke();
      }
      c.lineCap = 'butt';
      if (this.tier >= 2) { this.touch(this.cx - this.R - 4, this.cy - this.R - 4, 0); this.touch(this.cx + this.R + 4, this.cy + this.R + 4, 0); }
      this.touch(sp.x, sp.y, 60); this.touch(this.cx, 0, 20);
    } else { sp.x = this.cx; sp.y = this.idleY(); c.strokeStyle = rgba(theme.thread, 0.7); c.beginPath(); c.moveTo(this.cx, -4); c.lineTo(sp.x, sp.y); c.stroke(); this.touch(this.cx, 0, 10); }
    this.drawSpider(c, now);
  }

  drawPrune(c, now) {
    const pulse = 0.5 + 0.5 * Math.sin(now / 260), sty = this.styles;
    c.globalCompositeOperation = sty.comp;
    for (const s of this.laidList) { // pulsing rings on candidates that are still attached
      if (!s.ghost || s.cut || s.removed) continue;
      c.drawImage(this.glowRing, s.x - 16, s.y - 16, 32, 32);
      c.strokeStyle = rgba(theme.ring, 0.5 + 0.5 * pulse); c.lineWidth = 1.5;
      c.beginPath(); c.arc(s.x, s.y, 6 + pulse * 3, 0, TWO_PI); c.stroke(); this.touch(s.x, s.y, 20);
    }
    for (const f of this.flashes) {
      if (f.t < 0) continue;
      const k = (now - f.t) / 600;
      if (k >= 1) { f.t = -1; continue; }
      c.strokeStyle = rgba(theme.dark ? '#ffffff' : theme.ring, 1 - k); c.lineWidth = 2;
      c.beginPath(); c.arc(f.x, f.y, 4 + k * 22, 0, TWO_PI); c.stroke(); this.touch(f.x, f.y, 30);
    }
    for (const s of this.stubs) { // the two cut thread ends recoil away from the snip
      if (s.t < 0) continue;
      const k = (now - s.t) / 450;
      if (k >= 1) { s.t = -1; continue; }
      const e = 1 - (1 - k) * (1 - k);
      c.strokeStyle = rgba(theme.ring, 1 - k); c.lineWidth = 1.4;
      c.beginPath();
      c.moveTo(s.jx, s.jy); c.lineTo(s.jx + (s.ax - s.jx) * (1 - e), s.jy + (s.ay - s.jy) * (1 - e)); // the piece still on the hub side
      c.moveTo(s.jx, s.jy); c.lineTo(s.jx + (s.bx - s.jx) * (1 - e), s.jy + (s.by - s.jy) * (1 - e)); // the piece on the branch side
      c.stroke(); this.touch(s.ax, s.ay, 8); this.touch(s.bx, s.by, 8);
    }
    const k = this.spark; // spark burst from the snip (pooled, at most 60)
    for (let i = 0; i < MAX_SPARKS; i++) {
      if (k.life[i] <= 0) continue;
      const a = Math.max(0, k.life[i] / k.max[i]), r = 3 + 5 * a;
      c.globalAlpha = a; c.drawImage(this.glowSpark, k.x[i] - r, k.y[i] - r, r * 2, r * 2); this.touch(k.x[i], k.y[i], 10);
    }
    c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
    for (const f of this.falling) { // packages that really shed: grey out, fall with gravity, fade
      if (!f.on || f.t < f.delay) continue;
      const kk = f.t - f.delay;
      const a = Math.max(0, 1 - kk), grey = Math.min(1, kk / 0.25);
      c.strokeStyle = rgba(theme.thread, 0.2 * a); c.lineWidth = 1;
      c.beginPath(); c.moveTo(f.px, f.py); c.lineTo(f.x, f.y); c.stroke();
      const col = this.spr[f.lv][f.bucket], gr = this.spr[f.lv][NB + 1];
      c.globalAlpha = a * (1 - grey); c.drawImage(col.c, f.x - col.half, f.y - col.half, col.size, col.size);
      c.globalAlpha = a * grey; c.drawImage(gr.c, f.x - gr.half, f.y - gr.half, gr.size, gr.size);
      c.globalAlpha = 1; this.touch(f.x, f.y, 12); this.touch(f.px, f.py, 4);
    }
  }

  drawSpider(c, now) {
    const sp = this.spider, S = this.spiderSize;
    const x = sp.x;
    let rot = sp.heading + Math.PI / 2, yy = sp.y;
    if (this.waiting) { rot += Math.sin(now / 420) * 0.22; yy += Math.sin(now / 520) * 2; } // hangs and sways while npm answers
    c.save(); c.translate(x, yy); c.rotate(rot); c.scale(1.35, 1.35);
    c.globalCompositeOperation = this.styles.comp;
    c.drawImage(this.spiderSprite, -S / 2, -S / 2, S, S); // halo + body
    c.globalCompositeOperation = 'source-over';
    c.strokeStyle = theme.spider; c.lineWidth = 1.05; c.lineCap = 'round'; c.lineJoin = 'round';
    const wig = sp.moving ? Math.sin(sp.phase) : 0; // legs move only while the spider moves, in step with distance
    c.beginPath();
    for (let side = -1; side <= 1; side += 2) for (let i = 0; i < 4; i++) {
      const y0 = -2.6 + i * 2.2, spread = (i - 1.5) * 2.4 + (i % 2 ? wig : -wig) * 1.7;
      c.moveTo(side * 1.8, y0); c.lineTo(side * 6.2, y0 - 4.6 + spread * 0.3); c.lineTo(side * 11.5, y0 - 1 + spread); c.lineTo(side * 13.8, y0 + 3 + spread * 1.1);
    }
    c.stroke();
    c.restore();
    this.touch(x, yy, 54); // the halo sprite is ~97 px wide and drawn additively: the cleared rect must cover all of it
  }

  drawLabel(c) {
    const s = this.sprites.get(this.focusName);
    if (!s) return;
    c.font = '600 11px ui-monospace, "SF Mono", Menlo, monospace';
    const text = s.stillNeeded ? `${s.name} (needed by ${s.stillNeeded})` : s.name;
    const tw = c.measureText(text).width;
    const x = Math.min(Math.max(s.x + 12, 6), this.w - tw - 6), y = Math.min(Math.max(s.y + 22, 14), this.h - 8);
    c.fillStyle = rgba(theme.bg0, 0.82); c.fillRect(x - 4, y - 11, tw + 8, 15);
    c.fillStyle = theme.text; c.fillText(text, x, y);
    this.touch(x, y, tw + 14);
  }

  // The frame loop runs only while something is animating; wake() restarts it (new data, a step, an effect, the pointer, a resize).
  wake() {
    if (this.running || document.hidden) return;
    this.running = true; this.last = performance.now(); this.perfN = 0; this.perfSkip = 12; this.overSince = 0;
    requestAnimationFrame(this.frame);
  }

  busy(now) {
    return this.idle ? (this.tier >= 1 && !this.reduced && !isOff('idle')) : !!(this.step || this.pruneBusy || this.waiting || this.staticDirty || (this.dropStarted && !this.crossOn)
      || now < this.fxUntil || Math.abs(this.cx2 - this.tx) > 0.02 || Math.abs(this.cy2 - this.ty) > 0.02 || (this.tiltApplied !== ''));
  }

  frame(now) {
    if (document.hidden) { this.running = false; return; }
    const raw = now - this.last;
    const dt = Math.min(0.05, Math.max(0, raw / 1000));
    this.last = now;
    if (this.idle && now - (this.lastIdleDraw || 0) < 30) { requestAnimationFrame(this.frame); return; } // idle animation: 30 fps at most
    this.lastIdleDraw = now;
    this.update(dt, now);
    this.drawLive(now);
    if (!this.idle) this.watch(raw, now);
    if (this.busy(now)) requestAnimationFrame(this.frame); else this.running = false;
  }

  // Adaptive quality: rolling 60-frame p95 of the real frame interval. Over 22 ms for 1.5 s -> one tier down, for good.
  watch(raw, now) {
    if (this.perfSkip > 0) { this.perfSkip--; return; } // warm-up after a wake/resize/tier change
    const b = this.perfBuf;
    b[this.perfN % 60] = Math.min(raw, 100); this.perfN++;
    if (this.perfN < 60 || this.perfN % 10) return;
    this.perfTmp.set(b); this.perfTmp.sort();
    const p95 = this.perfTmp[56];
    if (p95 > 22) { if (!this.overSince) this.overSince = now; else if (now - this.overSince >= 1500 && this.tier > 0 && this.autoStep) this.setTier(this.tier - 1, true); }
    else this.overSince = 0;
  }

  setTier(t, auto = false) {
    if (t === this.tier) return;
    this.tier = t; this.perfN = 0; this.perfSkip = 20; this.overSince = 0;
    this.tx = 0; this.ty = 0; this.cx2 = 0; this.cy2 = 0; this.tilt.style.transform = ''; this.tiltApplied = '';
    this.buildStyles(); this.resize(); // re-derives the pixel ratio, sprites (fog), background (dust)
    this.onTier?.(t, auto);
  }

  // ---- prune ----------------------------------------------------------------------------------------------

  wait(ms) { return new Promise((r) => setTimeout(r, this.reduced || this.skipping ? 0 : ms)); }

  // report: shedReport() result. hooks: onGhost(name, state, info), onCount(n)
  async prune(report, hooks = {}) {
    this.pruning = true; this.pruneBusy = true; this.hooks = hooks; this.wake();
    this.beforeCount = report.before; this.removedCount = 0;
    hooks.onCount?.(report.before);
    this.redrawStatic(); // candidates get their ring-coloured threads
    const removed = new Set();
    // The first MAX_ONE_BY_ONE candidates are cut one by one; a long list (nx: 85) would otherwise take over a minute, so
    // the remaining candidates are cut together, with the same results.
    const single = report.perGhost.slice(0, MAX_ONE_BY_ONE), bulk = report.perGhost.slice(MAX_ONE_BY_ONE);
    for (const g of single) {
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
    if (bulk.length) {
      hooks.onBulk?.(bulk.length);
      this.focusName = null;
      const all = [], counts = new Map();
      for (const g of bulk) {
        hooks.onGhost?.(g.name, 'cutting');
        const node = this.sprites.get(g.name);
        if (node) { node.cut = true; if (g.stillNeededBy) node.stillNeeded = g.stillNeededBy; }
        const own = g.stillNeededBy ? [] : [...g.shedSet].filter((n) => report.combinedSet.has(n) && !removed.has(n));
        own.forEach((n) => removed.add(n)); all.push(...own); counts.set(g.name, own.length);
      }
      this.redrawStatic(); // all their threads are cut at once
      await this.wait(this.shed(all));
      for (const g of bulk) hooks.onGhost?.(g.name, 'done', { removed: counts.get(g.name) });
    }
    const rest = [...report.combinedSet].filter((n) => !removed.has(n)); // these only go when several candidates go together
    if (rest.length) await this.wait(this.shed(rest));
    await this.walk(this.planner.treePath(this.at, HUB), 1100);
    this.removedCount = report.before - report.after; hooks.onCount?.(report.after);
    this.focusName = null;
    this.redrawStatic();
    this.pruneBusy = false; this.fxUntil = performance.now() + 300; // let the last effects finish, then the loop can stop
  }

  // The spider snips the thread at the parent: flash, sparks, and the two cut ends recoil.
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
    if (!this.reduced && !this.skipping) this.burst(jx, jy, 26);
    this.fxUntil = performance.now() + 1200; this.wake();
    node.cut = true;
    this.redrawStatic(); // the thread is gone from the static layer; the recoiling ends live in the live layer
  }

  burst(x, y, n) { // pooled sparks: at most MAX_SPARKS alive in total, oldest slots are reused
    if (isOff('sparks') || this.tier < 1) return;
    this.fxUntil = performance.now() + 1000; this.wake();
    const k = this.spark;
    for (let i = 0; i < n; i++) {
      const j = k.n = (k.n + 1) % MAX_SPARKS, a = Math.random() * TWO_PI, v = 50 + Math.random() * 140;
      k.x[j] = x; k.y[j] = y; k.vx[j] = Math.cos(a) * v; k.vy[j] = Math.sin(a) * v - 30; k.max[j] = k.life[j] = 0.45 + Math.random() * 0.4;
    }
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
      f.on = true; f.started = false; f.x = s.x; f.y = s.y; f.vy = 0; f.px = p.x; f.py = p.y; f.bucket = s.missing ? NB : s.bucket; f.lv = s.lv; f.delay = i * step; f.t = 0;
    });
    if (this.reduced || this.skipping) this.hooks?.onCount?.(this.beforeCount - this.removedCount);
    this.redrawStatic();
    this.fxUntil = performance.now() + (list.length * step + 1.2) * 1000; this.wake();
    return (list.length * step + 1.05) * 1000;
  }

  // ---- numbers the page reads a few times a second ----------------------------------------------------------

  get stats() { return { laid: this.laidCount, delivered: this.delivered, waiting: this.waiting, recent: this.recent }; }

  // ---- share image ------------------------------------------------------------------------------------------

  // lines: {repo, headline, sub, items[]}. Returns a PNG Blob (1200x630), drawn in the active theme.
  snapshot({ repo, headline, sub, items = [], note }) {
    const t = theme;
    const c = document.createElement('canvas');
    c.width = 1200; c.height = 630;
    const g = c.getContext('2d');
    const bg = g.createLinearGradient(0, 0, 0, 630); bg.addColorStop(0, t.bg0); bg.addColorStop(1, t.bg1);
    g.fillStyle = bg; g.fillRect(0, 0, 640, 630);
    const gl = g.createRadialGradient(330, 315, 0, 330, 315, 330); gl.addColorStop(0, rgba(t.glow, 0.9)); gl.addColorStop(1, rgba(t.glow, 0));
    g.fillStyle = gl; g.fillRect(0, 0, 640, 630);
    const sq = Math.min(this.canvas.width, this.canvas.height); // square crop around the centre of the web
    for (const layer of [this.canvas, this.live]) g.drawImage(layer, (layer.width - sq) / 2, (layer.height - sq) / 2, sq, sq, 20, 20, 590, 590);
    g.fillStyle = t.panel; g.fillRect(640, 0, 560, 630);
    g.fillStyle = t.border; g.fillRect(640, 0, 2, 630);
    const mono = 'ui-monospace, "SF Mono", Menlo, monospace', sans = 'ui-sans-serif, "SF Pro Display", "Inter", system-ui, sans-serif';
    g.fillStyle = t.muted; g.font = `600 22px ${mono}`; g.fillText('Dependency Spider', 680, 60);
    g.fillStyle = t.text; g.font = `700 28px ${mono}`; g.fillText(repo, 680, 110);
    const hg = g.createLinearGradient(680, 150, 1100, 215); hg.addColorStop(0, t.accentOnPanel); hg.addColorStop(1, mix(t.accentOnPanel, t.text, 0.45));
    g.fillStyle = hg; g.font = `700 76px ${sans}`; g.fillText(headline, 680, 215);
    g.fillStyle = t.muted; g.font = `24px ${sans}`; g.fillText(sub, 680, 255);
    g.fillStyle = t.text; g.font = `20px ${mono}`;
    let y = 320;
    for (const text of items.slice(0, 5)) {
      let line = '';
      for (const word of text.split(' ')) {
        if (g.measureText(`${line} ${word}`).width > 490 && line) { g.fillText(line, 680, y); y += 28; line = `  ${word}`; } else line = line ? `${line} ${word}` : word;
      }
      g.fillText(line, 680, y); y += 36;
    }
    if (items.length > 5) g.fillText(`+ ${items.length - 5} more`, 680, y);
    g.fillStyle = t.warnText; g.font = `18px ${sans}`; g.fillText(note, 680, 590);
    return new Promise((res) => c.toBlob(res, 'image/png'));
  }
}
