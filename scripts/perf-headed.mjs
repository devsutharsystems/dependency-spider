// Frame-time measurement in a REAL, HEADED browser window (real GPU, native devicePixelRatio, no viewport emulation).
// The headless harness (scripts/perf.mjs) cannot see compositing or GPU fill-rate costs; this one can.
// Usage: node scripts/perf-headed.mjs [fixture=fastify] [--port=8000] [--throttle=4] [--off=tilt,dust,...] [--label=x] [--idle] [--lite]
//   needs Playwright (PW_DIR=<folder where `npm i playwright` was run>) and a Chrome binary (CHROME_PATH=<chrome executable>).
//   Serve the folder first: python3 -m http.server <port>. Prints one JSON line.
// Per phase (build = crawl + web building, prune = cutting; "idle" = the empty page) it reports:
//   interval  time between animation frames in ms (16.7 = 60 fps), and how many frames took > 20 / > 33 ms
//   loaf      Long Animation Frames (Chrome): frames whose main-thread work blocked rendering
//   busy      per-frame busy time of each thread group from a Chrome trace: renderer main thread, compositor,
//             raster workers, GPU process (the part headless cannot see)
// A simulated pointer moves over the canvas the whole time (that is what makes pointer-driven effects cost something).
import { createRequire } from 'node:module';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = (k, d) => (args.find((a) => a.startsWith(`--${k}=`)) || `--${k}=${d}`).split('=').slice(1).join('=');
const fixture = args.find((a) => !a.startsWith('--')) || 'fastify';
const port = opt('port', 8000), throttle = Number(opt('throttle', 1)), off = opt('off', ''), label = opt('label', off || 'run');
const idle = args.includes('--idle'), lite = args.includes('--lite');
const { chromium } = createRequire(join(process.env.PW_DIR || process.cwd(), 'x.js'))('playwright');

const browser = await chromium.launch({ headless: false, executablePath: process.env.CHROME_PATH,
  args: ['--window-size=1440,900', '--window-position=0,0', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows'] });
const ctx = await browser.newContext({ viewport: null }); // real window, native pixel ratio
const page = await ctx.newPage();
if (lite) await page.addInitScript(() => { try { localStorage.setItem('spider-lite', '1'); } catch { /* ignore */ } });
await page.addInitScript(() => {
  const orig = window.requestAnimationFrame.bind(window);
  const rec = { build: { iv: [] }, prune: { iv: [] }, idle: { iv: [] }, loaf: [] };
  let last = 0, phase = 'build', marked = false;
  window.__perf = rec; window.__phase = () => phase;
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) rec.loaf.push({ phase, d: e.duration, b: e.blockingDuration || 0, at: Math.round(e.startTime), scripts: (e.scripts || []).filter((x) => x.duration > 20).map((x) => `${x.sourceFunctionName || x.invoker || '?'} @${(x.sourceURL || '').split('/').slice(-1)[0]}:${x.sourceCharPosition} ${Math.round(x.duration)}ms`).slice(0, 3) }); }).observe({ type: 'long-animation-frame', buffered: true }); } catch { /* not supported */ }
  window.requestAnimationFrame = (cb) => orig((ts) => {
    if (!marked && document.querySelector('#cards .card')) { phase = 'prune'; marked = true; performance.mark('phase:prune'); }
    if (last) rec[window.__idleMode ? 'idle' : phase].iv.push(ts - last);
    last = ts; cb(ts);
  });
});
const cdp = await ctx.newCDPSession(page);
if (throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
const bcdp = await browser.newBrowserCDPSession();
const events = [];
bcdp.on('Tracing.dataCollected', (e) => events.push(...e.value));
const done = new Promise((r) => bcdp.on('Tracing.tracingComplete', r));
const url = idle ? `http://localhost:${port}/?auto=0&off=${off}` : `http://localhost:${port}/?fixture=scripts/fixtures/${fixture}.json&rate=25&off=${off}`;
await page.goto(url, { waitUntil: 'load' });
await page.evaluate(() => { window.__idleMode = false; });
if (idle) await page.evaluate(() => { window.__idleMode = true; });
await page.waitForTimeout(600);
await bcdp.send('Tracing.start', { traceConfig: { includedCategories: ['toplevel', 'blink.user_timing', 'gpu', 'viz'], recordMode: 'recordContinuously' } });
const t0 = Date.now();
await page.evaluate(() => performance.mark('phase:begin'));
let stop = false;
const mover = (async () => { // the pointer wanders over the canvas, like a user watching it
  const box = { x: 120, y: 120, w: 700, h: 560 }; let a = 0;
  while (!stop) { a += 0.18; await page.mouse.move(box.x + box.w / 2 + Math.cos(a) * box.w * 0.4, box.y + box.h / 2 + Math.sin(a * 1.3) * box.h * 0.4).catch(() => {}); await new Promise((r) => setTimeout(r, 30)); }
})();
if (idle) await page.waitForTimeout(9000);
else await page.waitForSelector('#summary:not([hidden])', { timeout: 240000 });
await page.waitForTimeout(800);
stop = true; await mover;
await page.evaluate(() => performance.mark('phase:end'));
await bcdp.send('Tracing.end'); await done;
const rec = await page.evaluate(() => window.__perf);
const dpr = await page.evaluate(() => devicePixelRatio);
await browser.close();

// ---- summarise the trace ----
const names = new Map(), procs = new Map();
for (const e of events) if (e.ph === 'M') { if (e.name === 'thread_name') names.set(`${e.pid}:${e.tid}`, e.args.name); if (e.name === 'process_name') procs.set(e.pid, e.args.name); }
const marks = {}; for (const e of events) if (e.name?.startsWith('phase:')) marks[e.name] = e.ts;
const groupOf = (e) => { const tn = names.get(`${e.pid}:${e.tid}`) || '', pn = procs.get(e.pid) || '';
  if (/GPU/i.test(pn)) return 'gpu'; if (tn === 'CrRendererMain') return 'main'; if (/^Compositor$/.test(tn)) return 'compositor'; if (/CompositorTileWorker|ThreadPoolForegroundWorker/.test(tn) && /Renderer/i.test(pn)) return 'raster'; return null; };
// the page's renderer = the process whose main thread was busiest
const busyBy = new Map();
for (const e of events) if (e.ph === 'X' && e.cat?.includes('toplevel') && e.dur && names.get(`${e.pid}:${e.tid}`) === 'CrRendererMain') busyBy.set(e.pid, (busyBy.get(e.pid) || 0) + e.dur);
const pagePid = [...busyBy.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
const window_ = (from, to) => { const g = { main: 0, compositor: 0, raster: 0, gpu: 0 };
  for (const e of events) { if (e.ph !== 'X' || !e.dur || !e.cat?.includes('toplevel')) continue; if (e.ts < from || e.ts >= to) continue;
    const gname = groupOf(e); if (!gname) continue; if (gname !== 'gpu' && e.pid !== pagePid) continue; g[gname] += e.dur; } return g; };
const q = (a, p) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const r1 = (x) => Math.round(x * 10) / 10;
const begin = marks['phase:begin'] ?? 0, pruneAt = marks['phase:prune'] ?? marks['phase:end'] ?? 0, end = marks['phase:end'] ?? 0;
const summarise = (ph, from, to) => { const iv = rec[ph].iv, n = iv.length || 1, g = window_(from, to);
  const loaf = rec.loaf.filter((l) => l.phase === ph || (idle && ph === 'idle'));
  return { frames: iv.length, seconds: r1((to - from) / 1e6), interval: { p50: r1(q(iv, 0.5)), p95: r1(q(iv, 0.95)), max: r1(Math.max(0, ...iv)), over20: iv.filter((x) => x > 20).length, over33: iv.filter((x) => x > 33.4).length },
    loafBig: loaf.filter((l) => l.d > 100).map((l) => ({ at: l.at, d: Math.round(l.d), scripts: l.scripts })),
    loaf: { count: loaf.length, blockingMs: r1(loaf.reduce((s, l) => s + l.b, 0)), maxMs: r1(Math.max(0, ...loaf.map((l) => l.d))) },
    busyMsPerFrame: { main: r1(g.main / 1000 / n), compositor: r1(g.compositor / 1000 / n), raster: r1(g.raster / 1000 / n), gpu: r1(g.gpu / 1000 / n) } }; };
const out = idle ? { label, idle: true, off, dpr, idleRun: summarise('idle', begin, end) }
  : { label, fixture, throttle, off, dpr, wallSeconds: Math.round((Date.now() - t0) / 1000), build: summarise('build', begin, pruneAt), prune: summarise('prune', pruneAt, end) };
console.log(JSON.stringify(out));
