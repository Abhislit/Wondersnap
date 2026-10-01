export const LANDMARK = {
  WRIST: 0,
  THUMB_CMC: 1, THUMB_MCP: 2, THUMB_IP: 3, THUMB_TIP: 4,
  INDEX_MCP: 5, INDEX_PIP: 6, INDEX_DIP: 7, INDEX_TIP: 8,
  MIDDLE_MCP: 9, MIDDLE_PIP: 10, MIDDLE_DIP: 11, MIDDLE_TIP: 12,
  RING_MCP: 13, RING_PIP: 14, RING_DIP: 15, RING_TIP: 16,
  PINKY_MCP: 17, PINKY_PIP: 18, PINKY_DIP: 19, PINKY_TIP: 20,
};

const FINGERS = [
  { name: 'thumb', mcp: LANDMARK.THUMB_MCP, pip: LANDMARK.THUMB_IP, tip: LANDMARK.THUMB_TIP, base: LANDMARK.THUMB_CMC },
  { name: 'index', mcp: LANDMARK.INDEX_MCP, pip: LANDMARK.INDEX_PIP, tip: LANDMARK.INDEX_TIP, base: LANDMARK.WRIST },
  { name: 'middle', mcp: LANDMARK.MIDDLE_MCP, pip: LANDMARK.MIDDLE_PIP, tip: LANDMARK.MIDDLE_TIP, base: LANDMARK.WRIST },
  { name: 'ring', mcp: LANDMARK.RING_MCP, pip: LANDMARK.RING_PIP, tip: LANDMARK.RING_TIP, base: LANDMARK.WRIST },
  { name: 'pinky', mcp: LANDMARK.PINKY_MCP, pip: LANDMARK.PINKY_PIP, tip: LANDMARK.PINKY_TIP, base: LANDMARK.WRIST },
];

const STRAIGHT_RATIO = 1.06;
const REACH_RATIO = 1.3;
const PINCH_DISTANCE = 0.45;
const HISTORY_TTL_MS = 1200;
const HISTORY_LIMIT = 48;
const SNAP_SAMPLES = 7;
const SNAP_MIN_SPAN_MS = 22;
const SNAP_TIGHT_RATIO = 0.34;
const SNAP_MIN_RATE = 0.0018;

function dist3(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, (a.z - b.z) * 0.6);
}

function dist2(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function handScale(lm) {
  const span = dist3(lm[LANDMARK.WRIST], lm[LANDMARK.MIDDLE_MCP]);
  return Math.max(1e-3, span);
}

export function palmNormal(lm) {
  const v1 = [
    lm[LANDMARK.INDEX_MCP].x - lm[LANDMARK.WRIST].x,
    lm[LANDMARK.INDEX_MCP].y - lm[LANDMARK.WRIST].y,
    lm[LANDMARK.INDEX_MCP].z - lm[LANDMARK.WRIST].z,
  ];
  const v2 = [
    lm[LANDMARK.PINKY_MCP].x - lm[LANDMARK.WRIST].x,
    lm[LANDMARK.PINKY_MCP].y - lm[LANDMARK.WRIST].y,
    lm[LANDMARK.PINKY_MCP].z - lm[LANDMARK.WRIST].z,
  ];
  const n = [
    v1[1] * v2[2] - v1[2] * v2[1],
    v1[2] * v2[0] - v1[0] * v2[2],
    v1[0] * v2[1] - v1[1] * v2[0],
  ];
  const l = Math.hypot(n[0], n[1], n[2]) || 1;
  return [n[0] / l, n[1] / l, n[2] / l];
}

export function analyzeHand(handedness, lm) {
  const scale = handScale(lm);
  const wrist = lm[LANDMARK.WRIST];
  const palm = [wrist, lm[LANDMARK.INDEX_MCP], lm[LANDMARK.PINKY_MCP]];

  const fingers = FINGERS.map((f) => {
    const tipReach = dist3(wrist, lm[f.tip]);
    const pipReach = dist3(wrist, lm[f.pip]);
    const mcpReach = dist3(wrist, lm[f.mcp]);
    const straightness = tipReach / Math.max(1e-4, pipReach);
    const extension = tipReach / Math.max(1e-4, mcpReach);
    const extended = straightness > STRAIGHT_RATIO && extension > REACH_RATIO;
    return { name: f.name, straightness, extension, extended, curl: !extended };
  });

  const byName = Object.fromEntries(fingers.map((f) => [f.name, f]));
  const pinchDistance = dist3(lm[LANDMARK.THUMB_TIP], lm[LANDMARK.INDEX_TIP]) / scale;
  const thumbIndexChord = dist2(lm[LANDMARK.THUMB_TIP], lm[LANDMARK.INDEX_TIP]) / scale;

  const extendedCount = fingers.filter((f) => f.name !== 'thumb' && f.extended).length;
  const othersCurled = ['middle', 'ring', 'pinky'].every((n) => byName[n].curl);

  const pinch = pinchDistance < PINCH_DISTANCE;
  const fist = !pinch && extendedCount === 0 && byName.index.curl;
  const point = !pinch && !fist && byName.index.extended && othersCurled;
  const openPalm = !pinch && !fist && extendedCount >= 4;

  const palmSize = scale;
  return {
    landmarks: lm,
    handedness,
    handednessLabel: handedness?.[0]?.categoryName || 'Right',
    score: handedness?.[0]?.score ?? 0,
    scale: palmSize,
    center: [
      (palm[0].x + palm[1].x + palm[2].x) / 3,
      (palm[0].y + palm[1].y + palm[2].y) / 3,
      (palm[0].z + palm[1].z + palm[2].z) / 3,
    ],
    normal: palmNormal(lm),
    fingers,
    extendedCount,
    pinchDistance,
    thumbIndexChord,
    poses: { openPalm, fist, point, pinch },
    tip: lm[LANDMARK.MIDDLE_TIP],
    indexTip: lm[LANDMARK.INDEX_TIP],
    pinchMid: {
      x: (lm[LANDMARK.THUMB_TIP].x + lm[LANDMARK.INDEX_TIP].x) / 2,
      y: (lm[LANDMARK.THUMB_TIP].y + lm[LANDMARK.INDEX_TIP].y) / 2,
      z: (lm[LANDMARK.THUMB_TIP].z + lm[LANDMARK.INDEX_TIP].z) / 2,
    },
  };
}

export class GestureEngine {
  constructor() {
    this.history = [];
    this.snapCooldown = -Infinity;
    this.pinchStart = null;
    this.armedSnap = false;
    this.lastPose = 'none';
    this.poseStreak = 0;
    this.onSnap = null;
    this.onFist = null;
    this.onOpenPalm = null;
    this.onPinchStart = null;
    this.onPinchMove = null;
    this.onPinchEnd = null;
  }

  reset() {
    this.history.length = 0;
    this.pinchStart = null;
  }

  remember(hand) {
    const now = performance.now();
    this.history.push({
      t: now,
      pinchDistance: hand.pinchDistance,
      pinchMid: hand.pinchMid,
      center: hand.center,
      normal: hand.normal,
    });
    while (this.history.length && now - this.history[0].t > HISTORY_TTL_MS) this.history.shift();
    if (this.history.length > HISTORY_LIMIT) {
      this.history.splice(0, this.history.length - HISTORY_LIMIT);
    }
  }

  detectSnap(hand) {
    const now = performance.now();
    if (now - this.snapCooldown < 550) return false;

    const samples = this.history.length > SNAP_SAMPLES
      ? this.history.slice(this.history.length - SNAP_SAMPLES)
      : this.history;
    if (samples.length < 3) return false;

    const oldest = samples[0];
    const newest = samples[samples.length - 1];
    const span = newest.t - oldest.t;
    if (span < SNAP_MIN_SPAN_MS) return false;

    let minD = Infinity;
    for (const h of samples) minD = Math.min(minD, h.pinchDistance);

    const closedEnough = minD < SNAP_TIGHT_RATIO;
    const rate = (oldest.pinchDistance - newest.pinchDistance) / span;
    const fastEnough = rate > SNAP_MIN_RATE;

    if (closedEnough && fastEnough) {
      this.snapCooldown = now;
      return true;
    }
    return false;
  }

  pinchVelocity() {
    if (this.history.length < 2) return [0, 0];
    const a = this.history[0];
    const b = this.history[this.history.length - 1];
    const dt = Math.max(1, b.t - a.t) / 1000;
    return [(b.pinchMid.x - a.pinchMid.x) / dt, (b.pinchMid.y - a.pinchMid.y) / dt];
  }

  update(hands, dt) {
    const now = performance.now();
    const primary = hands[0] || null;
    const secondary = hands[1] || null;

    if (!primary) {
      if (this.pinchStart) this.releasePinch();
      this.poseStreak = 0;
      this.lastPose = 'none';
      return { primary, secondary, pose: 'none' };
    }

    this.remember(primary);

    if (this.detectSnap(primary) && this.onSnap) this.onSnap(primary);

    let pose = 'neutral';
    if (primary.poses.fist) pose = 'fist';
    else if (primary.poses.pinch) pose = 'pinch';
    else if (primary.poses.point) pose = 'point';
    else if (primary.poses.openPalm) pose = 'openPalm';

    if (pose === this.lastPose) this.poseStreak += dt;
    else {
      this.lastPose = pose;
      this.poseStreak = 0;
    }

    if (pose === 'fist' && this.poseStreak > 0.28 && this.onFist) {
      this.onFist(primary);
      this.poseStreak = -1.0;
    }

    if (pose === 'openPalm' && this.poseStreak > 0.4 && this.onOpenPalm) {
      this.onOpenPalm(primary);
      this.poseStreak = -1.0;
    }

    if (pose === 'pinch') {
      if (!this.pinchStart) {
        this.pinchStart = { hand: primary, at: now };
        if (this.onPinchStart) this.onPinchStart(primary);
      } else if (this.onPinchMove) {
        this.onPinchMove(primary, this.pinchVelocity());
      }
    } else if (this.pinchStart) {
      this.releasePinch();
    }

    return { primary, secondary, pose };
  }

  releasePinch() {
    this.pinchStart = null;
    if (this.onPinchEnd) this.onPinchEnd();
  }
}
