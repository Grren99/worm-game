import { TICK_RATE } from './state.js';

const POWERUP_COLORS = {
  speed: '#ffad14',
  shield: '#13c2c2',
  shrink: '#9254de'
};

export class Renderer {
  constructor({ state, elements }) {
    this.state = state;
    this.elements = elements;
    this.ctx = elements.canvasContext;
    this.replayCtx = elements.replayContext;
    this.particles = [];
    this.lastFrameTime = performance.now();
  }

  start() {
    const step = () => {
      this.renderFrame();
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);

    const replayStep = () => {
      this.renderReplayFrame();
      requestAnimationFrame(replayStep);
    };
    requestAnimationFrame(replayStep);
  }

  addParticleBurst({ x, y, color, count = 16, speed = 120, life = 450 }) {
    for (let i = 0; i < count; i += 1) {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.4;
      const velocity = speed * (0.6 + Math.random() * 0.4);
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * velocity,
        vy: Math.sin(angle) * velocity,
        life,
        maxLife: life,
        color
      });
    }
  }

  updateParticles(delta) {
    const next = [];
    for (const particle of this.particles) {
      particle.life -= delta;
      if (particle.life <= 0) continue;
      const progress = 1 - particle.life / particle.maxLife;
      particle.x += (particle.vx * delta) / 1000;
      particle.y += (particle.vy * delta) / 1000;
      particle.vy += 90 * (delta / 1000);
      particle.alpha = Math.max(0, 1 - progress);
      next.push(particle);
    }
    this.particles = next;
  }

  drawParticles(ctx) {
    if (!this.particles.length) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const particle of this.particles) {
      ctx.fillStyle = this.applyAlpha(particle.color, particle.alpha ?? 1);
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  applyAlpha(hexColor, alpha = 1) {
    const value = Math.max(0, Math.min(1, alpha));
    const intAlpha = Math.round(value * 255)
      .toString(16)
      .padStart(2, '0');
    if (hexColor.length === 7) {
      return `${hexColor}${intAlpha}`;
    }
    return hexColor;
  }

  drawGrid(ctx, width, height, spacing) {
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = spacing / 2; x <= width; x += spacing) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
    }
    for (let y = spacing / 2; y <= height; y += spacing) {
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
    }
    ctx.stroke();
  }

  drawFood(ctx, food = []) {
    food.forEach((item) => {
      const radius = item.type === 'golden' ? 10 : 7;
      const gradient = ctx.createRadialGradient(item.x, item.y, radius * 0.2, item.x, item.y, radius);
      if (item.type === 'golden') {
        gradient.addColorStop(0, '#fff7d6');
        gradient.addColorStop(1, '#f5b301');
      } else {
        gradient.addColorStop(0, '#b3ffec');
        gradient.addColorStop(1, '#1fb6ff');
      }
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(item.x, item.y, radius, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  drawPowerups(ctx, powerups = []) {
    powerups.forEach((power) => {
      ctx.save();
      ctx.translate(power.x, power.y);
      ctx.fillStyle = POWERUP_COLORS[power.type] || '#fff';
      ctx.strokeStyle = 'rgba(255,255,255,0.45)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      const size = 14;
      ctx.moveTo(0, -size);
      ctx.lineTo(size, 0);
      ctx.lineTo(0, size);
      ctx.lineTo(-size, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    });
  }

  drawPlayers(ctx, players = []) {
    players.forEach((player) => {
      const { segments = [], color, alive } = player;
      if (!segments.length) return;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.strokeStyle = `${color}b3`;
      ctx.fillStyle = color;
      for (let i = segments.length - 1; i >= 1; i -= 1) {
        const current = segments[i];
        const prev = segments[i - 1];
        ctx.strokeStyle = `${color}${alive ? '90' : '30'}`;
        ctx.lineWidth = 10;
        ctx.beginPath();
        ctx.moveTo(prev.x, prev.y);
        ctx.lineTo(current.x, current.y);
        ctx.stroke();
      }
      const head = segments[0];
      ctx.beginPath();
      ctx.fillStyle = alive ? color : `${color}55`;
      ctx.arc(head.x, head.y, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#0d1117';
      ctx.beginPath();
      ctx.arc(head.x + 2, head.y - 2, 2, 0, Math.PI * 2);
      ctx.arc(head.x - 2, head.y - 2, 2, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  renderFrame() {
    if (!this.ctx) return;
    const now = performance.now();
    const delta = now - this.lastFrameTime;
    this.lastFrameTime = now;
    this.updateParticles(delta);

    const gameState = this.state.replay.playing
      ? this.state.replay.frames[this.state.replay.index]
      : this.state.game;
    const world = this.state.world;
    if (!world || !gameState) {
      this.ctx.fillStyle = '#050505';
      this.ctx.fillRect(0, 0, this.elements.canvas.width, this.elements.canvas.height);
      return;
    }

    if (this.elements.canvas.width !== world.width || this.elements.canvas.height !== world.height) {
      this.elements.canvas.width = world.width;
      this.elements.canvas.height = world.height;
    }

    this.ctx.fillStyle = '#050510';
    this.ctx.fillRect(0, 0, world.width, world.height);
    this.drawGrid(this.ctx, world.width, world.height, world.segmentSize * 4);
    this.drawFood(this.ctx, gameState.food || []);
    this.drawPowerups(this.ctx, gameState.powerups || []);
    this.drawPlayers(this.ctx, gameState.players || []);
    this.drawParticles(this.ctx);
  }

  renderReplayFrame() {
    if (!this.replayCtx) return;
    const replay = this.state.replay;
    if (!replay.frames.length) {
      this.replayCtx.fillStyle = '#050505';
      this.replayCtx.fillRect(0, 0, this.elements.replayCanvas.width, this.elements.replayCanvas.height);
      return;
    }

    if (
      this.elements.replayCanvas.width !== this.state.world.width ||
      this.elements.replayCanvas.height !== this.state.world.height
    ) {
      this.elements.replayCanvas.width = this.state.world.width;
      this.elements.replayCanvas.height = this.state.world.height;
    }

    if (replay.playing) {
      const now = performance.now();
      if (!replay.lastUpdate) replay.lastUpdate = now;
      const delta = (now - replay.lastUpdate) / 1000;
      const advance = delta * TICK_RATE * replay.speed;
      if (advance >= 1) {
        replay.index = Math.min(replay.frames.length - 1, replay.index + Math.floor(advance));
        replay.lastUpdate = now;
        this.elements.replayProgress.value = replay.index;
        if (replay.index >= replay.frames.length - 1) {
          replay.playing = false;
        }
      }
    }

    const frame = replay.frames[replay.index];
    this.replayCtx.fillStyle = '#050510';
    this.replayCtx.fillRect(0, 0, this.state.world.width, this.state.world.height);
    this.drawGrid(this.replayCtx, this.state.world.width, this.state.world.height, this.state.world.segmentSize * 4);
    this.drawFood(this.replayCtx, frame.food || []);
    this.drawPowerups(this.replayCtx, frame.powerups || []);
    this.drawPlayers(this.replayCtx, frame.players || []);
  }
}
