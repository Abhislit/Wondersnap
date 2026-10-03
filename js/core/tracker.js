import { analyzeHand } from './gestures.js';

const WASM_PATH = new URL('../../vendor/mediapipe', import.meta.url).href;
const MODEL_PATH = new URL('../../vendor/mediapipe/hand_landmarker.task', import.meta.url).href;

export class HandTracker {
  constructor(video) {
    this.video = video;
    this.landmarker = null;
    this.stream = null;
    this.running = false;
    this.lastVideoTime = -1;
    this.hands = [];
    this.fps = 0;
    this.lastFrameStamp = 0;
    this.attempts = 0;
    this.onHands = null;
    this.onStatus = null;
  }

  status(text, level = 'info') {
    if (this.onStatus) this.onStatus(text, level);
  }

  async start() {
    if (this.running) return;

    // A previous attempt may still hold the device: browsers report the camera as
    // busy when the same page keeps a live track, so release before asking again.
    this.stop();
    this.attempts += 1;

    if (!navigator.mediaDevices?.getUserMedia) {
      const err = new Error('This browser will not open a camera on this address.');
      err.name = 'InsecureContextError';
      throw err;
    }

    this.status('Requesting camera…');
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
      audio: false,
    });

    // From here the camera is live. Any failure below must release it, or the user is
    // left with an illuminated camera and a device the next attempt cannot reopen.
    try {
      this.video.srcObject = this.stream;
      await this.video.play();

      this.status('Loading hand tracking model…');
      // A failed dynamic import is cached against its exact URL for the life of the
      // document, so a plain retry after a transient network error would re-throw the
      // same rejection forever. The query makes each attempt a distinct module.
      const vision = await import(`${WASM_PATH}/vision_bundle.mjs?attempt=${this.attempts}`);
      const fileset = await vision.FilesetResolver.forVisionTasks(`${WASM_PATH}`);
      this.landmarker = await vision.HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_PATH, delegate: 'GPU' },
        runningMode: 'VIDEO',
        numHands: 2,
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
    } catch (err) {
      this.stop();
      throw err;
    }

    this.running = true;
    this.status('Tracking live');
  }

  stop() {
    this.running = false;
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
    if (this.video) this.video.srcObject = null;
    this.landmarker = null;
    this.lastVideoTime = -1;
    this.hands = [];
    this.fps = 0;
  }

  poll() {
    if (!this.running || !this.landmarker) return this.hands;
    if (this.video.readyState < 2) return this.hands;
    if (this.video.currentTime === this.lastVideoTime) return this.hands;
    this.lastVideoTime = this.video.currentTime;

    const now = performance.now();
    if (this.lastFrameStamp) {
      const dt = now - this.lastFrameStamp;
      this.fps = this.fps * 0.85 + (1000 / Math.max(1, dt)) * 0.15;
    }
    this.lastFrameStamp = now;

    let result;
    try {
      result = this.landmarker.detectForVideo(this.video, now);
    } catch (err) {
      this.status(`Tracking error: ${err.message}`, 'error');
      return this.hands;
    }

    const hands = [];
    for (let i = 0; i < result.landmarks.length; i++) {
      const raw = result.landmarks[i];
      const handedness = result.handedness?.[i] || result.handednesses?.[i];
      const landmarks = raw.map((p) => ({ x: p.x, y: p.y, z: p.z }));
      hands.push(analyzeHand(handedness, landmarks));
    }
    hands.sort((a, b) => a.center[2] - b.center[2]);
    this.hands = hands;
    if (this.onHands) this.onHands(hands);
    return hands;
  }
}
