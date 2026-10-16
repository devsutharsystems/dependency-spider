// Runs the real pipeline on repos with the normal cap (300 files) and the deep cap (1,500), and compares the candidates.
// Usage: node scripts/deep-compare.mjs owner/repo [owner/repo ...]       (needs network; 1 GitHub API call per run)
// Prints one JSON line per run: files read, eligible, percent, banner state, candidates, early stop, seconds, error code.
import { runPipeline } from '../src/pipeline.js';
import { scanBanner } from '../src/scanstate.js';

for (const repo of process.argv.slice(2)) {
  const runs = {};
  for (const [mode, maxFiles] of [['shallow', 300], ['deep', 1500]]) {
    const t0 = Date.now();
    try {
      const r = await runPipeline(repo, { maxFiles });
      runs[mode] = { read: r.scan.read, eligible: r.scan.eligible, percent: r.scan.percentText, state: r.scan.state, banner: scanBanner(r.scan)?.level ?? 'none', aborted: r.fetchAborted, candidates: r.ghosts.map((g) => g.name).sort(), shed: r.shed.combinedShed, tree: r.shed.before, seconds: Math.round((Date.now() - t0) / 100) / 10 };
    } catch (e) { runs[mode] = { error: e.code || 'error', message: e.message.slice(0, 160), seconds: Math.round((Date.now() - t0) / 100) / 10 }; }
  }
  const a = runs.shallow.candidates, b = runs.deep.candidates;
  console.log(JSON.stringify({ repo, ...runs, disappearedWithDeepScan: a && b ? a.filter((n) => !b.includes(n)) : null, appearedWithDeepScan: a && b ? b.filter((n) => !a.includes(n)) : null }));
}
