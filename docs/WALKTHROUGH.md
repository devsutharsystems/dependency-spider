# Walkthrough: how to explain Dependency Spider

Everything below is checked against the code and against runs on 2026-10-16. Numbers move as repos and npm change; say "when I ran it".

## The one-minute version

You paste a GitHub repo. The app reads `package.json` and up to 300 source files, finds the dependencies the code never imports and no script or config mentions (candidates), crawls the npm registry to build the dependency tree, and shows how many packages would leave the tree if those candidates were removed. It is a static site: no backend, no API key, no LLM. depcheck and Knip already find unused dependencies; the extra here is the "what does removing it shed" number, the visualization, and a public, honest comparison with depcheck.

## The modules, one paragraph each

**`util.js`.** Small shared helpers: a typed error (`SpiderError` with a code, so the UI can show a friendly message), a bounded-concurrency map (8 requests at a time), and `fetchRetry` (retries 429 and 5xx with backoff, and gives up on a hung request after 30 s). It exists so every network call behaves the same way. The timeout was added after a validation run hung with no error.

**`extract.js`.** Turns source text into npm package names. Regexes find `from 'x'`, `import 'x'`, `import('x')`, `require('x')` and `require.resolve('x')`. `toPackageName` reduces `lodash/fp` to `lodash` and `@scope/pkg/sub` to `@scope/pkg`, and rejects relative paths, `node:` imports, aliases, templates and Node built-ins. It has no network and no DOM, so it is easy to test.

**`github.js`.** Everything about GitHub: parsing the many URL forms, listing files with the trees API (try `HEAD`, fall back to the default branch), fetching raw files, and choosing which files to read (`pickSourceFiles`, `pickConfigFiles`). It also classifies each path as source, test, fixture, example or tooling. `fetch` is injected everywhere, which is why the tests never touch the network.

**`analyze.js`.** The decision-maker. A dependency is used if it is imported anywhere or mentioned in `scripts`, in other package.json keys, or in config files; otherwise it is a "ghost" (I show it as a candidate). It also finds "misplaced" (a production dependency used only from tests or examples) and "phantom" (imported but not declared) packages, and records why each used package counts as used, which the validation script uses.

**`registry.js`.** Talks to the npm registry. `fetchLatest` reads `/<name>/latest` (a few KB); `crawl` does a breadth-first walk from every declared dependency (depth up to 6, cap 900 packages, shared cache). `fetchModified` and `addModified` are an optional second pass for the "last modified" date, because that data is huge (93 MB for fastify's 464 packages). `fragility` turns age, maintainer count and deprecation into a 0-to-1 colour; it is a heuristic, not a security verdict.

**`graph.js`.** The math. `reachable` finds everything reachable from the manifest; `shedReport` computes, per candidate and for all together, how many packages disappear; `uninstallCommand` builds the `npm uninstall` lines.

**`layout.js`.** A pure function that places each package on a ring by depth and gives each subtree an angular sector proportional to its size.

**`viz.js`.** The canvas: rings, nodes easing into position, the spider sprite, the prune animation, the share image. Glow comes from pre-rendered sprites (no per-node `shadowBlur`), it handles `devicePixelRatio`, and it respects reduced motion.

**`pipeline.js`.** Orchestration shared by the browser and the Node scripts: URL, file list, `package.json`, files, imports, crawl, classification, peer-dependency check, shed numbers. It emits progress events the UI listens to.

**`report.js`, `cards.js`.** Text output (plain report, PR description) and the candidate card, including the "cannot see packages loaded by name at runtime" caveat shown under every candidate.

**`app.js`.** The browser wiring: form, progress panel, cards, buttons (copy, PR text, download image), error messages and resetting state between scans.

**`scripts/`.** `acceptance.mjs` (checks known repos), `validate.mjs` (compares with depcheck on 13 repos), `depcheck-installed.mjs` (repeats the comparison after installing dependencies).

## The five design decisions that matter

1. **Fixed radial layout, not a force simulation.** My earlier attempt with a force-directed layout exploded at 400+ nodes. A fixed layout (ring = depth, sector size = subtree size) is deterministic, costs one pass, and never jitters. Nodes ease from their parent to their slot, so it still looks alive.

2. **The dependency maps are excluded from the mention search.** "Mentioned in scripts or config counts as used" is only meaningful if the search text excludes `dependencies`, `devDependencies` and similar. If you search them, every dependency mentions itself and you find zero ghosts with no error. There is a unit test for exactly this trap.

3. **Bin-name matching.** A package is often run by a different name than it is installed under (`npm-run-all2` runs as `run-p`; `branch-comparer` runs as `branchcmp`). The registry gives each package's bin names, and those names count as mentions. The mention match is also token-bounded, so `tap` does not match `tape`.

4. **Non-test files first when capped.** At most 300 files are read. If tests came first, a test-heavy repo (229 of fastify's 282 source files are tests) would push real source out of the cap and create false ghosts. Ranking source first and tests last keeps the cap from inventing candidates. When the cap is still hit (mocha: 300 of 478), the UI warns.

5. **Shed = reachable before minus reachable after.** The number of packages a removal saves is not "the package and its dependencies": shared dependencies stay. So I compute everything reachable from the manifest, remove that one entry, recompute, and subtract. If another package still depends on the candidate, the shed is 0 and the UI names that package ("still needed by neostandard"). The total for all candidates is computed together, so overlaps are not double-counted.

A sixth, smaller one: over-counting usage is the safe direction. Block comments are not stripped (globs like `lib/*.js` would swallow real imports), because a missed import creates a false ghost while an extra import only hides one.

## The three results to be ready to explain

**1. `branch-comparer` was cleared by bin matching.** I started from the belief that fastify's `branch-comparer` was unused (an earlier Python run said so, and depcheck without an install agreed). The app does not flag it. I checked: its registry bin is `branchcmp`, and fastify's `bench` script runs `branchcmp`. So my first claim was wrong and the bin-name rule corrected it. The honest point: the dependency is never imported, so "never imported" alone is a wrong test. The same repo's `typescript` was flagged at first and is now reported separately because `tstyche` lists it as a peer dependency.

**2. `hbs` was a false positive (and so was one postcss candidate).** On express I removed the one candidate, `hbs`, reinstalled and ran the tests: 1261 passing before, 1255 passing and 6 failing after (the `mvc` example). Express loads view engines by name at runtime. On postcss I removed all three candidates: unit tests still pass (720/720) but `test:size` fails, because `size-limit` loads `@size-limit/preset-small-lib` by name. Lesson: a regex scanner cannot see packages loaded from strings, so every candidate needs checking, and the UI says so. Passing tests only mean the tests do not need a package.

**3. The depcheck baseline correction.** My first comparison ran depcheck without installing dependencies and showed depcheck flagging 84 packages against my 15, which invites the reading "my tool is more accurate". That was an unfair baseline: without `node_modules`, depcheck cannot see the bins of installed tools. After installing dependencies on 3 repos, depcheck's flags fell from 23 to 8, my candidates were 8, and we overlapped on 6. And agreement is not correctness anyway: both tools flagged `hbs` and `@size-limit/preset-small-lib`. So I relabelled the 13-repo table as "without installing" and made the installed comparison the lead.

## Ten likely questions

**1. Why build this when depcheck and Knip exist?** Because the interesting number is different: how many packages in the whole dependency tree a removal sheds, shown visually. It is not a better detector, and the README says so. It is also a project to learn from and to measure honestly.

**2. How accurate is it?** I do not know, and I do not claim a number. I compared it with depcheck on 13 repos and ran removal tests on 2 (4 candidates, at least 2 false positives). That is evidence about failure modes, not an accuracy figure.

**3. Why regexes and not a parser?** It runs in the browser with no build step and no dependencies, and import statements are regular enough. The cost is real: dynamic requires and anything resolved from a string are invisible. A parser would still not see names loaded at runtime.

**4. What false positives did you find, and why?** Packages loaded by name from a string: express's `hbs` (a view engine) and postcss's `@size-limit/preset-small-lib` (a plugin). Also a tool configured by a top-level package.json key (`simple-git-hooks`), which the scanner misses because it only searches key values. And mocha's `tsx`, referenced only from a nested fixture config that is not fetched.

**5. Does "tests pass after removal" prove a candidate is safe?** No. It means the tests do not need it. CI, release scripts and developers' machines may. For postcss the tests passed for `multiocular` and `simple-git-hooks`, and `simple-git-hooks` still installs the pre-commit hook.

**6. How do you compute the packages saved?** Reachable from the manifest before, minus reachable after removing that entry. Shared dependencies stay, and a candidate another package depends on sheds 0 and the parent is named. All candidates together are computed jointly.

**7. Is the tree real?** It is a model. It follows the `latest` version of each package, ignores semver ranges and ignores peer and optional dependencies, so it is not your lockfile. Depth is capped at 6 and 900 packages.

**8. Why not use a force-directed graph?** It exploded with 400+ nodes in an earlier attempt. A fixed radial layout is deterministic and cheap.

**9. What happens with a huge repo or rate limits?** Up to 300 source files are read, tests last, and the UI warns when the cap is hit. GitHub's unauthenticated API allows 60 requests per hour; a scan uses 1 or 2, there is an optional token field, and a readable rate-limit message with the reset time. The rate-limit path is unit-tested with fake responses; I have not triggered it in a browser.

**10. What would you do next?** Search package.json key names; add a rule for the "plugin loaded by a tool" class in general (for example, packages whose names start with a used tool's name plus a dash, such as `size-limit` and `@size-limit/...`), checked against more removal tests; run depcheck-installed on all 13 repos; and test the deployed site. I would not add a rule for one package.

## Things I have not verified

Firefox, Safari and a real phone; the GitHub Pages workflow and the hosted site; the 900-package cap against the real registry; Node 20; and accuracy in any statistical sense.
