import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCard, CAVEAT, badgeText } from '../src/cards.js';

// Minimal fake element, enough to check what a card contains.
const el = (tag, className, text) => ({ tag, className, textContent: text ?? '', children: [], append(...c) { this.children.push(...c); } });

test('every candidate card renders the runtime-loading caveat', () => {
  const { card, state } = buildCard(el, 'some-package');
  const texts = card.children.map((c) => c.textContent);
  assert.deepEqual(texts, ['some-package', 'queued', CAVEAT]);
  assert.equal(card.children[2].className, 'caveat');
  assert.equal(state.textContent, 'queued');
  assert.match(CAVEAT, /loaded by name at runtime \(view engines, plugins, loaders\)\. Verify before removing\.$/);
});
test('the caveat is generic: it names no package or framework', () => {
  assert.doesNotMatch(CAVEAT, /hbs|express|handlebars/i);
});
test('a card with a likely parent shows the lower-confidence badge between name and state', () => {
  const { card } = buildCard(el, 'acme-tool-plugin-a', 'acme-tool');
  assert.deepEqual(card.children.map((c) => c.textContent), ['acme-tool-plugin-a', 'Lower confidence: likely loaded by acme-tool by name', 'queued', CAVEAT]);
  assert.equal(card.children[1].className, 'badge');
  assert.equal(badgeText('x-y'), 'Lower confidence: likely loaded by x-y by name');
});

test('a candidate from a weak scan gets the "partial scan: unverified" badge; a normal scan does not', async () => {
  const { PARTIAL_BADGE } = await import('../src/cards.js');
  const weak = buildCard(el, 'some-package', undefined, true).card.children.map((c) => c.textContent);
  assert.deepEqual(weak, ['some-package', 'partial scan: unverified', 'queued', CAVEAT]);
  assert.equal(PARTIAL_BADGE, 'partial scan: unverified');
  const normal = buildCard(el, 'some-package').card.children.map((c) => c.textContent);
  assert.ok(!normal.includes('partial scan: unverified'));
  const both = buildCard(el, 'p', 'parent', true).card.children.map((c) => c.textContent);
  assert.deepEqual(both.slice(1, 3), ['Lower confidence: likely loaded by parent by name', 'partial scan: unverified']);
});
