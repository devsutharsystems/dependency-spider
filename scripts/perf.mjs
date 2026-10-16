// Animation performance test in a real headless Chromium, on a RECORDED scan (no network).
// Usage: node scripts/perf.mjs [fixture=debug] [--throttle=4] [--dpr=2] [--profile] [--json]
// Needs Playwright, which this project deliberately does not depend on:
//   PW_DIR=<folder where `npm i playwright` was run>  CHROME_PATH=<chrome/chrome-headless-shell binary, optional>
// Serves nothing itself: start `python3 -m http.server 8000` in the project folder first (or set PORT=... for another server).
// Reports, per phase (build = crawl + web building, prune = cutting):
//   interval = time between animation frames (what the viewer sees; >20 ms = a dropped frame at 60 Hz)
//   script   = main-thread time spent inside the page's own requestAnimationFrame callbacks
import { createRequire } from 'node:module';
import { join } from 'node:path';

const args = process.argv.slice(2);
const fixture = args.find((a) => !a.startsWith('--')) || 'debug';
const throttle = Number((args.find((a) => a.startsWith('--throttle=')) || '--throttle=1').split('=')[1]);
const profile = args.includes('--profile');
const dpr = Number((args.find((a) => a.startsWith('--dpr=')) || '--dpr=1').split('=')[1]);
const asJson = args.includes('--json');
const req = createRequire(join(process.env.PW_DIR || process.cwd(), 'x.js'));
const { chromium } = req('playwright');

const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: dpr });
const client = await page.context().newCDPSession(page);
if (throttle > 1) await client.send('Emulation.setCPUThrottlingRate', { rate: throttle });
if (profile) { await client.send('Profiler.enable'); await client.send('Profiler.start'); }

await page.addInitScript(() => {
  const orig = window.requestAnimationFrame.bind(window);
  const rec = { build: { iv: [], cb: [] }, prune: { iv: [], cb: [] } };
  let lastTs = 0, curTs = -1, curCb = 0, curPhase = 'build';
  const flush = () => { if (curTs >= 0) rec[curPhase].cb.push(curCb); };
  window.__perf = rec;
  window.requestAnimationFrame = (cb) => orig((ts) => {
    if (ts !== curTs) {
      flush();
      curPhase = document.querySelector('#cards .card') ? 'prune' : 'build';
      if (lastTs) rec[curPhase].iv.push(ts - lastTs);
      lastTs = ts; curTs = ts; curCb = 0;
    }
    const t0 = performance.now();
    cb(ts);
    curCb += performance.now() - t0;
  });
});

const t0 = Date.now();
await page.goto(`http://localhost:${process.env.PORT || 8000}/?fixture=scripts/fixtures/${fixture}.json&rate=25`);
await page.waitForSelector('#summary:not([hidden])', { timeout: 300000 });
await page.waitForTimeout(500);
const wall = (Date.now() - t0) / 1000;
const rec = await page.evaluate(() => window.__perf);
let top = [];
if (profile) {
  const { profile: pr } = await client.send('Profiler.stop');
  const self = new Map(); const byId = new Map(pr.nodes.map((n) => [n.id, n]));
  pr.samples.forEach((id, i) => { const n = byId.get(id); const key = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').slice(-2).join('/')}:${n.callFrame.lineNumber + 1}`; self.set(key, (self.get(key) || 0) + (pr.timeDeltas[i] || 0)); });
  const total = [...self.values()].reduce((a, b) => a + b, 0);
  top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => ({ fn: k, ms: Math.round(v / 1000), pct: Math.round((v / total) * 100) }));
}
const q = (a, p) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const fmt = (x) => Math.round(x * 10) / 10;
const stats = (o) => ({ frames: o.iv.length, interval: { p50: fmt(q(o.iv, 0.5)), p95: fmt(q(o.iv, 0.95)), max: fmt(Math.max(0, ...o.iv)), over20: o.iv.filter((x) => x > 20).length },
  script: { p50: fmt(q(o.cb, 0.5)), p95: fmt(q(o.cb, 0.95)), max: fmt(Math.max(0, ...o.cb)) } });
const out = { fixture, throttle, dpr, wallSeconds: Math.round(wall), build: stats(rec.build), prune: stats(rec.prune), top };
if (asJson) console.log(JSON.stringify(out));
else {
  console.log(`fixture=${fixture} cpu-throttle=${throttle}x dpr=${dpr} wall=${out.wallSeconds}s`);
  for (const ph of ['build', 'prune']) { const s = out[ph]; console.log(`${ph}: ${s.frames} frames | interval ms p50 ${s.interval.p50} p95 ${s.interval.p95} max ${s.interval.max}, >20ms: ${s.interval.over20} | script ms p50 ${s.script.p50} p95 ${s.script.p95} max ${s.script.max}`); }
  if (top.length) { console.log('top self time:'); for (const t of top) console.log(`  ${String(t.pct).padStart(3)}%  ${String(t.ms).padStart(6)} ms  ${t.fn}`); }
}
await browser.close();
