// Browser UI: wires the form and the pipeline events to the panel and the canvas.
import { runPipeline } from './pipeline.js';
import { fragility } from './registry.js';
import { fragColor, Viz } from './viz.js';
import { prText, ghostLine } from './report.js';

const $ = (id) => document.getElementById(id);
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const viz = new Viz($('web'), { reducedMotion: reduced });
window.__viz = viz; // handy for debugging in the console

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

function resetUi() {
  $('error').hidden = true;
  $('progress').hidden = true;
  $('summary').hidden = true;
  $('pr-box').hidden = true;
  $('also').hidden = true;
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

function tweenCount(to, ms = 600) {
  const node = $('count');
  const from = Number(node.textContent) || 0;
  if (reduced || from === to) { node.textContent = to; return; }
  const t0 = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - t0) / ms);
    node.textContent = Math.round(from + (to - from) * t);
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

async function start() {
  if (busy) return;
  busy = true;
  $('scan').disabled = true;
  resetUi();
  $('progress').hidden = false;
  const logItems = [];
  let fetched = 0;
  const withModified = $('stale').checked;
  try {
    const result = await runPipeline($('url').value, {
      token: $('token').value.trim() || undefined,
      withModified,
      onEvent: (e) => {
        if (e.type === 'phase' && e.phase === 'scan') { $('count-label').textContent = 'reading the repo'; $('status').textContent = 'Listing files and reading package.json…'; }
        if (e.type === 'package') $('status').textContent = `package.json read: ${Object.keys(e.pkg.dependencies || {}).length + Object.keys(e.pkg.devDependencies || {}).length} declared dependencies`;
        if (e.type === 'files') { $('count').textContent = e.done; $('count-label').textContent = `of ${e.total} files fetched`; $('bar-fill').style.width = `${(e.done / e.total) * 100}%`; }
        if (e.type === 'imports') $('status').textContent = `${e.count} distinct packages imported in the code`;
        if (e.type === 'phase' && e.phase === 'crawl') { fetched = 0; $('count').textContent = '0'; $('count-label').textContent = 'packages'; $('bar-fill').style.width = '0%'; }
        if (e.type === 'node') {
          fetched++;
          viz.addNode(e.node, fragility(e.node));
          viz.follow(e.node.name);
          $('count').textContent = fetched;
          $('count-label').textContent = `of ${e.count} packages`;
          $('bar-fill').style.width = `${(fetched / e.count) * 100}%`;
          $('status').textContent = `fetching ${e.node.name}`;
          logItems.push([e.node.name, fragColor(fragility(e.node))]);
          if (logItems.length > 8) logItems.shift();
          $('log').replaceChildren(...logItems.slice().reverse().map(([n, c]) => { const li = el('li'); const d = el('span', 'dot'); d.style.background = c; li.append(d, el('span', null, n)); return li; }));
        }
        if (e.type === 'modified') viz.setFrag(e.node.name, fragility(e.node));
      },
    });
    current = result;
    await showResult(result);
  } catch (err) {
    $('error').textContent = friendly(err);
    $('error').hidden = false;
    $('progress').hidden = true;
  } finally {
    busy = false;
    $('scan').disabled = false;
  }
}

async function showResult(r) {
  const s = r.shed;
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

  viz.applyTargets();
  viz.markGhosts(r.ghosts);
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
    const c = el('div', 'card');
    c.append(el('div', 'name', g.name), el('div', 'state', 'queued'));
    cards.set(g.name, c);
    $('cards').append(c);
  }
  await viz.wait(700);
  await viz.prune(s, {
    onCount: (n) => tweenCount(n),
    onGhost: (name, state, info) => {
      const c = cards.get(name);
      const g = s.perGhost.find((x) => x.name === name);
      if (state === 'cutting') { c.className = 'card cutting'; c.lastChild.textContent = 'cutting…'; }
      else if (g.stillNeededBy) { c.className = 'card needed'; c.lastChild.textContent = `still needed by ${g.stillNeededBy}, removing it will not shrink the tree`; }
      else { c.className = 'card done'; c.lastChild.textContent = `cut: ${info.removed} ${info.removed === 1 ? 'package' : 'packages'} gone`; }
    },
  });
  $('count-label').textContent = 'packages in your tree';
  $('summary').hidden = false;
  const num = el('span', 'num', `-${s.combinedShed}`);
  $('sum-big').replaceChildren(num, document.createTextNode(` ${s.combinedShed === 1 ? 'package' : 'packages'}`));
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
if (q.get('repo')) { $('url').value = q.get('repo'); if (q.get('auto') !== '0') start(); }
