import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const suites = [
  'gestures.test.mjs',
  'tracker.test.mjs',
  'models.test.mjs',
  'brain.test.mjs',
  'camera.test.mjs',
  'math.test.mjs',
  'progress.test.mjs',
  'quality.test.mjs',
];

let failed = 0;

for (const suite of suites) {
  console.log(`\n${'='.repeat(60)}\n${suite}\n${'='.repeat(60)}`);
  const code = await new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(here, suite)], { stdio: 'inherit' });
    child.on('exit', resolve);
  });
  if (code !== 0) failed++;
}

console.log(`\n${'='.repeat(60)}`);
if (failed) {
  console.log(`${failed} suite(s) FAILED`);
  process.exit(1);
}
console.log('all suites passed');
