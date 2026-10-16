import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanState, scanBanner, abortedBanner, shedHeadline } from '../src/scanstate.js';

test('three states by share of eligible files read: 95% and up complete, 25% to 95% partial, under 25% weak', () => {
  assert.equal(scanState(100, 100).state, 'complete');
  assert.equal(scanState(95, 100).state, 'complete');
  assert.equal(scanState(94, 100).state, 'partial');
  assert.equal(scanState(25, 100).state, 'partial');
  assert.equal(scanState(24, 100).state, 'weak');
  assert.equal(scanState(0, 100).state, 'weak');
  assert.equal(scanState(0, 0).state, 'complete', 'a repo with no source files has nothing to be partial about');
});

test('numbers come from the scan: N, M and P appear in the banner text', () => {
  const partial = scanBanner(scanState(300, 478));
  assert.equal(partial.level, 'info');
  assert.equal(partial.text, 'Scanned 300 of 478 source files (63%). Candidates may include false ghosts; verify each one.');
  const weak = scanBanner(scanState(1500, 23000));
  assert.equal(weak.level, partial.level, 'under 25% uses the same neutral style as 25% to 95%');
  assert.equal(weak.level, 'info');
  assert.equal(weak.text, 'Partial scan: 1500 of 23000 files (7%) read. Candidates may include false ghosts; verify each.');
  assert.equal(scanBanner(scanState(100, 100)), null);
  assert.equal(scanBanner(scanState(299, 300)), null, '99.7% is complete: no banner');
});

test('a tiny share is shown as under 1%, never as 0%', () => {
  assert.equal(scanState(30, 20000).percentText, '<1');
  assert.match(scanBanner(scanState(30, 20000)).text, /\(<1%\)/);
  assert.equal(scanBanner(scanState(30, 20000)).text, 'Partial scan: 30 of 20000 files (<1%) read. Candidates may include false ghosts; verify each.');
});

test('shed headline: plain for complete and partial, "up to ... if all candidates are truly unused" for weak', () => {
  assert.deepEqual(shedHeadline(23, 'complete'), { prefix: '-', n: 23, suffix: ' packages' });
  assert.deepEqual(shedHeadline(1, 'partial'), { prefix: '-', n: 1, suffix: ' package' });
  const w = shedHeadline(23, 'weak');
  assert.equal(`${w.prefix}${w.n}${w.suffix}`, 'up to -23 packages if all candidates are truly unused');
});

test('the aborted-scan banner says how many files were read', () => {
  assert.match(abortedBanner(212).text, /3 failures in a row.*212 files/);
});

test('the weak banner is one short line that keeps the warning, and only the early-stop banner stays strong', () => {
  const w = scanBanner(scanState(60, 900));
  assert.ok(!w.text.includes('\n'), 'a single line of text');
  assert.ok(w.text.length < 110, `short: ${w.text.length} characters`);
  assert.match(w.text, /Candidates may include false ghosts; verify each\./);
  assert.match(w.text, /60 of 900 files \(7%\)/);
  assert.equal(abortedBanner(60).level, 'strong');
});
