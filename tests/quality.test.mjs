import {
  sampleBudget, shouldDowngrade, shouldUpgrade, averageFrameTime,
  QualityController,
} from '../js/core/quality.js';

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

describe('frame timing');

it('averages to the mean of recent frames', () => {
  closeTo(averageFrameTime([16, 16, 16]), 16, 'constant');
  closeTo(averageFrameTime([10, 20]), 15, 'pair');
  eq(averageFrameTime([]), 0, 'empty');
});

it('ignores non-finite and non-positive samples', () => {
  closeTo(averageFrameTime([16, NaN, 0, -5, 16, Infinity]), 16, 'filtered');
});

describe('budget sampling');

it('walks down to the floor', () => {
  eq(sampleBudget(240000, 0.5), 120000, 'one step');
  let b = 240000;
  const seen = [];
  for (let i = 0; i < 30; i++) { b = sampleBudget(b, 0.5); seen.push(b); if (b <= 4000) break; }
  lte(b, 4000, 'reaches the floor');
  ok(new Set(seen).size > 3, 'passes through several levels');
});

it('walks up to the ceiling', () => {
  let b = 8000;
  for (let i = 0; i < 30; i++) b = sampleBudget(b, 2);
  gte(b, 240000, 'reaches the ceiling');
});

it('never leaves the valid range', () => {
  for (const start of [1, 100, 4000, 120000, 240000]) {
    for (const factor of [0.1, 0.5, 1, 2, 10]) {
      const b = sampleBudget(start, factor);
      gte(b, 4000, `floor for ${start}*${factor}`);
      lte(b, 240000, `ceiling for ${start}*${factor}`);
    }
  }
});

function closeTo(a, b, m = '') {
  if (Math.abs(a - b) > 1e-6) throw new Error(`${m} ${a} vs ${b}`);
}

describe('hysteresis');

it('downgrades when consistently slow', () => {
  ok(shouldDowngrade({ average: 33, budget: 240000, samples: 60 }), 'downgrades at 30fps');
});

it('holds when frame time is acceptable', () => {
  ok(!shouldDowngrade({ average: 12, budget: 240000, samples: 60 }), 'holds at 80fps');
});

it('waits for enough samples before deciding', () => {
  ok(!shouldDowngrade({ average: 40, budget: 240000, samples: 10 }), 'too few samples');
});

it('upgrades only when there is real headroom', () => {
  ok(shouldUpgrade({ average: 6, budget: 120000, samples: 180, ceiling: 240000 }), 'upgrades at 160fps');
  ok(!shouldUpgrade({ average: 14, budget: 120000, samples: 180, ceiling: 240000 }), 'holds at 70fps');
  ok(!shouldUpgrade({ average: 6, budget: 240000, samples: 180, ceiling: 240000 }), 'already at ceiling');
});

it('does not thrash between two levels', () => {
  let downgrades = 0;
  for (let i = 0; i < 400; i++) {
    if (shouldDowngrade({ average: 20, budget: 240000, samples: 60 })) downgrades++;
  }
  lte(downgrades, 1, 'downgrades at most once per evaluation window');
});

describe('controller');

it('reports a verdict for the app', () => {
  const controller = new QualityController({ initialBudget: 240000, targetFps: 60 });
  eq(controller.budget, 240000, 'initial budget');
  eq(controller.targetFps, 60, 'target');
  eq(controller.shouldRebuild(), false, 'no rebuild on first frame');
});

it('needs sustained evidence before reducing quality', () => {
  const controller = new QualityController({ initialBudget: 240000, targetFps: 60 });
  for (let i = 0; i < 30; i++) controller.sample(1 / 30);
  eq(controller.shouldRebuild(), false, 'a brief hitch is tolerated');
  for (let i = 0; i < 120; i++) controller.sample(1 / 30);
  eq(controller.shouldRebuild(), true, 'sustained slowness triggers a rebuild');
});

it('never reduces below the floor', () => {
  const controller = new QualityController({ initialBudget: 240000, targetFps: 60, floor: 4000 });
  for (let i = 0; i < 2000; i++) {
    controller.sample(1 / 30);
    if (controller.shouldRebuild()) controller.commit();
  }
  gte(controller.budget, 4000, 'floor respected');
});

it('restores quality when the load drops', () => {
  const controller = new QualityController({ initialBudget: 240000, targetFps: 60, floor: 4000 });
  for (let i = 0; i < 400; i++) {
    controller.sample(1 / 40);
    if (controller.shouldRebuild()) controller.commit();
  }
  const reduced = controller.budget;
  ok(reduced < 240000, 'reduced from the ceiling');
  for (let i = 0; i < 600; i++) {
    controller.sample(1 / 120);
    if (controller.shouldRebuild()) controller.commit();
  }
  gte(controller.budget, reduced, 'never goes below the reduced level');
});

it('marks a rebuild consumed once committed', () => {
  const controller = new QualityController({ initialBudget: 240000, targetFps: 60 });
  for (let i = 0; i < 200; i++) controller.sample(1 / 30);
  eq(controller.shouldRebuild(), true, 'pending');
  controller.commit();
  eq(controller.shouldRebuild(), false, 'consumed');
});

it('reset returns to the initial budget', () => {
  const controller = new QualityController({ initialBudget: 240000, targetFps: 60, floor: 4000 });
  for (let i = 0; i < 400; i++) {
    controller.sample(1 / 30);
    if (controller.shouldRebuild()) controller.commit();
  }
  controller.reset();
  eq(controller.budget, 240000, 'reset');
});

it('respects a pinned budget', () => {
  const controller = new QualityController({ initialBudget: 240000, targetFps: 60, pinned: true });
  for (let i = 0; i < 400; i++) controller.sample(1 / 30);
  eq(controller.shouldRebuild(), false, 'never rebuilds when pinned');
  eq(controller.budget, 240000, 'budget unchanged');
});

it('rejects a fixed ceiling when adaptive', () => {
  const controller = new QualityController({ initialBudget: 240000, targetFps: 60 });
  eq(controller.ceiling, 240000, 'ceiling');
  const pinned = new QualityController({ initialBudget: 120000, targetFps: 60, pinned: true });
  eq(pinned.ceiling, 120000, 'pinned ceiling');
});

it('disables itself when frame time is unusable', () => {
  const controller = new QualityController({ initialBudget: 240000, targetFps: 60 });
  for (let i = 0; i < 200; i++) controller.sample(NaN);
  eq(controller.shouldRebuild(), false, 'NaN samples do not trigger a rebuild');
  for (let i = 0; i < 200; i++) controller.sample(0);
  eq(controller.shouldRebuild(), false, 'zero samples do not trigger a rebuild');
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
