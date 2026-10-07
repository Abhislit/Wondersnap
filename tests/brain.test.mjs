/**
 * Brain model tests. The generic suite in models.test.mjs checks that a model obeys the
 * format, not that its geometry is anatomically defensible. These check the two things
 * that were actually wrong in the source model this was ported from:
 *
 *   1. Lobe boundaries. The original split lobes on axis-aligned thresholds, so the
 *      frontal/parietal divide was a horizontal plane. The real divide is the central
 *      sulcus, which runs vertically and separates anterior from posterior.
 *   2. Interior structures were solid. A solid volume inside a cortical shell occludes
 *      everything behind it, which is the same bug that cost real debugging time on the
 *      heart's ventricles.
 */
import brain, { lobeAt, cortexSkip, LOBES } from '../js/models/brain.js';

const results = [];
let group = '';
function describe(n) { group = n; }
function it(name, fn) {
  try { fn(); results.push({ group, name, ok: true }); }
  catch (err) { results.push({ group, name, ok: false, error: err.message }); }
}
function eq(a, b, m = '') { if (a !== b) throw new Error(`${m} expected ${b}, got ${a}`); }
function gte(a, min, m = '') { if (!(a >= min)) throw new Error(`${m} expected >= ${min}, got ${a}`); }
function ok(v, m = 'expected truthy') { if (!v) throw new Error(m); }

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function part(id) {
  const p = brain.parts.find((x) => x.id === id);
  if (!p) throw new Error(`no part '${id}'`);
  return p;
}

/**
 * Sampled points, centroid, and the distance range from that centroid.
 *
 * `side` narrows to one hemisphere. Paired structures are mirrored about the midline, so
 * the centroid of the whole thing is the midline itself and nearly touches both halves --
 * measuring hollowness against it would say nothing about either side.
 */
function samplePart(id, n = 4000, seed = 99, side = null) {
  const rand = mulberry32(seed);
  const s = part(id).sampler;
  let cx = 0, cy = 0, cz = 0;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const p = s(rand, i, n).p;
    if (side === 'right' && p[0] <= 0) continue;
    if (side === 'left' && p[0] >= 0) continue;
    pts.push(p);
    cx += p[0]; cy += p[1]; cz += p[2];
  }
  const count = pts.length;
  cx /= count; cy /= count; cz /= count;
  let min = Infinity, max = 0;
  for (const p of pts) {
    const d = Math.hypot(p[0] - cx, p[1] - cy, p[2] - cz);
    if (d < min) min = d;
    if (d > max) max = d;
  }
  return { min, max, count, center: [cx, cy, cz] };
}

/** Fraction of points right of the midline. A mirrored pair should come out near 0.5. */
function rightFraction(id, n = 8000, seed = 99) {
  const rand = mulberry32(seed);
  const s = part(id).sampler;
  let right = 0;
  for (let i = 0; i < n; i++) {
    if (s(rand, i, n).p[0] > 0) right++;
  }
  return right / n;
}

describe('lobe boundaries');

/**
 * Probe directions on the unit sphere, in the model's frame: +Z is the front of the
 * head, +Y up, +X the model's right. Each is a point whose lobe is not in doubt from
 * the sulcal anatomy.
 */
const PROBES = [
  { dir: [0, 0.25, 0.95], lobe: 'frontal', why: 'frontal pole' },
  { dir: [0, 0.8, 0.2], lobe: 'frontal', why: 'superior, anterior of the central sulcus' },
  { dir: [0, 0.55, -0.15], lobe: 'parietal', why: 'between central and parieto-occipital sulci' },
  { dir: [0, 0, -0.95], lobe: 'occipital', why: 'occipital pole' },
  { dir: [0.85, -0.45, 0.5], lobe: 'temporal', why: 'temporal pole, inferolateral and anterior' },
  {
    dir: [0.9, -0.45, -0.42],
    lobe: 'temporal',
    why: 'inferolateral, below the lateral fissure and anterior to the preoccipital notch',
  },
  { dir: [0, 0.1, 0.35], lobe: 'frontal', why: 'just above the equator, anterior of the central sulcus' },
];

for (const { dir, lobe, why } of PROBES) {
  it(`${lobe}: ${why}`, () => {
    const l = Math.hypot(...dir);
    eq(lobeAt(dir[0] / l, dir[1] / l, dir[2] / l), lobe, why);
  });
}

it('every cortical direction resolves to a known lobe', () => {
  const rand = mulberry32(7);
  for (let i = 0; i < 20000; i++) {
    const u = rand() * 2 - 1;
    const th = rand() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    const l = lobeAt(s * Math.cos(th), u, s * Math.sin(th));
    ok(LOBES.includes(l), `unknown lobe '${l}'`);
  }
});

/**
 * Published lobe volumes are frontal 33.4%, temporal 21.4%, parietal 19.1%, occipital
 * 12.6%. This measures surface share on a deformed ellipsoid, which is not the same
 * quantity, so only the ordering is asserted -- but an ordering reversal would mean a
 * landmark has moved, which is a real defect.
 */
function surfaceShares(n = 40000, seed = 11) {
  const rand = mulberry32(seed);
  const share = Object.fromEntries(LOBES.map((l) => [l, 0]));
  let total = 0;
  for (let i = 0; i < n; i++) {
    const u = rand() * 2 - 1;
    const th = rand() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    const dx = s * Math.cos(th);
    const dy = u;
    const dz = s * Math.sin(th);
    if (cortexSkip(dx, dy, dz)) continue;
    share[lobeAt(dx, dy, dz)]++;
    total++;
  }
  ok(total > 0, 'no cortex sampled');
  const pct = {};
  for (const l of LOBES) pct[l] = (share[l] / total) * 100;
  return pct;
}

it('lobes are ordered frontal > temporal > parietal > occipital', () => {
  const p = surfaceShares();
  ok(p.frontal > p.temporal, `frontal ${p.frontal.toFixed(1)}% should exceed temporal ${p.temporal.toFixed(1)}%`);
  ok(p.temporal > p.parietal, `temporal ${p.temporal.toFixed(1)}% should exceed parietal ${p.parietal.toFixed(1)}%`);
  ok(p.parietal > p.occipital, `parietal ${p.parietal.toFixed(1)}% should exceed occipital ${p.occipital.toFixed(1)}%`);
});

it('frontal lobe is the largest by surface share', () => {
  const p = surfaceShares();
  const frontal = p.frontal;
  for (const lobe of LOBES) {
    if (lobe === 'frontal') continue;
    ok(frontal > p[lobe], `frontal ${frontal.toFixed(1)}% should exceed ${lobe} ${p[lobe].toFixed(1)}%`);
  }
});

describe('interior structures are hollow');

/**
 * A shell's closest sample to its own centroid sits at the inner wall; a solid's sits at
 * its centre. This is the guard against re-introducing the heart's ventricle bug.
 */
const SHELL_PARTS = ['thalamus', 'amygdala', 'cerebellum', 'brainstem'];
const PAIRED_PARTS = ['thalamus', 'amygdala', 'hippocampus'];

for (const id of SHELL_PARTS) {
  it(`${id} is a shell, not a solid`, () => {
    const side = PAIRED_PARTS.includes(id) ? 'right' : null;
    const { min, max, count } = samplePart(id, 8000, 99, side);
    ok(count > 1000, `${id} too few points on side (${count})`);
    gte(min / max, 0.25, `${id} hollowness min/max`);
  });
}

describe('interior structures are placed inside the cortex');

it('thalamus straddles the midline', () => {
  const f = rightFraction('thalamus');
  ok(Math.abs(f - 0.5) < 0.08, `thalami should be balanced either side, ${(f * 100).toFixed(1)}% right`);
  const { center } = samplePart('thalamus', 8000, 99, 'right');
  ok(center[0] > 0.05, `right thalamus should be off-midline, x=${center[0].toFixed(3)}`);
  ok(center[0] < 0.6, `thalamus too far lateral, x=${center[0].toFixed(3)}`);
});

it('corpus callosum sits on the midline', () => {
  const { center } = samplePart('corpus callosum');
  ok(Math.abs(center[0]) < 0.12, `corpus callosum off-midline, x=${center[0].toFixed(3)}`);
});

it('cerebellum sits behind and below the cerebrum', () => {
  const { center } = samplePart('cerebellum');
  ok(center[2] < -0.3, `cerebellum should be posterior, z=${center[2].toFixed(3)}`);
  ok(center[1] < 0, `cerebellum should be inferior, y=${center[1].toFixed(3)}`);
});

it('amygdala and hippocampus both sit in the medial temporal lobe', () => {
  const a = samplePart('amygdala', 8000, 99, 'right').center;
  const h = samplePart('hippocampus', 8000, 99, 'right').center;
  for (const [name, c] of [['amygdala', a], ['hippocampus', h]]) {
    ok(c[1] < 0, `${name} should be inferior, y=${c[1].toFixed(3)}`);
    ok(c[0] > 0.3, `${name} should be lateral of the midline, x=${c[0].toFixed(3)}`);
  }
  ok(a[2] > h[2], `amygdala should sit anterior to the hippocampus, ${a[2].toFixed(3)} vs ${h[2].toFixed(3)}`);
});

it('paired structures are present on both sides', () => {
  for (const id of PAIRED_PARTS) {
    const f = rightFraction(id);
    ok(Math.abs(f - 0.5) < 0.08, `${id}: ${(f * 100).toFixed(1)}% right, expected a balanced pair`);
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
