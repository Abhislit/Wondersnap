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

export const DEFAULT_TUNING = Object.freeze({
  STRAIGHT_RATIO: 1.08,
  REACH_RATIO: 1.2,
  PINCH_DISTANCE: 0.5,

  HISTORY_TTL_MS: 1200,
  HISTORY_LIMIT: 48,
  SNAP_SAMPLES: 7,
  SNAP_MIN_SPAN_MS: 22,
  SNAP_TIGHT_RATIO: 0.38,
  SNAP_MIN_RATE: 0.0018,
  SNAP_COOLDOWN_MS: 550,

  ENTER_FRAMES: 3,
  EXIT_FRAMES: 4,
  FIST_COOLDOWN_MS: 700,
  PALM_COOLDOWN_MS: 900,

  TWIST_DEADZONE: 0.035,
  TWIST_GAIN: 1.1,
  TWIST_TILT_GAIN: 0.15,
  ORBIT_DEADZONE: 0.0016,
  ORBIT_YAW_GAIN: 2.2,
  ORBIT_PITCH_GAIN: 1.6,

  ZOOM_DEADZONE: 0.012,
  ZOOM_GAIN: 0.9,
  ZOOM_REFERENCE_SPAN: 0.28,
});

function dist3(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, (a.z - b.z) * 0.6);
}

function dist2(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function handScale(lm) {
  return Math.max(1e-3, dist3(lm[LANDMARK.WRIST], lm[LANDMARK.MIDDLE_MCP]));
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

/**
 * Palm roll angle in screen space, from the knuckle line. This is the same signal a
 * wrist twist produces, and it is what the twist gesture integrates.
 */
export function palmRoll(lm) {
  return Math.atan2(
    lm[LANDMARK.MIDDLE_MCP].y - lm[LANDMARK.INDEX_MCP].y,
    lm[LANDMARK.MIDDLE_MCP].x - lm[LANDMARK.INDEX_MCP].x,
  );
}

function wrapAngle(a) {
  let v = a;
  while (v > Math.PI) v -= Math.PI * 2;
  while (v < -Math.PI) v += Math.PI * 2;
  return v;
}

/**
 * Classifies one hand. Returns raw ratios alongside the derived poses, so the tuning
 * harness can plot the underlying signal instead of only the boolean it produced.
 */
export function analyzeHand(handedness, lm, tuning = DEFAULT_TUNING) {
  const scale = handScale(lm);
  const wrist = lm[LANDMARK.WRIST];
  const palm = [wrist, lm[LANDMARK.INDEX_MCP], lm[LANDMARK.PINKY_MCP]];

  const fingers = FINGERS.map((f) => {
    const tipReach = dist3(wrist, lm[f.tip]);
    const pipReach = dist3(wrist, lm[f.pip]);
    const mcpReach = dist3(wrist, lm[f.mcp]);
    const straightness = tipReach / Math.max(1e-4, pipReach);
    const extension = tipReach / Math.max(1e-4, mcpReach);
    const extended = straightness > tuning.STRAIGHT_RATIO && extension > tuning.REACH_RATIO;
    return { name: f.name, straightness, extension, extended, curl: !extended };
  });

  const byName = Object.fromEntries(fingers.map((f) => [f.name, f]));
  const pinchDistance = dist3(lm[LANDMARK.THUMB_TIP], lm[LANDMARK.INDEX_TIP]) / scale;
  const thumbIndexChord = dist2(lm[LANDMARK.THUMB_TIP], lm[LANDMARK.INDEX_TIP]) / scale;

  const extendedCount = fingers.filter((f) => f.name !== 'thumb' && f.extended).length;
  const othersCurled = ['middle', 'ring', 'pinky'].every((n) => byName[n].curl);
  const thumbOpen = byName.thumb.extended;

  const pinch = pinchDistance < tuning.PINCH_DISTANCE;
  const fist = !pinch && extendedCount === 0 && byName.index.curl;
  const point = !pinch && !fist && byName.index.extended && othersCurled;
  const openPalm = !pinch && !fist && thumbOpen && extendedCount >= 3;

  return {
    landmarks: lm,
    handedness,
    handednessLabel: handedness?.[0]?.categoryName || 'Right',
    score: handedness?.[0]?.score ?? 0,
    scale,
    center: [
      (palm[0].x + palm[1].x + palm[2].x) / 3,
      (palm[0].y + palm[1].y + palm[2].y) / 3,
      (palm[0].z + palm[1].z + palm[2].z) / 3,
    ],
    normal: palmNormal(lm),
    roll: palmRoll(lm),
    fingers,
    byName,
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

/** Pose names in priority order. A hand matches at most one. */
export const POSE_ORDER = ['pinch', 'fist', 'point', 'openPalm', 'neutral'];

export function classifyPose(hand) {
  for (const name of POSE_ORDER) {
    if (hand.poses[name]) return name;
  }
  return 'neutral';
}

export class GestureEngine {
  constructor(tuning = DEFAULT_TUNING) {
    this.tuning = { ...tuning };
    this.history = [];
    this.snapCooldown = -Infinity;

    this.activePose = 'neutral';
    this.poseCandidate = 'neutral';
    this.candidateFrames = 0;
    this.missingFrames = 0;
    this.poseSince = performance.now();
    this.lastFist = -Infinity;
    this.lastPalm = -Infinity;

    this.pinchStart = null;
    this.rollReference = null;
    this.twoHandReference = null;
    this.secondaryRollReference = null;

    this.onSnap = null;
    this.onFist = null;
    this.onOpenPalm = null;
    this.onPinchStart = null;
    this.onPinchMove = null;
    this.onPinchEnd = null;
    this.onLostHands = null;
  }

  setTuning(patch) {
    Object.assign(this.tuning, patch);
    return this.tuning;
  }

  reset() {
    this.history.length = 0;
    this.rollReference = null;
    this.twoHandReference = null;
    this.secondaryRollReference = null;
    if (this.pinchStart) this.releasePinch();
    this.activePose = 'neutral';
    this.poseCandidate = 'neutral';
    this.candidateFrames = 0;
  }

  remember(hand) {
    const now = performance.now();
    this.history.push({
      t: now,
      pinchDistance: hand.pinchDistance,
      pinchMid: hand.pinchMid,
      center: hand.center,
      roll: hand.roll,
      normal: hand.normal,
    });
    while (this.history.length && now - this.history[0].t > this.tuning.HISTORY_TTL_MS) {
      this.history.shift();
    }
    if (this.history.length > this.tuning.HISTORY_LIMIT) {
      this.history.splice(0, this.history.length - this.tuning.HISTORY_LIMIT);
    }
  }

  /**
   * A snap is the thumb-index distance closing fast AND tight. A hand merely held open
   * never satisfies both halves, which is what keeps false positives down.
   */
  detectSnap(hand) {
    const now = performance.now();
    if (now - this.snapCooldown < this.tuning.SNAP_COOLDOWN_MS) return false;

    const samples = this.history.length > this.tuning.SNAP_SAMPLES
      ? this.history.slice(this.history.length - this.tuning.SNAP_SAMPLES)
      : this.history;
    if (samples.length < 3) return false;

    const oldest = samples[0];
    const newest = samples[samples.length - 1];
    const span = newest.t - oldest.t;
    if (span < this.tuning.SNAP_MIN_SPAN_MS) return false;

    let minD = Infinity;
    for (const h of samples) minD = Math.min(minD, h.pinchDistance);

    const closedEnough = minD < this.tuning.SNAP_TIGHT_RATIO;
    const rate = (oldest.pinchDistance - newest.pinchDistance) / span;
    const fastEnough = rate > this.tuning.SNAP_MIN_RATE;

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

  /** Apply hysteresis: a pose must persist before it activates and persist absent before it clears. */
  resolvePose(raw, present) {
    if (!present) {
      this.missingFrames += 1;
      this.candidateFrames = 0;
      if (this.missingFrames >= this.tuning.EXIT_FRAMES && this.activePose !== 'neutral') {
        this.activePose = 'neutral';
        this.poseSince = performance.now();
      }
      return this.activePose;
    }

    this.missingFrames = 0;
    if (raw === this.activePose) {
      this.poseCandidate = raw;
      this.candidateFrames = 0;
      return this.activePose;
    }

    if (raw === this.poseCandidate) this.candidateFrames += 1;
    else {
      this.poseCandidate = raw;
      this.candidateFrames = 1;
    }

    if (this.candidateFrames >= this.tuning.ENTER_FRAMES) {
      this.activePose = raw;
      this.poseCandidate = raw;
      this.candidateFrames = 0;
      this.poseSince = performance.now();
    }
    return this.activePose;
  }

  update(hands, dt) {
    const primary = hands[0] || null;
    const secondary = hands[1] || null;

    if (!primary) {
      if (this.pinchStart) this.releasePinch();
      this.poseCandidate = 'neutral';
      this.candidateFrames = 0;
      this.missingFrames += 1;
      if (this.missingFrames >= this.tuning.EXIT_FRAMES && this.activePose !== 'neutral') {
        this.activePose = 'neutral';
        this.poseSince = performance.now();
      }
      this.rollReference = null;
      this.twoHandReference = null;
      this.secondaryRollReference = null;
      if (this.onLostHands) this.onLostHands();
      return {
        primary: null, secondary: null, pose: 'neutral',
        camera: { yaw: 0, pitch: 0, zoom: 0 },
        poseChanged: false, handCount: 0,
      };
    }

    this.remember(primary);

    if (this.detectSnap(primary) && this.onSnap) this.onSnap(primary);

    const raw = classifyPose(primary);
    const previous = this.activePose;
    const pose = this.resolvePose(raw, true);

    const now = performance.now();
    if (pose !== previous) {
      if (pose === 'fist' && now - this.lastFist > this.tuning.FIST_COOLDOWN_MS) {
        this.lastFist = now;
        if (this.onFist) this.onFist(primary);
      }
      if (pose === 'openPalm' && now - this.lastPalm > this.tuning.PALM_COOLDOWN_MS) {
        this.lastPalm = now;
        if (this.onOpenPalm) this.onOpenPalm(primary);
      }
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

    return {
      primary,
      secondary,
      pose,
      rawPose: raw,
      poseChanged: pose !== previous,
      handCount: hands.length,
      camera: this.cameraDelta(primary, secondary),
      pinchMid: primary.pinchMid,
    };
  }

  /**
   * Continuous camera axes. Twist integrates palm roll past a deadzone, so a small
   * wobble does not rotate the model, and two hands convert span change into a zoom
   * factor. Both are first-class here rather than open-coded in the frame loop.
   */
  cameraDelta(primary, secondary) {
    const t = this.tuning;
    const camera = { yaw: 0, pitch: 0, zoom: 0 };

    if (this.rollReference === null) this.rollReference = primary.roll;
    const rollDelta = wrapAngle(primary.roll - this.rollReference);
    if (Math.abs(rollDelta) > t.TWIST_DEADZONE) {
      camera.yaw = rollDelta * t.TWIST_GAIN;
      camera.pitch = rollDelta * t.TWIST_TILT_GAIN;
      this.rollReference = primary.roll;
    }

    if (secondary) {
      const span = Math.hypot(
        primary.center[0] - secondary.center[0],
        primary.center[1] - secondary.center[1],
      );
      if (this.twoHandReference === null) this.twoHandReference = span;
      const ratio = span / Math.max(1e-3, this.twoHandReference);
      if (Math.abs(ratio - 1) > t.ZOOM_DEADZONE) {
        camera.zoom = (ratio - 1) * t.ZOOM_GAIN;
        this.twoHandReference = span;
      }
    } else {
      this.twoHandReference = null;
    }

    if (secondary) {
      if (this.secondaryRollReference === null) this.secondaryRollReference = secondary.roll;
      const relative = wrapAngle(primary.roll - secondary.roll);
      if (Math.abs(relative) > t.TWIST_DEADZONE) {
        camera.yaw += relative * t.TWIST_GAIN * 0.6;
        this.secondaryRollReference = secondary.roll;
      }
    } else {
      this.secondaryRollReference = null;
    }

    if (this.history.length >= 2) {
      const a = this.history[0];
      const b = this.history[this.history.length - 1];
      const dx = b.center[0] - a.center[0];
      const dy = b.center[1] - a.center[1];
      if (Math.abs(dx) > t.ORBIT_DEADZONE) camera.yaw += dx * t.ORBIT_YAW_GAIN;
      if (Math.abs(dy) > t.ORBIT_DEADZONE) camera.pitch -= dy * t.ORBIT_PITCH_GAIN;
    }

    return camera;
  }

  releasePinch() {
    this.pinchStart = null;
    if (this.onPinchEnd) this.onPinchEnd();
  }
}
