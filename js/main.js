import { createContext } from './gpu/gl.js';
import { Stage, resolveBudget } from './core/stage.js';
import { HandTracker } from './core/tracker.js';
import { GestureEngine } from './core/gestures.js';
import { MODELS, modelById } from './models/index.js';
import { Quiz } from './ui/quiz.js';
import { Narrator } from './ui/narrator.js';
import { clamp, damp } from './core/math.js';

const canvas = document.getElementById('gl');
const overlay = document.getElementById('overlay');
const octx = overlay.getContext('2d');
const video = document.getElementById('cam');
const gate = document.getElementById('gate');
const gateStart = document.getElementById('gateStart');
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
const btnQuiz = document.getElementById('btnQuiz');
const btnCutaway = document.getElementById('btnCutaway');
const quizPanel = document.getElementById('quizPanel');
const quizPrompt = document.getElementById('quizPrompt');
const quizOptions = document.getElementById('quizOptions');
const quizScore = document.getElementById('quizScore');
const quizFeedback = document.getElementById('quizFeedback');
const quizNext = document.getElementById('quizNext');

let stage;
let tracker;
let gestures;
let quiz;
let narrator;
let running = false;
let lastTime = performance.now();
let frames = 0;
let fpsTimer = 0;
let lastFps = 0;
let modelIndex = 0;
let openPalmLatched = false;
let fistLatched = false;
let snapLatched = false;
let inspectPart = null;
let pointedPart = null;
let twoHandSpan = null;
let lastPinchMid = null;
let lastWrist = null;
let twistReference = null;
let pendingCapture = null;

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
  if (quiz.active) startQuiz();
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
  if (part) narrator.say(`${part.name}. ${part.description}`);
}

function closePanel() {
  inspectPart = null;
  panel.hidden = true;
  stage.setHighlight(-1);
}

function startQuiz() {
  if (!stage.parts.length) return;
  quiz.start(stage.model, stage.parts);
  quizPanel.hidden = false;
  btnQuiz.classList.add('on');
  closePanel();
  setHint('Pick an answer below, or point at a card and pinch.');
}

function stopQuiz() {
  quiz.stop();
  quizPanel.hidden = true;
  btnQuiz.classList.remove('on');
  quizFeedback.textContent = '—';
  setHint('Point at a part to read what it does.');
}

function renderQuiz(state) {
  if (!state.question) return;
  quizPrompt.textContent = state.question.prompt;
  quizScore.textContent = `${state.score} / ${state.total}`;
  quizOptions.innerHTML = '';
  state.question.options.forEach((option, i) => {
    const button = document.createElement('button');
    button.textContent = option.label;
    if (state.answered) {
      button.disabled = true;
      if (option.correct) button.classList.add('correct');
      else if (option.label === state.result?.chosen) button.classList.add('wrong');
    }
    button.addEventListener('click', () => quiz.answer(i));
    quizOptions.appendChild(button);
  });
  if (state.answered) {
    quizFeedback.textContent = state.result.correct
      ? `Correct — that is the ${state.result.correctLabel}.`
      : `Not quite. That is the ${state.result.correctLabel}.`;
  } else {
    quizFeedback.textContent = state.result ? '' : 'Choose one.';
  }
}

function pointerFromHand(hand) {
  const nx = hand.center[0];
  const ny = hand.center[1];
  return {
    x: nx * window.innerWidth,
    y: ny * window.innerHeight,
  };
}

function twistAngle(hand) {
  const lm = hand.landmarks;
  const wrist = lm[0];
  const middle = lm[9];
  const index = lm[5];
  const dx = middle.x - index.x;
  const dy = middle.y - index.y;
  return Math.atan2(dy, dx);
}

function handleGestures(state, dt) {
  const { primary, secondary, pose } = state;

  if (!primary) {
    openPalmLatched = false;
    fistLatched = false;
    snapLatched = false;
    twoHandSpan = null;
    twistReference = null;
    pointedPart = null;
    lastWrist = null;
    if (inspectPart) {
      inspectPart = null;
      closePanel();
    }
    setHint('Hold your hand up to the camera.');
    return;
  }

  const pointer = pointerFromHand(primary);

  if (primary.poses.fist) {
    setHint('Fist detected — assembling.');
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
    if (part && !quiz.active) showPanelThrottled(part);
    setHint(part ? `Pointing at ${part.name} — pinch to pull it out.` : 'Point at a part to read what it does.');
  } else {
    if (pointedPart) {
      pointedPart = null;
      if (!inspectPart) stage.setHighlight(-1);
    }
  }

  if (secondary) {
    const span = Math.hypot(primary.center[0] - secondary.center[0], primary.center[1] - secondary.center[1]);
    if (twoHandSpan === null) twoHandSpan = span;
    else {
      const ratio = span / Math.max(1e-3, twoHandSpan);
      if (Math.abs(ratio - 1) > 0.012) {
        stage.camera.zoom(1 - (ratio - 1) * 0.9);
        twoHandSpan = span;
        setHint('Zooming with two hands.');
      }
    }
    const roll = twistAngle(primary) - twistAngle(secondary);
    if (twistReference === null) twistReference = roll;
    else {
      const delta = roll - twistReference;
      if (Math.abs(delta) > 0.004) {
        stage.camera.orbit(delta * 1.4, 0);
        twistReference = roll;
      }
    }
  } else {
    twoHandSpan = null;
    const roll = twistAngle(primary);
    if (twistReference === null) {
      twistReference = roll;
    } else {
      const delta = roll - twistReference;
      if (Math.abs(delta) > 0.005) {
        stage.camera.orbit(delta * 1.1, delta * 0.15);
        twistReference = roll;
      }
    }
  }

  if (lastWrist) {
    const dx = primary.center[0] - lastWrist[0];
    const dy = primary.center[1] - lastWrist[1];
    if (Math.abs(dx) > 0.0016) stage.camera.orbit(dx * 2.2, 0);
    if (Math.abs(dy) > 0.0016) stage.camera.orbit(0, -dy * 1.6);
  }
  lastWrist = [...primary.center];

  if (pose === 'pinch') {
    if (gestures.pinchStart && !gestures.pinchStart.grabbed) {
      const target = stage.pick(pointer.x, pointer.y) || pointedPart;
      if (target) {
        gestures.pinchStart.grabbed = true;
        gestures.pinchStart.part = target;
        stage.beginGrab(target.group);
        showPanel(target);
        narrator.say(`Pulling out the ${target.name}.`);
      }
    } else if (gestures.pinchStart && gestures.pinchStart.grabbed) {
      if (lastPinchMid) {
        const dx = (gestures.pinchStart.hand.pinchMid.x - lastPinchMid[0]);
        const dy = (gestures.pinchStart.hand.pinchMid.y - lastPinchMid[1]);
        const dz = (gestures.pinchStart.hand.pinchMid.z - lastPinchMid[2]);
        stage.moveGrab([dx * 6, -dy * 6, dz * 4]);
      }
      if (gestures.pinchStart.part) {
        stage.setHighlight(gestures.pinchStart.part.group);
      }
      setHint('Release the pinch to drop the part back.');
    }
  }
  lastPinchMid = primary.pinchMid ? [primary.pinchMid.x, primary.pinchMid.y, primary.pinchMid.z] : null;

  if (stage.assembleTarget < 0.9 && !fistLatched && pose === 'fist') fistLatched = true;
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
    if (snapLatched) return;
    snapLatched = true;
    setTimeout(() => { snapLatched = false; }, 700);
    stage.burst();
    narrator.say(stage.assemble > 0.5 ? 'Particles released.' : 'Forming the model.');
    setHint('Particles materialising — make a fist to assemble.');
  };

  gestures.onFist = () => {
    if (fistLatched) return;
    fistLatched = true;
    stage.form();
    narrator.say('Assembling.');
    setHint('Assembled. Open your hand to switch model or explode.');
  };

  gestures.onOpenPalm = () => {
    if (openPalmLatched) return;
    openPalmLatched = true;
    setTimeout(() => { openPalmLatched = false; }, 900);
    if (quiz.active) {
      quiz.next();
      return;
    }
    const didExplode = stage.toggleExplode();
    if (didExplode) {
      narrator.say('Exploded view.');
      setHint('Exploded view — point at any part.');
    } else {
      selectModel(modelIndex + 1, true);
    }
  };

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
      hand.pinchMid.z - start.pinchMid.z,
    ];
    stage.moveGrab([delta[0] * 8, -delta[1] * 8, delta[2] * 5]);
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
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;

  if (panelTimer > 0) panelTimer -= dt;

  const hands = tracker.poll();
  const state = gestures.update(hands, dt);
  handleGestures(state, dt);

  stage.update(dt);
  stage.render(dt);
  drawOverlay(hands, state);

  if (pendingCapture) pendingCapture(stage, stage.gl, canvas);

  frames += 1;
  fpsTimer += dt;
  if (fpsTimer >= 0.5) {
    lastFps = frames / fpsTimer;
    frames = 0;
    fpsTimer = 0;
    fpsEl.textContent = `${lastFps.toFixed(0)} fps · ${(stage.budget / 1000).toFixed(0)}k particles · ${tracker.fps.toFixed(0)} fps CV`;
  }

  requestAnimationFrame(frame);
}

async function startExperience() {
  if (running) return;
  gateStart.disabled = true;
  gateStart.textContent = 'Starting…';
  try {
    const { gl, info } = createContext(canvas);
    const budget = resolveBudget();
    stage = new Stage(canvas, gl, budget);
    window.__stage = stage;
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
    quiz = new Quiz();
    quiz.onChange = renderQuiz;
    quiz.onSpeak = (text) => narrator.say(text);

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

    await tracker.start();
    setStatus(`Tracking live · ${info.renderer}`);
    gate.classList.add('hidden');
    setHint('Snap your fingers to materialise the particles.');
  } catch (err) {
    gateStart.disabled = false;
    gateStart.textContent = 'Retry';
    gateError.hidden = false;
    gateError.textContent = err.message;
    setStatus(err.message, 'error');
    if (running) {
      running = false;
    }
    console.error(err);
  }
}

gateStart.addEventListener('click', startExperience);
btnStart.addEventListener('click', startExperience);
panelClose.addEventListener('click', closePanel);

btnNarration.addEventListener('click', () => {
  const on = !narrator.enabled;
  narrator.setEnabled(on);
  btnNarration.textContent = on ? 'Narration on' : 'Narration off';
  btnNarration.classList.toggle('on', on);
  if (on && stage?.model) narrator.say(stage.model.summary);
});

btnQuiz.addEventListener('click', () => {
  if (quiz.active) stopQuiz();
  else startQuiz();
});

btnCutaway.addEventListener('click', () => {
  stage.cutaway = !stage.cutaway;
  btnCutaway.classList.toggle('on', stage.cutaway);
  setHint(stage.cutaway ? 'Cutaway on — half the model is sliced away.' : 'Cutaway off.');
});

quizNext.addEventListener('click', () => quiz.next());

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (quiz.active) stopQuiz();
    else closePanel();
  }
});

window.addEventListener('resize', resize);
