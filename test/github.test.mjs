import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRepoUrl, rawUrl, pickSourceFiles, pickConfigFiles, kindOf, fetchTree, fetchMany } from '../src/github.js';

test('parseRepoUrl forms', () => {
  const want = { owner: 'fastify', repo: 'fastify' };
  for (const s of ['https://github.com/fastify/fastify', 'github.com/fastify/fastify', 'fastify/fastify', 'https://www.github.com/fastify/fastify/',
    'git@github.com:fastify/fastify.git', 'https://github.com/fastify/fastify.git', 'https://github.com/fastify/fastify/tree/main/lib', '  fastify/fastify  ',
    'https://github.com/fastify/fastify?tab=readme#x'])
    assert.deepEqual(parseRepoUrl(s), want, s);
  assert.deepEqual(parseRepoUrl('mochajs/mocha.js'), { owner: 'mochajs', repo: 'mocha.js' });
});
test('parseRepoUrl rejects junk', () => {
  for (const s of ['', 'fastify', 'https://gitlab.com/a/b', 'example.com/a/b', 'a/', '-bad/repo', 'https://github.com/only'])
    assert.equal(parseRepoUrl(s), null, s);
});
test('rawUrl', () => assert.equal(rawUrl('a', 'b', 'lib/x y.js'), 'https://raw.githubusercontent.com/a/b/HEAD/lib/x%20y.js'));

test('pickSourceFiles: filters and ranks tests last', () => {
  const tests = Array.from({ length: 50 }, (_, i) => `test/t${i}.js`);
  const paths = ['index.js', 'lib/a.js', 'src/b.ts', 'node_modules/x/i.js', 'dist/o.js', 'build/o.js', 'coverage/c.js', 'vendor/v.js', 'types/a.d.ts', 'README.md', 'other/z.mjs', ...tests];
  const out = pickSourceFiles(paths, 6);
  assert.deepEqual(out.slice(0, 3).sort(), ['index.js', 'lib/a.js', 'src/b.ts']);
  assert.ok(out.includes('other/z.mjs'));
  assert.equal(out.length, 6);
  assert.ok(out.filter((p) => p.startsWith('test/')).length === 2, 'tests fill only the leftover slots');
  const all = pickSourceFiles(paths, 300);
  assert.ok(!all.some((p) => /node_modules|dist|build|coverage|vendor|\.d\.ts/.test(p)));
});
test('cap ranking: test-heavy repo keeps real source', () => {
  const paths = [...Array.from({ length: 400 }, (_, i) => `test/t${i}.js`), ...Array.from({ length: 30 }, (_, i) => `lib/m${i}.js`)];
  const out = pickSourceFiles(paths, 300);
  assert.equal(out.filter((p) => p.startsWith('lib/')).length, 30);
});
test('kindOf', () => {
  assert.equal(kindOf('lib/a.js'), 'src');
  assert.equal(kindOf('test/a.js'), 'test');
  assert.equal(kindOf('lib/a.test.js'), 'test');
  assert.equal(kindOf('test/fixtures/a.js'), 'fixture');
  assert.equal(kindOf('examples/a.js'), 'example');
  assert.equal(kindOf('benchmarks/a.js'), 'example');
  assert.equal(kindOf('scripts/a.js'), 'tooling');
  assert.equal(kindOf('eslint.config.js'), 'tooling');
  assert.equal(kindOf('index.js'), 'src');
});
test('pickConfigFiles: configs, tsconfigs anywhere, husky, extensionless', () => {
  const out = pickConfigFiles(['.eslintrc.json', '.mocharc.yml', 'babel.config.js', 'package.json', 'packages/x/tsconfig.build.json', '.husky/pre-commit', '.husky/_/husky.sh',
    'bin/hexo', 'LICENSE', 'lib/a.js', 'node_modules/y/tsconfig.json', 'scripts/release']);
  for (const p of ['.eslintrc.json', '.mocharc.yml', 'babel.config.js', 'packages/x/tsconfig.build.json', '.husky/pre-commit', 'bin/hexo', 'scripts/release']) assert.ok(out.includes(p), p);
  for (const p of ['package.json', '.husky/_/husky.sh', 'LICENSE', 'lib/a.js', 'node_modules/y/tsconfig.json']) assert.ok(!out.includes(p), p);
});

const res = (status, body, headers = {}) => ({ status, ok: status >= 200 && status < 300, headers: { get: (k) => headers[k.toLowerCase()] ?? null }, json: async () => body, text: async () => String(body) });

test('fetchTree: HEAD ok, truncated flag, only blobs', async () => {
  const f = async () => res(200, { truncated: true, tree: [{ type: 'blob', path: 'a.js' }, { type: 'tree', path: 'lib' }] });
  assert.deepEqual(await fetchTree({ owner: 'o', repo: 'r' }, { fetch: f }), { ref: 'HEAD', truncated: true, paths: ['a.js'] });
});
test('fetchTree: falls back to default branch on 404', async () => {
  const urls = [];
  const f = async (u) => { urls.push(u); if (u.includes('/trees/HEAD')) return res(404, {}); if (u.endsWith('/repos/o/r')) return res(200, { default_branch: 'trunk' }); return res(200, { tree: [{ type: 'blob', path: 'x.js' }] }); };
  const out = await fetchTree({ owner: 'o', repo: 'r' }, { fetch: f });
  assert.equal(out.ref, 'trunk');
  assert.ok(urls.at(-1).includes('/trees/trunk'));
});
test('fetchTree: repo not found, rate limit, token only goes to the API', async () => {
  const nf = async () => res(404, {});
  await assert.rejects(fetchTree({ owner: 'o', repo: 'r' }, { fetch: nf }), { code: 'REPO_NOT_FOUND' });
  const rl = async () => res(403, {}, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1800000000' });
  await assert.rejects(fetchTree({ owner: 'o', repo: 'r' }, { fetch: rl }), (e) => e.code === 'RATE_LIMIT' && /resets at/.test(e.message));
  let seen;
  await fetchTree({ owner: 'o', repo: 'r' }, { token: 'T', fetch: async (u, init) => { seen = [u, init]; return res(200, { tree: [] }); } });
  assert.ok(seen[0].startsWith('https://api.github.com/'));
  assert.equal(seen[1].headers.Authorization, 'Bearer T');
});
test('fetchMany: 404 -> null, never sends headers', async () => {
  const inits = [];
  const f = async (u, init) => { inits.push(init); return u.endsWith('b.js') ? res(404, '') : res(200, 'ok'); };
  const { texts, failed } = await fetchMany(['a.js', 'b.js'], { owner: 'o', repo: 'r', fetch: f });
  assert.equal(texts.get('a.js'), 'ok');
  assert.equal(texts.get('b.js'), null);
  assert.deepEqual(failed, []);
  assert.ok(inits.every((i) => i === undefined));
});
