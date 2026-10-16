import { test } from 'node:test';
import assert from 'node:assert/strict';
import { THEMES, THEME_IDS, setTheme, fragColor, RING_FROM, defaultThemeId } from '../src/theme.js';
import { contrast, deuteranope, deltaE, mix } from '../src/color.js';

const KEYS = ['name', 'dark', 'additive', 'bg0', 'bg1', 'glow', 'panel', 'border', 'text', 'muted', 'accent', 'accentText', 'thread', 'c2', 'c1', 'cdep', 'cdep2', 'cmiss', 'spider', 'spiderGlow', 'ring'];
const backgrounds = (t) => [t.bg0, t.bg1, t.glow];

test('four themes, each with the full palette, default follows the colour scheme', () => {
  assert.deepEqual(THEME_IDS, ['midnight', 'neon', 'dawn', 'ember']);
  for (const id of THEME_IDS) for (const k of KEYS) assert.ok(THEMES[id][k] !== undefined, `${id}.${k}`);
  assert.equal(defaultThemeId(true), 'midnight');
  assert.equal(defaultThemeId(false), 'dawn');
  assert.equal(THEMES.dawn.additive, false, 'light theme uses normal blending');
});

test('node colours have at least 3:1 contrast against bg0, bg1 and the centre glow, in every theme', () => {
  for (const id of THEME_IDS) {
    const t = setTheme(id);
    for (const [n, c] of Object.entries({ c2: t.c2, c1: t.c1, cdep: t.cdep, cdep2: t.cdep2, cmiss: t.cmiss, ring: t.ring, thread: t.thread }))
      for (const bg of backgrounds(t)) assert.ok(contrast(c, bg) >= 3, `${id}.${n} ${c} vs ${bg} = ${contrast(c, bg).toFixed(2)}`);
  }
});

test('text and muted text have at least 4.5:1 on every background and on the panel; button text on accent too', () => {
  for (const id of THEME_IDS) {
    const t = setTheme(id);
    for (const c of [t.text, t.muted]) for (const bg of [...backgrounds(t), t.panel]) assert.ok(contrast(c, bg) >= 4.5, `${id} ${c} on ${bg} = ${contrast(c, bg).toFixed(2)}`);
    assert.ok(contrast(t.accentText, t.accent) >= 4.5, `${id} button`);
    for (const c of [t.okText, t.warnText, t.badText, t.accentOnPanel]) assert.ok(contrast(c, t.panel) >= 4.5, `${id} status text ${c}`);
  }
});

test('under deuteranopia the four node colours stay distinguishable (by colour, the ring cue or the hollow cue)', () => {
  for (const id of THEME_IDS) {
    setTheme(id);
    const four = { two: [fragColor(0), 0], one: [fragColor(0.4), 0.4], dep: [fragColor(0.7), 0.7], miss: [THEMES[id].cmiss, 0] };
    const names = Object.keys(four);
    for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
      const [a, fa] = four[names[i]], [b, fb] = four[names[j]];
      const byColour = deltaE(deuteranope(a), deuteranope(b)) >= 20;
      const byRing = (fa >= RING_FROM) !== (fb >= RING_FROM);
      const byHollow = (names[i] === 'miss') !== (names[j] === 'miss'); // not-on-npm packages are drawn hollow
      assert.ok(byColour || byRing || byHollow, `${id}: ${names[i]} vs ${names[j]} dE ${deltaE(deuteranope(a), deuteranope(b)).toFixed(1)} and no ring/hollow cue`);
    }
  }
});

test('the ring cue marks exactly the deprecated/old range, not one-maintainer alone', () => {
  assert.ok(0.4 < RING_FROM && 0.7 >= RING_FROM);
});

test('fragColor hits the palette stops and interpolates between them', () => {
  const t = setTheme('midnight');
  assert.equal(fragColor(0), t.c2); assert.equal(fragColor(0.4), t.c1); assert.equal(fragColor(0.7), t.cdep); assert.equal(fragColor(1), t.cdep2);
  assert.equal(fragColor(0.2), mix(t.c2, t.c1, 0.5));
  assert.equal(fragColor(5), t.cdep2);
});
