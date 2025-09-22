const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');

const PORT = process.env.PORT || 3000;
const STATIC_DIR = path.join(__dirname, 'public');

const WORLD_WIDTH = 1600;
const WORLD_HEIGHT = 900;
const SEGMENT_SIZE = 12;
const TICK_RATE = 20;
const MAX_PLAYERS_PER_ROOM = 8;
const DEFAULT_MODE_KEY = 'classic';

const PLAYER_COLORS = [
  '#ff4d4f',
  '#40a9ff',
  '#52c41a',
  '#faad14',
  '#9254de',
  '#fa541c',
  '#eb2f96',
  '#13c2c2'
];

const POWERUP_TYPES = {
  SPEED: 'speed',
  SHIELD: 'shield',
  SHRINK: 'shrink'
};

const POWERUP_EFFECT_TICKS = {
  [POWERUP_TYPES.SPEED]: TICK_RATE * 6,
  [POWERUP_TYPES.SHIELD]: TICK_RATE * 5,
  [POWERUP_TYPES.SHRINK]: TICK_RATE * 1
};

const FOOD_TYPES = {
  BASIC: 'basic',
  GOLDEN: 'golden'
};

const FOOD_SCORES = {
  [FOOD_TYPES.BASIC]: 10,
  [FOOD_TYPES.GOLDEN]: 50
};

const POWERUP_SCORES = {
  [POWERUP_TYPES.SPEED]: 20,
  [POWERUP_TYPES.SHIELD]: 20,
  [POWERUP_TYPES.SHRINK]: 15
};

const GAME_MODES = {
  classic: {
    key: 'classic',
    label: '클래식 모드',
    description: '표준 규격의 밸런스 모드',
    settings: {
      baseSpeed: 4,
      speedBoostMultiplier: 1.6,
      maxFood: 30,
      goldenFoodChance: 0.08,
      maxPowerups: 6,
      powerupSpawnChance: 0.05,
      countdownSeconds: 5,
      intermissionSeconds: 4,
      survivalBonusPerSecond: 2,
      winBonus: 200
    }
  },
  battle: {
    key: 'battle',
    label: '배틀 모드',
    description: '음식과 파워업이 풍부한 전투 모드',
    settings: {
      baseSpeed: 4,
      speedBoostMultiplier: 1.5,
      maxFood: 48,
      goldenFoodChance: 0.14,
      maxPowerups: 10,
      powerupSpawnChance: 0.12,
      countdownSeconds: 5,
      intermissionSeconds: 5,
      survivalBonusPerSecond: 3,
      winBonus: 220
    }
  },
  speed: {
    key: 'speed',
    label: '스피드 모드',
    description: '더 빠르고 치열한 속도전',
    settings: {
      baseSpeed: 5,
      speedBoostMultiplier: 1.85,
      maxFood: 26,
      goldenFoodChance: 0.1,
      maxPowerups: 5,
      powerupSpawnChance: 0.04,
      countdownSeconds: 4,
      intermissionSeconds: 3,
      survivalBonusPerSecond: 1,
      winBonus: 240
    }
  },
  tournament: {
    key: 'tournament',
    label: '토너먼트 모드',
    description: '여러 라운드로 최종 우승자를 결정',
    settings: {
      baseSpeed: 4,
      speedBoostMultiplier: 1.6,
      maxFood: 32,
      goldenFoodChance: 0.1,
      maxPowerups: 8,
      powerupSpawnChance: 0.08,
      countdownSeconds: 6,
      intermissionSeconds: 6,
      survivalBonusPerSecond: 3,
      winBonus: 180
    },
    tournament: {
      roundsToWin: 3,
      intermissionSeconds: 8
    }
  }
};

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*'
  }
});

const resolveMode = (modeKey) => {
  return GAME_MODES[modeKey] || GAME_MODES[DEFAULT_MODE_KEY];
};

app.use(express.static(STATIC_DIR));

const rooms = new Map();
const globalStats = new Map();

const clamp = (value, min, max) => Math.max(min, Math.min(value, max));

const randomCoord = () => ({
  x: Math.floor(Math.random() * (WORLD_WIDTH / SEGMENT_SIZE)) * SEGMENT_SIZE + SEGMENT_SIZE / 2,
  y: Math.floor(Math.random() * (WORLD_HEIGHT / SEGMENT_SIZE)) * SEGMENT_SIZE + SEGMENT_SIZE / 2
});

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

class PlayerState {
  constructor({ id, name, color, socketId }) {
    this.id = id;
    this.name = name;
    this.color = color;
    this.socketId = socketId;
    this.reset();
  }

  reset({ baseSpeed } = {}) {
    const effectiveBase = typeof baseSpeed === 'number' ? baseSpeed : this.baseSpeed || 4;
    this.alive = true;
    this.direction = { x: 1, y: 0 };
    this.pendingDirection = { x: 1, y: 0 };
    this.segments = PlayerState.initialBody();
    this.growth = 0;
    this.baseSpeed = effectiveBase;
    this.speed = effectiveBase;
    this.effects = new Map();
    this.score = 0;
    this.kills = 0;
    this.lastTail = null;
    this.survivalTicks = 0;
    this.spawnTime = Date.now();
    this.survivalBonus = 0;
  }

  static initialBody() {
    const start = randomCoord();
    return [start];
  }
}

class RoomState {
  constructor({ id, name, hostId, isPrivate, modeKey }) {
    this.id = id;
    this.name = name;
    this.hostId = hostId;
    this.isPrivate = Boolean(isPrivate);
    this.mode = resolveMode(modeKey);
    this.modeKey = this.mode.key;
    this.settings = { ...this.mode.settings };
    this.players = new Map();
    this.spectators = new Set();
    this.colorsInUse = new Set();
    this.food = [];
    this.powerups = [];
    this.phase = 'waiting';
    this.countdownTicks = 0;
    this.intermissionTicks = 0;
    this.frameHistory = [];
    this.round = 0;
    this.loop = null;
    this.tournament = this.mode.tournament
      ? {
          roundsToWin: this.mode.tournament.roundsToWin,
          intermissionSeconds: this.mode.tournament.intermissionSeconds,
          wins: new Map(),
          championId: null
        }
      : null;
  }

  assignColor(preferredColor) {
    if (preferredColor && PLAYER_COLORS.includes(preferredColor) && !this.colorsInUse.has(preferredColor)) {
      this.colorsInUse.add(preferredColor);
      return preferredColor;
    }
    for (const color of PLAYER_COLORS) {
      if (!this.colorsInUse.has(color)) {
        this.colorsInUse.add(color);
        return color;
      }
    }
    return PLAYER_COLORS[Math.floor(Math.random() * PLAYER_COLORS.length)];
  }

  isColorAvailable(color, ignorePlayerId) {
    if (!PLAYER_COLORS.includes(color)) return false;
    if (!this.colorsInUse.has(color)) return true;
    for (const player of this.players.values()) {
      if (player.id === ignorePlayerId) continue;
      if (player.color === color) {
        return false;
      }
    }
    return true;
  }

  changePlayerColor(playerId, color) {
    const player = this.players.get(playerId);
    if (!player) {
      return { error: '플레이어를 찾을 수 없습니다.' };
    }
    if (this.phase === 'running') {
      return { error: '게임 중에는 색상을 변경할 수 없습니다.' };
    }
    if (!this.isColorAvailable(color, playerId)) {
      return { error: '해당 색상은 사용할 수 없습니다.' };
    }
    this.colorsInUse.delete(player.color);
    player.color = color;
    this.colorsInUse.add(color);
    return { success: true, color };
  }

  addPlayer(player) {
    this.players.set(player.id, player);
    this.spectators.delete(player.socketId);
    this.ensureLoop();
  }

  removePlayer(playerId) {
    const player = this.players.get(playerId);
    if (!player) return;
    this.colorsInUse.delete(player.color);
    this.players.delete(playerId);
  }

  ensureLoop() {
    if (!this.loop) {
      this.loop = setInterval(() => this.update(), 1000 / TICK_RATE);
    }
  }

  beginCountdown() {
    if (this.players.size < 2) {
      this.phase = 'waiting';
      this.countdownTicks = 0;
      return;
    }
    this.phase = 'countdown';
    const seconds = this.settings.countdownSeconds || 5;
    this.countdownTicks = Math.max(1, Math.round(seconds * TICK_RATE));
    this.frameHistory = [];
  }

  stopLoopIfEmpty() {
    if (this.loop && this.players.size === 0 && this.spectators.size === 0) {
      clearInterval(this.loop);
      this.loop = null;
    }
  }

  broadcast(event, payload) {
    io.to(this.id).emit(event, payload);
  }

  tickPhase() {
    if (this.phase === 'waiting') {
      if (this.players.size >= 2) {
        this.beginCountdown();
      }
    } else if (this.phase === 'countdown') {
      if (this.players.size < 2) {
        this.phase = 'waiting';
        this.countdownTicks = 0;
        return;
      }
      this.countdownTicks -= 1;
      if (this.countdownTicks <= 0) {
        this.startMatch();
      }
    } else if (this.phase === 'intermission') {
      if (this.players.size < 2) {
        this.phase = 'waiting';
        this.intermissionTicks = 0;
        return;
      }
      if (this.tournament?.championId) {
        this.phase = 'waiting';
        return;
      }
      this.intermissionTicks -= 1;
      if (this.intermissionTicks <= 0) {
        this.beginCountdown();
      }
    }
  }

  startMatch() {
    if (this.players.size < 2) {
      this.phase = 'waiting';
      this.food = [];
      this.powerups = [];
      return;
    }
    this.phase = 'running';
    this.round += 1;
    this.frameHistory = [];
    for (const player of this.players.values()) {
      player.reset({ baseSpeed: this.settings.baseSpeed });
    }
    this.food = [];
    this.powerups = [];
    while (this.food.length < this.settings.maxFood) {
      this.spawnFood();
    }
    this.intermissionTicks = 0;
  }

  spawnFood() {
    const type = Math.random() < (this.settings.goldenFoodChance || 0.08) ? FOOD_TYPES.GOLDEN : FOOD_TYPES.BASIC;
    const coord = randomCoord();
    this.food.push({
      id: uuidv4(),
      type,
      x: coord.x,
      y: coord.y
    });
  }

  spawnPowerup() {
    const types = Object.values(POWERUP_TYPES);
    const type = types[Math.floor(Math.random() * types.length)];
    const coord = randomCoord();
    this.powerups.push({
      id: uuidv4(),
      type,
      x: coord.x,
      y: coord.y
    });
  }

  handleMovement(player) {
    if (!player.alive) return;
    player.direction = player.pendingDirection;
    const head = player.segments[0];
    const boostMultiplier = player.effects.has(POWERUP_TYPES.SPEED) ? this.settings.speedBoostMultiplier : 1;
    const dx = player.direction.x * player.speed * boostMultiplier;
    const dy = player.direction.y * player.speed * boostMultiplier;
    const newHead = {
      x: head.x + dx,
      y: head.y + dy
    };

    const clampedX = clamp(newHead.x, SEGMENT_SIZE / 2, WORLD_WIDTH - SEGMENT_SIZE / 2);
    const clampedY = clamp(newHead.y, SEGMENT_SIZE / 2, WORLD_HEIGHT - SEGMENT_SIZE / 2);
    if (clampedX !== newHead.x || clampedY !== newHead.y) {
      this.killPlayer(player, null, 'wall');
      return;
    }

    player.segments.unshift(newHead);
    if (player.growth > 0) {
      player.growth -= 1;
    } else {
      player.lastTail = player.segments.pop();
    }
    player.survivalTicks += 1;
  }

  handleFoodAndPowerups(player) {
    if (!player.alive) return;
    const head = player.segments[0];
    for (let i = this.food.length - 1; i >= 0; i -= 1) {
      const meal = this.food[i];
      if (distance(head, meal) < SEGMENT_SIZE) {
        player.score += FOOD_SCORES[meal.type];
        player.growth += meal.type === FOOD_TYPES.GOLDEN ? 6 : 3;
        if (meal.type === FOOD_TYPES.GOLDEN) {
          player.speed = player.baseSpeed + 1;
        }
        this.food.splice(i, 1);
        this.spawnFood();
      }
    }

    for (let i = this.powerups.length - 1; i >= 0; i -= 1) {
      const power = this.powerups[i];
      if (distance(head, power) < SEGMENT_SIZE) {
        player.score += POWERUP_SCORES[power.type];
        this.applyPowerup(player, power.type);
        this.powerups.splice(i, 1);
      }
    }

    const foodRespawnChance = this.settings.foodRespawnChance ?? 0.2;
    if (this.food.length < this.settings.maxFood && Math.random() < foodRespawnChance) {
      this.spawnFood();
    }
    if (this.powerups.length < this.settings.maxPowerups && Math.random() < (this.settings.powerupSpawnChance || 0.05)) {
      this.spawnPowerup();
    }
  }

  applyPowerup(player, type) {
    if (type === POWERUP_TYPES.SHRINK) {
      const removeCount = Math.floor(player.segments.length * 0.25);
      for (let i = 0; i < removeCount; i += 1) {
        if (player.segments.length > 1) {
          player.segments.pop();
        }
      }
    }
    player.effects.set(type, POWERUP_EFFECT_TICKS[type] || TICK_RATE * 4);
  }

  handleEffectTimers(player) {
    for (const [effect, ticks] of [...player.effects.entries()]) {
      const next = ticks - 1;
      if (next <= 0) {
        if (effect === POWERUP_TYPES.SPEED) {
          player.speed = player.baseSpeed;
        }
        player.effects.delete(effect);
      } else {
        player.effects.set(effect, next);
      }
    }
  }

  handleCollisions() {
    const alivePlayers = [...this.players.values()].filter((p) => p.alive);
    for (const player of alivePlayers) {
      const head = player.segments[0];
      for (const other of this.players.values()) {
        if (!other.alive) continue;
        const segments = other.segments;
        const startIndex = other === player ? 1 : 0;
        for (let i = startIndex; i < segments.length; i += 1) {
          if (distance(head, segments[i]) < SEGMENT_SIZE * 0.8) {
            if (player.effects.has(POWERUP_TYPES.SHIELD)) {
              player.effects.delete(POWERUP_TYPES.SHIELD);
              continue;
            }
            this.killPlayer(player, other.id, 'collision');
            break;
          }
        }
        if (!player.alive) break;
      }
    }
  }

  applySurvivalBonuses() {
    const bonusPerSecond = this.settings.survivalBonusPerSecond || 0;
    if (!bonusPerSecond) return;
    for (const player of this.players.values()) {
      const seconds = Math.floor(player.survivalTicks / TICK_RATE);
      if (seconds <= 0) continue;
      const bonus = seconds * bonusPerSecond;
      player.score += bonus;
      player.survivalBonus = bonus;
    }
  }

  handleTournamentOutcome(winner) {
    if (!this.tournament || !winner) return;
    const wins = this.tournament.wins;
    const current = (wins.get(winner.id) || 0) + 1;
    wins.set(winner.id, current);
    this.tournament.lastWinnerId = winner.id;
    if (current >= this.tournament.roundsToWin) {
      this.tournament.championId = winner.id;
      this.tournament.championAnnouncedAt = Date.now();
    }
  }

  serializeTournament() {
    if (!this.tournament) return { enabled: false };
    const wins = [...this.tournament.wins.entries()].map(([playerId, winCount]) => {
      const player = this.players.get(playerId);
      return {
        playerId,
        wins: winCount,
        name: player?.name || '탈퇴한 플레이어',
        color: player?.color || PLAYER_COLORS[0]
      };
    });
    for (const player of this.players.values()) {
      if (!wins.find((entry) => entry.playerId === player.id)) {
        wins.push({
          playerId: player.id,
          wins: 0,
          name: player.name,
          color: player.color
        });
      }
    }
    wins.sort((a, b) => {
      if (b.wins !== a.wins) return b.wins - a.wins;
      return a.name.localeCompare(b.name);
    });
    return {
      enabled: true,
      roundsToWin: this.tournament.roundsToWin,
      wins,
      championId: this.tournament.championId,
      lastWinnerId: this.tournament.lastWinnerId || null,
      currentRound: this.round,
      intermissionRemaining: this.phase === 'intermission' ? Math.ceil(this.intermissionTicks / TICK_RATE) : 0
    };
  }

  killPlayer(player, killerId, cause) {
    if (!player.alive) return;
    player.alive = false;
    player.deathCause = cause;
    player.deathTick = Date.now();
    if (killerId && killerId !== player.id) {
      const killer = this.players.get(killerId);
      if (killer) {
        killer.score += 100;
        killer.kills += 1;
      }
    }
    if (player.lastTail) {
      this.food.push({
        id: uuidv4(),
        type: FOOD_TYPES.BASIC,
        x: player.lastTail.x,
        y: player.lastTail.y
      });
    }
  }

  checkMatchEnd() {
    if (this.phase !== 'running') return;
    const alive = [...this.players.values()].filter((p) => p.alive);
    if (alive.length <= 1) {
      const winner = alive[0] || null;
      if (winner) {
        winner.score += this.settings.winBonus || 0;
      }
      this.applySurvivalBonuses();
      if (this.tournament) {
        this.handleTournamentOutcome(winner);
      }
      if (winner && this.tournament?.championId === winner.id) {
        this.broadcast('room:notification', {
          id: uuidv4(),
          type: 'success',
          message: `${winner.name}님이 토너먼트 우승을 차지했습니다!`,
          timestamp: Date.now()
        });
      }
      for (const player of this.players.values()) {
        const isWinner = winner ? winner.id === player.id : false;
        const isChampion = this.tournament?.championId === player.id;
        this.recordGlobalStats(player, isChampion || isWinner);
      }
      this.broadcast('game:ended', {
        winnerId: winner?.id || null,
        leaderboard: this.buildLeaderboard(),
        tournament: this.serializeTournament()
      });
      if (this.tournament && !this.tournament.championId && this.players.size >= 2) {
        this.phase = 'intermission';
        const waitSeconds = this.tournament.intermissionSeconds || this.settings.intermissionSeconds || 5;
        this.intermissionTicks = Math.max(1, Math.round(waitSeconds * TICK_RATE));
      } else {
        this.phase = 'ended';
      }
    }
  }

  recordGlobalStats(player, isWinner) {
    const stats = globalStats.get(player.name) || {
      games: 0,
      wins: 0,
      totalScore: 0,
      totalSurvivalTicks: 0,
      kills: 0
    };
    stats.games += 1;
    stats.totalScore += player.score;
    stats.totalSurvivalTicks += player.survivalTicks;
    stats.kills += player.kills;
    if (isWinner) stats.wins += 1;
    globalStats.set(player.name, stats);
  }

  serialize() {
    return {
      id: this.id,
      name: this.name,
      mode: {
        key: this.modeKey,
        label: this.mode.label,
        description: this.mode.description
      },
      phase: this.phase,
      countdown: Math.ceil(this.countdownTicks / TICK_RATE),
      intermission: this.phase === 'intermission' ? Math.ceil(this.intermissionTicks / TICK_RATE) : 0,
      players: [...this.players.values()].map((player) => ({
        id: player.id,
        name: player.name,
        color: player.color,
        alive: player.alive,
        direction: player.direction,
        segments: player.segments,
        score: player.score,
        kills: player.kills,
        effects: [...player.effects.keys()]
      })),
      food: this.food,
      powerups: this.powerups,
      leaderboard: this.buildLeaderboard(),
      round: this.round,
      timestamp: Date.now(),
      tournament: this.serializeTournament()
    };
  }

  buildLeaderboard() {
    return [...this.players.values()]
      .map((player) => ({
        id: player.id,
        name: player.name,
        score: player.score,
        kills: player.kills,
        alive: player.alive,
        color: player.color
      }))
      .sort((a, b) => b.score - a.score);
  }

  pushFrame(state) {
    const snapshot = {
      timestamp: state.timestamp,
      players: state.players.map((player) => ({
        id: player.id,
        name: player.name,
        color: player.color,
        segments: player.segments,
        alive: player.alive
      })),
      food: state.food,
      powerups: state.powerups
    };
    this.frameHistory.push(snapshot);
    const maxFrames = TICK_RATE * 120;
    if (this.frameHistory.length > maxFrames) {
      this.frameHistory.shift();
    }
  }

  update() {
    this.tickPhase();
    if (this.phase === 'waiting') {
      this.broadcast('game:state', this.serialize());
      return;
    }

    if (this.phase === 'running') {
      for (const player of this.players.values()) {
        this.handleMovement(player);
        this.handleFoodAndPowerups(player);
        this.handleEffectTimers(player);
      }
      this.handleCollisions();
      this.checkMatchEnd();
    }

    const state = this.serialize();
    this.pushFrame(state);
    this.broadcast('game:state', state);
  }
}

const createRoom = ({ name, hostId, isPrivate, modeKey }) => {
  const id = uuidv4().slice(0, 6).toUpperCase();
  const room = new RoomState({ id, name: name || `Room ${id}`, hostId, isPrivate, modeKey });
  rooms.set(id, room);
  return room;
};

const getJoinableRooms = () => {
  return [...rooms.values()]
    .filter((room) => !room.isPrivate && room.players.size < MAX_PLAYERS_PER_ROOM)
    .map((room) => ({
      id: room.id,
      name: room.name,
      players: room.players.size,
      phase: room.phase,
      mode: {
        key: room.modeKey,
        label: room.mode.label
      }
    }));
};

io.on('connection', (socket) => {
  socket.emit('rooms:list', getJoinableRooms());
  socket.on('rooms:refresh', () => {
    socket.emit('rooms:list', getJoinableRooms());
  });

  socket.on('room:create', ({ name, isPrivate, playerName, mode, preferredColor }, callback) => {
    const safeName = typeof playerName === 'string' && playerName.trim() ? playerName.trim().slice(0, 16) : 'Player';
    const modeKey = typeof mode === 'string' ? mode.toLowerCase() : DEFAULT_MODE_KEY;
    const room = createRoom({ name, hostId: socket.id, isPrivate, modeKey });
    const joinResult = joinRoom({ room, socket, playerName: safeName, preferredColor }, callback);
    if (joinResult.error) {
      rooms.delete(room.id);
    }
  });

  socket.on('room:join', ({ roomId, playerName, preferredColor }, callback) => {
    const room = rooms.get(String(roomId).toUpperCase());
    const safeName = typeof playerName === 'string' && playerName.trim() ? playerName.trim().slice(0, 16) : 'Player';
    if (!room) {
      callback?.({ error: '방을 찾을 수 없습니다.' });
      return;
    }
    joinRoom({ room, socket, playerName: safeName, preferredColor }, callback);
  });

  socket.on('room:quick-join', ({ playerName, preferredColor, mode }, callback) => {
    const safeName = typeof playerName === 'string' && playerName.trim() ? playerName.trim().slice(0, 16) : 'Player';
    const room = [...rooms.values()].find((candidate) => !candidate.isPrivate && candidate.players.size < MAX_PLAYERS_PER_ROOM);
    if (room) {
      joinRoom({ room, socket, playerName: safeName, preferredColor }, callback);
      return;
    }
    const requestedMode = typeof mode === 'string' ? mode.toLowerCase() : DEFAULT_MODE_KEY;
    const created = createRoom({ name: 'Quick Match', hostId: socket.id, isPrivate: false, modeKey: requestedMode });
    joinRoom({ room: created, socket, playerName: safeName, preferredColor }, callback);
  });

  socket.on('player:input', ({ playerId, direction }) => {
    const room = [...rooms.values()].find((r) => r.players.has(playerId));
    if (!room) return;
    const player = room.players.get(playerId);
    if (!player || !player.alive) return;
    const { x, y } = direction || {};
    if (typeof x !== 'number' || typeof y !== 'number') return;
    if (Math.abs(x) === Math.abs(y)) return; // disallow diagonals
    if (x === -player.direction.x && y === -player.direction.y) return;
    player.pendingDirection = { x, y };
  });

  socket.on('player:color-change', ({ playerId, color }, callback) => {
    const room = [...rooms.values()].find((r) => r.players.has(playerId));
    if (!room) {
      callback?.({ error: '방을 찾을 수 없습니다.' });
      return;
    }
    const result = room.changePlayerColor(playerId, color);
    if (result.error) {
      callback?.({ error: result.error });
      return;
    }
    const player = room.players.get(playerId);
    room.broadcast('room:notification', {
      id: uuidv4(),
      type: 'info',
      message: `${player.name}님이 색상을 변경했습니다.`,
      timestamp: Date.now()
    });
    callback?.({ success: true, color: player.color });
  });

  socket.on('chat:message', ({ roomId, playerId, message }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    const player = room.players.get(playerId);
    if (!player) return;
    const text = typeof message === 'string' ? message.trim().slice(0, 140) : '';
    if (!text) return;
    io.to(roomId).emit('chat:message', {
      id: uuidv4(),
      roomId,
      author: player.name,
      color: player.color,
      message: text,
      timestamp: Date.now()
    });
  });

  socket.on('room:request-replay', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    socket.emit('room:replay', {
      roomId,
      frames: room.frameHistory,
      world: { width: WORLD_WIDTH, height: WORLD_HEIGHT }
    });
  });

  socket.on('disconnect', () => {
    for (const room of rooms.values()) {
      for (const player of [...room.players.values()]) {
        if (player.socketId === socket.id) {
          room.removePlayer(player.id);
          checkRoomCleanup(room.id);
          break;
        }
      }
      room.spectators.delete(socket.id);
      room.stopLoopIfEmpty();
    }
  });
});

const joinRoom = ({ room, socket, playerName, preferredColor }, callback) => {
  if (room.players.size >= MAX_PLAYERS_PER_ROOM) {
    callback?.({ error: '방이 가득 찼습니다.' });
    return { error: 'full' };
  }

  for (const existing of room.players.values()) {
    if (existing.name.toLowerCase() === playerName.toLowerCase()) {
      callback?.({ error: '이미 존재하는 이름입니다.' });
      return { error: 'duplicate' };
    }
  }

  const playerId = uuidv4();
  const color = room.assignColor(preferredColor);
  const player = new PlayerState({ id: playerId, name: playerName, color, socketId: socket.id });
  room.addPlayer(player);
  socket.join(room.id);
  socket.emit('player:assigned', {
    playerId,
    roomId: room.id,
    color,
    mode: {
      key: room.modeKey,
      label: room.mode.label
    },
    world: { width: WORLD_WIDTH, height: WORLD_HEIGHT, segmentSize: SEGMENT_SIZE }
  });

  room.broadcast('rooms:updated', getJoinableRooms());
  room.broadcast('room:notification', {
    id: uuidv4(),
    type: 'join',
    message: `${playerName}님이 게임에 참가했습니다.`,
    timestamp: Date.now()
  });

  callback?.({
    roomId: room.id,
    playerId,
    name: room.name,
    phase: room.phase,
    color,
    mode: {
      key: room.modeKey,
      label: room.mode.label
    }
  });
  return { player };
};

const checkRoomCleanup = (roomId) => {
  const room = rooms.get(roomId);
  if (!room) return;
  if (room.players.size === 0 && room.spectators.size === 0) {
    rooms.delete(roomId);
  }
};

app.get('/api/stats', (req, res) => {
  res.json({
    updatedAt: Date.now(),
    players: [...globalStats.entries()].map(([name, stats]) => ({
      name,
      games: stats.games,
      wins: stats.wins,
      averageScore: stats.games ? Math.round(stats.totalScore / stats.games) : 0,
      winRate: stats.games ? +(stats.wins / stats.games * 100).toFixed(1) : 0,
      averageSurvivalSeconds: stats.totalSurvivalTicks ? +(stats.totalSurvivalTicks / stats.games / TICK_RATE).toFixed(1) : 0,
      kills: stats.kills
    }))
  });
});

server.listen(PORT, () => {
  console.log(`Online Worm Battle server listening on port ${PORT}`);
});
