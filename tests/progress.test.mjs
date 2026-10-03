import { Progress } from '../js/core/progress.js';

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

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
  };
}

const parts = [
  { id: 'a', name: 'Alpha' },
  { id: 'b', name: 'Beta' },
  { id: 'c', name: 'Gamma' },
];

describe('progress tracking');

it('records inspected parts without duplicates', () => {
  const p = new Progress(memoryStorage());
  p.recordExplored('heart', 'a');
  p.recordExplored('heart', 'a');
  p.recordExplored('heart', 'b');
  eq(p.exploredCount('heart'), 2, 'explored count');
  eq(p.isExplored('heart', 'a'), true, 'a explored');
  eq(p.isExplored('heart', 'c'), false, 'c untouched');
});

it('keeps models separate', () => {
  const p = new Progress(memoryStorage());
  p.recordExplored('heart', 'a');
  p.recordExplored('dna', 'b');
  eq(p.exploredCount('heart'), 1, 'heart');
  eq(p.exploredCount('dna'), 1, 'dna');
});

it('ignores parts the model does not have', () => {
  const p = new Progress(memoryStorage()).registerModel('heart', parts);
  p.recordExplored('heart', 'not-a-part');
  eq(p.exploredCount('heart'), 0, 'count');
  eq(p.isExplored('heart', 'not-a-part'), false, 'isExplored');
});

it('accepts any part when the model is unregistered', () => {
  const p = new Progress(memoryStorage());
  p.recordExplored('heart', 'anything');
  eq(p.exploredCount('heart'), 1, 'no registry means no filtering');
});

it('completes a model only when every part is explored', () => {
  const p = new Progress(memoryStorage());
  eq(p.completion('heart', parts), 0, 'empty');
  p.recordExplored('heart', 'a');
  closeTo(p.completion('heart', parts), 1 / 3, 'one of three');
  p.recordExplored('heart', 'b');
  p.recordExplored('heart', 'c');
  closeTo(p.completion('heart', parts), 1, 'complete');
  eq(p.isComplete('heart', parts), true, 'isComplete');
});

function closeTo(actual, expected, m = '') {
  if (Math.abs(actual - expected) > 1e-9) throw new Error(`${m} ${actual} vs ${expected}`);
}

describe('persistence');

it('survives a reload from storage', () => {
  const storage = memoryStorage();
  const a = new Progress(storage);
  a.recordExplored('heart', 'a');

  const b = new Progress(storage);
  eq(b.exploredCount('heart'), 1, 'explored restored');
});

it('recovers from corrupt storage instead of throwing', () => {
  const storage = memoryStorage();
  storage.setItem('wondersnap:progress', '{not json');
  const p = new Progress(storage);
  eq(p.exploredCount('heart'), 0, 'defaults to empty');
  p.recordExplored('heart', 'a');
  eq(p.exploredCount('heart'), 1, 'still writable');
});

it('ignores unknown keys in stored data', () => {
  const storage = memoryStorage();
  storage.setItem('wondersnap:progress', JSON.stringify({
    version: 1,
    models: { heart: { parts: ['a', 'ghost'] } },
  }));
  const p = new Progress(storage);
  p.registerModel('heart', parts);
  eq(p.exploredCount('heart'), 1, 'ghost part pruned once the model is known');
});

it('caps stored size', () => {
  const storage = memoryStorage();
  const p = new Progress(storage);
  for (let i = 0; i < 500; i++) p.recordExplored('heart', `part-${i}`);
  const raw = storage.getItem('wondersnap:progress');
  ok(raw.length < 20000, `stored size ${raw.length} is bounded`);
});

it('reset clears everything', () => {
  const p = new Progress(memoryStorage());
  p.recordExplored('heart', 'a');
  p.reset();
  eq(p.exploredCount('heart'), 0, 'explored cleared');
});

it('survives a storage backend that throws', () => {
  const hostile = {
    getItem() { throw new Error('denied'); },
    setItem() { throw new Error('denied'); },
    removeItem() { throw new Error('denied'); },
  };
  const p = new Progress(hostile);
  p.recordExplored('heart', 'a');
  eq(p.exploredCount('heart'), 1, 'works in memory');
});

describe('session summary');

it('summarises overall progress across models', () => {
  const p = new Progress(memoryStorage());
  const registry = [{ id: 'heart', parts }, { id: 'dna', parts }];
  p.recordExplored('heart', 'a');
  p.syncRegistry(registry);
  const s = p.summary(registry);
  eq(s.modelsSeen, 1, 'models seen');
  eq(s.modelsComplete, 0, 'models complete');
  eq(s.partsTotal, 6, 'parts total');
  eq(s.partsExplored, 1, 'parts explored');
  gte(s.overall, 0, 'overall');
  gte(s.overall, 0.16, 'overall reflects the explored fraction');
});

describe('storage unavailable');

it('is a no-op when localStorage is absent', () => {
  const p = new Progress(undefined);
  p.recordExplored('heart', 'a');
  eq(p.exploredCount('heart'), 1, 'in-memory fallback works');
  eq(p.persistent, false, 'not persistent');
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
