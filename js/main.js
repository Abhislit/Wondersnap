import { createContext } from './gpu/gl.js';
import { Stage, resolveBudget } from './core/stage.js';
import { QualityController } from './core/quality.js';
import { Progress } from './core/progress.js';
import { HandTracker } from './core/tracker.js';
import { GestureEngine } from './core/gestures.js';
import { MODELS, modelById } from './models/index.js';
import { Narrator } from './ui/narrator.js';
import { clamp, damp } from './core/math.js';

const canvas = document.getElementById('gl');
const overlay = document.getElementById('overlay');
const octx = overlay.getContext('2d');
const video = document.getElementById('cam');
const gate = document.getElementById('gate');
const gateStart = document.getElementById('gateStart');
const gateExplore = document.getElementById('gateExplore');
const gateError = document.getElementById('gateError');
const btnStart = document.getElementById('btnStart');
const modelTabs = document.getElementById('modelTabs');
const statusEl = document.getElementById('status');
const fpsEl = document.getElementById('fps');
const hintEl = document.getElementById('hint');
const panel = document.getElementById('panel');
const panelTitle = document.getElementById('panelTitle');
const panelCategory = document.getElementById('panelCategory');
const panelBody = document.getElementById('panelBody');
const panelClose = document.getElementById('panelClose');
const btnNarration = document.getElementById('btnNarration');
const btnExplode = document.getElementById('btnExplode');
const btnCutaway = document.getElementById('btnCutaway');

let stage;
let tracker;
let gestures;
let quality;
let progress;
let narrator;
let running = false;
let lastTime = performance.now();
let frames = 0;
let fpsTimer = 0;
let lastFps = 0;
let modelIndex = 0;
let inspectPart = null;
let pointedPart = null;
let lastPinchMid = null;
let pendingCapture = null;
let rendererInfo = { renderer: 'unknown' };
const activePointers = new Map();
let pinchDistance = 0;

function setStatus(text, level = 'info') {
  statusEl.textContent = text;
  statusEl.classList.toggle('error', level === 'error');
}

function setHint(text) {
  hintEl.textContent = text;
  hintEl.style.opacity = text ? '1' : '0';
}

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.floor(window.innerWidth * dpr);
  const h = Math.floor(window.innerHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const dprOverlay = Math.min(window.devicePixelRatio || 1, 2);
  overlay.width = Math.floor(window.innerWidth * dprOverlay);
  overlay.height = Math.floor(window.innerHeight * dprOverlay);
  overlay.style.width = `${window.innerWidth}px`;
  overlay.style.height = `${window.innerHeight}px`;
}

function buildTabs() {
  modelTabs.innerHTML = '';
  MODELS.forEach((model, i) => {
    const button = document.createElement('button');
    button.textContent = model.name;
    button.dataset.index = String(i);
    button.addEventListener('click', () => selectModel(i, true));
    modelTabs.appendChild(button);
  });
}

function syncTabs() {
  for (const button of modelTabs.children) {
    button.classList.toggle('active', Number(button.dataset.index) === modelIndex);
  }
}

function selectModel(index, fromUser = false) {
  modelIndex = (index + MODELS.length) % MODELS.length;
  const model = MODELS[modelIndex];
  stage.setModel(model.id);
  syncTabs();
  closePanel();
  inspectPart = null;
  stage.setHighlight(-1);
  if (fromUser) {
    stage.burst();
    narrator.say(`${model.name}. ${model.summary}`);
  }
}

function showPanel(part) {
  inspectPart = part;
  stage.setHighlight(part ? part.group : -1);
  panelTitle.textContent = part ? part.name : '';
  panelCategory.textContent = part ? `${stage.model.name} · ${part.count.toLocaleString()} particles` : '';
  panelBody.textContent = part ? part.description : '';
  panel.hidden = !part;
  if (part) {
    progress?.recordExplored(stage.model.id, part.id);
    narrator.say(`${part.name}. ${part.description}`);
    refreshCompletion();
  }
}

function refreshCompletion() {
  if (!progress || !stage?.model) return;
  const part = stage.parts.find((p) => p.id === inspectPart?.id);
  if (!part) return;
  const seen = progress.exploredCount(stage.model.id);
  const total = stage.parts.length;
  panelCategory.textContent = `${stage.model.name} · ${seen} of ${total} explored`;
}

function closePanel() {
  if (!stage) return;
  inspectPart = null;
  panel.hidden = true;
  stage.setHighlight(-1);
}

function pointerDistance() {
  const points = [...activePointers.values()];
  if (points.length < 2) return 0;
  return Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
}

canvas.addEventListener('pointerdown', (event) => {
  if (!stage || (event.pointerType === 'mouse' && event.button !== 0)) return;
  canvas.setPointerCapture(event.pointerId);
  activePointers.set(event.pointerId, {
    x: event.clientX,
    y: event.clientY,
    startX: event.clientX,
    startY: event.clientY,
    moved: false,
  });
  if (activePointers.size === 2) pinchDistance = pointerDistance();
  event.preventDefault();
});

canvas.addEventListener('pointermove', (event) => {
  const pointer = activePointers.get(event.pointerId);
  if (!pointer || !stage) return;
  const dx = event.clientX - pointer.x;
  const dy = event.clientY - pointer.y;
  pointer.x = event.clientX;
  pointer.y = event.clientY;

  if (activePointers.size >= 2) {
    const nextDistance = pointerDistance();
    if (pinchDistance > 0 && nextDistance > 0) stage.camera.zoom(pinchDistance / nextDistance);
    pinchDistance = nextDistance;
    for (const active of activePointers.values()) active.moved = true;
  } else {
    if (Math.hypot(pointer.x - pointer.startX, pointer.y - pointer.startY) > 4) {
      pointer.moved = true;
    }
    if (pointer.moved) stage.camera.orbit(-dx * 0.006, -dy * 0.006);
  }
  event.preventDefault();
});

function finishPointer(event) {
  const pointer = activePointers.get(event.pointerId);
  if (!pointer) return;
  if (activePointers.size === 1 && !pointer.moved && stage) {
    const part = stage.pick(event.clientX, event.clientY);
    if (part) showPanel(part);
    else closePanel();
  }
  activePointers.delete(event.pointerId);
  if (activePointers.size < 2) pinchDistance = 0;
}

canvas.addEventListener('pointerup', finishPointer);
canvas.addEventListener('pointercancel', finishPointer);
canvas.addEventListener('wheel', (event) => {
  if (!stage) return;
  stage.camera.zoom(Math.exp(event.deltaY * 0.001));
  event.preventDefault();
}, { passive: false });

/**
 * Landmark x is measured in the camera's own frame, so a hand on the left of the
 * image reports a small x. The overlay draws the mirrored view, which is what the user
 * expects to see themselves, so the pointer has to use the same frame or pointing
 * selects whatever is on the opposite side of the model.
 */
function pointerFromHand(hand) {
  const nx = hand.center[0];
  const ny = hand.center[1];
  return {
    x: (1 - nx) * window.innerWidth,
    y: ny * window.innerHeight,
  };
}

function handleGestures(state) {
  const { primary, pose, camera } = state;

  if (!primary) {
    pointedPart = null;
    if (tracker?.running) {
      if (inspectPart) {
        inspectPart = null;
        closePanel();
      }
      setHint('Hold your hand up to the camera.');
    }
    return;
  }

  const pointer = pointerFromHand(primary);

  if (camera.yaw !== 0 || camera.pitch !== 0) {
    stage.camera.orbit(camera.yaw, camera.pitch);
  }
  if (camera.zoom !== 0) {
    stage.camera.zoom(1 - camera.zoom);
    setHint('Zooming with two hands.');
  }

  if (pose === 'point') {
    const part = stage.pick(pointer.x, pointer.y);
    if (part !== pointedPart) {
      pointedPart = part;
      if (part) {
        stage.setHighlight(part.group);
        narrator.say(part.name);
      } else {
        stage.setHighlight(-1);
      }
    }
    if (part) showPanelThrottled(part);
    setHint(part
      ? `Pointing at ${part.name} — pinch to pull it out.`
      : 'Point at a part to read what it does.');
  } else if (pointedPart) {
    pointedPart = null;
    if (!inspectPart) stage.setHighlight(-1);
  }

  if (pose === 'pinch' && gestures.pinchStart && gestures.pinchStart.grabbed) {
    if (gestures.pinchStart.part) stage.setHighlight(gestures.pinchStart.part.group);
    setHint('Release the pinch to drop the part back.');
  }

  lastPinchMid = primary.pinchMid
    ? [primary.pinchMid.x, primary.pinchMid.y, primary.pinchMid.z]
    : null;
}

let lastPanelPart = null;
let panelTimer = 0;
function showPanelThrottled(part) {
  if (panelTimer > 0) return;
  if (part === lastPanelPart && !panel.hidden) return;
  lastPanelPart = part;
  panelTimer = 1.2;
  showPanel(part);
}

function wireGestureCallbacks() {
  gestures.onSnap = () => {
    stage.burst();
    narrator.say(stage.assemble > 0.5 ? 'Particles released.' : 'Forming the model.');
    setHint('Particles materialising — make a fist to assemble.');
  };

  gestures.onFist = () => {
    stage.form();
    narrator.say('Assembling.');
    setHint('Assembled. Open your hand to switch model or explode.');
  };

  // Open palm is recognised but intentionally unbound. It used to advance to the next
  // model, which made an incidental open hand yank the scene away mid-inspection.
  gestures.onOpenPalm = null;

  gestures.onPinchStart = (hand) => {
    const pointer = pointerFromHand(hand);
    const part = stage.pick(pointer.x, pointer.y);
    gestures.pinchStart.grabbed = false;
    gestures.pinchStart.part = part;
    if (part) {
      gestures.pinchStart.grabbed = true;
      stage.beginGrab(part.group);
      showPanel(part);
      narrator.say(`Pulling out the ${part.name}.`);
    } else {
      stage.camera.setDistance(stage.camera.targetDistance * 0.7);
    }
  };

  gestures.onPinchMove = (hand) => {
    const start = gestures.pinchStart;
    if (!start || !start.grabbed || !start.part) return;
    const delta = [
      hand.pinchMid.x - start.hand.pinchMid.x,
      hand.pinchMid.y - start.hand.pinchMid.y,
      hand.pinchMid.z - start.hand.pinchMid.z,
    ];
    stage.moveGrab([-delta[0] * 8, -delta[1] * 8, delta[2] * 5]);
    start.hand = hand;
  };

  gestures.onPinchEnd = () => {
    stage.endGrab();
    if (inspectPart) stage.setHighlight(inspectPart.group);
  };
}

function drawOverlay(hands, state) {
  octx.clearRect(0, 0, overlay.width, overlay.height);
  const dpr = overlay.width / window.innerWidth;

  for (const hand of hands) {
    const points = hand.landmarks;
    const color = state.pose === 'pinch' ? '#ffd166' : state.pose === 'fist' ? '#5ce1ff' : '#b07cff';

    octx.beginPath();
    for (let i = 0; i < points.length; i++) {
      const x = (1 - points[i].x) * window.innerWidth * dpr;
      const y = points[i].y * window.innerHeight * dpr;
      if (i === 0) octx.moveTo(x, y);
      else octx.lineTo(x, y);
    }
    octx.closePath();
    octx.strokeStyle = `${color}55`;
    octx.lineWidth = 1.4 * dpr;
    octx.stroke();

    for (let i = 0; i < points.length; i++) {
      const x = (1 - points[i].x) * window.innerWidth * dpr;
      const y = points[i].y * window.innerHeight * dpr;
      octx.beginPath();
      octx.arc(x, y, (i === 4 || i === 8 ? 5.5 : 2.6) * dpr, 0, Math.PI * 2);
      octx.fillStyle = i === 4 || i === 8 ? color : `${color}cc`;
      octx.fill();
    }

    const cx = (1 - hand.center[0]) * window.innerWidth * dpr;
    const cy = hand.center[1] * window.innerHeight * dpr;
    octx.beginPath();
    octx.arc(cx, cy, 16 * dpr, 0, Math.PI * 2);
    octx.strokeStyle = `${color}88`;
    octx.lineWidth = 1.2 * dpr;
    octx.stroke();
  }

  if (hands.length === 2) {
    const a = hands[0].center;
    const b = hands[1].center;
    octx.beginPath();
    octx.moveTo((1 - a[0]) * window.innerWidth * dpr, a[1] * window.innerHeight * dpr);
    octx.lineTo((1 - b[0]) * window.innerWidth * dpr, b[1] * window.innerHeight * dpr);
    octx.strokeStyle = 'rgba(92, 225, 255, 0.5)';
    octx.lineWidth = 1.6 * dpr;
    octx.setLineDash([6 * dpr, 6 * dpr]);
    octx.stroke();
    octx.setLineDash([]);
  }
}

function frame() {
  if (!running) return;
  resize();

  const now = performance.now();
  const elapsed = (now - lastTime) / 1000;
  // The simulation needs a clamped step so a long frame cannot blow up the spring
  // integrator. Anything that *measures* must use the real elapsed time, or the fps
  // counter can never report worse than 1/clamp and hides exactly the problem it
  // exists to reveal.
  const dt = Math.min(0.05, elapsed);
  lastTime = now;

  if (panelTimer > 0) panelTimer -= dt;

  const hands = tracker.poll();
  const state = gestures.update(hands, dt);
  handleGestures(state);

  stage.update(dt);
  stage.render(dt);
  drawOverlay(hands, state);

  quality?.sample(elapsed);
  if (quality?.shouldRebuild()) {
    const next = quality.pendingBudget;
    if (stage.setBudget(next)) {
      quality.commit();
      setStatus(`Quality adjusted to ${(stage.budget / 1000).toFixed(0)}k particles`);
    } else {
      quality.commit();
    }
  }

  if (pendingCapture) pendingCapture(stage, stage.gl, canvas);

  frames += 1;
  fpsTimer += elapsed;
  if (fpsTimer >= 0.5) {
    lastFps = frames / fpsTimer;
    frames = 0;
    fpsTimer = 0;
    const mode = quality?.pinned ? 'fixed' : 'auto';
    fpsEl.textContent = `${lastFps.toFixed(0)} fps · ${(stage.budget / 1000).toFixed(0)}k particles (${mode}) · ${tracker.fps.toFixed(0)} fps CV`;
  }

  requestAnimationFrame(frame);
}

async function startExperience(withCamera = true) {
  // `running` tracks the render loop, which stays up even when the camera fails, so
  // it cannot also gate retries. The camera's own state does that.
  if (tracker?.running) return;
  gateStart.disabled = true;
  gateStart.textContent = 'Starting…';

  // Everything below the camera start is one-time setup. A retry after a camera
  // failure jumps straight to tracker.start() instead of rebuilding it all.
  if (stage) {
    if (withCamera) await startCamera();
    else enterCameraFreeMode();
    return;
  }

  try {
    // The renderer is independent of the camera, so build it once. A retry after a
    // camera failure must not stack up another Stage, context and Progress.
    if (!stage) {
      const { gl, info: glInfo } = createContext(canvas);
      const budget = resolveBudget();
      const pinned = new URLSearchParams(window.location.search).get('particles') !== null;
      quality = new QualityController({
        initialBudget: budget,
        ceiling: budget,
        pinned,
      });
      stage = new Stage(canvas, gl, budget);
      progress = new Progress();
      progress.syncRegistry(MODELS);
      rendererInfo = glInfo;
    }
    window.__stage = stage;
    window.__progress = progress;
    window.__showPanel = showPanel;
    window.__capture = (fn) => new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ timedOut: true }), 2000);
      pendingCapture = (stage, gl, cv) => {
        clearTimeout(timer);
        pendingCapture = null;
        try {
          resolve(fn(stage, gl, cv));
        } catch (err) {
          resolve({ error: err.message });
        }
      };
    });
    narrator = new Narrator();

    gestures = new GestureEngine();
    wireGestureCallbacks();

    tracker = new HandTracker(video);
    tracker.onStatus = (text, level) => {
      setStatus(text, level);
      if (level === 'error') {
        gateError.hidden = false;
        gateError.textContent = text;
      }
    };

    buildTabs();
    stage.setModel(MODELS[0].id);
    stage.burst();
    syncTabs();

    resize();
    running = true;
    lastTime = performance.now();
    requestAnimationFrame(frame);

    if (withCamera) await startCamera();
    else enterCameraFreeMode();
  } catch (err) {
    running = false;
    reportStartupFailure(err);
  }
}

function enterCameraFreeMode() {
  gate.classList.add('hidden');
  setStatus('Camera off · mouse and touch controls');
  setHint('Drag to orbit · scroll or pinch to zoom · click a part to inspect.');
}

/**
 * The camera is the only part of startup that can fail transiently, so this is the
 * only part a retry repeats. The tracker is deliberately reused across attempts: its
 * attempt counter is what makes a retried module import reach the network again
 * instead of replaying a cached rejection.
 */
async function startCamera() {
  // The render loop is independent of the camera and keeps the model on screen behind
  // the gate, so a camera failure must not stop it — otherwise a retry restores
  // tracking but leaves a frozen canvas.
  if (!running) {
    running = true;
    lastTime = performance.now();
    requestAnimationFrame(frame);
  }
  try {
    await tracker.start();
  } catch (err) {
    reportStartupFailure(err);
    return;
  }
  gateError.hidden = true;
  setStatus(`Tracking live · ${rendererInfo.renderer}`);
  gate.classList.add('hidden');
  setHint('Snap your fingers to materialise the particles.');
}

function reportStartupFailure(err) {
  gateStart.disabled = false;
  gateStart.textContent = 'Retry';
  gateError.hidden = false;
  gateError.textContent = describeStartupFailure(err);
  setStatus(describeStartupFailure(err), 'error');
  if (!['NotAllowedError', 'NotFoundError', 'NotReadableError', 'OverconstrainedError', 'InsecureContextError']
    .includes(err?.name)) console.error(err);
}

/** Turns a raw DOMException into something a person can act on. */
function describeStartupFailure(err) {
  const name = err?.name || '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Camera permission was denied. Allow it in the browser address bar, then press Retry. '
      + 'You can still use the model tabs and buttons without a camera.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'No camera was found. Connect one and press Retry, or use the tabs and buttons.';
  }
  if (name === 'NotReadableError') {
    return 'The camera is in use by another application. Close it and press Retry.';
  }
  if (name === 'InsecureContextError') {
    return 'A camera is only available over https, or on localhost. You opened the app over '
      + 'a plain http:// address on another machine, so the browser blocked the camera. '
      + 'Open it on localhost, or put it behind an https tunnel, then reload.';
  }
  if (/webgl/i.test(err?.message || '')) {
    return `${err.message} Try a browser with WebGL2 and hardware acceleration enabled.`;
  }
  if (/fetch|network|Failed to load/i.test(err?.message || '')) {
    return `${err.message} Run ./setup.sh to fetch the MediaPipe runtime, then reload.`;
  }
  return err?.message || 'Something went wrong starting the app.';
}

gateStart.addEventListener('click', startExperience);
gateExplore.addEventListener('click', () => startExperience(false));
btnStart.addEventListener('click', startExperience);
panelClose.addEventListener('click', closePanel);

btnNarration.addEventListener('click', () => {
  if (!narrator) return;
  const on = !narrator.enabled;
  narrator.setEnabled(on);
  btnNarration.textContent = on ? 'Narration on' : 'Narration off';
  btnNarration.classList.toggle('on', on);
  if (on && stage?.model) narrator.say(stage.model.summary);
});

function toggleExplodedView() {
  const on = stage.toggleExplode();
  btnExplode.classList.toggle('on', on);
  btnExplode.textContent = on ? 'Collapse view' : 'Exploded view';
  if (on) {
    narrator.say('Exploded view.');
    setHint('Exploded view — point at any part.');
  } else {
    setHint('Assembled.');
  }
  return on;
}

btnExplode.addEventListener('click', toggleExplodedView);

btnCutaway.addEventListener('click', () => {
  if (!stage) return;
  stage.cutaway = !stage.cutaway;
  btnCutaway.classList.toggle('on', stage.cutaway);
  setHint(stage.cutaway ? 'Cutaway on — half the model is sliced away.' : 'Cutaway off.');
});


window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closePanel();
});

window.addEventListener('resize', resize);

canvas.addEventListener('webglcontextlost', (event) => {
  event.preventDefault();
  if (running) running = false;
  setStatus('Graphics context lost. Waiting for the browser to restore it…', 'error');
  overlay.style.opacity = '0';
});

canvas.addEventListener('webglcontextrestored', () => {
  setStatus('Graphics context restored. Reload the page to continue.', 'error');
  overlay.style.opacity = '1';
  running = false;
});
