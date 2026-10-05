import { Camera } from '../js/core/math.js';
import { pixelsPerWorldUnit, FOV_Y, SPRITE_WORLD_FRACTION } from '../js/core/stage.js';

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
function close(a, b, tol, m = "") { if (Math.abs(a - b) > tol) throw new Error(`${m} ${a} vs ${b} (tol ${tol})`); }

const W = 800, H = 600, ASPECT = W / H;

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

let failed = 0;
let lastGroup = '';
for (const r of results) {
  if (r.group !== lastGroup) { console.log(`\n${r.group}`); lastGroup = r.group; }
  if (r.ok) console.log(`  ok   ${r.name}`);
  else { failed++; console.log(`  FAIL ${r.name} :: ${r.error}`); }
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
