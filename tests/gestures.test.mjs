import {
  GestureEngine, analyzeHand, classifyPose, palmRoll, DEFAULT_TUNING,
} from '../js/core/gestures.js';
import { buildHand, buildPinchHand, POSES, HANDEDNESS, stubHand } from './fixtures/hands.mjs';

const results = [];
let group = '';

function describe(name) { group = name; }

function it(name, fn) {
  try {
    fn();
    results.push({ group, name, ok: true });
  } catch (err) {
    results.push({ group, name, ok: false, error: err.message });
  }
}

function eq(actual, expected, msg = '') {
  if (actual !== expected) throw new Error(`${msg} expected ${expected}, got ${actual}`);
}

function ok(value, msg = 'expected truthy') {
  if (!value) throw new Error(msg);
}

function gte(actual, min, msg = '') {
  if (!(actual >= min)) throw new Error(`${msg} expected >= ${min}, got ${actual}`);
}

const hand = (spec) => analyzeHand(HANDEDNESS, spec);

// ---------------------------------------------------------------- poses

describe('pose classification');

it('open palm', () => {
  const a = hand(buildHand(POSES.open));
  eq(a.poses.openPalm, true, 'openPalm');
  eq(a.poses.fist, false, 'fist');
  eq(a.poses.pinch, false, 'pinch');
  eq(a.extendedCount, 4, 'extendedCount');
});

it('fist', () => {
  const a = hand(buildHand(POSES.fist));
  eq(a.poses.fist, true, 'fist');
  eq(a.poses.openPalm, false, 'openPalm');
  eq(a.extendedCount, 0, 'extendedCount');
});

it('point', () => {
  const a = hand(buildHand(POSES.point));
  eq(a.poses.point, true, 'point');
  eq(a.poses.fist, false, 'fist');
  eq(a.poses.pinch, false, 'pinch');
  eq(a.extendedCount, 1, 'extendedCount');
});

it('pinch', () => {
  const a = hand(buildPinchHand());
  eq(a.poses.pinch, true, 'pinch');
  eq(a.poses.fist, false, 'fist');
});

it('relaxed hand matches no pose', () => {
  const a = hand(buildHand(POSES.relaxed));
  eq(a.poses.fist, false, 'fist');
  eq(a.poses.point, false, 'point');
  eq(a.poses.pinch, false, 'pinch');
  eq(a.poses.openPalm, false, 'openPalm');
  eq(classifyPose(a), 'neutral', 'classifyPose');
});

it('poses are mutually exclusive', () => {
  for (const [name, spec] of Object.entries(POSES)) {
    const a = hand(buildHand(spec));
    const active = ['pinch', 'fist', 'point', 'openPalm'].filter((p) => a.poses[p]);
    ok(active.length <= 1, `${name} matched ${active.length} poses at once`);
  }
});

it('curl ramp is monotonic in extendedCount', () => {
  let previous = 4;
  for (const curl of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
    const a = hand(buildHand({
      index: curl, middle: curl, ring: curl, pinky: curl, thumbTip: [0.34, 0.62],
    }));
    ok(a.extendedCount <= previous, `curl ${curl} increased extendedCount`);
    previous = a.extendedCount;
  }
});

// ---------------------------------------------------------------- hysteresis

describe('hysteresis and cooldown');

function feed(engine, landmarks, frames = 1, dt = 1 / 60) {
  const out = [];
  for (let i = 0; i < frames; i++) {
    out.push(engine.update([hand(landmarks)], dt).pose);
  }
  return out;
}

it('a pose must persist before it activates', () => {
  const engine = new GestureEngine();
  const poses = feed(engine, buildHand(POSES.point), DEFAULT_TUNING.ENTER_FRAMES + 4);
  eq(poses[0], 'neutral', 'first frame');
  eq(poses[DEFAULT_TUNING.ENTER_FRAMES - 2], 'neutral', 'last pre-threshold frame');
  eq(poses[DEFAULT_TUNING.ENTER_FRAMES - 1], 'point', 'activation frame');
  eq(poses[poses.length - 1], 'point', 'settled pose');
});

it('a single flick does not activate a pose', () => {
  const engine = new GestureEngine();
  const sequence = [POSES.point, POSES.open, POSES.point, POSES.open, POSES.point, POSES.open];
  for (const spec of sequence) engine.update([hand(buildHand(spec))], 1 / 60);
  eq(engine.activePose, 'neutral', 'pose after flicking');
});

it('holding one pose does not re-fire its callback', () => {
  const engine = new GestureEngine();
  let fistEvents = 0;
  engine.onFist = () => { fistEvents++; };
  feed(engine, buildHand(POSES.fist), 40);
  eq(fistEvents, 1, 'fist events while held');
});

it('open palm fires once then respects cooldown', () => {
  const engine = new GestureEngine();
  let events = 0;
  engine.onOpenPalm = () => { events++; };
  feed(engine, buildHand(POSES.open), 60);
  eq(events, 1, 'open palm events');
});

// ---------------------------------------------------------------- snap

describe('snap detection');

function snapRunner() {
  let t = performance.now();
  const engine = new GestureEngine();
  return (distance, dt = 16) => {
    t += dt;
    engine.history.push({
      t, pinchDistance: distance, pinchMid: { x: 0.5, y: 0.5, z: 0 },
      center: [0.5, 0.5], roll: 0, normal: [0, 0, 1],
    });
    return engine.detectSnap(stubHand({ pinchDistance: distance }));
  };
}

it('fires on a fast close', () => {
  const feed = snapRunner();
  let fired = 0;
  for (const d of [0.95, 0.72, 0.5, 0.28, 0.2]) if (feed(d)) fired++;
  eq(fired, 1, 'fires');
});

it('fires at low frame rates', () => {
  const feed = snapRunner();
  let fired = 0;
  for (const d of [0.95, 0.72, 0.5, 0.28, 0.2]) if (feed(d, 90)) fired++;
  eq(fired, 1, 'fires');
});

it('ignores a slow close', () => {
  const feed = snapRunner();
  let fired = 0;
  for (const d of [0.55, 0.5, 0.46, 0.44]) if (feed(d)) fired++;
  eq(fired, 0, 'slow close');
});

it('ignores a hand held open', () => {
  const feed = snapRunner();
  let fired = 0;
  for (const d of [0.9, 0.6, 0.5, 0.45, 0.42]) if (feed(d)) fired++;
  eq(fired, 0, 'held open');
});

it('respects cooldown', () => {
  const feed = snapRunner();
  for (const d of [0.95, 0.72, 0.5]) eq(feed(d), false, `no snap yet at ${d}`);
  eq(feed(0.28), true, 'snap fires once tight enough');
  eq(feed(0.2), false, 'immediate second snap blocked');
  eq(feed(0.19), false, 'third snap still blocked');
});

it('needs at least three samples', () => {
  const feed = snapRunner();
  eq(feed(0.95), false, 'sample 1');
  eq(feed(0.2), false, 'sample 2');
});

// ---------------------------------------------------------------- camera axes

describe('camera axes');

it('a static hand produces no rotation', () => {
  const engine = new GestureEngine();
  const deltas = new Set();
  for (let i = 0; i < 30; i++) {
    deltas.add(engine.update([hand(buildHand(POSES.open))], 1 / 60).camera.yaw);
  }
  eq(deltas.size, 1, 'distinct yaw values');
  eq([...deltas][0], 0, 'yaw');
});

it('twisting rotates the camera', () => {
  const engine = new GestureEngine();
  let nonzero = 0;
  for (let i = 0; i < 20; i++) {
    const roll = (i - 10) * 0.06;
    const state = engine.update([hand(buildHand({ ...POSES.open, roll }))], 1 / 60);
    if (state.camera.yaw !== 0) nonzero++;
  }
  gte(nonzero, 12, 'frames with yaw');
});

it('twist produces both yaw and pitch', () => {
  const engine = new GestureEngine();
  let pitched = 0;
  for (let i = 0; i < 20; i++) {
    const state = engine.update([hand(buildHand({ ...POSES.open, roll: i * 0.06 }))], 1 / 60);
    if (state.camera.pitch !== 0) pitched++;
  }
  gte(pitched, 10, 'frames with pitch');
});

it('two hands moving apart zoom', () => {
  const engine = new GestureEngine();
  const a = { ...hand(buildHand(POSES.open)), center: [0.35, 0.5] };
  const b = { ...hand(buildHand(POSES.open)), center: [0.65, 0.5] };
  engine.update([a, b], 1 / 60);
  const spread = { ...a, center: [0.25, 0.5] };
  const spread2 = { ...b, center: [0.75, 0.5] };
  const state = engine.update([spread, spread2], 1 / 60);
  ok(state.camera.zoom > 0, `zoom positive, got ${state.camera.zoom}`);
});

it('one hand reports no zoom', () => {
  const engine = new GestureEngine();
  for (let i = 0; i < 5; i++) {
    const state = engine.update([hand(buildHand({ ...POSES.open, roll: i * 0.05 }))], 1 / 60);
    eq(state.camera.zoom, 0, 'zoom');
  }
});

it('losing the hand yields a safe neutral frame', () => {
  const engine = new GestureEngine();
  feed(engine, buildHand(POSES.point), 8);
  const state = engine.update([], 1 / 60);
  eq(state.primary, null, 'primary');
  eq(state.pose, 'neutral', 'pose');
  eq(state.handCount, 0, 'handCount');
  eq(state.camera.yaw, 0, 'yaw');
  eq(state.camera.pitch, 0, 'pitch');
  eq(state.camera.zoom, 0, 'zoom');
});

it('regaining a hand recovers without a stale reference', () => {
  const engine = new GestureEngine();
  feed(engine, buildHand(POSES.open), 8);
  engine.update([], 1 / 60);
  const state = engine.update([hand(buildHand(POSES.open))], 1 / 60);
  eq(state.handCount, 1, 'handCount');
  eq(state.camera.yaw, 0, 'no jump on reacquire');
});

it('palmRoll tracks the knuckle line', () => {
  const flat = palmRoll(buildHand(POSES.open));
  const rolled = palmRoll(buildHand({ ...POSES.open, roll: 0.5 }));
  ok(Math.abs(rolled - flat) > 0.3, `roll changed: ${flat} -> ${rolled}`);
});

// ---------------------------------------------------------------- tuning

describe('tuning surface');

it('thresholds are overridable at runtime', () => {
  const engine = new GestureEngine();
  engine.setTuning({ PINCH_DISTANCE: 1.2 });
  const a = hand(buildHand(POSES.open));
  const tight = analyzeHand(HANDEDNESS, buildHand(POSES.open), DEFAULT_TUNING);
  const loose = analyzeHand(HANDEDNESS, buildHand(POSES.open), { ...DEFAULT_TUNING, PINCH_DISTANCE: 1.2 });
  eq(tight.poses.pinch, false, 'default does not pinch');
  eq(loose.poses.pinch, true, 'loose threshold pinches');
  eq(a.poses.pinch, false, 'engine tuning did not mutate defaults');
});

it('reset clears pose and pinch state', () => {
  const engine = new GestureEngine();
  feed(engine, buildHand(POSES.point), 8);
  let pinchEnded = 0;
  engine.onPinchEnd = () => { pinchEnded++; };
  feed(engine, buildPinchHand(), 8);
  engine.reset();
  eq(engine.activePose, 'neutral', 'pose');
  eq(engine.pinchStart, null, 'pinchStart');
  eq(engine.rollReference, null, 'rollReference');
  gte(pinchEnded, 1, 'pinchEnd fired');
});

// ---------------------------------------------------------------- report

let failed = 0;
let lastGroup = '';
for (const r of results) {
  if (r.group !== lastGroup) {
    console.log(`\n${r.group}`);
    lastGroup = r.group;
  }
  if (r.ok) {
    console.log(`  ok   ${r.name}`);
  } else {
    failed++;
    console.log(`  FAIL ${r.name} :: ${r.error}`);
  }
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
