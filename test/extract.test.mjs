import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toPackageName, extractImports } from '../src/extract.js';

test('toPackageName: subpaths and scopes', () => {
  assert.equal(toPackageName('lodash/fp'), 'lodash');
  assert.equal(toPackageName('@scope/pkg/sub/deep'), '@scope/pkg');
  assert.equal(toPackageName('@scope/pkg'), '@scope/pkg');
  assert.equal(toPackageName('@scope'), null);
});
test('toPackageName: rejects non-packages', () => {
  for (const s of ['./a', '../a', '/abs', 'node:fs', 'https://x.y/z', '#internal', '~/alias', '@/alias', '${x}', '`a`', '', 'bad name', 'UPPER space'])
    assert.equal(toPackageName(s), null, s);
});
test('built-ins are excluded, including subpaths', () => {
  for (const s of ['fs', 'path', 'fs/promises', 'stream/web', 'util']) assert.equal(toPackageName(s), null, s);
});
test('bare test/sea/sqlite are npm packages, node:test is not', () => {
  assert.equal(toPackageName('test'), 'test');
  assert.equal(toPackageName('sea'), 'sea');
  assert.equal(toPackageName('sqlite'), 'sqlite');
  assert.equal(toPackageName('node:test'), null);
});
test('extractImports finds all five forms', () => {
  const src = `
    import a from 'a1'; import 'b1'; export { x } from "c1";
    const d = await import('d1'); const e = require('e1'); require.resolve('f1/sub');
    import fs from 'fs'; import './local';`;
  assert.deepEqual(extractImports(src), ['a1', 'b1', 'c1', 'd1', 'e1', 'f1']);
});
test('whole-line // comments are stripped', () => {
  assert.deepEqual(extractImports("// require('ghost')\nrequire('real')"), ['real']);
});
test('block comments are NOT stripped: a glob with /* does not swallow imports', () => {
  const src = `const files = glob('lib/*.js');\nconst x = require('after-glob');\nconst y = 'src/*/x';`;
  assert.deepEqual(extractImports(src), ['after-glob']);
});
