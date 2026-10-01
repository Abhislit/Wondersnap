import { normalize, length } from '../core/math.js';

export const BUDGET = 240000;
export const PICK_SAMPLE = 6000;
export const EXPLODE_SCALE = 0.85;
export const MAX_EXPLODE_FRACTION = 0.95;

function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hexToRgb(hex) {
  const n = typeof hex === 'string' ? parseInt(hex.replace('#', ''), 16) : hex;
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function shadeRgb(rgb, factor) {
  return [
    Math.min(1, rgb[0] * factor),
    Math.min(1, rgb[1] * factor),
    Math.min(1, rgb[2] * factor),
  ];
}

export class ModelBuilder {
  constructor(system, budget = BUDGET) {
    this.system = system;
    this.budget = budget;
    this.parts = [];
  }

  part(def) {
    this.parts.push({
      id: def.id,
      name: def.name,
      description: def.description,
      color: def.color,
      weight: def.weight ?? 1,
      explode: normalize(def.explode ?? [0, 1, 0]),
      explodeDistance: def.explodeDistance ?? 1,
      sampler: def.sampler,
      center: [0, 0, 0],
      radius: 0,
      count: 0,
    });
    return this;
  }

  computeRadius(counts) {
    let cursor = 0;
    let radius = 0;
    this.parts.forEach((part, index) => {
      const count = index === this.parts.length - 1 ? counts.reduce((a, b) => a + b, 0) - cursor : counts[index];
      let far = 0;
      for (let i = 0; i < count; i++) {
        const o = (cursor + i) * 4;
        const d = Math.hypot(this._positions[o], this._positions[o + 1], this._positions[o + 2]);
        if (d > far) far = d;
      }
      radius = Math.max(radius, far);
      cursor += count;
    });
    return radius || 1;
  }

  weights() {
    const total = this.parts.reduce((s, p) => s + p.weight, 0) || 1;
    return this.parts.map((p) => Math.max(1, Math.round((p.weight / total) * this.budget)));
  }

  build(seed = 1337) {
    const rand = mulberry32(seed);
    const system = this.system;
    const counts = this.weights();
    const total = counts.reduce((s, c) => s + c, 0);
    const texels = system.texels;

    const positions = new Float32Array(texels * 4);
    const colors = new Float32Array(texels * 4);
    const groups = new Float32Array(texels * 4);
    const baseColor = hexToRgb(this.parts[0].color);

    this._positions = positions;
    let cursor = 0;
    this.parts.forEach((part, index) => {
      const count = index === this.parts.length - 1 ? total - cursor : counts[index];
      const rgb = hexToRgb(part.color);
      let cx = 0, cy = 0, cz = 0;
      let minX = Infinity, minY = Infinity, minZ = Infinity;
      let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

      for (let i = 0; i < count; i++) {
        const o = cursor * 4;
        const s = part.sampler(rand, i, count);
        const [x, y, z] = s.p;
        positions[o] = x;
        positions[o + 1] = y;
        positions[o + 2] = z;
        positions[o + 3] = 1;

        const tint = s.tint ?? 1;
        const shimmer = s.shimmer ?? 0;
        const shade = tint * (1 + shimmer * (rand() - 0.5));
        colors[o] = Math.min(1.2, rgb[0] * shade);
        colors[o + 1] = Math.min(1.2, rgb[1] * shade);
        colors[o + 2] = Math.min(1.2, rgb[2] * shade);
        colors[o + 3] = s.size ?? 1;

        groups[o] = part.explode[0];
        groups[o + 1] = part.explode[1];
        groups[o + 2] = part.explode[2];
        groups[o + 3] = index;

        cx += x; cy += y; cz += z;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
        cursor++;
      }

      part.count = count;
      part.center = [cx / count, cy / count, cz / count];
      const ex = (maxX - minX) / 2;
      const ey = (maxY - minY) / 2;
      const ez = (maxZ - minZ) / 2;
      part.radius = Math.hypot(ex, ey, ez) || 0.001;
    });

    for (let i = cursor; i < texels; i++) {
      const o = i * 4;
      positions[o] = 0; positions[o + 1] = 0; positions[o + 2] = 0;
      positions[o + 3] = 0;
      colors[o] = baseColor[0]; colors[o + 1] = baseColor[1];
      colors[o + 2] = baseColor[2]; colors[o + 3] = 0;
      groups[o + 3] = -1;
    }

    const modelRadius = this.computeRadius(counts);
    const scale = modelRadius * EXPLODE_SCALE;
    const limit = modelRadius * MAX_EXPLODE_FRACTION;
    const reach = this.parts.map((p) => {
      const length = Math.hypot(p.explode[0], p.explode[1], p.explode[2]) || 1;
      const magnitude = p.explodeDistance * scale;
      return Math.min(magnitude, limit) / length;
    });
    this.explodeReach = reach;
    for (let i = 0; i < total; i++) {
      const o = i * 4;
      const k = reach[groups[o + 3] | 0];
      groups[o] *= k;
      groups[o + 1] *= k;
      groups[o + 2] *= k;
    }

    system.targetA.set(positions);
    system.targetB.set(positions);
    system.colors.set(colors);
    system.groups.set(groups);
    system.uploadTargets();

    return {
      modelRadius,
      pickPoints: buildPickPoints(positions, groups, total, PICK_SAMPLE),
      parts: this.parts.map((p, i) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        color: p.color,
        group: i,
        center: p.center,
        radius: p.radius,
        explode: p.explode,
        explodeDistance: p.explodeDistance,
        explodeVector: [
          p.explode[0] * reach[i],
          p.explode[1] * reach[i],
          p.explode[2] * reach[i],
        ],
        count: p.count,
      })),
    };
  }
}

export function buildPickPoints(positions, groups, total, sampleCount) {
  const n = Math.min(sampleCount, total);
  const stride = Math.max(1, Math.ceil(total / n));
  const slots = Math.ceil(total / stride);
  const out = new Float32Array(slots * 4);
  let written = 0;
  for (let i = 0; i < total; i += stride) {
    const src = i * 4;
    const dst = written * 4;
    out[dst] = positions[src];
    out[dst + 1] = positions[src + 1];
    out[dst + 2] = positions[src + 2];
    out[dst + 3] = groups[src + 3];
    written++;
  }
  return { data: out.subarray(0, written * 4), count: written };
}

export function boundsCenter(parts) {
  const c = [0, 0, 0];
  for (const p of parts) {
    c[0] += p.center[0];
    c[1] += p.center[1];
    c[2] += p.center[2];
  }
  return [c[0] / parts.length, c[1] / parts.length, c[2] / parts.length];
}

export function boundsRadius(parts) {
  let r = 0;
  for (const p of parts) {
    r = Math.max(r, length([p.center[0], p.center[1], p.center[2]]) + p.radius);
  }
  return r || 1;
}
