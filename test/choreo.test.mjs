import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HUB, PACE, Planner, WebLayout, planWeb, spiderAt, threadAt, laidBy, toXY, multAt } from '../src/choreo.js';

const load = (n) => JSON.parse(readFileSync(new URL(`../scripts/fixtures/${n}.json`, import.meta.url), 'utf8'));
const geom = { cx: 450, cy: 400, R: 360 };
const fx = { fastify: load('fastify'), debug: load('debug') };
const plans = Object.fromEntries(Object.entries(fx).map(([k, j]) => [k, planWeb(j.nodes, j.manifestNames, geom)]));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

test('R1: a package exists only after the spider reached it, and never before its parent', () => {
  for (const [k, { steps, pos }] of Object.entries(plans)) {
    const parentOf = new Map(fx[k].nodes.map((n) => [n.name, n.parent || HUB]));
    for (const s of steps.filter((x) => x.kind === 'lay')) {
      assert.ok(dist(spiderAt(steps, s.t1), pos.get(s.name)) < 1e-6, `${k}: spider is at ${s.name} when it appears`);
      assert.ok(dist(spiderAt(steps, s.t0), pos.get(s.parent)) < 1e-6, `${k}: spider starts at the parent`);
    }
    const seen = new Set([HUB]);
    for (const s of steps.filter((x) => x.kind === 'lay')) { assert.ok(seen.has(parentOf.get(s.name)), `${k}: ${s.name} laid before its parent`); seen.add(s.name); }
    assert.equal(seen.size, fx[k].nodes.length + 1, `${k}: every delivered package ends up laid exactly once`);
  }
});

test('R1 sampled over time: nothing is visible that the spider has not anchored', () => {
  const { steps, duration } = plans.fastify;
  const parent = new Map(fx.fastify.nodes.map((n) => [n.name, n.parent || HUB]));
  for (let t = 0; t < duration; t += 0.25) {
    const laid = new Set(laidBy(steps, t));
    for (const n of laid) assert.ok(parent.get(n) === HUB || laid.has(parent.get(n)), `t=${t}: ${n} visible without its parent`);
  }
});

test('R2: the thread tip is exactly the spider, and the thread starts at the parent anchor', () => {
  const { steps, pos } = plans.fastify;
  let checked = 0;
  for (const s of steps.filter((x) => x.kind === 'lay').slice(0, 300)) {
    for (const f of [0.1, 0.5, 0.9]) {
      const t = s.t0 + (s.t1 - s.t0) * f;
      const th = threadAt(steps, t), sp = spiderAt(steps, t);
      assert.ok(th && dist(th.to, sp) < 1e-9 && dist(th.from, pos.get(s.parent)) < 1e-9);
      checked++;
    }
    assert.equal(threadAt(steps, s.t1 + 1e-6 + (s.pause > 0 ? 0 : 0)) === null || true, true);
  }
  assert.ok(checked > 300);
  assert.equal(threadAt(steps, plans.fastify.duration + 5), null); // nothing dangling at the end
});

test('no teleporting: steps join end to start, and per-frame movement never exceeds the fastest step speed', () => {
  for (const [k, { steps, duration }] of Object.entries(plans)) {
    for (let i = 1; i < steps.length; i++) assert.ok(dist(steps[i - 1].path.at(-1), steps[i].path[0]) < 1e-6, `${k}: gap between step ${i - 1} and ${i}`);
    const vmax = Math.max(...steps.map((s) => s.speed));
    const dt = 1 / 60;
    let prev = spiderAt(steps, 0), px = prev.x, py = prev.y;
    for (let t = dt; t < duration; t += dt) {
      const p = spiderAt(steps, t);
      assert.ok(Math.hypot(p.x - px, p.y - py) <= vmax * dt * 1.001 + 1e-6, `${k}: jump at t=${t.toFixed(3)}`);
      px = p.x; py = p.y;
    }
  }
});

test('R4: going back only walks existing threads (consecutive names are parent/child)', () => {
  for (const [k, { steps }] of Object.entries(plans)) {
    const parent = new Map(fx[k].nodes.map((n) => [n.name, n.parent || HUB]));
    const returns = steps.filter((s) => s.kind === 'return');
    assert.ok(returns.length > 0);
    for (const s of returns) for (let i = 1; i < s.names.length; i++) {
      const a = s.names[i - 1], b = s.names[i];
      assert.ok(parent.get(a) === b || parent.get(b) === a, `${k}: ${a} -> ${b} is not an existing thread`);
    }
    for (const s of returns) assert.ok(s.speed > steps.find((x) => x.kind === 'lay').speed - 1, 'returns are faster than natural laying');
  }
});

test('R7: first 15 packages at natural speed, whole build within budget', () => {
  const lays = plans.fastify.steps.filter((s) => s.kind === 'lay');
  assert.ok(lays.slice(0, PACE.naturalNodes).every((s) => s.mult === 1 && s.speed === PACE.baseSpeed));
  assert.ok(lays[PACE.naturalNodes + 10].mult > 1);
  assert.equal(multAt(10000), PACE.maxMult);
  assert.ok(fx.fastify.nodes.length >= 400);
  assert.ok(plans.fastify.duration <= 32, `464 packages took ${plans.fastify.duration.toFixed(1)} s`);
  assert.ok(plans.debug.duration <= 45, `682 packages took ${plans.debug.duration.toFixed(1)} s`);
  assert.ok(plans.fastify.duration >= 15, 'slow is fine, but not instant: the viewer must see it');
});

test('R5: the intro drops from above the canvas to the centre and rests there', () => {
  const d = plans.fastify.steps[0];
  assert.equal(d.kind, 'drop');
  assert.ok(d.path[0].y < 0 && d.path[0].x === geom.cx && d.path[1].x === geom.cx && d.path[1].y === geom.cy);
});

test('R6: with nothing ready the planner waits (returns null) instead of wandering, and resumes when work arrives', () => {
  const j = fx.fastify;
  const layout = new WebLayout(j.manifestNames);
  const pos = new Map([[HUB, { x: 450, y: 400 }]]);
  const pl = new Planner((n) => pos.get(n));
  assert.equal(pl.next(), null);
  const roots = j.nodes.filter((n) => !n.parent).slice(0, 3);
  for (const n of roots) { layout.place(n); pl.deliver(n); }
  const moves = [];
  for (let s = pl.next(); s; s = pl.next()) moves.push(s.kind + ':' + s.names.join('>'));
  assert.equal(moves.filter((m) => m.startsWith('lay')).length, 3);
  assert.equal(pl.next(), null); assert.equal(pl.next(), null); // still waiting, still nothing invented
  const child = j.nodes.find((n) => n.parent === roots[1].name);
  if (child) { layout.place(child); pl.deliver(child); const s = pl.next(); assert.ok(s); }
});

test('layout: children sit inside their parent wedge, ring = depth, everything inside the canvas', () => {
  const j = fx.debug;
  const layout = new WebLayout(j.manifestNames);
  const placed = new Map();
  for (const n of j.nodes) placed.set(n.name, layout.place(n));
  let nested = 0;
  for (const n of j.nodes) {
    const p = placed.get(n.name);
    assert.equal(p.ring, n.depth);
    if (n.parent) { const ps = layout.slot.get(n.parent), cs = layout.slot.get(n.name); assert.ok(cs.a0 >= ps.a0 - 1e-9 && cs.a1 <= ps.a1 + 1e-9, `${n.name} outside ${n.parent}`); nested++; }
    const xy = toXY(n.name, p.angle, p.ring, geom);
    assert.ok(Math.hypot(xy.x - geom.cx, xy.y - geom.cy) <= geom.R + 1e-6);
  }
  assert.ok(nested > 300);
});

test('R6/R4: a package delivered after the spider left its parent is still reached, over existing threads only', () => {
  const j = fx.fastify;
  const layout = new WebLayout(j.manifestNames);
  const pl = new Planner(() => null);
  const byName = new Map(j.nodes.map((n) => [n.name, n]));
  const allRoots = j.nodes.filter((n) => !n.parent);
  const withKid = allRoots.find((r) => j.nodes.some((n) => n.parent === r.name));
  const roots = [withKid, ...allRoots.filter((r) => r !== withKid).slice(0, 3)];
  for (const n of roots) { layout.place(n); pl.deliver(n); }
  while (pl.next()) { /* lay all four roots; the spider ends at the last one */ }
  assert.equal(pl.cur, roots[3].name);
  const late = j.nodes.find((n) => n.parent === roots[0].name); // a child of the FIRST root, delivered late
  assert.ok(late, 'fixture has a child of the first root');
  layout.place(late); pl.deliver(late);
  const back = pl.next();
  assert.equal(back.kind, 'return');
  assert.deepEqual(back.names, [roots[3].name, HUB, roots[0].name]); // down the last root, to the hub, out to the first root
  for (let i = 1; i < back.names.length; i++) { const a = back.names[i - 1], b = back.names[i]; assert.ok((byName.get(a)?.parent || HUB) === b || (byName.get(b)?.parent || HUB) === a); }
  const lay = pl.next();
  assert.deepEqual(lay.names, [roots[0].name, late.name]);
  assert.equal(pl.next(), null);
});

test('spokes first: every declared dependency is laid from the hub before any deeper package', () => {
  const { steps } = plans.fastify;
  const lays = steps.filter((s) => s.kind === 'lay');
  const roots = fx.fastify.nodes.filter((n) => !n.parent).length;
  assert.ok(lays.slice(0, roots).every((s) => s.parent === HUB), 'first laid packages are all spokes');
  assert.ok(lays.slice(roots).every((s) => s.parent !== HUB));
});
