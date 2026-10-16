// Canvas 2D visualization: rings by depth, nodes easing into a fixed radial layout,
// a spider sprite that walks to the node being processed, and the prune animation.
import { layoutRadial } from './layout.js';

const MAX_RING = 6;
const GREEN = [61, 220, 151], AMBER = [255, 184, 77], RED = [255, 77, 94];
const lerp = (a, b, t) => a + (b - a) * t;
const mix = (c1, c2, t) => c1.map((v, i) => Math.round(lerp(v, c2[i], t)));

// fragility 0..1 -> green -> amber -> red
export function fragColor(f) {
  const c = f < 0.5 ? mix(GREEN, AMBER, f / 0.5) : mix(AMBER, RED, (f - 0.5) / 0.5);
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

// A soft round glow drawn once to an offscreen canvas. Using drawImage instead of shadowBlur
// keeps 900 nodes cheap: only the spider and the ghosts get glow.
function glowSprite(color, size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, color);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return c;
}

export class Viz {
  constructor(canvas, { reducedMotion = false } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.reduced = reducedMotion;
    this.glowBlue = glowSprite('rgba(120,170,255,0.55)', 96);
    this.glowRed = glowSprite('rgba(255,77,94,0.6)', 64);
    this.reset();
    this.resize();
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
    this.loop = this.loop.bind(this);
    this.last = performance.now();
    requestAnimationFrame(this.loop);
  }

  reset() {
    this.nodes = new Map(); // name -> sprite
    this.layout = new Map();
    this.layoutDirty = false;
    this.lastLayout = 0;
    this.spider = { x: 0, y: 0, angle: 0, follow: null, target: null, moving: false };
    this.flashes = [];
    this.focus = null; // name shown as a label
    this.pruneState = null;
    this.placeSpiderAtCenter = true;
  }

  resize() {
    const r = this.canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.w = Math.max(200, r.width);
    this.h = Math.max(200, r.height);
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.canvas.style.width = `${this.w}px`;
    this.canvas.style.height = `${this.h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.cx = this.w / 2;
    this.cy = this.h / 2;
    this.R = Math.min(this.w, this.h) / 2 - 28;
    this.layoutDirty = true;
    this.applyTargets(true);
    if (this.placeSpiderAtCenter) { this.spider.x = this.cx; this.spider.y = this.cy; }
  }

  // ---- data in -------------------------------------------------------------------------

  addNode(node, frag = 0) {
    const parent = node.parent ? this.nodes.get(node.parent) : null;
    this.nodes.set(node.name, {
      name: node.name, depth: node.depth, parent: node.parent, deps: node.deps, missing: node.missing, frag,
      x: parent ? parent.x : this.cx, y: parent ? parent.y : this.cy, tx: this.cx, ty: this.cy,
      alpha: 1, fadeAt: null, gone: false, ghost: false, cut: false, stillNeeded: null,
    });
    this.layoutDirty = true;
  }

  setFrag(name, frag) { const n = this.nodes.get(name); if (n) n.frag = frag; }

  markGhosts(ghosts) { for (const g of ghosts) { const n = this.nodes.get(g.name); if (n) n.ghost = true; } }

  follow(name) { this.spider.follow = name; this.spider.target = null; this.focus = name; }

  applyTargets(snap = false) {
    this.layout = layoutRadial(this.nodes);
    for (const [name, { angle, ring }] of this.layout) {
      const n = this.nodes.get(name);
      const r = (this.R * ring) / MAX_RING;
      n.tx = this.cx + Math.cos(angle) * r;
      n.ty = this.cy + Math.sin(angle) * r;
      if (snap || this.reduced) { n.x = n.tx; n.y = n.ty; }
    }
    this.layoutDirty = false;
    this.lastLayout = performance.now();
  }

  // ---- prune animation -----------------------------------------------------------------

  wait(ms) { return new Promise((r) => setTimeout(r, this.reduced ? 0 : ms)); }

  async walkTo(name) {
    const n = this.nodes.get(name);
    if (!n) return;
    this.focus = name;
    if (this.reduced) { this.spider.x = n.x; this.spider.y = n.y; return; }
    this.spider.follow = null;
    this.spider.target = name;
    const t0 = performance.now();
    while (Math.hypot(this.spider.x - n.x, this.spider.y - n.y) > 5 && performance.now() - t0 < 2500) await new Promise((r) => setTimeout(r, 30));
  }

  // report: shedReport() result. hooks: onGhost(name, state, info), onCount(n)
  async prune(report, hooks = {}) {
    const removed = new Set();
    this.pruneState = { active: true };
    hooks.onCount?.(report.before);
    for (const g of report.perGhost) {
      const node = this.nodes.get(g.name);
      hooks.onGhost?.(g.name, 'cutting');
      await this.walkTo(g.name);
      if (node) this.flashes.push({ x: node.x, y: node.y, t0: performance.now() });
      await this.wait(350);
      if (node) node.cut = true; // red thread disappears
      let toRemove = [];
      if (g.stillNeededBy) { if (node) node.stillNeeded = g.stillNeededBy; }
      else toRemove = [...g.shedSet].filter((n) => report.combinedSet.has(n) && !removed.has(n));
      const ms = this.startFade(toRemove);
      await this.wait(ms);
      toRemove.forEach((n) => removed.add(n));
      hooks.onGhost?.(g.name, 'done', { removed: toRemove.length });
      hooks.onCount?.(report.before - removed.size);
    }
    // Packages that only disappear when several ghosts go together
    const rest = [...report.combinedSet].filter((n) => !removed.has(n));
    if (rest.length) { await this.wait(this.startFade(rest)); }
    hooks.onCount?.(report.after);
    this.focus = null;
    this.spider.follow = null;
    this.spider.target = '__home'; // walk back to the centre
    this.pruneState = { active: false };
  }

  // Branch fades from its root outward: shallow nodes first. Returns total duration in ms.
  startFade(names) {
    const list = names.map((n) => this.nodes.get(n)).filter(Boolean).sort((a, b) => a.depth - b.depth);
    const step = Math.min(40, 900 / Math.max(1, list.length));
    const now = performance.now();
    list.forEach((n, i) => { n.fadeAt = this.reduced ? -1e9 : now + i * step; });
    return list.length ? list.length * step + 600 : 0;
  }

  // ---- frame loop ----------------------------------------------------------------------

  loop(now) {
    const dt = Math.min(64, now - this.last);
    this.last = now;
    if (this.layoutDirty && now - this.lastLayout > 100) this.applyTargets();
    this.update(dt, now);
    this.draw(now);
    requestAnimationFrame(this.loop);
  }

  update(dt, now) {
    const k = this.reduced ? 1 : 1 - Math.exp(-dt / 140);
    for (const n of this.nodes.values()) {
      n.x += (n.tx - n.x) * k;
      n.y += (n.ty - n.y) * k;
      if (n.fadeAt != null && now >= n.fadeAt) { n.alpha = Math.max(0, 1 - (now - n.fadeAt) / 500); if (n.alpha === 0) n.gone = true; }
    }
    const s = this.spider;
    const key = s.follow || s.target;
    const tgt = key === '__home' ? { x: this.cx, y: this.cy } : key ? this.nodes.get(key) : null;
    if (tgt) {
      const dx = tgt.x - s.x, dy = tgt.y - s.y, d = Math.hypot(dx, dy);
      const sk = this.reduced ? 1 : 1 - Math.exp(-dt / (s.target ? 160 : 220));
      s.moving = d > 3;
      if (d > 3) s.angle = Math.atan2(dy, dx);
      s.x += dx * sk; s.y += dy * sk;
      this.placeSpiderAtCenter = false;
    } else s.moving = false;
    this.flashes = this.flashes.filter((f) => now - f.t0 < 700);
  }

  draw(now) {
    const { ctx, w, h, cx, cy } = this;
    ctx.fillStyle = '#0a0e1a';
    ctx.fillRect(0, 0, w, h);
    // rings
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(125,138,165,0.10)';
    for (let d = 1; d <= MAX_RING; d++) { ctx.beginPath(); ctx.arc(cx, cy, (this.R * d) / MAX_RING, 0, Math.PI * 2); ctx.stroke(); }
    this.drawEdges(now);
    this.drawNodes(now);
    this.drawFlashes(now);
    this.drawSpider(now);
    this.drawLabels();
  }

  drawEdges() {
    const { ctx } = this;
    const solid = { tree: new Path2D(), web: new Path2D() };
    const fading = [];
    const consider = (a, b, isTree) => {
      if (a.gone || b.gone) return;
      if (a.alpha < 1 || b.alpha < 1) fading.push([a, b, isTree, Math.min(a.alpha, b.alpha)]);
      else { const p = isTree ? solid.tree : solid.web; p.moveTo(a.x, a.y); p.lineTo(b.x, b.y); }
    };
    for (const n of this.nodes.values()) {
      if (n.gone) continue;
      if (!n.parent) { // manifest entry: thread from the centre
        if (n.cut || (n.ghost && this.pruneState)) continue; // ghost threads are drawn red in drawNodes
        const c = { x: this.cx, y: this.cy, alpha: 1, gone: false };
        consider(c, n, true);
      }
      for (const dep of n.deps) {
        const d = this.nodes.get(dep);
        if (d) consider(n, d, d.parent === n.name);
      }
    }
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(110,140,220,0.16)'; ctx.stroke(solid.tree);
    ctx.strokeStyle = 'rgba(110,140,220,0.05)'; ctx.stroke(solid.web);
    for (const [a, b, isTree, al] of fading) {
      ctx.strokeStyle = `rgba(110,140,220,${(isTree ? 0.16 : 0.05) * al})`;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
  }

  drawNodes(now) {
    const { ctx } = this;
    const pulse = 0.5 + 0.5 * Math.sin(now / 260);
    const ghosts = [];
    for (const n of this.nodes.values()) {
      if (n.gone) continue;
      if (n.ghost && this.pruneState) { ghosts.push(n); continue; }
      ctx.globalAlpha = n.alpha;
      ctx.fillStyle = n.missing ? '#4a5470' : fragColor(n.frag);
      const r = n.depth <= 1 ? 3.2 : n.depth === 2 ? 2.6 : 2.1;
      ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    for (const n of ghosts) {
      ctx.globalAlpha = n.alpha;
      if (!n.cut && !n.stillNeeded) { // red thread + pulsing ring
        ctx.strokeStyle = 'rgba(255,77,94,0.8)'; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(this.cx, this.cy); ctx.lineTo(n.x, n.y); ctx.stroke();
        ctx.drawImage(this.glowRed, n.x - 16, n.y - 16, 32, 32);
        ctx.strokeStyle = `rgba(255,77,94,${0.5 + 0.5 * pulse})`; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(n.x, n.y, 6 + pulse * 3, 0, Math.PI * 2); ctx.stroke();
      }
      if (n.stillNeeded) { ctx.strokeStyle = 'rgba(255,184,77,0.9)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(n.x, n.y, 7, 0, Math.PI * 2); ctx.stroke(); }
      ctx.fillStyle = n.stillNeeded ? '#ffb84d' : '#ff4d5e';
      ctx.beginPath(); ctx.arc(n.x, n.y, 3.6, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  drawFlashes(now) {
    const { ctx } = this;
    for (const f of this.flashes) {
      const t = (now - f.t0) / 700;
      ctx.strokeStyle = `rgba(255,255,255,${1 - t})`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(f.x, f.y, 6 + t * 26, 0, Math.PI * 2); ctx.stroke();
    }
  }

  drawSpider(now) {
    const { ctx, spider: s } = this;
    ctx.drawImage(this.glowBlue, s.x - 30, s.y - 30, 60, 60);
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(s.angle + Math.PI / 2);
    ctx.strokeStyle = '#f2f6ff'; ctx.fillStyle = '#f2f6ff'; ctx.lineWidth = 1.1; ctx.lineCap = 'round';
    const wig = s.moving ? Math.sin(now / 60) : 0;
    for (let side = -1; side <= 1; side += 2) {
      for (let i = 0; i < 4; i++) {
        const y0 = -3 + i * 2.4;
        const spread = (i - 1.5) * 2.2 + (i % 2 ? wig : -wig) * 1.6;
        ctx.beginPath();
        ctx.moveTo(0, y0);
        ctx.lineTo(side * 6, y0 - 4 + spread * 0.4);
        ctx.lineTo(side * 11, y0 + spread);
        ctx.stroke();
      }
    }
    ctx.beginPath(); ctx.ellipse(0, 2, 3.2, 4.6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(0, -3.6, 2.2, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  drawLabels() {
    const { ctx } = this;
    if (!this.focus) return;
    const n = this.nodes.get(this.focus);
    if (!n || n.gone) return;
    ctx.font = '600 11px ui-monospace, SFMono-Regular, Menlo, monospace';
    const text = n.stillNeeded ? `${n.name} (needed by ${n.stillNeeded})` : n.name;
    const tw = ctx.measureText(text).width;
    // keep the label inside the canvas
    let x = Math.min(Math.max(n.x + 12, 6), this.w - tw - 6);
    const y = Math.min(Math.max(n.y + 22, 14), this.h - 8);
    ctx.fillStyle = 'rgba(10,14,26,0.78)';
    ctx.fillRect(x - 4, y - 11, tw + 8, 15);
    ctx.fillStyle = '#e2e8f5';
    ctx.fillText(text, x, y);
  }

  // ---- share image ---------------------------------------------------------------------

  // lines: {repo, headline, sub, items[]}. Returns a PNG Blob (1200x630).
  snapshot({ repo, headline, sub, items = [], note }) {
    const c = document.createElement('canvas');
    c.width = 1200; c.height = 630;
    const g = c.getContext('2d');
    g.fillStyle = '#0a0e1a'; g.fillRect(0, 0, 1200, 630);
    // square crop around the centre of the web, so it is as large as possible
    const sq = Math.min(this.canvas.width, this.canvas.height);
    g.drawImage(this.canvas, (this.canvas.width - sq) / 2, (this.canvas.height - sq) / 2, sq, sq, 20, 20, 590, 590);
    g.fillStyle = '#101524'; g.fillRect(640, 0, 560, 630);
    g.fillStyle = '#7d8aa5'; g.font = '600 22px ui-monospace, Menlo, monospace'; g.fillText('Dependency Spider', 680, 60);
    g.fillStyle = '#e2e8f5'; g.font = '700 28px ui-monospace, Menlo, monospace'; g.fillText(repo, 680, 110);
    g.fillStyle = '#3ddc97'; g.font = '700 76px system-ui, sans-serif'; g.fillText(headline, 680, 215);
    g.fillStyle = '#7d8aa5'; g.font = '24px system-ui, sans-serif'; g.fillText(sub, 680, 255);
    g.fillStyle = '#e2e8f5'; g.font = '20px ui-monospace, Menlo, monospace';
    // wrap long lines to the panel width instead of letting them run off the image
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
