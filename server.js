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
const BASE_SPEED = 4;
const SPEED_BOOST_MULTIPLIER = 1.6;
const TICK_RATE = 20;
const COUNTDOWN_SECONDS = 5;
const MAX_PLAYERS_PER_ROOM = 8;

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

const MAX_FOOD = 30;
const GOLDEN_FOOD_CHANCE = 0.08;
const MAX_POWERUPS = 6;
const POWERUP_SPAWN_CHANCE = 0.05;

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*'
  }
});

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

  reset() {
    this.alive = true;
    this.direction = { x: 1, y: 0 };
    this.pendingDirection = { x: 1, y: 0 };
    this.segments = PlayerState.initialBody();
    this.growth = 0;
    this.speed = BASE_SPEED;
    this.effects = new Map();
    this.score = 0;
    this.kills = 0;
    this.lastTail = null;
    this.survivalTicks = 0;
    this.spawnTime = Date.now();
  }

  static initialBody() {
    const start = randomCoord();
    return [start];
  }
}

class RoomState {
  constructor({ id, name, hostId, isPrivate }) {
    this.id = id;
    this.name = name;
    this.hostId = hostId;
    this.isPrivate = Boolean(isPrivate);
    this.players = new Map();
    this.spectators = new Set();
    this.colorsInUse = new Set();
    this.food = [];
    this.powerups = [];
    this.phase = 'waiting';
    this.countdownTicks = 0;
    this.frameHistory = [];
    this.round = 0;
    this.loop = null;
  }

  assignColor() {
    for (const color of PLAYER_COLORS) {
      if (!this.colorsInUse.has(color)) {
        this.colorsInUse.add(color);
        return color;
      }
    }
    return PLAYER_COLORS[Math.floor(Math.random() * PLAYER_COLORS.length)];
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
        this.phase = 'countdown';
        this.countdownTicks = COUNTDOWN_SECONDS * TICK_RATE;
        this.frameHistory = [];
      }
    } else if (this.phase === 'countdown') {
      this.countdownTicks -= 1;
      if (this.countdownTicks <= 0) {
        this.startMatch();
      }
    }
  }

  startMatch() {
    this.phase = 'running';
    this.round += 1;
    this.frameHistory = [];
    for (const player of this.players.values()) {
      player.reset();
    }
    while (this.food.length < MAX_FOOD) {
      this.spawnFood();
    }
    this.powerups = [];
  }

  spawnFood() {
    const type = Math.random() < GOLDEN_FOOD_CHANCE ? FOOD_TYPES.GOLDEN : FOOD_TYPES.BASIC;
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
    const speedMultiplier = player.effects.has(POWERUP_TYPES.SPEED) ? SPEED_BOOST_MULTIPLIER : 1;
    const dx = player.direction.x * player.speed * speedMultiplier;
    const dy = player.direction.y * player.speed * speedMultiplier;
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
          player.speed = BASE_SPEED + 1;
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

    if (this.food.length < MAX_FOOD && Math.random() < 0.2) {
      this.spawnFood();
    }
    if (this.powerups.length < MAX_POWERUPS && Math.random() < POWERUP_SPAWN_CHANCE) {
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
          player.speed = BASE_SPEED;
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
      this.phase = 'ended';
      if (alive.length === 1) {
        const winner = alive[0];
        winner.score += 200;
        this.recordGlobalStats(winner, true);
      }
      for (const player of this.players.values()) {
        this.recordGlobalStats(player, false);
      }
      this.broadcast('game:ended', {
        winnerId: alive[0]?.id || null,
        leaderboard: this.buildLeaderboard()
      });
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
      phase: this.phase,
      countdown: Math.ceil(this.countdownTicks / TICK_RATE),
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
      timestamp: Date.now()
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

const createRoom = ({ name, hostId, isPrivate }) => {
  const id = uuidv4().slice(0, 6).toUpperCase();
  const room = new RoomState({ id, name: name || `Room ${id}`, hostId, isPrivate });
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
      phase: room.phase
    }));
};

io.on('connection', (socket) => {
  socket.emit('rooms:list', getJoinableRooms());
  socket.on('rooms:refresh', () => {
    socket.emit('rooms:list', getJoinableRooms());
  });

  socket.on('room:create', ({ name, isPrivate, playerName }, callback) => {
    const safeName = typeof playerName === 'string' && playerName.trim() ? playerName.trim().slice(0, 16) : 'Player';
    const room = createRoom({ name, hostId: socket.id, isPrivate });
    const joinResult = joinRoom({ room, socket, playerName: safeName }, callback);
    if (joinResult.error) {
      rooms.delete(room.id);
    }
  });

  socket.on('room:join', ({ roomId, playerName }, callback) => {
    const room = rooms.get(String(roomId).toUpperCase());
    const safeName = typeof playerName === 'string' && playerName.trim() ? playerName.trim().slice(0, 16) : 'Player';
    if (!room) {
      callback?.({ error: '방을 찾을 수 없습니다.' });
      return;
    }
    joinRoom({ room, socket, playerName: safeName }, callback);
  });

  socket.on('room:quick-join', ({ playerName }, callback) => {
    const room = [...rooms.values()].find((candidate) => !candidate.isPrivate && candidate.players.size < MAX_PLAYERS_PER_ROOM);
    if (room) {
      joinRoom({ room, socket, playerName }, callback);
      return;
    }
    const created = createRoom({ name: 'Quick Match', hostId: socket.id, isPrivate: false });
    joinRoom({ room: created, socket, playerName }, callback);
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

const joinRoom = ({ room, socket, playerName }, callback) => {
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
  const color = room.assignColor();
  const player = new PlayerState({ id: playerId, name: playerName, color, socketId: socket.id });
  room.addPlayer(player);
  socket.join(room.id);
  socket.emit('player:assigned', {
    playerId,
    roomId: room.id,
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
    phase: room.phase
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
