# Removal test: postcss/postcss, 3 candidates, 2 wrong, 1 unconfirmed

Date: 2026-10-16. Node v24.21.0. Throwaway clone outside this project: `git clone --depth 1 https://github.com/postcss/postcss.git`, commit `f1aca7ec68ab0cfb96cc9e69520a87f641c5a9e4`.

**What a pass means.** A passing test suite means "the tests do not need this package". It does not mean "nothing needs it": CI, release scripts, contributors' machines and other tooling can use a package that no test touches.

## Setup

postcss is a pnpm project. `npm install` fails with `ERESOLVE`, so I used pnpm through npx with the repo's own lockfile (nothing installed globally):

```sh
npx --yes pnpm@12.11.2 install --frozen-lockfile        # exit 0
```

**This test ran on the scanner as it was before the config-key fix**, which reported three candidates for this repo (also flagged by depcheck without install). Today's scanner reports two, because `simple-git-hooks` is no longer a candidate (see below).

The three candidates tested: `@size-limit/preset-small-lib`, `multiocular`, `simple-git-hooks` (all devDependencies).

The repo's own `test` script is `pnpm run /^test:/`; I ran each script separately:

| Script (`npx --yes pnpm@12.11.2 run <name>`) | What it does |
|---|---|
| `unit` | `uvu -r ts-node/register/transpile-only test "\.test\.(ts\|js)$"` (the unit tests) |
| `test:lint` | `eslint .` |
| `test:types` | `check-dts` (type tests) |
| `test:version` | `node ./test/version.js` |
| `test:integration` | `node ./test/integration.js` |
| `test:size` | `size-limit` (bundle size budget of 16.5 KB for `lib/postcss.js`) |

## Results

| State | unit | test:lint | test:types | test:version | test:integration | test:size |
|---|---|---|---|---|---|---|
| Baseline (nothing removed) | 720/720 pass, exit 0 | exit 0 | exit 0 | exit 0 | exit 0 | exit 0 (15.54 kB of 16.5 kB) |
| All 3 removed (`npx --yes pnpm@12.11.2 remove @size-limit/preset-small-lib multiocular simple-git-hooks`, exit 0; package.json: 3 lines removed) | 720/720 pass, exit 0 | exit 0 | exit 0 | exit 0 | exit 0 | **exit 1** |

`test:size` output after removal:

```
$ size-limit
Install Size Limit preset depends on type of the project
...
For small (< 10 kB) libraries
  pnpm add --save-dev @size-limit/preset-small-lib
[ELIFECYCLE] Command failed with exit code 1.
```

## Isolating the failure (one candidate removed at a time, repo restored in between)

Each run: `git checkout package.json pnpm-lock.yaml`, `pnpm install --frozen-lockfile`, `pnpm remove <one package>` (exit 0, exactly 1 line removed from package.json), then all six scripts.

| Removed alone | unit | lint | types | version | integration | size |
|---|---|---|---|---|---|---|
| `@size-limit/preset-small-lib` | 720/720 | 0 | 0 | 0 | 0 | **1 (fails)** |
| `multiocular` | 720/720 | 0 | 0 | 0 | 0 | 0 |
| `simple-git-hooks` | 720/720 | 0 | 0 | 0 | 0 | 0 |

(An earlier isolation attempt was thrown away: a zsh quoting error made every `pnpm` call exit 127, so it tested the unmodified repo. The table above is from the rerun, where each remove exited 0.)

## What each candidate is

- **`@size-limit/preset-small-lib`: false positive.** `size-limit` loads its preset plugin by installed package name and refuses to run without one. The repo's `test:size` script depends on it. The scanner saw `size-limit` in `scripts` but cannot see that it needs a plugin package. Same class as the express `hbs` result: a package loaded by name at runtime.
- **`simple-git-hooks`: wrong, a scanner bug (now fixed).** It is used, but not by any test. `package.json` has a top-level `"simple-git-hooks": {"pre-commit": "./test/version.js"}` config block and `pnpm-workspace.yaml` lists it. Running `pnpm exec simple-git-hooks` writes `.git/hooks/pre-commit` ending in `./test/version.js`. Removing the package leaves that config block orphaned and contributors would no longer get the pre-commit hook; no test notices. The scanner missed it because it searched the *values* of package.json keys but not key *names*. It now counts a top-level key whose name equals a declared package as a mention, so `simple-git-hooks` is no longer reported.
- **`multiocular`: unconfirmed.** No reference anywhere. `git grep -i multiocular` finds only `package.json` and the lockfile. Its description is "Review dependencies changes to prevent supply chain attack" and it ships a `multiocular` bin, so it may be run by hand or by maintainers' tooling outside the repo. The test suite does not need it; whether anything else does is unknown.

## Summary

3 candidates tested (scanner before the config-key fix): `@size-limit/preset-small-lib` is wrong (found by a test script: `test:size` fails), `simple-git-hooks` is wrong (in use through its config key; scanner bug, now fixed), `multiocular` is unconfirmed (no reference in the repo, nothing I ran broke, but that does not prove it is unused).

Together with the express result (`hbs`, wrong: 6 tests fail): **4 candidates tested, 3 wrong, 1 unconfirmed, 0 confirmed unused**, in 2 repos.

## What this means for the postcss shed number

The app now reports two postcss candidates (228 to 205 packages, -23). That is an upper bound: 6 of the 23 come from `@size-limit/preset-small-lib`, a proven false positive, and the other 17 come from `multiocular`, which is unconfirmed.
