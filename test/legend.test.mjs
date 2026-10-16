import { test } from 'node:test';
import assert from 'node:assert/strict';
import { legendParts } from '../src/legend.js';
import { fragility } from '../src/registry.js';

test('staleness OFF: the legend swatches are exactly what the dots show for those packages', () => {
  const { items, tail } = legendParts(false);
  const colour = (node) => fragility({ modified: null, deprecated: false, ...node });
  assert.equal(items[0].f, colour({ maintainers: 3 })); // several maintainers
  assert.equal(items[1].f, colour({ maintainers: 1 })); // one maintainer
  assert.equal(items[2].f, colour({ maintainers: 1, deprecated: true }));
  assert.ok(items[0].f === 0 && items[1].f > items[0].f && items[2].f > items[1].f);
  assert.equal(items.at(-1).f, null); // grey: not on npm
  assert.match(tail, /not measured/);
  assert.ok(!items.some((i) => /old|age|stale/i.test(i.text)), 'no mention of age while it is not measured');
});

test('staleness ON: green is recent + several maintainers, red needs age (one maintainer alone is only yellow)', () => {
  const { items, tail } = legendParts(true);
  assert.ok(items[0].f < 0.01, "recent + several maintainers is green");
  assert.equal(items[1].f, fragility({ maintainers: 1, deprecated: false, modified: null }));
  assert.ok(items[1].f < 0.5, 'one maintainer alone never reaches red');
  assert.ok(items[2].f > 0.9, 'old + one maintainer + deprecated is (nearly) full red');
  assert.match(tail, /Age, 1 maintainer, deprecation push toward red/);
});

test('the two modes say different things', () => {
  assert.notDeepEqual(legendParts(false), legendParts(true));
});
