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
const DEFAULT_PORT = Number(process.env.PORT || 8799);

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

const PORT = await new Promise((resolve, reject) => {
  const startListening = () => server.listen(DEFAULT_PORT, () => resolve(server.address().port));
  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE' && !process.env.PORT) {
      server.removeAllListeners('error');
      server.listen(0, () => resolve(server.address().port));
      return;
    }
    reject(err);
  });
  startListening();
});

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

/**
 * Boots the app with the camera replaced by synthetic landmarks and exercises pointing
 * and pinch-drag through the real frame loop.
 *
 * Landmark x is in the camera's own frame while the overlay draws the mirrored view, so
 * "where the hand is drawn" and "where the pointer is sent" are separate quantities. This
 * asserts they agree, which is the invariant that makes pointing feel right.
 */
async function runGestureSuite() {
  const page = await boot();
  try {
    await page.evaluate(async () => {
      const tracker = await import('/js/core/tracker.js');
      const gestures = await import('/js/core/gestures.js');
      const fixtures = await import('/tests/fixtures/hands.mjs');
      tracker.HandTracker.prototype.poll = function poll() {
        const spec = window.__synthetic;
        if (!spec) return [];
        const lm = fixtures.buildHand(spec.pose);
        if (spec.pinch) lm[4] = { ...lm[8], x: lm[8].x + 0.02, y: lm[8].y };
        if (typeof spec.shiftX === 'number') {
          for (const p of lm) p.x = p.x * 0.4 + spec.shiftX * 0.6;
        }
        return [gestures.analyzeHand(fixtures.HANDEDNESS[0], lm)];
      };
      // Exposed so the assertions below can build the same hand without shipping
      // functions across the CDP boundary.
      window.__fx = fixtures;
      window.__analyzeHand = gestures.analyzeHand;
    });

    const result = await page.evaluate(async () => {
      const fx = window.__fx;
      const s = window.__stage;
      const frames = (n) => new Promise((resolve) => {
        let i = 0;
        const tick = () => (++i >= n ? resolve() : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      });
      // Bounded by wall-clock as well as stage time: if the frame loop dies from an
      // exception, s.time stops advancing and a time-based wait would hang the suite.
      const settle = async (sec) => {
        const goal = s.time + sec;
        const deadline = performance.now() + sec * 1000 + 3000;
        while (s.time < goal && performance.now() < deadline) {
          await new Promise((r) => requestAnimationFrame(r));
        }
        return s.time >= goal;
      };

      s.setModel('heart');
      s.form();
      s.idleSpin = 0;
      await settle(2);

      // Record the pointer the app actually sends, so the assertion is about app
      // behaviour rather than a reimplementation of it.
      const sent = [];
      const realPick = s.pick.bind(s);
      s.pick = (x, y, tol) => { sent.push(x); return realPick(x, y, tol); };

      // --- pointing -------------------------------------------------------------
      let pointMismatches = 0;
      let pointSamples = 0;
      for (const camX of [0.2, 0.35, 0.5, 0.65, 0.8]) {
        window.__synthetic = { pose: fx.POSES.point, shiftX: camX };
        // Moving the hand also orbits the camera, so let it settle before comparing.
        await settle(1.2);
        sent.length = 0;

        const lm = fx.buildHand(fx.POSES.point);
        for (const p of lm) p.x = p.x * 0.4 + camX * 0.6;
        const hand = window.__analyzeHand(fx.HANDEDNESS[0], lm);
        const drawnAt = (1 - hand.center[0]) * window.innerWidth;

        await frames(10);
        pointSamples += 1;
        // The pointer must be sent exactly where the skeleton is drawn.
        if (!sent.length || Math.abs(sent[sent.length - 1] - drawnAt) > 1) pointMismatches += 1;
      }

      // --- pinch-drag ------------------------------------------------------------
      window.__synthetic = { pose: fx.POSES.point, shiftX: 0.5, pinch: true };
      await settle(1.5);

      let hitX = null;
      for (let x = 200; x < 1100 && hitX === null; x += 2) {
        if (s.pick(x, window.innerHeight / 2, 30)) hitX = x;
      }
      const dragError = hitX === null ? 'no part found to drag' : null;
      let dragFollows = false;
      let dragWorldDx = 0;

      if (hitX !== null) {
        window.__synthetic = { pose: fx.POSES.point, shiftX: 1 - hitX / window.innerWidth, pinch: true };
        let grabbed = false;
        const deadline = performance.now() + 8000;
        while (!grabbed && performance.now() < deadline) {
          await new Promise((r) => requestAnimationFrame(r));
          grabbed = s.grab > 0 && s.grabGroup >= 0;
        }
        if (!grabbed) {
          return {
            pointMismatches,
            pointSamples,
            dragError: 'pinch never grabbed a part (frame loop may have stopped)',
            dragFollows,
            dragWorldDx,
          };
        }

        // Establish which way world +x points on screen instead of assuming it.
        const vp = s.system.viewProj;
        const c = s.parts[s.grabGroup].center;
        const project = (wx, wy, wz) => {
          const cw = vp[3] * wx + vp[7] * wy + vp[11] * wz + vp[15];
          return ((vp[0] * wx + vp[4] * wy + vp[8] * wz + vp[12]) / cw * 0.5 + 0.5)
            * s.canvas.clientWidth;
        };
        const plusXIsScreenRight = project(c[0] + 0.5, c[1], c[2]) > project(c[0], c[1], c[2]);

        const before = s.grabTarget[0];
        const startX = 1 - hitX / window.innerWidth;
        const dir = plusXIsScreenRight ? -1 : 1;
        for (let i = 1; i <= 20; i += 1) {
          window.__synthetic = { pose: fx.POSES.point, shiftX: startX + dir * 0.12 * (i / 20), pinch: true };
          await new Promise((r) => requestAnimationFrame(r));
        }
        await settle(0.5);
        dragWorldDx = +(s.grabTarget[0] - before).toFixed(3);
        dragFollows = plusXIsScreenRight ? dragWorldDx > 0 : dragWorldDx < 0;
      }

      window.__synthetic = null;
      return { pointMismatches, pointSamples, dragError, dragFollows, dragWorldDx };
    });

    // A thrown handler inside the frame loop stops the loop dead, so a page that is
    // still animating proves no exception escaped.
    const alive = await page.evaluate(async () => {
      const s = window.__stage;
      const t0 = s.time;
      await new Promise((r) => setTimeout(r, 600));
      return s.time > t0;
    });
    if (!alive) result.dragError = result.dragError || 'frame loop stopped';

    return result;
  } finally {
    await close(page);
  }
}

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

  /**
   * Gesture routing, driven through the real frame loop. Synthetic hands replace the
   * camera, so these cover the wiring between the classifier and the stage — the part
   * of the app where a wrong axis or a bad property reference is invisible to unit
   * tests but breaks pointing and dragging outright.
   */
  const gestures = await runGestureSuite();
  check('pointing selects the part under the drawn hand',
    gestures.pointMismatches === 0,
    `${gestures.pointMismatches}/${gestures.pointSamples} positions wrong`);
  check('pinch-drag does not throw', gestures.dragError === null, gestures.dragError || 'clean');
  check('pinch-drag moves the part with the hand', gestures.dragFollows === true,
    `worldDx=${gestures.dragWorldDx} partFollowsHand=${gestures.dragFollows}`);

  check('no runtime errors', errors.length === 0, [...new Set(errors)].join(' | ') || 'clean');
} catch (err) {
  check('suite ran to completion', false, err.message);
} finally {
  await browser.close();
  server.close();
}

console.log(`\n${pass.length} passed, ${fail.length} failed`);
process.exit(fail.length ? 1 : 0);
