# Lag diagnosis: measured in a real, headed browser

Date: 2026-10-16. Chrome for Testing 153, **headed** (a real window, no viewport emulation), Apple M2 through ANGLE/Metal with `2d_canvas`, `gpu_compositing` and `rasterization` all enabled (read from DevTools `SystemInfo`), native `devicePixelRatio` 2, window 1440 x 771. Harness: `scripts/perf-headed.mjs` (frame intervals, Long Animation Frames, and a Chrome trace summed per thread group). A simulated pointer wanders over the canvas for the whole run. The 464-package fastify fixture stands in for the "500-node" one; its prune is tiny (shed 1), so the prune rows show redraw cost, not removal volume. 4x CPU throttle is `Emulation.setCPUThrottlingRate`, which slows the main thread only, not the GPU.

**What this machine can and cannot say.** The user's device is not this Mac. On this Mac the steady-state frame rate is a locked 60 fps in every variant, including the last good version, so **I could not reproduce the lag here**. What the headed run adds over the headless one is a measurement of GPU-process time per frame. Everything below is read with that limit in mind; where differences are inside run-to-run noise I say so. Two identical HEAD runs gave GPU 5.7 and 4.6 ms/frame, so differences below about 0.6 ms/frame are noise.

### Build and prune, native DPR 2, headed, 464-package fixture (fastify)

| Run | Phase | Interval p50 / p95 / max (ms) | Frames over 33 ms | Busy per frame, ms: main / compositor / raster / GPU |
|---|---|---|---|---|
| 576b32e (last good) | build | 16.7 / 17.5 / 366.6 | 1 | 1.5 / 0.7 / 0.5 / 6 |
| 576b32e (last good) | prune | 16.7 / 17.5 / 33.2 | 0 | 0.8 / 0.4 / 0.4 / 2.4 |
| 576b32e, repeat | build | 16.7 / 17.5 / 34.2 | 1 | 1.5 / 0.9 / 0.5 / 5 |
| 576b32e, repeat | prune | 16.7 / 17.5 / 17.7 | 0 | 0.8 / 0.4 / 0.4 / 2.3 |
| beautify HEAD before the fix | build | 16.7 / 17.5 / 815.7 | 3 | 2 / 1.1 / 0.5 / 5.7 |
| beautify HEAD before the fix | prune | 16.7 / 17.5 / 33.5 | 1 | 1 / 0.5 / 0.3 / 3.3 |
| after the fix | build | 16.7 / 17.5 / 65.8 | 3 | 1.9 / 0.9 / 0.5 / 5.3 |
| after the fix | prune | 16.7 / 17.5 / 33.3 | 0 | 0.9 / 0.4 / 0.3 / 2.9 |
| after the fix, repeat | build | 16.7 / 17.5 / 100.4 | 1 | 1.8 / 0.9 / 0.5 / 5.3 |
| after the fix, repeat | prune | 16.7 / 17.4 / 33.3 | 0 | 0.9 / 0.4 / 0.3 / 3 |
| 576b32e, 4x CPU throttle | build | 16.7 / 17.5 / 182.4 | 1 | 1.3 / 0.2 / 0.2 / 1.3 |
| 576b32e, 4x CPU throttle | prune | 16.7 / 17.6 / 66.9 | 1 | 0.7 / 0.1 / 0.2 / 0.5 |
| HEAD before the fix, 4x throttle | build | 16.7 / 17.5 / 600.9 | 2 | 2.1 / 0.3 / 0.2 / 1.7 |
| HEAD before the fix, 4x throttle | prune | 16.7 / 17.5 / 83.3 | 3 | 1.2 / 0.1 / 0.1 / 0.9 |
| after the fix, 4x throttle | build | 16.7 / 17.6 / 66.7 | 2 | 2.4 / 0.3 / 0.2 / 1.7 |
| after the fix, 4x throttle | prune | 16.6 / 17.6 / 34.4 | 2 | 1.1 / 0.1 / 0.1 / 0.9 |
| after the fix, Lite effects on | build | 16.7 / 17.5 / 20.8 | 0 | 1.7 / 0.9 / 0.5 / 5.1 |
| after the fix, Lite effects on | prune | 16.7 / 17.5 / 716.6 | 1 | 1.2 / 0.5 / 0.5 / 3.7 |

### One effect off at a time (HEAD before the fix), build phase

| Effect switched off | Interval p95 | Frames over 33 ms | GPU ms/frame | Main ms/frame | Change in GPU vs HEAD (5.7) |
|---|---|---|---|---|---|
| tilt | 17.6 | 1 | 4.9 | 1.7 | -0.8 |
| dust | 17.4 | 3 | 6 | 2 | +0.3 |
| vignette | 17.5 | 2 | 5.4 | 1.9 | -0.3 |
| glow | 17.5 | 0 | 5.7 | 1.9 | +0.0 |
| additive | 17.4 | 3 | 5.6 | 1.9 | -0.1 |
| halo | 17.5 | 0 | 5.4 | 1.8 | -0.3 |
| fog | 17.5 | 2 | 5.4 | 1.9 | -0.3 |
| glints | 17.5 | 0 | 5.5 | 1.9 | -0.2 |
| sparks | 17.5 | 1 | 5.9 | 2 | +0.2 |
| countup | 17.5 | 1 | 5.4 | 1.8 | -0.3 |
| ALL | 17.5 | 2 | 4.3 | 1.5 | -1.4 |

### Idle (empty page, 9.9 s)

| Variant | rAF callbacks | GPU ms/frame | Total GPU ms over the run |
|---|---|---|---|
| before the fix, idle animations on | 679 | 3.3 | 2241 |
| before the fix, idle animations off | 689 | 2.3 | 1585 |
| after the fix (tier 2) | 675 | 2 | 1350 |
| after the fix, Lite on | 0 | n/a | 230 |


## What the numbers show

- **p95 frame interval is 17.4 to 17.6 ms in every run, including `576b32e`.** That is a 60 Hz display (16.7 ms) plus about 1 ms of jitter, so the requested "p95 <= 17 ms" is at the measurement resolution and no version, good or bad, strictly meets it here. It does mean no variant dropped frames in steady state on this GPU.
- **Frames over 33 ms per run** (build + prune together): `576b32e` 1 and 1; HEAD before the fix 4; after the fix 3 and 1; HEAD at 4x 5, after the fix at 4x 4. The "at most 2 per run" budget is met by one of two normal "after" runs and by neither 4x run. These counts are small enough that run-to-run variation is as large as the differences.
- **Start-up stalls are not an effect.** The first build interval sometimes contains one huge frame (366 ms in `576b32e`, 816 ms in HEAD), but a repeat of the same HEAD code with Long-Animation-Frame attribution showed none (max 32 ms), and `576b32e` repeated showed 34 ms. They appear at random in both versions, most likely browser or trace start-up, and are not attributable to any effect.
- **The GPU process, not JavaScript, is where the time goes:** main thread 1.5 to 2 ms per frame, GPU 4 to 6 ms of a 16.7 ms budget at DPR 2. That is the cost a weaker GPU multiplies, and headless Chromium cannot see it.
- **Effects together cost about 1.4 ms of GPU per frame** (everything off: 4.3, HEAD 5.7). The other 4.3 ms is a floor: compositing three full-size layers (static canvas, live canvas, the CSS background) plus two more in HEAD (a dust canvas and the vignette overlay) at roughly 3 megapixels each on this window (the dust canvas was 112% of that).

## Top three culprits (ranked by evidence, with the strength of that evidence)

1. **An animation loop that never stopped.** On the empty page the idle animation (sway plus ring shimmer) kept the loop at 60 fps forever: 3.3 ms of GPU per frame, 2241 ms of GPU time over a 10 s idle, against 2.3 ms with the idle animation switched off (1585 ms). Consistent and the largest measured effect. After the fix: 2.0 ms/frame and 1350 ms at tier 2 (30 fps idle), and **230 ms with Lite effects, where the loop stops completely** (0 animation frames in 10 s).
2. **The pointer tilt.** Switching it off lowered GPU time by 0.8 ms/frame (5.7 to 4.9), the largest single steady-state effect. This is at the edge of the noise (about 0.6), so it is weak evidence on its own; it is also structurally the most expensive effect, because a 3D transform on a viewport-sized container forces its canvases onto separate composited layers and re-composites them on every pointer move.
3. **Layer count and pixel count (the floor).** Dust canvas, vignette overlay, static canvas and live canvas at DPR 2 on this window are each roughly 3 megapixels. Removing the vignette alone saved 0.3 ms (noise level); the all-effects-off run still costs 4.3 ms/frame. This is the cost that grows with pixels and with GPU weakness, which is why the fix folds two layers into one static CSS background and caps each canvas at 2.5 megapixels.

Not culprits on this machine (each within noise, 0 to 0.3 ms): the wide glow stroke pass, additive blending, the spider halo, depth fog, thread glints, spark particles, the count-up.

## What was changed (commit `f2debae`)

- **One static CSS background** on the canvas parent holds the vignette, the dust image and the centre glow. The dust canvas, its 112% oversize and drift animation, and the `::after` vignette overlay are gone. Two full-size layers fewer.
- **Tilt only in tier 2**, with no permanent `will-change` (the container is promoted only while the tilt is not flat). Off on touch devices and for reduced motion, as before.
- **The frame loop stops when nothing is animating** (no step, no effect, no pointer easing, no pending redraw) and restarts on new data, a pointer move, a resize, a theme change or a tab becoming visible. Idle animation runs at 30 fps at most, and not at all at tier 0 or with reduced motion.
- **Backing-store cap:** each canvas is limited to about 2.5 megapixels by lowering the pixel ratio on large canvases (tier 0 uses ratio 1).
- **Quality tiers** with a rolling 60-frame p95 monitor. 2 full; 1 no tilt, no dust, no wide glow pass, no additive blending; 0 also ratio 1, no depth fog, no glints, no particles, no idle animation. If p95 stays above 22 ms for 1.5 s it steps down one tier for the rest of the session; it never steps up on its own. Touch and coarse-pointer devices start at tier 1. A **Lite effects** checkbox forces tier 0 and is saved in `localStorage` inside a try/catch (the page works without storage). Verified with artificial per-frame slowdown: tier 2 to 1 after 1.9 s, 1 to 0 at 6.0 s, and no step back up when frames became fast again.

**Not changed, on purpose:** putting the doomed branch on its own layer. The headed run shows no prune problem (p95 17.5 ms, worst frame about 33 to 83 ms), so there was nothing measured to fix; redrawing the static layer at each cut remains.

## What the fix did and did not achieve (measured)

- Idle GPU time per 10 s: 2241 ms to 1350 ms (tier 2) and 230 ms (Lite).
- Build and prune GPU per frame: 5.7 to 5.3 and 3.3 to 2.9/3.0, within noise. **I could not show an improvement in steady-state build or prune frame times on this machine, because there was no steady-state problem to remove here.**
- The structural cost that scales with weaker GPUs (layers, pixels, an always-on loop) is lower, and there is now a safety net that degrades on its own. Whether that is enough on the device where it lagged is **not verified**: I do not have that device.

## Headless regression check (kept only as a regression check)

`scripts/perf.mjs debug --dpr=2 --throttle=4` after the fix: build p50 / p95 / max 16.7 / 16.8 / 200 ms (4 frames over 20 ms), prune 16.7 / 16.8 / 200 ms (14 frames over 20 ms); script time p95 0.8 ms (build) and 0.7 ms (prune). The old headless budget (p95 at most 33 ms) still holds. The prune tail is no better than before the fix (it was 11 frames over 20 ms and a 167 ms worst frame in the previous measurement); it is the static-layer redraw at each cut, which this change deliberately left alone.

## Not verified

The lagging device itself; a weaker or integrated GPU; Safari and Firefox; phones (the touch start tier, `isMobile`, and the real compositor there); thermal throttling over minutes; DPR 3 screens. The CPU throttle does not slow the GPU. The fastify fixture has 464 packages, not 500, and its prune is tiny.

## Follow-up: the live site looked "like the old version" (2026-10-16)

- **The deployed build was the new one.** Deploy run `38944372488` (commit `7a6d517`) succeeded, and nine files fetched from the live site (`index.html`, `style.css`, and the seven modules `app`, `viz`, `theme`, `flags`, `color`, `choreo`, `legend`) were byte-identical (SHA-256) to the repository; `index.html` contained the theme selector, the legend and the effects control. So this was not a failed deploy or a stale build. GitHub serves these files with `max-age=600`, so a browser that had loaded the site in the previous 10 minutes can keep older files until a hard refresh.
- **The quality tier did strip part of the look on touch devices.** In a phone emulation (touch, `(pointer: coarse)`) with default settings, the code that was live ran at tier 1 with **no dust, no additive glow and no wide silk-glow pass**; the retuned code at the same tier has all three. Side by side ([docs/screenshots/tiers/live-vs-retuned-phone-tier1.png](../docs/screenshots/tiers/live-vs-retuned-phone-tier1.png)) the difference is **modest**: the starfield dust is the visible part. Spheres, themes, the restyled panel and depth shading were present in both. A phone that also stepped down to tier 0 automatically (pixel ratio 1, no fog, no glints) would look flatter and softer. I could not see the reporting device, so whether this fully explains what they saw is **not established**.
- **Retune:** the effects that cost about 0 to 0.3 ms per frame (wide glow pass, additive blending, dust) moved back into tier 1; tier 1 now drops only the pointer tilt and the idle ring shimmer. The tiers are listed in the README.
- **Default tier, headed, after the retune** (three runs on the 464-package fixture, native DPR 2): p95 frame interval 17.4, 17.4 and 17.5 ms (the last at 4x CPU throttle), at most 1 frame over 33 ms per run, GPU 5.2 to 5.7 ms/frame in the build and 3.0 in the prune. No regression against the 17.5 ms measured before the retune.
