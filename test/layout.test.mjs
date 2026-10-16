import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutRadial } from '../src/layout.js';

test('children stay inside the parent sector; rings follow depth; deterministic', () => {
  const nodes = new Map([
    ['a', { depth: 1, parent: null }], ['b', { depth: 1, parent: null }],
    ['a1', { depth: 2, parent: 'a' }], ['a2', { depth: 2, parent: 'a' }], ['a2x', { depth: 3, parent: 'a2' }],
  ]);
  const l = layoutRadial(nodes);
  assert.equal(l.get('a2x').ring, 3);
  // a has 4 of 5 total weight, so its sector is 4/5 of the circle starting at -pi/2
  const start = -Math.PI / 2, aSpan = (Math.PI * 2 * 4) / 5;
  for (const n of ['a1', 'a2', 'a2x']) assert.ok(l.get(n).angle > start && l.get(n).angle < start + aSpan, n);
  assert.ok(l.get('b').angle > start + aSpan);
  assert.deepEqual([...layoutRadial(nodes)], [...l]);
});
test('handles 900 nodes quickly and puts every angle on the circle', () => {
  const nodes = new Map();
  for (let i = 0; i < 50; i++) nodes.set(`r${i}`, { depth: 1, parent: null });
  for (let i = 0; i < 850; i++) nodes.set(`n${i}`, { depth: 2 + (i % 5), parent: i < 50 ? `r${i}` : `n${i - 50}` });
  const t = Date.now();
  const l = layoutRadial(nodes);
  assert.ok(Date.now() - t < 200);
  assert.equal(l.size, 900);
  for (const { angle } of l.values()) assert.ok(angle >= -Math.PI / 2 && angle <= (3 * Math.PI) / 2 + 1e-9);
});
