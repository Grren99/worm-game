import { TICK_RATE } from './state.js';

const POWERUP_AUDIO = {
  speed: {
    start: [
      { freq: 760, duration: 0.12, type: 'square', gainValue: 0.22, bus: 'powerup' },
      { freq: 1020, duration: 0.18, type: 'square', gainValue: 0.18, delay: 0.08, bus: 'powerup' }
    ],
    loop: {
      freq: 520,
      type: 'sawtooth',
      gain: 0.06,
      bus: 'powerup',
      fadeIn: 0.08,
      lfo: { freq: 4.2, depth: 12, type: 'sine' }
    },
    end: [
      { freq: 620, duration: 0.16, type: 'triangle', gainValue: 0.16, bus: 'powerup' },
      { freq: 360, duration: 0.26, type: 'sawtooth', gainValue: 0.18, delay: 0.06, bus: 'powerup' }
    ]
  },
  shield: {
    start: [
      { freq: 680, duration: 0.14, type: 'triangle', gainValue: 0.18, bus: 'powerup' },
      { freq: 840, duration: 0.18, type: 'sine', gainValue: 0.2, delay: 0.07, bus: 'powerup' },
      { freq: 980, duration: 0.16, type: 'sine', gainValue: 0.16, delay: 0.14, bus: 'powerup' }
    ],
    loop: {
      freq: 440,
      type: 'sine',
      gain: 0.05,
      bus: 'powerup',
      fadeIn: 0.12,
      lfo: { freq: 6.4, depth: 8, type: 'sine' }
    },
    end: [
      { freq: 520, duration: 0.14, type: 'triangle', gainValue: 0.14, bus: 'powerup' },
      { freq: 280, duration: 0.28, type: 'sine', gainValue: 0.16, delay: 0.08, bus: 'powerup' }
    ]
  },
  shrink: {
    start: [
      { freq: 420, duration: 0.16, type: 'triangle', gainValue: 0.2, bus: 'powerup' },
      { freq: 560, duration: 0.22, type: 'triangle', gainValue: 0.18, delay: 0.1, bus: 'powerup' }
    ],
    loop: {
      freq: 360,
      type: 'triangle',
      gain: 0.052,
      bus: 'powerup',
      fadeIn: 0.1,
      lfo: { freq: 3.1, depth: 18, type: 'triangle' }
    },
    end: [
      { freq: 340, duration: 0.16, type: 'triangle', gainValue: 0.16, bus: 'powerup' },
      { freq: 520, duration: 0.18, type: 'triangle', gainValue: 0.14, delay: 0.07, bus: 'powerup' }
    ]
  }
};

export class AudioManager {
  constructor(appState) {
    this.state = appState;
    this.context = null;
    this.master = null;
    this.busNodes = new Map();
    this.sfxGain = null;
    this.bgmGain = null;
    this.bgm = null;
    this.bgmLfo = null;
    this.bgmLfoGain = null;
    this.effectLoops = new Map();
  }

  async setup() {
    if (this.context) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) {
      console.warn('WebAudio가 지원되지 않아 사운드를 비활성화합니다.');
      return;
    }
    this.context = new Ctx();
    this.master = this.context.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(this.context.destination);
    this.busNodes.clear();
    this.createBus('sfx', { volume: this.getStoredSfxVolume(), parent: this.master });
    this.createBus('ui', { parent: 'sfx', volume: 1 });
    this.createBus('gameplay', { parent: 'sfx', volume: 1 });
    this.createBus('powerup', { parent: 'gameplay', volume: 1 });
    this.createBus('spectator', { parent: 'ui', volume: 0.9 });
    this.createBus('bgm', { parent: this.master, volume: 0.08 });
    this.sfxGain = this.getBus('sfx');
    this.bgmGain = this.getBus('bgm');
    this.state.audioReady = true;
  }

  getBus(name) {
    return this.busNodes.get(name) || null;
  }

  createBus(name, { volume = 1, parent } = {}) {
    if (!this.context) return null;
    if (this.busNodes.has(name)) return this.busNodes.get(name);
    const gain = this.context.createGain();
    gain.gain.value = volume;
    let target = null;
    if (parent && typeof parent.connect === 'function') {
      target = parent;
    } else if (typeof parent === 'string') {
      target = this.busNodes.get(parent) || null;
    }
    if (!target) {
      target = this.master;
    }
    if (target) {
      gain.connect(target);
    }
    this.busNodes.set(name, gain);
    return gain;
  }

  async enable() {
    await this.setup();
    if (!this.context || this.state.audioEnabled) return;
    if (this.context.state === 'suspended') {
      await this.context.resume();
    }
    this.state.audioEnabled = true;
    this.setSfxVolume(this.getStoredSfxVolume());
    this.playBgm();
    this.syncActiveEffectLoops();
  }

  disable() {
    if (!this.context) return;
    this.state.audioEnabled = false;
    this.stopBgm();
    this.stopAllEffectLoops({ playTail: false });
  }

  stopBgm() {
    if (this.bgm) {
      try {
        this.bgm.stop();
      } catch (error) {
        /* no-op */
      }
      this.bgm.disconnect();
      this.bgm = null;
    }
    if (this.bgmLfo) {
      try {
        this.bgmLfo.stop();
      } catch (error) {
        /* no-op */
      }
      this.bgmLfo.disconnect();
      this.bgmLfo = null;
    }
    if (this.bgmLfoGain) {
      try {
        this.bgmLfoGain.disconnect();
      } catch (error) {
        /* no-op */
      }
      this.bgmLfoGain = null;
    }
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
    const target = this.bgmGain || this.master;
    osc.connect(gain).connect(target);
    osc.start();
    lfo.start();
    this.bgm = osc;
    this.bgmLfo = lfo;
    this.bgmLfoGain = lfoGain;
  }

  blip(config = {}, defaultBus = 'sfx') {
    if (!this.state.audioEnabled || !this.context) return;
    const {
      freq = 440,
      duration = 0.18,
      type = 'sine',
      gainValue = 0.18,
      delay = 0,
      bus
    } = config;
    const target = this.getBus(bus || defaultBus) || this.sfxGain || this.master;
    const startTime = this.context.currentTime + Math.max(0, delay);
    const osc = this.context.createOscillator();
    const gain = this.context.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, startTime);
    const clampedGain = Math.max(0, gainValue);
    gain.gain.setValueAtTime(Math.max(0.0001, clampedGain), startTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
    osc.connect(gain).connect(target);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.05);
  }

  playSequence(sequence = [], { intensity = 1, defaultBus = 'sfx' } = {}) {
    if (!Array.isArray(sequence) || !sequence.length) return;
    const safeIntensity = Number.isFinite(intensity) ? Math.max(0, intensity) : 1;
    sequence.forEach((note) => {
      if (!note) return;
      const baseGain = typeof note.gainValue === 'number' ? note.gainValue : 0.18;
      this.blip({ ...note, gainValue: baseGain * safeIntensity }, note.bus || defaultBus);
    });
  }

  clampVolume(value) {
    if (Number.isNaN(value)) return 0;
    return Math.max(0, Math.min(1, value));
  }

  getStoredSfxVolume() {
    const volume = this.state.audioSettings?.sfxVolume;
    if (typeof volume === 'number') {
      return this.clampVolume(volume);
    }
    return 0.7;
  }

  setSfxVolume(volume) {
    const clamped = this.clampVolume(volume);
    if (!this.state.audioSettings) {
      this.state.audioSettings = { sfxVolume: clamped };
    } else {
      this.state.audioSettings.sfxVolume = clamped;
    }
    const bus = this.getBus('sfx');
    if (bus) {
      bus.gain.value = clamped;
    }
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
    this.blip({ ...preset, bus: 'ui' });
  }

  playEventCue(event = {}, { index = 0, total = 1 } = {}) {
    if (!this.state.audioEnabled) return;
    const safeIndex = Number.isFinite(index) ? Math.max(0, index) : 0;
    const damp = Math.max(0.38, 1 - safeIndex * 0.22);
    const type = event?.type || 'info';
    switch (type) {
      case 'kill': {
        this.playSequence(
          [
            { freq: 760, duration: 0.12, type: 'square', gainValue: 0.26, bus: 'ui' },
            { freq: 420, duration: 0.22, type: 'sawtooth', gainValue: 0.28, delay: 0.08, bus: 'ui' }
          ],
          { intensity: damp, defaultBus: 'ui' }
        );
        break;
      }
      case 'golden-food': {
        this.playSequence(
          [
            { freq: 880, duration: 0.14, type: 'triangle', gainValue: 0.22, bus: 'ui' },
            { freq: 1040, duration: 0.18, type: 'sine', gainValue: 0.18, delay: 0.06, bus: 'ui' },
            { freq: 1320, duration: 0.16, type: 'triangle', gainValue: 0.14, delay: 0.14, bus: 'ui' }
          ],
          { intensity: damp, defaultBus: 'ui' }
        );
        break;
      }
      case 'powerup': {
        const kind = event?.meta?.powerup;
        const base = kind === 'shield' ? 640 : kind === 'shrink' ? 520 : 760;
        this.playSequence(
          [
            { freq: base, duration: 0.12, type: 'triangle', gainValue: 0.18, bus: 'ui' },
            { freq: base + 140, duration: 0.14, type: 'sine', gainValue: 0.16, delay: 0.07, bus: 'ui' }
          ],
          { intensity: damp, defaultBus: 'ui' }
        );
        break;
      }
      case 'round-end': {
        this.playSequence(
          [
            { freq: 600, duration: 0.18, type: 'triangle', gainValue: 0.2, bus: 'ui' },
            { freq: 460, duration: 0.26, type: 'sawtooth', gainValue: 0.24, delay: 0.1, bus: 'ui' }
          ],
          { intensity: damp, defaultBus: 'ui' }
        );
        break;
      }
      default: {
        this.blip({ freq: 540, duration: 0.16, type: 'triangle', gainValue: 0.18, bus: 'ui' });
      }
    }
  }

  playCountdownTick() {
    this.blip({ freq: 520, duration: 0.12, type: 'triangle', gainValue: 0.18, bus: 'ui' });
  }

  playMatchStart() {
    this.playSequence(
      [
        { freq: 640, duration: 0.14, type: 'square', gainValue: 0.22, bus: 'gameplay' },
        { freq: 880, duration: 0.18, type: 'square', gainValue: 0.19, delay: 0.09, bus: 'gameplay' }
      ],
      { defaultBus: 'gameplay' }
    );
  }

  playMatchEnd() {
    this.playSequence(
      [
        { freq: 420, duration: 0.22, type: 'triangle', gainValue: 0.21, bus: 'gameplay' },
        { freq: 300, duration: 0.26, type: 'sine', gainValue: 0.18, delay: 0.12, bus: 'gameplay' }
      ],
      { defaultBus: 'gameplay' }
    );
  }

  playFood() {
    this.blip({ freq: 660, duration: 0.12, type: 'triangle', gainValue: 0.2, bus: 'gameplay' });
  }

  playDeath() {
    this.blip({ freq: 120, duration: 0.45, type: 'sawtooth', gainValue: 0.25, bus: 'gameplay' });
  }

  playWin() {
    this.blip({ freq: 880, duration: 0.3, type: 'square', gainValue: 0.22, bus: 'gameplay' });
  }

  playSpectatorFocus({ subtle = false } = {}) {
    const base = subtle ? 0.16 : 0.2;
    this.blip({
      freq: subtle ? 660 : 720,
      duration: base,
      type: 'triangle',
      gainValue: subtle ? 0.14 : 0.18,
      bus: 'spectator'
    });
  }

  playSpectatorLock(locked) {
    if (locked) {
      this.playSequence(
        [
          { freq: 500, duration: 0.18, type: 'square', gainValue: 0.2 },
          { freq: 640, duration: 0.16, type: 'square', gainValue: 0.16, delay: 0.08 }
        ],
        { defaultBus: 'spectator' }
      );
    } else {
      this.blip({ freq: 380, duration: 0.18, type: 'triangle', gainValue: 0.18, bus: 'spectator' });
    }
  }

  playPowerupStart(effect, { scope = 'self' } = {}) {
    const definition = POWERUP_AUDIO[effect];
    if (!definition?.start) return;
    const intensity = scope === 'self' ? 1 : 0.6;
    this.playSequence(definition.start, { intensity, defaultBus: 'powerup' });
  }

  playPowerupEnd(effect, { scope = 'self' } = {}) {
    const definition = POWERUP_AUDIO[effect];
    if (!definition?.end) return;
    const intensity = scope === 'self' ? 1 : 0.55;
    this.playSequence(definition.end, { intensity, defaultBus: 'powerup' });
  }

  playPowerupWarning(effect, { critical = false } = {}) {
    if (!this.state.audioEnabled) return;
    const baseFreq =
      effect === 'speed' ? 780 : effect === 'shield' ? 620 : effect === 'shrink' ? 540 : 600;
    const steps = critical
      ? [
          { freq: baseFreq + 40, duration: 0.12, type: 'square', gainValue: 0.2 },
          { freq: baseFreq - 140, duration: 0.16, type: 'triangle', gainValue: 0.18, delay: 0.06 }
        ]
      : [
          { freq: baseFreq - 20, duration: 0.1, type: 'square', gainValue: 0.16 },
          { freq: baseFreq + 80, duration: 0.12, type: 'triangle', gainValue: 0.12, delay: 0.05 }
        ];
    this.playSequence(steps, { defaultBus: 'powerup' });
  }

  startEffectLoop(effect, { playIntro = true } = {}) {
    if (!this.state.audioEnabled || !this.context) return;
    if (this.effectLoops.has(effect)) return;
    const definition = POWERUP_AUDIO[effect];
    const config = definition?.loop;
    if (!config) {
      if (playIntro) this.playPowerupStart(effect, { scope: 'self' });
      return;
    }
    const bus = this.getBus(config.bus) || this.getBus('powerup') || this.sfxGain || this.master;
    const osc = this.context.createOscillator();
    const gain = this.context.createGain();
    const now = this.context.currentTime;
    osc.type = config.type || 'sine';
    osc.frequency.value = config.freq || 440;
    gain.gain.value = 0.0001;
    gain.connect(bus);
    osc.connect(gain);
    let lfo = null;
    let lfoGain = null;
    if (config.lfo) {
      lfo = this.context.createOscillator();
      lfo.type = config.lfo.type || 'sine';
      lfo.frequency.value = config.lfo.freq || 4;
      lfoGain = this.context.createGain();
      lfoGain.gain.value = config.lfo.depth || 10;
      lfo.connect(lfoGain).connect(osc.frequency);
      lfo.start(now);
    }
    if (playIntro) {
      this.playPowerupStart(effect, { scope: 'self' });
    }
    const targetGain = Math.max(0.0001, config.gain ?? 0.05);
    const fadeIn = Math.max(0.02, config.fadeIn ?? 0.1);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(targetGain, now + fadeIn);
    osc.start(now);
    this.effectLoops.set(effect, { osc, gain, lfo, lfoGain, defaultGain: targetGain, stage: 'normal' });
  }

  stopEffectLoop(effect, { playTail = true, immediate = false } = {}) {
    const loop = this.effectLoops.get(effect);
    if (!loop) {
      if (playTail) this.playPowerupEnd(effect, { scope: 'self' });
      return;
    }
    const now = this.context?.currentTime ?? 0;
    const stopAt = immediate ? now + 0.05 : now + 0.3;
    try {
      loop.gain.gain.cancelScheduledValues(now);
      const current = loop.gain.gain.value || 0.0001;
      loop.gain.gain.setValueAtTime(current, now);
      loop.gain.gain.exponentialRampToValueAtTime(0.0001, Math.max(now + 0.05, stopAt - 0.05));
      loop.osc.stop(stopAt);
    } catch (error) {
      /* no-op */
    }
    loop.osc.onended = () => {
      try {
        loop.osc.disconnect();
        loop.gain.disconnect();
        if (loop.lfo) {
          try {
            loop.lfo.stop();
          } catch (error) {
            /* no-op */
          }
          loop.lfo.disconnect();
        }
        if (loop.lfoGain) {
          loop.lfoGain.disconnect();
        }
      } catch (error) {
        /* no-op */
      }
    };
    this.effectLoops.delete(effect);
    if (playTail) {
      this.playPowerupEnd(effect, { scope: 'self' });
    }
  }

  stopAllEffectLoops({ playTail = false } = {}) {
    for (const effect of [...this.effectLoops.keys()]) {
      this.stopEffectLoop(effect, { playTail, immediate: true });
    }
  }

  syncActiveEffectLoops() {
    if (!this.state.playerId || !this.state.game?.players) return;
    const me = this.state.game.players.find((player) => player.id === this.state.playerId);
    if (!me) {
      this.stopAllEffectLoops({ playTail: false });
      return;
    }
    const effectTypes = Array.isArray(me.effectTypes)
      ? me.effectTypes
      : (me.effects || [])
          .map((effect) => (typeof effect === 'string' ? effect : effect?.type))
          .filter(Boolean);
    const active = new Set(effectTypes);
    for (const effect of active) {
      this.startEffectLoop(effect, { playIntro: false });
    }
    for (const effect of [...this.effectLoops.keys()]) {
      if (!active.has(effect)) {
        this.stopEffectLoop(effect, { playTail: false, immediate: true });
      }
    }
  }

  adjustEffectLoopGain(loop, target, duration = 0.2) {
    if (!this.context || !loop?.gain) return;
    const now = this.context.currentTime;
    const safeCurrent = Math.max(0.0001, loop.gain.gain.value || loop.defaultGain || 0.0001);
    const safeTarget = Math.max(0.0001, target);
    loop.gain.gain.cancelScheduledValues(now);
    loop.gain.gain.setValueAtTime(safeCurrent, now);
    loop.gain.gain.linearRampToValueAtTime(safeTarget, now + Math.max(0.05, duration));
  }

  applyEffectDynamics(effects = []) {
    if (!this.context || !this.state.audioEnabled) return;
    const effectMap = new Map();
    (Array.isArray(effects) ? effects : []).forEach((entry) => {
      if (typeof entry === 'string') {
        effectMap.set(entry, { remaining: null, total: null });
        return;
      }
      if (!entry || typeof entry !== 'object') return;
      const type = entry.type || entry.effect || entry.name;
      if (!type) return;
      effectMap.set(type, {
        remaining: Number.isFinite(entry.remaining) ? entry.remaining : null,
        total: Number.isFinite(entry.total) ? entry.total : null
      });
    });

    for (const [effect, loop] of this.effectLoops.entries()) {
      const meta = effectMap.get(effect);
      if (!meta) {
        if (loop.stage !== 'normal') {
          this.adjustEffectLoopGain(loop, loop.defaultGain || 0.05);
          loop.stage = 'normal';
        }
        continue;
      }

      const { remaining, total } = meta;
      if (!Number.isFinite(remaining) || !Number.isFinite(total) || total <= 0) {
        if (loop.stage !== 'normal') {
          this.adjustEffectLoopGain(loop, loop.defaultGain || 0.05);
          loop.stage = 'normal';
        }
        continue;
      }

      const ratio = Math.max(0, Math.min(1, remaining / total));
      let nextStage = 'normal';
      if (ratio <= 0.15) {
        nextStage = 'critical';
      } else if (ratio <= 0.35) {
        nextStage = 'warning';
      }

      if (loop.stage === nextStage) continue;

      if (nextStage === 'normal') {
        this.adjustEffectLoopGain(loop, loop.defaultGain || 0.05, 0.24);
      } else if (nextStage === 'warning') {
        const ramp = Math.max(0.12, (remaining / TICK_RATE) * 0.5);
        this.adjustEffectLoopGain(loop, (loop.defaultGain || 0.05) * 0.7, ramp);
        this.playPowerupWarning(effect, { critical: false });
      } else if (nextStage === 'critical') {
        const ramp = Math.max(0.1, (remaining / TICK_RATE) * 0.4);
        this.adjustEffectLoopGain(loop, Math.max(0.0001, (loop.defaultGain || 0.05) * 0.35), ramp);
        this.playPowerupWarning(effect, { critical: true });
      }

      loop.stage = nextStage;
    }
  }
}
