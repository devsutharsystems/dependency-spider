# Removal test: postcss/postcss, 3 candidates, 1 false positive

Date: 2026-10-16. Node v24.21.0. Throwaway clone outside this project: `git clone --depth 1 https://github.com/postcss/postcss.git`, commit `f1aca7ec68ab0cfb96cc9e69520a87f641c5a9e4`.

**What a pass means.** A passing test suite means "the tests do not need this package". It does not mean "nothing needs it": CI, release scripts, contributors' machines and other tooling can use a package that no test touches.

## Setup

postcss is a pnpm project. `npm install` fails with `ERESOLVE`, so I used pnpm through npx with the repo's own lockfile (nothing installed globally):

```sh
npx --yes pnpm@12.11.2 install --frozen-lockfile        # exit 0
```

The scanner's candidates for this repo (all three also flagged by depcheck): `@size-limit/preset-small-lib`, `multiocular`, `simple-git-hooks` (all devDependencies).

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
- **`simple-git-hooks`: used, but not by any test.** `package.json` has a top-level `"simple-git-hooks": {"pre-commit": "./test/version.js"}` config block and `pnpm-workspace.yaml` lists it. Running `pnpm exec simple-git-hooks` writes `.git/hooks/pre-commit` ending in `./test/version.js`. Removing the package leaves that config block orphaned and contributors would no longer get the pre-commit hook; no test notices. The scanner missed it because it searches the *values* of package.json keys but not the key *names*, and a top-level key named after the tool is the normal way to configure it. This is a scanner gap, not fixed in this round (it would change the numbers published elsewhere).
- **`multiocular`: no reference anywhere.** `git grep -i multiocular` finds only `package.json` and the lockfile. Its description is "Review dependencies changes to prevent supply chain attack" and it ships a `multiocular` bin, so it may be run by hand or by maintainers' tooling outside the repo. The test suite does not need it; whether anything else does is unknown.

## Summary

3 candidates, 1 false positive found by a test script (`@size-limit/preset-small-lib`), 1 more shown to be in use by configuration (`simple-git-hooks`), 1 with no reference in the repo (`multiocular`). One repo, so no generalisation. Together with the express result (`hbs`, 1 candidate, false positive): 2 repos tested, 4 candidates, at least 2 false positives.
