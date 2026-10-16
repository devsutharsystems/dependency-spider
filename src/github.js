// GitHub access: URL parsing, file list (trees API), raw file fetching, source-file ranking.
// `fetch` is injectable everywhere so the tests run offline.
import { SpiderError, fetchRetry, mapLimit } from './util.js';

export function parseRepoUrl(input) {
  let s = String(input || '').trim().replace(/[?#].*$/, '');
  if (!s) return null;
  s = s.replace(/^git\+/, '').replace(/^git@github\.com:/i, 'https://github.com/').replace(/^ssh:\/\/git@github\.com\//i, 'https://github.com/');
  const hadHost = /^(https?:\/\/)?(www\.)?github\.com\//i.test(s);
  s = s.replace(/^(https?:\/\/)?(www\.)?github\.com\//i, '');
  const parts = s.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  if (!hadHost && (parts[0].includes('.') || parts[0].includes(':'))) return null; // some other host
  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/i, '');
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(owner)) return null;
  if (!/^[A-Za-z0-9._-]+$/.test(repo) || repo === '.' || repo === '..') return null;
  return { owner, repo };
}

export function rawUrl(owner, repo, path, ref = 'HEAD') {
  return `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${path.split('/').map(encodeURIComponent).join('/')}`;
}

function rateLimitError(res) {
  const reset = Number(res.headers.get('x-ratelimit-reset')) || 0;
  const when = reset ? new Date(reset * 1000).toLocaleTimeString() : 'later';
  return new SpiderError('RATE_LIMIT',
    `GitHub API rate limit reached (60 requests/hour without a token). It resets at ${when}. You can paste a token to raise the limit.`,
    { resetAt: reset });
}

async function api(path, fetchFn, token) {
  const init = token ? { headers: { Authorization: `Bearer ${token}` } } : undefined; // token only ever goes to api.github.com
  const res = await fetchRetry(fetchFn, `https://api.github.com${path}`, init);
  if (res.status === 429 || (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0')) throw rateLimitError(res);
  return res;
}

// Lists every file path of the repo. Tries HEAD first, falls back to the default branch.
export async function fetchTree({ owner, repo }, { fetch: fetchFn = globalThis.fetch, token } = {}) {
  let ref = 'HEAD';
  let res = await api(`/repos/${owner}/${repo}/git/trees/HEAD?recursive=1`, fetchFn, token);
  if (res.status === 404) {
    const info = await api(`/repos/${owner}/${repo}`, fetchFn, token);
    if (info.status === 404) throw new SpiderError('REPO_NOT_FOUND', `Repository ${owner}/${repo} was not found (or it is private).`);
    if (!info.ok) throw new SpiderError('GITHUB_ERROR', `GitHub answered ${info.status} for ${owner}/${repo}.`);
    ref = (await info.json()).default_branch;
    res = await api(`/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`, fetchFn, token);
  }
  if (!res.ok) throw new SpiderError('GITHUB_ERROR', `GitHub answered ${res.status} while listing files of ${owner}/${repo}.`);
  const data = await res.json();
  return { ref, truncated: !!data.truncated, paths: data.tree.filter((t) => t.type === 'blob').map((t) => t.path) };
}

export async function fetchPackageJson({ owner, repo }, { fetch: fetchFn = globalThis.fetch, ref = 'HEAD' } = {}) {
  const res = await fetchRetry(fetchFn, rawUrl(owner, repo, 'package.json', ref));
  if (res.status === 404) throw new SpiderError('NO_PACKAGE_JSON', 'No package.json at the root of this repo. Dependency Spider only handles JS/TS projects with a root package.json.');
  if (!res.ok) throw new SpiderError('GITHUB_ERROR', `Could not read package.json (HTTP ${res.status}).`);
  try { return JSON.parse(await res.text()); } catch { throw new SpiderError('BAD_PACKAGE_JSON', 'package.json is not valid JSON.'); }
}

// ---- choosing which files to fetch ------------------------------------------------------

const SOURCE_EXT = /\.(js|jsx|ts|tsx|mjs|cjs|mts|cts)$/;
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', 'vendor']);
const TEST_DIRS = new Set(['test', 'tests', '__tests__', 'spec', 'specs', '__mocks__', 'e2e', 'integration']);
const FIXTURE_DIRS = new Set(['fixtures', 'fixture', '__fixtures__']);
const EXAMPLE_DIRS = new Set(['example', 'examples', 'benchmark', 'benchmarks', 'bench', 'docs', 'doc', 'demo', 'demos', 'playground', 'sample', 'samples']);
const TOOLING_DIRS = new Set(['scripts', 'tools', '.github', '.husky']);
const ROOT_CONFIG = /^(\.[\w-]*rc(\.[\w.]+)?|[\w-]+\.config\.[\w.]+|\.?(babel|eslint|jest|webpack|rollup|vite|vitest|mocha|karma|nyc|c8|prettier|stylelint|postcss|tsup|ava|tap|commitlint|lintstagedrc|release|swc)[\w.-]*\.(js|cjs|mjs|ts|json|ya?ml)|tsconfig[\w.-]*\.json|Makefile|gulpfile\.\w+|Gruntfile\.\w+)$/i;

// Classifies a path: 'src' | 'test' | 'fixture' | 'example' | 'tooling'.
export function kindOf(path) {
  const segs = path.toLowerCase().split('/');
  const dirs = segs.slice(0, -1);
  const file = segs[segs.length - 1];
  if (dirs.some((d) => FIXTURE_DIRS.has(d))) return 'fixture';
  if (dirs.some((d) => TEST_DIRS.has(d)) || /\.(test|spec)\.[a-z]+$/.test(file)) return 'test';
  if (dirs.some((d) => EXAMPLE_DIRS.has(d))) return 'example';
  if (dirs.length === 0 && ROOT_CONFIG.test(path)) return 'tooling';
  if (dirs.length && TOOLING_DIRS.has(dirs[0])) return 'tooling';
  return 'src';
}

const TIER = { src: 0, tooling: 1, example: 1, test: 2, fixture: 2 };
const MAIN_DIRS = new Set(['lib', 'src', 'bin']);
const WORKSPACE_ROOTS = new Set(['packages', 'apps', 'libs', 'modules', 'plugins', 'projects', 'services', 'crates']);

// The part of the repo a file belongs to: a workspace package (`packages/foo`) or a top-level directory; '' for root files.
export function groupOf(path) {
  const segs = path.split('/');
  if (segs.length === 1) return '';
  if (WORKSPACE_ROOTS.has(segs[0]) && segs.length > 2) return `${segs[0]}/${segs[1]}`;
  return segs[0];
}

// Up to `cap` source files. Real source first and tests last (so a test-heavy repo does not push its real source out
// of the cap and invent false ghosts), and WITHIN each of those tiers round-robin across top-level directories and
// workspace packages, so every package of a monorepo gets some coverage instead of the alphabetically first one eating the cap.
export function pickSourceFiles(paths, cap = 300) {
  const items = paths
    .filter((p) => SOURCE_EXT.test(p) && !p.endsWith('.d.ts') && !p.endsWith('.d.mts') && !p.endsWith('.d.cts'))
    .filter((p) => !p.split('/').slice(0, -1).some((d) => SKIP_DIRS.has(d)))
    .map((p) => {
      const segs = p.split('/');
      return { p, tier: TIER[kindOf(p)], group: groupOf(p), key: [segs.length === 1 || MAIN_DIRS.has(segs[0]) ? 0 : 1, segs.length] };
    })
    .sort((a, b) => a.key[0] - b.key[0] || a.key[1] - b.key[1] || (a.p < b.p ? -1 : 1));
  const out = [];
  for (let tier = 0; tier <= 2 && out.length < cap; tier++) {
    const groups = new Map();
    for (const it of items) if (it.tier === tier) { if (!groups.has(it.group)) groups.set(it.group, []); groups.get(it.group).push(it.p); }
    const lists = [...groups.keys()].sort().map((g) => groups.get(g));
    for (let round = 0; out.length < cap; round++) {
      let any = false;
      for (const l of lists) if (round < l.length) { out.push(l[round]); any = true; if (out.length >= cap) break; }
      if (!any) break;
    }
  }
  return out;
}

// Config-like files that can mention tools: root configs, any tsconfig*.json, .husky/*, and
// extensionless scripts (kept later only if they start with `#!`).
export function pickConfigFiles(paths) {
  const out = new Set();
  const extensionless = [];
  for (const p of paths) {
    const segs = p.split('/');
    const base = segs[segs.length - 1];
    if (segs.includes('node_modules')) continue;
    if (segs.length === 1 && ROOT_CONFIG.test(p)) out.add(p);
    else if (/^tsconfig[\w.-]*\.json$/i.test(base)) out.add(p);
    else if (segs[0] === '.husky' && segs[1] !== '_') out.add(p);
    else if (!base.includes('.') && /^[a-z]/.test(base) && (segs.length === 1 || (segs.length === 2 && (segs[0] === 'bin' || segs[0] === 'scripts')))) extensionless.push(p);
  }
  for (const p of extensionless.slice(0, 20)) out.add(p);
  return [...out];
}

// Fetches many raw files, 8 at a time. Missing files (404) map to null; `failed` lists other errors. After
// `maxConsecutiveFailures` failures in a row (rate limit, network) it stops early: `aborted` is true, files not yet
// requested are left out of `texts`, and the caller works with what was read.
export async function fetchMany(paths, { owner, repo, ref = 'HEAD', fetch: fetchFn = globalThis.fetch, concurrency = 8, onProgress, maxConsecutiveFailures = 3, retry } = {}) {
  const texts = new Map();
  const failed = [];
  let done = 0, consecutive = 0, aborted = false;
  await mapLimit(paths, concurrency, async (p) => {
    if (aborted) return;
    let ok = false;
    try {
      const res = await fetchRetry(fetchFn, rawUrl(owner, repo, p, ref), undefined, retry);
      if (res.ok) { texts.set(p, await res.text()); ok = true; }
      else { texts.set(p, null); if (res.status === 404) ok = true; else failed.push(p); }
    } catch { texts.set(p, null); failed.push(p); }
    consecutive = ok ? 0 : consecutive + 1;
    if (consecutive >= maxConsecutiveFailures) aborted = true;
    onProgress?.(++done, paths.length);
  });
  return { texts, failed, aborted };
}
