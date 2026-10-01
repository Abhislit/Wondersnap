export function normalize(v) {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

export function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function subtract(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function add(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function scale(a, s) {
  return [a[0] * s, a[1] * s, a[2] * s];
}

export function length(a) {
  return Math.hypot(a[0], a[1], a[2]);
}

export function transformPoint(m, p) {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
}

export function mat4Identity() {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

export function perspective(fovY, aspect, near, far) {
  const f = 1 / Math.tan(fovY / 2);
  const nf = 1 / (near - far);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0,
  ]);
}

export function lookAt(eye, center, up) {
  const z = normalize(subtract(eye, center));
  let x = cross(up, z);
  if (length(x) < 1e-6) x = cross([0, 0, 1], z);
  x = normalize(x);
  const y = cross(z, x);
  return new Float32Array([
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -dot(x, eye), -dot(y, eye), -dot(z, eye), 1,
  ]);
}

export function multiply(a, b) {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] =
        a[0 * 4 + r] * b[c * 4 + 0] +
        a[1 * 4 + r] * b[c * 4 + 1] +
        a[2 * 4 + r] * b[c * 4 + 2] +
        a[3 * 4 + r] * b[c * 4 + 3];
    }
  }
  return out;
}

export function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function smoothstep(t) {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

export function damp(current, target, lambda, dt) {
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}

export class Camera {
  constructor() {
    this.yaw = 0.5;
    this.pitch = 0.12;
    this.distance = 6.4;
    this.targetDistance = 6.4;
    this.target = [0, 0, 0];
    this.smoothTarget = [0, 0, 0];
    this.minDistance = 1.6;
    this.maxDistance = 18;
  }

  orbit(dYaw, dPitch) {
    this.yaw += dYaw;
    this.pitch = clamp(this.pitch + dPitch, -1.35, 1.35);
  }

  zoom(factor) {
    this.targetDistance = clamp(this.targetDistance * factor, this.minDistance, this.maxDistance);
  }

  setDistance(d) {
    this.targetDistance = clamp(d, this.minDistance, this.maxDistance);
  }

  update(dt) {
    this.distance = damp(this.distance, this.targetDistance, 7, dt);
    for (let i = 0; i < 3; i++) {
      this.smoothTarget[i] = damp(this.smoothTarget[i], this.target[i], 6, dt);
    }
  }

  eye() {
    const cp = Math.cos(this.pitch);
    return [
      this.smoothTarget[0] + Math.sin(this.yaw) * cp * this.distance,
      this.smoothTarget[1] + Math.sin(this.pitch) * this.distance,
      this.smoothTarget[2] + Math.cos(this.yaw) * cp * this.distance,
    ];
  }

  viewProj(aspect) {
    const view = lookAt(this.eye(), this.smoothTarget, [0, 1, 0]);
    const proj = perspective((50 * Math.PI) / 180, aspect, 0.1, 120);
    return multiply(proj, view);
  }

  worldToScreen(p, width, height) {
    const vp = this.viewProj(width / height);
    const clip = [
      vp[0] * p[0] + vp[4] * p[1] + vp[8] * p[2] + vp[12],
      vp[1] * p[0] + vp[5] * p[1] + vp[9] * p[2] + vp[13],
      vp[2] * p[0] + vp[6] * p[1] + vp[10] * p[2] + vp[14],
      vp[3] * p[0] + vp[7] * p[1] + vp[11] * p[2] + vp[15],
    ];
    if (clip[3] <= 1e-5) return null;
    return {
      x: ((clip[0] / clip[3]) * 0.5 + 0.5) * width,
      y: (1 - ((clip[1] / clip[3]) * 0.5 + 0.5)) * height,
      w: clip[3],
    };
  }

  screenToWorldRay(nx, ny) {
    const invVp = invert(this.viewProj(1));
    const near = transformPoint(invVp, [nx, ny, -1]);
    const far = transformPoint(invVp, [nx, ny, 1]);
    return { origin: near, dir: normalize(subtract(far, near)) };
  }
}

export function invert(m) {
  const inv = new Float32Array(16);
  const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3];
  const a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
  const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11];
  const a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];

  const b00 = a00 * a11 - a01 * a10;
  const b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11;
  const b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30;
  const b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31;
  const b11 = a22 * a33 - a23 * a32;

  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) return mat4Identity();
  det = 1 / det;

  inv[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
  inv[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
  inv[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
  inv[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
  inv[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
  inv[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
  inv[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
  inv[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
  inv[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
  inv[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
  inv[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
  inv[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
  inv[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
  inv[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
  inv[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
  inv[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
  return inv;
}
