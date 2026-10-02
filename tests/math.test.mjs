import {
  multiply, invert, perspective, lookAt, normalize, cross, subtract, add,
  scale, length, clamp, lerp, damp, smoothstep, transformPoint4, unproject,
} from '../js/core/math.js';

const results = [];
let group = '';
function describe(n) { group = n; }
function it(name, fn) {
  try { fn(); results.push({ group, name, ok: true }); }
  catch (err) { results.push({ group, name, ok: false, error: err.message }); }
}
function ok(v, m = 'expected truthy') { if (!v) throw new Error(m); }
function eq(a, b, m = '') { if (a !== b) throw new Error(`${m} expected ${b}, got ${a}`); }
function close(a, b, tol, m = '') { if (Math.abs(a - b) > tol) throw new Error(`${m} ${a} vs ${b}`); }

describe('vectors');

it('normalize returns a unit vector', () => {
  for (const v of [[3, 0, 4], [-1, -1, -1], [1e-9, 0, 0], [0, 0, 7]]) {
    const n = normalize(v);
    close(Math.hypot(...n), 1, 1e-9, `normalize ${v}`);
  }
});

it('normalize returns a finite vector for a zero input', () => {
  const n = normalize([0, 0, 0]);
  for (const c of n) ok(Number.isFinite(c), `component ${c} finite`);
});

it('cross follows the right-hand rule', () => {
  eq(cross([1, 0, 0], [0, 1, 0])[2], 1, 'x cross y = z');
  eq(cross([0, 1, 0], [1, 0, 0])[2], -1, 'y cross x = -z');
});

it('a normalized cross product is perpendicular to both inputs', () => {
  const a = normalize([1, 2, 3]);
  const b = normalize([3, -1, 2]);
  const c = normalize(cross(a, b));
  close(c[0] * a[0] + c[1] * a[1] + c[2] * a[2], 0, 1e-9, 'perp to a');
  close(c[0] * b[0] + c[1] * b[1] + c[2] * b[2], 0, 1e-9, 'perp to b');
});

it('basic vector ops compose correctly', () => {
  eq(add([1, 2, 3], [4, 5, 6])[2], 9, 'add');
  eq(subtract([4, 5, 6], [1, 2, 3])[2], 3, 'subtract');
  eq(scale([1, 2, 3], 2)[1], 4, 'scale');
  close(length([3, 4, 0]), 5, 1e-9, 'length');
});

describe('interpolation');

it('clamp bounds both sides', () => {
  eq(clamp(5, 0, 1), 1, 'high');
  eq(clamp(-5, 0, 1), 0, 'low');
  eq(clamp(0.5, 0, 1), 0.5, 'mid');
});

it('lerp hits both endpoints', () => {
  eq(lerp(0, 10, 0), 0, 't=0');
  eq(lerp(0, 10, 1), 10, 't=1');
  close(lerp(0, 10, 0.5), 5, 1e-9, 't=0.5');
});

it('smoothstep is clamped and flat at the ends', () => {
  eq(smoothstep(-1), 0, 'below');
  eq(smoothstep(2), 1, 'above');
  close(smoothstep(0), 0, 1e-9, 'at 0');
  close(smoothstep(1), 1, 1e-9, 'at 1');
  close(smoothstep(0.5), 0.5, 1e-9, 'midpoint is symmetric');
});

it('damp approaches the target without overshooting', () => {
  let v = 0;
  let overshoot = false;
  for (let i = 0; i < 500; i++) {
    v = damp(v, 1, 5, 1 / 60);
    if (v > 1) overshoot = true;
  }
  eq(overshoot, false, 'never overshoots');
  close(v, 1, 0.01, 'converges');
});

it('damp with a huge dt still stays finite', () => {
  const v = damp(0, 1, 5, 1e6);
  ok(Number.isFinite(v), 'finite');
  ok(v <= 1, 'not past target');
});

describe('matrices');

it('perspective is finite and has the expected shape', () => {
  const m = perspective(Math.PI / 4, 1.5, 0.1, 100);
  eq(m.length, 16, 'length');
  for (let i = 0; i < 16; i++) ok(Number.isFinite(m[i]), `m[${i}]`);
  ok(m[11] < 0, 'w row sign for a right-handed view');
});

it('lookAt places the camera and points it at the target', () => {
  const eye = [0, 0, 5];
  const view = lookAt(eye, [0, 0, 0], [0, 1, 0]);
  const p = transformPoint4(view, 0, 0, 0);
  close(p[2] / p[3], -5, 1e-6, 'target sits 5 units down -z');
  close(p[3], 1, 1e-9, 'w is 1 for a rigid transform');
});

it('multiply composes right-to-left', () => {
  const p = perspective(Math.PI / 4, 1.5, 0.1, 100);
  const v = lookAt([0, 0, 5], [0, 0, 0], [0, 1, 0]);
  const pv = multiply(p, v);
  ok(pv[11] < 0, 'proj*view has the perspective term in place');
  const world = [1, 2, 3];
  const byHand = transformPoint4(p, ...transformPoint4(v, ...world));
  const composed = transformPoint4(pv, ...world);
  for (let i = 0; i < 4; i++) {
    close(composed[i], byHand[i], 1e-4, `component ${i}`);
  }
});

it('invert round-trips to the identity', () => {
  const p = perspective(Math.PI / 4, 1.5, 0.1, 100);
  const v = lookAt([3, 1, 4], [0, 0, 0], [0, 1, 0]);
  const m = multiply(p, v);
  const product = multiply(m, invert(m));
  for (let i = 0; i < 16; i++) {
    close(product[i], i % 5 === 0 ? 1 : 0, 1e-4, `element ${i}`);
  }
});

it('invert of a singular matrix returns identity rather than NaN', () => {
  const zero = new Float32Array(16);
  const inv = invert(zero);
  for (let i = 0; i < 16; i++) ok(Number.isFinite(inv[i]), `inv[${i}] finite`);
});

it('unproject divides through by w', () => {
  const p = perspective(Math.PI / 4, 1.5, 0.1, 100);
  const v = lookAt([0, 0, 5], [0, 0, 0], [0, 1, 0]);
  const m = multiply(p, v);
  const inv = invert(m);

  const ndc = [0.3, -0.2, 0.5];
  const world = unproject(inv, ndc);
  ok(world, 'unprojected');
  const back = transformPoint4(m, ...world);
  close(back[0] / back[3], ndc[0], 1e-4, 'x round-trips');
  close(back[1] / back[3], ndc[1], 1e-4, 'y round-trips');
  close(back[2] / back[3], ndc[2], 1e-4, 'z round-trips');
});

it('unproject guards against a zero w', () => {
  const singular = new Float32Array(16);
  eq(unproject(singular, [0, 0, 0]), null, 'returns null');
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
