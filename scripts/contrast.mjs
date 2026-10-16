// Measures contrast and colour-blind distinguishability for every theme. Usage: node scripts/contrast.mjs
import { THEMES, setTheme, fragColor } from '../src/theme.js';
import { contrast, deuteranope, deltaE } from '../src/color.js';

for (const [id, base] of Object.entries(THEMES)) {
  const t = setTheme(id);
  const bgs = { bg0: t.bg0, bg1: t.bg1, glow: t.glow };
  console.log(`\n=== ${t.name} ===`);
  const nodes = { '2+': t.c2, '1 maint.': t.c1, deprecated: t.cdep, 'dep. end': t.cdep2, 'not on npm': t.cmiss };
  for (const [n, c] of Object.entries(nodes)) console.log(`node ${n.padEnd(11)} ${c}  vs bg0/bg1/glow: ${Object.values(bgs).map((b) => contrast(c, b).toFixed(2)).join(' / ')}  ${Math.min(...Object.values(bgs).map((b) => contrast(c, b))) >= 3 ? 'ok' : 'FAIL (<3)'}`);
  for (const [n, c] of Object.entries({ text: t.text, muted: t.muted })) console.log(`${n.padEnd(11)} ${c}  vs bg0/bg1/glow/panel: ${[...Object.values(bgs), t.panel].map((b) => contrast(c, b).toFixed(2)).join(' / ')}  ${Math.min(...[...Object.values(bgs), t.panel].map((b) => contrast(c, b))) >= 4.5 ? 'ok' : 'FAIL (<4.5)'}`);
  console.log(`accent text on accent ${contrast(t.accentText, t.accent).toFixed(2)}  ${contrast(t.accentText, t.accent) >= 4.5 ? 'ok' : 'FAIL'}; accent on panel ${contrast(t.accent, t.panel).toFixed(2)}; thread vs bg1 ${contrast(t.thread, t.bg1).toFixed(2)}`);
  const four = { '2+': fragColor(0), '1': fragColor(0.4), dep: fragColor(0.7), miss: t.cmiss };
  const sim = Object.fromEntries(Object.entries(four).map(([k, c]) => [k, deuteranope(c)]));
  const names = Object.keys(four); const out = [];
  for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) out.push(`${names[i]}~${names[j]} dE ${deltaE(sim[names[i]], sim[names[j]]).toFixed(0)}`);
  console.log(`deuteranopia pairwise: ${out.join(' | ')}`);
}
