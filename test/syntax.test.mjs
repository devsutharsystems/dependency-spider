import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// viz.js and app.js need a browser, so no other test imports them: this at least proves they parse.
test('every module in src/ and scripts/ is syntactically valid', () => {
  for (const dir of ['src', 'scripts']) for (const f of readdirSync(new URL(`../${dir}/`, import.meta.url)).filter((n) => n.endsWith('.js') || n.endsWith('.mjs'))) {
    assert.doesNotThrow(() => execFileSync(process.execPath, ['--check', fileURLToPath(new URL(`../${dir}/${f}`, import.meta.url))], { stdio: 'pipe' }), `${dir}/${f}`);
  }
});
