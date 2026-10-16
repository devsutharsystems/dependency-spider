// Validation: run the scanner on popular non-monorepo JS projects and compare with `depcheck`.
// For every disagreement it records evidence (where my scanner saw the package, or what `git grep` finds).
// Usage: GITHUB_TOKEN=... node scripts/validate.mjs [owner/repo ...]   (default list below)
// Needs network, git and npx. Clones go to clones/ (git-ignored). Output: results/validation.md + .json
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPipeline } from '../src/pipeline.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPOS = process.argv.slice(2).length ? process.argv.slice(2) : [
  'fastify/fastify', 'expressjs/express', 'koajs/koa', 'hexojs/hexo', 'mochajs/mocha', 'postcss/postcss',
  'axios/axios', 'chalk/chalk', 'tj/commander.js', 'winstonjs/winston', 'jprichardson/node-fs-extra', 'debug-js/debug', 'expressjs/body-parser',
];
const token = process.env.GITHUB_TOKEN;
mkdirSync(join(root, 'clones'), { recursive: true });
mkdirSync(join(root, 'results'), { recursive: true });

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], ...opts });

function clone(repo) {
  const dir = join(root, 'clones', repo.replace('/', '__'));
  if (!existsSync(dir)) run('git', ['clone', '--depth', '1', '--quiet', `https://github.com/${repo}.git`, dir]);
  return dir;
}

function depcheck(dir) {
  try {
    // depcheck exits 255 when it finds something, so read stdout either way
    const out = (() => { try { return run('npx', ['--yes', 'depcheck', '--json'], { cwd: dir, timeout: 240000 }); } catch (e) { if (e.stdout) return e.stdout; throw e; } })();
    const j = JSON.parse(out);
    return { unused: [...j.dependencies, ...j.devDependencies].filter((n) => !n.startsWith('@types/')), missing: Object.keys(j.missing || {}) };
  } catch (e) { return { error: String(e.message).split('\n')[0] }; }
}

function grepEvidence(dir, name) {
  try {
    const out = run('git', ['grep', '-l', '-F', name, '--', ':!package.json', ':!package-lock.json', ':!*.lock', ':!*.md', ':!CHANGELOG*', ':!History*'], { cwd: dir });
    const files = out.trim().split('\n').filter(Boolean);
    return files.length ? `git grep finds "${name}" in ${files.slice(0, 2).join(', ')}${files.length > 2 ? ` (+${files.length - 2})` : ''}` : 'no occurrence outside package.json/lockfiles/docs (looks like a true ghost)';
  } catch { return 'no occurrence outside package.json/lockfiles/docs (looks like a true ghost)'; }
}

const rows = [];
for (const repo of REPOS) {
  process.stdout.write(`${repo} ... `);
  const row = { repo };
  try {
    const r = await runPipeline(repo, { token });
    row.mine = r.ghosts.map((g) => g.name).sort();
    row.shed = r.shed.combinedShed; row.before = r.shed.before; row.after = r.shed.after;
    row.filesCapped = r.filesCapped; row.declared = r.counts.declared; row.sourceFiles = `${r.counts.sourceFiles}/${r.counts.eligibleSourceFiles}`;
    row.perGhost = Object.fromEntries(r.shed.perGhost.map((g) => [g.name, g.stillNeededBy ? `needed by ${g.stillNeededBy}` : g.shed]));
    const dir = clone(repo);
    const dc = depcheck(dir);
    if (dc.error) { row.error = `depcheck failed: ${dc.error}`; }
    else {
      row.depcheck = [...dc.unused].sort();
      const m = new Set(row.mine), d = new Set(row.depcheck);
      row.both = row.mine.filter((n) => d.has(n));
      row.mineOnly = row.mine.filter((n) => !d.has(n)).map((n) => ({ name: n, why: grepEvidence(dir, n) }));
      row.depcheckOnly = row.depcheck.filter((n) => !m.has(n)).map((n) => ({ name: n, why: r.evidence[n] ? `mine: ${r.evidence[n]}` : 'mine: not declared in dependencies/devDependencies (e.g. peer/optional)' }));
    }
  } catch (e) { row.error = `${e.code || 'error'}: ${e.message}`; }
  rows.push(row);
  console.log(row.error ? `ERROR ${row.error}` : `mine=${row.mine.length} depcheck=${row.depcheck?.length} both=${row.both?.length}`);
}

writeFileSync(join(root, 'results', 'validation.json'), JSON.stringify(rows, null, 2));
const ok = rows.filter((r) => !r.error);
const sum = (f) => ok.reduce((s, r) => s + f(r), 0);
const md = [
  '# Validation against depcheck',
  '',
  `Generated ${new Date().toISOString().slice(0, 10)} by \`scripts/validate.mjs\`. depcheck was run with \`npx depcheck --json\` in a shallow clone WITHOUT installing the repo's dependencies (so depcheck cannot see installed bins); \`@types/*\` is excluded from its list because my scanner never reports them.`,
  'Neither tool is ground truth. "Disagreement" means the two lists differ; the reason column is evidence, not a verdict.',
  '',
  '| Repo | Declared | Files scanned | My candidates | depcheck unused | Agree | Only mine | Only depcheck | Shed (pkgs) |',
  '|---|---|---|---|---|---|---|---|---|',
  ...rows.map((r) => r.error
    ? `| ${r.repo} | | | | | | | | ${r.error.replace(/\|/g, '/')} |`
    : `| ${r.repo} | ${r.declared} | ${r.sourceFiles}${r.filesCapped ? ' (cap)' : ''} | ${r.mine.length} | ${r.depcheck.length} | ${r.both.length} | ${r.mineOnly.length} | ${r.depcheckOnly.length} | ${r.shed} of ${r.before} |`),
  '',
  `Totals over ${ok.length} repos that ran: mine ${sum((r) => r.mine.length)}, depcheck ${sum((r) => r.depcheck.length)}, in both ${sum((r) => r.both.length)}, only mine ${sum((r) => r.mineOnly.length)}, only depcheck ${sum((r) => r.depcheckOnly.length)}.`,
  `Repos where both tools report exactly the same set: ${ok.filter((r) => !r.mineOnly.length && !r.depcheckOnly.length).length} of ${ok.length}.`,
  '',
  '## Disagreements',
  '',
  ...ok.flatMap((r) => [
    ...r.mineOnly.map((x) => `- **${r.repo}**: only mine: \`${x.name}\` - ${x.why}`),
    ...r.depcheckOnly.map((x) => `- **${r.repo}**: only depcheck: \`${x.name}\` - ${x.why}`),
  ]),
  '',
  '## Agreed candidates',
  '',
  ...ok.filter((r) => r.both.length).map((r) => `- **${r.repo}**: ${r.both.map((n) => `\`${n}\` (${r.perGhost[n]})`).join(', ')}`),
  '',
];
writeFileSync(join(root, 'results', 'validation.md'), md.join('\n'));
console.log('\nwrote results/validation.md');
