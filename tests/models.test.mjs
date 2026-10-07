import { ModelBuilder, PICK_SAMPLE, boundsCenter, boundsRadius } from '../js/models/builder.js';
import { MODELS } from '../js/models/index.js';

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
function close(a, b, tol, m = '') { if (Math.abs(a - b) > tol) throw new Error(`${m} ${a} vs ${b}`); }

const BUDGET = 20000;

function stubSystem(budget = BUDGET) {
  return {
    texels: budget,
    targetA: new Float32Array(budget * 4),
    targetB: new Float32Array(budget * 4),
    colors: new Float32Array(budget * 4),
    groups: new Float32Array(budget * 4),
    uploadTargets() {},
  };
}

function build(model, budget = BUDGET) {
  const system = stubSystem(budget);
  const builder = new ModelBuilder(system, budget);
  for (const def of model.parts) builder.part(def);
  return { ...builder.build(0xc0ffee), system };
}

describe('model registry');

it('registry is not empty', () => {
  gte(MODELS.length, 1, 'models');
});

it('every model has a unique id', () => {
  const ids = MODELS.map((m) => m.id);
  eq(new Set(ids).size, ids.length, 'unique ids');
});

it('every model declares the metadata the UI reads', () => {
  for (const m of MODELS) {
    ok(m.id, `${m.id}: id`);
    ok(m.name, `${m.id}: name`);
    ok(m.category, `${m.id}: category`);
    ok((m.summary || '').length > 40, `${m.id}: summary too short`);
    gte(m.parts.length, 3, `${m.id}: part count`);
  }
});

it('every part has a name and a usable description', () => {
  for (const m of MODELS) {
    for (const p of m.parts) {
      ok(p.id, `${m.id}/${p.id}: id`);
      ok(p.name, `${m.id}/${p.id}: name`);
      gte((p.description || '').length, 60, `${m.id}/${p.id}: description too thin`);
      ok(p.color, `${m.id}/${p.id}: color`);
      gte(p.weight, 0.1, `${m.id}/${p.id}: weight`);
      eq(p.explode.length, 3, `${m.id}/${p.id}: explode is a 3-vector`);
      gte(p.explodeDistance, 0.1, `${m.id}/${p.id}: explodeDistance`);
      eq(typeof p.sampler, 'function', `${m.id}/${p.id}: sampler`);
    }
  }
});

it('part ids are unique within a model', () => {
  for (const m of MODELS) {
    const ids = m.parts.map((p) => p.id);
    eq(new Set(ids).size, ids.length, `${m.id}: unique part ids`);
  }
});

it('explode directions are non-zero and normalizable', () => {
  for (const m of MODELS) {
    for (const p of m.parts) {
      const len = Math.hypot(...p.explode);
      gte(len, 0.5, `${m.id}/${p.id}: explode length`);
    }
  }
});

describe('baking');

it('fills the particle budget', () => {
  for (const m of MODELS) {
    const r = build(m);
    const total = r.parts.reduce((s, p) => s + p.count, 0);
    gte(total, BUDGET * 0.95, `${m.id}: particles allocated`);
  }
});

it('samples the full particle range for picking', () => {
  for (const m of MODELS) {
    const r = build(m);
    gte(r.pickPoints.count, PICK_SAMPLE * 0.6, `${m.id}: pick sample count`);
  }
});

it('every part gets pick samples', () => {
  for (const m of MODELS) {
    const r = build(m);
    const seen = new Set();
    const data = r.pickPoints.data;
    for (let i = 0; i < r.pickPoints.count; i++) seen.add(data[i * 4 + 3] | 0);
    const missing = r.parts.filter((p) => !seen.has(p.group)).map((p) => p.name);
    eq(missing.length, 0, `${m.id}: parts with no pick samples -> ${missing.join(', ')}`);
  }
});

it('writes target, colour and group textures without NaN', () => {
  for (const m of MODELS) {
    const { system } = build(m);
    for (const [label, buffer] of [
      ['targetA', system.targetA], ['targetB', system.targetB],
      ['colors', system.colors], ['groups', system.groups],
    ]) {
      for (let i = 0; i < buffer.length; i++) {
        if (!Number.isFinite(buffer[i])) {
          throw new Error(`${m.id}: ${label} has a non-finite value at ${i}`);
        }
      }
    }
  }
});

it('unused texels are inert rather than random', () => {
  const { system, parts } = build(MODELS[0]);
  const total = parts.reduce((s, p) => s + p.count, 0);
  for (let i = total; i < BUDGET; i++) {
    const o = i * 4;
    eq(system.colors[o + 3], 0, `texel ${i} size must be 0`);
    eq(system.targetA[o + 3], 0, `texel ${i} energy must be 0`);
  }
});

it('group ids are contiguous from zero', () => {
  const { parts } = build(MODELS[0]);
  parts.forEach((p, i) => eq(p.group, i, `${p.name} group id`));
});

it('explode vectors are finite and non-zero', () => {
  for (const m of MODELS) {
    const { parts } = build(m);
    for (const p of parts) {
      const v = p.explodeVector;
      ok(v.every(Number.isFinite), `${m.id}/${p.id}: explodeVector finite`);
      gte(Math.hypot(...v), 0.05, `${m.id}/${p.id}: explodeVector length`);
    }
  }
});

it('explode reach is bounded by the model radius', () => {
  for (const m of MODELS) {
    const r = build(m);
    for (const p of r.parts) {
      const reach = Math.hypot(...p.explodeVector);
      ok(reach <= r.modelRadius * 1.0, `${m.id}/${p.id}: reach ${reach.toFixed(2)} vs radius ${r.modelRadius.toFixed(2)}`);
    }
  }
});

it('part bounds are sane', () => {
  for (const m of MODELS) {
    const r = build(m);
    for (const p of r.parts) {
      gte(p.radius, 0.001, `${m.id}/${p.id}: radius`);
      ok(p.radius < 60, `${m.id}/${p.id}: radius not absurd`);
      ok(p.center.every(Number.isFinite), `${m.id}/${p.id}: center finite`);
    }
  }
});

it('models are centred and bounded for camera framing', () => {
  for (const m of MODELS) {
    const r = build(m);
    const c = boundsCenter(r.parts);
    gte(boundsRadius(r.parts), 0.1, `${m.id}: radius`);
    gte(r.modelRadius, 0.1, `${m.id}: modelRadius`);
    ok(c.every(Number.isFinite), `${m.id}: centre`);
  }
});

/**
 * The camera aims at boundsCenter, so it has to be the model's actual middle. Averaging
 * the part centres is not that: parts differ in size, so the mean drifts toward whichever
 * side has more of them. On the heart it landed 0.51 units off, which pushed the model
 * visibly off-centre in frame, and the jet engine 0.59.
 */
it('boundsCenter is the midpoint of the extent, not the mean of part centres', () => {
  for (const m of MODELS) {
    const r = build(m);
    const c = boundsCenter(r.parts);
    for (let i = 0; i < 3; i++) {
      let lo = Infinity;
      let hi = -Infinity;
      for (const p of r.parts) {
        lo = Math.min(lo, p.center[i] - p.radius);
        hi = Math.max(hi, p.center[i] + p.radius);
      }
      close(c[i], (lo + hi) / 2, 1e-6, `${m.id}: axis ${i}`);
    }
  }
});

it('budget scaling keeps the invariant', () => {
  for (const budget of [8000, 50000]) {
    const r = build(MODELS[0], budget);
    const total = r.parts.reduce((s, p) => s + p.count, 0);
    gte(total, budget * 0.9, `budget ${budget}: allocated`);
  }
});

describe('determinism');

it('the same seed produces identical targets', () => {
  const a = build(MODELS[0]).system.targetA;
  const b = build(MODELS[0]).system.targetA;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) throw new Error(`target diverged at ${i}`);
  }
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
