export class Quiz {
  constructor() {
    this.active = false;
    this.model = null;
    this.questions = [];
    this.index = 0;
    this.answered = false;
    this.lastResult = null;
    this.score = 0;
    this.total = 0;
    this.onChange = null;
    this.onSpeak = null;
  }

  start(model, parts) {
    this.model = model;
    this.parts = parts;
    this.questions = this.buildQuestions(model, parts);
    this.index = 0;
    this.answered = false;
    this.lastResult = null;
    this.active = true;
    this.emit();
    this.announce();
  }

  stop() {
    this.active = false;
    this.emit();
  }

  buildQuestions(model, parts) {
    return parts.map((part) => {
      const others = parts.filter((p) => p.id !== part.id);
      const picks = [];
      while (picks.length < Math.min(3, others.length)) {
        const candidate = others[Math.floor(Math.random() * others.length)];
        if (!picks.some((p) => p.id === candidate.id)) picks.push(candidate);
      }
      const options = [
        { label: part.name, correct: true },
        ...picks.map((p) => ({ label: p.name, correct: false })),
      ];
      for (let j = options.length - 1; j > 0; j--) {
        const k = Math.floor(Math.random() * (j + 1));
        [options[j], options[k]] = [options[k], options[j]];
      }
      return {
        prompt: `In the ${model.name}, which part is the ${part.name}?`,
        part,
        options,
      };
    });
  }

  current() {
    return this.questions[this.index] || null;
  }

  answer(optionIndex) {
    const question = this.current();
    if (!question || this.answered) {
      this.emit();
      return null;
    }
    const option = question.options[optionIndex];
    this.answered = true;
    this.total += 1;
    if (option.correct) this.score += 1;
    this.lastResult = {
      correct: option.correct,
      correctLabel: question.options.find((o) => o.correct)?.label,
      chosen: option.label,
    };
    this.emit();
    if (this.onSpeak) {
      this.onSpeak(
        option.correct
          ? `Correct. That is the ${question.part.name}.`
          : `Not quite. That is the ${question.part.name}.`,
      );
    }
    return this.lastResult;
  }

  next() {
    if (!this.questions.length) return;
    this.index = (this.index + 1) % this.questions.length;
    this.answered = false;
    this.lastResult = null;
    this.emit();
    this.announce();
  }

  announce() {
    const question = this.current();
    if (question && this.onSpeak) this.onSpeak(question.prompt);
  }

  emit() {
    if (this.onChange) {
      this.onChange({
        active: this.active,
        question: this.current(),
        answered: this.answered,
        result: this.lastResult,
        score: this.score,
        total: this.total,
        index: this.index,
        length: this.questions.length,
      });
    }
  }
}
