// What the dot colours mean, per mode. The swatch values come from the same `fragility()` the dots use, so the
// legend cannot drift from the drawing (test/legend.test.mjs checks that).
import { fragility } from './registry.js';

const f = (maintainers, deprecated = false, modified = null) => fragility({ maintainers, deprecated, modified });
const YEARS = (n) => new Date(Date.now() - n * 365.25 * 86400000).toISOString();

// -> { items: [{ f: 0..1 | null (grey), text }], tail }
export function legendParts(stalenessOn) {
  if (!stalenessOn) {
    return {
      items: [
        { f: f(2), text: '2+ maintainers' },
        { f: f(1), text: '1 maintainer' },
        { f: f(1, true), text: '1 maintainer + deprecated' },
        { f: null, text: 'not on npm' },
      ],
      tail: 'Deprecated shifts toward red. Age not measured (staleness off).',
    };
  }
  return {
    items: [
      { f: f(2, false, YEARS(0)), text: 'fresh, 2+ maintainers' },
      { f: f(1), text: '1 maintainer: yellow or worse' },
      { f: f(1, true, YEARS(4)), text: 'old, 1 maintainer, deprecated' },
      { f: null, text: 'not on npm' },
    ],
    tail: 'Age, 1 maintainer, deprecation push toward red.',
  };
}
