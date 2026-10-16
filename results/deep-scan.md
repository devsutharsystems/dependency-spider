# Deep scan: measurements and real scans

Date: 2026-10-17. Everything below was produced by `scripts/raw-throttle.mjs` and `scripts/deep-compare.mjs` against the live repos, from this Mac and network, unauthenticated, one run each. Registry and GitHub data move, so treat numbers as a snapshot.

## 1. How raw.githubusercontent.com behaves at 1,500 requests

Same picker and fetcher as the app: 8 parallel requests, retry with backoff on 429 and 5xx, stop after 3 failures in a row.

| Repo | Files in tree | Eligible source files | Requested | Read | HTTP statuses | Time | Rate |
|---|---|---|---|---|---|---|---|
| nrwl/nx | 10,595 | 5,135 | 1,500 | 1,500 | 1,500 x 200 (no 403, 404, 429 or 5xx, no retries) | 64.7 s | 23.2 files/s |
| vercel/next.js | 34,271 | 24,991 | 1,500 | 1,500 | 1,500 x 200 | 61.5 s | 24.4 files/s |

Progress was linear on both (about 10 s per 250 files from the first to the last batch), so there was no sign of throttling building up. The file host does not count against the 60 requests/hour GitHub API limit that a scan uses 1 call of. **Decision: the deep cap stays at 1,500**, since nothing throttled.

Caveats: Node on one machine and one network, one run per repo, no token. Mobile networks, other times of day and heavier shared IPs may behave differently. A browser uses the same host, but this measurement was not made in a browser (the UI runs in section 3 were). `content-length` was summed for the megabytes figure (1.7 and 2.1 MB); servers that compress may not send it, so treat it as a floor. The early-stop path (3 failures in a row) was **never triggered** in more than 3,000 real requests; it is covered by unit tests with a fake failing network only.

## 2. Real scans: normal cap (300 files) vs deep cap (1,500 files)

N = source files actually read, M = eligible source files (after the usual exclusions). "Banner" is the state the UI shows (complete: none, partial from 25%: neutral info, under 25%: strong banner + "partial scan: unverified" on every card + "up to" headline).

| Repo | Mode | Read / eligible | Share | Banner | Candidates | Shed headline | Pipeline time |
|---|---|---|---|---|---|---|---|
| mochajs/mocha | normal | 300 / 478 | 63% | info | 1 | -2 | 35.3 s |
| mochajs/mocha | deep | 478 / 478 | 100% | none | 1 | -2 | 34.6 s |
| nrwl/nx | normal | 300 / 5,135 | 6% | strong | 144 | up to -232 | 50.8 s |
| nrwl/nx | deep | 1,500 / 5,135 | 29% | info | 85 | -113 | 40.5 s |
| vercel/next.js | normal | 300 / 24,991 | 1% | strong | 93 | up to -303 | 54.9 s |
| vercel/next.js | deep | 1,500 / 24,991 | 6% | strong | 71 | up to -226 | 65.9 s |

Pipeline time includes the registry crawl (900 packages for nx and next.js), which varies from run to run by tens of seconds, so these times are not a clean measure of the extra file reading (that is the 61 to 65 s in section 1 for 1,500 files).

### Candidates that disappeared because the deep scan found their import (nothing appeared that was not there before)

- **mocha:** none. The single candidate `tsx` stays: its only use is a nested fixture `.mocharc.yml`, which no file budget reaches (the scanner reads root configs only). The deep scan made the scan complete but did not remove this false positive.
- **nx (59 disappeared):** `@angular-devkit/architect`, `@eslint/js`, `@jest/reporters`, `@jest/test-result`, `@markdoc/markdoc`, `@nuxt/kit`, `@nx/angular`, `@nx/conformance`, `@nx/next`, `@nx/rsbuild`, `@nx/storybook`, `@pmmmwh/react-refresh-webpack-plugin`, `@reduxjs/toolkit`, `@remix-run/dev`, `@rollup/plugin-babel`, `@rollup/plugin-commonjs`, `@rollup/plugin-image`, `@rollup/plugin-json`, `@rollup/plugin-node-resolve`, `@rollup/plugin-typescript`, `@rollup/plugin-url`, `@storybook/react-vite`, `@svgr/rollup`, `@svgr/webpack`, `@tailwindcss/postcss`, `@testing-library/react`, `@typescript-eslint/type-utils`, `@vitejs/plugin-react`, `@xstate/inspect`, `angular-eslint`, `autoprefixer`, `babel-loader`, `classnames`, `confusing-browser-globals`, `copy-webpack-plugin`, `ejs`, `eslint-plugin-jsx-a11y`, `jest-config`, `jest-runtime`, `jsonc-parser`, `kill-port`, `less-loader`, `license-webpack-plugin`, `metro-config`, `next-sitemap`, `octokit`, `open`, `parse5`, `preact`, `react-router-dom`, `sass-loader`, `source-map-loader`, `source-map-support`, `style-loader`, `tar-stream`, `tcp-port-used`, `tinyglobby`, `toml-eslint-parser`, `ts-checker-rspack-plugin`.
- **next.js (22 disappeared):** `@babel/generator`, `@babel/plugin-transform-object-rest-spread`, `@babel/preset-react`, `@opentelemetry/api`, `@vercel/blob`, `@vercel/og`, `cookie`, `critters`, `express`, `gzip-size`, `image-size`, `is-animated`, `json5`, `nanoid`, `react-is-builtin`, `react-server-dom-webpack`, `resolve-from`, `satori`, `serve-handler`, `shell-quote`, `styled-jsx`, `ws`.

## 3. Reading the numbers honestly

- **Deep scan removes false ghosts but cannot make a large repo complete.** On mocha (478 files) it reaches 100% and the banner disappears. On nx it moves the scan from 6% to 29% and removes 59 of 144 candidates, and that is still a partial scan: the 85 remaining candidates are **unverified** and likely still include many false ghosts (nx's own `@nx/*` plugins, for instance, are loaded by name at runtime). On next.js 1,500 of 24,991 files is 6%, so the strong banner, the "unverified" badges and the "up to" headline all remain. A 23,000-file repo stays far from complete at any cap I measured as workable.
- **Shed numbers are upper bounds** whenever the banner is strong: nx's headline went from "up to -232" to "-113", next.js's from "up to -303" to "up to -226", because fewer candidates remain, not because the remaining ones were confirmed.
- I did not check any of the remaining nx or next.js candidates by removing them and running the repo's tests.

## 4. Real-browser runs of the UI (headed Chrome, real network)

| Repo | Deep scan | What the page showed |
|---|---|---|
| mochajs/mocha | off | counter reached "302 of 306 files read" (300 source + 6 config files), info banner "Scanned 300 of 478 source files (63%)...", headline -2, no unverified badges |
| mochajs/mocha | on | "481 of 484 files read", **no banner**, headline -2; total 41 s (files 2 to 15 s, crawl and web to 39 s) |
| nrwl/nx | on | "1882 of 1887 files read" (1,500 source + config files; the counter was last sampled just before the end), info banner "Scanned 1500 of 5135 source files (29%)...", plus the existing "Package cap reached" note, 85 candidate cards, headline -113 packages, tree 900 to 787 |

- **Files are cheap in a browser:** nx read 1,887 files in about 6 s (HTTP/2 from the browser) against 62 to 65 s in the Node measurement in section 1, so the Node figure is a conservative upper bound for the file-reading part.
- **The headline can read wrongly if sampled too early:** the number counts up for 0.7 s, so a sample taken the moment the summary appears showed "-0" (mocha) and "-90" (nx). Settled values were -2 and -113, equal to the pipeline runs in section 2.
- **A problem this exposed, and the fix:** the prune animation cut candidates one at a time, about a second each, so nx's 85 candidates took 88 s (summary at 134 s). The first 8 candidates are now cut one by one and the rest together ("Cutting the first 8 candidates one by one, the other 77 together"): the nx prune took 14 s, all 85 cards ended in a final state (48 cut, 37 "still needed"), count 787, headline -113, no errors. Skip animation still exists.

## 5. Performance regression check

- **Headless** (`scripts/perf.mjs debug --dpr=2 --throttle=4`, secondary check): build p50 / p95 / max 16.7 / 16.7 / 217 ms, prune 16.7 / 16.8 / 183 ms, script p95 0.4 and 0.5 ms. Same as before this change (p95 16.7 to 16.8).
- **Headed, real GPU: not a clean measurement today.** The Mac was on battery at 12%, and Chrome held every page to 30 fps (p50 33.3 ms, about 630 frames instead of about 1,260). The **unchanged `main` showed exactly the same** (633 frames, p95 34.1 ms, GPU 6.9 to 7.1 ms/frame against 7.0 for this branch, back to back), so this is the machine, not the code. The A/B says the branch is no different from main under identical conditions; it cannot say what the absolute numbers are at 60 fps. Re-run `scripts/perf-headed.mjs` on AC power to get those.
