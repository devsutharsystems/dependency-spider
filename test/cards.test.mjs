import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCard, CAVEAT } from '../src/cards.js';

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
