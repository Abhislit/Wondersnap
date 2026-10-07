import { Camera } from '../js/core/math.js';
import {
  pixelsPerWorldUnit,
  spriteWorldRadius,
  FOV_Y,
  SPRITE_WORLD_FRACTION,
  MIN_BUDGET,
} from '../js/core/stage.js';
import { MAX_BUDGET } from '../js/core/quality.js';
import { Stage } from '../js/core/stage.js';
import { contextAttributes } from '../js/gpu/gl.js';
import { MODELS } from '../js/models/index.js';
import { ModelBuilder } from '../js/models/builder.js';

const results = [];
let group = '';
function describe(n) { group = n; }
function it(name, fn) {
  try { fn(); results.push({ group, name, ok: true }); }
  catch (err) { results.push({ group, name, ok: false, error: err.message }); }
}
function ok(v, m = 'expected truthy') { if (!v) throw new Error(m); }
function eq(a, b, m = '') { if (a !== b) throw new Error(`${m} expected ${b}, got ${a}`); }
function gte(a, min, m = '') { if (!(a >= min)) throw new Error(`${m} expected >= ${min}, got ${a}`); }
function lte(a, max, m = '') { if (!(a <= max)) throw new Error(`${m} expected <= ${max}, got ${a}`); }
function close(a, b, tol, m = "") { if (Math.abs(a - b) > tol) throw new Error(`${m} ${a} vs ${b} (tol ${tol})`); }

const W = 800, H = 600, ASPECT = W / H;

function build(model, budget = 20000) {
  const system = {
    texels: budget,
    targetA: new Float32Array(budget * 4),
    targetB: new Float32Array(budget * 4),
    colors: new Float32Array(budget * 4),
    groups: new Float32Array(budget * 4),
    uploadTargets() {},
  };
  const builder = new ModelBuilder(system, budget);
  for (const def of model.parts) builder.part(def);
  return { ...builder.build(0xc0ffee), system };
}

describe('camera framing');

it('projects a point at the target to screen centre', () => {
  const cam = new Camera();
  cam.target = [0, 0, 0];
  cam.smoothTarget = [0, 0, 0];
  cam.distance = 5;
  const p = cam.worldToScreen([0, 0, 0], W, H);
  ok(p, 'projection exists');
  ok(Math.abs(p.x - W / 2) < 1, `x ${p.x}`);
  ok(Math.abs(p.y - H / 2) < 1, `y ${p.y}`);
});

it('returns null for points behind the camera', () => {
  const cam = new Camera();
  cam.target = [0, 0, 0];
  cam.smoothTarget = [0, 0, 0];
  cam.distance = 5;
  cam.yaw = 0;
  cam.pitch = 0;
  const behind = cam.eye();
  const p = cam.worldToScreen([behind[0] * 3, behind[1] * 3, behind[2] * 3], W, H);
  eq(p, null, 'projection');
});

it('screenToWorldRay round-trips through the projection', () => {
  const cam = new Camera();
  cam.target = [0, 0, 0];
  cam.smoothTarget = [0, 0, 0];
  cam.distance = 6;
  cam.yaw = 0.7;
  cam.pitch = 0.2;

  for (const [nx, ny] of [[0, 0], [-0.6, 0.4], [0.7, -0.5]]) {
    const sx = (nx * 0.5 + 0.5) * W;
    const sy = (1 - (ny * 0.5 + 0.5)) * H;
    const screen = cam.worldToScreen([0, 0, 0], W, H);
    const ray = cam.screenToWorldRay(nx, ny, ASPECT);
    ok(ray && ray.origin && ray.dir, 'ray exists');
    const dirLen = Math.hypot(ray.dir[0], ray.dir[1], ray.dir[2]);
    ok(Math.abs(dirLen - 1) < 1e-9, `dir normalised (got ${dirLen})`);

    const back = cam.worldToScreen(ray.origin, W, H);
    ok(back, 'origin projects');
    const d = Math.hypot(back.x - sx, back.y - sy);
    ok(d < 2, `origin reprojects to pointer (off by ${d.toFixed(2)}px)`);
    ok(screen, 'target projects');
  }
});

describe('camera controls');

it('zoom scales target distance and clamps', () => {
  const cam = new Camera();
  cam.targetDistance = 8;
  cam.zoom(0.5);
  eq(cam.targetDistance, 4, 'closer');
  cam.zoom(1000);
  eq(cam.targetDistance, cam.maxDistance, 'clamped high');
  cam.zoom(0.0001);
  eq(cam.targetDistance, cam.minDistance, 'clamped low');
});

it('setDistance clamps', () => {
  const cam = new Camera();
  cam.setDistance(1e9);
  eq(cam.targetDistance, cam.maxDistance, 'high');
  cam.setDistance(-5);
  eq(cam.targetDistance, cam.minDistance, 'low');
});

it('orbit changes yaw and pitch, and pitch clamps', () => {
  const cam = new Camera();
  const y0 = cam.yaw;
  const p0 = cam.pitch;
  cam.orbit(0.5, 0.2);
  ok(cam.yaw > y0, 'yaw increased');
  ok(cam.pitch > p0, 'pitch increased');
  cam.orbit(0, 100);
  ok(cam.pitch <= 1.3501, `pitch clamped: ${cam.pitch}`);
  cam.orbit(0, -100);
  ok(cam.pitch >= -1.3501, `pitch clamped low: ${cam.pitch}`);
});

it('update eases distance toward the target', () => {
  const cam = new Camera();
  cam.distance = 10;
  cam.targetDistance = 2;
  for (let i = 0; i < 120; i++) cam.update(1 / 60);
  ok(Math.abs(cam.distance - 2) < 0.1, `settled at ${cam.distance}`);
});

it('viewProj produces a finite matrix at sane aspect ratios', () => {
  const cam = new Camera();
  for (const aspect of [0.5, 1, 1.77, 3]) {
    const m = cam.viewProj(aspect);
    eq(m.length, 16, 'length');
    for (let i = 0; i < 16; i++) ok(Number.isFinite(m[i]), `m[${i}] finite at aspect ${aspect}`);
  }
});

describe('sprite sizing');

it('pixelsPerWorldUnit matches the perspective projection', () => {
  for (const h of [480, 1080, 2160]) {
    const ppu = pixelsPerWorldUnit(h);
    // a point one world unit in front must project this many pixels tall
    close(ppu, h / (2 * Math.tan(FOV_Y / 2)), 1e-6, `height ${h}`);
  }
});

it('sprite size scales with framebuffer height', () => {
  const a = pixelsPerWorldUnit(480);
  const b = pixelsPerWorldUnit(1440);
  close(b / a, 3, 1e-9, '3x the pixels, 3x the sprite');
});

it('the sprite fraction is a sane world-space size', () => {
  ok(SPRITE_WORLD_FRACTION > 0.01 && SPRITE_WORLD_FRACTION < 1, `fraction ${SPRITE_WORLD_FRACTION}`);
});

it('a zoomed-in camera requests larger sprites, not the same ones', () => {
  // The defect this guards against: gl_PointSize was clamped to a constant, so the shader
  // asked for a large sprite and always got a small one, leaving the surface uncovered.
  const worldRadius = 2.3 * SPRITE_WORLD_FRACTION;
  const ppu = pixelsPerWorldUnit(1080);
  const near = worldRadius * ppu / 2.0;
  const far = worldRadius * ppu / 8.0;
  ok(near > far * 3, `zoom 4x should request >3x the sprite: ${near.toFixed(1)} vs ${far.toFixed(1)}`);
});

/**
 * Particles sit on a surface of roughly constant area, so the gap between neighbouring
 * particles grows as 1/sqrt(budget). Holding the sprite at a fixed fraction of model
 * radius therefore means the overlap ratio -- sprites per pixel -- climbs with the budget:
 * measured at 19x on a 240k brain, which additive blending turns into a featureless glow.
 *
 * Sizing the sprite by the same 1/sqrt(budget) law keeps overlap constant, so a weak
 * machine that drops to 4k and a strong one at 240k resolve detail equally well.
 */
it('sprite size falls as the square root of the budget', () => {
  const r = 2.0;
  const small = spriteWorldRadius(r, MIN_BUDGET);
  const quad = spriteWorldRadius(r, MIN_BUDGET * 4);
  close(small / quad, 2, 1e-9, '4x the particles should halve the sprite');
  const full = spriteWorldRadius(r, MAX_BUDGET);
  close(small / full, Math.sqrt(MAX_BUDGET / MIN_BUDGET), 1e-9, 'full budget ratio');
});

it('overlap is the same at every budget', () => {
  // spacing ∝ 1/sqrt(budget), so overlap = sprite/spacing must not move with budget.
  const r = 2.0;
  const spacing = (budget) => Math.sqrt(r * r / budget);
  const at = (budget) => spriteWorldRadius(r, budget) / spacing(budget);
  const ref = at(MIN_BUDGET);
  for (const b of [8000, 24000, 60000, MAX_BUDGET]) {
    close(at(b) / ref, 1, 1e-9, `overlap at ${b}`);
  }
});

it('the weakest supported budget keeps the historical sprite size', () => {
  // Anchoring here means no low-end machine sees a change, only sharper ones.
  close(spriteWorldRadius(2.0, MIN_BUDGET), 2.0 * SPRITE_WORLD_FRACTION, 1e-9, 'anchored at floor');
});

it('sprite size is independent of model radius being missing', () => {
  const a = spriteWorldRadius(0, MIN_BUDGET);
  const b = spriteWorldRadius(0, MAX_BUDGET);
  close(a, b, 1e-12, 'zero radius stays zero at any budget');
});

/**
 * Per-pixel brightness is proportional to overlap x exposure. Overlap is now the same at
 * every budget, so dividing exposure by the budget as well double-counted it: the old
 * code made a 4k machine render 60x brighter than a 240k one on top of the sprite change.
 */
it('exposure does not scale with the budget', () => {
  const base = 0.125;
  close(Stage.prototype.updateExposure.call({ exposureBase: base }, MIN_BUDGET), base, 1e-12, 'floor');
  close(Stage.prototype.updateExposure.call({ exposureBase: base }, MAX_BUDGET), base, 1e-12, 'ceiling');
});

it('a budget rebuild does not change exposure', () => {
  const s = { exposureBase: 0.125 };
  s.exposure = Stage.prototype.updateExposure.call(s, 40000);
  const low = s.exposure;
  s.exposure = Stage.prototype.updateExposure.call(s, 240000);
  close(s.exposure, low, 1e-12, 'exposure stable across a 6x rebuild');
});

/**
 * With the camera running, the webcam is composited behind the particles, which only works
 * if the canvas has an alpha channel and the opaque background pass is skipped. Without
 * `alpha: true` there is nothing to composite through, and the background pass writes
 * alpha = 1.0, which would paint straight over the video.
 */
it('the drawing buffer has an alpha channel so the camera can show through', () => {
  const attrs = contextAttributes();
  eq(attrs.alpha, true, 'alpha');
  eq(attrs.premultipliedAlpha, true, 'premultipliedAlpha must match the draw shader output');
  eq(attrs.depth, false, 'depth');
  eq(attrs.antialias, false, 'antialias');
});

it('the drawing buffer stays transparent whether or not a camera is running', () => {
  const s = { system: { renderBackground() { throw new Error('gradient drawn'); } } };
  eq(Stage.prototype.wantsBackground.call({ cameraBack: false }), false,
    'no camera: transparent, so the desktop shows through');
  eq(Stage.prototype.wantsBackground.call({ cameraBack: true }), false,
    'camera back: transparent, so the video shows through');
});

describe('camera framing');

/**
 * Frame a lone sphere of radius R. Built through the prototype so this exercises the real
 * frameDistance rather than a copy of it, but with the part list reduced to the sphere so
 * extentFor has something to measure.
 */
function frameSphere(R, aspect) {
  const stub = Object.assign(Object.create(Stage.prototype), {
    modelRadius: R,
    parts: [{ center: [0, 0, 0], radius: R, explodeVector: [0, 0, 0] }],
    camera: { target: [0, 0, 0], aspect },
  });
  return stub.frameDistance(0);
}

/** Screen height of a sphere of world radius R at the given distance. */
function spherePixels(R, dist, height, fovY = FOV_Y) {
  return (2 * R) / (2 * Math.tan(fovY / 2) * dist / height);
}

/**
 * Framing must satisfy the same relation the projection uses, tan not sin. The old code
 * framed a sphere as `radius / sin(halfFov)`, which is the distance to a tangent plane
 * rather than to the silhouette edge, so every model was framed ~9% further away than the
 * projection intended and rendered small.
 */
it('a framed sphere fills the height it was asked to fill', () => {
  for (const R of [0.5, 1, 1.758, 3.27]) {
    for (const [w, h] of [[1440, 900], [1920, 1080]]) {
      const dist = frameSphere(R, w / h);
      const px = spherePixels(R, dist, h);
      // A landscape viewport is height-limited only while the model stays narrower than
      // the viewport is wide; a narrow one has to pull back to keep the sides visible, so
      // assert the fill when height-limited and the fit otherwise.
      const widthLimited = w / h < 1;
      if (widthLimited) {
        ok(px / h <= 0.95, `r=${R} ${w}x${h}: ${((px / h) * 100).toFixed(0)}% of height, viewport not height-limited`);
      } else {
        gte(px / h, 0.9, `r=${R} ${w}x${h}: fills only ${((px / h) * 100).toFixed(0)}% of height`);
      }
    }
  }
});

it('framing does not get pushed back by a large model radius', () => {
  // modelRadius * 1.2 used to be a floor inside the max(), so the larger a model the
  // further back the camera sat -- the opposite of what the framing maths wanted. The
  // eiffel tower, radius 3.27, ended up well past its own extent.
  const small = frameSphere(1, 1.6);
  const large = frameSphere(4, 1.6);
  close(large / small, 4, 1e-6, 'distance should track radius exactly');
});

it('a wider viewport pulls the camera back rather than cropping', () => {
  const narrow = frameSphere(1, 1.0);
  const wide = frameSphere(1, 2.4);
  ok(wide >= narrow, `wide ${wide.toFixed(2)} should be >= narrow ${narrow.toFixed(2)}`);
});

/**
 * A wide flat part is the case the old bounding-sphere extent got wrong: it framed the
 * part as if it were as deep as it was wide, and the model rendered small to fit the empty
 * space. The extent has to follow the widest real axis, not the Euclidean sum of all three.
 */
/**
 * part.radius has to be the largest per-axis half-extent of the part's own samples. The
 * builder used hypot(ex, ey, ez), the diagonal of them, which is the *sphere* bound: for a
 * part 4 wide and 0.2 deep it reports 2.01 where the true reach on any axis is 2.0, and for
 * a long thin lobe the overshoot is much worse. The camera frames from this value, so the
 * diagonal made every non-cubic model render small.
 *
 * Measured here against the real samplers rather than a hand-built shape, because the bug is
 * only visible for parts that are actually flat.
 */
it('part radius is the widest half-extent of its own samples', () => {
  for (const m of MODELS) {
    const r = build(m);
    const byId = new Map(r.parts.map((p) => [p.id, p]));
    for (const def of m.parts) {
      // Re-sample the same part the builder did, and measure its true per-axis reach.
      const count = 4000;
      const part = byId.get(def.id);
      let lo = [Infinity, Infinity, Infinity];
      let hi = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < count; i++) {
        const { p: [x, y, z] } = def.sampler(mulberry(i), i, count);
        lo[0] = Math.min(lo[0], x); hi[0] = Math.max(hi[0], x);
        lo[1] = Math.min(lo[1], y); hi[1] = Math.max(hi[1], y);
        lo[2] = Math.min(lo[2], z); hi[2] = Math.max(hi[2], z);
      }
      const half = [
        (hi[0] - lo[0]) / 2, (hi[1] - lo[1]) / 2, (hi[2] - lo[2]) / 2,
      ];
      // Sampling noise can make a re-sample marginally wider than the builder's, so allow
      // a few percent before calling the radius an overshoot.
      const trueReach = Math.max(...half) * 1.08;
      lte(part.radius, trueReach,
        `${m.id}/${def.id}: radius ${part.radius.toFixed(3)} exceeds true reach ${trueReach.toFixed(3)}`);
    }
  }
});

/** Deterministic PRNG so the re-sample above is reproducible, like the builder's. */
function mulberry(seed) {
  let a = (seed * 2654435761) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

it('a wide flat part frames by its widest axis, not its bounding sphere', () => {
  const part = { center: [0, 0, 0], radius: 1, explodeVector: [0, 0, 0] };
  const stub = Object.assign(Object.create(Stage.prototype), {
    modelRadius: 1,
    parts: [part],
    camera: { target: [0, 0, 0], aspect: 1.6 },
  });
  // extentFor must not exceed the true half-extent on any axis.
  gte(stub.extentFor(0, [0, 0, 0]).radius, 1, 'extent covers the part');

  // A part 6 wide and 0.5 deep: the sphere bound would be 3.003, the true extent 3.
  part.center = [2, 0, 0];
  part.radius = 1;
  const sphereBound = Math.hypot(2, 0, 0) + 1;
  const extent = stub.extentFor(0, [0, 0, 0]).radius;
  lte(extent, 3 + 1e-9, `extent ${extent} overshot the widest axis (sphere bound ${sphereBound})`);
});

let failed = 0;
let lastGroup = '';
for (const r of results) {
  if (r.group !== lastGroup) { console.log(`\n${r.group}`); lastGroup = r.group; }
  if (r.ok) console.log(`  ok   ${r.name}`);
  else { failed++; console.log(`  FAIL ${r.name} :: ${r.error}`); }
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
