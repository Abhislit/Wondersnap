/**
 * Browser smoke test. Boots the real app in headless Chrome with a fake camera and
 * asserts the things unit tests cannot: that WebGL2 initialises, that particles
 * actually reach the framebuffer, and that the GPU and CPU agree on where parts are.
 *
 * Software rendering is used, so this runs at a reduced particle budget and makes no
 * framerate claim.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PARTICLES = Number(process.env.PARTICLES || 20000);
const PORT = Number(process.env.PORT || 8799);

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

const chromePath = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
if (!chromePath) {
  console.error('SKIP: no Chrome found. Set CHROME_PATH to run the browser suite.');
  process.exit(0);
}

let puppeteer;
try {
  puppeteer = (await import('puppeteer-core')).default;
} catch {
  console.error('SKIP: puppeteer-core is not installed. Run: npm install --no-save puppeteer-core');
  process.exit(0);
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.task': 'application/octet-stream',
  '.svg': 'image/svg+xml',
};

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(ROOT, url === '/' ? 'index.html' : url);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(PORT, r));

const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: 'new',
  protocolTimeout: 240000,
  args: [
    '--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader',
    '--use-gl=angle', '--use-angle=swiftshader', '--disable-gpu-watchdog',
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
  ],
});

const errors = [];

/**
 * Software rendering leaks enough memory across repeated model rebuilds to get the
 * renderer killed, so each phase gets a fresh page rather than one long session.
 */
async function boot() {
  const p = await browser.newPage();
  await p.setViewport({ width: 640, height: 480, deviceScaleFactor: 1 });
  p.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  await p.goto(`http://localhost:${PORT}/index.html?particles=${PARTICLES}`, { waitUntil: 'networkidle2' });
  await p.click('#gateStart');
  await p.waitForFunction(
    () => document.getElementById('gate').classList.contains('hidden'),
    { timeout: 120000 },
  );
  return p;
}

const close = async (p) => { if (p && !p.isClosed()) await p.close(); };

const pass = [];
const fail = [];
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` :: ${detail}` : ''}`);
  (ok ? pass : fail).push(name);
};

try {
  let page = await boot();
  check('app boots to the live gate', true);
  check('hand tracking reports live',
    /tracking live/i.test(await page.$eval('#status', (e) => e.textContent)),
    await page.$eval('#status', (e) => e.textContent));

  const gl = await page.evaluate(() => {
    const c = document.getElementById('gl');
    const ctx = c.getContext('webgl2');
    return { ok: !!ctx, error: ctx ? ctx.getError() : -1, w: c.width, h: c.height };
  });
  check('WebGL2 context is live', gl.ok, JSON.stringify(gl));
  check('no GL error after boot', gl.error === 0, `glError=${gl.error}`);

  const luma = await page.evaluate(() => new Promise((resolve) => {
    window.__capture((stage, glCtx, canvas) => {
      const span = 140;
      const buf = new Uint8Array(4 * span * span);
      glCtx.readPixels(
        (canvas.width >> 1) - (span >> 1), (canvas.height >> 1) - (span >> 1),
        span, span, glCtx.RGBA, glCtx.UNSIGNED_BYTE, buf,
      );
      let sum = 0;
      let max = 0;
      for (let i = 0; i < buf.length; i += 4) {
        const l = buf[i] + buf[i + 1] + buf[i + 2];
        sum += l;
        if (l > max) max = l;
      }
      resolve({ mean: sum / (span * span) / 3, max, error: glCtx.getError() });
    });
  }));
  check('particles reach the framebuffer', luma.mean > 2, `meanLuma=${luma.mean.toFixed(1)}`);
  check('image is not blown out', luma.mean < 200 && luma.max < 765,
    `mean=${luma.mean.toFixed(1)} max=${luma.max}`);

  const models = ['heart', 'dna', 'eiffel', 'jet-engine'];
  await close(page);
  for (const id of models) {
    page = await boot();
    const m = await page.evaluate(async (mid) => {
      const s = window.__stage;
      s.setModel(mid);
      s.form();
      const goal = s.time + 3;
      await new Promise((r) => { const t = () => (s.time >= goal ? r() : requestAnimationFrame(t)); t(); });
      return {
        id: s.model.id,
        parts: s.parts.length,
        particles: s.parts.reduce((a, p) => a + p.count, 0),
        assemble: s.assemble,
        error: s.gl.getError(),
      };
    }, id);
    check(`${id} assembles`, m.assemble > 0.9, `parts=${m.parts} n=${m.particles} assemble=${m.assemble.toFixed(2)}`);
    check(`${id} has no GL error`, m.error === 0, `glError=${m.error}`);
    await close(page);
  }

  const unreachable = [];
  let tested = 0;
  let correct = 0;

  for (const id of ['heart', 'dna', 'eiffel', 'jet-engine']) {
    page = await boot();
    const r = await page.evaluate(async (mid) => {
      const s = window.__stage;
      const wait = (sec) => new Promise((res) => {
        const goal = s.time + sec;
        const t = () => (s.time >= goal ? res() : requestAnimationFrame(t));
        t();
      });
      s.setModel(mid);
      s.form();
      s.toggleExplode();
      await wait(2.5);
      const w = s.canvas.clientWidth;
      const h = s.canvas.clientHeight;
      const offsets = s.explodeOffsets();
      const data = s.pickPoints.data;
      const reachable = new Set();
      let tested = 0;
      let correct = 0;
      for (const yaw of [0, 2.1, 4.2]) {
        s.camera.yaw = yaw;
        const vp = s.camera.viewProj(w / h);
        s.system.viewProj.set(vp);
        for (let i = 0; i < s.pickPoints.count; i += 37) {
          const o = i * 4;
          const g = data[o + 3] | 0;
          if (g < 0) continue;
          const off = offsets[g];
          const x = data[o] + off[0];
          const y = data[o + 1] + off[1];
          const z = data[o + 2] + off[2];
          const cw = vp[3] * x + vp[7] * y + vp[11] * z + vp[15];
          if (cw <= 1e-4) continue;
          const cx = (vp[0] * x + vp[4] * y + vp[8] * z + vp[12]) / cw;
          const cy = (vp[1] * x + vp[5] * y + vp[9] * z + vp[13]) / cw;
          if (Math.abs(cx) > 0.93 || Math.abs(cy) > 0.93) continue;
          const got = s.pick((cx * 0.5 + 0.5) * w, (1 - (cy * 0.5 + 0.5)) * h);
          tested++;
          if (got) reachable.add(got.group);
          if (got && got.group === g) correct++;
        }
      }
      const unreachable = s.parts.filter((p) => !reachable.has(p.group)).map((p) => `${mid}:${p.name}`);
      return { unreachable, accuracy: tested ? correct / tested : 0, tested };
    }, id);
    unreachable.push(...r.unreachable);
    tested += r.tested;
    correct += Math.round(r.accuracy * r.tested);
    await close(page);
  }

  const pick = { unreachable, accuracy: tested ? correct / tested : 0, tested };
  check('every part is selectable when exploded', pick.unreachable.length === 0,
    pick.unreachable.join(', ') || 'all reachable');
  check('pick accuracy above 80%', pick.accuracy > 0.8,
    `${(pick.accuracy * 100).toFixed(0)}% over ${pick.tested} samples`);

  page = await boot();
  const quality = await page.evaluate(async () => {
    const s = window.__stage;
    const before = s.budget;
    const changed = s.setBudget(6000);
    const goal = s.time + 2;
    await new Promise((r) => { const t = () => (s.time >= goal ? r() : requestAnimationFrame(t)); t(); });
    const after = { budget: s.budget, parts: s.parts.length };
    s.setBudget(before);
    return { changed, before, after };
  });
  check('budget can be rebuilt at runtime', quality.changed && quality.after.budget === 6000,
    JSON.stringify(quality.after));
  await close(page);

  check('no runtime errors', errors.length === 0, [...new Set(errors)].join(' | ') || 'clean');
} catch (err) {
  check('suite ran to completion', false, err.message);
} finally {
  await browser.close();
  server.close();
}

console.log(`\n${pass.length} passed, ${fail.length} failed`);
process.exit(fail.length ? 1 : 0);
