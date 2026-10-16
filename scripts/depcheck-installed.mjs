// Re-runs depcheck in clones AFTER `npm install --ignore-scripts`, to compare with the no-install baseline.
// Usage: node scripts/depcheck-installed.mjs owner/repo ...   (clones must exist: run scripts/validate.mjs first)
// Output: results/validation-installed.json
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const base = JSON.parse(readFileSync(join(root, 'results', 'validation.json'), 'utf8'));
const run = (cmd, args, cwd, timeout) => execFileSync(cmd, args, { cwd, encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
const renderMd = (rows) => {
  const ok = rows.filter((r) => !r.error);
  const sum = (f) => ok.reduce((n, r) => n + f(r), 0);
  return [
    '# depcheck with installed dependencies (3 repos)',
    '',
    'Each clone got `npm install --ignore-scripts --no-audit --no-fund --legacy-peer-deps`, then `npx depcheck --json` again. `@types/*` excluded. Compare with the no-install baseline in validation.md.',
    '',
    '| Repo | Install (s) | depcheck, no install | depcheck, installed | My candidates | Both (installed) | Only mine now | Only depcheck now |',
    '|---|---|---|---|---|---|---|---|',
    ...rows.map((r) => r.error ? `| ${r.repo} | | | | | | | ${r.error} |` : `| ${r.repo} | ${r.installSeconds} | ${r.depcheckNoInstall.length} | ${r.depcheckInstalled.length} | ${r.mine.length} | ${r.mineInInstalled.length} | ${r.mine.length - r.mineInInstalled.length} (${r.mine.filter((n) => !r.depcheckInstalled.includes(n)).map((n) => '`' + n + '`').join(', ') || '-'}) | ${r.stillOnlyDepcheck.length} (${r.stillOnlyDepcheck.map((n) => '`' + n + '`').join(', ') || '-'}) |`),
    '',
    `Totals: depcheck flags ${sum((r) => r.depcheckNoInstall.length)} without install and ${sum((r) => r.depcheckInstalled.length)} with install; mine ${sum((r) => r.mine.length)}; in both (installed) ${sum((r) => r.mineInInstalled.length)}.`,
    '',
  ].join('\n');
};
if (process.argv[2] === '--recompute') { // keep depcheck's installed output, take my candidates from the current validation.json
  const rows = JSON.parse(readFileSync(join(root, 'results', 'validation-installed.json'), 'utf8')).map((r) => {
    const b = base.find((x) => x.repo === r.repo);
    return { ...r, mine: b.mine, mineInInstalled: b.mine.filter((n) => r.depcheckInstalled.includes(n)), stillOnlyDepcheck: r.depcheckInstalled.filter((n) => !b.mine.includes(n)) };
  });
  writeFileSync(join(root, 'results', 'validation-installed.json'), JSON.stringify(rows, null, 2));
  writeFileSync(join(root, 'results', 'validation-installed.md'), renderMd(rows));
  process.exit(0);
}
if (process.argv[2] === '--render') {
  writeFileSync(join(root, 'results', 'validation-installed.md'), renderMd(JSON.parse(readFileSync(join(root, 'results', 'validation-installed.json'), 'utf8'))));
  process.exit(0);
}
const out = [];
for (const repo of process.argv.slice(2)) {
  const dir = join(root, 'clones', repo.replace('/', '__'));
  const row = { repo };
  const t0 = Date.now();
  try {
    run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--legacy-peer-deps'], dir, 600000);
    row.installSeconds = Math.round((Date.now() - t0) / 1000);
    let json;
    try { json = run('npx', ['--yes', 'depcheck', '--json'], dir, 300000); } catch (e) { json = e.stdout; }
    const j = JSON.parse(json);
    row.depcheckInstalled = [...j.dependencies, ...j.devDependencies].filter((n) => !n.startsWith('@types/')).sort();
    const b = base.find((r) => r.repo === repo);
    row.depcheckNoInstall = b.depcheck; row.mine = b.mine;
    row.mineInInstalled = b.mine.filter((n) => row.depcheckInstalled.includes(n));
    row.stillOnlyDepcheck = row.depcheckInstalled.filter((n) => !b.mine.includes(n));
    row.noLongerFlagged = b.depcheck.filter((n) => !row.depcheckInstalled.includes(n));
  } catch (e) { row.error = String(e.message).split('\n')[0]; }
  out.push(row);
  console.log(JSON.stringify({ ...row, depcheckNoInstall: row.depcheckNoInstall?.length, depcheckInstalled: row.depcheckInstalled?.length }));
}
writeFileSync(join(root, 'results', 'validation-installed.json'), JSON.stringify(out, null, 2));
writeFileSync(join(root, 'results', 'validation-installed.md'), renderMd(out));
