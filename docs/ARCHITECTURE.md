# Architecture

How WonderSnap actually works, and why it is built this way. Written for someone who wants to
change it rather than just run it.

For defects see [`KNOWN_PROBLEMS.md`](KNOWN_PROBLEMS.md). For the build plan see
[`PROJECT.md`](PROJECT.md).

Roughly 4,200 lines of runtime JavaScript and 2,000 lines of tests, no dependencies at runtime and
no build step.

---

## The one decision everything follows from

**Particle state lives in float textures, not vertex buffers.**

This is why 240,000 particles are tractable without an engine, and it dictates the shape of
almost every other file. Nothing round-trips through the CPU, so there is no per-frame buffer
upload and no readback stall.

Six `RGBA32F` textures hold everything:

| Texture | `r` | `g` | `b` | `a` |
|---|---|---|---|---|
| `uPos` | position x | position y | position z | energy |
| `uVel` | velocity x | velocity y | velocity z | per-particle seed |
| `uTargetA` | model target x | y | z | — |
| `uTargetB` | model target x | y | z | — |
| `uGroup` | explode dir x | y | z | part id |
| `uColor` | red | green | blue | point size |

At 240k particles the textures are 490×490 (the smallest square that holds 240,100 texels), so
each is ≈ 3.7 MB and all six ≈ 22 MB of VRAM.

The `seed` channel in `uVel` is load-bearing and easy to miss: it is a per-particle random value
baked once at build time, and it is what makes turbulence and colour jitter *coherent* across
frames without any per-particle CPU state.

`uTargetA` and `uTargetB` existing separately is what makes model switching cheap — see
[Model morphing](#model-morphing).

Requires `EXT_color_buffer_float`. Without it the whole pipeline is impossible and
`gl.js` throws a readable error rather than degrading.

---

## Per-frame flow

```
webcam ─► HandLandmarker ─► GestureEngine ─► Stage ─► GPU
          (tracker.js)      (gestures.js)    (stage.js)
```

`js/main.js` `frame()`, in order:

1. `tracker.poll()` — detection, early-returns if the camera produced no new frame
2. `gestures.update(hands, dt)` — pose resolution, hysteresis, cooldowns, camera axes
3. `handleGestures(state)` — maps gestures to app intent (point → highlight, pinch → grab)
4. `stage.update(dt)` — eases all animated scalars toward their targets
5. `stage.render(dt)` — two GPU passes
6. `drawOverlay(hands, state)` — 2D hand skeleton on a separate canvas
7. `quality.sample(elapsed)` — frame-time feedback, may trigger a budget rebuild

Hand tracking and particle rendering share the main thread. `detectForVideo` is synchronous, so
they compete. `tracker.poll()` mitigates this by skipping duplicate video timestamps, which is why
detection runs at camera rate rather than render rate.

### Two clocks

```js
const elapsed = (now - lastTime) / 1000;
const dt = Math.min(0.05, elapsed);   // simulation only
```

The clamp is required — a 1.7 s timestep would destabilise the spring integrator. **Anything that
measures must use `elapsed`, never `dt`.** This was a real bug: the fps counter accumulated the
clamped value and so could never report worse than 20 fps regardless of reality, which made it
useless for the exact question it existed to answer. See `KNOWN_PROBLEMS.md` M5.

---

## The GPU pipeline

Two passes. No transform feedback — the pipeline queries
`MAX_TRANSFORM_FEEDBACK_SEPARATE_ATTRIBS` for diagnostics in `gl.js` but never uses it. State is
simply the next frame's input texture.

### Pass 1: simulate (`SIM_FRAG`)

One full-screen quad. Each texel is one particle. Reads `uPos`, `uVel`, `uTargetA`, `uTargetB`,
`uGroup`; writes position and velocity through **two colour attachments** of a ping-ponged FBO
(`particles.js` holds `front`/`back` indices and swaps each frame).

Forces, accumulated then applied:

| Force | Purpose |
|---|---|
| Spring toward the morphed target | the model forming |
| Extra spring on the highlighted group | the pointed-at part pulling forward |
| Curl noise | turbulence, scaled by how loose the cloud is |
| Grab impulse | the pinched part following the hand |
| Per-part explode offset | the exploded view |
| Velocity damping | critically-damped feel |

Curl noise is 3D simplex noise sampled on three decorrelated offsets
(`snoise(p*s + …)` in `flow()`). It is not a divergence-free curl field — it is a cheaper
divergence-free-*looking* flow field, which is visually indistinguishable here and saves six noise
evaluations per particle per frame.

The `energy` channel in `uPos.a` rises when loose and settles when assembled. The draw pass uses it
to modulate brightness, which is why the burst reads as *hot* and the formed model does not.

### Pass 2: draw (`DRAW_VERT` / `DRAW_FRAG`)

`gl.POINTS`, reading `uPos` and `uColor` directly in the vertex shader via `gl_VertexID`. No
attributes are bound at all — the vertex shader derives a UV from its own index.

Fragments are soft discs built from `gl_PointCoord`:

```glsl
float core = pow(1.0 - r2, uCoreExp);
float halo = pow(1.0 - r2, uHaloExp) * uHaloWeight;
```

Additively blended, `blendFunc(ONE, ONE_MINUS_SRC_ALPHA)` on premultiplied output. There is no
bloom pass and no tone mapping — the glow is entirely within the sprite profile. That is a
deliberate simplicity, and also why brightness is coupled to particle count (see
`KNOWN_PROBLEMS.md` m6).

### Sprite sizing

```glsl
gl_PointSize = uPointScale * colorData.a / dist;
```

with, on the CPU:

```js
pointScale = modelRadius * SPRITE_WORLD_FRACTION * (framebufferHeight / (2*tan(fov/2)))
```

The `framebufferHeight / (2*tan(fov/2))` term is the world-to-pixel factor. Including it is what
makes sprites grow as the camera zooms and as the viewport grows, so particle coverage is
resolution- and zoom-independent.

**Do not reintroduce a fixed pixel size for sprites.** Doing so pins every particle to the same
size while the spacing between them grows with the model, and the surface visibly breaks apart.
It cost three wrong fixes before it was measured properly — see
[Measure before tuning](#measure-before-tuning).

`uMaxPointSize` remains only as a safety net against a pathological fill-rate spike at extreme
zoom.

---

## Model morphing

Switching models does not rewrite particle state on the CPU. `uTargetA` holds the current model
and `uTargetB` the incoming one; the simulation interpolates:

```glsl
vec3 target = mix(texture(uTargetA, vUv).xyz, texture(uTargetB, vUv).xyz, uMorph);
```

with `uMorph` eased from 0 to 1. Particles fly from the old shape to the new one along a
spring-and-noise path. This is why switching models looks continuous rather than like a reload.

The model *definition* is regenerated on the CPU during `buildPending()`, but the particle
positions themselves are never touched — they are already in flight toward the targets.

---

## Model representation

A model is pure data (`js/models/`). Each part declares a sampler, and the builder bakes it into
the GPU textures:

```
part.sampler(rand, i, n) -> { p: [x,y,z], size, tint, shimmer }
```

`weight` decides each part's share of the particle budget. `explode` is a direction, normalised and
**pre-scaled on the CPU at build time** so the GPU and the picker agree on where a part is. When
they disagreed, pointing at a part selected whatever the CPU thought was nearby.

Picking needs to know where particles are on the CPU, but reading a GPU texture back every frame
would stall the pipeline. Instead `buildPickPoints` keeps a subsample — up to 6,000 points on an
even stride — which is what `pick()` tests against.

### Two rules learned the hard way

**Use shells, not solid volumes.** A filled volume occludes everything inside it, both visually and
for picking. The heart's ventricles were originally a filled implicit surface and hid the atria,
valves and septum completely.

**Description length matters.** Narration reads `part.description` verbatim. Anything under ~60
characters produces thin, unsatisfying speech.

---

## Picking

Nearest-in-screen-space within 30 px, over the CPU point subsample:

```js
if (distOf[g] < bestScreen) { bestScreen = distOf[g]; bestGroup = g; }
```

Depth-first picking was tried and **rejected**. Shells like the jet engine's nacelle sit in front
of everything and win every time, so an internal component could never be selected. Screen-space
nearest measured 100% self-hit accuracy across all four models when exploded.

Explode offsets are applied to the pick points too, so picking tracks the exploded view. Grab
displacement is applied on top.

---

## Gesture recognition

`js/core/gestures.js`, from the 21 MediaPipe landmarks.

Finger extension is a ratio of two distances:

```
straightness = dist(wrist, tip) / dist(wrist, pip)   > STRAIGHT_RATIO (1.08)
extension    = dist(wrist, tip) / dist(wrist, mcp)   > REACH_RATIO    (1.20)
```

Poses are mutually exclusive, checked in priority order: **pinch → fist → point → openPalm**, else
neutral. A relaxed half-curled hand deliberately matches nothing rather than guessing.

Two mechanisms keep it from misbehaving:

- **Hysteresis** — a pose must hold `ENTER_FRAMES` (3) to activate and be absent `EXIT_FRAMES` (4)
  to clear. Without it, poses flicker at gesture boundaries.
- **Cooldown** — fist and open palm cannot re-fire within 700 ms / 900 ms.

Twist and zoom are **continuous axes, not poses**. `GestureEngine.cameraDelta()` integrates palm
roll past a deadzone, and converts two-hand span change into a zoom factor. They deliberately live
in the engine rather than the frame loop, so all six controls share one tuning surface and get the
same debugging.

A snap is the *derivative* of thumb-index distance: it must close tightly **and** quickly. A hand
merely held open satisfies neither.

> **These thresholds have never been tested against a human hand.** They were derived from
> anatomical ratios and validated against synthetic landmarks. `tools/tune.html` is the tool for
> fixing this. See `KNOWN_PROBLEMS.md` C1.

---

## Adaptive quality

`js/core/quality.js` watches real frame time and steps the particle budget to hold a target fps.
It reacts only after sustained evidence — 60 samples to downgrade, 180 to upgrade — because a
rebuild is expensive and a few dropped frames are normal.

A downgrade re-bakes geometry on the main thread (`Stage.setBudget`). That is the single heaviest
operation in the app, which is why the controller is so reluctant to trigger.

`?particles=N` pins the budget and disables the controller entirely.

---

## Camera framing

`frameDistance()` solves for the distance at which a sphere of a given radius fits the frustum:

```js
vertical   = radius / sin(fovY / 2)
horizontal = vertical * max(1, aspect)
```

Called with the model's extent at explode 0 or 1, so exploding pulls the camera back rather than
letting parts leave the frame.

`FOV_Y` is now exported from `stage.js` and used by `math.js`'s `perspective()`. It was duplicated
in both files, which was a drift risk.

---

## Measure before tuning

The most expensive mistake in this project's history, recorded so it does not repeat.

The particle look was "fixed" **three times** using pixel statistics gathered under software
rendering, and each fix made things worse before the next one helped. The actual defect — sprite
size clamped to a constant — was invisible in every one of those measurements, because all of them
were taken at 640×480 and 1× zoom, the one configuration where coverage was perfect.

What went wrong, and what to do instead:

| Don't | Do |
|---|---|
| Compare `sd` (standard deviation) between configs | Compare **relative** contrast `sd/mean`. Absolute `sd` just tracks exposure. |
| Measure silhouette edge width by walking outward from a peak | The threshold catches interior darkness, not the outline. Produced 337 px "edges" on a 200 px model. |
| Aggregate statistics over the whole model | **Isolate one particle** and measure its radial profile. Unconfounded, and it directly names the defect. |
| Judge a look at one resolution and zoom level | Sweep both. The defect existed only at the edges of that space. |

The measurement that worked, on 4,000 particles so sprites never overlap:

```
OLD 26px   1 .99 .99 .96 .88 .80 .77 .71 .63 .60 .53 .43 .39   plateau -> fog
PREV 13px  1 .80 .64 .39 .12 .02 0 0                            hard dot -> speckle
NOW        1 1 .99 .98 .87 .67 .59 .43 .28 .24 .17 .15 .13     broad, monotone
```

A flat plateau out to the sprite edge means overlapping sprites sum to uniform fog. All light
inside a few pixels means isolated hard dots. Only a broad monotone falloff both fills the sprite
so neighbours merge and decays cleanly.

The second measurement that worked was **uncovered-pixel fraction swept across zoom and viewport**,
which is what finally exposed the sprite clamp. `gap%` against zoom is now the regression check.

---

## Testing

```
npm test              # 112 assertions, 7 suites, no browser, ~1s
npm run test:browser  # 24 checks in headless Chrome, needs ./setup.sh
```

Unit suites cover pose classification, hysteresis, snap detection, model baking, camera framing,
matrix maths, progress persistence, quality hysteresis and sprite sizing.

The browser suite boots the real app with a fake camera and asserts what unit tests cannot:

- particles reach the framebuffer and brightness stays in range
- every part of every model is pickable when exploded (100% self-hit accuracy)
- the budget can be rebuilt at runtime
- pointing selects the part under the drawn hand
- pinch-drag moves the part with the hand
- the app still works with **no camera at all** — model tabs, mouse orbit, wheel zoom, explode and
  cutaway

That last group matters more than it looks. The premise is a webcam, so the failure mode where
permission is denied must degrade to something usable rather than a dead screen.

All of this runs under software rendering, so **it says nothing about framerate on real
hardware.** See `KNOWN_PROBLEMS.md` C2.

---

## File map

```
index.html              markup, HUD, gesture legend
css/style.css
setup.sh                fetches the MediaPipe runtime (42 MB, gitignored)
js/
  main.js               wiring, frame loop, gesture routing, progress
  core/
    tracker.js          MediaPipe HandLandmarker wrapper, camera lifecycle
    gestures.js         landmark maths, poses, hysteresis, snap, camera axes
    stage.js            model lifecycle, sprite sizing, camera framing, picking, explode, cutaway
    quality.js          adaptive particle budget
    progress.js         explored parts, persisted; treats storage as untrusted
    math.js             vec/mat4 helpers, Camera, projection and unprojection
  gpu/
    gl.js               context, shader compilation, texture helpers
    shaders.js          simulate / draw / background shaders
    particles.js        FBO ping-pong, the two passes
  models/
    builder.js          bakes a model definition into GPU textures
    shapes.js           point samplers
    heart.js dna.js eiffel.js jetEngine.js
    index.js            registry
  ui/
    narrator.js         speech synthesis, fails soft when no voices exist
tools/tune.html         live gesture tuning harness
tests/                  unit suites, browser suite, synthetic hand fixtures
vendor/mediapipe/       gitignored, fetched by setup.sh
```

`js/main.js` is 635 lines and is the largest file. It is the least pleasant one to change —
gesture-to-intent mapping, DOM wiring and the frame loop all live there.
