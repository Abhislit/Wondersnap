# Contributing to WonderSnap

This project has two critical unknowns that **no automated test can resolve**, and both of them
need a person. This document covers what a human can do that code cannot, then the usual
contributor workflow.

Read [`KNOWN_PROBLEMS.md`](KNOWN_PROBLEMS.md) for the full defect list, and
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for how the system works. Read this page for what
to do about it.

---

## Set up

```bash
git clone https://github.com/Abhislit/Wondersnap
cd Wondersnap
./setup.sh                      # fetches the 42 MB MediaPipe runtime, needs internet
python3 -m http.server 8000     # any static server works
```

Open <http://localhost:8000>. The camera needs a secure context, so `localhost` is fine and a LAN
IP is not.

There is no build step. The runtime has zero dependencies — `npm install` is only needed for the
browser test.

---

## The two things that need a human

Everything else in this repository can be verified by running tests. These two cannot.

### 1. Tune the gestures against a real hand — ~30 minutes

**This is the single highest-value contribution to this project.**

Every threshold in `js/core/gestures.js` was derived from anatomical ratios and validated against
synthetic landmarks — coordinates written to resemble a hand, not a recording of one. The test
suite confirms the code matches those coordinates. It says nothing about whether a person can
trigger a gesture.

If the fist threshold is 8% too tight, nobody ever assembles the model, and there is no fallback
that feels like the product.

**How to do it:**

1. Open <http://localhost:8000/tools/tune.html> and allow camera access.
2. For each gesture — open palm, fist, point, pinch, snap — hold it steady for two or three
   seconds and watch the traces.
3. **A threshold should sit in the gap between two clusters, never inside one.** When you make a
   fist, `index straightness` should land clearly above `STRAIGHT_RATIO`. When you open your hand,
   clearly below.
4. If a pose is misdetected, move the slider until the two clusters separate cleanly.
5. Click **"Copy current tuning as JSON"** and open a pull request with the result.

Useful signals on screen: the session tally shows what fraction of frames matched each pose — if
"neutral" is high while you hold a gesture, a threshold is wrong. The `pinch distance`,
`straightness` and `extension` metrics are the raw signals behind the decisions.

**Record what you find.** Even "no change needed, tested on two people" is useful data.

### 2. Measure the particle budget on real hardware — 2 minutes per machine

Every measurement in this repository was taken under SwiftShader (CPU software rendering) because
no GPU was available. "240,000 particles" is a design target, not a measured result.

Open <http://localhost:8000> and read the counter in the top left:

```
47 fps · 240k particles (auto) · 30 fps CV
```

Report the numbers for whatever hardware you have — discrete GPU, integrated, laptop. If it says
`auto` rather than `fixed`, the quality controller is adapting; add `?particles=240000` to pin it
and see the unassisted number.

This matters because the adaptive controller will silently reduce quality to 4,000 particles on a
weak machine rather than admit it cannot hold framerate. Nobody knows where that line sits yet.

---

## Also worth doing

### Test other browsers

Chrome is the only browser this has ever run in. Open Safari, Firefox and a phone, and open an
issue for whatever breaks.

Two known unknowns:

- `EXT_color_buffer_float` availability varies across Safari versions. Missing means no
  simulation at all.
- Safari caps WebGL2 texture sizes well below desktop.

### Decide the model list

The project claims 29 models across six categories; 4 exist. `PROJECT.md` §4.3 has a proposed
list. What to build depends on the audience — a classroom, a museum kiosk and a portfolio piece
want different things.

### Bring reference material

The anatomy and engine models were built from general knowledge and have **never been compared
against a reference image**. A test that asserts "the aorta exists" is satisfied by a tube.

Textbook diagrams, museum photography or CAD references would make these materially more
accurate.

---

## Adding a model

A model is data, not code. Define parts and you get picking, the exploded view and narration for
free.

```js
// js/models/myModel.js
export default {
  id: 'my-model',
  name: 'My Model',
  category: 'Machines',
  summary: 'One or two sentences, shown when the model loads.',
  parts: [
    {
      id: 'housing',
      name: 'Housing',
      description: 'Shown when you point at or pull out this part.',
      color: '#5ce1ff',
      weight: 3,                    // relative share of the particle budget
      explode: [0, 1, 0],           // direction; auto-normalised
      explodeDistance: 1.4,         // multiple of the model radius
      sampler: (rand, i, n) => ({
        p: [rand() * 2 - 1, rand(), rand() * 2 - 1],
        size: 1,                    // point size multiplier
        tint: 0.9 + rand() * 0.3,   // brightness jitter
        shimmer: 0.2,               // extra jitter
      }),
    },
  ],
};
```

Register it in `js/models/index.js`. Samplable primitives are in `js/models/shapes.js` — though
note only three of the thirteen exported helpers are currently used.

`sampler(rand, i, n)` is called a `weight`-proportional number of times. Use `i` and `n` to
distribute points evenly along a curve rather than relying on randomness.

### Checklist before opening a pull request

- [ ] **Shell, not solid.** A filled volume occludes everything inside it, both visually and for
      picking. This cost real debugging time on the heart's ventricles.
- [ ] Every part has a `name` and a `description` over ~60 characters. Narration reads these
      verbatim.
- [ ] Every part is reachable: the browser suite fails the PR otherwise.
- [ ] 6–12 parts.
- [ ] Weight parts by visual importance, not by particle-budget convenience.
- [ ] `npm test` passes.
- [ ] `npm run test:browser` passes.

---

## Tests

```bash
npm test              # 108 assertions, 7 suites, no browser, ~1 second
npm run test:browser  # 21 checks in headless Chrome — needs ./setup.sh first
```

Both run in CI on every push.

The unit suites cover pose classification, hysteresis, snap detection, model baking, camera
framing, matrix maths, progress persistence and quality hysteresis. The browser suite boots the
real app with a fake camera and asserts what unit tests cannot: that particles reach the
framebuffer, that every part is pickable when exploded, and that the budget can be rebuilt.

**What the tests do not prove:** that any gesture is recognisable by a human, that the app is
usable at any framerate on any GPU, or that the models resemble their subjects.

---

## Tuning the look

Particle appearance is controlled by URL parameters, so you can explore without editing code:

| Parameter | Default | Effect |
|---|---|---|
| `?particles=N` | `240000` | Budget. **Pins** it, disabling auto-quality. |
| `?exposure=N` | `700` | Brightness, scaled down as `N / budget`. |
| `?maxpoint=N` | `96` | Safety clamp on sprite size. Rarely reached. |
| `?point=N` | `1.0` | Sprite size multiplier on the projection-derived default. |
| `?core=N` | `1.6` | Core falloff exponent. **Lower is softer and wider.** |
| `?haloexp=N` | `1.0` | Outer halo falloff exponent. |
| `?halo=N` | `0.30` | Outer halo brightness weight. |
| `?hot=N` | `0` | White hot-centre boost. `0` keeps particles one colour. |

Blur and speckle are the same defect at opposite ends — the sprite's radial brightness profile:

- A **flat plateau** to the sprite edge means overlapping sprites sum to fog. Blurry.
- All the light confined to a few central pixels means you see isolated hard dots. Pixelated.
- A **broad, monotone** falloff fills the sprite so neighbours merge, then decays cleanly.

Sprite size is derived from the projection, so it scales with zoom and viewport automatically.
Do not reintroduce a fixed pixel size — that reintroduces the uncovered-particle defect.

`?core=` is the main lever.

---

## Code conventions

- Vanilla JavaScript ES modules. No build step, no bundler, no framework.
- No comments unless the code is genuinely non-obvious. The comments that do exist explain *why*.
- **Do not add `console.log` to `js/`** — CI rejects it.
- The runtime must stay dependency-free. Anything in `package.json` is dev-only.
- `vendor/` is gitignored and fetched by `setup.sh`. Do not commit it.

## Licence

MIT. See [`LICENSE`](../LICENSE).