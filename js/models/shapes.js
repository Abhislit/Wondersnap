export function spherePoint(rand, radius, size = 1) {
  const u = rand() * 2 - 1;
  const theta = rand() * Math.PI * 2;
  const s = Math.sqrt(1 - u * u);
  return {
    p: [radius * s * Math.cos(theta), radius * s * Math.sin(theta), radius * u],
    size,
    tint: 1,
    shimmer: 0.12,
  };
}

export function shellPoint(rand, radius, thickness, size = 1) {
  const inner = Math.max(0.01, radius - thickness);
  const r = inner + rand() * (radius - inner);
  return spherePoint(rand, r, size);
}

export function torusPoint(rand, R, r, size = 1) {
  const u = rand() * Math.PI * 2;
  const v = rand() * Math.PI * 2;
  const cr = r * (0.82 + rand() * 0.36);
  const c = Math.cos(u) * (R + cr * Math.cos(v));
  const s = Math.sin(u) * (R + cr * Math.cos(v));
  return { p: [c, cr * Math.sin(v), s], size, shimmer: 0.1 };
}

export function tubePoint(rand, radiusFn, y0, y1, size = 1) {
  const y = y0 + rand() * (y1 - y0);
  const t = (y - y0) / (y1 - y0 || 1);
  const r = radiusFn(t);
  const a = rand() * Math.PI * 2;
  return { p: [r * Math.cos(a), y, r * Math.sin(a)], size, shimmer: 0.1 };
}

export function discPoint(rand, inner, outer, y, size = 1) {
  const r = inner + Math.sqrt(rand()) * (outer - inner);
  const a = rand() * Math.PI * 2;
  return { p: [r * Math.cos(a), y + (rand() - 0.5) * 0.02, r * Math.sin(a)], size };
}

export function boxPoint(rand, hx, hy, hz, size = 1) {
  return {
    p: [(rand() * 2 - 1) * hx, (rand() * 2 - 1) * hy, (rand() * 2 - 1) * hz],
    size,
    shimmer: 0.08,
  };
}

export function boxShellPoint(rand, hx, hy, hz, thickness, size = 1) {
  const face = Math.floor(rand() * 6);
  const u = rand() * 2 - 1;
  const v = rand() * 2 - 1;
  const t = thickness * (0.6 + rand() * 0.8);
  switch (face) {
    case 0: return { p: [hx + t, u * hy, v * hz], size };
    case 1: return { p: [-hx - t, u * hy, v * hz], size };
    case 2: return { p: [u * hx, hy + t, v * hz], size };
    case 3: return { p: [u * hx, -hy - t, v * hz], size };
    case 4: return { p: [u * hx, v * hy, hz + t], size };
    default: return { p: [u * hx, v * hy, -hz - t], size };
  }
}

export function cylinderPoint(rand, r0, r1, y0, y1, size = 1) {
  const y = y0 + rand() * (y1 - y0);
  const t = (y - y0) / (y1 - y0 || 1);
  const r = r0 + (r1 - r0) * t;
  const a = rand() * Math.PI * 2;
  return { p: [r * Math.cos(a), y, r * Math.sin(a)], size, shimmer: 0.1 };
}

export function boxBeamPoint(rand, from, to, halfWidth, size = 1) {
  const t = rand();
  const jitter = (rand() * 2 - 1) * halfWidth;
  const jitter2 = (rand() * 2 - 1) * halfWidth;
  const dir = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
  const len = Math.hypot(...dir) || 1;
  const d = [dir[0] / len, dir[1] / len, dir[2] / len];
  const ref = Math.abs(d[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const side = normalize3([
    ref[1] * d[2] - ref[2] * d[1],
    ref[2] * d[0] - ref[0] * d[2],
    ref[0] * d[1] - ref[1] * d[0],
  ]);
  const up = normalize3([
    side[1] * d[2] - side[2] * d[1],
    side[2] * d[0] - side[0] * d[2],
    side[0] * d[1] - side[1] * d[0],
  ]);
  return {
    p: [
      from[0] + d[0] * t * len + side[0] * jitter + up[0] * jitter2,
      from[1] + d[1] * t * len + side[1] * jitter + up[1] * jitter2,
      from[2] + d[2] * t * len + side[2] * jitter + up[2] * jitter2,
    ],
    size,
    shimmer: 0.14,
  };
}

function normalize3(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

export function lathePoint(rand, profile, size = 1) {
  const t = rand() * (profile.length - 1);
  const i = Math.min(profile.length - 2, Math.floor(t));
  const f = t - i;
  const r = profile[i][0] + (profile[i + 1][0] - profile[i][0]) * f;
  const y = profile[i][1] + (profile[i + 1][1] - profile[i][1]) * f;
  const a = rand() * Math.PI * 2;
  return { p: [r * Math.cos(a), y, r * Math.sin(a)], size, shimmer: 0.1 };
}

export function curvePoint(rand, fn, t, spread, size = 1) {
  const p = fn(t);
  return {
    p: [
      p[0] + (rand() * 2 - 1) * spread,
      p[1] + (rand() * 2 - 1) * spread,
      p[2] + (rand() * 2 - 1) * spread,
    ],
    size,
    shimmer: 0.12,
  };
}

export function combine(...samplers) {
  return (rand, i, n) => {
    const s = samplers[Math.floor(rand() * samplers.length)];
    return s(rand, i, n);
  };
}

export function mirrorX(sampler) {
  return (rand, i, n) => {
    const s = sampler(rand, i, n);
    const flip = rand() < 0.5;
    return { ...s, p: [flip ? -s.p[0] : s.p[0], s.p[1], s.p[2]] };
  };
}
