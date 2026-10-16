// Browser UI: wires the form and the pipeline events to the panel and the canvas.
import { runPipeline } from './pipeline.js';
import { fragility } from './registry.js';
import { fragColor, Viz } from './viz.js';
import { applyTheme, defaultThemeId, THEMES, THEME_IDS, themeId, theme } from './theme.js';
import { prText, ghostLine } from './report.js';
import { buildCard } from './cards.js';
import { deserializeResult } from './fixture.js';
import { legendParts } from './legend.js';

const $ = (id) => document.getElementById(id);
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
// Theme before the canvas is built: the canvas reads the same palette object as the CSS.
let savedTheme = null;
try { savedTheme = localStorage.getItem('spider-theme'); } catch { /* storage can be blocked: the page works without it */ }
applyTheme(savedTheme || defaultThemeId(window.matchMedia('(prefers-color-scheme: dark)').matches));
const viz = new Viz($('web'), { reducedMotion: reduced });
window.__viz = viz; // handy for debugging in the console
window.__spider = { get result() { return current; } };

const EXAMPLES = ['fastify/fastify', 'mochajs/mocha', 'hexojs/hexo', 'expressjs/express'];
for (const ex of EXAMPLES) {
  const b = document.createElement('button');
  b.type = 'button'; b.textContent = ex;
  b.addEventListener('click', () => { $('url').value = `github.com/${ex}`; start(); });
  $('examples').append(b);
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

let busy = false;
let current = null; // last result, for the buttons

function friendly(err) {
  if (err && err.name === 'SpiderError') return err.message;
  if (err instanceof TypeError) return 'Network error: could not reach GitHub or the npm registry. Check your connection and try again.';
  return `Unexpected error: ${err && err.message ? err.message : err}`;
}

// One line under the canvas saying what the dot colours encode in THIS scan (it depends on the staleness box).
let legendOn = false;
function renderLegend(stalenessOn) {
  legendOn = stalenessOn;
  const { items, tail } = legendParts(stalenessOn);
  const box = $('legend');
  box.replaceChildren();
  for (const it of items) {
    const item = el('span', 'item'); // swatch and label stay together when the line wraps (phone)
    const sw = el('span', `sw${it.cue ? ` ${it.cue}` : ''}`); // ring / hollow: the same non-colour cues the canvas draws
    sw.style.setProperty('--sw', it.f === null ? theme.cmiss : fragColor(it.f));
    item.append(sw, document.createTextNode(it.text));
    box.append(item, document.createTextNode(' '));
  }
  box.append(document.createTextNode(`·\u00a0${tail}`)); // non-breaking space keeps the dot with the first word of the tail
}
// ---- themes: a small selector; the choice is saved if storage works, and the page works without it ----
function chooseTheme(id, save = true) {
  applyTheme(id);
  viz.themeChanged();
  renderLegend(legendOn);
  for (const b of $('themes').children) b.setAttribute('aria-pressed', String(b.dataset.id === id));
  if (save) { try { localStorage.setItem('spider-theme', id); } catch { /* ignore: storage blocked */ } }
}
for (const id of THEME_IDS) {
  const t = THEMES[id], b = document.createElement('button');
  b.type = 'button'; b.className = 'theme-btn'; b.dataset.id = id; b.title = t.name; b.setAttribute('aria-label', `${t.name} theme`);
  b.style.setProperty('--tb', `linear-gradient(135deg, ${t.bg1} 0 45%, ${t.accent} 45% 100%)`);
  b.setAttribute('aria-pressed', String(id === themeId));
  b.addEventListener('click', () => chooseTheme(id));
  $('themes').append(b);
}
if (!savedTheme) { // no saved choice: follow the system scheme if it changes
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', (e) => { let s2 = null; try { s2 = localStorage.getItem('spider-theme'); } catch { /* ignore */ } if (!s2) chooseTheme(defaultThemeId(e.matches), false); });
}

// count-up for the headline number (skipped for reduced motion)
function countUp(node, to, ms = 700) {
  if (reduced || to === 0) { node.textContent = to; return; }
  const t0 = performance.now();
  const step = (now) => { const k = Math.min(1, (now - t0) / ms); node.textContent = Math.round(to * (1 - (1 - k) ** 3)); if (k < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}

renderLegend($('stale').checked);
$('stale').addEventListener('change', () => { if (!busy) renderLegend($('stale').checked); });

function resetUi() {
  $('error').hidden = true;
  $('progress').hidden = true;
  $('summary').hidden = true;
  $('pr-box').hidden = true;
  $('also').hidden = true;
  $('replay').hidden = true; $('skip').hidden = false; hud.mode = 'idle';
  $('pr-text').textContent = 'PR text';
  $('copy-cmd').textContent = 'Copy command';
  $('log').replaceChildren();
  $('cards').replaceChildren();
  $('warnings').replaceChildren();
  $('bar-fill').style.width = '0%';
  $('count').textContent = '0';
  $('count-label').textContent = '';
  $('status').textContent = '';
  viz.reset();
  viz.resize();
}

function warn(text) { $('warnings').append(el('div', 'warn', text)); }

// DOM numbers are written at most 10 times a second, from what the spider has actually built (not per package).
const hud = { mode: 'idle', count: 0 };
let hudLast = '';
function renderHud() {
  if (hud.mode === 'build') {
    const st = viz.stats;
    const label = `of ${st.delivered} packages`;
    const sig = `${st.laid}|${label}|${st.waiting}|${st.recent.length}|${st.recent.at(-1)?.name}`;
    if (sig === hudLast) return;
    hudLast = sig;
    $('count').textContent = st.laid;
    $('count-label').textContent = label;
    $('bar-fill').style.width = `${st.delivered ? (st.laid / st.delivered) * 100 : 0}%`;
    $('status').textContent = st.waiting ? 'the spider is waiting for npm to answer…' : (st.recent.at(-1) ? `anchoring ${st.recent.at(-1).name}` : 'the spider is lowering itself…');
    $('log').replaceChildren(...st.recent.slice().reverse().map((r) => { const li = el('li'); const d = el('span', 'dot'); d.style.background = r.color; li.append(d, el('span', null, r.name)); return li; }));
  } else if (hud.mode === 'prune') {
    if ($('count').textContent !== String(hud.count)) $('count').textContent = hud.count;
  }
}
setInterval(renderHud, 100);

// One handler for pipeline events, shared by live scans and fixture replay.
function makeEventHandler() {
  return (e) => {
    if (e.type === 'phase' && e.phase === 'scan') { $('count-label').textContent = 'reading the repo'; $('status').textContent = 'Listing files and reading package.json…'; }
    if (e.type === 'package') {
      const names = [...new Set([...Object.keys(e.pkg.dependencies || {}), ...Object.keys(e.pkg.devDependencies || {})])];
      $('status').textContent = `package.json read: ${names.length} declared dependencies`;
      viz.begin(names); // the spider lowers itself from the top while the files are fetched
    }
    if (e.type === 'files') { $('count').textContent = e.done; $('count-label').textContent = `of ${e.total} files fetched`; $('bar-fill').style.width = `${(e.done / e.total) * 100}%`; }
    if (e.type === 'imports') $('status').textContent = `${e.count} distinct packages imported in the code`;
    if (e.type === 'phase' && e.phase === 'crawl') { hud.mode = 'build'; hudLast = ''; $('count').textContent = '0'; $('count-label').textContent = 'packages'; $('bar-fill').style.width = '0%'; }
    if (e.type === 'node') viz.addNode(e.node, fragility(e.node)); // handed to the spider; it gets there in its own time
    if (e.type === 'modified') viz.setFrag(e.node.name, fragility(e.node));
  };
}

async function start() {
  if (busy) return;
  busy = true;
  $('scan').disabled = true;
  resetUi();
  viz.setHint(false);
  $('progress').hidden = false;
  const withModified = $('stale').checked;
  renderLegend(withModified);
  try {
    const result = await runPipeline($('url').value, {
      token: $('token').value.trim() || undefined,
      withModified,
      onEvent: makeEventHandler(),
    });
    current = result;
    await showResult(result);
  } catch (err) {
    $('error').textContent = friendly(err);
    $('error').hidden = false;
    $('progress').hidden = true;
    viz.reset(); // back to the hanging spider
  } finally {
    busy = false;
    $('scan').disabled = false;
  }
}

// Feeds a recorded scan (src/fixture.js) through the same handler a live scan uses, `rate` ms per package,
// so the animation can be tested and replayed without the network.
async function playResult(result, rate = 0) {
  if (busy) return;
  busy = true;
  $('scan').disabled = true;
  resetUi();
  viz.setHint(false);
  $('progress').hidden = false;
  renderLegend([...result.graph.nodes.values()].some((n) => n.modified)); // colours use `modified` only if the scan had it
  try {
    const handler = makeEventHandler();
    handler({ type: 'package', pkg: result.pkg });
    handler({ type: 'phase', phase: 'crawl' });
    const list = [...result.graph.nodes.values()];
    for (let i = 0; i < list.length; i++) {
      handler({ type: 'node', node: list[i], count: list.length });
      if (rate && !viz.skipping && i % 4 === 3) await new Promise((r) => setTimeout(r, rate * 4));
    }
    current = result;
    await showResult(result);
  } finally {
    busy = false;
    $('scan').disabled = false;
  }
}

async function showResult(r) {
  const s = r.shed;
  viz.markGhosts(r.ghosts);
  viz.finishDelivery();
  await viz.built; // the spider finishes laying every delivered package before anything is cut
  hud.mode = 'idle';
  $('skip').hidden = false;
  $('log').replaceChildren();
  $('status').textContent = '';
  $('count-label').textContent = 'packages in your tree';
  $('count').textContent = s.before;
  $('bar-fill').style.width = '100%';
  if (r.capped) warn(`Package cap reached: the tree was cut at ${r.graph.nodes.size} packages, so shed numbers are approximate.`);
  if (r.filesCapped) warn(`File cap reached: scanned ${r.counts.sourceFiles} of ${r.counts.eligibleSourceFiles} source files (tests last). Candidates may include false ghosts, verify each one.`);
  if (r.truncatedTree) warn('GitHub truncated the file list for this huge repo, so some files were not scanned.');
  if (r.registryErrors) warn(`${r.registryErrors} packages could not be read from the npm registry and are shown without their dependencies.`);
  if (r.counts.failedFiles) warn(`${r.counts.failedFiles} files could not be fetched and were skipped.`);

  fillAlso(r);

  if (!r.ghosts.length) {
    $('summary').hidden = false;
    $('sum-big').textContent = 'No unused candidates found';
    $('sum-sub').textContent = `${s.before} packages in the tree. Static analysis can miss things, this is not a guarantee.`;
    $('command').textContent = '';
    $('command').hidden = true;
    for (const id of ['copy-cmd', 'pr-text']) $(id).hidden = true;
    return;
  }
  $('command').hidden = false;
  for (const id of ['copy-cmd', 'pr-text']) $(id).hidden = false;

  const cards = new Map();
  $('cards').append(el('h2', null, 'Unused candidates'), el('div', 'muted', 'never imported, not in scripts or config'));
  for (const g of s.perGhost) {
    const { card, state } = buildCard(el, g.name, g.likelyLoadedBy);
    cards.set(g.name, { card, state });
    $('cards').append(card);
  }
  await viz.wait(700);
  hud.mode = 'prune'; hud.count = s.before;
  await viz.prune(s, {
    onCount: (n) => { hud.count = n; },
    onGhost: (name, state, info) => {
      const { card, state: stateEl } = cards.get(name);
      const g = s.perGhost.find((x) => x.name === name);
      if (state === 'cutting') { card.className = 'card cutting'; stateEl.textContent = 'cutting…'; }
      else if (g.stillNeededBy) { card.className = 'card needed'; stateEl.textContent = `still needed by ${g.stillNeededBy}, removing it will not shrink the tree`; }
      else { card.className = 'card done'; stateEl.textContent = `cut: ${info.removed} ${info.removed === 1 ? 'package' : 'packages'} gone`; }
    },
  });
  hud.mode = 'idle'; $('count').textContent = s.after;
  $('count-label').textContent = 'packages in your tree';
  $('skip').hidden = true; $('replay').hidden = false;
  $('summary').hidden = false;
  const num = el('span', 'num', '0');
  $('sum-big').replaceChildren(document.createTextNode('-'), num, document.createTextNode(` ${s.combinedShed === 1 ? 'package' : 'packages'}`));
  countUp(num, s.combinedShed);
  $('sum-sub').textContent = `${s.before} to ${s.after} (${s.percent}% smaller)`;
  $('command').textContent = r.command;
}

function fillAlso(r) {
  const body = $('also-body');
  body.replaceChildren();
  const section = (title, items) => {
    if (!items.length) return;
    body.append(el('h3', null, title));
    const ul = el('ul'); ul.style.margin = '0'; ul.style.padding = '0';
    for (const t of items) ul.append(el('li', null, t));
    body.append(ul);
  };
  section('Misplaced (prod dependency used only elsewhere)', r.misplaced.map((m) => `${m.name}: ${m.reason}`));
  section('Phantom (imported but not declared)', r.phantoms.map((p) => `${p.name} (${p.files.join(', ')})`));
  section('Not reported: needed as a peer dependency', (r.peerKept || []).map((k) => `${k.name}: peer of ${k.neededBy}`));
  $('also').hidden = !body.childNodes.length;
}

$('skip').addEventListener('click', () => { viz.skip(); });
$('replay').addEventListener('click', () => { if (current) playResult(current, 0); });

$('form').addEventListener('submit', (e) => { e.preventDefault(); start(); });

$('copy-cmd').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('command').textContent); $('copy-cmd').textContent = 'Copied'; }
  catch { $('copy-cmd').textContent = 'Copy failed'; }
  setTimeout(() => { $('copy-cmd').textContent = 'Copy command'; }, 1500);
});
$('pr-text').addEventListener('click', async () => {
  if (!current) return;
  const text = prText(current);
  $('pr-box').value = text;
  $('pr-box').hidden = false;
  try { await navigator.clipboard.writeText(text); $('pr-text').textContent = 'PR text (copied)'; } catch { /* the box is selectable */ }
});
$('dl-img').addEventListener('click', async () => {
  if (!current) return;
  const s = current.shed;
  const blob = await viz.snapshot({
    repo: `${current.repo.owner}/${current.repo.repo}`,
    headline: s.combinedShed ? `-${s.combinedShed} packages` : 'No candidates',
    sub: `${s.before} to ${s.after} (${s.percent}% smaller)`,
    items: s.perGhost.map((g) => ghostLine(g)),
    note: 'Candidates only. Verify before removing.',
  });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `dependency-spider-${current.repo.repo}.png`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
});

const q = new URLSearchParams(location.search);
if (q.get('fixture')) {
  fetch(q.get('fixture')).then((r) => r.json()).then((j) => { $('url').value = `${j.repo.owner}/${j.repo.repo}`; playResult(deserializeResult(j), Number(q.get('rate') || 25)); });
}
if (q.get('repo')) { $('url').value = q.get('repo'); if (q.get('auto') !== '0') start(); }
