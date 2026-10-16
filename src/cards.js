// Builds one candidate card. `el(tag, className, text)` is injected so this can be tested without a DOM.

// Shown under every candidate. Deliberately generic: no package or framework is special-cased.
export const CAVEAT = 'Static analysis cannot see packages loaded by name at runtime (view engines, plugins, loaders). Verify before removing.';

export function buildCard(el, name) {
  const card = el('div', 'card');
  const state = el('div', 'state', 'queued');
  card.append(el('div', 'name', name), state, el('div', 'caveat', CAVEAT));
  return { card, state };
}
