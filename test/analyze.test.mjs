import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, mentions, shorthands } from '../src/analyze.js';

const f = (path, text) => ({ path, text });
const run = (pkg, files, extra = {}) => classify({ pkg, files, ...extra });
const names = (arr) => arr.map((x) => x.name).sort();

test('ghost: declared, never imported, not mentioned', () => {
  const r = run({ name: 'me', dependencies: { used: '1', ghost: '1' }, devDependencies: { dg: '1' } }, [f('index.js', "require('used')")]);
  assert.deepEqual(r.ghosts, [{ name: 'ghost', section: 'dependencies' }, { name: 'dg', section: 'devDependencies' }]);
});
test('dependency-map trap: names inside dependency maps do not count as mentions', () => {
  const pkg = { name: 'me', dependencies: { a: '1', b: '1' }, devDependencies: { c: '1' }, overrides: { a: '2' }, peerDependencies: { b: '*' } };
  assert.deepEqual(names(run(pkg, []).ghosts), ['a', 'b', 'c']); // zero ghosts here would be the bug
});
test('mentioned in scripts and in other package.json keys counts as used', () => {
  const pkg = { name: 'me', scripts: { lint: 'eslint .', test: 'node_modules/.bin/tap test/' }, 'lint-staged': { '*.js': 'prettier --write' }, devDependencies: { eslint: '1', tap: '1', prettier: '1', ghost: '1' } };
  assert.deepEqual(names(run(pkg, []).ghosts), ['ghost']);
});
test('token boundary: tap does not match tape, and vice versa', () => {
  assert.equal(mentions('tape test/', 'tap'), false);
  assert.equal(mentions('tap test/', 'tap'), true);
  assert.equal(mentions('run-tap && x', 'tap'), false);
  assert.equal(mentions('tap.js', 'tap'), false);
  assert.equal(mentions('@scope/tap', 'tap'), false);
  assert.equal(mentions('(tap)', 'tap'), true);
  const r = run({ name: 'me', scripts: { test: 'tape x' }, devDependencies: { tap: '1', tape: '1' } }, []);
  assert.deepEqual(names(r.ghosts), ['tap']);
});
test('.bin path prefix is stripped before matching', () => {
  const r = run({ name: 'me', scripts: { t: './node_modules/.bin/mocha x' }, devDependencies: { mocha: '1' } }, []);
  assert.equal(r.ghosts.length, 0);
});
test('registry bin names count: npm-run-all2 runs as run-p', () => {
  const pkg = { name: 'me', scripts: { all: 'run-p a b' }, devDependencies: { 'npm-run-all2': '1' } };
  assert.equal(run(pkg, []).ghosts.length, 1);
  assert.equal(run(pkg, [], { bins: { 'npm-run-all2': ['run-p', 'run-s'] } }).ghosts.length, 0);
});
test('shorthands: eslint-plugin-react as react, babel-preset-env as env', () => {
  assert.deepEqual(shorthands('eslint-plugin-react'), ['react']);
  assert.deepEqual(shorthands('babel-preset-env'), ['env']);
  assert.deepEqual(shorthands('@babel/preset-env'), ['@babel/env']);
  const r = run({ name: 'me', eslintConfig: { plugins: ['react'] }, devDependencies: { 'eslint-plugin-react': '1' } }, []);
  assert.equal(r.ghosts.length, 0);
});
test('config file text counts as mention (and tsconfig)', () => {
  const r = run({ name: 'me', devDependencies: { '@tsconfig/node18': '1', ghost: '1' } }, [], { configTexts: ['{"extends": "@tsconfig/node18/tsconfig.json"}'] });
  assert.deepEqual(names(r.ghosts), ['ghost']);
});
test('@types/* and built-in-named deps are never ghosts', () => {
  const r = run({ name: 'me', devDependencies: { '@types/node': '1', events: '1' } }, []);
  assert.equal(r.ghosts.length, 0);
});
test('extensionless-file style source counts as usage (hexo-cli)', () => {
  const r = run({ name: 'hexo', dependencies: { 'hexo-cli': '1' } }, [f('bin/hexo', "#!/usr/bin/env node\nrequire('hexo-cli')()")]);
  assert.equal(r.ghosts.length, 0);
});
test('glob with /* in an earlier line does not create a false ghost', () => {
  const r = run({ name: 'me', dependencies: { real: '1' } }, [f('index.js', "const g = 'lib/*.js';\nrequire('real');")]);
  assert.equal(r.ghosts.length, 0);
});
test('misplaced: prod dependency used only in tests / examples / config', () => {
  const pkg = { name: 'me', dependencies: { a: '1', b: '1', c: '1', ok: '1', m: '1' }, scripts: { x: 'm go' } };
  const r = run(pkg, [f('lib/i.js', "require('ok')"), f('test/t.js', "require('a')"), f('examples/e.js', "require('b')"), f('scripts/s.js', "require('c')")]);
  assert.deepEqual(names(r.misplaced), ['a', 'b', 'c', 'm']);
  assert.match(r.misplaced.find((x) => x.name === 'a').reason, /tests/);
});
test('phantom: imported, undeclared; own name, built-ins, peer deps and fixtures ignored', () => {
  const pkg = { name: 'me', peerDependencies: { peer: '1' }, dependencies: {} };
  const r = run(pkg, [f('lib/a.js', "require('undeclared'); require('me/sub'); require('peer'); require('fs');"), f('test/fixtures/x.js', "require('fixture-only')")]);
  assert.deepEqual(names(r.phantoms), ['undeclared']);
});
test('local path dependencies are never reported', () => {
  const r = run({ name: 'me', devDependencies: { local: './fixtures/local', f: 'file:../f', real: '1' } }, []);
  assert.deepEqual(names(r.ghosts), ['real']);
});
test('webpack-cli counts as used when webpack is used', () => {
  const pkg = { name: 'me', scripts: { b: 'webpack --mode x' }, devDependencies: { webpack: '1', 'webpack-cli': '1' } };
  assert.equal(run(pkg, []).ghosts.length, 0);
  assert.deepEqual(names(run({ name: 'me', devDependencies: { 'webpack-cli': '1' } }, []).ghosts), ['webpack-cli']);
});
test('phantoms inside nested package roots (docs/ with its own package.json) are ignored', () => {
  const r = run({ name: 'me' }, [f('docs/a.ts', "import 'astro'"), f('lib/b.js', "require('real-phantom')")], { nestedRoots: ['docs/'] });
  assert.deepEqual(names(r.phantoms), ['real-phantom']);
});
test('a top-level config block named like a declared package counts as a mention', () => {
  const pkg = { name: 'me', 'simple-git-hooks': { 'pre-commit': './x.js' }, 'lint-staged': {}, devDependencies: { 'simple-git-hooks': '1', 'lint-staged': '1', ghost: '1' } };
  assert.deepEqual(names(run(pkg, []).ghosts), ['ghost']);
});
test('key-name mentions never come from the dependency maps or metadata keys', () => {
  const pkg = { name: 'me', version: '1', files: ['x'], bin: { x: 'y' }, exports: {}, main: 'a', scripts: {},
    dependencies: { name: '1', version: '1', files: '1', dependencies: '1' }, devDependencies: { ghost: '1', scripts: '1', main: '1', bin: '1', exports: '1' },
    overrides: { ghost: '2' }, peerDependencies: { ghost: '*' } };
  // every declared name here equals a metadata/map key, none may be rescued by that
  assert.deepEqual(names(run(pkg, []).ghosts), ['bin', 'dependencies', 'exports', 'files', 'ghost', 'main', 'name', 'scripts', 'version']);
});
test('a config key without a matching declared package is just ignored', () => {
  const r = run({ name: 'me', jest: {}, devDependencies: { ghost: '1' } }, []);
  assert.deepEqual(names(r.ghosts), ['ghost']);
});

// ---- likelyLoadedBy: general rule, tested with invented names only ----
import { likelyLoadedBy } from '../src/analyze.js';

test('likelyLoadedBy: scope equal to a used package, or name starting with "<used>-"', () => {
  const used = ['acme-tool', 'widgetkit'];
  assert.equal(likelyLoadedBy('@acme-tool/preset-x', used), 'acme-tool');
  assert.equal(likelyLoadedBy('acme-tool-plugin-y', used), 'acme-tool');
  assert.equal(likelyLoadedBy('@widgetkit/core', used), 'widgetkit');
  assert.equal(likelyLoadedBy('@other/widgetkit-adapter', used), 'widgetkit');
});
test('likelyLoadedBy: unrelated names, exact same name and short parents give null', () => {
  assert.equal(likelyLoadedBy('unrelated', ['acme-tool']), null);
  assert.equal(likelyLoadedBy('acme-tooling', ['acme-tool']), null); // "acme-tool-" prefix needed, not a substring
  assert.equal(likelyLoadedBy('acme-tool', ['acme-tool']), null);
  assert.equal(likelyLoadedBy('is-number', ['is']), null);
});
test('likelyLoadedBy: picks the longest matching parent', () => {
  assert.equal(likelyLoadedBy('acme-tool-extra-plugin', ['acme-tool', 'acme-tool-extra']), 'acme-tool-extra');
});
test('classify marks lower-confidence ghosts only when the parent is itself used', () => {
  const pkg = { name: 'me', scripts: { go: 'acme-tool run' }, devDependencies: { 'acme-tool': '1', 'acme-tool-plugin-a': '1', 'lonely-plugin-b': '1', 'deadparent': '1', 'deadparent-plugin': '1' } };
  const r = run(pkg, []);
  const by = Object.fromEntries(r.ghosts.map((g) => [g.name, g.likelyLoadedBy]));
  assert.equal(by['acme-tool-plugin-a'], 'acme-tool');
  assert.equal(by['lonely-plugin-b'], undefined);
  assert.equal(by['deadparent-plugin'], undefined); // its would-be parent is a ghost too
});
