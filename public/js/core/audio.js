export class AudioManager {
  constructor(appState) {
    this.state = appState;
    this.context = null;
    this.master = null;
    this.bgm = null;
  }

  async setup() {
    if (this.context) return;
    this.context = new (window.AudioContext || window.webkitAudioContext)();
    this.master = this.context.createGain();
    this.master.gain.value = 0.18;
    this.master.connect(this.context.destination);
    this.state.audioReady = true;
  }

  async enable() {
    await this.setup();
    if (this.state.audioEnabled) return;
    if (this.context.state === 'suspended') {
      await this.context.resume();
    }
    this.state.audioEnabled = true;
    this.playBgm();
  }

  disable() {
    this.state.audioEnabled = false;
    this.stopBgm();
  }

  stopBgm() {
    if (!this.bgm) return;
    try {
      this.bgm.stop();
    } catch (error) {
      /* no-op */
    }
    this.bgm.disconnect();
    this.bgm = null;
  }

  playBgm() {
    if (!this.state.audioEnabled || !this.context) return;
    this.stopBgm();
    const osc = this.context.createOscillator();
    const gain = this.context.createGain();
    osc.type = 'triangle';
    osc.frequency.value = 96;
    const lfo = this.context.createOscillator();
    const lfoGain = this.context.createGain();
    lfo.frequency.value = 0.2;
    lfoGain.gain.value = 6;
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);
    gain.gain.value = 0.08;
    osc.connect(gain).connect(this.master);
    osc.start();
    lfo.start();
    this.bgm = osc;
  }

  blip({ freq = 440, duration = 0.18, type = 'sine', gainValue = 0.18 } = {}) {
    if (!this.state.audioEnabled || !this.context) return;
    const osc = this.context.createOscillator();
    const gain = this.context.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(gainValue, this.context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, this.context.currentTime + duration);
    osc.connect(gain).connect(this.master);
    osc.start();
    osc.stop(this.context.currentTime + duration + 0.05);
  }

  playFood() {
    this.blip({ freq: 660, duration: 0.12, type: 'triangle', gainValue: 0.2 });
  }

  playDeath() {
    this.blip({ freq: 120, duration: 0.45, type: 'sawtooth', gainValue: 0.25 });
  }

  playWin() {
    this.blip({ freq: 880, duration: 0.3, type: 'square', gainValue: 0.22 });
  }
}
