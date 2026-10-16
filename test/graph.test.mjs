import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reachable, shedReport, uninstallCommand } from '../src/graph.js';

const mk = (spec) => ({ nodes: new Map(Object.entries(spec).map(([name, deps], i) => [name, { name, deps, depth: 1 + i % 3 }])) });

test('reachable handles cycles and missing deps', () => {
  const g = mk({ a: ['b'], b: ['a', 'zz'] });
  assert.deepEqual([...reachable(g, ['a'])].sort(), ['a', 'b']);
});
test('shed: ghost with private subtree sheds itself and its exclusive deps', () => {
  const g = mk({ ghost: ['x', 'shared'], x: ['y'], y: [], shared: [], keep: ['shared'] });
  const r = shedReport(g, ['ghost', 'keep'], [{ name: 'ghost', section: 'dependencies' }]);
  const gr = r.perGhost[0];
  assert.equal(gr.shed, 3); // ghost, x, y - but not shared
  assert.deepEqual([...gr.shedSet].sort(), ['ghost', 'x', 'y']);
  assert.equal(gr.stillNeededBy, null);
  assert.equal(r.before, 5);
  assert.equal(r.after, 2);
});
test('still needed by: ghost that another package depends on sheds 0 and names the parent', () => {
  const g = mk({ ghost: [], neo: ['ghost'] });
  const r = shedReport(g, ['ghost', 'neo'], [{ name: 'ghost', section: 'devDependencies' }]);
  assert.equal(r.perGhost[0].shed, 0);
  assert.equal(r.perGhost[0].stillNeededBy, 'neo');
  assert.equal(r.combinedShed, 0);
});
test('combined shed is overlap-aware, not a sum', () => {
  const g = mk({ g1: ['common', 'a'], g2: ['common', 'b'], common: ['deep'], deep: [], a: [], b: [], keep: [] });
  const r = shedReport(g, ['g1', 'g2', 'keep'], [{ name: 'g1', section: 'dependencies' }, { name: 'g2', section: 'dependencies' }]);
  assert.equal(r.perGhost[0].shed, 2); // g1 + a   (common stays because g2 needs it)
  assert.equal(r.perGhost[1].shed, 2);
  assert.equal(r.combinedShed, 7 - 1); // everything but keep: sum would be 4
  assert.equal(r.percent, Math.round((6 / 7) * 100));
});
test('uninstallCommand splits prod and dev', () => {
  const cmd = uninstallCommand([{ name: 'a', section: 'dependencies' }, { name: 'b', section: 'devDependencies' }, { name: '@s/c', section: 'devDependencies' }]);
  assert.equal(cmd, 'npm uninstall a\nnpm uninstall -D b @s/c');
  assert.equal(uninstallCommand([]), '');
});
