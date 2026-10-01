export class Narrator {
  constructor() {
    this.enabled = false;
    this.rate = 1.02;
    this.voice = null;
    this.lastSpoken = '';
    this.lastAt = 0;
    this.supported = typeof speechSynthesis !== 'undefined';
    if (this.supported) {
      this.pickVoice();
      speechSynthesis.addEventListener('voiceschanged', () => this.pickVoice());
    }
  }

  pickVoice() {
    if (!this.supported) return;
    let voices = [];
    try {
      voices = speechSynthesis.getVoices() || [];
    } catch {
      voices = [];
    }
    if (!voices.length) return;
    const preferred = voices.find((v) => /en-GB/i.test(v.lang) && /female|Google UK/i.test(v.name));
    this.voice = preferred || voices.find((v) => /^en/i.test(v.lang)) || voices[0];
  }

  setEnabled(on) {
    this.enabled = on;
    if (!on) this.cancel();
  }

  cancel() {
    if (!this.supported) return;
    try {
      speechSynthesis.cancel();
    } catch {
      /* speech synthesis unavailable */
    }
  }

  say(text) {
    if (!this.enabled || !this.supported || !text) return;
    const now = performance.now();
    if (text === this.lastSpoken && now - this.lastAt < 4000) return;
    this.lastSpoken = text;
    this.lastAt = now;
    try {
      speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      if (this.voice) utterance.voice = this.voice;
      utterance.rate = this.rate;
      utterance.pitch = 1.0;
      speechSynthesis.speak(utterance);
    } catch {
      this.enabled = false;
    }
  }
}
