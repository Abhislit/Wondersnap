export const MIN_BUDGET = 4000;
export const MAX_BUDGET = 240000;

export const DOWNGRADE_FACTOR = 0.5;
export const UPGRADE_FACTOR = 1.6;
export const UPGRADE_STEP = 20000;

/** Frame time in ms above which a sample counts toward a downgrade decision. */
const DOWNGRADE_THRESHOLD = 1.3;
const UPGRADE_THRESHOLD = 0.55;
const MIN_SAMPLES_DOWNGRADE = 60;
const MIN_SAMPLES_UPGRADE = 180;

export function averageFrameTime(samples) {
  let sum = 0;
  let count = 0;
  for (const s of samples) {
    if (!Number.isFinite(s) || s <= 0) continue;
    sum += s;
    count++;
  }
  return count ? sum / count : 0;
}

export function sampleBudget(current, factor) {
  const next = Math.round(current * factor);
  return Math.max(MIN_BUDGET, Math.min(MAX_BUDGET, next));
}

export function shouldDowngrade({ average, budget, samples }) {
  if (budget <= MIN_BUDGET) return false;
  if (samples < MIN_SAMPLES_DOWNGRADE) return false;
  return average > DOWNGRADE_THRESHOLD * averageForFps(60);
}

export function shouldUpgrade({ average, budget, samples, ceiling = MAX_BUDGET }) {
  if (budget >= ceiling) return false;
  if (samples < MIN_SAMPLES_UPGRADE) return false;
  return average < UPGRADE_THRESHOLD * averageForFps(60);
}

function averageForFps(fps) {
  return 1000 / fps;
}

/**
 * Watches frame time and steps the particle budget up or down to hold a target frame
 * rate. Deliberately slow to react: a few dropped frames are normal, and rebuilding the
 * particle textures is expensive, so the controller demands sustained evidence before
 * changing anything.
 */
export class QualityController {
  constructor({
    initialBudget = MAX_BUDGET,
    targetFps = 60,
    floor = MIN_BUDGET,
    pinned = false,
    ceiling = initialBudget,
  } = {}) {
    this.targetFps = targetFps;
    this.floor = Math.max(MIN_BUDGET, floor);
    this.ceiling = Math.max(this.floor, Math.min(MAX_BUDGET, ceiling));
    this.pinned = pinned;
    this.initialBudget = Math.max(this.floor, Math.min(this.ceiling, initialBudget));
    this.budget = this.initialBudget;
    this.samples = [];
    this.pending = false;
    this.enabled = !pinned;
  }

  sample(dt) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    this.samples.push(dt * 1000);
    if (this.samples.length > 240) this.samples.shift();
  }

  get average() {
    return averageFrameTime(this.samples);
  }

  /** True once per change, so the caller can rebuild textures and then commit. */
  shouldRebuild() {
    if (!this.enabled || this.pending) return false;
    const stats = {
      average: this.average,
      budget: this.budget,
      samples: this.samples.length,
      ceiling: this.ceiling,
    };
    if (shouldDowngrade(stats)) {
      this.pendingBudget = sampleBudget(this.budget, DOWNGRADE_FACTOR);
      if (this.pendingBudget < this.budget) {
        this.pending = true;
        return true;
      }
      return false;
    }
    if (shouldUpgrade(stats)) {
      this.pendingBudget = Math.min(
        this.ceiling,
        sampleBudget(this.budget, UPGRADE_FACTOR) + UPGRADE_STEP,
      );
      if (this.pendingBudget > this.budget) {
        this.pending = true;
        return true;
      }
      return false;
    }
    return false;
  }

  /** Applies the pending budget and clears the accumulated evidence. */
  commit() {
    if (!this.pending) return this.budget;
    this.budget = Math.max(this.floor, Math.min(this.ceiling, this.pendingBudget));
    this.pending = false;
    this.pendingBudget = null;
    this.samples.length = 0;
    return this.budget;
  }

  reset() {
    this.budget = this.initialBudget;
    this.samples.length = 0;
    this.pending = false;
    this.pendingBudget = null;
  }

  describe() {
    return {
      budget: this.budget,
      averageMs: +this.average.toFixed(2),
      fps: this.average > 0 ? +(1000 / this.average).toFixed(1) : 0,
      targetFps: this.targetFps,
      enabled: this.enabled,
      pinned: this.pinned,
    };
  }
}
