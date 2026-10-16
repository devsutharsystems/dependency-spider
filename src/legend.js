// What the dot colours mean, per mode. The swatch values come from the same `fragility()` the dots use, so the
// legend cannot drift from the drawing (test/legend.test.mjs checks that).
import { fragility } from './registry.js';

const f = (maintainers, deprecated = false, modified = null) => fragility({ maintainers, deprecated, modified });
const YEARS = (n) => new Date(Date.now() - n * 365.25 * 86400000).toISOString();

// -> { items: [{ f: 0..1 | null (not on npm), text, cue?: 'ring' | 'hollow' }], tail }
// Cues: packages in the orange/red range (f >= RING_FROM) are drawn with a ring and not-on-npm packages hollow, so the
// meaning never depends on colour alone (colour-blind safe). The swatches in the legend carry the same cues.
export function legendParts(stalenessOn) {
  if (!stalenessOn) {
    return {
      items: [
        { f: f(2), text: '2+ maintainers' },
        { f: f(1), text: '1 maintainer' },
        { f: f(1, true), text: '1 maintainer + deprecated (ring)', cue: 'ring' },
        { f: null, text: 'not on npm (hollow)', cue: 'hollow' },
      ],
      tail: 'Deprecation warms the colour. Age not measured (staleness off).',
    };
  }
  return {
    items: [
      { f: f(2, false, YEARS(0)), text: 'fresh, 2+ maintainers' },
      { f: f(1), text: '1 maintainer: yellow or worse' },
      { f: f(1, true, YEARS(4)), text: 'old, 1 maintainer, deprecated (ring)', cue: 'ring' },
      { f: null, text: 'not on npm (hollow)', cue: 'hollow' },
    ],
    tail: 'Age, 1 maintainer, deprecation push toward red.',
  };
}
