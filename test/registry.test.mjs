import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crawl, fetchLatest, fetchModified, fragility, createCache } from '../src/registry.js';

// Fake registry: spec = { name: {deps:[...], bin, maintainers, deprecated} }; absent => 404.
function fakeRegistry(spec) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    const m = url.match(/^https:\/\/registry\.npmjs\.org\/(.+?)(\/latest)?$/);
    const name = decodeURIComponent(m[1]);
    const s = spec[name];
    const mk = (status, body) => ({ status, ok: status < 300, json: async () => body, headers: { get: () => null } });
    if (!s) return mk(404, 'Not Found');
    if (m[2]) return mk(200, { name, version: '1.0.0', dependencies: Object.fromEntries((s.deps || []).map((d) => [d, '*'])), bin: s.bin, maintainers: Array(s.maintainers ?? 2).fill({}), deprecated: s.deprecated, peerDependencies: Object.fromEntries((s.peers || []).map((d) => [d, '*'])) });
    return mk(200, { modified: s.modified || '2020-01-01T00:00:00.000Z' });
  };
  return { fetch, calls };
}

test('BFS builds depth, parent, scoped names, 404 -> missing', async () => {
  const { fetch, calls } = fakeRegistry({ a: { deps: ['b', '@s/c', 'gone'] }, b: { deps: ['d'] }, '@s/c': {}, d: {} });
  const g = await crawl(['a'], { fetch });
  assert.deepEqual([...g.nodes.keys()].sort(), ['@s/c', 'a', 'b', 'd', 'gone']);
  assert.equal(g.nodes.get('d').depth, 3);
  assert.equal(g.nodes.get('d').parent, 'b');
  assert.equal(g.nodes.get('gone').missing, true);
  assert.ok(calls.some((c) => c.url.endsWith('/@s%2Fc/latest')));
  assert.ok(calls.every((c) => Object.keys(c.init.headers).join() === 'Accept'), 'only an Accept header is sent');
});
test('bins, maintainers, deprecated are read from latest', async () => {
  const { fetch } = fakeRegistry({ a: { bin: { 'run-p': 'x', 'run-s': 'y' }, maintainers: 1, deprecated: 'old' }, b: { bin: 'cli.js' } });
  const g = await crawl(['a', 'b'], { fetch });
  assert.deepEqual(g.nodes.get('a').bins, ['run-p', 'run-s']);
  assert.equal(g.nodes.get('a').maintainers, 1);
  assert.equal(g.nodes.get('a').deprecated, true);
  assert.deepEqual(g.nodes.get('b').bins, ['b']);
});
test('cycles terminate and nodes are fetched once', async () => {
  const { fetch, calls } = fakeRegistry({ a: { deps: ['b'] }, b: { deps: ['a', 'c'] }, c: { deps: ['a'] } });
  const g = await crawl(['a'], { fetch });
  assert.equal(g.nodes.size, 3);
  assert.equal(calls.length, 3);
});
test('depth limit', async () => {
  const spec = {}; for (let i = 1; i <= 9; i++) spec[`p${i}`] = { deps: [`p${i + 1}`] };
  const g = await crawl(['p1'], { fetch: fakeRegistry(spec).fetch, maxDepth: 6 });
  assert.equal(g.nodes.size, 6);
  assert.equal(g.capped, false);
});
test('node cap sets capped', async () => {
  const spec = { r: { deps: Array.from({ length: 20 }, (_, i) => `c${i}`) } };
  for (let i = 0; i < 20; i++) spec[`c${i}`] = {};
  const g = await crawl(['r'], { fetch: fakeRegistry(spec).fetch, maxNodes: 10 });
  assert.equal(g.nodes.size, 10);
  assert.equal(g.capped, true);
});
test('cache is shared: fetchLatest after crawl makes no new request', async () => {
  const { fetch, calls } = fakeRegistry({ a: {} });
  const cache = createCache();
  await crawl(['a'], { fetch, cache });
  await fetchLatest('a', { fetch, cache });
  assert.equal(calls.length, 1);
});
test('retries 5xx then succeeds; persistent failure is counted, not thrown', async () => {
  let n = 0;
  const flaky = async () => (++n < 2 ? { status: 503, ok: false, headers: { get: () => null } } : { status: 200, ok: true, json: async () => ({ version: '1' }) });
  const g = await crawl(['a'], { fetch: flaky });
  assert.equal(g.nodes.get('a').version, '1');
  const dead = async () => ({ status: 500, ok: false, headers: { get: () => null } });
  const g2 = await crawl(['a'], { fetch: dead });
  assert.equal(g2.errors, 1);
  assert.equal(g2.nodes.get('a').failed, true);
});
test('fetchModified and fragility', async () => {
  const { fetch } = fakeRegistry({ a: { modified: '2020-01-01T00:00:00.000Z' } });
  assert.equal(await fetchModified('a', { fetch }), '2020-01-01T00:00:00.000Z');
  assert.equal(await fetchModified('zzz', { fetch }), null);
  const now = Date.parse('2026-01-01');
  assert.equal(fragility({ modified: null, maintainers: 3, deprecated: false }, now), 0);
  assert.equal(fragility({ modified: '2020-01-01', maintainers: 1, deprecated: true }, now), 1);
  assert.ok(Math.abs(fragility({ modified: '2025-01-01', maintainers: 2, deprecated: false }, now) - 0.6 * (365 / 1460)) < 0.01);
});
test('peer dependencies are recorded but not crawled', async () => {
  const { fetch } = fakeRegistry({ a: { peers: ['p'] }, p: {} });
  const g = await crawl(['a'], { fetch });
  assert.deepEqual(g.nodes.get('a').peers, ['p']);
  assert.equal(g.nodes.has('p'), false);
});
