const STORAGE_KEY = 'wondersnap:progress';
const VERSION = 1;
const MAX_STORED_BYTES = 16384;

/**
 * Tracks what a learner has explored and how they have done in quizzes.
 *
 * Storage is treated as untrusted: a corrupt or hostile value must never throw,
 * and anything unrecognised is dropped rather than trusted. If localStorage is
 * unavailable the tracker degrades to an in-memory session record.
 */
export class Progress {
  constructor(storage = safeStorage()) {
    this.storage = storage;
    this.persistent = !!storage;
    this.data = { version: VERSION, models: {} };
    this.known = new Map();
    this.load();
  }

  /**
   * Tells the tracker which parts a model actually has. Called when a model loads,
   * so stored ids from an older build are pruned instead of inflating completion.
   */
  registerModel(modelId, parts) {
    const ids = new Set((parts || []).map((p) => (typeof p === 'string' ? p : p.id)).filter(Boolean));
    this.known.set(modelId, ids);
    const entry = this.data.models[modelId];
    if (entry) {
      const before = entry.parts.length;
      entry.parts = entry.parts.filter((id) => ids.has(id));
      if (entry.parts.length !== before) this.save();
    }
    return this;
  }

  has(modelId, partId) {
    const ids = this.known.get(modelId);
    return !ids || ids.has(partId);
  }

  load() {
    if (!this.storage) return;
    let raw = null;
    try {
      raw = this.storage.getItem(STORAGE_KEY);
    } catch {
      this.persistent = false;
      return;
    }
    if (!raw) return;

    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    if (!parsed || typeof parsed !== 'object' || parsed.version !== VERSION) return;
    if (!parsed.models || typeof parsed.models !== 'object') return;

    const models = {};
    for (const [modelId, entry] of Object.entries(parsed.models)) {
      if (!entry || typeof entry !== 'object') continue;
      const parts = Array.isArray(entry.parts)
        ? entry.parts.filter((p) => typeof p === 'string').slice(0, 200)
        : [];
      const quiz = entry.quiz && typeof entry.quiz === 'object' ? entry.quiz : {};
      models[modelId] = {
        parts: [...new Set(parts)],
        quiz: {
          correct: Number.isFinite(quiz.correct) ? Math.max(0, quiz.correct) : 0,
          total: Number.isFinite(quiz.total) ? Math.max(0, quiz.total) : 0,
        },
      };
    }
    this.data = { version: VERSION, models };
  }

  save() {
    if (!this.storage || !this.persistent) return;
    try {
      const raw = JSON.stringify(this.data);
      if (raw.length > MAX_STORED_BYTES) {
        this.trim();
      }
      this.storage.setItem(STORAGE_KEY, JSON.stringify(this.data));
    } catch {
      this.persistent = false;
    }
  }

  /** Drop the least recently touched models until the payload fits. */
  trim() {
    const entries = Object.entries(this.data.models);
    while (JSON.stringify(this.data).length > MAX_STORED_BYTES && entries.length > 1) {
      const oldest = entries.shift();
      delete this.data.models[oldest[0]];
    }
  }

  entry(modelId) {
    if (!this.data.models[modelId]) {
      this.data.models[modelId] = { parts: [], quiz: { correct: 0, total: 0 } };
    }
    return this.data.models[modelId];
  }

  recordExplored(modelId, partId) {
    if (!modelId || !partId) return;
    if (!this.has(modelId, partId)) return;
    const entry = this.entry(modelId);
    if (entry.parts.includes(partId)) return;
    entry.parts.push(partId);
    this.save();
  }

  isExplored(modelId, partId) {
    if (!this.has(modelId, partId)) return false;
    return this.data.models[modelId]?.parts.includes(partId) ?? false;
  }

  exploredCount(modelId) {
    const parts = this.data.models[modelId]?.parts ?? [];
    const ids = this.known.get(modelId);
    return ids ? parts.filter((id) => ids.has(id)).length : parts.length;
  }

  completion(modelId, parts) {
    if (!parts?.length) return 0;
    const explored = this.exploredCount(modelId);
    return Math.min(1, explored / parts.length);
  }

  /** Registers every model in the registry, pruning stale ids. */
  syncRegistry(registry) {
    for (const model of registry) this.registerModel(model.id, model.parts);
    return this;
  }

  isComplete(modelId, parts) {
    if (!parts?.length) return false;
    return this.exploredCount(modelId) >= parts.length;
  }

  recordAnswer(modelId, correct) {
    const entry = this.entry(modelId);
    entry.quiz.total += 1;
    if (correct) entry.quiz.correct += 1;
    this.save();
  }

  quizScore(modelId) {
    const quiz = this.data.models[modelId]?.quiz;
    return { correct: quiz?.correct ?? 0, total: quiz?.total ?? 0 };
  }

  quizTotals() {
    let correct = 0;
    let total = 0;
    for (const entry of Object.values(this.data.models)) {
      correct += entry.quiz?.correct ?? 0;
      total += entry.quiz?.total ?? 0;
    }
    return { correct, total };
  }

  quizAccuracy(modelId) {
    const { correct, total } = this.quizScore(modelId);
    return total ? correct / total : 0;
  }

  summary(registry) {
    let partsTotal = 0;
    let partsExplored = 0;
    let modelsComplete = 0;
    let modelsSeen = 0;

    for (const model of registry) {
      const list = model.parts || [];
      partsTotal += list.length;
      if (this.exploredCount(model.id) > 0) modelsSeen++;
      for (const part of list) {
        if (this.isExplored(model.id, part.id)) partsExplored++;
      }
      if (this.isComplete(model.id, list)) modelsComplete++;
    }

    const quiz = this.quizTotals();
    return {
      partsTotal,
      partsExplored,
      modelsSeen,
      modelsComplete,
      modelsTotal: registry.length,
      quiz,
      overall: partsTotal ? partsExplored / partsTotal : 0,
    };
  }

  reset() {
    this.data = { version: VERSION, models: {} };
    if (!this.storage) return;
    try {
      this.storage.removeItem(STORAGE_KEY);
    } catch {
      this.persistent = false;
    }
  }
}

function safeStorage() {
  try {
    if (typeof localStorage === 'undefined') return undefined;
    const probe = '__wondersnap_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    return undefined;
  }
}
