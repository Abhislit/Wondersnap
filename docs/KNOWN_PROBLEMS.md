# Known Problems in WonderSnap

An honest catalogue of what is wrong with this project, ordered by how much it hurts.

Last reviewed: 6 October 2026

This document is deliberately uncomfortable. A project that lists its problems is more useful
than one that claims to be finished. Where a problem is measurable, the measurement is given.
Where it is not measurable, it says so rather than guessing.

Related: [`PROJECT.md`](PROJECT.md) for the build plan and timeline.

---

## Severity key

| | Meaning |
|---|---|
| **Critical** | The project's premise depends on this working. |
| **Major** | Users will notice, or a contributor will hit it. |
| **Minor** | Rough edges, cleanup debt. |

---

## Critical

### C1. The gestures have never touched a human hand

Every threshold in `js/core/gestures.js` was derived from anatomical ratios and validated against
synthetic landmarks — coordinates I generated to resemble a hand, not a recording of one.

```
STRAIGHT_RATIO: 1.08    finger extension, tip vs PIP joint
REACH_RATIO: 1.20       finger extension, tip vs MCP joint
PINCH_DISTANCE: 0.50    thumb-index, as a fraction of palm width
SNAP_TIGHT_RATIO: 0.38  thumb-index must close below this
SNAP_MIN_RATE: 0.0018   closing rate per millisecond
```

Every automated test that "proves" gestures work is testing a synthetic hand against itself. The
suite confirms the code does what it was written to do. It says nothing about whether a person
can trigger it.

**Why it matters:** the entire pitch is "control it with your bare hands". If the fist threshold
is 8% too tight, nobody ever assembles the model, and there is no fallback that feels like the
product.

**What would resolve it:** the harness exists (`tools/tune.html`). Someone needs to hold a hand in
front of a webcam for twenty minutes and record a confusion matrix. Roughly half a day. See §4.3
of `PROJECT.md`.

---

### C2. The 240,000-particle budget has run on only one GPU *(partly resolved)*

Every measurement in this repository was originally taken under SwiftShader — CPU software
rendering — because no GPU was available. `tests/browser.test.mjs` forced it, via
`--use-angle=swiftshader`, so nothing could have measured hardware even if one had been present.

That flag is now switchable (`WONDERGL=vulkan`) and the suite has been run on real hardware:
an Intel Iris Xe (Tiger Lake, Vulkan/ANGLE) at 240,000 particles pinned gives **60fps exploded
and 29-31fps assembled**. Discrete and laptop GPUs remain unmeasured. At that point the app takes ~40 seconds to reach "Tracking live",
and framerate is not a meaningful number.

The particle pipeline is written for the GPU (float textures, ping-ponged FBOs, MRT) and the
architecture is sound. But "240k at 60fps" is a design target, not a measured result.

Measured under software rendering the app runs at **0.6fps** — previously masked by the broken
fps counter, which floored at 20 (see M5).

**Known risk:** whether 240k is viable at all on the hardware it will actually run on. The adaptive
quality controller in `js/core/quality.js` exists precisely because this is unknown, and it will
silently reduce quality to 4k on a weak machine rather than admit it cannot hold framerate. The
counter now reports honestly, so the top-left readout is the thing to trust.

**What remains:** open the app on a discrete and a laptop GPU and record the fps counter at the
default budget. Until then 60fps is shown to be reachable on weak integrated graphics, not shown
to be a floor.

---

## Major

### M1. Four models exist. The project claims twenty-nine

| Category | Done | Remaining |
|---|---|---|
| Wonders of the World | 1 | 6 |
| Human Anatomy | 1 | 4 |
| Biology | 1 | 3 |
| Engines & Vehicles | 1 | 4 |
| Machines | 0 | 4 |
| Interactive mechanical systems | 0 | 4 |

25 models outstanding, roughly 20–30 hours. The architecture makes them mostly mechanical —
picking, exploded view and narration all derive from the part list — but "mostly mechanical" is
not "done", and rushed models would undercut the four good ones.

### M2. Only Chrome has ever run this

No Safari, no Firefox, no mobile browser. Two specific unknowns:

- `EXT_color_buffer_float` and `EXT_color_buffer_half_float` availability differ across Safari
  versions. Missing means no simulation at all; the app throws a readable error rather than
  degrading.
- Safari caps WebGL2 texture and buffer sizes well below desktop. The particle system allocates
  several 32-bit float textures sized to `sqrt(particles)`, which is modest, but this is untested.

The camera also requires a secure context, so `localhost` works and a LAN IP does not. That is
correct behaviour but it makes casual "try it on my phone" testing harder than it needs to be.

### M3. No gesture switches models

Open palm used to advance to the next model. It was unbound because an incidental open hand —
reaching for a mug, waving — yanked the scene away mid-inspection.

The underlying problem is sensitivity, not the binding. The correct fix is to keep the binding and
require the pose to hold considerably longer than `ENTER_FRAMES: 3`, and to require a *deliberate*
posture (thumb extended, fingers spread) rather than any open hand. `PALM_COOLDOWN_MS` is the
knob.

Right now the tabs are the only route, which makes a hands-only session feel incomplete.

### M4. `pick()` is O(n) every frame while pointing

Measured: **193 µs per call** over 5,000 samples, on the CPU, on every frame the pointer gesture
is active. At 60 fps that is 1.2% of a frame budget — currently fine.

It matters because the cost is linear in `PICK_SAMPLE` and that constant will want raising for
better precision, and because `pick()` allocates nothing but does the full scan every time
regardless of how small the tolerance is. A uniform grid over the point cloud would make it
effectively constant.

### M5. ~~The fps counter could not report below 20fps~~ — fixed 2026-10-04

`js/main.js` clamped `dt` to 50ms for the simulation, which is correct, then accumulated that
*clamped* value into the fps counter:

```js
const dt = Math.min(0.05, (now - lastTime) / 1000);
fpsTimer += dt;
if (fpsTimer >= 0.5) lastFps = frames / fpsTimer;   // floors at 20fps
```

So the counter could never report worse than 20fps no matter how slow the app actually was. Under
software rendering the real frame time was **1766ms (0.6fps)** while the counter read 20.

This was worse than a cosmetic bug: it was the primary diagnostic for the performance question,
and it was structurally incapable of answering it. The same clamped value was also fed to the
quality controller, which therefore could not distinguish 20fps from 0.6fps. Both now use real
elapsed time, with the clamp kept only for the simulation.

### M6. Sprite size was clamped to a constant 18px — fixed 2026-10-04, superseded by M6b

The single largest cause of "the particles look blurry". The shader computed a desired
`gl_PointSize` of 116-743px, which was clamped down to 18px, so every particle was the same size
regardless of zoom or viewport. As the model grew on screen, the spacing between particles grew
while the sprites did not, so coverage collapsed.

Measured uncovered pixels, heart, 200k particles:

| Zoom | 640x480 before | after | 1920x1080 before | after |
|---|---|---|---|---|
| 1x | 0.0% | 0.5% | 0.3% | 0.4% |
| 2x | 0.6% | 2.5% | 28.6% | 1.9% |
| 4x | 43.1% | 6.9% | 86.4% | - |

Mean luminance at 1920x1080 also stopped collapsing: 28.6 -> 54.3 at 1x, and 14.6 -> 52.0 at 2x.

Sprite size is now derived from the projection, so it scales with zoom and viewport. Note the
residual 6.9% at 4x zoom, where the model overflows the viewport and part of the measured region
simply contains no model - some of that is measurement artifact, not uncovered surface.

The uncovered-pixel figures above were measured with the sprite held at a fixed fraction of model
radius, which is the defect M6b corrects, so they do not carry over to the current sizing.

### M6b. Sprite size ignored the particle budget, so the surface blurred at full budget — fixed 2026-10-06

This is the follow-on the first fix missed. `updateSpriteScale` derived the sprite from
`modelRadius * SPRITE_WORLD_FRACTION`, which is independent of how many particles there are. But the
gap between neighbouring particles grows as `1/sqrt(budget)`, so the number of sprites covering a
pixel grew with the budget:

| budget | inter-particle spacing | sprite | overlap | sharpness |
|---|---|---|---|---|
| 240k | 1.23 px | 23.9 px | **19.4x** | 30.9 |
| 4k | 7.8 px | 23.9 px | 3.1x | — |

At 19x overlap, additive blending puts roughly 380 sprites into every pixel and the model renders as
a featureless glow with its middle blown to white. It also meant a machine throttled down to 4k by
the quality controller rendered *sharper* than a strong one at 240k, which is backwards.

Fixed by sizing the sprite on the same `1/sqrt(budget)` law, so overlap is constant at every budget,
and by making exposure budget-independent to match (brightness goes as overlap x exposure, so
dividing exposure by the budget as well double-counted it).

Measured on the brain at 240k, Intel Iris Xe:

| | mean luma over mask | lit % | sharpness |
|---|---|---|---|
| before | 80.2 | 56.4 | 30.9 |
| after | 78.0 | 54.4 | **62.3** |

Overlap is now 2.5x at 240k, 120k, 60k, 30k and 4k alike. Framerate also improved, 31fps to 60fps on
this machine, because smaller sprites are cheaper to rasterise. The earlier coverage table in this
document was measured at 19x overlap and does not carry over.

### M7. Adaptive quality rebuilds geometry, and can oscillate

`Stage.setBudget()` constructs a new `ParticleSystem`, re-seeds the cloud and re-bakes the whole
model. That is the expensive operation the controller exists to avoid, and it happens on the main
thread.

On a genuinely marginal machine — fast enough to upgrade, then too slow to hold the upgrade — the
controller can cycle between two budgets indefinitely. It only upgrades when frame time is under
55% of target, which makes oscillation unlikely, but the failure mode is a visible hitch loop
rather than a smooth degradation.

### M8. Silent

No audio whatsoever. Engine models in particular are close to pointless without the sound of
something running; a four-stroke engine model is a diagram of motion, not an engine.

Deferred by decision, not oversight — see `PROJECT.md` §5.2. But it is a real gap between this
and a teaching tool.

---

## Minor

### m1. Dead code in `js/models/shapes.js`

Thirteen exported samplers; **four are used** — `spherePoint`, `boxBeamPoint`, `combine`, and
`mirrorX` (used since the brain model was added). The other nine (`shellPoint`, `torusPoint`,
`tubePoint`, `discPoint`, `boxPoint`, `boxShellPoint`, `cylinderPoint`, `lathePoint`, `curvePoint`)
are unreferenced.

They were written speculatively as a palette for future models, which is exactly the kind of
"scaffolding for later" that rots. Either they get used by the next five models or they go.

`CATEGORIES` in `js/models/index.js` is exported and unused — the category filter was never built.

### m2. `transformPoint` ignores `w`

`js/core/math.js` — correct for affine transforms, silently wrong for a projection. Unprojecting
NDC coordinates with it produces garbage roughly 50 units from where it should.

It is dead code today (picking projects screen-space instead), and a correct `unproject` exists
right next to it. A future contributor will reach for the wrong one. The fix is either deleting
it or renaming it to `transformPointAffine`.

### m3. Progress is recorded but never surfaced

`js/core/progress.js` tracks which parts have been explored and persists it. The only thing the
user sees is "3 of 9 explored" in the inspector when a part happens to be open. There is no
overall completion view, no model list showing what's unexplored, no reason to return.

For a learning tool the record exists and nothing reads it.

### m4. Voice availability varies

Narration depends on `speechSynthesis`. If the platform has no voices installed, `say()` silently
does nothing — the UI still shows "Narration on". Linux browsers without `speech-dispatcher`
installed are the common case.

### m5. FOV is hardcoded in two places

50° appears in `js/core/math.js:162` and again in `js/core/stage.js:173` (framing maths). They
must agree or the explode framing drifts from the actual projection. They agree today because
nobody has changed one.

### m6. ~~Brightness was coupled to particle count~~ — resolved 2026-10-06

`exposure = 700 / budget` existed to hold brightness steady across budgets. Once sprite overlap became
budget-invariant that was no longer the right relationship and was double-counting the budget;
exposure is now a constant.

### M9. Every model rendered at 63% of its intended size on a landscape display — fixed 2026-10-06

`frameDistance` computed the horizontal fit as `vertical * max(1, aspect)` and took the max of
the two. The frustum's half-width at distance `d` is `d*tan(halfFov)*aspect`, so fitting an
extent of radius R horizontally needs `R / (tan(halfFov) * aspect)` — the aspect ratio is a
*divisor*, not a multiplier. On a 16:10 display the old code therefore sat 1.6x further back
than the projection asked for, and every model rendered at 63% of its intended size. It got
worse on wider screens, so the bigger the window the smaller the model, which is the opposite of
what a full-bleed canvas should do.

A second term made it asymmetric: `modelRadius * 1.2` was a floor inside the same `max()`, so
larger models were pushed further away still. The eiffel tower (radius 3.27) sat well past its
own extent while a small model was unaffected.

Measured on the brain at 1400x900:

| | camera distance | model height | share of window |
|---|---|---|---|
| before | 9.73 | 349 px | 38.7% |
| after | 5.99 | 566 px | 62.9% |

The model now fills a consistent share of the frame at any viewport, and `FRAME_FILL` (0.92)
provides the margin the `1.2` floor was reaching for.

### m7. Reduced-motion support is partial

`prefers-reduced-motion` disables idle spin and quarters turbulence. It does not touch the burst
on load, the explode transition, or the pinch-grab spring — all of which are large motion.

---

## Test coverage: what the suite does and does not prove

108 unit assertions, 21 browser checks, both in CI. Worth being precise about what that buys.

**Proven:**
- Pose classification is internally consistent and mutually exclusive against synthetic landmarks
- Hysteresis and cooldown suppress repeat firing and flicker
- Snap detection rejects slow closes and held-open hands
- Every part of every model is pickable in the exploded view — 100% self-hit accuracy
- Particle geometry bakes deterministically with no NaN, budget fully allocated, bounds sane
- Matrix maths round-trips; unprojection is correct
- Progress survives a reload and recovers from corrupt storage
- Particles reach the framebuffer; brightness stays in a sane range
- Adaptive quality never exceeds its bounds and does not thrash
- A denied `localStorage` does not break boot (verified, 2026-10-03)

**Not proven:**
- That any gesture is recognisable by a human hand
- That the app is usable at any framerate, on any GPU
- That it works outside Chrome
- That the models look like what they claim to be. The heart and jet engine are procedural
  approximations checked for *structure* — named parts, reachable geometry — not for anatomical
  or mechanical accuracy. Nobody has compared them against a reference image.

That last gap is uncomfortable: the models pass every test while being, in places, a
simplification. A test that asserts "the aorta exists" is satisfied by a tube.

---

## Summary

| Severity | Count | Blocking release? |
|---|---|---|
| Critical | 2 | Yes |
| Major | 10 (4 since fixed) | Yes |
| Minor | 7 | No |

The two critical problems share a root cause: **everything has been verified against synthetic
or absent inputs.** No real hand, no real GPU, no second browser. The code is written defensively
around that — adaptive quality, readable errors, a tuning harness — but the confidence is
borrowed from tests that cannot see the thing users actually see.

Fixing C1 and C2 is roughly a day of work. Fixing M1 is three weeks.