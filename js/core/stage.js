import { ParticleSystem } from '../gpu/particles.js';
import { ModelBuilder, boundsCenter, boundsRadius } from '../models/builder.js';
import { modelById } from '../models/index.js';
import { Camera, damp, smoothstep } from './math.js';

export const PARTICLE_BUDGET = 240000;
export const MIN_BUDGET = 4000;

export function prefersReducedMotion() {
  try {
    return typeof matchMedia !== 'undefined'
      && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export function resolveBudget() {
  const raw = new URLSearchParams(window.location.search).get('particles');
  if (!raw) return PARTICLE_BUDGET;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return PARTICLE_BUDGET;
  return Math.max(MIN_BUDGET, Math.min(PARTICLE_BUDGET, n));
}

export class Stage {
  constructor(canvas, gl, budget = PARTICLE_BUDGET) {
    this.canvas = canvas;
    this.gl = gl;
    this.budget = budget;
    const exposureParam = Number.parseFloat(
      new URLSearchParams(window.location.search).get('exposure'),
    );
    this.exposureBase = Number.isFinite(exposureParam) ? exposureParam : 170;
    this.system = new ParticleSystem(gl, budget);
    this.system.seedFromSphere(4.2);
    this.camera = new Camera();
    this.parts = [];
    this.model = null;
    this.nextModel = null;

    this.assemble = 0;
    this.assembleTarget = 0;
    this.morph = 1;
    this.morphTarget = 1;
    this.explode = 0;
    this.explodeTarget = 0;
    this.turbulence = 1.4;
    this.cutaway = false;
    this.sizeBoost = 0;
    this.energyFloor = 0.02;
    this.pointScale = 0;

    this.highlightGroup = -1;
    this.highlight = 0;
    this.grabGroup = -1;
    this.grab = 0;
    this.grabVector = new Float32Array([0, 0, 0]);
    this.grabTarget = new Float32Array([0, 0, 0]);

    this.palette = { top: [0.03, 0.05, 0.12], bottom: [0.0, 0.0, 0.02] };
    this.time = 0;
    this.reducedMotion = prefersReducedMotion();
    this.idleSpin = this.reducedMotion ? 0 : 0.11;
    this.turbulenceScale = this.reducedMotion ? 0.25 : 1;
    this.pendingBuild = null;
  }

  setModel(id) {
    const model = modelById(id);
    if (!model) throw new Error(`Unknown model: ${id}`);
    this.loadModel(model);
  }

  loadModel(model) {
    this.model = model;
    this.explodeTarget = 0;
    this.explode = 0;
    this.pendingExplode = false;
    this.assemble = 0;
    this.assembleTarget = 0;
    const builder = new ModelBuilder(this.system, this.budget);
    for (const def of model.parts) builder.part(def);
    this.pendingBuild = builder;
  }

  /**
   * Rebuilds the particle textures at a new budget. Geometry is regenerated at the new
   * size, which is why the caller treats this as expensive and only does it when the
   * quality controller has sustained evidence that it is needed.
   */
  setBudget(budget) {
    const next = Math.max(4000, Math.min(240000, Math.round(budget)));
    if (next === this.budget) return false;
    this.budget = next;
    this.system = new ParticleSystem(this.gl, next);
    this.system.seedFromSphere(4.2);
    this.exposure = this.exposureBase / next;
    if (this.model) this.loadModel(this.model);
    return true;
  }

  buildPending() {
    if (!this.pendingBuild) return;
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    const result = this.pendingBuild.build(0xc0ffee);
    this.parts = result.parts;
    this.pickPoints = result.pickPoints;
    this.pendingBuild = null;
    this.modelRadius = result.modelRadius;

    this.system.copyTargetsToCurrent();

    const radius = boundsRadius(this.parts);
    this.camera.target = boundsCenter(this.parts);
    this.camera.smoothTarget = [...this.camera.target];
    this.camera.minDistance = Math.max(1.0, radius * 0.7);
    this.camera.aspect = w / h;
    this.viewAspect = w / h;
    this.explodeTarget = this.pendingExplode ? 1 : 0;
    this.explode = 0;
    this.camera.maxDistance = this.frameDistance(1) * 1.4;
    this.camera.setDistance(this.frameDistance(this.explodeTarget));
    this.camera.distance = this.camera.targetDistance * 1.6;
    this.pointScale = radius * 900;

    this.morph = 0;
    this.morphTarget = 1;
    this.assemble = Math.min(this.assemble, 0.2);
    this.turbulence = 2.2;
  }

  burst() {
    this.assembleTarget = 0;
    this.turbulence = 2.6;
    this.morph = 0;
    this.morphTarget = 1;
  }

  form() {
    this.assembleTarget = 1;
  }

  toggleExplode() {
    const on = this.explodeTarget <= 0.5;
    this.explodeTarget = on ? 1 : 0;
    this.pendingExplode = this.explodeTarget > 0.5;
    this.applyExplodeZoom();
    return on;
  }

  applyExplodeZoom() {
    this.camera.setDistance(this.frameDistance(this.explodeTarget ? 1 : 0));
  }

  frameDistance(explodeAmount) {
    const focus = this.camera.target;
    const extent = this.extentFor(explodeAmount, focus);
    const halfFov = (50 * Math.PI) / 180 / 2;
    const aspect = this.camera.aspect || 1;
    const vertical = extent.radius / Math.sin(halfFov);
    const horizontal = vertical * Math.max(1, aspect);
    return Math.max(this.modelRadius * 1.2, vertical, horizontal);
  }

  extentFor(explodeAmount, focus) {
    let radius = 0;
    for (const part of this.parts) {
      const v = part.explodeVector;
      const d = Math.hypot(
        part.center[0] + v[0] * explodeAmount - focus[0],
        part.center[1] + v[1] * explodeAmount - focus[1],
        part.center[2] + v[2] * explodeAmount - focus[2],
      );
      radius = Math.max(radius, d + part.radius);
    }
    return { radius: radius || 1 };
  }

  maxExplodeDistance() {
    let max = 1;
    for (const part of this.parts) {
      max = Math.max(max, Math.hypot(...part.explodeVector) + part.radius);
    }
    return max;
  }

  setHighlight(group) {
    this.highlightGroup = group;
  }

  beginGrab(group) {
    this.grabGroup = group;
    this.grab = 0.6;
  }

  moveGrab(worldDelta) {
    this.grabTarget[0] += worldDelta[0];
    this.grabTarget[1] += worldDelta[1];
    this.grabTarget[2] += worldDelta[2];
    this.grab = 1;
  }

  endGrab() {
    this.grab = 0;
    this.grabTarget.fill(0);
  }

  partAt(index) {
    return this.parts[index] || null;
  }

  worldPositionOfPart(part) {
    return [
      part.center[0] + part.explode[0] * this.explode * part.explodeDistance * 0.42,
      part.center[1] + part.explode[1] * this.explode * part.explodeDistance * 0.42,
      part.center[2] + part.explode[2] * this.explode * part.explodeDistance * 0.42,
    ];
  }

  explodeOffsets() {
    const parts = this.parts;
    if (!this._explodeOffsets || this._explodeOffsets.length !== parts.length) {
      this._explodeOffsets = parts.map(() => [0, 0, 0]);
    }
    const offsets = this._explodeOffsets;
    for (let i = 0; i < parts.length; i++) {
      const o = offsets[i];
      const offset = parts[i].explodeVector;
      o[0] = offset[0] * this.explode;
      o[1] = offset[1] * this.explode;
      o[2] = offset[2] * this.explode;
    }
    return offsets;
  }

  pick(pointerX, pointerY, tolerancePx = 30) {
    if (!this.parts.length) return null;
    const points = this.pickPoints;
    if (!points || !points.count) return null;

    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const offsets = this.explodeOffsets();

    const grab = this.grab;
    const grabOff = this.grabVector;
    const grabGroup = this.grabGroup;
    const vp = this.system.viewProj;
    const data = points.data;
    const tol2 = tolerancePx * tolerancePx;
    const groupCount = this.parts.length;

    if (!this._pickDist || this._pickDist.length !== groupCount) {
      this._pickDist = new Float64Array(groupCount);
    }
    const distOf = this._pickDist;
    distOf.fill(Infinity);

    for (let i = 0; i < points.count; i++) {
      const o = i * 4;
      const group = data[o + 3] | 0;
      if (group < 0 || group >= groupCount) continue;
      const off = offsets[group];
      const pulled = grab > 0 && group === grabGroup;

      const x = data[o] + off[0] + (pulled ? grabOff[0] : 0);
      const y = data[o + 1] + off[1] + (pulled ? grabOff[1] : 0);
      const z = data[o + 2] + off[2] + (pulled ? grabOff[2] : 0);

      const cw = vp[3] * x + vp[7] * y + vp[11] * z + vp[15];
      if (cw <= 1e-4) continue;
      const cx = (vp[0] * x + vp[4] * y + vp[8] * z + vp[12]) / cw;
      const cy = (vp[1] * x + vp[5] * y + vp[9] * z + vp[13]) / cw;

      const sx = (cx * 0.5 + 0.5) * w;
      const sy = (1 - (cy * 0.5 + 0.5)) * h;
      const dx = sx - pointerX;
      const dy = sy - pointerY;
      const d2 = dx * dx + dy * dy;
      if (d2 > tol2) continue;

      if (d2 < distOf[group]) distOf[group] = d2;
    }

    let bestGroup = -1;
    let bestScreen = Infinity;
    for (let g = 0; g < groupCount; g++) {
      if (distOf[g] < bestScreen) {
        bestScreen = distOf[g];
        bestGroup = g;
      }
    }

    if (bestGroup < 0) return null;
    return this.parts[bestGroup] || null;
  }

  cutPlaneNormal() {
    const n = this._cutN || (this._cutN = new Float32Array(3));
    const eye = this.camera.eye();
    n[0] = eye[0] - this.camera.smoothTarget[0];
    n[1] = 0;
    n[2] = eye[2] - this.camera.smoothTarget[2];
    const len = Math.hypot(n[0], n[2]) || 1;
    n[0] /= len;
    n[2] /= len;
    return n;
  }

  cutPlaneOffset() {
    const t = this.camera.smoothTarget;
    const n = this.cutPlaneNormal();
    return n[0] * t[0] + n[2] * t[2];
  }

  update(dt) {
    this.time += dt;
    if (this.pendingBuild) this.buildPending();

    this.assemble = damp(this.assemble, this.assembleTarget, 3.4, dt);
    this.morph = damp(this.morph, this.morphTarget, 1.9, dt);
    this.explode = damp(this.explode, this.explodeTarget, 4.2, dt);
    this.turbulence = damp(
      this.turbulence,
      (this.assemble > 0.85 ? 0.18 : 1.0) * this.turbulenceScale,
      1.6, dt,
    );
    this.highlight = damp(this.highlight, this.highlightGroup >= 0 ? 1 : 0, 6, dt);
    this.camera.yaw += this.idleSpin * dt * (1 - smoothstep(this.assemble));
    this.camera.update(dt);

    for (let i = 0; i < 3; i++) {
      this.grabVector[i] = damp(this.grabVector[i], this.grabTarget[i], 8, dt);
    }
    if (this.grab <= 0.001) {
      for (let i = 0; i < 3; i++) this.grabTarget[i] *= 0.9;
    }

    this.viewAspect = this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight);
    this.camera.aspect = this.viewAspect;
    this.system.viewProj.set(this.camera.viewProj(this.viewAspect));
    this.exposure = this.exposureBase / this.budget;
  }

  render(dt) {
    const gl = this.gl;
    const w = this.canvas.width;
    const h = this.canvas.height;
    if (!this.system) return;

    this.system.step({
      dt,
      time: this.time,
      assemble: this.assemble,
      morph: this.morph,
      turbulence: this.turbulence,
      explode: this.explode,
      highlightGroup: this.highlightGroup,
      highlight: this.highlight,
      grabGroup: this.grabGroup,
      grabVector: this.grabVector,
      grab: this.grab,
    });

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.system.renderBackground(w, h, this.palette.top, this.palette.bottom);

    this.system.draw({
      pointScale: this.pointScale * (this.canvas.width / Math.max(1, this.canvas.clientWidth)),
      energyFloor: this.energyFloor,
      sizeBoost: this.sizeBoost,
      exposure: this.exposure,
      cutaway: this.cutaway,
      cutPlaneN: this.cutPlaneNormal(),
      cutPlaneD: this.cutPlaneOffset(),
    });
  }
}
