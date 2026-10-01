# WonderSnap

A 3D learning experience you control with your bare hands. No mouse, no controller, no
keyboard — a webcam and hand gestures drive a 240,000-particle GPU renderer.

Everything runs locally in the browser. The camera feed never leaves the machine.

```bash
./setup.sh                      # once: fetches the 42 MB MediaPipe runtime
python3 -m http.server 8000     # or any static server
open http://localhost:8000
```

`setup.sh` downloads the MediaPipe WASM runtime and the hand landmark model from the npm CDN and
Google's model store. They are not committed to git, so a fresh clone needs that one command (and
an internet connection) before it will run.

The camera requires a secure context. `localhost` counts; a LAN IP does not, so use
`localhost` or an HTTPS tunnel.

## Gestures

| Gesture | What it does |
|---|---|
| Snap your fingers | Materialises / releases the particle cloud |
| Fist | Assembles the particles into the model |
| Open hand | Toggle exploded view, or switch to the next model |
| Twist your wrist | Rotate and tilt the model |
| Both hands apart / together | Zoom |
| Point | Highlight a component and read what it does |
| Pinch and pull | Drag a component out for a closer look |

Everything is also reachable by mouse, for when a hand is not available: the buttons in the
top bar, and the model tabs. `Esc` closes the inspector or the quiz.

## How it works

```
webcam ─► MediaPipe HandLandmarker ─► gesture classifier ─► Stage ─► GPU
                                        (js/core/gestures.js)  (js/core/stage.js)
```

### GPU particle pipeline

There is no Three.js, Unity or game engine. The renderer is a hand-written WebGL2 pipeline in
`js/gpu/`.

State lives in float textures rather than vertex buffers, which is what makes 240k particles
practical:

- **Position** `xyz` + energy
- **Velocity** `xyz` + per-particle random seed
- **Target A / Target B** — two model states, so a morph is a `mix()` rather than a CPU rewrite
- **Group** — explode direction `xyz` + part id `w`
- **Colour** `rgb` + point size `a`

Each frame runs two passes:

1. **Simulate.** One full-screen quad writes new position and velocity into a ping-ponged FBO
   with two colour attachments. Forces are a spring toward the morphed target, curl-noise
   turbulence, per-part explode offsets, and a grab impulse for the pinched part. Curl noise is
   3D simplex noise (`js/gpu/shaders.js`).
2. **Draw.** `gl.POINTS` reads position and colour straight from the textures, so no data is
   copied back to the CPU. Points are soft-edged discs with a hot core, additively blended.

`EXT_color_buffer_float` is required. The simulation is what makes the "reaching out and
touching it" feel work: the particles have mass and lag behind the model rather than being
teleported onto it.

### Picking

Pointing at a component uses a **subsampled point cloud** — up to 6,000 points kept on the CPU at
build time, sampled on an even stride so every part is represented. Readback from a GPU texture
every frame would stall the pipeline.

Pick is nearest-in-screen-space within a 30 px radius, which measured 100% self-hit accuracy
across all four models in the exploded view. Depth-first picking was tried and rejected: shells
like the jet engine's nacelle sit in front of everything and always win, so you could never
select an internal component.

Explode offsets are pre-scaled on the CPU at build time so the GPU and the picker agree on where
a part actually is. They were not originally, which meant pointing at the nacelle selected
whatever the CPU thought was there.

### Gesture classification

`js/core/gestures.js` works from the 21 MediaPipe landmarks. Each finger is extended when its
tip is far enough from the wrist relative to its PIP joint:

```
straightness = dist(wrist, tip) / dist(wrist, pip)   > 1.06
extension    = dist(wrist, tip) / dist(wrist, mcp)   > 1.30
```

Poses are mutually exclusive and checked in priority order: pinch, fist, point, open palm. A
relaxed half-curled hand deliberately matches none of them rather than guessing.

A finger snap is detected from the *derivative* of the thumb-index distance over the last 7
tracking samples — it must close tightly (`< 0.34` of palm width) and quickly
(`> 0.0018` per ms). A hand that is merely held open never fires it.

**These thresholds are unverified against real hands.** See Status below.

## Layout

```
index.html            markup and HUD
css/style.css
js/
  main.js             app wiring, frame loop, gesture routing
  core/
    tracker.js        MediaPipe HandLandmarker wrapper
    gestures.js       landmark maths and pose classification
    stage.js          model lifecycle, camera framing, picking, picking bounds
    math.js           vec/mat4 helpers and the Camera
  gpu/
    gl.js             context, shader compile, texture helpers
    shaders.js        simulate / draw / background shaders
    particles.js      FBO ping-pong and draw passes
  models/
    builder.js        bakes a model definition into GPU textures
    shapes.js         point samplers (spheres, tubes, beams, lathes)
    heart.js  dna.js  eiffel.js  jetEngine.js
    index.js          registry
  ui/
    quiz.js  narrator.js
vendor/mediapipe/     MediaPipe runtime, gitignored — run ./setup.sh
```

## Adding a model

A model is data. Define parts, give each a sampler, and it works everywhere — picking,
exploded view, quiz and narration all derive from the part list.

```js
export default {
  id: 'my-model',
  name: 'My Model',
  category: 'Machines',
  summary: 'One or two sentences shown when the model loads.',
  parts: [
    {
      id: 'housing',
      name: 'Housing',
      description: 'Shown when you point at or pull out this part.',
      color: '#5ce1ff',
      weight: 3,                        // relative particle budget
      explode: [0, 1, 0],               // direction, auto-normalised
      explodeDistance: 1.4,             // multiple of model radius
      sampler: (rand, i, n) => ({
        p: [rand() * 2 - 1, rand(), rand() * 2 - 1],
        size: 1,                        // point size multiplier
        tint: 0.9 + rand() * 0.3,       // brightness jitter
        shimmer: 0.2,                   // extra jitter
      }),
    },
  ],
};
```

Then add it to `js/models/index.js`. `sampler(rand, i, n)` is called `weight`-proportional
times; use `i` and `n` to distribute points evenly along a curve instead of relying on
randomness. Reusable primitives are in `js/models/shapes.js`.

Prefer shells over filled volumes. A solid part occludes everything inside it — both visually
and for picking. The heart's ventricles started as a filled implicit volume and hid the atria,
valves and septum completely.

## URL parameters

| Parameter | Default | Purpose |
|---|---|---|
| `?particles=N` | `240000` | Particle budget, clamped to 4000–240000 |
| `?exposure=N` | `170` | Brightness, scaled down as `N / budget` |

Lower `particles` to debug on a weak GPU. Additive blending means brightness is coupled to
particle count, which is why exposure is divided by the budget.

## Project document

[`docs/PROJECT.md`](docs/PROJECT.md) covers current status, the full remaining-work plan, risk
register, and timeline.

## Status

What is verified:

- 85 automated checks in headless Chrome — rendering, all four models, pose classification,
  snap detection, picking accuracy, explode/cutaway/burst state, camera clamping, quiz
  scoring, and UI wiring.
- Picking reaches **every** part in every model when exploded.

What is **not** verified:

- **No real-camera testing.** All runs used Chrome's fake webcam device. The gesture thresholds
  above are reasoned estimates and will need tuning against actual hands.
- **Never run at 240k on a real GPU.** Verification ran at 12k–20k under SwiftShader software
  rendering because the test machine has no GPU. Framerate at 240k is unmeasured.
- **4 of 29 models.** Heart, DNA double helix, Eiffel Tower, turbofan jet engine.

A known weakness: models whose parts are concentric or nested (much of biology and anatomy) are
harder to point at than separated machinery. The exploded view is the intended way to inspect
them, and it is where picking was tuned.
