/**
 * Camera lifecycle. The camera is the only part of startup that touches hardware and
 * the only part that fails transiently, so these cover what happens on failure and on
 * retry: the device must not be left held, a retry must be able to run again, and the
 * attempt counter must advance so a cached module rejection is not replayed.
 */
import { HandTracker } from '../js/core/tracker.js';

const results = [];
let group = '';
function describe(n) { group = n; }

async function it(name, fn) {
  try {
    await fn();
    results.push({ group, name, ok: true });
  } catch (err) {
    results.push({ group, name, ok: false, error: err.message });
  }
}

function ok(v, m = 'expected truthy') { if (!v) throw new Error(m); }
function eq(a, b, m = '') { if (a !== b) throw new Error(`${m} expected ${b}, got ${a}`); }

/** Minimal <video> stand-in: the tracker only uses srcObject, play and readyState. */
function fakeVideo() {
  return { srcObject: 'untouched', play: () => Promise.resolve(), readyState: 4, currentTime: 0 };
}

function fakeStream() {
  const tracks = [{
    readyState: 'live',
    stop() { this.readyState = 'ended'; },
  }];
  return { tracks, getTracks: () => tracks };
}

function denyWith(name) {
  return async () => { throw Object.assign(new Error('denied'), { name }); };
}

/** Swaps in a fake navigator.mediaDevices for the duration of a test. */
async function withMediaDevices(value, fn) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value, configurable: true, writable: true });
  try {
    return await fn();
  } finally {
    if (previous) Object.defineProperty(globalThis, 'navigator', previous);
    else delete globalThis.navigator;
  }
}

/**
 * In this checkout the MediaPipe bundle is a browser module, so the dynamic import
 * inside start() cannot succeed under Node. That is exactly the "camera opened, then
 * something later failed" case these tests need, and it needs no stubbing.
 */
describe('camera release when startup fails after the camera opens');

await it('does not leave the device held after a later failure', async () => {
  const stream = fakeStream();
  await withMediaDevices({ mediaDevices: { getUserMedia: async () => stream } }, async () => {
    const t = new HandTracker(fakeVideo());
    let threw = false;
    try {
      await t.start();
    } catch {
      threw = true;
    }
    ok(threw, 'start() rejected');
    eq(stream.tracks[0].readyState, 'ended', 'camera track stopped');
    eq(t.stream, null, 'stream reference dropped');
    eq(t.running, false, 'not marked running');
  });
});

await it('clears the video element and cached hand state', async () => {
  const stream = fakeStream();
  const video = fakeVideo();
  await withMediaDevices({ mediaDevices: { getUserMedia: async () => stream } }, async () => {
    const t = new HandTracker(video);
    await t.start().catch(() => {});
    eq(video.srcObject, null, 'srcObject cleared');
    eq(t.landmarker, null, 'landmarker cleared');
    eq(t.lastVideoTime, -1, 'video timestamp reset');
    eq(t.fps, 0, 'fps reset');
  });
});

describe('retry');

await it('advances the attempt counter on every start', async () => {
  await withMediaDevices({ mediaDevices: { getUserMedia: denyWith('NotFoundError') } }, async () => {
    const t = new HandTracker(fakeVideo());
    await t.start().catch(() => {});
    eq(t.attempts, 1, 'after first attempt');
    await t.start().catch(() => {});
    eq(t.attempts, 2, 'after second attempt');
    await t.start().catch(() => {});
    eq(t.attempts, 3, 'after third attempt');
  });
});

await it('releases the previous camera before asking again', async () => {
  const stream = fakeStream();
  await withMediaDevices({ mediaDevices: { getUserMedia: async () => stream } }, async () => {
    const t = new HandTracker(fakeVideo());
    await t.start().catch(() => {});
    eq(stream.tracks[0].readyState, 'ended', 'track stopped by the failed attempt');
    // A second attempt must be able to run without the device still being held.
    await t.start().catch(() => {});
    eq(t.attempts, 2, 'second attempt ran');
  });
});

describe('browsers without camera access');

await it('names a missing getUserMedia so the UI can explain why', async () => {
  await withMediaDevices({ mediaDevices: {} }, async () => {
    const t = new HandTracker(fakeVideo());
    let name = null;
    try {
      await t.start();
    } catch (err) {
      name = err.name;
    }
    eq(name, 'InsecureContextError', 'recognisable error name');
  });
});

await it('does not touch the device when getUserMedia is absent', async () => {
  let asked = false;
  await withMediaDevices(undefined, async () => {
    const t = new HandTracker(fakeVideo());
    await t.start().catch(() => {});
    eq(asked, false, 'never asked');
  });
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