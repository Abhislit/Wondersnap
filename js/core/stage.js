import { ParticleSystem } from '../gpu/particles.js';
import { ModelBuilder, boundsCenter, boundsRadius } from '../models/builder.js';
import { modelById } from '../models/index.js';
import { Camera, damp, smoothstep } from './math.js';

export const PARTICLE_BUDGET = 240000;
export const MIN_BUDGET = 4000;

export const FOV_Y = (50 * Math.PI) / 180;

/**
 * Sprite radius in world units, as a fraction of the model radius.
 *
 * Calibrated so a model at its default framing renders sprites at the size that
 * measured gap-free (0% uncovered pixels) before sprite sizing was derived from the
 * projection. Anchoring here rather than to an absolute pixel size is what keeps
 * coverage constant as the camera zooms and as the viewport changes.
 */
export const SPRITE_WORLD_FRACTION = 0.124;

/**
 * Fraction of the frame height the model's extent should occupy. Just under 1 so the model
 * never touches the viewport edge, and so a wide viewport still has air at the sides.
 */
export const FRAME_FILL = 0.92;

/**
 * World-space radius of one particle sprite.
 *
 * Particles lie on a surface of roughly constant area, so the gap between neighbours
 * grows as 1/sqrt(budget). Holding the sprite at a fixed fraction of the model radius
 * therefore lets the number of sprites covering a pixel climb with the budget: measured
 * at 19x on a 240k brain, which additive blending turns into a featureless glow, and it
 * means a weak machine forced down to 4k renders sharper than a strong one at 240k.
 *
 * Scaling by the same 1/sqrt(budget) law keeps the overlap ratio constant across every
 * budget the quality controller can pick. Anchored at MIN_BUDGET, so the weakest
 * supported machine keeps exactly the sprite size it has today and only better hardware
 * gets more detail.
 */
export function spriteWorldRadius(modelRadius, budget, spriteFraction = SPRITE_WORLD_FRACTION) {
  return modelRadius * spriteFraction * Math.sqrt(MIN_BUDGET / budget);
}

/** Pixels per world unit at unit depth, for the current framebuffer height. */
export function pixelsPerWorldUnit(framebufferHeight) {
  return framebufferHeight / (2 * Math.tan(FOV_Y / 2));
}

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
    this.exposureBase = Number.isFinite(exposureParam) ? exposureParam : 0.125;
    const params = new URLSearchParams(window.location.search);
    const maxPoint = Number.parseFloat(params.get('maxpoint'));
    this.maxPointSize = Number.isFinite(maxPoint) ? maxPoint : 96;
    const pointGain = Number.parseFloat(params.get('point'));
    this.spriteFraction = SPRITE_WORLD_FRACTION * (Number.isFinite(pointGain) ? pointGain : 1);
    const num = (key, fallback) => {
      const v = Number.parseFloat(params.get(key));
      return Number.isFinite(v) ? v : fallback;
    };
    this.coreExp = num('core', 1.6);
    this.haloExp = num('haloexp', 1.0);
    this.haloWeight = num('halo', 0.30);
    this.hotBoost = num('hot', 0.0);
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
    // Set from main.js once the camera is actually running; until then the canvas keeps
    // painting its own gradient.
    this.cameraBack = false;
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
    this.updateExposure();
    if (this.model) this.loadModel(this.model);
    this.updateSpriteScale();
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
    this.updateSpriteScale();

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

  /**
   * Per-pixel brightness goes as overlap x exposure. Sprite overlap is now the same at
   * every budget (see spriteWorldRadius), so exposure has to be as well: dividing it by
   * the budget as well double-counted the budget, which made a machine that had been
   * throttled to 4k render far brighter than one running at 240k.
   */
  updateExposure() {
    this.exposure = this.exposureBase;
    return this.exposure;
  }

  /**
   * The canvas is always transparent, so the desktop or the webcam shows through the
   * particles. Always false: the gradient is never drawn, with or without a camera.
   */
  wantsBackground() {
    return false;
  }

  /**
   * Sprite size must be derived from the projection, not left to a pixel clamp.
   *
   * gl_PointSize is a width in framebuffer pixels, so the world-to-pixel factor is
   * framebufferHeight / (2*tan(fov/2)). Using it here makes sprites grow as the camera
   * zooms in and as the viewport gets larger. Sprite world size comes from
   * spriteWorldRadius, which also tracks the particle budget.
   */
  updateSpriteScale() {
    const height = this.canvas.height || 1;
    this.pointScale = spriteWorldRadius(this.modelRadius || 0, this.budget, this.spriteFraction)
      * pixelsPerWorldUnit(height);
  }

  /**
   * Distance at which the model's extent fills the frame.
   *
   * The frustum's half-height at distance d is d*tan(halfFov), so an extent of radius R
   * exactly fills the height at R/tan(halfFov). Height is what binds on a landscape
   * display; the width has to be divided by the aspect ratio, which is why a viewport
   * narrower than it is tall pulls the camera back instead of cropping.
   *
   * Two things used to fight this. The horizontal term was multiplied by the aspect rather
   * than divided, which pushed the camera 1.6x further away on a 16:10 display and made
   * every model render at 63% of its intended size. And a `modelRadius * 1.2` floor in the
   * max() pushed large models further away still -- the eiffel tower, at radius 3.27, sat
   * well past its own extent. FRAME_FILL is the margin that was actually wanted.
   */
  frameDistance(explodeAmount) {
    const focus = this.camera.target;
    const extent = this.extentFor(explodeAmount, focus);
    const halfFov = FOV_Y / 2;
    const aspect = this.camera.aspect || 1;
    // Leave a little air so the model never touches the viewport edge.
    const fill = FRAME_FILL;
    // Height is almost always the binding constraint on a landscape display, because the
    // frustum's half-width is tan(halfFov)*aspect. It only stops binding on a portrait
    // viewport, where aspect < 1 and the width has to be divided instead.
    const vertical = extent.radius / Math.tan(halfFov) / fill;
    const horizontal = extent.radius / (Math.tan(halfFov) * aspect) / fill;
    return Math.max(vertical, horizontal);
  }

  /**
   * Radius of the sphere that contains the model, about `focus`.
   *
   * This used to be `distance(centre, focus) + radius` per part, which is the bounding
   * *sphere* of each part. Wide, flat parts -- most of the brain's lobes -- then
   * overshot their real silhouette, and the camera reserved space that was never used, so
   * the model rendered at ~63% of the frame instead of the requested fill.
   *
   * Taking the largest per-axis half-extent is the tighter bound on the same data: the
   * true extent of a part along axis i is |centre_i - focus_i| + radius, and the model
   * only needs its largest of those, not the Euclidean sum of all three.
   */
  extentFor(explodeAmount, focus) {
    let radius = 0;
    for (const part of this.parts) {
      const v = part.explodeVector;
      for (let i = 0; i < 3; i++) {
        const reach = Math.abs(part.center[i] + v[i] * explodeAmount - focus[i]) + part.radius;
        if (reach > radius) radius = reach;
      }
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
    this.updateSpriteScale();
    this.updateExposure();
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
    // The background pass is opaque (alpha 1.0), so it doubles as the clear. When the
    // webcam is composited behind the canvas it has to be skipped, and the buffer cleared
    // to transparent instead -- otherwise the last frame's particles persist as trails.
    if (this.wantsBackground()) {
      this.system.renderBackground(w, h, this.palette.top, this.palette.bottom);
    } else {
      this.gl.clearColor(0, 0, 0, 0);
      this.gl.clear(this.gl.COLOR_BUFFER_BIT);
    }

    this.system.draw({
      pointScale: this.pointScale,
      energyFloor: this.energyFloor,
      sizeBoost: this.sizeBoost,
      exposure: this.exposure,
      maxPointSize: this.maxPointSize,
      coreExp: this.coreExp,
      haloExp: this.haloExp,
      haloWeight: this.haloWeight,
      hotBoost: this.hotBoost,
      cutaway: this.cutaway,
      cutPlaneN: this.cutPlaneNormal(),
      cutPlaneD: this.cutPlaneOffset(),
    });
  }
}
