# Animation performance: before and after

Date: 2026-10-16. Headless Chromium (Playwright build 1243) on the machine that built this project, via `scripts/perf.mjs`, on a RECORDED scan (`scripts/fixtures/debug.json`: debug-js/debug, 682 packages, packages fed at 25 ms each like a crawl, no network). The "build" phase is the crawl plus web building, "prune" is the cutting. 4x = Chrome DevTools `Emulation.setCPUThrottlingRate(4)`.

- **interval** = time between animation frames, what the viewer sees (16.7 ms = a locked 60 fps; "over 20 ms" counts dropped frames).
- **script** = main-thread time inside the page's own `requestAnimationFrame` callbacks.

Reproduce: `python3 -m http.server 8000`, then `PW_DIR=<folder with playwright> CHROME_PATH=<chromium> node scripts/perf.mjs debug [--throttle=4] [--dpr=2] [--profile]`.

## Root cause of the lag

The old `viz.js` repainted the whole web on every frame. Each frame it cleared the full canvas, rebuilt two `Path2D` objects with about 2 000 thread segments, filled up to 900 packages one by one (creating a colour string per package per frame), and every package was also being eased toward its slot, so everything was always "moving". That is cheap in JavaScript and expensive for the browser: the CPU profile of the old code at DPR 2 shows 74% of all time in `(program)` (native canvas rasterization and compositing, 18 152 ms) and only about 0.3 s in all of `drawNodes`, `drawEdges`, `consider`, `mix` and `drawLabels` together; script time per frame was 0.2 to 0.5 ms (p50 to p95). So the cost scales with canvas pixels, not with code speed: on a retina screen (4x the pixels) or a slower CPU every frame missed its budget. Measured: DPR 2 with 4x throttle gave a frame-interval p50 of 33 ms and p95 of 83 ms in the build, and 100 ms (10 fps) in the prune. At DPR 1 on this fast machine the old code looked fine (p95 16.7 ms), which is why the problem only shows on retina or slower hardware. Per-node DOM writes (a log rebuilt for every package) added to it.

## Before (old animation)

| Config | Phase | Frames | Interval p50 / p95 / max (ms) | Frames over 20 ms | Script p50 / p95 / max (ms) |
|---|---|---|---|---|---|
| DPR 1, 1x | build | 1031 | 16.7 / 16.7 / 33.3 | 1 | 0.5 / 1.1 / 8.0 |
| DPR 1, 1x | prune | 389 | 16.7 / 16.7 / 16.8 | 0 | 0.7 / 1.2 / 2.6 |
| DPR 1, 4x | build | 1033 | 16.7 / 16.7 / 50.0 | 3 | 0.7 / 1.7 / 10.4 |
| DPR 1, 4x | prune | 379 | 16.7 / 16.7 / 16.8 | 0 | 1.2 / 1.8 / 4.0 |
| DPR 2, 1x | build | 1054 | 16.7 / 16.8 / 33.4 | 23 | 0.2 / 0.5 / 2.2 |
| DPR 2, 1x | prune | 303 | 16.7 / 33.4 / 33.5 | 112 | 0.4 / 0.8 / 1.3 |
| DPR 2, 4x | build | 648 | 33.4 / 83.4 / 100.1 | 469 | 1.1 / 2.9 / 10.6 |
| DPR 2, 4x | prune | 89 | 99.9 / 100.1 / 133.4 | 89 | 1.9 / 3.1 / 6.4 |

## After (new animation)

| Config | Phase | Frames | Interval p50 / p95 / max (ms) | Frames over 20 ms | Script p50 / p95 / max (ms) |
|---|---|---|---|---|---|
| DPR 1, 1x | build | 1812 | 16.7 / 16.7 / 16.8 | 0 | 0.1 / 0.2 / 10.5 |
| DPR 1, 1x | prune | 464 | 16.7 / 16.8 / 33.3 | 2 | 0.2 / 0.4 / 12.9 |
| DPR 1, 4x | build | 1810 | 16.7 / 16.7 / 33.4 | 2 | 0.1 / 0.6 / 8.5 |
| DPR 1, 4x | prune | 477 | 16.7 / 16.8 / 83.3 | 4 | 0.1 / 0.7 / 27.3 |
| DPR 2, 1x | build | 1810 | 16.7 / 16.8 / 16.8 | 0 | 0.1 / 0.2 / 7.1 |
| DPR 2, 1x | prune | 472 | 16.7 / 16.8 / 33.4 | 3 | 0.1 / 0.2 / 10.8 |
| DPR 2, 4x | build | 1810 | 16.7 / 16.7 / 66.6 | 4 | 0.1 / 0.6 / 17.5 |
| DPR 2, 4x | prune | 447 | 16.7 / 16.8 / 150 | 10 | 0.1 / 0.7 / 27.4 |

**Target check** (p95 frame time at most 12 ms normal, at most 33 ms throttled): met in every configuration, whether read as frame interval (16.7 to 16.8 ms, vsync-bound) or as script time (0.2 to 0.7 ms). A "frame time under 12 ms" cannot be read from the interval because a 60 Hz display never reports less than 16.7 ms.

**What is not smooth yet:** the worst single frames. The maximum interval is 83 ms (DPR 1, 4x, prune) and 150 ms (DPR 2, 4x, prune); 10 of 447 prune frames (2%) went over 20 ms in the worst configuration. These are the full static redraws at each snip and each removal, which rebuild the web once per cut. They are rare single hitches, not sustained lag, but they exist.

Note on the new rows: they have about 1.8x as many frames because the build now takes about 30 s on purpose (the old one took about 17 s), so the counts are not comparable, the percentiles are.

## What changed

- `choreo.js` (pure, unit-tested): incremental fixed layout that never re-flows, the spider's planner, the timeline.
- `viz.js`: two stacked canvases. The static layer is only drawn when the spider anchors a package (one thread and one dot) or when packages are removed (one batched redraw per cut). The live layer holds only the spider, the thread being laid, glints, snip flashes and falling packages, and is cleared with a dirty rectangle. Edges are batched into `Path2D` strokes per colour, nodes into 16 colour buckets, no `shadowBlur`, no filters, glow sprites pre-rendered, DPR clamped to 2, delta time clamped, fixed pools for effects (no allocation per frame), no work in a hidden tab.
- `app.js`: DOM counters and the log are written at most 10 times a second from what the spider has built, instead of once per package.

## Review of the captured frames against R1 to R8

Screenshots every 0.5 s of the build and the prune were captured on the postcss and fastify fixtures and looked at (not committed). Checks are marked: unit test (`test/choreo.test.mjs`), browser (captured frames or a scripted run), code only.

| Rule | Status | How it was checked |
|---|---|---|
| R1 nothing visible before the spider reaches it | met | unit test: a package appears only when the spider is at its position and its parent already exists (sampled every 0.25 s on fastify; also at step ends on fastify and debug). Frames show only anchored packages. |
| R2 thread tip is the spider | met | unit test: thread end equals the spider position at 900 sampled instants; the live layer draws the thread from the parent anchor to the spider position. Frames show the line ending at the spider. |
| R3 heading, legs, pause, dew glint | implemented, partly checked | heading turn rate is limited (16 rad/s), legs animate only while moving and their phase follows distance, each anchor has a rest, a glint is drawn at each anchor: code only. I did not verify the leg motion or the glint visually frame by frame; at high pace they last a few frames. |
| R4 returns along existing threads | met | unit test: every return path is a chain of parent/child pairs. Includes the "package delivered after the spider left" case, which the first version of the planner got wrong (found and fixed while writing this). |
| R5 intro drop on a silk line | met | unit test (path from above the canvas to the centre) and frames: the silk line from the top edge to the spider, then the hub anchored. |
| R6 coupled to delivered packages, hangs when nothing is ready | met | unit test: the planner returns nothing (and invents no move) when no package is ready, and resumes when one arrives. Live run on postcss: the status text showed "the spider is waiting for npm to answer…" before it showed "anchoring …". The sway animation itself was not looked at. |
| R7 pace, Skip, Replay | met | planned durations 15.5 s (228 packages), 23.1 s (464), 29.8 s (682); first 15 packages at natural speed (unit test). Skip: 0.3 s from click to the finished state with all 682 packages on the canvas. Replay: runs again from the cached result and ends with the same numbers (took 37 s for 682 packages including the prune). Reduced motion: finished state after 6 s on postcss (mostly the simulated crawl feed), numbers correct. |
| R8 prune | met, with one gap | frames show the spider returning along existing threads to the hub, the red thread, the snip flash, then only the packages in the shed report greying and falling; the final tallies match the scanner (-23 of 228 on postcss, -7 of 682 on debug, -1 of 464 on fastify). The counter is driven from the moment each package starts to fall; I verified the final value, not the intermediate values. |

## Honest list of what still looks off or is unverified

- **Crowded wedges.** The layout has to place a package the moment it arrives, before the tree's final shape is known, so each package gets an equal share of its parent's wedge. Heavy branches (the long columns at the bottom and left of the fastify web) are denser than the old subtree-size layout made them. A small radial stagger helps but does not fix it. The earlier layout by subtree size (`layout.js`) needed the finished tree, so it was deleted along with its test.
- **Very fast late phase.** After the first 15 packages the spider accelerates up to 14x so 500 packages fit in about 25 s; at the top speed it covers several hundred pixels a second per frame and reads as a streak, not as walking. That is the requested trade-off, but it is not "natural speed".
- **Cross threads** (dependencies shared between packages) are drawn once, faintly, after the build finishes, not laid by the spider. They are the only things that appear without the spider having visited them.
- **Pop-in of the static redraws** and the 83 to 150 ms hitches listed above.
- Not verified: Safari, Firefox, a real phone, a real GPU. All numbers come from headless Chromium on one machine with software-assisted canvas; a GPU could be faster or behave differently. The 4x CPU throttle is an emulation, not a slow device.
- Not measured: memory, battery, long sessions, tab switching.

## Beautify branch: before and after (themes and depth cues)

Date: 2026-10-16. Same harness (`scripts/perf.mjs`), same recorded scan (debug, 682 packages), same headless Chromium. **Before** = the commit the branch started from (the animation described above), served from a frozen copy; **After** = the `beautify` branch with sphere sprites, two-pass silk, glints, sparks, dust, vignette, tilt and the theme palette. Columns: frame interval p50 / p95 / max in ms (frames over 20 ms in brackets), then script time per frame p50 / p95 / max in ms.

| Config | Phase | Before: interval p50/p95/max (>20 ms) | Before: script p50/p95/max | After: interval p50/p95/max (>20 ms) | After: script p50/p95/max |
|---|---|---|---|---|---|
| DPR 1, 1x | build | 16.7 / 16.8 / 16.8 (0) | 0.1 / 0.3 / 4.1 | 16.7 / 16.8 / 33.3 (1) | 0.1 / 0.2 / 4 |
| DPR 1, 1x | prune | 16.7 / 16.8 / 16.8 (0) | 0.2 / 0.5 / 14.2 | 16.7 / 16.7 / 33.3 (1) | 0.1 / 0.2 / 16.6 |
| DPR 1, 4x | build | 16.7 / 16.7 / 33.3 (2) | 0.1 / 0.6 / 6.3 | 16.7 / 16.7 / 66.7 (3) | 0.1 / 0.7 / 20.3 |
| DPR 1, 4x | prune | 16.7 / 16.8 / 100 (3) | 0.1 / 0.5 / 31 | 16.7 / 16.8 / 150 (3) | 0.2 / 1.1 / 51.9 |
| DPR 2, 1x | build | 16.7 / 16.8 / 16.8 (0) | 0.1 / 0.1 / 1.1 | 16.7 / 16.7 / 33.3 (1) | 0.1 / 0.2 / 4.1 |
| DPR 2, 1x | prune | 16.7 / 16.7 / 16.8 (0) | 0.1 / 0.2 / 1.2 | 16.7 / 16.8 / 33.4 (1) | 0.1 / 0.2 / 12.7 |
| DPR 2, 4x | build | 16.7 / 16.7 / 66.6 (3) | 0.1 / 0.5 / 4.1 | 16.7 / 16.7 / 99.9 (3) | 0.1 / 0.5 / 7 |
| DPR 2, 4x | prune | 16.7 / 16.8 / 66.7 (8) | 0.1 / 0.6 / 14.2 | 16.7 / 16.8 / 166.6 (11) | 0.4 / 1.4 / 17.1 |

**Budget** (p95 frame time at most 12 ms normal and at most 33 ms throttled): met in all eight configurations. The p95 frame interval is 16.7 to 16.8 ms before and after (vsync-bound), and p95 script time is at most 0.7 ms (build) and 1.1 ms (prune) at DPR 1, and at most 0.5 and 1.4 ms at DPR 2 with 4x throttle.

**What got worse (read this):** the worst single frames in the prune. The maximum interval rose from 100 ms to 150 ms (DPR 1, 4x) and from 67 ms to 167 ms (DPR 2, 4x), and the frames over 20 ms in the DPR 2, 4x prune went from 8 to 11 of about 450. The cause is the static layer: it now draws a sprite per package (up to 682 `drawImage` calls) instead of filling batched circles, and the prune redraws it at its start, at each snip and at each removal. At normal CPU speed the worst prune frame is 33 ms. Not cut, because the p95 budget holds, but it is a real regression in hitches. A cheaper next step would be to redraw only the removed region or to merge the snip and removal redraws.

**Effects cut: none.** Nothing breached the p95 budget, so nothing was removed. Effects that cost per frame are kept small on purpose: the dust layer is a CSS animation (no JavaScript per frame), the spark pool is capped at 60, the glint is one sprite, sprites are pre-rendered per theme, and the idle shimmer runs only before the first scan (it is not in these measurements, because the fixture starts the scan at once).

Caveats as above: one machine, headless Chromium, software-assisted canvas, CPU throttle is an emulation, no Safari, Firefox, phone or real GPU.
