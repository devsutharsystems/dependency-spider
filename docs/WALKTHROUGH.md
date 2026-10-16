# Walkthrough: how to explain Dependency Spider

Everything below is checked against the code and against runs on 2026-10-16. Numbers move as repos and npm change; say "when I ran it".

## The one-minute version

You paste a GitHub repo. The app reads `package.json` and up to 300 source files (1,500 with Deep scan), finds the dependencies the code never imports and no script or config mentions (candidates), crawls the npm registry to build the dependency tree, and shows how many packages would leave the tree if those candidates were removed. It is a static site: no backend, no API key, no LLM. depcheck and Knip already find unused dependencies; the extra here is the "what does removing it shed" number, the visualization, and a public, honest comparison with depcheck.

## The modules, one paragraph each

**`util.js`.** Small shared helpers: a typed error (`SpiderError` with a code, so the UI can show a friendly message), a bounded-concurrency map (8 requests at a time), and `fetchRetry` (retries 429 and 5xx with backoff, and gives up on a hung request after 30 s). It exists so every network call behaves the same way. The timeout was added after a validation run hung with no error.

**`extract.js`.** Turns source text into npm package names. Regexes find `from 'x'`, `import 'x'`, `import('x')`, `require('x')` and `require.resolve('x')`. `toPackageName` reduces `lodash/fp` to `lodash` and `@scope/pkg/sub` to `@scope/pkg`, and rejects relative paths, `node:` imports, aliases, templates and Node built-ins. It has no network and no DOM, so it is easy to test.

**`github.js`.** Everything about GitHub: parsing the many URL forms, listing files with the trees API (try `HEAD`, fall back to the default branch), fetching raw files, and choosing which files to read (`pickSourceFiles`, `pickConfigFiles`). It also classifies each path as source, test, fixture, example or tooling. `fetch` is injected everywhere, which is why the tests never touch the network.

**`analyze.js`.** The decision-maker. A dependency is used if it is imported anywhere, or mentioned in `scripts`, in other package.json keys, or in config files, or if a top-level package.json key is named exactly like it (`"simple-git-hooks": {...}`); otherwise it is a "ghost" (I show it as a candidate). A general, unvalidated rule adds a "lower confidence: likely loaded by <parent> by name" hint when a candidate shares a scope or name prefix with a used package (`@size-limit/...` with `size-limit`). It also finds "misplaced" (a production dependency used only from tests or examples) and "phantom" (imported but not declared) packages, and records why each used package counts as used, which the validation script uses.

**`registry.js`.** Talks to the npm registry. `fetchLatest` reads `/<name>/latest` (a few KB); `crawl` does a breadth-first walk from every declared dependency (depth up to 6, cap 900 packages, shared cache). `fetchModified` and `addModified` are an optional second pass for the "last modified" date, because that data is huge (93 MB for fastify's 464 packages). `fragility` turns age, maintainer count and deprecation into a 0-to-1 colour; it is a heuristic, not a security verdict.

**`graph.js`.** The math. `reachable` finds everything reachable from the manifest; `shedReport` computes, per candidate and for all together, how many packages disappear; `uninstallCommand` builds the `npm uninstall` lines.

**`choreo.js`.** The animation's brain, pure (no DOM, no clock). Input: the packages in the order the registry crawl delivers them, plus the canvas geometry. `WebLayout` gives each package a fixed slot inside its parent's wedge the moment it arrives, and never moves it. `Planner` decides where the spider goes next using only delivered packages and only existing threads: lay a thread to a waiting child, else walk back along threads to the nearest anchored package with work, spokes (declared dependencies) first; with nothing ready it returns nothing and the spider waits. Output: steps (`drop`, `lay`, `return`) with paths, speeds and rests; `planWeb` builds a whole timeline for tests. It exists so the part that decides what the spider does can be unit-tested without a canvas.

**`viz.js`.** Draws what `choreo.js` decides, on two stacked canvases: a static layer (rings, anchored threads and packages) that is only drawn into when the spider anchors something or packages are removed, and a small live layer (spider, thread being laid, glints, snip flashes, falling packages) cleared with a dirty rectangle. Threads are batched in `Path2D` strokes and packages in 16 colour buckets; no `shadowBlur` or filters; DPR clamped to 2; time-based with a clamped delta; fixed effect pools; idle in a hidden tab. It also runs the prune choreography and builds the share image from both layers.

**`pipeline.js`.** Orchestration shared by the browser and the Node scripts: URL, file list, `package.json`, files, imports, crawl, classification, peer-dependency check, shed numbers. It emits progress events the UI listens to.

**`report.js`, `cards.js`.** Text output (plain report, PR description) and the candidate card, including the "cannot see packages loaded by name at runtime" caveat under every candidate and the lower-confidence badge.

**`app.js`.** The browser wiring: form, progress panel (written at most 10 times a second from what the spider has built), cards, buttons (copy, PR text, download image, Skip animation, Replay animation), error messages and resetting state between scans. It also plays a recorded scan (`?fixture=`), the same path Replay uses.

**`scripts/`.** `acceptance.mjs` (checks known repos), `validate.mjs` (compares with depcheck on 13 repos), `depcheck-installed.mjs` (repeats the comparison after installing dependencies), `record-fixture.mjs` and `perf.mjs` (record a scan, then measure animation frame times on it without the network). `src/fixture.js` turns a result into JSON and back.

## The five design decisions that matter

1. **Fixed radial layout, placed incrementally, not a force simulation.** My earlier attempt with a force-directed layout exploded at 400+ nodes. The layout is fixed: ring = depth, and each package gets a slot inside its parent's wedge (an equal share per child) the moment the crawl delivers it, and keeps it. Incremental is the point: the spider has to start building while npm is still answering, and my first version, which sized sectors by subtree size, needs the finished tree, so I removed it. The cost is real: equal shares ignore how big a branch will be, so heavy branches get crowded wedges (the long columns in fastify's web). A small radial stagger helps; it does not solve it.

2. **The dependency maps are excluded from the mention search.** "Mentioned in scripts or config counts as used" is only meaningful if the search text excludes `dependencies`, `devDependencies` and similar. If you search them, every dependency mentions itself and you find zero ghosts with no error. There is a unit test for exactly this trap.

3. **Bin-name matching.** A package is often run by a different name than it is installed under (`npm-run-all2` runs as `run-p`; `branch-comparer` runs as `branchcmp`). The registry gives each package's bin names, and those names count as mentions. The mention match is also token-bounded, so `tap` does not match `tape`.

4. **Non-test files first when capped.** At most 300 files are read. If tests came first, a test-heavy repo (229 of fastify's 282 source files are tests) would push real source out of the cap and create false ghosts. Ranking source first and tests last keeps the cap from inventing candidates. When the cap is still hit (mocha: 300 of 478), the UI warns.

5. **Shed = reachable before minus reachable after.** The number of packages a removal saves is not "the package and its dependencies": shared dependencies stay. So I compute everything reachable from the manifest, remove that one entry, recompute, and subtract. If another package still depends on the candidate, the shed is 0 and the UI names that package ("still needed by neostandard"). The total for all candidates is computed together, so overlaps are not double-counted.

A sixth, smaller one: over-counting usage is the safe direction. Block comments are not stripped (globs like `lib/*.js` would swallow real imports), because a missed import creates a false ghost while an extra import only hides one.

## How the animation works

Say it aloud:

1. The animation is driven by the real crawl: a small planner decides where the spider goes, it is not a canned video.
2. When `package.json` is read, the spider drops from the top on a silk line and anchors the hub, which is the repo itself.
3. As the npm crawl delivers packages, each one gets a fixed slot on its ring, inside its parent's wedge, and never moves.
4. The spider only walks to packages that have been delivered, and the thread behind it is exactly the path it walked, so the thread tip is the spider.
5. It lays the spokes first (your declared dependencies), then fills each wedge; to get to the next job it walks back along threads that already exist, faster.
6. If the crawl has not delivered anything yet, it hangs and sways, and the panel says it is waiting for npm.
7. The first fifteen packages go at natural speed so you can see what it does; after that it speeds up, so about 460 packages take around 23 seconds.
8. In the prune phase it walks back to the hub, snips a candidate's thread with a flash, and only the packages in the shed report grey out, fall and fade, while the counter ticks down; a package that is still needed stays.
9. Drawing uses two canvases: a static one that is drawn into only when something is added or removed, and a small live one for the few things that move.
10. Skip jumps to the finished web, Replay re-runs from cached results, and reduced-motion users get the end state. I measured it in headless Chromium on one machine (`results/animation-perf.md`): a retina screen with a slowed CPU went from about 83 ms to 16.7 ms per frame at the 95th percentile, with rare hitches up to 150 ms left.

**Why two canvas layers?** Almost all of the web is static, and repainting about 2,000 threads and 900 dots every frame was the cause of the lag: the profile of the old code at DPR 2 showed 74% of the time in native rasterization and only about 0.3 s in all my drawing code. Now the static layer is drawn into once per anchored package, and the live layer is cleared with a small dirty rectangle. The cost: removing packages in the prune redraws the static layer once per cut, which causes rare single-frame hitches.

**Why time-based animation?** Movement per frame is speed times the elapsed time, so the duration is the same at 60 Hz, 120 Hz or after a slow frame. The elapsed time is clamped (50 ms) so a stalled or backgrounded tab does not make the spider teleport, and the legs advance by distance travelled, not by time, so they do not strobe at high speed.

**Why does the spider accelerate?** Two requirements pull in opposite directions: the viewer has to see what the spider does, which needs natural speed, and a 460-package web at natural speed would take minutes. So the first 15 packages are at natural speed, then the speed multiplier grows with each package up to 14x, which fits the whole build in about 25 to 30 seconds. The honest cost is that the late phase reads as a streak, not as walking.

## Themes and depth cues

All colours come from one palette object in `theme.js` that feeds both the CSS variables and the canvas, so the four themes (Midnight Silk, Neon Arachnid, Dawn Dew, Ember Forge) cannot drift apart, and the default follows the system colour scheme with the choice saved in `localStorage` when it is available. The 3D look is 2.5D depth cues in plain canvas 2D, not WebGL: nodes are pre-rendered dewdrop sprites cached per colour and depth level, deeper rings are smaller, dimmer and fogged toward the background, silk is a faint wide stroke plus a thin core that fades with depth, and the container tilts at most 4 degrees toward the pointer through CSS. Colour never carries meaning alone: I measured contrast in every theme (node colours at least 3:1, text at least 4.5:1) and simulated deuteranopia, which showed yellow and orange nearly merging in Midnight and Dawn and teal and grey in Dawn, so orange/red packages get a ring, not-on-npm packages are hollow, and the legend says so. The new effects were held to the same frame-time budget as before (numbers in `results/animation-perf.md`), and the light theme uses normal blending where the dark themes use additive glow.

## The three results to be ready to explain

**1. `branch-comparer` was cleared by bin matching.** I started from the belief that fastify's `branch-comparer` was unused (an earlier Python run said so, and depcheck without an install agreed). The app does not flag it. I checked: its registry bin is `branchcmp`, and fastify's `bench` script runs `branchcmp`. So my first claim was wrong and the bin-name rule corrected it. The honest point: the dependency is never imported, so "never imported" alone is a wrong test. The same repo's `typescript` was flagged at first and is now reported separately because `tstyche` lists it as a peer dependency.

**2. Removal tests: 4 candidates tested, 3 wrong, 1 unconfirmed, 0 confirmed unused.** On express I removed the one candidate, `hbs`, reinstalled and ran the tests: 1261 passing before, 1255 passing and 6 failing after (the `mvc` example), because Express loads view engines by name at runtime. On postcss I removed the three candidates the scanner then reported: unit tests still pass (720/720) but `test:size` fails, because `size-limit` loads `@size-limit/preset-small-lib` by name. The third, `simple-git-hooks`, was a scanner bug rather than a runtime-loading case: it is configured by its own top-level key in package.json (it installs the pre-commit hook), and the scanner only searched key values. I fixed that with a general rule (a top-level key named like a declared package counts as a mention), so the postcss removal test ran on the pre-fix list. `multiocular` is unconfirmed: nothing references it and nothing I ran broke, which does not prove it is unused. Lesson: a regex scanner cannot see packages loaded from strings, passing tests only mean the tests do not need a package, and the postcss shed (-23 of 228) is an upper bound because 6 of it is the proven false positive.

**3. The depcheck baseline correction.** My first comparison ran depcheck without installing dependencies and showed depcheck flagging 84 packages across 13 repos, many times what my scanner reported, which invites the reading "my tool is more accurate". That was an unfair baseline: without `node_modules`, depcheck cannot see the bins of installed tools. After installing dependencies on 3 repos, depcheck's flags fell from 23 to 8; my scanner reported 7 there, and we overlap on 5. And agreement is not correctness anyway: both tools flagged `hbs` and `@size-limit/preset-small-lib`. So I relabelled the 13-repo table as "without installing" and made the installed comparison the lead.

## Likely questions

**1. Why build this when depcheck and Knip exist?** Because the interesting number is different: how many packages in the whole dependency tree a removal sheds, shown visually. It is not a better detector, and the README says so. It is also a project to learn from and to measure honestly.

**2. How accurate is it?** I do not know, and I do not claim a number. I compared it with depcheck on 13 repos and ran removal tests on 2 repos (4 candidates: 3 wrong, 1 unconfirmed, 0 confirmed unused). That is evidence about failure modes, not an accuracy figure.

**3. Why regexes and not a parser?** It runs in the browser with no build step and no dependencies, and import statements are regular enough. The cost is real: dynamic requires and anything resolved from a string are invisible. A parser would still not see names loaded at runtime.

**4. What false positives did you find, and why?** Found by removing the package and running the repo's tests: express's `hbs` (a view engine loaded by name) and postcss's `@size-limit/preset-small-lib` (a plugin loaded by name). Found by reading a config: `simple-git-hooks`, configured by its own package.json key (a scanner bug I then fixed with a general rule), and debug's `karma-mocha`, `karma-browserify` and `karma-chrome-launcher`, which `karma.conf.js` uses by short name (I read the config; I did not run those tests). Mocha's `tsx` is different: I found it by looking at the repo, listing its files and reading a nested fixture `.mocharc.yml` that contains `import=tsx`, which the scanner does not fetch. That was reading, not a removal test; I never ran mocha without `tsx`.

**5. Does "tests pass after removal" prove a candidate is safe?** No. It means the tests do not need it. CI, release scripts and developers' machines may. For postcss the tests passed with `simple-git-hooks` removed, yet it installs the pre-commit hook; and `multiocular` passing means only that nothing I ran needs it.

**6. How do you compute the packages saved?** Reachable from the manifest before, minus reachable after removing that entry. Shared dependencies stay, and a candidate another package depends on sheds 0 and the parent is named. All candidates together are computed jointly.

**7. Is the tree real?** It is a model. It follows the `latest` version of each package, ignores semver ranges and ignores peer and optional dependencies, so it is not your lockfile. Depth is capped at 6 and 900 packages.

**8. Why not use a force-directed graph, and why not size sectors by subtree size?** A force layout exploded with 400+ nodes in an earlier attempt, and it never settles, so the spider could not walk to a stable place. Sizing sectors by subtree size is tidier but needs the finished tree, which the spider cannot have while npm is still answering. So the layout is fixed and incremental. The trade-off is crowded wedges on heavy branches.

**9. What happens with a huge repo or rate limits?** Up to 300 source files are read, tests last, spread across directories, and the UI warns in proportion to how much was left unread (question 11). GitHub's unauthenticated API allows 60 requests per hour; a scan uses 1 or 2, there is an optional token field, and a readable rate-limit message with the reset time. The rate-limit path is unit-tested with fake responses; I have not triggered it in a browser.

**10. What would you do next?** Check the lower-confidence badge against more removal tests, since I wrote it after seeing postcss and debug; run depcheck with installed dependencies on all 13 repos instead of 3; run more removal tests, since 4 candidates in 2 repos is thin; and test the deployed site. I would not add a rule for one package.

**11. Why only 300 files, and what does deep scan change?** The scanner has to fetch every file one by one from the browser (the zip download is blocked by CORS), so the default reads 300: real source first, tests last, and spread across top-level directories and workspace packages so a monorepo is not represented by its alphabetically first package. When the cap is hit the app says so in proportion: no banner at 95% of the eligible files or more, an info banner from 25%, and below 25% a strong banner, an "unverified" badge on every candidate, and a shed headline that says "up to". Deep scan raises the cap to 1,500, which I measured does not trip any throttling on raw.githubusercontent.com (1,500 requests, all 200, about a minute). It reduces false ghosts on mid-size repos: mocha goes from 63% to a complete scan, and nx from 6% to 29% of its files, which drops its candidates from 144 to 85. But it cannot make a huge repo complete: next.js has about 25,000 eligible source files, so 1,500 is 6% and the strong banner stays. The remaining nx and next.js candidates are unverified, and I did not remove any of them to check.

## Things I have not verified

Firefox, Safari and a real phone; the animation's frame times on any machine but this one (and any real GPU); the GitHub Pages workflow and the hosted site; the 900-package cap against the real registry; Node 20; and accuracy in any statistical sense.
