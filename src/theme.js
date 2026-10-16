// The one palette object. CSS variables (applyTheme) and the canvas (viz.js, share image) both read from it.
import { mix, rgba, ensureContrast } from './color.js';

// Node colour stops: f is the fragility value 0..1 (see registry.js `fragility`).
//   f 0 = 2+ maintainers, f 0.4 = one maintainer, f 0.7 = one maintainer + deprecated, f 1 = the far end.
export const THEMES = {
  midnight: { name: 'Midnight Silk', dark: true, additive: true,
    bg0: '#060914', bg1: '#0b1226', glow: '#14204a', panel: '#0d1326', border: '#1c2547', text: '#e8ecff', muted: '#8b96b8',
    accent: '#5eead4', accentText: '#04201c', thread: '#9db4ff', c2: '#5eead4', c1: '#fcd34d', cdep: '#fb923c', cdep2: '#fb7185',
    cmiss: '#64748b', spider: '#f8fafc', spiderGlow: '#9db4ff', ring: '#fb7185' },
  neon: { name: 'Neon Arachnid', dark: true, additive: true,
    bg0: '#07020f', bg1: '#12041f', glow: '#3b0a5e', panel: '#120720', border: '#3a1161', text: '#f5e9ff', muted: '#a98bc7',
    accent: '#22d3ee', accentText: '#001a1f', thread: '#e879f9', c2: '#22d3ee', c1: '#fde047', cdep: '#ff5c8a', cdep2: '#ff3d7f',
    cmiss: '#7c6a96', spider: '#ffffff', spiderGlow: '#ff2bd6', ring: '#ff2bd6' },
  dawn: { name: 'Dawn Dew', dark: false, additive: false,
    bg0: '#f7f2ea', bg1: '#ece4d6', glow: '#fffaf0', panel: '#fffdf8', border: '#e1d6c3', text: '#1f2430', muted: '#6b6558',
    accent: '#0f766e', accentText: '#ffffff', thread: '#475569', c2: '#0e9280', c1: '#b87400', cdep: '#d9482b', cdep2: '#b8321b',
    cmiss: '#768293', spider: '#1f2430', spiderGlow: '#475569', ring: '#d9482b' },
  ember: { name: 'Ember Forge', dark: true, additive: true,
    bg0: '#0c0705', bg1: '#1a0e08', glow: '#5a2a10', panel: '#160d09', border: '#3a2216', text: '#fdeee0', muted: '#b89a85',
    accent: '#fb923c', accentText: '#230d00', thread: '#f0a875', c2: '#7dd3a8', c1: '#fde68a', cdep: '#ef4444', cdep2: '#ff6b6b',
    cmiss: '#8e7f73', spider: '#fff7ed', spiderGlow: '#f0a875', ring: '#f43f5e' },
};
// Non-colour cue: packages in the orange/red range (fragility >= RING_FROM) get a ring, so yellow vs orange never
// depends on colour alone (they are nearly identical under deuteranopia in Midnight and Dawn).
export const RING_FROM = 0.55;
export const THEME_IDS = Object.keys(THEMES);

export let theme = THEMES.midnight;
export let themeId = 'midnight';

// Derived colours every consumer needs (computed once per theme).
function derive(t) {
  const white = '#ffffff', black = '#000000';
  const toward = t.dark ? white : black;
  return {
    ...t,
    card: mix(t.panel, t.text, t.dark ? 0.045 : 0.025),
    borderHi: mix(t.border, t.accent, 0.4),
    shadow: t.dark ? 'rgba(0,0,0,0.45)' : 'rgba(60,44,20,0.14)',
    // text-safe variants of the status colours on the panel (>= 4.5:1): the node colours only need 3:1
    okText: ensureContrast(t.c2, t.panel, 4.5, toward === white ? white : black),
    warnText: ensureContrast(t.c1, t.panel, 4.5, toward),
    badText: ensureContrast(t.ring, t.panel, 4.5, toward),
    accentOnPanel: ensureContrast(t.accent, t.panel, 4.5, toward),
    ringLine: rgba(t.thread, t.dark ? 0.1 : 0.14),
    dust: t.dark ? '#cfd8ff' : '#7a6a50',
  };
}

export function setTheme(id) {
  themeId = THEMES[id] ? id : 'midnight';
  theme = derive(THEMES[themeId]);
  return theme;
}
setTheme('midnight');

// fragility 0..1 -> this theme's node colour
export function fragColor(f, t = theme) {
  const stops = [[0, t.c2], [0.4, t.c1], [0.7, t.cdep], [1, t.cdep2]];
  const x = Math.max(0, Math.min(1, f));
  for (let i = 1; i < stops.length; i++) if (x <= stops[i][0]) return mix(stops[i - 1][1], stops[i][1], (x - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]));
  return t.cdep2;
}

// CSS variables for the page. Everything in style.css reads these.
export function applyTheme(id, root = document.documentElement) {
  const t = setTheme(id);
  const v = { '--bg0': t.bg0, '--bg1': t.bg1, '--glow': t.glow, '--panel': t.panel, '--card': t.card, '--border': t.border, '--border-hi': t.borderHi,
    '--text': t.text, '--muted': t.muted, '--accent': t.accent, '--accent-text': t.accentText, '--accent-on-panel': t.accentOnPanel,
    '--ok': t.okText, '--warn': t.warnText, '--bad': t.badText, '--thread': t.thread, '--shadow': t.shadow,
    '--vignette': rgba(t.bg0, t.dark ? 0.75 : 0.35), '--ring': t.ring, '--glow-pos': t.dark ? '50% 48%' : '18% 6%', '--dust': t.dust };
  for (const [k, val] of Object.entries(v)) root.style.setProperty(k, val);
  root.dataset.theme = id;
  root.style.colorScheme = t.dark ? 'dark' : 'light';
  return t;
}

export function defaultThemeId(prefersDark) { return prefersDark ? 'midnight' : 'dawn'; }
