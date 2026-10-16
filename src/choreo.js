// Pure choreography for the web-building animation. No DOM, no canvas, no clock: everything is a function of
// the delivered packages, so it can be unit-tested.
//
//   WebLayout  gives every delivered package a fixed place (it never moves once placed).
//   Planner    decides where the spider goes next, using ONLY packages that have been delivered, and only
//              along threads that already exist.
//   planWeb    runs the planner over a full list and returns a timeline (used by tests and by Replay math).
//
// Rules this implements: R1 nothing exists before the spider reaches it, R2 the thread tip is the spider,
// R4 going back means walking existing threads, R6 never wanders (no ready target = wait), R7 pace.

export const HUB = '__hub';
export const MAX_RING = 6;

export const PACE = {
  baseSpeed: 300, // px/s while laying a thread at natural speed
  returnFactor: 3, // walking back along existing threads is this much faster
  naturalNodes: 15, // the first nodes are drawn at natural speed so the viewer can see what the spider does
  accel: 0.55, // speed multiplier gained per node after that
  maxMult: 14,
  pause: 0.12, // seconds the spider rests at a freshly anchored node (shrinks as the pace picks up)
  minPause: 0.012,
  dropSeconds: 1.4, // intro: the spider lowers itself from the top on a silk line
  hubPause: 0.35,
};

const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

// Fixed radial layout that can be built incrementally. A package gets an angular slot inside its parent's wedge
// (equal share per child announced by that parent) the moment it is delivered, and keeps it. This is a
// different trade-off from a layout by subtree size (which needs the finished tree): here the spider can start
// building while npm is still answering, and nothing ever re-flows.
export class WebLayout {
  constructor(rootNames) {
    this.rootNames = [...rootNames];
    this.slot = new Map(); // name -> {a0, a1, ring}
    this.kids = new Map(); // name -> number of children announced by it
    this.kidIndex = new Map(); // name -> index among its parent's children
    this.announced = new Set(this.rootNames);
    this.rootIndex = new Map(this.rootNames.map((n, i) => [n, i]));
    this.nextRoot = this.rootNames.length;
  }

  // Called once per delivered package, parents before children. Returns {angle, ring}.
  place(node) {
    let a0, a1;
    if (!node.parent) {
      let i = this.rootIndex.get(node.name);
      if (i === undefined) { i = this.nextRoot++; this.rootIndex.set(node.name, i); }
      const n = Math.max(this.nextRoot, this.rootNames.length, 1);
      a0 = -Math.PI / 2 + (i / n) * Math.PI * 2;
      a1 = -Math.PI / 2 + ((i + 1) / n) * Math.PI * 2;
    } else {
      const ps = this.slot.get(node.parent);
      const count = Math.max(1, this.kids.get(node.parent) || 1);
      const idx = this.kidIndex.get(node.name) ?? 0;
      const span = ps ? ps.a1 - ps.a0 : (Math.PI * 2) / count;
      const base = ps ? ps.a0 : -Math.PI / 2;
      a0 = base + (span * Math.min(idx, count - 1)) / count;
      a1 = base + (span * (Math.min(idx, count - 1) + 1)) / count;
    }
    this.slot.set(node.name, { a0, a1, ring: node.depth });
    // announce the children this package introduces (first announcer = parent, same rule as the crawl)
    const kids = [];
    if (node.depth < MAX_RING) for (const d of node.deps || []) if (!this.announced.has(d)) { this.announced.add(d); kids.push(d); }
    this.kids.set(node.name, kids.length);
    kids.forEach((k, i) => this.kidIndex.set(k, i));
    return { angle: (a0 + a1) / 2, ring: node.depth };
  }
}

// polar -> pixel. A little deterministic radial stagger keeps neighbours in a crowded wedge from stacking.
export function toXY(name, angle, ring, geom) {
  const step = geom.R / MAX_RING;
  const stagger = ring >= 2 ? ((hash(name) % 3) - 1) * step * 0.17 : 0;
  const r = Math.min(geom.R, ring * step + stagger);
  return { x: geom.cx + Math.cos(angle) * r, y: geom.cy + Math.sin(angle) * r };
}

export const lengthOf = (pts) => { let d = 0; for (let i = 1; i < pts.length; i++) d += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); return d; };

// Point at distance `d` along a polyline (clamped to its ends).
export function pointAlong(pts, d, out = { x: 0, y: 0, hx: 0, hy: 0 }) {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (d <= seg || i === pts.length - 1) {
      const t = seg ? Math.min(1, Math.max(0, d / seg)) : 1;
      out.x = a.x + (b.x - a.x) * t; out.y = a.y + (b.y - a.y) * t;
      out.hx = seg ? (b.x - a.x) / seg : 0; out.hy = seg ? (b.y - a.y) / seg : 0;
      return out;
    }
    d -= seg;
  }
  const p = pts[pts.length - 1] || { x: 0, y: 0 };
  out.x = p.x; out.y = p.y; out.hx = 0; out.hy = 0;
  return out;
}

export const multAt = (k, pace = PACE) => (k < pace.naturalNodes ? 1 : Math.min(pace.maxMult, 1 + (k - pace.naturalNodes) * pace.accel));

// The spider's brain. `deliver(node)` when the registry crawl hands a package over, `next()` for the next move.
// `next()` returns null when there is nothing ready: the caller must then hang and wait, not wander.
export class Planner {
  constructor(posOf, pace = PACE) {
    this.posOf = posOf; // name -> {x, y}  (HUB included)
    this.pace = pace;
    this.cur = HUB;
    this.laid = 0;
    this.nodes = new Map(); // delivered packages
    this.visited = new Set([HUB]);
    this.pending = new Map(); // parent name -> delivered, not yet laid children (delivery order)
    this.work = new Set(); // laid packages (and the hub) that have delivered children waiting
  }

  deliver(node) {
    this.nodes.set(node.name, node);
    const p = node.parent || HUB;
    if (!this.pending.has(p)) this.pending.set(p, []);
    this.pending.get(p).push(node.name);
    if (this.visited.has(p)) this.work.add(p); // the parent is already anchored: there is a thread to lay from it
  }

  parentOf(name) { return name === HUB ? null : (this.nodes.get(name).parent || HUB); }

  hasChild(name) { const l = this.pending.get(name); return !!(l && l.length); }

  // Existing threads from `from` to `to`: up to their lowest common ancestor, then down.
  treePath(from, to) {
    const up = [from]; const idx = new Map([[from, 0]]);
    for (let c = from; c !== HUB;) { c = this.parentOf(c); idx.set(c, up.length); up.push(c); }
    const down = [];
    let c = to;
    while (!idx.has(c)) { down.push(c); c = this.parentOf(c); }
    return [...up.slice(0, idx.get(c) + 1), ...down.reverse()];
  }

  next() {
    const pace = this.pace;
    // Spokes first, like an orb-weaver: while declared dependencies are still waiting at the hub, go back to the hub
    // (over the thread just laid) instead of diving down the branch that was just started.
    if (this.cur !== HUB && this.hasChild(HUB)) {
      const names = this.treePath(this.cur, HUB);
      this.cur = HUB;
      return { kind: 'return', names, mult: multAt(this.laid, pace), speed: pace.baseSpeed * multAt(this.laid, pace) * pace.returnFactor, pause: 0 };
    }
    if (this.hasChild(this.cur)) { // lay a thread from here to the next delivered child
      const name = this.pending.get(this.cur).shift();
      if (!this.hasChild(this.cur)) this.work.delete(this.cur);
      const mult = multAt(this.laid++, pace);
      const step = { kind: 'lay', names: [this.cur, name], name, parent: this.cur, mult, speed: pace.baseSpeed * mult, pause: Math.max(pace.minPause, pace.pause / mult) };
      this.visited.add(name);
      if (this.hasChild(name)) this.work.add(name); // its children were delivered before it was laid
      this.cur = name;
      return step;
    }
    // Nothing below here: walk existing threads to the nearest ancestor with work, else to any anchored package with work.
    let target = null;
    for (let a = this.cur; a !== HUB;) { a = this.parentOf(a); if (this.hasChild(a)) { target = a; break; } }
    if (!target) for (const w of this.work) if (this.hasChild(w)) { target = w; break; }
    if (!target) return null;
    const names = this.treePath(this.cur, target);
    const mult = multAt(this.laid, pace);
    this.cur = target;
    return { kind: 'return', names, mult, speed: pace.baseSpeed * mult * pace.returnFactor, pause: 0 };
  }
}

// Builds the whole timeline for a fully delivered list (replay / tests). Steps get absolute times t0..t1 (travel)
// and t1..t2 (rest). All positions come from the same WebLayout the live viz uses.
export function planWeb(nodes, rootNames, geom, pace = PACE) {
  const layout = new WebLayout(rootNames);
  const pos = new Map([[HUB, { x: geom.cx, y: geom.cy }]]);
  const planner = new Planner((n) => pos.get(n), pace);
  for (const n of nodes) { const { angle, ring } = layout.place(n); pos.set(n.name, toXY(n.name, angle, ring, geom)); planner.deliver(n); }
  const steps = [];
  let t = 0;
  const drop = { kind: 'drop', names: [HUB], path: [{ x: geom.cx, y: -30 }, pos.get(HUB)], speed: (geom.cy + 30) / pace.dropSeconds, pause: pace.hubPause, t0: 0 };
  drop.len = lengthOf(drop.path); drop.t1 = drop.t0 + pace.dropSeconds; drop.t2 = drop.t1 + drop.pause; steps.push(drop); t = drop.t2;
  for (let s = planner.next(); s; s = planner.next()) {
    s.path = s.names.map((n) => pos.get(n));
    s.len = lengthOf(s.path);
    s.t0 = t; s.t1 = t + s.len / s.speed; s.t2 = s.t1 + s.pause; t = s.t2;
    steps.push(s);
  }
  return { steps, duration: t, pos, planner, layout };
}

// ---- sampling a timeline (the live viz does the same thing incrementally) ----
const stepAt = (steps, t) => { for (const s of steps) if (t < s.t2) return s; return steps[steps.length - 1]; };

export function spiderAt(steps, t) {
  const s = stepAt(steps, t);
  const d = t >= s.t1 ? s.len : (t - s.t0) * s.speed;
  return pointAlong(s.path, Math.max(0, d), { x: 0, y: 0, hx: 0, hy: 0 });
}

// The thread being laid at time t: from the parent's anchor to the spider (R2). null when no thread is being laid.
export function threadAt(steps, t) {
  const s = stepAt(steps, t);
  if (s.kind !== 'lay' || t >= s.t1) return null;
  return { from: s.path[0], to: spiderAt(steps, t) };
}

// Packages that exist (anchored) at time t, in order.
export const laidBy = (steps, t) => steps.filter((s) => s.kind === 'lay' && t >= s.t1).map((s) => s.name);
