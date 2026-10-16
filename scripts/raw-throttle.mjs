// Measures how raw.githubusercontent.com behaves when many files are fetched (what a deep scan does).
// Usage: node scripts/raw-throttle.mjs owner/repo [--files=1500] [--concurrency=8]    (needs network; 1 GitHub API call)
// Uses the same picker and fetcher as the app (8 parallel requests, retry with backoff on 429/5xx, stop after 3 failures in a row)
// and counts every HTTP status that came back, including the retried ones.
import { parseRepoUrl, fetchTree, pickSourceFiles, fetchMany } from '../src/github.js';

const args = process.argv.slice(2);
const repo = parseRepoUrl(args.find((a) => !a.startsWith('--')));
const opt = (k, d) => Number((args.find((a) => a.startsWith(`--${k}=`)) || `--${k}=${d}`).split('=')[1]);
const want = opt('files', 1500), concurrency = opt('concurrency', 8);
const tree = await fetchTree(repo);
const eligible = pickSourceFiles(tree.paths, Infinity).length;
const picked = pickSourceFiles(tree.paths, want);
console.log(`${repo.owner}/${repo.repo}: ${tree.paths.length} files in the tree (truncated: ${tree.truncated}), ${eligible} eligible source files, requesting ${picked.length}`);

const status = {}; let requests = 0, bytes = 0; const t0 = Date.now(); const marks = [];
const counting = async (url, init) => {
  requests++; const r = await fetch(url, init); status[r.status] = (status[r.status] || 0) + 1;
  const len = Number(r.headers.get('content-length') || 0); bytes += len;
  return r;
};
let last = 0;
const { texts, failed, aborted } = await fetchMany(picked, { ...repo, fetch: counting, concurrency, onProgress: (done) => { if (done - last >= 250 || done === picked.length) { last = done; marks.push(`${done} files after ${((Date.now() - t0) / 1000).toFixed(1)} s`); } } });
const secs = (Date.now() - t0) / 1000;
const read = [...texts.values()].filter((t) => t != null).length;
console.log(JSON.stringify({ repo: `${repo.owner}/${repo.repo}`, requested: picked.length, read, notFound: [...texts.values()].filter((t) => t == null).length - failed.length, failed: failed.length, aborted, httpRequests: requests, status, seconds: Math.round(secs * 10) / 10, filesPerSecond: Math.round((read / secs) * 10) / 10, megabytes: Math.round(bytes / 1e4) / 100, concurrency, progress: marks }, null, 1));
