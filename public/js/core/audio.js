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

  blip({ freq = 440, duration = 0.18, type = 'sine', gainValue = 0.18, delay = 0 } = {}) {
    if (!this.state.audioEnabled || !this.context) return;
    const startTime = this.context.currentTime + Math.max(0, delay);
    const osc = this.context.createOscillator();
    const gain = this.context.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, startTime);
    gain.gain.setValueAtTime(gainValue, startTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
    osc.connect(gain).connect(this.master);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.05);
  }

  playNotification(type = 'info') {
    const presets = {
      join: { freq: 560, duration: 0.16, type: 'square', gainValue: 0.18 },
      success: { freq: 720, duration: 0.2, type: 'triangle', gainValue: 0.2 },
      warn: { freq: 360, duration: 0.22, type: 'sawtooth', gainValue: 0.22 },
      error: { freq: 280, duration: 0.26, type: 'sawtooth', gainValue: 0.24 },
      info: { freq: 480, duration: 0.18, type: 'sine', gainValue: 0.17 }
    };
    const preset = presets[type] || presets.info;
    this.blip(preset);
  }

  playCountdownTick() {
    this.blip({ freq: 520, duration: 0.12, type: 'triangle', gainValue: 0.18 });
  }

  playMatchStart() {
    this.blip({ freq: 640, duration: 0.14, type: 'square', gainValue: 0.22 });
    this.blip({ freq: 880, duration: 0.18, type: 'square', gainValue: 0.19, delay: 0.09 });
  }

  playMatchEnd() {
    this.blip({ freq: 420, duration: 0.22, type: 'triangle', gainValue: 0.21 });
    this.blip({ freq: 300, duration: 0.26, type: 'sine', gainValue: 0.18, delay: 0.12 });
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
