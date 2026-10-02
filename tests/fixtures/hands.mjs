/**
 * Synthetic landmark builders shared by the unit and browser suites.
 *
 * These are NOT hand data. They approximate hand geometry well enough to exercise the
 * classifier, which is how the defaults in js/core/gestures.js were chosen. Real tuning
 * against a webcam belongs in tools/tune.html.
 */

export function buildHand(spec = {}) {
  const landmarks = new Array(21).fill(null).map(() => ({ x: 0.5, y: 0.5, z: 0 }));
  const set = (i, x, y, z = 0) => { landmarks[i] = { x, y, z }; };

  const W = 0.5;
  const WY = 0.86;
  set(0, W, WY);
  set(1, W - 0.10, WY - 0.05);
  set(2, W - 0.14, WY - 0.13);
  set(3, W - 0.16, WY - 0.21);

  const fingers = {
    index: { mcp: 5, pip: 6, dip: 7, tip: 8, x: W - 0.06, len: [0.08, 0.05, 0.04] },
    middle: { mcp: 9, pip: 10, dip: 11, tip: 12, x: W, len: [0.09, 0.055, 0.042] },
    ring: { mcp: 13, pip: 14, dip: 15, tip: 16, x: W + 0.055, len: [0.082, 0.05, 0.04] },
    pinky: { mcp: 17, pip: 18, dip: 19, tip: 20, x: W + 0.105, len: [0.065, 0.038, 0.032] },
  };

  const mcpY = WY - 0.20;
  for (const [name, f] of Object.entries(fingers)) {
    const curl = spec[name] ?? 0;
    set(f.mcp, f.x, mcpY);
    let y = mcpY;
    let x = f.x;
    const chain = [f.pip, f.dip, f.tip];
    for (let s = 0; s < 3; s++) {
      const seg = f.len[s];
      y -= seg * (1 - curl);
      x += seg * curl * 0.7 * (s === 0 ? 0.4 : 1);
      set(chain[s], x, y, -0.02 * curl);
    }
  }

  if (spec.thumbTip) set(4, spec.thumbTip[0], spec.thumbTip[1], -0.03);

  if (spec.roll) {
    const a = spec.roll;
    for (const p of landmarks) {
      const dx = p.x - W;
      const dy = p.y - WY;
      p.x = W + dx * Math.cos(a) - dy * Math.sin(a);
      p.y = WY + dx * Math.sin(a) + dy * Math.cos(a);
    }
  }

  return landmarks;
}

export const POSES = {
  open: { index: 0, middle: 0, ring: 0, pinky: 0, thumbTip: [0.32, 0.55] },
  fist: { index: 1, middle: 1, ring: 1, pinky: 1, thumbTip: [0.41, 0.80] },
  point: { index: 0, middle: 1, ring: 1, pinky: 1, thumbTip: [0.36, 0.72] },
  relaxed: { index: 0.6, middle: 0.6, ring: 0.6, pinky: 0.6, thumbTip: [0.35, 0.66] },
};

export function buildPinchHand() {
  const landmarks = buildHand(POSES.point);
  landmarks[4] = { ...landmarks[8], x: landmarks[8].x + 0.02, y: landmarks[8].y };
  return landmarks;
}

export const HANDEDNESS = [{ categoryName: 'Right', score: 0.98 }];

/** Minimal engine-shaped stub, for testing GestureEngine without a camera. */
export function stubHand({ pinchDistance = 0.8, center = [0.5, 0.5], roll = 0, pinchMid = { x: 0.5, y: 0.5, z: 0 } }) {
  return { pinchDistance, pinchMid, center, normal: [0, 0, 1], roll, landmarks: [] };
}
