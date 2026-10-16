// Runs the scanner against real repos and checks the known-good results. Needs network.
// Usage: GITHUB_TOKEN=... node scripts/acceptance.mjs [fastify|hexo|mocha|all]
import { runPipeline } from '../src/pipeline.js';
import { plainReport } from '../src/report.js';

const token = process.env.GITHUB_TOKEN;
const which = process.argv[2] || 'all';
let failures = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failures++; };

const cases = {
  async fastify() {
    const r = await runPipeline('fastify/fastify', { token });
    console.log(plainReport(r));
    const names = r.ghosts.map((g) => g.name).sort();
    // Live data (checked 2026-10-16): fastify's `bench` script runs `branchcmp`, the bin of branch-comparer,
    // so it is correctly NOT a ghost any more. typescript is a peer of tstyche, so it is not reported either.
    check(JSON.stringify(names) === JSON.stringify(['@stylistic/eslint-plugin', '@stylistic/eslint-plugin-js']), `fastify ghosts are the 2 @stylistic packages (got ${names.join(', ')})`);
    const by = Object.fromEntries(r.shed.perGhost.map((g) => [g.name, g]));
    check(by['@stylistic/eslint-plugin']?.stillNeededBy === 'neostandard', '@stylistic/eslint-plugin is still needed by neostandard');
    check(by['@stylistic/eslint-plugin-js']?.shed === 1, `@stylistic/eslint-plugin-js sheds 1 (got ${by['@stylistic/eslint-plugin-js']?.shed})`);
    check(!r.ghosts.some((g) => g.name === 'branch-comparer'), 'branch-comparer is not flagged (used via its bin `branchcmp` in the bench script)');
    check(r.shed.before >= 400 && r.shed.before <= 520, `tree size ~464 (got ${r.shed.before})`);
  },
  async hexo() {
    const r = await runPipeline('hexojs/hexo', { token });
    console.log(plainReport(r));
    check(!r.ghosts.some((g) => g.name === 'hexo-cli'), 'hexo: hexo-cli is NOT flagged');
  },
  async mocha() {
    const r = await runPipeline('mochajs/mocha', { token });
    console.log(plainReport(r));
    console.log('(mocha: no pass/fail expectation, inspect the list above)');
  },
};

for (const [name, fn] of Object.entries(cases)) {
  if (which !== 'all' && which !== name) continue;
  console.log(`\n===== ${name} =====`);
  try { await fn(); } catch (e) { check(false, `${name} threw: ${e.code || ''} ${e.message}`); }
}
process.exit(failures ? 1 : 0);
