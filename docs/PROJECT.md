# WonderSnap — Project Document

> For an honest catalogue of defects rather than a build plan, see
> [`KNOWN_PROBLEMS.md`](KNOWN_PROBLEMS.md). For how the system works, see
> [`ARCHITECTURE.md`](ARCHITECTURE.md).

Status, remaining work, and everything needed to finish this.

Last updated: 1 October 2026
Repo: https://github.com/Abhislit/Wondersnap
Branch: `main` · one commit · 24 files · 172 KB (excludes the 42 MB MediaPipe runtime)

---

## 1. What this is

A 3D learning experience driven entirely by webcam hand gestures. No mouse, no controller, no
keyboard. Roughly 240,000 particles are simulated and rendered on the GPU each frame, assembled
into interactive models of real-world objects, which you inspect by pointing, pinching and twisting
your hands.

The point is not the graphics. It is that the interaction matches the way the subject is understood:
instead of reading that a heart has four chambers, you pull the chambers apart.

### Design constraints this project holds itself to

| Constraint | Status |
|---|---|
| No 3D engine (no Three.js, Unity, or game engine) | Held — hand-written WebGL2 |
| Runs entirely in the browser | Held |
| Camera data never leaves the machine | Held — MediaPipe runs locally, no network calls after setup |
| Keyboard and mouse are never *required* | Held — buttons and tabs exist as an accessibility fallback |
| Vanilla JavaScript | Held — no build step, no bundler, no `node_modules` at runtime |

---

## 2. Current state

### 2.1 What works, verified

**105 unit assertions** across six Node suites (`npm test`, ~1s) plus **18 browser checks** in
headless Chrome (`npm run test:browser`). Both run in CI.

| Area | Verified |
|---|---|
| GPU pipeline | Renders; no GL errors across all models; image brightness stays in range |
| Budget rebuild | `setBudget()` regenerates geometry and preserves exposure at runtime |
| Particle budget | 240,000 default; all four models fill the budget |
| Models | 5 built, each with 7–11 named, described, individually pickable parts |
| Pose classification | Open palm, fist, point, pinch all correctly distinguished; a relaxed half-curled hand matches none of them |
| Snap detection | Fires on a fast close; ignores a slow close and a hand held open; survives low frame rates |
| Picking | Every part of every model is reachable in the exploded view; 100% self-hit accuracy across 4 models × 5 camera angles |
| Explode | Animates; visibly changes the render; camera reframes to keep everything on screen |
| Cutaway | Removes ~35% of the image by dropping the near half against a camera-relative plane |
| Burst / reassemble | Assembles, releases, spikes turbulence, and can reform |
| Pinch-drag | Displacement accumulates while held, decays on release |
| Camera | Zoom clamps at both ends; pitch clamps; orbit works |
| UI | All buttons wired; narration toggles; cutaway chip syncs; 4 tabs switch models; Esc closes overlays |
| Progress | Inspecting a part persists; survives reload; corrupt storage recovers; bounded payload |
| Build | `setup.sh` verified end-to-end from a fresh clone: downloads runtime, serves, boots to "Tracking live", zero console errors |

### 2.2 What is missing or unproven

These are the real gaps. None are hidden in the README.

| Gap | Impact |
|---|---|
| **Never tested with a real webcam** | Every gesture threshold is a reasoned estimate. This is the single largest risk to the project. |
| **Never run at 240k on a real GPU** | All verification ran at 8k–20k under software rendering (SwiftShader). Framerate at full budget is unmeasured. Adaptive quality mitigates but does not measure this. |
| **5 of 29 models** | The headline claim. |
| **Silent** | No audio at all. Engine models in particular would benefit enormously. |
| **Quiz removed** | Cut from the build at the maintainer's request; narration and the inspector carry the teaching load. |
| **Silent by decision** | Audio was deliberately deferred; see §5.2. |
| **Desktop-only** | No touch fallback, so tablets and phones cannot use it. |
| **Single-language, no i18n** | Narration is English-only with hardcoded strings throughout the UI. |

---

## 3. The core risk: unverified gesture recognition

Everything else is engineering. This is discovery.

### 3.1 Why it matters

Six of the eight advertised gestures are classified in `js/core/gestures.js` from the 21 MediaPipe
landmarks. None of those thresholds has been observed against a human hand. They were derived from
anatomical ratios and validated against synthetic landmarks only.

The constants, all in one place and all needing tuning:

```js
const STRAIGHT_RATIO   = 1.06;   // tip-to-wrist vs pip-to-wrist, finger is extended
const REACH_RATIO      = 1.3;    // tip-to-wrist vs mcp-to-wrist
const PINCH_DISTANCE   = 0.45;   // thumb-index, as a fraction of palm width
const SNAP_SAMPLES     = 7;      // tracking samples in the snap window
const SNAP_MIN_SPAN_MS = 22;     // minimum window duration
const SNAP_TIGHT_RATIO = 0.34;   // thumb-index must close below this
const SNAP_MIN_RATE    = 0.0018; // closing rate per millisecond
const HISTORY_TTL_MS   = 1200;
```

Known-good curl ramp from synthetic testing — a real hand should land in the same bands:

| Curl | Extended fingers | Classified as |
|---|---|---|
| 0.0 – 0.45 | 4 | open palm |
| 0.6 | 2 | nothing (correctly neutral) |
| 0.8 – 1.0 | 0 | fist |

### 3.2 What is done, and what is left

Done: the harness (`tools/tune.html`), per-gesture cooldown and hysteresis, and 105 unit
assertions that pin the classifier's behaviour against synthetic landmarks.

Still needed: real humans. Everything below step 1 is blocked on that.

### 3.3 How to de-risk it

Roughly half a day, and it should happen before any more models are built — every model built on
untested gestures multiplies the rework.

1. Stand up a live tuning harness — **done**, `tools/tune.html`. Every threshold is a live slider
   and the raw ratios are traced against their thresholds.
2. **Test with 5+ people**, recording a labelled video set: open palm, fist, point, pinch, snap,
   twist, two-hand zoom, plus deliberately ambiguous hands (relaxed, half-curled, mid-transition).
3. **Measure and record** a confusion matrix. Target: >95% correct, <2% false-positive snap.
4. **Retune** the constants above and record the final values with the reasoning.
5. **Commit the labelled video set** (or a derived fixture) so the tuning is reproducible.

Do not skip step 3. "It seemed to work" is how gesture projects end up feeling unresponsive.

### 3.4 Expected outcome

Realistically 2–5% misclassification per gesture, needing a cooldown and a hysteresis band on
every pose transition. Two design decisions worth making up front:

- **Cooldowns per gesture.** Without them, holding a pose fires repeatedly. Fist and open palm
  already have this; snap and pinch need it.
- **Hysteresis on pose entry/exit.** Require a pose to hold for N frames before it activates, and
  to be absent for N frames before it clears. Prevents flicker at gesture boundaries.

---

## 4. Remaining work

Ordered by dependency. Do them in this sequence.

### Phase 0 — De-risk the gestures *(~4 h, blocks everything)*

| # | Task | Status |
|---|---|---|
| 0.1 | Live tuning harness with per-frame classification trace | **Done** — `tools/tune.html`, 11 live sliders, ratio traces |
| 0.2 | Labelled video corpus, 5+ people | **Not started** — needs real humans |
| 0.3 | Confusion matrix measurement | **Partly** — 105 unit assertions exist; no real-hand data |
| 0.4 | Retune constants, document final values with reasoning | **Not started** — needs 0.2 |
| 0.5 | Per-gesture cooldown and hysteresis | **Done** — 0.5 and Phase 2 both complete |

### Phase 1 — Performance on real hardware *(~4 h)*

| # | Task | Status |
|---|---|---|
| 1.1 | Measure at 240k on discrete, integrated, and laptop GPUs | **Partly done** — integrated Intel Iris Xe measured at 60fps exploded / 29-31fps assembled; discrete and laptop still unmeasured |
| 1.2 | Adaptive quality: scale particle budget to hold a frame-time target | **Done** — `js/core/quality.js`, 19 tests |
| 1.3 | Verify simulation and rendering are decoupled from CV frame rate | Confirmed — `tracker.poll()` early-returns on a duplicate video timestamp |
| 1.4 | Clear message when `EXT_color_buffer_float` is absent | **Done** — `js/gpu/gl.js` throws a readable error |

**Why adaptive quality matters:** 240k is not universally viable. A single `?particles=` URL
parameter exists, but nothing chooses it automatically. Targeting 60fps with a budget that adapts
is what separates a demo from a product.

### Phase 2 — Make it a repository others can contribute to *(~2 h)*

| # | Task | Status |
|---|---|---|
| 2.1 | `LICENSE` | **Done** — MIT |
| 2.2 | Commit the test suite | **Done** — 105 unit assertions across 6 suites, plus a browser suite |
| 2.3 | `package.json` with `npm test` | **Done** — runtime stays dependency-free |
| 2.4 | GitHub Actions CI | **Done** — `.github/workflows/ci.yml`, 3 jobs |
| 2.5 | `CONTRIBUTING.md` | **Done** — setup, model authoring, look tuning, and the two problems only a human can resolve |
| 2.6 | Pin the MediaPipe version in one place | **Done** — `setup.sh` and `tests/browser.test.mjs` both use 1.0.1 |

### Phase 3 — The remaining 24 models *(~18–28 h)*

This is the bulk of the work and the bulk of the headline claim. Each model is ~45–90 min once
the pattern is familiar.

Current: 4. Needed: 25. The six categories from the project brief:

**🌍 Wonders of the World** — 2 of 7 done
- ✅ Eiffel Tower · ✅ (implied) — remaining: Pyramids of Giza, Colosseum, Great Wall,
  Taj Mahal, Statue of Liberty, Sydney Opera House, Burj Khalifa

**🫀 Human Anatomy** — 1 of 5 done
- ✅ Human Heart · ✅ Human Brain — remaining: Lungs, Eye, Skeleton, Human Cell

**🧬 Biology** — 1 of 4 done
- ✅ DNA Double Helix — remaining: Cell (organelles), Mitochondrion, Chloroplast, Protein

**✈️ Engines & Vehicles** — 1 of 5 done
- ✅ Turbofan Jet Engine — remaining: Piston Engine (4-stroke), Electric Motor, Bicycle,
  Helicopter, Rocket Engine

**⚙️ Machines** — 0 of 4
- Gearbox, Differential, Steering Rack, Cam and Follower

**🔬 Interactive mechanical systems** — 0 of 4
- Geneva Drive, Rack and Pinion, Centrifugal Governor, Scotch Yoke

The last two categories are where the "interactive mechanical systems" promise really lives, and
where exploded views and part-dragging teach the most. They are also the easiest models to author
because the geometry is precise rather than anatomical.

Model authoring checklist per model:
1. Shell over solid. A filled volume occludes everything inside it — both visually and for picking.
   This cost real debugging time on the heart's ventricles.
2. Every part needs a `name` and a `description` over ~60 characters. Narration and the
   inspector read these verbatim, so a thin description reads thin on screen.
3. Verify the part is reachable. There is no `selectable` flag — reachability is asserted by the
   suites instead: `models.test.mjs` requires every part to contribute pick samples, and
   `browser.test.mjs` projects and hits every part from three camera angles.
4. Aim for 6–12 parts.
5. Weight parts by visual importance, not by particle budget convenience.

### Phase 4 — Learning features *(~6 h)*

| # | Task | Status |
|---|---|---|
| 4.1 | Track explored parts per model; persist to `localStorage` | **Done** — `js/core/progress.js`, 16 tests, corrupt-storage safe |
| 4.2 | Completion indicator — N of M parts understood | **Done** — inspector shows "3 of 9 explored" |
| 4.4 | Narration on part hover, not only on inspect | **Not started** |
| 4.5 | A visible model-completion view | **Not started** — data exists, no UI yet |

### Phase 5 — Depth *(~10 h)*

| # | Task | Notes |
|---|---|---|
| 5.1 | Cross-section / cutaway on arbitrary planes, not just one | Currently a single camera-relative plane |
| 5.2 | Animated mechanisms — moving pistons, rotating gears, flowing blood | Needs a per-part animation channel; this is what makes a gearbox come alive |
| 5.3 | Sound: engine tone tied to RPM, ambient room tone | No audio at all today |
| 5.4 | Guided tours — a scripted sequence of gestures per model | Multiplies teaching value |
| 5.5 | Touch and device orientation fallback for tablets | Desktop-only today |

### Phase 6 — Hardening *(~4 h)*

| # | Task |
|---|---|
| 6.1 | Graceful camera-permission denial with a clear message and a keyboard/mouse path |
| 6.2 | Handle WebGL2 absence, context loss, and driver quirks |
| 6.3 | Respect `prefers-reduced-motion` — reduce turbulence and idle spin |
| 6.4 | Internationalise narration and UI strings |
| 6.5 | Safari and Firefox verification — only Chrome has been tested |

---

## 5. Risks and decisions

### 5.1 Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Gesture feel is unacceptable on real hands | **High** | **Severe** — the entire premise | Phase 0 before anything else |
| 240k is too slow on target hardware | Medium | Medium | Phase 1.2 adaptive quality |
| 25 models take far longer than estimated | **High** | Medium | Ship 10 excellent models over 29 rushed ones |
| Scope creep into a general framework | Medium | Medium | The model format is deliberately declarative; resist adding an engine |
| Contributor confusion without docs | Low | Low | Phase 2 |

### 5.2 Decisions taken

| Decision | Choice | Reasoning |
|---|---|---|
| License | **MIT** | Short, permissive, maximal adoption. Revisit Apache-2.0 if patent protection matters. |
| Particle budget | **Adaptive, with a fixed override** | Adapts to real hardware, and `?particles=` still pins it for demos and CI. |
| Audio | **Not in v1** | Surprise noise in a webcam-gesture app is a real UX cost. Revisit with the animation work. |
| Roadmap | **This document** | A public board is only worth it once there are outside contributors. |
| The other 24 models | **Still open** | The list in §4.3 is a proposal. The brief names six categories but not the members. |

### 5.3 Known weaknesses in the current code

- **`pick()` is O(6,000) per call**, run every frame while pointing. Fine at 60fps; worth a spatial
  grid if it ever shows up in a profile.
- **Expose density is coupled to particle budget.** `exposure = 170 / budget`, which is why
  brightness is stable across budgets. Correct, but it means the constant is only right for the
  current point-sprite falloff.
- **Single fixed camera FOV**, 50°, hardcoded in `math.js` and mirrored in `stage.js` framing maths.
- **Adaptive quality rebuilds geometry**, not just textures. Cheap enough at 4s+ of sustained
  evidence, but a genuinely marginal machine could oscillate between two budgets forever.
- **`transformPoint` ignores `w`.** Correct for affine transforms, wrong for projection. A separate
  `unproject` exists for the latter, but the two sit close enough to invite a future mistake.

---

## 6. Timeline

Assumes one developer, familiar with the codebase, and Phase 0 surfacing no catastrophes.

| Phase | Work | Estimate |
|---|---|---|
| 0 | Gesture de-risking | 4 h — **harness, cooldown, hysteresis, tests done; real hands remain** |
| 1 | Performance and adaptive quality | 4 h — **adaptive quality done; GPU measurement remains** |
| 2 | Repo essentials — license, tests, CI | 2 h — **done** |
| 3 | **24 models** | **18–28 h** |
| 4 | Learning features | 6 h |
| 5 | Depth — animations, sound, tours | 10 h |
| 6 | Hardening | 4 h |
| | **To a genuinely complete 29-model project** | **48–58 h** |
| | **To a credible demo — 10 models, gestures verified** | **~30 h** |

Roughly a week of focused work for the full thing. The 24 models are 40% of the hours and 100% of
the headline claim.

**Suggested order:** Phase 0 → Phase 1 → Phase 2 → then judge whether to commit to all 24 models or
consolidate at 10. Deciding that after Phase 0 is much cheaper than deciding it now.

---

## 7. Architecture reference

```
webcam ─► MediaPipe HandLandmarker ─► gesture classifier ─► Stage ─► GPU
                                        js/core/gestures.js  js/core/stage.js
```

```
js/
  main.js             app wiring, frame loop, gesture routing
  core/
    tracker.js        MediaPipe HandLandmarker wrapper
    gestures.js       landmark maths, pose classification, snap detection
    stage.js          model lifecycle, camera framing, picking, explode, cutaway
    math.js           vec/mat4 helpers, Camera
  gpu/
    gl.js             context, shader compilation, texture helpers
    shaders.js        simulate / draw / background shaders
    particles.js      FBO ping-pong simulation, point-sprite draw
  models/
    builder.js        bakes a model definition into GPU textures
    shapes.js         point samplers — spheres, tubes, beams, lathes, shells
    heart.js dna.js eiffel.js jetEngine.js
    index.js          registry
  ui/
    narrator.js
vendor/mediapipe/     gitignored — fetched by setup.sh
```

**The one decision everything else follows from:** state lives in float textures, not vertex
buffers. Position, velocity, two target states, group data and colour are all `RGBA32F` textures.
The simulate pass is a single full-screen quad writing position and velocity into a ping-ponged
FBO with two colour attachments; the draw pass reads those textures directly in the vertex shader.
Nothing round-trips through the CPU, which is what makes 240k particles viable without an engine.

**Adding a model** is data, not code — see the README. Picking, exploded view and narration all
derive from the part list, so a new model gets all three for free.

---

## 8. How to verify

```bash
./setup.sh
python3 -m http.server 8000
# open http://localhost:8000
```

Automated suites (Phase 2.2):

```bash
npm test              # 105 assertions, no browser needed, ~1s
npm run test:browser  # 18 checks in headless Chrome, needs ./setup.sh first
```

Both also run in CI. Manual checks:

- **Gestures** — open `tools/tune.html`, check classification against the curl bands in §3.1 with
  a real hand, then copy the tuned JSON
- **Picking** — every part of every model must be reachable in the exploded view
- **Performance** — the top-left counter shows fps, particle count, and whether the budget is
  `auto` or `fixed`

---

## 9. Honest summary

The engine is real and works. The GPU pipeline, gesture classifier, picking system, narration
and progress tracking are all implemented and tested — picking reaches every part of every model, and pose
classification correctly distinguishes all four poses plus a neutral state.

Two things are not true yet, and both are load-bearing for the project's claims:

1. **The gestures have never touched a human hand.** Every threshold is an estimate. This is the
   difference between a working prototype and a working product, and it is roughly half a day of
   work to resolve.
2. **5 of 29 models exist.** The architecture makes the other 24 mostly mechanical, but 18–28 hours
   is real, and rushed models would undercut the quality of the good ones.

The README states both limitations plainly. That should stay true as the project grows.
