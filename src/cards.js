// Builds one candidate card. `el(tag, className, text)` is injected so this can be tested without a DOM.

// Shown under every candidate. Deliberately generic: no package or framework is special-cased.
export const CAVEAT = 'Static analysis cannot see packages loaded by name at runtime (view engines, plugins, loaders). Verify before removing.';

export const badgeText = (parent) => `Lower confidence: likely loaded by ${parent} by name`;

export const PARTIAL_BADGE = 'partial scan: unverified';

export function buildCard(el, name, likelyLoadedBy, partialScan = false) {
  const card = el('div', 'card');
  const state = el('div', 'state', 'queued');
  card.append(el('div', 'name', name));
  if (likelyLoadedBy) card.append(el('div', 'badge', badgeText(likelyLoadedBy)));
  if (partialScan) card.append(el('div', 'badge unverified', PARTIAL_BADGE)); // the scan read under 25% of the source files
  card.append(state, el('div', 'caveat', CAVEAT));
  return { card, state };
}
